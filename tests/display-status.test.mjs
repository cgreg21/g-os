import assert from 'node:assert/strict';
import test from 'node:test';
import {BatteryStatusMenu, DisplayStatusMenu, SoundStatusMenu, createPowerDeviceClient} from '../dist/panel/panelStatusMenus.js';

class MockVariant {
    constructor(signature, value) {
        this.signature = signature;
        this.value = value;
    }

    deep_unpack() {
        return this.value;
    }

    get_child_value(index) {
        return this.value[index];
    }

    get_variant() {
        return this.value;
    }

    get_int32() {
        return this.value;
    }
}

class MockEmitter {
    constructor() {
        this.handlers = new Map();
        this.nextHandler = 1;
    }

    connect(signal, callback) {
        const id = this.nextHandler++;
        this.handlers.set(id, {signal, callback});
        return id;
    }

    disconnect(id) {
        this.handlers.delete(id);
    }

    emit(signal, ...args) {
        for (const handler of this.handlers.values()) {
            if (handler.signal === signal)
                handler.callback(this, ...args);
        }
    }
}

class MockSlider extends MockEmitter {
    constructor(value) {
        super();
        this._value = value;
        this.mapped = true;
    }

    get value() {
        return this._value;
    }

    set value(value) {
        this._value = value;
        this.emit('notify::value');
    }
}

function createDisplayMenu(initialBrightness = 42) {
    const state = {calls: [], settingsSignals: new Map(), unsubscribed: [], timeout: null};
    const settingsValues = {'night-light-enabled': false, 'night-light-temperature': 4500};
    const settings = {
        connect(signal, callback) {
            const id = state.settingsSignals.size + 1;
            state.settingsSignals.set(id, {signal, callback});
            return id;
        },
        disconnect(id) {
            state.settingsSignals.delete(id);
        },
        get_boolean(key) { return settingsValues[key]; },
        get_uint(key) { return settingsValues[key]; },
        set_boolean(key, value) {
            settingsValues[key] = value;
            for (const {signal, callback} of state.settingsSignals.values()) {
                if (signal === `changed::${key}`)
                    callback(this, key);
            }
        },
        set_uint(key, value) {
            settingsValues[key] = value;
            for (const {signal, callback} of state.settingsSignals.values()) {
                if (signal === `changed::${key}`)
                    callback(this, key);
            }
        },
    };
    const connection = {
        call_finish(result) {
            if (result.error)
                throw result.error;
            if (result.method === 'Get') {
                const value = new MockVariant('i', initialBrightness);
                return {get_child_value: () => ({get_variant: () => value})};
            }
            return {};
        },
    };
    const Gio = {
        Cancellable: class { cancel() { state.cancelled = true; } },
        Settings: class { constructor() { return settings; } },
        DBus: {session: {
            call(_bus, _path, _interface, method, parameters, _reply, _flags, _timeout, _cancellable, callback) {
                state.calls.push({method, parameters});
                callback(connection, {method});
            },
            signal_subscribe(_bus, _interface, _member, _path, _arg0, _flags, callback) {
                state.signalCallback = callback;
                return 7;
            },
            signal_unsubscribe(id) { state.unsubscribed.push(id); },
        }},
        DBusCallFlags: {NONE: 0},
        DBusSignalFlags: {NONE: 0},
    };
    const GLib = {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: 0,
        Variant: MockVariant,
        timeout_add(_priority, _interval, callback) {
            state.timeout = callback;
            return 9;
        },
        source_remove(id) { state.removedSource = id; },
    };
    class PopupBaseMenuItem {
        add_child() {}
    }
    class PopupMenuItem {
        constructor(label) { this.label = {text: label}; }
        add_style_class_name() {}
    }
    class PopupSwitchMenuItem extends MockEmitter {
        constructor(label, checked) {
            super();
            this.label = label;
            this.checked = checked;
        }
        setToggleState(checked) { this.checked = checked; }
    }
    const menu = {
        items: [],
        addMenuItem(item) { this.items.push(item); },
        addAction(label, callback) {
            const action = {label, callback};
            this.items.push(action);
            return action;
        },
    };
    const St = {Icon: class { constructor(properties) { Object.assign(this, properties); } }};
    const Slider = {Slider: MockSlider};
    const PopupMenu = {PopupBaseMenuItem, PopupMenuItem, PopupSwitchMenuItem,
        PopupSeparatorMenuItem: class {}};
    const controller = new DisplayStatusMenu(menu, {icon_name: ''},
        {Gio, GLib, St, Slider, PopupMenu, Clutter: {ActorAlign: {CENTER: 0}}, openSettings() {}});
    return {controller, state, settingsValues};
}

