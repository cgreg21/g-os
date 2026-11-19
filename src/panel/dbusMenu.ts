import {CleanupManager} from '../core/cleanupManager.js';

export const DBUS_MENU_XML = `<node><interface name="com.canonical.dbusmenu">
<method name="GetLayout"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/><arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/></method>
<method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
<method name="Event"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="in"/><arg type="u" direction="in"/></method>
<signal name="LayoutUpdated"><arg type="u"/><arg type="i"/></signal>
<signal name="ItemsPropertiesUpdated"><arg type="a(ia{sv})"/><arg type="a(ias)"/></signal>
</interface></node>`;

export class MenuSignals {
    [key: string]: any;
    constructor() { this.signals = new Map(); this.nextSignal = 0; }
    connect(signal, callback) { this.signals.set(++this.nextSignal, [signal, callback]); return this.nextSignal; }
    disconnect(id) { this.signals.delete(id); }
    emit(signal, ...args) {
        for (const [name, callback] of [...this.signals.values()]) {
            if (name === signal)
                callback(this, ...args);
        }
    }
}

export function decodeDbusMenuLayout(layout) {
    const nodes = new Map();
    const unpack = value => typeof value?.deep_unpack === 'function' ? value.deep_unpack() : value;
    const visit = (value, depth) => {
        const tuple = unpack(value);
        if (depth > 8 || nodes.size >= 512 || !Array.isArray(tuple) || tuple.length !== 3 ||
            !Number.isInteger(tuple[0]) || tuple[0] < 0 || nodes.has(tuple[0]) ||
            !tuple[1] || typeof tuple[1] !== 'object' || !Array.isArray(tuple[2]))
            throw new Error('Invalid or oversized DBusMenu layout');
        const properties = Object.fromEntries(Object.entries(tuple[1]).map(([key, property]) => [key, unpack(property)]));
        const node = {id: tuple[0], properties, children: [], model: null as any};
        nodes.set(node.id, node);
        node.children = tuple[2].map(child => visit(child, depth + 1));
        return node;
    };
    return {root: visit(layout, 0), nodes};
}

class DbusMenuModel extends MenuSignals {
    constructor(client, id, items = []) { super(); this.client = client; this.id = id; this.items = items; }
    get_n_items() { return this.items.length; }
    get_item_link(index, name) {
        const node = this.items[index];
        return name === 'submenu' && (node.children.length > 0 || node.properties['children-display'] === 'submenu')
            ? node.model : null;
    }
    get_item_attribute_value(index, name) {
        const node = this.items[index];
        const properties = node.properties;
        if (name === 'x-dbusmenu-enabled')
            return new this.client.GLib.Variant('b', properties.enabled !== false);
        const attributes = {
            label: typeof properties.label === 'string'
                ? properties.label.replace(/&&/g, '\u0000').replace(/&/g, '').replace(/\u0000/g, '&').replace(/_/g, '__') : '',
            action: `dbus.${node.id}`,
            'x-dbusmenu-type': properties.type ?? '',
            'x-dbusmenu-toggle-type': properties['toggle-type'] ?? '',
            accel: Array.isArray(properties.shortcut?.[0]) ? properties.shortcut[0].join('+') : '',
        };
        return typeof attributes[name] === 'string' ? new this.client.GLib.Variant('s', attributes[name]) : null;
    }
    aboutToShow() { this.client.aboutToShow(this.id); }
}

class DbusMenuActions extends MenuSignals {
    constructor(client) { super(); this.client = client; }
    has_action(name) { return /^\d+$/.test(name) && this.client.nodes.has(Number(name)); }
    get_action_enabled(name) {
        const node = this.client.nodes.get(Number(name));
        return Boolean(node && node.properties.enabled !== false && node.properties.visible !== false &&
            node.properties.type !== 'separator' && node.children.length === 0 && node.properties['children-display'] !== 'submenu');
    }
    get_action_state(name) {
        const node = this.client.nodes.get(Number(name));
        return ['checkmark', 'radio'].includes(node?.properties['toggle-type'])
            ? new this.client.GLib.Variant('b', node.properties['toggle-state'] === 1) : null;
    }
    get_action_parameter_type() { return null; }
    activate_action(name) {
        if (!this.client.disposed && this.has_action(name) && this.get_action_enabled(name))
            this.client.event(Number(name));
    }
}

