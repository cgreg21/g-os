import assert from 'node:assert/strict';
import test from 'node:test';
import {
    parseStatusNotifierAddress,
    createStatusNotifierPixbuf,
    STATUS_NOTIFIER_NAME,
    STATUS_NOTIFIER_PATH,
    StatusNotifierHost,
} from '../dist/panel/statusNotifier.js';

class MockVariant {
    constructor(signature, value) { this.signature = signature; this.value = value; }
    deep_unpack() { return this.value; }
}

function createHost() {
    const state = {items: [], signals: [], watches: new Map(), disposedProxies: 0};
    const session = {
        get_unique_name: () => ':1.99',
        call(_bus, _path, _interface, _method, parameters, _reply, _flags, _timeout, _token, callback) {
            state.ownerToCheck = parameters.deep_unpack()[0];
            callback(this, {});
        },
        call_finish() { return new MockVariant('(s)', [':1.23']); },
    };
    const itemProxy = {
        connect() { return 7; },
        disconnect() {},
        run_dispose() { state.disposedProxies++; },
        get_cached_property(name) {
            const values = {
                Id: 'fixture', Title: 'Fixture', Status: 'Active', IconName: 'fixture-symbolic',
                AttentionIconName: '', ToolTip: ['', [], 'Fixture title', 'Fixture tip'],
                ItemIsMenu: false, Menu: '/Menu',
            };
            return name in values ? new MockVariant('', values[name]) : null;
        },
    };
    const Gio = {
        DBus: {session},
        DBusProxyFlags: {NONE: 0},
        BusNameOwnerFlags: {NONE: 0},
        BusNameWatcherFlags: {NONE: 0},
        DBusCallFlags: {NONE: 0},
        Cancellable: class { cancel() {} },
        dbus_is_name: name => /^(:\d+\.\d+|[A-Za-z][A-Za-z0-9_.-]*)$/.test(name),
        bus_own_name_on_connection(_connection, _name, _flags, acquired) {
            acquired();
            return 3;
        },
        bus_unown_name() {},
        bus_watch_name_on_connection(_connection, name, _flags, _appeared, vanished) {
            const id = state.watches.size + 10;
            state.watches.set(id, {name, vanished});
            return id;
        },
        bus_unwatch_name(id) { state.watches.delete(id); },
        DBusExportedObject: {
            wrapJSObject(_xml, implementation) {
                state.implementation = implementation;
                return {
                    export() {},
                    unexport() {},
                    emit_signal(name, parameters) { state.signals.push([name, parameters.deep_unpack()]); },
                };
            },
        },
        DBusNodeInfo: {new_for_xml: () => ({interfaces: [{}]})},
        DBusProxy: {
            new(_connection, _flags, _info, _bus, _path, _interface, _token, callback) {
                callback(null, {});
            },
            new_finish: () => itemProxy,
        },
    };
    const GLib = {Variant: Object.assign(MockVariant, {
        is_object_path: path => /^\/(?:[A-Za-z0-9_]+\/?)*$/.test(path),
    })};
    const host = new StatusNotifierHost({Gio, GLib, onChanged: items => state.items = items});
    host.start();
    return {host, state};
}

test('StatusNotifierItem addresses accept service, service/path and sender-relative paths', () => {
    assert.deepEqual(parseStatusNotifierAddress('org.example.Tray', ':1.23'),
        {bus: 'org.example.Tray', path: '/StatusNotifierItem'});
    assert.deepEqual(parseStatusNotifierAddress('org.example.Tray/org/example/Item', ':1.23'),
        {bus: 'org.example.Tray', path: '/org/example/Item'});
    assert.deepEqual(parseStatusNotifierAddress('/org/example/Item', ':1.23'),
        {bus: ':1.23', path: '/org/example/Item'});
    assert.equal(parseStatusNotifierAddress('/org/example/Item', ''), null);
    assert.equal(parseStatusNotifierAddress('bad', 'not-a-unique-name'), null);
});

test('StatusNotifier pixmaps are converted from network-order ARGB and oversized images are ignored', () => {
    let pixbufArguments;
    const GdkPixbuf = {
        Colorspace: {RGB: 0},
        Pixbuf: {new_from_bytes: (...args) => {
            pixbufArguments = args;
            return {converted: true};
        }},
    };
    const image = createStatusNotifierPixbuf([[1, 1, [255, 12, 34, 56]]], GdkPixbuf, {
        Bytes: class { constructor(data) { this.data = data; } },
    });
    assert.deepEqual(image, {converted: true});
    assert.deepEqual([...pixbufArguments[0].data], [12, 34, 56, 255]);
    assert.equal(pixbufArguments[5], 1);
    assert.equal(createStatusNotifierPixbuf([[257, 1, new Uint8Array(1028)]], GdkPixbuf, {}), null);
});

test('StatusNotifierWatcher registers items, exposes watcher state and removes vanished items', () => {
    const {host, state} = createHost();
    const invocation = {
        get_sender: () => ':1.23',
        return_value(value) { state.reply = value.deep_unpack(); },
        return_dbus_error(name, message) { state.error = {name, message}; },
    };
    state.implementation.RegisterStatusNotifierItemAsync(['/org/example/Item'], invocation);
    assert.deepEqual(state.reply, []);
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].properties.Id, 'fixture');
    assert.deepEqual(state.signals[0], ['StatusNotifierItemRegistered', [':1.23/org/example/Item']]);
    assert.equal(state.implementation.get_property(null, null, null, null, 'ProtocolVersion').deep_unpack(), 0);
    assert.deepEqual(state.implementation.get_property(null, null, null, null,
        'RegisteredStatusNotifierItems').deep_unpack(), [':1.23/org/example/Item']);
    const watch = [...state.watches.values()][0];
    watch.vanished();
    assert.equal(state.items.length, 0);
    assert.equal(state.disposedProxies, 1);
    assert.deepEqual(state.signals.at(-1), ['StatusNotifierItemUnregistered', [':1.23/org/example/Item']]);
    host.destroy();
});

test('StatusNotifierWatcher verifies well-known item names belong to the registering client', () => {
    const {host, state} = createHost();
    const invocation = {
        get_sender: () => ':1.23',
        return_value(value) { state.reply = value.deep_unpack(); },
        return_dbus_error(name, message) { state.error = {name, message}; },
    };
    state.implementation.RegisterStatusNotifierItemAsync(['org.example.Tray/org/example/Item'], invocation);
    assert.equal(state.ownerToCheck, 'org.example.Tray');
    assert.deepEqual(state.reply, []);
    assert.equal(state.items.length, 1);
    assert.equal(STATUS_NOTIFIER_NAME, 'org.kde.StatusNotifierWatcher');
    assert.equal(STATUS_NOTIFIER_PATH, '/StatusNotifierWatcher');
    host.destroy();
});
