import assert from 'node:assert/strict';
import test from 'node:test';
import {decodeDbusMenuLayout, DbusMenuClient, MenuSignals} from '../dist/panel/dbusMenu.js';
import {DbusMenuRegistrar} from '../dist/panel/menuRegistrar.js';

function createRegistrar() {
    const Meta = {WindowClientType: {X11: 1, WAYLAND: 2}};
    const Gio = {
        Cancellable: class { cancel() {} },
        dbus_is_name: name => /^:[0-9]+\.[0-9]+$/.test(name),
    };
    const GLib = {Variant: Object.assign(MockVariant, {
        is_object_path: path => /^\/(?:[A-Za-z0-9_]+\/?)*$/.test(path),
    })};
    return {registrar: new DbusMenuRegistrar({Gio, GLib, Meta}), Meta};
}

class MockVariant {
    constructor(signature, value) { this.signature = signature; this.value = value; }
    deep_unpack() { return this.value; }
    get_type_string() { return this.signature; }
}

function createLifecycleRegistrar(externalEntries = [], options = {}) {
    const state = {externalEntries};
    const session = {
        signal_subscribe(...args) { state.nameOwnerChanged = args.at(-1); return 11; },
        signal_unsubscribe(id) { state.unsubscribed = id; },
        call(...args) { state.nameOwnerCheck = args.at(-1); },
        call_finish() {
            if (state.ownerExists)
                return true;
            throw new Error('Name has no owner');
        },
    };
    const external = {
        connect(_signal, callback) { state.externalSignal = callback; return 13; },
        disconnect(id) { state.externalDisconnected = id; },
        call(method, ...args) {
            const complete = () => args.at(-1)(this, {method});
            if (method === 'GetMenus' && options.deferMenus)
                state.menuReply = complete;
            else
                complete();
        },
        call_finish(result) {
            if (options.failGetMenus && result.method === 'GetMenus')
                throw new Error('GetMenus failed');
            if (result.method === 'GetMenus')
                return new MockVariant('(a(uso))', [state.externalEntries]);
            return new MockVariant('()', []);
        },
    };
    const Gio = {
        Cancellable: class { cancel() { this.cancelled = true; } },
        DBus: {session},
        DBusSignalFlags: {NONE: 0},
        DBusCallFlags: {NONE: 0},
        BusNameOwnerFlags: {NONE: 0},
        DBusProxyFlags: {DO_NOT_LOAD_PROPERTIES: 0},
        dbus_is_name: name => /^:[0-9]+\.[0-9]+$/.test(name),
        bus_own_name_on_connection(_connection, _name, _flags, acquired, lost) {
            state.ownerAcquired = acquired;
            state.ownerLost = lost;
            acquired();
            return 17;
        },
        bus_unown_name(id) { state.unowned = id; },
        DBusExportedObject: {
            wrapJSObject(_xml, implementation) {
                state.implementation = implementation;
                return {
                    export() { state.exported = true; },
                    unexport() { state.exported = false; },
                    emit_signal(name, parameters) { state.emitted.push([name, parameters]); },
                };
            },
        },
        DBusNodeInfo: {new_for_xml: () => ({interfaces: [{}]})},
        DBusProxy: {
            new: (...args) => {
                if (options.deferProxy)
                    state.proxyResult = args.at(-1);
                else
                    args.at(-1)(null, {});
            },
            new_finish: () => {
                if (options.failProxy)
                    throw new Error('Proxy failed');
                return external;
            },
        },
    };
    state.external = external;
    state.emitted = [];
    state.externalEntries = externalEntries;
    state.ownerExists = false;
    state.session = session;
    const GLib = {
        Variant: Object.assign(MockVariant, {
            is_object_path: path => /^\/(?:[A-Za-z0-9_]+\/?)*$/.test(path),
        }),
    };
    return {registrar: new DbusMenuRegistrar({Gio, GLib, Meta: {WindowClientType: {X11: 1}}}), state};
}

