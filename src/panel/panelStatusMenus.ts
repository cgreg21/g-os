import {CleanupManager} from '../core/cleanupManager.js';

function getActorParent(actor) {
    try {
        return actor?.get_parent?.() ?? null;
    } catch {
        return null;
    }
}

function removeActorFromParent(actor, parent = getActorParent(actor)) {
    if (!actor || !parent || getActorParent(actor) !== parent)
        return false;
    try {
        parent.remove_child(actor);
        return true;
    } catch {
        return false;
    }
}

export function alignMenuRows(actor, Clutter) {
    if (!actor)
        return;
    if (['popup-menu-item', 'bt-device-item', 'nm-network-item'].some(name => actor.has_style_class_name?.(name))) {
        for (const child of actor.get_children())
            child.y_align = Clutter.ActorAlign.CENTER;
    }
    for (const child of actor.get_children?.() ?? [])
        alignMenuRows(child, Clutter);
}

export class SoundStatusMenu {
    [key: string]: any;
    constructor(menu, icon, {control, Gio, St, Slider, PopupMenu, Clutter, openSettings}) {
        this.menu = menu;
        this.icon = icon;
        this.control = control;
        this.destroyed = false;
        this.Clutter = Clutter;
        this.PopupMenu = PopupMenu;
        this.St = St;
        this.soundSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.sound'});
        this.cleanup = new CleanupManager();
        this.streamCleanup = new CleanupManager();
        const row = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.muteIcon = new St.Icon({icon_name: 'audio-volume-high-symbolic', icon_size: 20});
        this.muteButton = new St.Button({child: this.muteIcon, can_focus: true, reactive: true, track_hover: true,
            style_class: 'g-os-sound-mute', accessible_name: 'Couper le son'});
        this.cleanup.addSignal(this.muteButton, this.muteButton.connect('clicked', () => this.toggleMute()));
        this.slider = new Slider.Slider(0);
        this.muteButton.y_align = Clutter.ActorAlign.CENTER;
        this.slider.y_align = Clutter.ActorAlign.CENTER;
        this.slider.width = 200;
        this.slider.accessible_name = 'Volume de sortie';
        this.cleanup.addSignal(this.slider,
            this.slider.connect('notify::value', () => this.changeVolume()));
        this.percentage = new St.Label({text: 'Volume indisponible', style_class: 'g-os-status-info'});
        this.percentage.y_align = Clutter.ActorAlign.CENTER;
        row.add_child(this.muteButton);
        row.add_child(this.slider);
        row.add_child(this.percentage);
        menu.addMenuItem(row);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Sortie audio'));
        this.devices = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'g-os-status-device-grid'});
        const devicesItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        devicesItem.add_child(this.devices);
        menu.addMenuItem(devicesItem);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Parametres du son', openSettings);
        this.cleanup.addSignal(menu, menu.connect('open-state-changed', (actor, open) => {
            if (this.destroyed)
                return;
            if (open)
                this.syncOutput();
        }));
        for (const signal of ['state-changed', 'default-sink-changed', 'stream-added', 'stream-removed', 'output-added', 'output-removed'])
            this.cleanup.addSignal(control, control.connect(signal, () => this.syncOutput()));
        this.cleanup.addSignal(this.soundSettings, this.soundSettings.connect(
            'changed::allow-volume-above-100-percent', () => this._syncAmplification()));
        this.syncOutput();
    }

    syncOutput() {
        if (this.destroyed)
            return;
        const stream = this.control.get_default_sink();
        if (stream !== this.stream) {
            this.streamCleanup.clear();
            this.stream = stream;
            if (stream) {
                for (const signal of ['notify::volume', 'notify::is-muted'])
                    this.streamCleanup.addSignal(stream, stream.connect(signal, () => this.refresh()));
            }
        }
        this.refresh();
        this.refreshDevices();
    }

    refresh() {
        if (this.destroyed)
            return;
        const normalMaximum = this.control.get_vol_max_norm() || 1;
        const maximum = this._maximumVolume();
        const level = this.stream ? Math.max(0, this.stream.volume / normalMaximum) : 0;
        const volume = this.stream ? Math.max(0, Math.min(1, this.stream.volume / maximum)) : 0;
        const muted = !this.stream || this.stream.is_muted || volume === 0;
        this.syncing = true;
        this.slider.value = volume;
        this.syncing = false;
        this.slider.reactive = Boolean(this.stream);
        this.slider.can_focus = Boolean(this.stream);
        this.muteButton.reactive = Boolean(this.stream);
        this.muteButton.can_focus = Boolean(this.stream);
        if (this.stream)
            this.muteButton.remove_style_pseudo_class('insensitive');
        else
            this.muteButton.add_style_pseudo_class('insensitive');
        const icon = muted ? 'audio-volume-muted-symbolic' : volume < 0.34 ? 'audio-volume-low-symbolic'
            : volume < 0.67 ? 'audio-volume-medium-symbolic' : 'audio-volume-high-symbolic';
        this.icon.icon_name = icon;
        this.muteIcon.icon_name = icon;
        this.muteButton.accessible_name = muted ? 'Activer le son' : 'Couper le son';
        this.percentage.text = this.stream ? `${Math.round(level * 100)} %${muted ? ' - Muet' : ''}` : 'Aucune sortie audio';
    }

    changeVolume() {
        if (this.destroyed || this.syncing || !this.stream)
            return;
        const volume = Math.round(Math.max(0, Math.min(1, this.slider.value)) * this._maximumVolume());
        this.stream.set_volume(volume);
        this.stream.push_volume();
        this.stream.change_is_muted(volume === 0);
        this.refresh();
    }

    _maximumVolume() {
        const normal = this.control.get_vol_max_norm() || 1;
        if (!this.soundSettings.get_boolean('allow-volume-above-100-percent'))
            return normal;
        return Math.max(normal, this.control.get_vol_max_amplified() || normal);
    }

    _syncAmplification() {
        if (this.destroyed)
            return;
        const normal = this.control.get_vol_max_norm() || 1;
        if (!this.soundSettings.get_boolean('allow-volume-above-100-percent') &&
            this.stream && this.stream.volume > normal) {
            this.stream.set_volume(normal);
            this.stream.push_volume();
        }
        this.refresh();
    }

    adjustVolume(direction) {
        if (this.destroyed || !this.stream)
            return this.Clutter.EVENT_STOP;
        const change = direction === this.Clutter.ScrollDirection.UP ? 1
            : direction === this.Clutter.ScrollDirection.DOWN ? -1 : 0;
        if (change === 0)
            return this.Clutter.EVENT_STOP;
        const maximum = this._maximumVolume();
        const step = 0.05 * (this.control.get_vol_max_norm() || 1) / maximum;
        const current = Math.max(0, Math.min(1, this.stream.volume / maximum));
        this.syncing = true;
        this.slider.value = Math.max(0, Math.min(1, current + change * step));
        this.syncing = false;
        this.changeVolume();
        return this.Clutter.EVENT_STOP;
    }

    toggleMute() {
        if (this.destroyed || !this.stream)
            return;
        const muted = this.stream.is_muted || this.stream.volume === 0;
        if (muted && this.stream.volume === 0) {
            this.stream.set_volume(Math.round(this.control.get_vol_max_norm() * 0.25));
            this.stream.push_volume();
        }
        this.stream.change_is_muted(!muted);
        this.refresh();
    }

    refreshDevices() {
        if (this.destroyed)
            return;
        this.devices.destroy_all_children();
        const available = this.control.get_sinks().map(stream => ({
            stream, device: this.control.lookup_device_from_stream(stream),
            label: stream.get_description() || stream.get_name() || 'Sortie audio',
        })).filter(entry => entry.device);
        for (let index = 0; index < available.length; index += 2) {
            const row = new this.St.BoxLayout({orientation: this.Clutter.Orientation.HORIZONTAL,
                style_class: 'g-os-status-grid-row'});
            for (const entry of available.slice(index, index + 2)) {
                const active = entry.stream === this.stream;
                const button = new this.St.Button({reactive: true, can_focus: true, track_hover: true,
                    x_expand: true, style_class: 'g-os-status-device-tile', accessible_name: entry.label});
                const content = new this.St.BoxLayout({orientation: this.Clutter.Orientation.VERTICAL,
                    style_class: 'g-os-status-device-content'});
                content.add_child(new this.St.Icon({icon_name: /headphone|casque/i.test(entry.label)
                    ? 'audio-headphones-symbolic' : 'audio-speakers-symbolic', icon_size: 22}));
                content.add_child(new this.St.Label({text: entry.label, style_class: 'g-os-status-device-label'}));
                if (active)
                    content.add_child(new this.St.Icon({icon_name: 'object-select-symbolic', icon_size: 14}));
                button.set_child(content);
                button.connect('clicked', () => {
                    if (!this.destroyed)
                        this.control.change_output(entry.device.get_id());
                });
                row.add_child(button);
            }
            if (available.length % 2 && index + 1 >= available.length)
                row.add_child(new this.St.Widget({x_expand: true}));
            this.devices.add_child(row);
        }
        if (!available.length)
            this.devices.add_child(new this.St.Label({text: 'Aucune sortie audio disponible',
                style_class: 'g-os-status-empty'}));
    }

    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.cleanup.clear();
        this.streamCleanup.clear();
    }
}

