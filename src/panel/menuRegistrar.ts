import {CleanupManager} from '../core/cleanupManager.js';
import {MenuSignals} from './dbusMenu.js';

export const REGISTRAR_NAME = 'com.canonical.AppMenu.Registrar';
export const REGISTRAR_PATH = '/com/canonical/AppMenu/Registrar';
export const REGISTRAR_XML = `<node><interface name="com.canonical.AppMenu.Registrar">
<method name="RegisterWindow"><arg type="u" direction="in"/><arg type="o" direction="in"/></method>
<method name="UnregisterWindow"><arg type="u" direction="in"/></method>
<method name="GetMenuForWindow"><arg type="u" direction="in"/><arg type="s" direction="out"/><arg type="o" direction="out"/></method>
<method name="GetMenus"><arg type="a(uso)" direction="out"/></method>
<signal name="WindowRegistered"><arg type="u"/><arg type="s"/><arg type="o"/></signal>
<signal name="WindowUnregistered"><arg type="u"/></signal>
</interface></node>`;

export class DbusMenuRegistrar extends MenuSignals {
    constructor({Gio, GLib, Meta}) {
        super();
        Object.assign(this, {Gio, GLib, Meta});
        this.entries = new Map();
        this.owner = 0;
        this.subscription = 0;
        this.cleanup = new CleanupManager();
        this.externalCleanup = new CleanupManager();
        this.exported = null;
        this.external = null;
        this.externalSignal = 0;
        this.token = new Gio.Cancellable();
        this.ownsName = false;
        this.disposed = false;
    }

