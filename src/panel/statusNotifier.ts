import {CleanupManager} from '../core/cleanupManager.js';

export const STATUS_NOTIFIER_NAME = 'org.kde.StatusNotifierWatcher';
export const STATUS_NOTIFIER_PATH = '/StatusNotifierWatcher';
export const STATUS_NOTIFIER_WATCHER_XML = `<node><interface name="org.kde.StatusNotifierWatcher">
<method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
<method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
<property name="RegisteredStatusNotifierItems" type="as" access="read"/>
<property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
<property name="ProtocolVersion" type="i" access="read"/>
<signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
<signal name="StatusNotifierItemUnregistered"><arg type="s"/></signal>
<signal name="StatusNotifierHostRegistered"/>
<signal name="StatusNotifierHostUnregistered"/>
</interface></node>`;

const ITEM_XML = `<node><interface name="org.kde.StatusNotifierItem">
<method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
<method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
<method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
<method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
<property name="Category" type="s" access="read"/>
<property name="Id" type="s" access="read"/>
<property name="Title" type="s" access="read"/>
<property name="Status" type="s" access="read"/>
<property name="WindowId" type="u" access="read"/>
<property name="IconName" type="s" access="read"/>
<property name="IconPixmap" type="a(iiay)" access="read"/>
<property name="OverlayIconName" type="s" access="read"/>
<property name="OverlayIconPixmap" type="a(iiay)" access="read"/>
<property name="AttentionIconName" type="s" access="read"/>
<property name="AttentionIconPixmap" type="a(iiay)" access="read"/>
<property name="AttentionMovieName" type="s" access="read"/>
<property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
<property name="ItemIsMenu" type="b" access="read"/>
<property name="Menu" type="o" access="read"/>
<signal name="NewTitle"/>
<signal name="NewIcon"/>
<signal name="NewAttentionIcon"/>
<signal name="NewOverlayIcon"/>
<signal name="NewToolTip"/>
<signal name="NewStatus"><arg type="s"/></signal>
</interface></node>`;

const itemKey = (bus: string, path: string) => `${bus}${path}`;

export function parseStatusNotifierAddress(address: string, sender: string) {
    if (typeof address !== 'string' || typeof sender !== 'string' ||
        (sender && (!sender.startsWith(':') || !sender.includes('.'))))
        return null;
    if (address.startsWith('/'))
        return sender ? {bus: sender, path: address} : null;
    const separator = address.indexOf('/');
    const bus = separator < 0 ? address : address.slice(0, separator);
    const path = separator < 0 ? '/StatusNotifierItem' : address.slice(separator);
    return bus && path.startsWith('/') ? {bus, path} : null;
}

export function createStatusNotifierPixbuf(pixmaps: unknown, GdkPixbuf: any, GLib: any) {
    if (!Array.isArray(pixmaps))
        return null;
    const candidates = pixmaps.filter(pixmap => Array.isArray(pixmap) &&
        Number.isInteger(pixmap[0]) && Number.isInteger(pixmap[1]) &&
        pixmap[0] > 0 && pixmap[1] > 0 && pixmap[0] <= 256 && pixmap[1] <= 256 &&
        pixmap[2]?.length === pixmap[0] * pixmap[1] * 4);
    candidates.sort((a, b) => Math.abs(a[0] - 24) + Math.abs(a[1] - 24) -
        Math.abs(b[0] - 24) - Math.abs(b[1] - 24));
    const [width, height, data] = candidates[0] ?? [];
    if (!data)
        return null;
    const rgba = new Uint8Array(data.length);
    for (let offset = 0; offset < data.length; offset += 4) {
        rgba[offset] = data[offset + 1];
        rgba[offset + 1] = data[offset + 2];
        rgba[offset + 2] = data[offset + 3];
        rgba[offset + 3] = data[offset];
    }
    return GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(rgba), GdkPixbuf.Colorspace.RGB, true,
        8, width, height, width * 4);
}

export class StatusNotifierHost {
    [key: string]: any;

    constructor({Gio, GLib, onChanged = () => {}}) {
        Object.assign(this, {Gio, GLib, onChanged});
        this.items = new Map();
        this.hosts = new Set();
        this.owner = 0;
        this.exported = null;
        this.external = null;
        this.externalCleanup = new CleanupManager();
        this.token = new Gio.Cancellable();
        this.disposed = false;
        this.ownsName = false;
    }

    start() {
        if (this.owner || this.disposed)
            return;
        this.owner = this.Gio.bus_own_name_on_connection(this.Gio.DBus.session, STATUS_NOTIFIER_NAME,
            this.Gio.BusNameOwnerFlags.NONE, () => this._own(), () => {
                if (!this.disposed && !this.ownsName)
                    this._followExternal();
                else if (!this.disposed) {
                    this.ownsName = false;
                    this.exported?.unexport();
                    this.exported = null;
                    this.hosts.clear();
                    this._clearItems();
                    this._followExternal();
                }
            });
    }