function createMenuClient(layout, {deferCalls = false, proxyCreationError = null} = {}) {
    const calls = [];
    const pending = [];
    const proxy = {
        replies: new Map(),
        failMethods: new Set(),
        call(method, parameters, _flags, _timeout, _token, callback) {
            calls.push({method, parameters});
            const result = {method};
            const complete = () => callback(this, result);
            if (deferCalls)
                pending.push(complete);
            else
                complete();
        },
        call_finish(result) {
            if (result.error || this.failMethods.has(result.method))
                throw result.error ?? new Error(`${result.method} failed`);
            return this.replies.get(result.method);
        },
        connect(_signal, callback) { this.signalCallback = callback; return 7; },
        disconnect(id) { this.disconnected = id; },
    };
    const Gio = {
        Cancellable: class { cancel() { this.cancelled = true; } },
        DBus: {session: {}},
        DBusProxyFlags: {DO_NOT_LOAD_PROPERTIES: 1},
        DBusCallFlags: {NONE: 0},
        DBusNodeInfo: {new_for_xml: () => ({interfaces: [{}]})},
        DBusProxy: {
            new: (...args) => args.at(-1)(null, {}),
            new_finish: () => {
                if (proxyCreationError)
                    throw proxyCreationError;
                return proxy;
            },
        },
    };
    const GLib = {Variant: MockVariant};
    const layoutReply = value => ({
        get_type_string: () => '(u(ia{sv}av))',
        deep_unpack: () => [1, value],
    });
    proxy.replies.set('GetLayout', layoutReply(layout));
    proxy.replies.set('AboutToShow', new MockVariant('(b)', [true]));
    proxy.replies.set('Event', new MockVariant('()', []));
    const client = new DbusMenuClient(':1.10', '/org/example/Menu', {
        Gio, GLib, timestamp: () => 0x100000001,
    });
    return {client, proxy, calls, pending, layoutReply};
}

function fullMenuLayout() {
    return [0, {}, [
        [1, {label: '_Open & &&', shortcut: [['CTRL', 'O']]}, []],
        [2, {label: 'Hidden', visible: false}, []],
        [3, {'children-display': 'submenu'}, [
            [4, {label: 'Recent'}, []],
        ]],
        [5, {'toggle-type': 'checkmark', 'toggle-state': 1}, []],
        [6, {'toggle-type': 'radio', 'toggle-state': 0}, []],
        [7, {type: 'separator'}, []],
        [8, {enabled: false}, []],
        [9, {'children-display': 'submenu'}, []],
    ]];
}

test('DBusMenu layouts unpack properties and build a node index', () => {
    const wrapped = value => ({deep_unpack: () => value});
    const layout = [0, {label: wrapped('Applications')}, [
        [1, {label: wrapped('Open'), enabled: wrapped(true)}, []],
        [2, {type: wrapped('submenu')}, [
            [3, {label: wrapped('Recent')}, []],
        ]],
    ]];
    const decoded = decodeDbusMenuLayout(layout);
    assert.equal(decoded.root.properties.label, 'Applications');
    assert.deepEqual(decoded.root.children.map(node => node.id), [1, 2]);
    assert.equal(decoded.nodes.get(3).properties.label, 'Recent');
    assert.equal(decoded.nodes.size, 4);
});

test('DBusMenu decoder rejects duplicate ids, malformed tuples and excessive nesting', () => {
    assert.throws(() => decodeDbusMenuLayout([0, {}, [
        [1, {}, []],
        [1, {}, []],
    ]]));
    assert.throws(() => decodeDbusMenuLayout([0, {}, [[1, {}, 'not-children']]]));
    let nested = [0, {}, []];
    for (let id = 1; id <= 10; id++)
        nested = [id, {}, [nested]];
    assert.throws(() => decodeDbusMenuLayout(nested));
});