export class DisplayStatusMenu {
    [key: string]: any;
    constructor(menu, icon, {Gio, GLib, St, Slider, PopupMenu, Clutter, openSettings}) {
        this.Gio = Gio; this.GLib = GLib; this.St = St;
        this.syncingBrightness = false; this.syncingNightLight = false; this.destroyed = false;
        this.cancellable = new Gio.Cancellable(); this.cleanup = new CleanupManager();
        this.nightLight = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
        const brightness = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.brightnessIcon = new St.Icon({icon_name: 'display-brightness-symbolic', icon_size: 20});
        this.brightnessSlider = new Slider.Slider(0); this.brightnessSlider.width = 230;
        this.brightnessSlider.accessible_name = 'Luminosité de l’écran';
        this.brightnessValue = new St.Label({text: '—', style_class: 'g-os-status-value'});
        for (const actor of [this.brightnessIcon, this.brightnessSlider, this.brightnessValue])
            actor.y_align = Clutter.ActorAlign.CENTER;
        brightness.add_child(this.brightnessIcon); brightness.add_child(this.brightnessSlider);
        brightness.add_child(this.brightnessValue); menu.addMenuItem(brightness);
        this.cleanup.addSignal(this.brightnessSlider, this.brightnessSlider.connect('notify::value', () => this._writeBrightness()));

        const night = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        night.add_child(new St.Icon({icon_name: 'weather-clear-night-symbolic', icon_size: 20}));
        night.add_child(new St.Label({text: 'Mode nuit', x_expand: true}));
        this.nightLightToggle = new PopupMenu.PopupSwitchMenuItem('', this.nightLight.get_boolean('night-light-enabled'));
        night.add_child(this.nightLightToggle); menu.addMenuItem(night);
        this.cleanup.addSignal(this.nightLightToggle, this.nightLightToggle.connect('toggled', (_item, enabled) => {
            if (!this.destroyed && !this.syncingNightLight) this.nightLight.set_boolean('night-light-enabled', enabled);
        }));

        this.temperatureRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.temperatureRow.add_child(new St.Icon({icon_name: 'thermometer-sun-symbolic', icon_size: 20}));
        this.temperatureSlider = new Slider.Slider(0); this.temperatureSlider.width = 200;
        this.temperatureSlider.accessible_name = 'Température du mode nuit';
        this.temperatureValue = new St.Label({text: '', style_class: 'g-os-status-value'});
        this.temperatureRow.add_child(this.temperatureSlider); this.temperatureRow.add_child(this.temperatureValue);
        menu.addMenuItem(this.temperatureRow);
        this.cleanup.addSignal(this.temperatureSlider, this.temperatureSlider.connect('notify::value', () => this._writeTemperature()));
        for (const signal of ['changed::night-light-enabled', 'changed::night-light-temperature'])
            this.cleanup.addSignal(this.nightLight, this.nightLight.connect(signal, () => this._refreshNightLight()));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Paramètres d’affichage', openSettings);

        const signal = Gio.DBus.session.signal_subscribe('org.gnome.SettingsDaemon.Power',
            'org.freedesktop.DBus.Properties', 'PropertiesChanged', '/org/gnome/SettingsDaemon/Power',
            'org.gnome.SettingsDaemon.Power.Screen', Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters) => {
                if (this.destroyed) return;
                const [name, properties] = parameters.deep_unpack();
                if (name === 'org.gnome.SettingsDaemon.Power.Screen' && Object.hasOwn(properties, 'Brightness')) {
                    const value = properties.Brightness;
                    this._updateBrightness(typeof value === 'number' ? value : value.deep_unpack());
                }
            });
        this.cleanup.add(() => Gio.DBus.session.signal_unsubscribe(signal));
        this._refreshNightLight(); this._readBrightness();
    }
    _refreshNightLight() {
        if (this.destroyed) return;
        const enabled = this.nightLight.get_boolean('night-light-enabled');
        const temperature = this.nightLight.get_uint('night-light-temperature');
        this.syncingNightLight = true;
        this.nightLightToggle.setToggleState(enabled);
        this.temperatureSlider.value = Math.max(0, Math.min(1, (temperature - 1000) / 9000));
        this.syncingNightLight = false;
        this.temperatureValue.text = `${temperature.toLocaleString()} K`;
        this.temperatureRow.visible = enabled;
    }
    _writeTemperature() {
        if (this.syncingNightLight || this.destroyed) return;
        this.nightLight.set_uint('night-light-temperature',
            Math.round(1000 + Math.max(0, Math.min(1, this.temperatureSlider.value)) * 9000));
    }
    _readBrightness() {
        this.Gio.DBus.session.call('org.gnome.SettingsDaemon.Power', '/org/gnome/SettingsDaemon/Power',
            'org.freedesktop.DBus.Properties', 'Get',
            new this.GLib.Variant('(ss)', ['org.gnome.SettingsDaemon.Power.Screen', 'Brightness']),
            null, this.Gio.DBusCallFlags.NONE, 3000, this.cancellable, (connection, result) => {
                if (this.destroyed) return;
                try { this._updateBrightness(connection.call_finish(result).get_child_value(0).get_variant().get_int32()); }
                catch { this._disableBrightness(); }
            });
    }
    _updateBrightness(value) {
        if (this.destroyed || !Number.isFinite(value)) return this._disableBrightness();
        this.brightness = Math.max(0, Math.min(100, Math.round(value)));
        this.syncingBrightness = true; this.brightnessSlider.value = this.brightness / 100;
        this.syncingBrightness = false; this.brightnessSlider.reactive = true;
        this.brightnessSlider.can_focus = true; this.brightnessValue.text = `${this.brightness} %`;
    }
    _disableBrightness() {
        if (this.destroyed) return;
        this.brightness = null; this.brightnessSlider.reactive = false;
        this.brightnessSlider.can_focus = false; this.brightnessValue.text = '—';
    }
    _writeBrightness() {
        if (this.syncingBrightness || this.destroyed || this.brightness === null) return;
        this.brightness = Math.round(Math.max(0, Math.min(1, this.brightnessSlider.value)) * 100);
        this.brightnessValue.text = `${this.brightness} %`;
        if (this.brightnessWriteSource) this.GLib.source_remove(this.brightnessWriteSource);
        this.brightnessWriteSource = this.GLib.timeout_add(this.GLib.PRIORITY_DEFAULT, 80, () => {
            this.brightnessWriteSource = 0;
            if (this.destroyed) return this.GLib.SOURCE_REMOVE;
            this.Gio.DBus.session.call('org.gnome.SettingsDaemon.Power', '/org/gnome/SettingsDaemon/Power',
                'org.freedesktop.DBus.Properties', 'Set',
                new this.GLib.Variant('(ssv)', ['org.gnome.SettingsDaemon.Power.Screen', 'Brightness',
                    new this.GLib.Variant('i', this.brightness)]),
                null, this.Gio.DBusCallFlags.NONE, 3000, this.cancellable, (connection, result) => {
                    if (this.destroyed) return;
                    try { connection.call_finish(result); } catch { this._disableBrightness(); }
                });
            return this.GLib.SOURCE_REMOVE;
        });
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.brightnessWriteSource) this.GLib.source_remove(this.brightnessWriteSource);
        this.cleanup.clear(); this.cancellable.cancel();
    }
}