    _own() {
        if (this.disposed)
            return;
        this.ownsName = true;
        this._stopExternal();
        const exported = this.Gio.DBusExportedObject.wrapJSObject(STATUS_NOTIFIER_WATCHER_XML, {
            RegisterStatusNotifierItemAsync: ([address], invocation) => this._registerAddress(address, invocation),
            RegisterStatusNotifierHostAsync: ([_service], invocation) => {
                const sender = invocation.get_sender();
                if (sender && !this.hosts.has(sender)) {
                    this.hosts.add(sender);
                    this.exported?.emit_signal('StatusNotifierHostRegistered', new this.GLib.Variant('()', []));
                }
                invocation.return_value(new this.GLib.Variant('()', []));
            },
            get_property: (_connection, _sender, _path, _interface, property) => {
                if (property === 'RegisteredStatusNotifierItems')
                    return new this.GLib.Variant('as', [...this.items.values()].map(item => item.address));
                if (property === 'IsStatusNotifierHostRegistered')
                    return new this.GLib.Variant('b', this.hosts.size > 0);
                if (property === 'ProtocolVersion')
                    return new this.GLib.Variant('i', 0);
                return null;
            },
        });
        exported.export(this.Gio.DBus.session, STATUS_NOTIFIER_PATH);
        this.exported = exported;
        const uniqueName = this.Gio.DBus.session.get_unique_name();
        if (uniqueName)
            this.hosts.add(uniqueName);
        this.onChanged(this.visibleItems());
    }

    _registerAddress(address, invocation) {
        const parsed = parseStatusNotifierAddress(address, invocation.get_sender());
        if (!parsed || !this.Gio.dbus_is_name(parsed.bus) || !this.GLib.Variant.is_object_path(parsed.path)) {
            invocation.return_dbus_error(`${STATUS_NOTIFIER_NAME}.Error.InvalidAddress`,
                'Invalid StatusNotifierItem address');
            return;
        }
        const register = () => {
            if (this.disposed || !this.ownsName) {
                invocation.return_dbus_error(`${STATUS_NOTIFIER_NAME}.Error.NotAvailable`,
                    'StatusNotifierWatcher is no longer available');
                return;
            }
            const key = itemKey(parsed.bus, parsed.path);
            if (this.items.has(key)) {
                invocation.return_value(new this.GLib.Variant('()', []));
                return;
            }
            const item = {key, ...parsed, address: `${parsed.bus}${parsed.path}`, proxy: null,
                cleanup: new CleanupManager(), properties: {}};
            this.items.set(key, item);
            this._watchItem(item);
            this.exported?.emit_signal('StatusNotifierItemRegistered',
                new this.GLib.Variant('(s)', [item.address]));
            this.onChanged(this.visibleItems());
            invocation.return_value(new this.GLib.Variant('()', []));
        };
        if (parsed.bus === invocation.get_sender()) {
            register();
            return;
        }
        this.Gio.DBus.session.call(parsed.bus, '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetNameOwner',
            new this.GLib.Variant('(s)', [parsed.bus]), null, this.Gio.DBusCallFlags.NONE, 3000, this.token,
            (connection, result) => {
                try {
                    const [owner] = connection.call_finish(result).deep_unpack();
                    if (owner !== invocation.get_sender()) {
                        invocation.return_dbus_error(`${STATUS_NOTIFIER_NAME}.Error.InvalidAddress`,
                            'The item address is not owned by the registering client');
                        return;
                    }
                    register();
                } catch (error) {
                    invocation.return_dbus_error(`${STATUS_NOTIFIER_NAME}.Error.InvalidAddress`, String(error));
                }
            });
    }

    _watchItem(item) {
        const info = this.Gio.DBusNodeInfo.new_for_xml(ITEM_XML).interfaces[0];
        this.Gio.DBusProxy.new(this.Gio.DBus.session, this.Gio.DBusProxyFlags.NONE, info,
            item.bus, item.path, 'org.kde.StatusNotifierItem', this.token, (_source, result) => {
                try {
                    const proxy = this.Gio.DBusProxy.new_finish(result);
                    if (this.disposed || this.items.get(item.key) !== item) {
                        proxy.run_dispose?.();
                        return;
                    }
                    item.proxy = proxy;
                    item.cleanup.addSignal(proxy,
                        proxy.connect('g-properties-changed', () => this._refreshItem(item)));
                    this._refreshItem(item);
                } catch {
                    this._removeItem(item);
                }
            });
        const watcher = this.Gio.bus_watch_name_on_connection(this.Gio.DBus.session, item.bus,
            this.Gio.BusNameWatcherFlags.NONE, null, () => this._removeItem(item));
        item.cleanup.add(() => this.Gio.bus_unwatch_name(watcher));
    }