test('DBusMenu signal connections can be removed while dispatching', () => {
    const emitter = new MenuSignals();
    const received = [];
    const second = emitter.connect('changed', (_source, value) => received.push(`second:${value}`));
    emitter.connect('changed', (_source, value) => {
        received.push(`first:${value}`);
        emitter.disconnect(second);
    });
    emitter.emit('changed', 7);
    emitter.emit('changed', 8);
    assert.deepEqual(received, ['second:7', 'first:7', 'first:8']);
});

test('AppMenu registrations associate X11 window ids but never guess Wayland windows', () => {
    const {registrar, Meta} = createRegistrar();
    registrar.register(42, ':1.42', '/org/example/Menu');
    const x11Window = {get_client_type: () => Meta.WindowClientType.X11, get_xwindow: () => 42};
    const waylandWindow = {get_client_type: () => Meta.WindowClientType.WAYLAND, get_xwindow: () => 42};

    assert.deepEqual(registrar.getForWindow(x11Window), {
        windowId: 42, bus: ':1.42', path: '/org/example/Menu',
    });
    assert.equal(registrar.getForWindow(waylandWindow), null);
});

test('AppMenu registrations validate entries and prevent another client taking a window id', () => {
    const {registrar} = createRegistrar();
    registrar.register(42, ':1.42', '/org/example/Menu');

    assert.throws(() => registrar.register(0, ':1.42', '/org/example/Menu'));
    assert.throws(() => registrar.register(43, 'not-a-bus-name', '/org/example/Menu'));
    assert.throws(() => registrar.register(43, ':1.43', 'not-an-object-path'));
    assert.throws(() => registrar.register(42, ':1.43', '/org/other/Menu'));
    assert.throws(() => registrar.unregister(42, ':1.43'));

    registrar.unregister(42, ':1.42');
    assert.equal(registrar.entries.size, 0);
});

test('DBusMenu client builds a filtered model, attributes, submenu links and enabled actions', () => {
    const {client, proxy, calls} = createMenuClient(fullMenuLayout());
    const {model, actions} = client;

    assert.equal(model.get_n_items(), 7);
    assert.equal(model.get_item_attribute_value(0, 'label').value, '__Open  &');
    assert.equal(model.get_item_attribute_value(0, 'action').value, 'dbus.1');
    assert.equal(model.get_item_attribute_value(0, 'accel').value, 'CTRL+O');
    assert.equal(model.get_item_attribute_value(3, 'label').value, '');
    assert.equal(model.get_item_attribute_value(3, 'accel').value, '');
    assert.equal(model.get_item_attribute_value(0, 'x-dbusmenu-enabled').value, true);
    assert.equal(model.get_item_attribute_value(5, 'x-dbusmenu-enabled').value, false);
    assert.equal(model.get_item_attribute_value(6, 'x-dbusmenu-enabled').value, true);
    assert.equal(model.get_item_attribute_value(0, 'not-an-attribute'), null);
    assert.equal(model.get_item_link(0, 'submenu'), null);
    assert.equal(model.get_item_link(1, 'submenu').id, 3);
    assert.equal(model.get_item_link(6, 'submenu').id, 9);
    assert.equal(actions.has_action('1'), true);
    assert.equal(actions.has_action('not-an-id'), false);
    assert.equal(actions.get_action_enabled('1'), true);
    assert.equal(actions.get_action_enabled('2'), false);
    assert.equal(actions.get_action_enabled('3'), false);
    assert.equal(actions.get_action_enabled('7'), false);
    assert.equal(actions.get_action_enabled('8'), false);
    assert.equal(actions.get_action_state('5').value, true);
    assert.equal(actions.get_action_state('6').value, false);
    assert.equal(actions.get_action_state('1'), null);
    assert.equal(actions.get_action_parameter_type(), null);

    const changed = [];
    model.connect('items-changed', () => changed.push('changed'));
    client._apply(fullMenuLayout());
    assert.deepEqual(changed, []);
    model.get_item_link(1, 'submenu').aboutToShow();
    actions.activate_action('1');
    actions.activate_action('2');
    const callsBeforeFalseUpdate = calls.length;
    proxy.replies.set('AboutToShow', new MockVariant('(b)', [false]));
    client.aboutToShow(3);
    assert.equal(calls.length, callsBeforeFalseUpdate + 1);
    proxy.failMethods.add('AboutToShow');
    assert.doesNotThrow(() => client.aboutToShow(3));
    proxy.failMethods.add('Event');
    assert.doesNotThrow(() => actions.activate_action('1'));
    assert.deepEqual(calls.map(call => call.method), [
        'GetLayout', 'AboutToShow', 'GetLayout', 'Event',
        'AboutToShow', 'AboutToShow', 'Event',
    ]);
    const eventArgs = calls.at(-1).parameters.value;
    assert.deepEqual(eventArgs.slice(0, 2), [1, 'clicked']);
    assert.equal(eventArgs[2].signature, 'i');
    assert.equal(eventArgs[2].value, 0);
    assert.equal(eventArgs[3], 1);
});

