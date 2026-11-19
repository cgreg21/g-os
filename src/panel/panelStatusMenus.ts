import {CleanupManager} from '../core/cleanupManager.js';

export function alignMenuRows(actor, Clutter) {
    if (!actor)
        return;
    if (['popup-menu-item', 'bt-device-item', 'nm-network-item'].some(name => actor.has_style_class_name?.(name))) {
        actor.set_style('padding-top: 3px; padding-bottom: 3px;');
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
        this.Clutter = Clutter;
        this.PopupMenu = PopupMenu;
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
        this.devices = new PopupMenu.PopupMenuSection();
        menu.addMenuItem(this.devices);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Parametres du son', openSettings);
        this.cleanup.addSignal(menu, menu.connect('open-state-changed', (actor, open) => {
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
        if (this.syncing || !this.stream)
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
        const normal = this.control.get_vol_max_norm() || 1;
        if (!this.soundSettings.get_boolean('allow-volume-above-100-percent') &&
            this.stream && this.stream.volume > normal) {
            this.stream.set_volume(normal);
            this.stream.push_volume();
        }
        this.refresh();
    }

    adjustVolume(direction) {
        if (!this.stream)
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
        if (!this.stream)
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
        this.devices.removeAll();
        const streams = this.control.get_sinks();
        let count = 0;
        for (const stream of streams) {
            const device = this.control.lookup_device_from_stream(stream);
            if (!device)
                continue;
            const label = stream.get_description() || stream.get_name() || 'Sortie audio';
            const item = this.devices.addAction(label, () => this.control.change_output(device.get_id()));
            count++;
            item.setOrnament(stream === this.stream ? this.PopupMenu.Ornament.DOT : this.PopupMenu.Ornament.NONE);
        }
        if (count === 0) {
            const item = this.devices.addAction('Aucune sortie audio disponible', () => {});
            item.setSensitive(false);
        }
        alignMenuRows(this.devices.actor, this.Clutter);
    }

    destroy() {
        this.cleanup.clear();
        this.streamCleanup.clear();
    }
}

export class DisplayStatusMenu {
    [key: string]: any;

    constructor(menu, icon, {Gio, GLib, St, Slider, PopupMenu, Clutter, openSettings}) {
        this.menu = menu;
        this.icon = icon;
        this.Gio = Gio;
        this.GLib = GLib;
        this.brightness = null;
        this.syncingBrightness = false;
        this.syncingNightLight = false;
        this.destroyed = false;
        this.cancellable = new Gio.Cancellable();
        this.cleanup = new CleanupManager();
        this.nightLight = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});

        const brightnessRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.brightnessIcon = new St.Icon({icon_name: 'display-brightness-symbolic', icon_size: 20});
        this.brightnessSlider = new Slider.Slider(0);
        this.brightnessSlider.width = 200;
        this.brightnessSlider.accessible_name = 'Luminosité de l’écran';
        this.brightnessIcon.y_align = Clutter.ActorAlign.CENTER;
        this.brightnessSlider.y_align = Clutter.ActorAlign.CENTER;
        brightnessRow.add_child(this.brightnessIcon);
        brightnessRow.add_child(this.brightnessSlider);
        menu.addMenuItem(brightnessRow);
        this.brightnessInfo = new PopupMenu.PopupMenuItem('Luminosité indisponible',
            {reactive: false, can_focus: false});
        this.brightnessInfo.add_style_class_name('g-os-status-info');
        menu.addMenuItem(this.brightnessInfo);
        this.cleanup.addSignal(this.brightnessSlider,
            this.brightnessSlider.connect('notify::value', () => this._writeBrightness()));

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Mode nuit'));
        this.nightLightToggle = new PopupMenu.PopupSwitchMenuItem('Activer le mode nuit',
            this.nightLight.get_boolean('night-light-enabled'));
        this.cleanup.addSignal(this.nightLightToggle, this.nightLightToggle.connect('toggled', (item, enabled) => {
            if (!this.syncingNightLight)
                this.nightLight.set_boolean('night-light-enabled', enabled);
        }));
        menu.addMenuItem(this.nightLightToggle);

        const temperatureRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.temperatureIcon = new St.Icon({icon_name: 'weather-clear-night-symbolic', icon_size: 20});
        this.temperatureSlider = new Slider.Slider(0);
        this.temperatureSlider.width = 200;
        this.temperatureSlider.accessible_name = 'Température du mode nuit';
        this.temperatureIcon.y_align = Clutter.ActorAlign.CENTER;
        this.temperatureSlider.y_align = Clutter.ActorAlign.CENTER;
        temperatureRow.add_child(this.temperatureIcon);
        temperatureRow.add_child(this.temperatureSlider);
        menu.addMenuItem(temperatureRow);
        this.temperatureInfo = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this.temperatureInfo.add_style_class_name('g-os-status-info');
        menu.addMenuItem(this.temperatureInfo);
        this.cleanup.addSignal(this.temperatureSlider,
            this.temperatureSlider.connect('notify::value', () => this._writeTemperature()));
        for (const signal of ['changed::night-light-enabled', 'changed::night-light-temperature'])
            this.cleanup.addSignal(this.nightLight,
                this.nightLight.connect(signal, () => this._refreshNightLight()));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Configurer le mode nuit', openSettings);

        const brightnessSignal = Gio.DBus.session.signal_subscribe(
            'org.gnome.SettingsDaemon.Power',
            'org.freedesktop.DBus.Properties',
            'PropertiesChanged',
            '/org/gnome/SettingsDaemon/Power',
            'org.gnome.SettingsDaemon.Power.Screen',
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters) => {
                if (this.destroyed)
                    return;
                const [interfaceName, properties] = parameters.deep_unpack();
                if (interfaceName !== 'org.gnome.SettingsDaemon.Power.Screen' ||
                    !Object.hasOwn(properties, 'Brightness'))
                    return;
                const value = properties.Brightness;
                this._updateBrightness(typeof value === 'number' ? value : value.deep_unpack());
            });
        this.cleanup.add(() => Gio.DBus.session.signal_unsubscribe(brightnessSignal));
        this._refreshNightLight();
        this._readBrightness();
    }

    _refreshNightLight() {
        const enabled = this.nightLight.get_boolean('night-light-enabled');
        const temperature = this.nightLight.get_uint('night-light-temperature');
        this.syncingNightLight = true;
        this.nightLightToggle.setToggleState(enabled);
        this.temperatureSlider.value = Math.max(0, Math.min(1, (temperature - 1000) / 9000));
        this.syncingNightLight = false;
        this.temperatureInfo.label.text = `Température : ${temperature} K`;
    }

    _writeTemperature() {
        if (this.syncingNightLight || this.destroyed)
            return;
        const temperature = Math.round(1000 + Math.max(0, Math.min(1, this.temperatureSlider.value)) * 9000);
        this.nightLight.set_uint('night-light-temperature', temperature);
    }

    _readBrightness() {
        this.Gio.DBus.session.call(
            'org.gnome.SettingsDaemon.Power',
            '/org/gnome/SettingsDaemon/Power',
            'org.freedesktop.DBus.Properties',
            'Get',
            new this.GLib.Variant('(ss)', [
                'org.gnome.SettingsDaemon.Power.Screen', 'Brightness',
            ]),
            null,
            this.Gio.DBusCallFlags.NONE,
            3000,
            this.cancellable,
            (connection, result) => {
                if (this.destroyed)
                    return;
                try {
                    const value = connection.call_finish(result)
                        .get_child_value(0).get_variant().get_int32();
                    this._updateBrightness(value);
                } catch {
                    this._disableBrightness();
                }
            });
    }

    _updateBrightness(value) {
        if (!Number.isFinite(value))
            return this._disableBrightness();
        this.brightness = Math.max(0, Math.min(100, Math.round(value)));
        this.syncingBrightness = true;
        this.brightnessSlider.value = this.brightness / 100;
        this.syncingBrightness = false;
        this.brightnessSlider.reactive = true;
        this.brightnessSlider.can_focus = true;
        this.brightnessInfo.label.text = `Luminosité : ${this.brightness} %`;
    }

    _disableBrightness() {
        this.brightness = null;
        this.brightnessSlider.reactive = false;
        this.brightnessSlider.can_focus = false;
        this.brightnessInfo.label.text = 'Réglage de luminosité indisponible';
    }

    _writeBrightness() {
        if (this.syncingBrightness || this.destroyed || this.brightness === null)
            return;
        this.brightness = Math.round(Math.max(0, Math.min(1, this.brightnessSlider.value)) * 100);
        this.brightnessInfo.label.text = `Luminosité : ${this.brightness} %`;
        if (this.brightnessWriteSource)
            this.GLib.source_remove(this.brightnessWriteSource);
        this.brightnessWriteSource = this.GLib.timeout_add(this.GLib.PRIORITY_DEFAULT, 80, () => {
            this.brightnessWriteSource = 0;
            const value = new this.GLib.Variant('i', this.brightness);
            this.Gio.DBus.session.call(
                'org.gnome.SettingsDaemon.Power',
                '/org/gnome/SettingsDaemon/Power',
                'org.freedesktop.DBus.Properties',
                'Set',
                new this.GLib.Variant('(ssv)', [
                    'org.gnome.SettingsDaemon.Power.Screen', 'Brightness', value,
                ]),
                null,
                this.Gio.DBusCallFlags.NONE,
                3000,
                this.cancellable,
                (connection, result) => {
                    if (this.destroyed)
                        return;
                    try {
                        connection.call_finish(result);
                    } catch {
                        this._disableBrightness();
                    }
                });
            return this.GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this.destroyed = true;
        if (this.brightnessWriteSource)
            this.GLib.source_remove(this.brightnessWriteSource);
        this.cleanup.clear();
        this.cancellable.cancel();
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
    }

    alignDeviceRows(actor = this.saved?.actor) {
        alignMenuRows(actor, this.Clutter);
    }

    mount(nativeMenu, notifyOpen = true) {
        this.restore();
        const actor = nativeMenu?.box;
        const parent = actor?.get_parent();
        if (!parent)
            return false;
        const index = parent.get_children().indexOf(actor);
        this.saved = {actor, parent, index, nativeMenu, notifyOpen, wasOpen: Boolean(nativeMenu.isOpen)};
        parent.remove_child(actor);
        actor.add_style_class_name('g-os-status-native-content');
        this.holder.add_child(actor);
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

    restore() {
        if (!this.saved)
            return;
        const {actor, parent, index, nativeMenu, notifyOpen, wasOpen} = this.saved;
        this.mountCleanup?.clear();
        this.mountCleanup = null;
        actor.get_parent()?.remove_child(actor);
        actor.remove_style_class_name('g-os-status-native-content');
        parent.insert_child_at_index(actor, index);
        this.saved = null;
        nativeMenu.isOpen = wasOpen;
        if (notifyOpen)
            this.onClose();
    }
}

export class RadioStatusMenu {
    [key: string]: any;
    constructor(menu, icon, {toggle, title, St, Clutter, PopupMenu, openSettings, deviceChangeSignal = null}) {
        this.menu = menu;
        this.icon = icon;
        this.toggle = toggle;
        this.cleanup = new CleanupManager();
        this.header = new PopupMenu.PopupSwitchMenuItem(title, Boolean(toggle?.checked));
        this.header.setSensitive(Boolean(toggle) && toggle.visible !== false && toggle.reactive !== false);
        this.cleanup.addSignal(this.header, this.header.connect('toggled', (actor, checked) => {
            if (toggle && checked !== Boolean(toggle.checked))
                toggle.emit('clicked', 1);
        }));
        menu.addMenuItem(this.header);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.holder = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        item.add_child(this.holder);
        menu.addMenuItem(item);
        this.content = new NativeMenuContent(menu, this.holder, {Clutter,
            onOpen: () => {
                toggle?._startScanning?.();
                toggle?._reorderDeviceItems?.();
            },
            onClose: () => toggle?._stopScanning?.(),
        });
        if (!toggle) {
            const unavailable = new PopupMenu.PopupMenuItem('Service indisponible', {reactive: false, can_focus: false});
            menu.addMenuItem(unavailable);
        }
        this.settingsSeparator = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(this.settingsSeparator);
        this.settingsItem = menu.addAction(`Parametres ${title}`, openSettings);
        if (deviceChangeSignal && toggle?._client)
            this.cleanup.addSignal(toggle._client,
                toggle._client.connect(deviceChangeSignal, () => this.content.alignDeviceRows()));
        if (toggle) {
            for (const signal of ['notify::checked', 'notify::icon-name', 'notify::visible', 'notify::reactive'])
                this.cleanup.addSignal(toggle, toggle.connect(signal, () => this.refresh()));
        }
        this.cleanup.addSignal(menu, menu.connect('open-state-changed', (actor, open) => {
            if (open) {
                const mounted = this.content.mount(toggle?.menu, Boolean(toggle) && toggle.visible !== false);
                this.settingsItem.visible = !mounted;
                this.settingsSeparator.visible = !mounted;
                this.refresh();
            } else
                this.content.restore();
        }));
        this.refresh();
    }

    refresh() {
        this.header.setToggleState(Boolean(this.toggle?.checked));
        this.header.setSensitive(Boolean(this.toggle) && this.toggle.visible !== false && this.toggle.reactive !== false);
        if (this.toggle?.icon_name)
            this.icon.icon_name = this.toggle.icon_name;
    }

    destroy() {
        this.content.restore();
        this.cleanup.clear();
    }
}

export class BatteryStatusMenu {
    [key: string]: any;
    constructor(menu, icon, {powerToggle, profiles, deviceClient, batteryKind, levelLabel, showLevel = false,
        St, Clutter, PopupMenu, openSettings}) {
        this.menu = menu;
        this.icon = icon;
        this.levelLabel = levelLabel;
        this.showLevel = showLevel;
        this.powerToggle = powerToggle;
        this.Clutter = Clutter;
        this.proxy = powerToggle?._proxy;
        this.profiles = profiles;
        this.PopupMenu = PopupMenu;
        this.deviceClient = deviceClient;
        this.batteryKind = batteryKind;
        this.devices = [];
        this.cleanup = new CleanupManager();
        this.deviceConnections = new Map();
        this.percentage = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this.state = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this.percentage.add_style_class_name('g-os-status-info');
        this.state.add_style_class_name('g-os-status-info');
        menu.addMenuItem(this.percentage);
        menu.addMenuItem(this.state);
        this.deviceHeading = new PopupMenu.PopupMenuItem('Batteries détectées', {reactive: false, can_focus: false});
        this.deviceHeading.visible = false;
        this.deviceItems = new PopupMenu.PopupMenuSection();
        menu.addMenuItem(this.deviceHeading);
        menu.addMenuItem(this.deviceItems);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Mode d\u2019alimentation'));
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.holder = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        item.add_child(this.holder);
        menu.addMenuItem(item);
        this.content = new NativeMenuContent(menu, this.holder, {Clutter});
        if (!profiles) {
            const unavailable = new PopupMenu.PopupMenuItem('Profils indisponibles', {reactive: false, can_focus: false});
            menu.addMenuItem(unavailable);
        }
        this.settingsSeparator = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(this.settingsSeparator);
        this.settingsItem = menu.addAction('Parametres d\u2019alimentation', openSettings);
        if (this.proxy)
            this.cleanup.addSignal(this.proxy, this.proxy.connect('g-properties-changed', () => this.refresh()));
        if (deviceClient) {
            try {
                this.devices = deviceClient.get_devices2() ?? [];
            } catch {
                this.devices = [];
            }
            this.cleanup.addSignal(deviceClient, deviceClient.connect('device-added', (client, device) => {
                if (!this.devices.includes(device))
                    this.devices.push(device);
                this.refresh();
            }));
            this.cleanup.addSignal(deviceClient, deviceClient.connect('device-removed', (client, objectPath) => {
                this.devices = this.devices.filter(device => device.get_object_path() !== objectPath);
                this.refresh();
            }));
        }
        this.cleanup.addSignal(menu, menu.connect('open-state-changed', (actor, open) => {
            if (open) {
                const mounted = this.content.mount(profiles?.menu);
                this.settingsItem.visible = !mounted;
                this.settingsSeparator.visible = !mounted;
                this.refresh();
            } else
                this.content.restore();
        }));
        this.refresh();
    }

    refresh() {
        const batteries = this.syncDevices();
        const proxy = this.proxy;
        const primary = batteries.find(device => device.power_supply) ?? batteries[0];
        const proxyPercentage = proxy?.IsPresent ? Number(proxy.Percentage) : Number.NaN;
        const levelPercentage = Number.isFinite(proxyPercentage) ? proxyPercentage
            : primary ? Number(primary.percentage) : Number.NaN;
        if (this.levelLabel) {
            this.levelLabel.text = Number.isFinite(levelPercentage) ? `${Math.round(levelPercentage)}%` : '';
            this.levelLabel.visible = this.showLevel && Number.isFinite(levelPercentage);
        }
        this.percentage.visible = batteries.length === 0;
        this.state.visible = batteries.length === 0;
        this.deviceHeading.visible = batteries.length > 0;
        if (primary)
            this.icon.icon_name = proxy?.IconName || primary.icon_name || 'battery-good-symbolic';
        if (!proxy?.IsPresent) {
            this.percentage.label.text = batteries.length ? '' : 'Aucune batterie';
            this.state.label.text = batteries.length ? '' : 'Alimentation secteur';
            if (!batteries.length)
                this.icon.icon_name = 'battery-missing-symbolic';
            return;
        }
        this.percentage.label.text = `Batterie : ${Math.round(proxy.Percentage)} %`;
        const states = ['Etat inconnu', 'En charge', 'Sur batterie', 'Batterie vide', 'Charge complete', 'Charge en attente', 'Decharge en attente'];
        const seconds = proxy.State === 1 ? proxy.TimeToFull : proxy.State === 2 ? proxy.TimeToEmpty : 0;
        const minutes = Math.max(0, Math.round(Number(seconds) / 60));
        const time = minutes > 0 ? ` - ${Math.floor(minutes / 60)} h ${minutes % 60} min` : '';
        this.state.label.text = `${states[proxy.State] ?? states[0]}${time}`;
        const percentage = Number(proxy.Percentage);
        const level = proxy.State === 3 ? 'empty' : percentage >= 95 ? 'full' : percentage >= 60 ? 'good'
            : percentage >= 20 ? 'caution' : percentage > 0 ? 'low' : 'empty';
        const fallbackIcon = proxy.State === 4 ? 'battery-full-charged-symbolic'
            : `battery-${level}${proxy.State === 1 ? '-charging' : ''}-symbolic`;
        this.icon.icon_name = proxy.IconName || fallbackIcon;
    }

    syncDevices() {
        const batteryDevices = this.devices.filter(device =>
            (device.kind === this.batteryKind || device.is_rechargeable));
        const batteries = batteryDevices.filter(device => device.is_present);
        const currentDevices = new Set(batteryDevices);
        for (const [device, signals] of this.deviceConnections) {
            if (currentDevices.has(device))
                continue;
            signals.clear();
            this.deviceConnections.delete(device);
        }
        for (const device of batteries) {
            if (this.deviceConnections.has(device))
                continue;
            const cleanup = new CleanupManager();
            for (const signal of ['notify::percentage', 'notify::state', 'notify::is-present', 'notify::kind',
                'notify::model', 'notify::vendor', 'notify::native-path', 'notify::power-supply',
                'notify::icon-name', 'notify::time-to-empty', 'notify::time-to-full'])
                cleanup.addSignal(device, device.connect(signal, () => this.refresh()));
            this.deviceConnections.set(device, cleanup);
        }
        this.deviceItems.removeAll();
        const states = ['Etat inconnu', 'En charge', 'Sur batterie', 'Batterie vide', 'Charge complete',
            'Charge en attente', 'Decharge en attente'];
        batteries.forEach((device, index) => {
            const percentage = Number(device.percentage);
            const charge = Number.isFinite(percentage) ? `${Math.round(percentage)} %` : 'inconnue';
            const seconds = device.state === 1 ? device.time_to_full : device.state === 2 ? device.time_to_empty : 0;
            const minutes = Math.max(0, Math.round(Number(seconds) / 60));
            const time = minutes > 0 ? ` - ${Math.floor(minutes / 60)} h ${minutes % 60} min` : '';
            const model = [device.vendor, device.model].filter(Boolean).join(' ') || `Batterie ${index + 1}`;
            const category = /\/org\/bluez\//i.test(device.native_path ?? '') ? 'Bluetooth'
                : device.power_supply ? 'Interne' : 'Périphérique';
            this.deviceItems.addMenuItem(new this.PopupMenu.PopupMenuItem(`${category} : ${model} - ${charge} - ${states[device.state] ?? states[0]}${time}`, {
                reactive: false, can_focus: false,
            }));
        });
        alignMenuRows(this.deviceItems.actor, this.Clutter);
        return batteries;
    }

    destroy() {
        this.content.restore();
        this.cleanup.clear();
        for (const cleanup of this.deviceConnections.values())
            cleanup.clear();
        this.deviceConnections.clear();
        this.devices = [];
        this.deviceClient?.dispose?.();
    }
}

export function createPowerDeviceClient(Gio) {
    const devices = new Map();
    const handlers = new Map();
    let nextHandler = 0;
    const emit = (signal, ...args) => {
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
            if (devices.has(objectPath))
                return;
            try {
                const device = createDevice(objectPath);
                devices.set(objectPath, device);
                emit('device-added', device);
            } catch {}
        };
        rootSignal = root.connect('g-signal', (_proxy, _sender, signal, parameters) => {
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