export class DbusMenuClient {
    [key: string]: any;
    constructor(bus, path, {Gio, GLib, timestamp}) {
        Object.assign(this, {bus, path, Gio, GLib, timestamp});
        this.nodes = new Map();
        this.model = new DbusMenuModel(this, 0);
        this.actions = new DbusMenuActions(this);
        this.token = new Gio.Cancellable();
        this.disposed = false;
        this.pending = false;
        this.dirty = false;
        this.proxy = null;
        this.signal = 0;
        this.cleanup = new CleanupManager();
        this.signature = '';
        const info = Gio.DBusNodeInfo.new_for_xml(DBUS_MENU_XML).interfaces[0];
        Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES, info,
            bus, path, 'com.canonical.dbusmenu', this.token, (_source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_finish(result);
                    if (this.disposed) {
                        proxy.run_dispose?.();
                        return;
                    }
                    this.proxy = proxy;
                    this.signal = proxy.connect('g-signal', (_proxy, _sender, name) => {
                        if (['LayoutUpdated', 'ItemsPropertiesUpdated'].includes(name))
                            this.refresh();
                    });
                    this.cleanup.addSignal(proxy, this.signal);
                    this.refresh();
                } catch (error) {
                    if (!this.disposed)
                        this.error = String(error);
                }
            });
    }

    refresh() {
        if (this.disposed || !this.proxy)
            return;
        if (this.pending) {
            this.dirty = true;
            return;
        }
        this.pending = true;
        this.proxy.call('GetLayout', new this.GLib.Variant('(iias)', [0, 8, []]),
            this.Gio.DBusCallFlags.NONE, 3000, this.token, (proxy, result) => {
                try {
                    const reply = proxy.call_finish(result);
                    if (!this.disposed) {
                        if (reply.get_type_string() !== '(u(ia{sv}av))')
                            throw new Error('Unexpected DBusMenu GetLayout reply');
                        const [, layout] = reply.deep_unpack();
                        this._apply(layout);
                    }
                } catch (error) {
                    if (!this.disposed) {
                        this.error = String(error);
                        this.nodes.clear();
                        this.signature = '';
                        this.model.items = [];
                        this.model.emit('items-changed');
                    }
                } finally {
                    this.pending = false;
                    if (this.dirty && !this.disposed) {
                        this.dirty = false;
                        this.refresh();
                    }
                }
            });
    }

    _apply(layout) {
        const {root, nodes} = decodeDbusMenuLayout(layout);
        const signature = JSON.stringify(root);
        if (signature === this.signature)
            return;
        const populate = node => {
            node.model = new DbusMenuModel(this, node.id,
                node.children.filter(child => child.properties.visible !== false));
            for (const child of node.children)
                populate(child);
        };
        populate(root);
        this.signature = signature;
        this.nodes = nodes;
        this.model.id = root.id;
        this.model.items = root.model.items;
        this.error = null;
        this.model.emit('items-changed');
    }

    aboutToShow(id) {
        if (!this.proxy || this.disposed)
            return;
        this.proxy.call('AboutToShow', new this.GLib.Variant('(i)', [id]),
            this.Gio.DBusCallFlags.NONE, 3000, this.token, (proxy, result) => {
                try {
                    const [update] = proxy.call_finish(result).deep_unpack();
                    if (update && !this.disposed)
                        this.refresh();
                } catch {}
            });
    }

    event(id) {
        if (!this.proxy || this.disposed)
            return;
        this.proxy.call('Event', new this.GLib.Variant('(isvu)',
            [id, 'clicked', new this.GLib.Variant('i', 0), this.timestamp() >>> 0]),
        this.Gio.DBusCallFlags.NONE, 3000, this.token, (proxy, result) => {
            try { proxy.call_finish(result); } catch {}
        });
    }

    destroy() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.token.cancel();
        this.cleanup.clear();
        this.signal = 0;
        this.proxy?.run_dispose?.();
        this.proxy = null;
        this.nodes.clear();
        this.model.items = [];
    }
}