test('DBusMenu client releases obsolete submenu model listeners after layout replacement', () => {
    const {client} = createMenuClient(fullMenuLayout());
    const previousSubmenu = client.model.get_item_link(1, 'submenu');
    previousSubmenu.connect('items-changed', () => {});
    assert.equal(previousSubmenu.signals.size, 1);

    const updated = fullMenuLayout();
    updated[2][3][1].label = 'Updated recent item';
    client._apply(updated);

    assert.equal(previousSubmenu.signals.size, 0);
    assert.notEqual(client.model.get_item_link(1, 'submenu'), previousSubmenu);
    client.destroy();
});

test('DBusMenu client refreshes on signals, reports malformed layouts and recovers', () => {
    const {client, proxy, calls, layoutReply} = createMenuClient(fullMenuLayout());
    let changes = 0;
    client.model.connect('items-changed', () => changes++);
    proxy.signalCallback(proxy, ':1.10', 'LayoutUpdated');
    assert.equal(changes, 0);

    proxy.replies.set('GetLayout', {
        get_type_string: () => '(s)',
        deep_unpack: () => ['invalid'],
    });
    proxy.signalCallback(proxy, ':1.10', 'ItemsPropertiesUpdated');
    assert.match(client.error, /Unexpected DBusMenu GetLayout reply/);
    assert.equal(client.nodes.size, 0);
    assert.equal(client.model.get_n_items(), 0);
    assert.equal(changes, 1);

    proxy.replies.set('GetLayout', layoutReply(fullMenuLayout()));
    client.refresh();
    assert.equal(client.error, null);
    assert.equal(client.model.get_n_items(), 7);
    assert.equal(changes, 2);
    assert.equal(calls.length, 4);
});

test('DBusMenu client coalesces refreshes and ignores queued replies after destruction', () => {
    const {client, pending, calls} = createMenuClient(fullMenuLayout(), {deferCalls: true});
    assert.equal(client.pending, true);
    client.refresh();
    assert.equal(client.dirty, true);
    pending.shift()();
    assert.equal(calls.length, 2);
    assert.equal(client.pending, true);
    pending.shift()();
    assert.equal(client.pending, false);
    assert.equal(client.dirty, false);
    assert.equal(client.model.get_n_items(), 7);

    client.refresh();
    assert.equal(pending.length, 1);
    client.destroy();
    pending.shift()();
    assert.equal(client.disposed, true);
    assert.equal(client.nodes.size, 0);
    assert.equal(client.model.get_n_items(), 0);
    assert.equal(client.proxy, null);
});

test('DBusMenu client preserves proxy initialization errors and safely refreshes after disposal', () => {
    const {client, calls} = createMenuClient(fullMenuLayout(), {
        proxyCreationError: new Error('Proxy unavailable'),
    });
    assert.match(client.error, /Proxy unavailable/);
    client.refresh();
    assert.equal(calls.length, 0);
    client.destroy();
    client.destroy();
    client.refresh();
    client.aboutToShow(1);
    client.event(1);
    assert.equal(calls.length, 0);
});