    start() {
        if (this.subscription || this.disposed)
            return;
        const {Gio} = this;
        this.subscription = Gio.DBus.session.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, parameters) => {
                const [name, , current] = parameters.deep_unpack();
                if (!current)
                    this._dropSender(name);
                if (name === REGISTRAR_NAME && !this.ownsName) {
                    this._stopExternal();
                    this._clearEntries();
                    if (current)
                        this._followExternal();
                    else if (!this.owner)
                        this._own();
                }
            });
        this.cleanup.add(() => Gio.DBus.session.signal_unsubscribe(this.subscription));
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'GetNameOwner', new this.GLib.Variant('(s)', [REGISTRAR_NAME]), null, Gio.DBusCallFlags.NONE,
            3000, this.token, (connection, result) => {
                let exists = false;
                try { connection.call_finish(result); exists = true; } catch {}
                if (!this.disposed) {
                    if (exists)
                        this._followExternal();
                    else
                        this._own();
                }
            });
    }

    _own() {
        if (this.disposed || this.owner)
            return;
        this.owner = this.Gio.bus_own_name_on_connection(this.Gio.DBus.session, REGISTRAR_NAME,
            this.Gio.BusNameOwnerFlags.NONE, () => {
                if (this.disposed)
                    return;
                this._stopExternal();
                this._clearEntries();
                this.exported = this.Gio.DBusExportedObject.wrapJSObject(REGISTRAR_XML, this._implementation());
                this.exported.export(this.Gio.DBus.session, REGISTRAR_PATH);
                this.ownsName = true;
            }, () => {
                if (this.disposed)
                    return;
                this.ownsName = false;
                this.exported?.unexport();
                this.exported = null;
                this._clearEntries();
                this._followExternal();
            });
    }

    _valid(windowId, bus, path) {
        return Number.isInteger(windowId) && windowId > 0 && windowId <= 0xffffffff &&
            typeof bus === 'string' && this.Gio.dbus_is_name(bus) &&
            typeof path === 'string' && this.GLib.Variant.is_object_path(path);
    }

    register(windowId, bus, path, external = false) {
        if (this.disposed || !this._valid(windowId, bus, path) || this.entries.size >= 512 && !this.entries.has(windowId))
            throw new Error('Invalid AppMenu registration');
        const previous = this.entries.get(windowId);
        if (previous && previous.bus !== bus && !external)
            throw new Error('Window menu belongs to another D-Bus client');
        if (previous?.bus === bus && previous.path === path)
            return;
        this.entries.set(windowId, Object.freeze({windowId, bus, path}));
        if (this.ownsName)
            this.exported?.emit_signal('WindowRegistered', new this.GLib.Variant('(uso)', [windowId, bus, path]));
        this.emit('changed', windowId);
    }

    unregister(windowId, bus) {
        const entry = this.entries.get(windowId);
        if (!entry)
            return;
        if (entry.bus !== bus)
            throw new Error('Window menu belongs to another D-Bus client');
        this.entries.delete(windowId);
        if (this.ownsName)
            this.exported?.emit_signal('WindowUnregistered', new this.GLib.Variant('(u)', [windowId]));
        this.emit('changed', windowId);
    }

    _dropSender(bus) {
        for (const [windowId, entry] of [...this.entries]) {
            if (entry.bus === bus)
                this.unregister(windowId, bus);
        }
    }

    _clearEntries() {
        for (const [windowId, entry] of [...this.entries])
            this.unregister(windowId, entry.bus);
    }

    windowId(window) {
        if (!window || typeof window.get_client_type !== 'function' ||
            window.get_client_type() !== this.Meta.WindowClientType.X11)
            return null;
        const direct = window.get_xwindow?.();
        if (Number.isInteger(direct) && direct > 0 && direct <= 0xffffffff)
            return direct;
        const description = window.get_description?.() ?? '';
        const match = /^0x([0-9a-f]+)(?:\s|$)/i.exec(description);
        const id = match ? Number.parseInt(match[1], 16) : 0;
        return id > 0 && id <= 0xffffffff ? id : null;
    }

    getForWindow(window) { return this.entries.get(this.windowId(window)) ?? null; }

    _implementation() {
        const respond = (invocation, callback) => {
            try { callback(); } catch (error) {
                invocation.return_dbus_error(`${REGISTRAR_NAME}.Error.InvalidRegistration`, String(error));
            }
        };
        return {
            RegisterWindowAsync: ([windowId, path], invocation) => respond(invocation, () => {
                this.register(windowId, invocation.get_sender(), path);
                invocation.return_value(new this.GLib.Variant('()', []));
            }),
            UnregisterWindowAsync: ([windowId], invocation) => respond(invocation, () => {
                this.unregister(windowId, invocation.get_sender());
                invocation.return_value(new this.GLib.Variant('()', []));
            }),
            GetMenuForWindowAsync: ([windowId], invocation) => {
                const entry = this.entries.get(windowId);
                if (entry)
                    invocation.return_value(new this.GLib.Variant('(so)', [entry.bus, entry.path]));
                else
                    invocation.return_dbus_error(`${REGISTRAR_NAME}.Error.NotFound`, 'No menu for this window');
            },
            GetMenusAsync: (_parameters, invocation) => invocation.return_value(new this.GLib.Variant('(a(uso))',
                [[...this.entries.values()].map(entry => [entry.windowId, entry.bus, entry.path])])),
        };
    }

    _followExternal() {
        if (this.disposed || this.ownsName || this.external)
            return;
        const {Gio} = this;
        const info = Gio.DBusNodeInfo.new_for_xml(REGISTRAR_XML).interfaces[0];
        Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES, info, REGISTRAR_NAME,
            REGISTRAR_PATH, REGISTRAR_NAME, this.token, (_source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_finish(result);
                    if (this.disposed || this.ownsName) {
                        proxy.run_dispose?.();
                        return;
                    }
                    this.external = proxy;
                    this.externalSignal = proxy.connect('g-signal', (_proxy, _sender, name, parameters) => {
                        if (this.disposed || this.ownsName)
                            return;
                        const values = parameters.deep_unpack();
                        try {
                            if (name === 'WindowRegistered')
                                this.register(values[0], values[1], values[2], true);
                            else if (name === 'WindowUnregistered') {
                                const entry = this.entries.get(values[0]);
                                if (entry)
                                    this.unregister(values[0], entry.bus);
                            }
                        } catch {}
                    });
                    this.externalCleanup.addSignal(proxy, this.externalSignal);
                    proxy.call('GetMenus', null, Gio.DBusCallFlags.NONE, 3000, this.token, (source, reply) => {
                        try {
                            const [entries] = source.call_finish(reply).deep_unpack();
                            if (!this.disposed && !this.ownsName) {
                                for (const [windowId, bus, path] of entries.slice(0, 512))
                                    this.register(windowId, bus, path, true);
                            }
                        } catch {}
                    });
                } catch {}
            });
    }

    _stopExternal() {
        this.externalCleanup.clear();
        this.externalCleanup = new CleanupManager();
        this.externalSignal = 0;
        this.external?.run_dispose?.();
        this.external = null;
    }

    destroy() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.token.cancel();
        this._stopExternal();
        this._clearEntries();
        this.exported?.unexport();
        this.exported = null;
        this.cleanup.clear();
        if (this.owner)
            this.Gio.bus_unown_name(this.owner);
        this.subscription = 0;
        this.owner = 0;
        this.ownsName = false;
        this.signals.clear();
    }
}