test('display controls read and write screen brightness and night-light settings', () => {
    const {controller, state, settingsValues} = createDisplayMenu();
    assert.equal(controller.brightnessSlider.value, 0.42);
    assert.equal(controller.brightnessInfo.label.text, 'Luminosité : 42 %');
    assert.equal(controller.temperatureSlider.value, 3500 / 9000);

    controller.temperatureSlider.value = 0.5;
    assert.equal(settingsValues['night-light-temperature'], 5500);
    controller.nightLightToggle.emit('toggled', true);
    assert.equal(settingsValues['night-light-enabled'], true);

    controller.brightnessSlider.value = 0.75;
    assert.equal(controller.brightnessInfo.label.text, 'Luminosité : 75 %');
    assert.equal(state.timeout(), 0);
    const setCall = state.calls.find(call => call.method === 'Set');
    assert.ok(setCall);
    const [, property, value] = setCall.parameters.deep_unpack();
    assert.equal(property, 'Brightness');
    assert.equal(value.value, 75);

    state.signalCallback(null, null, null, null, null,
        new MockVariant('(sa{sv}as)', ['org.gnome.SettingsDaemon.Power.Screen',
            {Brightness: new MockVariant('i', 80)}, []]));
    assert.equal(controller.brightnessSlider.value, 0.8);
    assert.equal(controller.brightnessInfo.label.text, 'Luminosité : 80 %');

    controller.destroy();
    assert.deepEqual(state.unsubscribed, [7]);
    assert.equal(state.cancelled, true);

    state.signalCallback(null, null, null, null, null,
        new MockVariant('(sa{sv}as)', ['org.gnome.SettingsDaemon.Power.Screen',
            {Brightness: new MockVariant('i', 90)}, []]));
    assert.equal(controller.brightness, 80);
    assert.equal(controller.brightnessInfo.label.text, 'Luminosité : 80 %');
});

test('brightness controls report unsupported hardware instead of accepting adjustments', () => {
    const {controller} = createDisplayMenu(Number.NaN);
    assert.equal(controller.brightnessSlider.reactive, false);
    assert.equal(controller.brightnessInfo.label.text, 'Réglage de luminosité indisponible');
    controller.brightnessSlider.value = 0.8;
    assert.equal(controller.brightness, null);
    controller.destroy();
});