    _refreshItem(item) {
        if (!item.proxy || this.items.get(item.key) !== item)
            return;
        const names = ['Id', 'Title', 'Status', 'IconName', 'IconPixmap', 'AttentionIconName',
            'AttentionIconPixmap', 'ToolTip', 'ItemIsMenu', 'Menu'];
        for (const name of names) {
            const value = item.proxy.get_cached_property(name);
            if (value) {
                try { item.properties[name] = value.deep_unpack(); } catch {}
            }
        }
        this.onChanged(this.visibleItems());
    }

    visibleItems() {
        return [...this.items.values()]
            .filter(item => item.properties.Status !== 'Passive')
            .sort((a, b) => a.address.localeCompare(b.address));
    }

    _removeItem(item) {
        if (!item || this.items.get(item.key) !== item)
            return;
        this.items.delete(item.key);
        item.cleanup.clear();
        item.proxy?.run_dispose?.();
        item.proxy = null;
        if (this.ownsName)
            this.exported?.emit_signal('StatusNotifierItemUnregistered',
                new this.GLib.Variant('(s)', [item.address]));
        this.onChanged(this.visibleItems());
    }

    _clearItems() {
        for (const item of [...this.items.values()])
            this._removeItem(item);
    }

    _followExternal() {
        if (this.disposed || this.ownsName || this.external)
            return;
        const info = this.Gio.DBusNodeInfo.new_for_xml(STATUS_NOTIFIER_WATCHER_XML).interfaces[0];
        this.Gio.DBusProxy.new(this.Gio.DBus.session, this.Gio.DBusProxyFlags.NONE, info,
            STATUS_NOTIFIER_NAME, STATUS_NOTIFIER_PATH, STATUS_NOTIFIER_NAME, this.token, (_source, result) => {
                try {
                    const proxy = this.Gio.DBusProxy.new_finish(result);
                    if (this.disposed || this.ownsName) {
                        proxy.run_dispose?.();
                        return;
                    }
                    this.external = proxy;
                    this.externalCleanup.addSignal(proxy, proxy.connect('g-signal', (_proxy, _sender, name, parameters) => {
                        const [address] = parameters.deep_unpack();
                        if (name === 'StatusNotifierItemRegistered')
                            this._addExternalItem(address);
                        else if (name === 'StatusNotifierItemUnregistered')
                            this._removeExternalItem(address);
                    }));
                    const watcher = this.Gio.bus_watch_name_on_connection(this.Gio.DBus.session,
                        STATUS_NOTIFIER_NAME, this.Gio.BusNameWatcherFlags.NONE, null, () => {
                            this._stopExternal();
                            this._clearItems();
                            if (!this.disposed)
                                this._own();
                        });
                    this.externalCleanup.add(() => this.Gio.bus_unwatch_name(watcher));
                    const registered = proxy.get_cached_property('RegisteredStatusNotifierItems');
                    for (const address of registered?.deep_unpack() ?? [])
                        this._addExternalItem(address);
                    const uniqueName = this.Gio.DBus.session.get_unique_name();
                    if (uniqueName)
                        proxy.call('RegisterStatusNotifierHost', new this.GLib.Variant('(s)', [uniqueName]),
                            this.Gio.DBusCallFlags.NONE, 3000, this.token, () => {});
                } catch {
                    this._stopExternal();
                }
            });
    }

    _addExternalItem(address) {
        const parsed = parseStatusNotifierAddress(address, '');
        if (!parsed || !this.Gio.dbus_is_name(parsed.bus) || !this.GLib.Variant.is_object_path(parsed.path))
            return;
        const key = itemKey(parsed.bus, parsed.path);
        if (this.items.has(key))
            return;
        const item = {key, ...parsed, address: `${parsed.bus}${parsed.path}`, proxy: null,
            cleanup: new CleanupManager(), properties: {}};
        this.items.set(key, item);
        this._watchItem(item);
        this.onChanged(this.visibleItems());
    }

    _removeExternalItem(address) {
        const parsed = parseStatusNotifierAddress(address, '');
        if (parsed)
            this._removeItem(this.items.get(itemKey(parsed.bus, parsed.path)));
    }

    _stopExternal() {
        this.externalCleanup.clear();
        this.externalCleanup = new CleanupManager();
        this.external?.run_dispose?.();
        this.external = null;
    }

    activate(item, method, x = 0, y = 0, scroll = 0, orientation = 'vertical') {
        const proxy = item?.proxy;
        if (!proxy || this.disposed)
            return;
        const signature = method === 'Scroll' ? '(is)' : '(ii)';
        const args = method === 'Scroll' ? [scroll, orientation] : [x, y];
        proxy.call(method, new this.GLib.Variant(signature, args), this.Gio.DBusCallFlags.NONE, 3000,
            this.token, (source, result) => {
                try { source.call_finish(result); } catch {}
            });
    }

    destroy() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.token.cancel();
        this._stopExternal();
        this._clearItems();
        this.exported?.unexport();
        this.exported = null;
        if (this.owner)
            this.Gio.bus_unown_name(this.owner);
        this.owner = 0;
        this.ownsName = false;
        this.hosts.clear();
    }
}