test('DBusMenu client ignores requests after disposal even if its proxy remains attached', () => {
    const {client, calls} = createMenuClient(fullMenuLayout());
    const previousCalls = calls.length;
    client.disposed = true;
    client.refresh();
    client.aboutToShow(1);
    client.event(1);
    client.destroy();
    assert.equal(calls.length, previousCalls);
});

test('AppMenu D-Bus methods return menus or precise registration errors', () => {
    const {registrar} = createRegistrar();
    const implementation = registrar._implementation();
    const invocation = sender => ({
        sender,
        return_value(value) { this.value = value; },
        return_dbus_error(name, message) { this.error = {name, message}; },
        get_sender() { return this.sender; },
    });

    const registered = invocation(':1.42');
    implementation.RegisterWindowAsync([42, '/org/example/Menu'], registered);
    assert.equal(registered.value.signature, '()');
    const menu = invocation(':1.42');
    implementation.GetMenuForWindowAsync([42], menu);
    assert.deepEqual(menu.value.value, [':1.42', '/org/example/Menu']);
    const menus = invocation(':1.42');
    implementation.GetMenusAsync([], menus);
    assert.deepEqual(menus.value.value, [[[42, ':1.42', '/org/example/Menu']]]);
    const missing = invocation(':1.42');
    implementation.GetMenuForWindowAsync([99], missing);
    assert.match(missing.error.name, /NotFound/);
    const denied = invocation(':1.43');
    implementation.UnregisterWindowAsync([42], denied);
    assert.match(denied.error.name, /InvalidRegistration/);
    const removed = invocation(':1.42');
    implementation.UnregisterWindowAsync([42], removed);
    assert.equal(removed.value.signature, '()');
});

test('AppMenu window id resolution handles X11 descriptions and invalid ids', () => {
    const {registrar, Meta} = createRegistrar();
    registrar.register(2748, ':1.42', '/org/example/Menu');
    const fallback = {
        get_client_type: () => Meta.WindowClientType.X11,
        get_xwindow: () => 0,
        get_description: () => '0xabc Example Window',
    };
    assert.equal(registrar.windowId(fallback), 2748);
    assert.deepEqual(registrar.getForWindow(fallback), {
        windowId: 2748, bus: ':1.42', path: '/org/example/Menu',
    });
    assert.equal(registrar.windowId({...fallback, get_description: () => 'Example Window'}), null);
    assert.equal(registrar.windowId({...fallback, get_description: () => '0x100000000'}), null);
    assert.equal(registrar.windowId({get_client_type: () => Meta.WindowClientType.X11}), null);
    assert.equal(registrar.windowId({...fallback, get_xwindow: () => 0xffffffff}), 0xffffffff);
    assert.equal(registrar.windowId({...fallback, get_client_type: () => Meta.WindowClientType.WAYLAND}), null);
});

test('AppMenu registrar owns its name, follows an external registrar and cleans up', () => {
    const {registrar, state} = createLifecycleRegistrar([
        [100, ':1.100', '/org/other/Menu'],
    ]);
    registrar.start();
    registrar.start();
    assert.equal(registrar.subscription, 11);
    state.nameOwnerCheck(state.session, {});
    assert.equal(registrar.ownsName, true);
    assert.equal(state.exported, true);
    const ownInvocation = {
        sender: ':1.42',
        get_sender() { return this.sender; },
        return_value(value) { this.value = value; },
        return_dbus_error(_name, message) { this.error = message; },
    };
    state.implementation.RegisterWindowAsync([42, '/org/example/Menu'], ownInvocation);
    assert.equal(state.emitted[0][0], 'WindowRegistered');
    state.implementation.UnregisterWindowAsync([42], ownInvocation);
    assert.equal(state.emitted[1][0], 'WindowUnregistered');

    state.ownerLost();
    assert.equal(registrar.ownsName, false);
    assert.equal(state.exported, false);
    assert.deepEqual([...registrar.entries.keys()], [100]);
    state.externalSignal(null, ':1.100', 'WindowRegistered',
        new MockVariant('(uso)', [101, ':1.101', '/org/another/Menu']));
    assert.equal(registrar.entries.has(101), true);
    state.externalSignal(null, ':1.100', 'WindowRegistered',
        new MockVariant('(uso)', [0, 'not-a-bus', 'not-a-path']));
    assert.equal(registrar.entries.has(0), false);
    state.externalSignal(null, ':1.100', 'WindowUnregistered',
        new MockVariant('(u)', [101]));
    assert.equal(registrar.entries.has(101), false);

    state.nameOwnerChanged(null, null, null, null, null, new MockVariant('(sss)',
        [':1.100', ':1.100', '']));
    assert.equal(registrar.entries.has(100), false);
    state.nameOwnerChanged(null, null, null, null, null, new MockVariant('(sss)',
        [':1.100', '', ':1.100']));
    assert.equal(registrar.entries.has(100), false);

    registrar.destroy();
    registrar.destroy();
    assert.equal(state.externalDisconnected, 13);
    assert.equal(state.unsubscribed, 11);
    assert.equal(state.unowned, 17);
    assert.equal(registrar.disposed, true);
});