test('sound slider reaches amplified volume only while the system allows it', () => {
    let amplificationEnabled = false;
    const soundSettings = new MockEmitter();
    soundSettings.get_boolean = () => amplificationEnabled;
    soundSettings.setAmplification = enabled => {
        amplificationEnabled = enabled;
        soundSettings.emit('changed::allow-volume-above-100-percent');
    };
    const stream = new MockEmitter();
    Object.assign(stream, {
        volume: 100,
        is_muted: false,
        set_volume(value) { this.volume = value; },
        push_volume() {},
        change_is_muted(value) { this.is_muted = value; },
    });
    const control = new MockEmitter();
    Object.assign(control, {
        get_default_sink: () => stream,
        get_vol_max_norm: () => 100,
        get_vol_max_amplified: () => 150,
        get_sinks: () => [],
        lookup_device_from_stream: () => null,
    });
    const menu = new MockEmitter();
    Object.assign(menu, {
        items: [],
        addMenuItem(item) { this.items.push(item); },
        addAction(label) { return {label, setSensitive() {}}; },
    });
    class PopupBaseMenuItem {
        constructor() { this.children = []; }
        add_child(child) { this.children.push(child); }
    }
    class PopupMenuItem {
        constructor(label) { this.label = {text: label}; }
        add_style_class_name() {}
    }
    class PopupMenuSection {
        constructor() { this.actor = {get_children: () => []}; }
        removeAll() {}
        addAction(label) { return {label, setSensitive() {}}; }
    }
    class Button extends MockEmitter {
        remove_style_pseudo_class() {}
        add_style_pseudo_class() {}
    }
    const settings = {Settings: class { constructor() { return soundSettings; }}};
    const slider = {Slider: MockSlider};
    const St = {
        Icon: class { constructor(properties) { Object.assign(this, properties); } },
        Label: class { constructor(properties) { Object.assign(this, properties); } },
        Button,
    };
    const PopupMenu = {PopupBaseMenuItem, PopupMenuItem, PopupMenuSection,
        PopupSeparatorMenuItem: class {}, Ornament: {DOT: 1, NONE: 0}};
    const Clutter = {ActorAlign: {CENTER: 0}, ScrollDirection: {UP: 1, DOWN: 2},
        EVENT_STOP: -1};
    const controller = new SoundStatusMenu(menu, {icon_name: ''},
        {control, Gio: settings, St, Slider: slider, PopupMenu, Clutter, openSettings() {}});

    assert.equal(controller.slider.value, 1);
    assert.ok(menu.items[0].children.includes(controller.percentage));
    soundSettings.setAmplification(true);
    assert.equal(controller.slider.value, 100 / 150);
    controller.slider.value = 1;
    assert.equal(stream.volume, 150);
    assert.match(controller.percentage.text, /^150 %/);
    controller.adjustVolume(Clutter.ScrollDirection.DOWN);
    assert.equal(stream.volume, 145);
    soundSettings.setAmplification(false);
    assert.equal(stream.volume, 100);
    assert.equal(controller.slider.value, 1);

    controller.destroy();
});

test('UPower client ignores queued device events after disposal', () => {
    const root = new MockEmitter();
    let rootSignal;
    let disposed = false;
    let proxyCreations = 0;
    root.call_sync = () => ({deep_unpack: () => [[]]});
    root.run_dispose = () => { disposed = true; };
    const Gio = {
        BusType: {SYSTEM: 0},
        DBusProxyFlags: {NONE: 0},
        DBusCallFlags: {NONE: 0},
        DBusProxy: {
            new_for_bus_sync(_bus, _flags, _info, _name, path) {
                proxyCreations++;
                assert.equal(path, '/org/freedesktop/UPower');
                return root;
            },
        },
    };
    const originalConnect = root.connect.bind(root);
    root.connect = (signal, callback) => {
        if (signal === 'g-signal')
            rootSignal = callback;
        return originalConnect(signal, callback);
    };
    const client = createPowerDeviceClient(Gio);
    client.dispose();
    rootSignal(root, null, 'DeviceAdded', new MockVariant('(o)', ['/org/freedesktop/UPower/devices/battery_BAT0']));
    assert.equal(disposed, true);
    assert.equal(proxyCreations, 1);
    assert.deepEqual(client.get_devices2(), []);
});

test('destroyed battery menus ignore late refreshes and device synchronization', () => {
    const controller = Object.create(BatteryStatusMenu.prototype);
    controller.destroyed = true;
    assert.equal(controller.refresh(), undefined);
    assert.deepEqual(controller.syncDevices(), []);
});

test('battery percentage is shown in the panel only when enabled and a level is available', () => {
    const controller = Object.create(BatteryStatusMenu.prototype);
    const levelLabel = {text: '', visible: false};
    Object.assign(controller, {
        levelLabel,
        showLevel: true,
        proxy: {IsPresent: true, IconName: 'battery-good-symbolic', Percentage: 73, State: 2,
            TimeToEmpty: 3600, TimeToFull: 0},
        icon: {},
        percentage: {visible: false, label: {text: ''}},
        state: {visible: false, label: {text: ''}},
        deviceHeading: {visible: false},
        syncDevices: () => [],
    });

    controller.refresh();
    assert.equal(levelLabel.text, '73%');
    assert.equal(levelLabel.visible, true);

    controller.showLevel = false;
    controller.refresh();
    assert.equal(levelLabel.visible, false);

    controller.showLevel = true;
    controller.proxy.IsPresent = false;
    controller.refresh();
    assert.equal(levelLabel.text, '');
    assert.equal(levelLabel.visible, false);
});