class NativeMenuContent {
    [key: string]: any;
    constructor(menu, holder, {Clutter, onOpen = () => {}, onClose = () => {}}: any = {}) {
        this.menu = menu;
        this.holder = holder;
        this.Clutter = Clutter;
        this.onOpen = onOpen;
        this.onClose = onClose;
        this.destroyed = false;
    }

    alignDeviceRows(actor = this.saved?.actor) {
        alignMenuRows(actor, this.Clutter);
    }

    mount(nativeMenu, notifyOpen = true) {
        if (this.destroyed)
            return false;
        this.restore();
        const actor = nativeMenu?.box;
        const parent = actor?.get_parent();
        if (!parent)
            return false;
        let index;
        try {
            index = parent.get_children().indexOf(actor);
        } catch {
            return false;
        }
        if (index < 0 || !removeActorFromParent(actor, parent))
            return false;
        this.saved = {actor, parent, index, nativeMenu, notifyOpen, wasOpen: Boolean(nativeMenu.isOpen)};
        actor.add_style_class_name('g-os-status-native-content');
        try {
            this.holder.add_child(actor);
        } catch {
            this.saved = null;
            try {
                parent.insert_child_at_index(actor, index);
            } catch {
                // The original menu parent may have been disposed.
            }
            actor.remove_style_class_name('g-os-status-native-content');
            return false;
        }
        actor.show();
        this.alignDeviceRows(actor);
        this.mountCleanup = new CleanupManager();
        this.mountCleanup.addSignal(nativeMenu,
            nativeMenu.connect('activate', () => this.menu.close()));
        nativeMenu.isOpen = true;
        if (notifyOpen)
            this.onOpen();
        return true;
    }

    destroy() {
        if (this.destroyed)
            return;
        this.restore();
        this.destroyed = true;
    }

    restore() {
        if (!this.saved)
            return;
        const {actor, parent, index, nativeMenu, notifyOpen, wasOpen} = this.saved;
        this.saved = null;
        this.mountCleanup?.clear();
        this.mountCleanup = null;
        const currentParent = getActorParent(actor);
        if (currentParent && currentParent !== parent)
            removeActorFromParent(actor, currentParent);
        actor.remove_style_class_name('g-os-status-native-content');
        if (!getActorParent(actor)) {
            try {
                parent.insert_child_at_index(actor, index);
            } catch {
                // GNOME may have disposed the original native menu parent.
            }
        }
        try {
            nativeMenu.isOpen = wasOpen;
        } catch {
            // Ignore a native menu disposed during Shell teardown.
        }
        if (notifyOpen)
            this.onClose();
    }
}

export class NetworkStatusMenu {
    [key: string]: any;