test('AppMenu registrar follows name-owner changes from an external owner to local ownership', () => {
    const {registrar, state} = createLifecycleRegistrar([
        [100, ':1.100', '/org/other/Menu'],
    ]);
    state.ownerExists = true;
    registrar.start();
    state.nameOwnerCheck(state.session, {});
    assert.equal(registrar.ownsName, false);
    assert.deepEqual([...registrar.entries.keys()], [100]);

    state.nameOwnerChanged(null, null, null, null, null, new MockVariant('(sss)',
        ['com.canonical.AppMenu.Registrar', '', ':1.200']));
    assert.deepEqual([...registrar.entries.keys()], [100]);
    assert.equal(state.externalDisconnected, 13);

    state.nameOwnerChanged(null, null, null, null, null, new MockVariant('(sss)',
        ['com.canonical.AppMenu.Registrar', ':1.200', '']));
    assert.equal(registrar.ownsName, true);
    assert.equal(state.exported, true);
    assert.equal(registrar.entries.size, 0);
    registrar._own();
    registrar.destroy();
    state.ownerAcquired();
    state.ownerLost();
});

test('AppMenu registrations cover duplicate, replacement, absent and capacity paths', () => {
    const {registrar} = createRegistrar();
    registrar.register(1, ':1.1', '/org/example/One');
    registrar.register(1, ':1.1', '/org/example/One');
    registrar.register(1, ':1.1', '/org/example/Updated');
    assert.equal(registrar.entries.get(1).path, '/org/example/Updated');
    registrar.unregister(999, ':1.1');
    for (let id = 2; id <= 512; id++)
        registrar.register(id, ':1.1', '/org/example/Menu');
    assert.equal(registrar.entries.size, 512);
    assert.throws(() => registrar.register(513, ':1.1', '/org/example/Menu'));
    registrar.destroy();
    assert.throws(() => registrar.register(1, ':1.1', '/org/example/Menu'));
});

test('AppMenu external proxy callbacks are safe when unavailable or disposed', () => {
    const failingProxy = createLifecycleRegistrar([], {failProxy: true});
    failingProxy.registrar._followExternal();
    assert.equal(failingProxy.registrar.external, null);

    const failingMenus = createLifecycleRegistrar([], {failGetMenus: true});
    failingMenus.registrar._followExternal();
    assert.equal(failingMenus.registrar.external, failingMenus.state.external);
    failingMenus.registrar.destroy();

    const deferredProxy = createLifecycleRegistrar([], {deferProxy: true});
    deferredProxy.registrar._followExternal();
    deferredProxy.registrar.destroy();
    deferredProxy.state.proxyResult(null, {});

    const deferredMenus = createLifecycleRegistrar([], {deferMenus: true});
    deferredMenus.registrar._followExternal();
    deferredMenus.registrar.destroy();
    deferredMenus.state.menuReply();
});