    constructor(menu, icon, {toggles, St, Clutter, PopupMenu, GLib, openSettings}) {
        this.menu = menu;
        this.icon = icon;
        this.St = St;
        this.Clutter = Clutter;
        this.PopupMenu = PopupMenu;
        this.GLib = GLib;
        this.trafficSamples = [];
        this.lastTraffic = null;
        this.trafficRates = {rx: 0, tx: 0};
        this.trafficTimer = null;
        this.openSettings = openSettings;
        this.toggles = toggles.filter((entry, index, all) =>
            entry.toggle && all.findIndex(candidate => candidate.toggle === entry.toggle) === index);
        this.destroyed = false;
        this.cleanup = new CleanupManager();
        this.contents = new Map();
        this.activeView = null;
        this.detailSignals = new CleanupManager();
        this.overviewSignals = new CleanupManager();

        this.rootItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false,
            });
        this.rootItem.set_x_expand(true);
        this.scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true,
            });
        this.scroll.set_x_expand(true);
        this.body = new St.BoxLayout({orientation: this.Clutter.Orientation.VERTICAL,
            });
        this.body.set_x_expand(true);
        this.scroll.set_child(this.body);
        this.rootItem.add_child(this.scroll);
        menu.addMenuItem(this.rootItem);
        this._buildOverview();
        this._sampleTraffic();
        this.trafficTimer = this.GLib.timeout_add(this.GLib.PRIORITY_DEFAULT, 1000, () => {
            if (this.destroyed)
                return this.GLib.SOURCE_REMOVE;
            this._sampleTraffic();
            return this.GLib.SOURCE_CONTINUE;
        });
        this.cleanup.addSignal(menu, menu.connect('open-state-changed', (_actor, open) => {
            if (this.destroyed)
                return;
            if (open) {
                this.showOverview();
                this.refresh();
            } else {
                this._restoreActiveContent();
            }
        }));
        this.refresh();
    }

    _label(text, styleClass = '') {
        return new this.St.Label({text, style_class: styleClass, y_align: this.Clutter.ActorAlign.CENTER});
    }

    _button(label, styleClass, callback, iconName = null) {
        const button = new this.St.Button({reactive: true, can_focus: true, track_hover: true,
            style_class: styleClass, accessible_name: label});
        button.set_x_expand(true);
        const content = new this.St.BoxLayout({orientation: this.Clutter.Orientation.HORIZONTAL, style_class: 'g-os-network-button-content'});
        if (iconName)
            content.add_child(new this.St.Icon({icon_name: iconName, icon_size: 20,
                y_align: this.Clutter.ActorAlign.CENTER}));
        content.add_child(this._label(label, 'g-os-network-button-label'));
        button.set_child(content);
        button.connect('clicked', callback);
        return button;
    }

    _buildOverview() {
        const previousContents = this.contents;
        this.contents = new Map();
        this.connectionCard = new this.St.BoxLayout({orientation: this.Clutter.Orientation.HORIZONTAL,
            style_class: 'g-os-network-connection'});
        this.connectionIcon = new this.St.Icon({icon_name: 'network-wireless-signal-none-symbolic', icon_size: 28});
        this.connectionText = new this.St.BoxLayout({orientation: this.Clutter.Orientation.VERTICAL,
            style_class: 'g-os-network-connection-text'});
        this.connectionName = this._label('Aucune connexion active', 'g-os-network-connection-name');
        this.connectionDetail = this._label('', 'g-os-network-connection-detail');
        this.connectionText.add_child(this.connectionName);
        this.connectionText.add_child(this.connectionDetail);
        this.connectionCard.add_child(this.connectionIcon);
        this.connectionCard.add_child(this.connectionText);
        this.body.add_child(this.connectionCard);

        this.rowsBox = new this.St.BoxLayout({orientation: this.Clutter.Orientation.VERTICAL,
            style_class: 'g-os-status-device-grid'});
        this.body.add_child(this.rowsBox);
        const visible = this.toggles.filter(({toggle}) => toggle.visible !== false);
        for (let index = 0; index < visible.length; index += 3) {
            const row = new this.St.BoxLayout({orientation: this.Clutter.Orientation.HORIZONTAL,
                style_class: 'g-os-status-grid-row'});
            for (const entry of visible.slice(index, index + 3)) {
                const {toggle, title} = entry;
                const active = Boolean(toggle.checked);
                const button = new this.St.Button({reactive: true, can_focus: true, track_hover: true,
                    x_expand: true, style_class: 'g-os-status-device-tile', accessible_name: title});
                const content = new this.St.BoxLayout({orientation: this.Clutter.Orientation.VERTICAL,
                    style_class: 'g-os-status-device-content'});
                const icon = new this.St.Icon({icon_name: toggle.icon_name || this._iconFor(title), icon_size: 22});
                content.add_child(icon);
                content.add_child(new this.St.Label({text: title, style_class: 'g-os-status-device-label'}));
                const stateLabel = new this.St.Label({text: active ? 'Actif' : 'Inactif',
                    style_class: active ? 'g-os-status-device-active' : 'g-os-status-device-muted'});
                content.add_child(stateLabel);
                button.set_child(content);
                button.connect('clicked', () => this._toggleInlineContent(toggle));
                row.add_child(button);
                const contentState = previousContents.get(toggle)?.content ?? new NativeMenuContent(this.menu,
                    new this.St.BoxLayout({orientation: this.Clutter.Orientation.VERTICAL,
                        style_class: 'g-os-network-native-content'}), {
                        Clutter: this.Clutter,
                        onOpen: () => {
                            if (!this.destroyed) {
                                toggle._startScanning?.();
                                toggle._reorderDeviceItems?.();
                            }
                        },
                        onClose: () => toggle._stopScanning?.(),
                    });
                this.contents.set(toggle, {entry, button, icon, stateLabel, content: contentState});
                this.overviewSignals.addSignal(toggle, toggle.connect('notify::checked', () => this.refresh()));
                this.overviewSignals.addSignal(toggle, toggle.connect('notify::visible', () => this.refresh()));
                this.overviewSignals.addSignal(toggle, toggle.connect('notify::reactive', () => this.refresh()));
                if (/wi-?fi|wifi/i.test(title)) {
                    this.overviewSignals.addSignal(toggle, toggle.connect('notify::subtitle', () => this._refreshWifiRow(toggle)));
                    this.overviewSignals.addSignal(toggle, toggle.connect('notify::icon-name', () => this._refreshWifiRow(toggle)));
                }
            }
            while (row.get_n_children() < 3)
                row.add_child(new this.St.Widget({x_expand: true}));
            this.rowsBox.add_child(row);
        }
        this._buildTrafficGraph();
        this._appendSettingsItem();
        this._updateOverviewVisibility();
        this._refreshConnectionCard();
    }

    _refreshConnectionCard() {
        if (!this.connectionCard)
            return;
        const active = this.toggles.find(({toggle}) => toggle.checked && toggle.visible !== false);
        if (!active) {
            this.connectionName.text = 'Aucune connexion active';
            this.connectionDetail.text = '';
            this.connectionIcon.icon_name = 'network-offline-symbolic';
            return;
        }
        const wifi = /wi-?fi|wifi/i.test(active.title);
        this.connectionName.text = wifi ? (active.toggle.subtitle || 'Wi-Fi connecté') : active.title;
        this.connectionDetail.text = wifi ? 'Connexion Wi-Fi' : 'Connexion active';
        this.connectionIcon.icon_name = active.toggle.icon_name || this._iconFor(active.title);
    }

    _refreshWifiRow(toggle) {
        const state = this.contents.get(toggle);
        if (!state || !/wi-?fi|wifi/i.test(state.entry.title))
            return;
        state.icon.icon_name = toggle.icon_name || 'network-wireless-signal-none-symbolic';
        this._refreshConnectionCard();
    }

    _toggleInlineContent(toggle) {
        if (this.destroyed || !this.contents.has(toggle) || toggle.visible === false)
            return;
        if (this.activeView === toggle) {
            this._restoreActiveContent();
            return;
        }
        this._restoreActiveContent();
        this.activeView = toggle;
        const state = this.contents.get(toggle);
        const inline = new this.St.BoxLayout({orientation: this.Clutter.Orientation.VERTICAL,
            style_class: 'g-os-network-inline-content'});
        const switchRow = new this.PopupMenu.PopupSwitchMenuItem(
            /wi-?fi|wifi/i.test(state.entry.title) ? 'Wi-Fi' : state.entry.title, Boolean(toggle.checked));
        switchRow.setSensitive(toggle.visible !== false && toggle.reactive !== false);
        this.detailSignals.addSignal(switchRow, switchRow.connect('toggled', (_item, checked) => {
            if (!this.destroyed && checked !== Boolean(toggle.checked))
                toggle.emit('clicked', 1);
        }));
        this.detailSignals.addSignal(toggle, toggle.connect('notify::checked', () => {
            if (!this.destroyed)
                switchRow.setToggleState(Boolean(toggle.checked));
        }));
        inline.add_child(switchRow);
        if (/wi-?fi|wifi/i.test(state.entry.title)) {
            const scan = this._button('Rechercher', 'g-os-network-action', () => {
                if (!this.destroyed && this.activeView === toggle) {
                    toggle._startScanning?.();
                    toggle._reorderDeviceItems?.();
                }
            }, 'view-refresh-symbolic');
            inline.add_child(scan);
        }
        const holder = new this.St.BoxLayout({orientation: this.Clutter.Orientation.VERTICAL,
            style_class: 'g-os-network-native-content'});
        inline.add_child(holder);
        this.inlineContent = inline;
        this.body.insert_child_at_index(inline, Math.max(0, this.body.get_n_children() - 2));
        if (!state.content)
            state.content = new NativeMenuContent(this.menu, holder, {Clutter: this.Clutter});
        else
            state.content.holder = holder;
        const nativeHeader = toggle.menu?._header;
        if (nativeHeader) {
            state.nativeHeaderWasVisible = nativeHeader.visible;
            nativeHeader.hide();
        }
        state.content.mount(toggle.menu, true);
    }

    _readProcFile(path) {
        try {
            const [ok, contents] = this.GLib.file_get_contents(path);
            return ok ? new TextDecoder().decode(contents) : null;
        } catch {
            return null;
        }
    }

    _getActiveTrafficInterfaces() {
        const interfaces = new Set();
        const ipv4 = this._readProcFile('/proc/net/route');
        if (ipv4) {
            const routes = ipv4.split('\n').slice(1).map(line => line.trim().split(/\s+/));
            const defaults = routes.filter(fields => fields.length >= 8 &&
                fields[1] === '00000000' && (parseInt(fields[3], 16) & 1));
            if (defaults.length) {
                const bestMetric = Math.min(...defaults.map(fields => Number(fields[6]) || 0));
                for (const fields of defaults) {
                    if ((Number(fields[6]) || 0) === bestMetric)
                        interfaces.add(fields[0]);
                }
            }
        }

        const ipv6 = this._readProcFile('/proc/net/ipv6_route');
        if (ipv6) {
            const routes = ipv6.split('\n').map(line => line.trim().split(/\s+/));
            const defaults = routes.filter(fields => fields.length >= 10 &&
                fields[0] === '00000000000000000000000000000000' && fields[1] === '00');
            if (defaults.length) {
                const bestMetric = Math.min(...defaults.map(fields => parseInt(fields[5], 16) || 0));
                for (const fields of defaults) {
                    if ((parseInt(fields[5], 16) || 0) === bestMetric)
                        interfaces.add(fields[9]);
                }
            }
        }

        if (interfaces.size)
            return interfaces;

        // Without a default route, only consider physical interfaces whose
        // carrier is up. This avoids adding dormant and virtual interfaces.
        const devices = this._readProcFile('/proc/net/dev');
        if (!devices)
            return interfaces;
        for (const line of devices.split('\n').slice(2)) {
            const separator = line.indexOf(':');
            if (separator < 0)
                continue;
            const iface = line.slice(0, separator).trim();
            if (!iface || /^(lo|veth|docker|br-|virbr|tun|tap|wg|vnet)/.test(iface))
                continue;
            const state = this._readProcFile(`/sys/class/net/${iface}/operstate`);
            if (state?.trim() === 'up')
                interfaces.add(iface);
        }
        return interfaces;
    }

    _readTrafficCounters() {
        try {
            const activeInterfaces = this._getActiveTrafficInterfaces();
            if (!activeInterfaces.size)
                return null;
            const source = this._readProcFile('/proc/net/dev');
            if (!source)
                return null;
            let rx = 0;
            let tx = 0;
            for (const line of source.split('\n').slice(2)) {
                const separator = line.indexOf(':');
                if (separator < 0)
                    continue;
                const iface = line.slice(0, separator).trim();
                if (!activeInterfaces.has(iface))
                    continue;
                const values = line.slice(separator + 1).trim().split(/\s+/).map(Number);
                rx += values[0] || 0;
                tx += values[8] || 0;
            }
            return {rx, tx, interfaces: [...activeInterfaces].sort().join(',')};
        } catch (error) {
            console.error('G-OS network traffic counters:', error);
            return null;
        }
    }

    _sampleTraffic() {
        const counters = this._readTrafficCounters();
        if (!counters)
            return;
        if (this.lastTraffic && this.lastTraffic.interfaces === counters.interfaces) {
            this.trafficRates = {
                rx: Math.max(0, counters.rx - this.lastTraffic.rx),
                tx: Math.max(0, counters.tx - this.lastTraffic.tx),
            };
        } else {
            this.trafficRates = {rx: 0, tx: 0};
            this.trafficSamples = [];
        }
        this.lastTraffic = counters;
        this.trafficSamples.push(this.trafficRates);
        if (this.trafficSamples.length > 36)
            this.trafficSamples.shift();
        if (this.trafficArea && !this.destroyed)
            this.trafficArea.queue_repaint();
        if (this.trafficLegend && !this.destroyed)
            this.trafficLegend.text = `↓ ${this._formatRate(this.trafficRates.rx)}     ↑ ${this._formatRate(this.trafficRates.tx)}`;
    }

    _formatRate(bytes) {
        if (bytes < 1024)
            return `${Math.round(bytes)} B/s`;
        if (bytes < 1024 * 1024)
            return `${(bytes / 1024).toFixed(1)} KB/s`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
    }

    _drawTrafficGraph(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const samples = this.trafficSamples;
        const max = Math.max(1024, ...samples.map(sample => Math.max(sample.rx, sample.tx))) * 1.15;
        const drawLine = (key, red, green, blue) => {
            cr.setSourceRGBA(red, green, blue, 0.95);
            cr.setLineWidth(2);
            samples.forEach((sample, index) => {
                const x = samples.length > 1 ? index * width / (samples.length - 1) : width;
                const y = height - 5 - (sample[key] / max) * (height - 12);
                if (index === 0)
                    cr.moveTo(x, y);
                else
                    cr.lineTo(x, y);
            });
            if (samples.length === 1)
                cr.lineTo(width, height - 5);
            cr.stroke();
        };
        cr.setSourceRGBA(1, 1, 1, 0.08);
        cr.setLineWidth(1);
        for (let line = 1; line <= 3; line++) {
            const y = line * height / 4;
            cr.moveTo(0, y);
            cr.lineTo(width, y);
        }
        cr.stroke();
        drawLine('rx', 0.42, 0.78, 0.98);
        drawLine('tx', 0.55, 0.85, 0.62);
        cr.$dispose();
    }

    _updateOverviewVisibility() {
        for (const {entry, button} of this.contents.values())
            button.visible = entry.toggle.visible !== false;
    }

    _iconFor(title) {
        const value = title.toLowerCase();
        if (value.includes('wi-fi') || value.includes('wifi'))
            return 'network-wireless-signal-good-symbolic';
        if (value.includes('ethernet') || value.includes('filaire'))
            return 'network-wired-symbolic';
        if (value.includes('vpn'))
            return 'network-vpn-symbolic';
        if (value.includes('mobile') || value.includes('cellulaire'))
            return 'network-cellular-signal-good-symbolic';
        return 'network-workgroup-symbolic';
    }

    _restoreActiveContent() {
        if (!this.activeView)
            return;
        const state = this.contents.get(this.activeView);
        state?.content?.restore();
        if (state?.nativeHeaderWasVisible)
            this.activeView.menu?._header?.show();
        if (state)
            state.nativeHeaderWasVisible = false;
        this.inlineContent?.destroy();
        this.inlineContent = null;
        this.detailSignals.clear();
        this.activeView = null;
    }

    showOverview() {
        if (this.destroyed)
            return;
        this._restoreActiveContent();
        this.detailSignals.clear();
        this.overviewSignals.clear();
        this.overviewSignals = new CleanupManager();
        this.body.destroy_all_children();
        this._buildOverview();
        this.refresh();
    }

    refresh() {
        if (this.destroyed)
            return;
        this._updateOverviewVisibility();
        for (const {entry, stateLabel, button} of this.contents.values()) {
            const active = Boolean(entry.toggle.checked && entry.toggle.visible !== false);
            stateLabel.text = active ? 'Actif' : 'Inactif';
            stateLabel.style_class = active ? 'g-os-status-device-active' : 'g-os-status-device-muted';
            button.visible = entry.toggle.visible !== false;
            this._refreshWifiRow(entry.toggle);
        }
        this._refreshConnectionCard();
        const activeEntry = this.toggles.find(({toggle}) => toggle.checked);
        if (activeEntry?.toggle.icon_name)
            this.icon.icon_name = activeEntry.toggle.icon_name;
        else {
            const fallback = this.toggles.find(({toggle}) => toggle.icon_name);
            if (fallback)
                this.icon.icon_name = fallback.toggle.icon_name;
        }
        if (this.detailSwitch && this.activeView)
            this.detailSwitch.setToggleState(Boolean(this.activeView.checked));
    }

    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        if (this.trafficTimer !== null) {
            this.GLib.Source.remove(this.trafficTimer);
            this.trafficTimer = null;
        }
        this._restoreActiveContent();
        this.detailSignals.clear();
        this.overviewSignals.clear();
        for (const state of this.contents.values())
            state.content?.destroy();
        this.cleanup.clear();
    }
}
export class RadioStatusMenu {
    [key: string]: any;
    constructor(menu, icon, {toggle, title, St, Clutter, PopupMenu, openSettings, deviceChangeSignal = null}) {
        this.menu = menu; this.icon = icon; this.toggle = toggle; this.St = St; this.Clutter = Clutter;
        this.destroyed = false; this.cleanup = new CleanupManager(); this.client = toggle?._client;
        this.header = new PopupMenu.PopupSwitchMenuItem(title, Boolean(toggle?.checked));
        this.header.setSensitive(Boolean(toggle) && toggle.visible !== false && toggle.reactive !== false);
        this.cleanup.addSignal(this.header, this.header.connect('toggled', (_actor, checked) => {
            if (!this.destroyed && toggle && checked !== Boolean(toggle.checked)) toggle.emit('clicked', 1);
        }));
        menu.addMenuItem(this.header);
        this.connectedLabel = new St.Label({text: 'Périphériques connectés', style_class: 'g-os-status-section-label'});
        this.connectedGrid = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'g-os-status-device-grid'});
        this.otherLabel = new St.Label({text: 'Autres appareils', style_class: 'g-os-status-section-label'});
        this.otherGrid = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'g-os-status-device-grid'});
        this.emptyLabel = new St.Label({text: 'Aucun appareil disponible', style_class: 'g-os-status-empty'});
        for (const actor of [this.connectedLabel, this.connectedGrid, this.otherLabel, this.otherGrid, this.emptyLabel]) {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            item.add_child(actor); menu.addMenuItem(item);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Paramètres Bluetooth', openSettings);
        if (toggle) for (const signal of ['notify::checked', 'notify::icon-name', 'notify::visible', 'notify::reactive'])
            this.cleanup.addSignal(toggle, toggle.connect(signal, () => this.refresh()));
        if (this.client && deviceChangeSignal)
            this.cleanup.addSignal(this.client, this.client.connect(deviceChangeSignal, () => this.refresh()));
        if (this.client)
            this.cleanup.addSignal(this.client, this.client.connect('device-removed', () => this.refresh()));
        this.cleanup.addSignal(menu, menu.connect('open-state-changed', () => this.refresh()));
        this.refresh();
    }
    _tile(device) {
        const button = new this.St.Button({reactive: true, can_focus: true, track_hover: true, x_expand: true,
            style_class: 'g-os-status-device-tile',
            accessible_name: device.connected ? `Déconnecter ${device.alias}` : `Connecter ${device.alias}`});
        const content = new this.St.BoxLayout({orientation: this.Clutter.Orientation.VERTICAL, style_class: 'g-os-status-device-content'});
        content.add_child(new this.St.Icon({icon_name: device.icon || 'bluetooth-symbolic', icon_size: 22}));
        content.add_child(new this.St.Label({text: device.alias || 'Périphérique', style_class: 'g-os-status-device-label'}));
        content.add_child(new this.St.Label({text: device.connected ? 'Connecté' : 'Disponible',
            style_class: device.connected ? 'g-os-status-device-active' : 'g-os-status-device-muted'}));
        if (device.connected && Number.isFinite(Number(device.batteryPercentage)))
            content.add_child(new this.St.Label({text: `${Math.round(device.batteryPercentage)} %`, style_class: 'g-os-status-device-muted'}));
        button.set_child(content);
        button.connect('clicked', () => {
            if (!this.destroyed) this.client?.toggleDevice(device).catch(error => console.error('G-OS Bluetooth device:', error));
        });
        return button;
    }
    _fill(container, devices) {
        container.destroy_all_children();
        for (let index = 0; index < devices.length; index += 2) {
            const row = new this.St.BoxLayout({orientation: this.Clutter.Orientation.HORIZONTAL, style_class: 'g-os-status-grid-row'});
            for (const device of devices.slice(index, index + 2)) row.add_child(this._tile(device));
            if (devices.length % 2 && index + 1 >= devices.length) row.add_child(new this.St.Widget({x_expand: true}));
            container.add_child(row);
        }
    }
    refresh() {
        if (this.destroyed) return;
        const enabled = Boolean(this.toggle?.checked);
        this.header.setToggleState(enabled);
        this.header.setSensitive(Boolean(this.toggle) && this.toggle.visible !== false && this.toggle.reactive !== false);
        if (this.toggle?.icon_name) this.icon.icon_name = this.toggle.icon_name;
        const devices = enabled ? (this.client?.getDevices?.() ?? []) : [];
        const connected = devices.filter(device => device.connected);
        const available = devices.filter(device => !device.connected && device.connectable !== false).slice(0, 4);
        this._fill(this.connectedGrid, connected); this._fill(this.otherGrid, available);
        this.connectedLabel.visible = connected.length > 0; this.connectedGrid.get_parent().visible = connected.length > 0;
        this.otherLabel.visible = available.length > 0; this.otherGrid.get_parent().visible = available.length > 0;
        this.emptyLabel.visible = enabled && connected.length === 0 && available.length === 0;
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true; this.cleanup.clear();
    }
}
export class BatteryStatusMenu {
    [key: string]: any;
    constructor(menu, icon, {powerToggle, profiles, deviceClient, batteryKind, levelLabel, showLevel = false,
        St, Clutter, PopupMenu, openSettings}) {
        this.menu = menu; this.icon = icon; this.levelLabel = levelLabel; this.showLevel = showLevel;
        this.powerToggle = powerToggle; this.Clutter = Clutter; this.proxy = powerToggle?._proxy;
        this.profiles = profiles; this.deviceClient = deviceClient; this.batteryKind = batteryKind;
        this.St = St; this.devices = []; this.destroyed = false; this.cleanup = new CleanupManager();
        this.deviceConnections = new Map();
        const summaryItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const summary = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'g-os-battery-summary'});
        const top = new St.BoxLayout({orientation: Clutter.Orientation.HORIZONTAL, style_class: 'g-os-status-summary-row'});
        this.batteryIcon = new St.Icon({icon_name: 'battery-missing-symbolic', icon_size: 32});
        const details = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        this.percentage = new St.Label({text: '—', style_class: 'g-os-battery-percentage'});
        this.state = new St.Label({text: '', style_class: 'g-os-status-muted'});
        details.add_child(this.percentage); details.add_child(this.state); top.add_child(this.batteryIcon); top.add_child(details);
        summary.add_child(top); summaryItem.add_child(summary); menu.addMenuItem(summaryItem);
        this.deviceHeading = new St.Label({text: 'Périphériques', style_class: 'g-os-status-section-label'});
        const headingItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        headingItem.add_child(this.deviceHeading); menu.addMenuItem(headingItem);
        this.deviceItems = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'g-os-status-battery-devices'});
        const devicesItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        devicesItem.add_child(this.deviceItems); menu.addMenuItem(devicesItem);
        this.profileHeading = new St.Label({text: 'Mode d’alimentation', style_class: 'g-os-status-section-label'});
        const profileHeadingItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        profileHeadingItem.add_child(this.profileHeading); menu.addMenuItem(profileHeadingItem);
        this.profileGrid = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'g-os-status-device-grid'});
        const profilesItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        profilesItem.add_child(this.profileGrid); menu.addMenuItem(profilesItem);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Paramètres d’alimentation', openSettings);
        if (this.proxy)
            this.cleanup.addSignal(this.proxy, this.proxy.connect('g-properties-changed', () => this.refresh()));
        if (profiles?._proxy)
            this.cleanup.addSignal(profiles._proxy, profiles._proxy.connect('g-properties-changed', () => this._buildProfiles()));
        if (deviceClient) {
            try { this.devices = deviceClient.get_devices2() ?? []; } catch { this.devices = []; }
            this.cleanup.addSignal(deviceClient, deviceClient.connect('device-added', (_client, device) => {
                if (!this.destroyed && !this.devices.includes(device)) this.devices.push(device);
                this.refresh();
            }));
            this.cleanup.addSignal(deviceClient, deviceClient.connect('device-removed', (_client, path) => {
                if (this.destroyed) return;
                this.devices = this.devices.filter(device => device.get_object_path() !== path);
                this.refresh();
            }));
        }
        this.cleanup.addSignal(menu, menu.connect('open-state-changed', () => this.refresh()));
        this._buildProfiles(); this.refresh();
    }
    _buildProfiles() {
        if (!this.profileGrid) return;
        this.profileGrid.destroy_all_children();
        const proxy = this.profiles?._proxy;
        const entries = [...(this.profiles?._profileItems?.entries?.() ?? [])]
            .filter(([profile]) => ['power-saver', 'balanced', 'performance'].includes(profile));
        for (let index = 0; index < entries.length; index += 3) {
            const row = new this.St.BoxLayout({orientation: this.Clutter.Orientation.HORIZONTAL, style_class: 'g-os-status-grid-row'});
            for (const [profile, item] of entries.slice(index, index + 3)) {
                const button = new this.St.Button({reactive: true, can_focus: true, track_hover: true,
                    x_expand: true, style_class: 'g-os-status-device-tile', accessible_name: item.label?.text || profile});
                const content = new this.St.BoxLayout({orientation: this.Clutter.Orientation.VERTICAL, style_class: 'g-os-status-device-content'});
                content.add_child(new this.St.Icon({icon_name: item.icon?.icon_name || 'power-profile-balanced-symbolic', icon_size: 22}));
                content.add_child(new this.St.Label({text: item.label?.text || profile, style_class: 'g-os-status-device-label'}));
                if (proxy?.ActiveProfile === profile)
                    content.add_child(new this.St.Icon({icon_name: 'object-select-symbolic', icon_size: 14}));
                button.set_child(content);
                button.connect('clicked', () => { if (!this.destroyed && proxy) proxy.ActiveProfile = profile; });
                row.add_child(button);
            }
            this.profileGrid.add_child(row);
        }
        this.profileHeading.visible = entries.length > 0;
    }
    refresh() {
        if (this.destroyed) return;
        const batteries = this.syncDevices();
        const primary = batteries.find(device => device.power_supply) ?? batteries[0];
        const proxy = this.proxy;
        const proxyLevel = proxy?.IsPresent ? Number(proxy.Percentage) : Number.NaN;
        const level = Number.isFinite(proxyLevel) ? proxyLevel : primary ? Number(primary.percentage) : Number.NaN;
        if (this.levelLabel) {
            this.levelLabel.text = Number.isFinite(level) ? `${Math.round(level)}%` : '';
            this.levelLabel.visible = this.showLevel && Number.isFinite(level);
        }
        this.deviceHeading.visible = batteries.length > 0;
        this.deviceItems.destroy_all_children();
        for (const device of batteries) {
            const row = new this.St.BoxLayout({orientation: this.Clutter.Orientation.HORIZONTAL, style_class: 'g-os-status-battery-device'});
            row.add_child(new this.St.Icon({icon_name: device.icon_name || 'battery-good-symbolic', icon_size: 18}));
            row.add_child(new this.St.Label({text: [device.vendor, device.model].filter(Boolean).join(' ') || 'Périphérique', x_expand: true}));
            row.add_child(new this.St.Label({text: `${Math.round(Number(device.percentage) || 0)} %`}));
            this.deviceItems.add_child(row);
        }
        if (!proxy?.IsPresent) {
            this.percentage.text = Number.isFinite(level) ? `${Math.round(level)} %` : 'Secteur';
            this.state.text = Number.isFinite(level) ? 'Batterie' : 'Aucune batterie détectée';
            this.batteryIcon.icon_name = primary?.icon_name || 'battery-missing-symbolic';
            if (!batteries.length) this.icon.icon_name = 'battery-missing-symbolic';
            return;
        }
        this.percentage.text = `${Math.round(proxy.Percentage)} %`;
        const states = ['État inconnu', 'En charge', 'Sur batterie', 'Batterie vide', 'Charge complète', 'Charge en attente', 'Décharge en attente'];
        const seconds = proxy.State === 1 ? proxy.TimeToFull : proxy.State === 2 ? proxy.TimeToEmpty : 0;
        const minutes = Math.max(0, Math.round(Number(seconds) / 60));
        const time = minutes > 0 ? ` · ${Math.floor(minutes / 60)} h ${minutes % 60} min` : '';
        this.state.text = `${states[proxy.State] ?? states[0]}${time}`;
        const percentage = Number(proxy.Percentage);
        const levelName = proxy.State === 3 ? 'empty' : percentage >= 95 ? 'full' : percentage >= 60 ? 'good'
            : percentage >= 20 ? 'caution' : percentage > 0 ? 'low' : 'empty';
        const fallback = proxy.State === 4 ? 'battery-full-charged-symbolic'
            : `battery-${levelName}${proxy.State === 1 ? '-charging' : ''}-symbolic`;
        this.icon.icon_name = proxy.IconName || fallback;
        this.batteryIcon.icon_name = proxy.IconName || fallback;
    }
    syncDevices() {
        if (this.destroyed) return [];
        const candidates = this.devices.filter(device => device.kind === this.batteryKind || device.is_rechargeable);
        const batteries = candidates.filter(device => device.is_present);
        const current = new Set(candidates);
        for (const [device, cleanup] of this.deviceConnections) {
            if (current.has(device)) continue;
            cleanup.clear(); this.deviceConnections.delete(device);
        }
        for (const device of batteries) {
            if (this.deviceConnections.has(device)) continue;
            const cleanup = new CleanupManager();
            for (const signal of ['notify::percentage', 'notify::state', 'notify::is-present', 'notify::kind',
                'notify::model', 'notify::vendor', 'notify::icon-name', 'notify::time-to-empty', 'notify::time-to-full'])
                cleanup.addSignal(device, device.connect(signal, () => this.refresh()));
            this.deviceConnections.set(device, cleanup);
        }
        return batteries;
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true; this.cleanup.clear();
        for (const cleanup of this.deviceConnections.values()) cleanup.clear();
        this.deviceConnections.clear(); this.devices = [];
        this.deviceClient?.dispose?.();
    }
}

export function createPowerDeviceClient(Gio) {
    const devices = new Map();
    const handlers = new Map();
    let nextHandler = 0;
    const emit = (signal, ...args) => {
        if (disposed)
            return;
        for (const [name, callback] of handlers.values()) {
            if (name === signal)
                callback(client, ...args);
        }
    };
    const createDevice = objectPath => {
        const proxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            'org.freedesktop.UPower', objectPath, 'org.freedesktop.UPower.Device', null);
        const properties = {
            kind: 'Type', is_present: 'IsPresent', is_rechargeable: 'IsRechargeable', percentage: 'Percentage',
            state: 'State', vendor: 'Vendor', model: 'Model', power_supply: 'PowerSupply', native_path: 'NativePath',
            icon_name: 'IconName', time_to_full: 'TimeToFull', time_to_empty: 'TimeToEmpty',
        };
        const device = {
            get_object_path: () => objectPath,
            connect(signal, callback) {
                const property = properties[signal.slice('notify::'.length).replaceAll('-', '_')];
                return proxy.connect('g-properties-changed', (_proxy, changed, invalidated) => {
                    if (changed.lookup_value(property, null) || invalidated.includes(property))
                        callback(device);
                });
            },
            disconnect: id => proxy.disconnect(id),
            dispose: () => proxy.run_dispose?.(),
        };
        for (const [name, property] of Object.entries(properties)) {
            Object.defineProperty(device, name, {get: () => proxy.get_cached_property(property)?.deep_unpack()});
        }
        return device;
    };
    const client = {
        get_devices2: () => [...devices.values()],
        connect(signal, callback) {
            const id = ++nextHandler;
            handlers.set(id, [signal, callback]);
            return id;
        },
        disconnect: id => handlers.delete(id),
        dispose() {
            if (disposed)
                return;
            disposed = true;
            if (rootSignal && root)
                root.disconnect(rootSignal);
            rootSignal = 0;
            for (const device of devices.values())
                device.dispose?.();
            devices.clear();
            handlers.clear();
            root?.run_dispose?.();
        },
    };
    let root;
    let rootSignal;
    let disposed = false;
    try {
        root = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            'org.freedesktop.UPower', '/org/freedesktop/UPower', 'org.freedesktop.UPower', null);
        const add = objectPath => {
            if (disposed || devices.has(objectPath))
                return;
            try {
                const device = createDevice(objectPath);
                devices.set(objectPath, device);
                emit('device-added', device);
            } catch {}
        };
        rootSignal = root.connect('g-signal', (_proxy, _sender, signal, parameters) => {
            if (disposed)
                return;
            const [objectPath] = parameters.deep_unpack();
            if (signal === 'DeviceAdded')
                add(objectPath);
            else if (signal === 'DeviceRemoved') {
                const device = devices.get(objectPath);
                if (!device)
                    return;
                devices.delete(objectPath);
                emit('device-removed', objectPath);
                device.dispose?.();
            }
        });
        for (const objectPath of root.call_sync('EnumerateDevices', null, Gio.DBusCallFlags.NONE, -1, null)
            .deep_unpack()[0]) {
            try { devices.set(objectPath, createDevice(objectPath)); } catch {}
        }
    } catch {
        if (rootSignal && root)
            root.disconnect(rootSignal);
        rootSignal = 0;
        for (const device of devices.values())
            device.dispose?.();
        devices.clear();
        root?.run_dispose?.();
        root = null;
    }
    return client;
}