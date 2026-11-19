import {DbusMenuClient} from './dbusMenu.js';
import {alignMenuRows} from './panelStatusMenus.js';
import {CleanupManager} from '../core/cleanupManager.js';
import {applyPanelButtonMetrics, createPanelButton} from './panelButton.js';
import {applyNativeMenuTheme} from './menuTheme.js';

export function isGlobalMenuActionEnabled(group, action, target) {
    if (!group?.has_action(action) || !group.get_action_enabled(action))
        return false;
    const parameter = group.get_action_parameter_type(action);
    return parameter ? Boolean(target?.is_of_type(parameter)) : !target;
}

export class GtkGlobalMenu {
    [key: string]: any;

    constructor(container, {Gio, GLib, St, Clutter, PopupMenu, menuManager, uiGroup, registrar = null,
        timestamp = () => 0, stylePrefix = 'g-os', getButtonMetrics = () => null}) {
        Object.assign(this, {container, Gio, GLib, St, Clutter, PopupMenu, menuManager, uiGroup, registrar,
            timestamp, stylePrefix, getButtonMetrics});
        this.window = null;
        this.windowCleanup = new CleanupManager();
        this.registrarCleanup = new CleanupManager();
        this.remoteSignals = [];
        this.buttons = [];
        this.models = [];
        this.groups = {};
        this.generation = 0;
        this.idle = 0;
        this.watcher = 0;
        this.disposed = false;
        this.refreshing = false;
        this.requestedMenu = null;
        this.requestedSubmenus = new Set();
        this.submenus = [];
        this.dbusClient = null;
        this.backend = null;
        if (registrar) {
            this.registrarCleanup.addSignal(registrar, registrar.connect('changed', (_registrar, windowId) => {
                if (registrar.windowId(this.window) === windowId)
                    this._load();
            }));
        }
        container.hide();
    }

    setWindow(window) {
        if (window && typeof window.connect !== 'function')
            window = null;
        if (this.disposed || this.window === window)
            return;
        this._disconnectWindow();
        this.window = window;
        if (window) {
            for (const signal of ['notify::gtk-unique-bus-name', 'notify::gtk-menubar-object-path',
                'notify::gtk-app-menu-object-path', 'notify::gtk-application-object-path', 'notify::gtk-window-object-path'])
                this.windowCleanup.addSignal(window, window.connect(signal, () => this._load()));
            this.windowCleanup.addSignal(window, window.connect('unmanaged', () => this.setWindow(null)));
        }
        this._load();
    }

    _disconnectWindow() {
        this.windowCleanup.clear();
        this.windowCleanup = new CleanupManager();
    }

    _clearButtons() {
        for (const {button, menu} of this.buttons) {
            menu.close({animate: false});
            this.menuManager.removeMenu(menu);
            menu.destroy();
            this.container.remove_child(button);
            button.destroy();
        }
        this.buttons = [];
        this.submenus = [];
        this.container.hide();
    }

    _clearRemote() {
        this.generation++;
        this.requestedMenu = null;
        this.requestedSubmenus.clear();
        if (this.idle)
            this.GLib.source_remove(this.idle);
        this.idle = 0;
        if (this.watcher)
            this.Gio.bus_unwatch_name(this.watcher);
        this.watcher = 0;
        for (const [object, signal] of this.remoteSignals)
            object.disconnect(signal);
        this.remoteSignals = [];
        this.dbusClient?.destroy();
        this.dbusClient = null;
        this.backend = null;
        this.models = [];
        this.groups = {};
        this._clearButtons();
    }

    _load() {
        this._clearRemote();
        const window = this.window;
        const bus = window?.get_gtk_unique_bus_name?.();
        const applicationMenu = window?.get_gtk_app_menu_object_path?.();
        const menubar = window?.get_gtk_menubar_object_path?.();
        if (this.disposed)
            return;
        if (!bus || (!applicationMenu && !menubar)) {
            const entry = this.registrar?.getForWindow(window);
            if (entry) {
                this.dbusClient = new DbusMenuClient(entry.bus, entry.path,
                    {Gio: this.Gio, GLib: this.GLib, timestamp: this.timestamp});
                this.backend = 'dbusmenu';
                this.groups.dbus = this.dbusClient.actions;
                this.models = [{kind: 'menubar', model: this.dbusClient.model}];
                this.watcher = this.Gio.bus_watch_name_on_connection(this.Gio.DBus.session, entry.bus,
                    this.Gio.BusNameWatcherFlags.NONE, null, () => this._clearRemote());
                this._refresh();
            }
            return;
        }
        this.backend = 'gtk';
        const paths = {app: window.get_gtk_application_object_path?.(), win: window.get_gtk_window_object_path?.()};
        for (const [prefix, path] of Object.entries(paths)) {
            if (!path)
                continue;
            const group = this.Gio.DBusActionGroup.get(this.Gio.DBus.session, bus, path);
            this.groups[prefix] = group;
            for (const signal of ['action-added', 'action-removed', 'action-enabled-changed', 'action-state-changed'])
                this.remoteSignals.push([group, group.connect(signal, () => this._queueRefresh())]);
        }
        for (const [kind, path] of [['application', applicationMenu], ['menubar', menubar]]) {
            if (path)
                this.models.push({kind, model: this.Gio.DBusMenuModel.get(this.Gio.DBus.session, bus, path)});
        }
        this.watcher = this.Gio.bus_watch_name_on_connection(this.Gio.DBus.session, bus,
            this.Gio.BusNameWatcherFlags.NONE, null, () => this._clearRemote());
        this._refresh();
    }

    _queueRefresh() {
        if (this.disposed || this.idle)
            return;
        this.idle = this.GLib.idle_add(this.GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.idle = 0;
            this._refresh();
            return this.GLib.SOURCE_REMOVE;
        });
    }

    _attribute(model, index, name) {
        return model.get_item_attribute_value(index, name, null);
    }

    _label(model, index) {
        const text = this._attribute(model, index, 'label')?.deep_unpack();
        return typeof text === 'string' ? text.replace(/__/g, '\u0000').replace(/_/g, '').replace(/\u0000/g, '_') : '';
    }

    _watchModel(model, visited = new Set(), depth = 0) {
        if (!model || visited.has(model) || visited.size >= 256 || depth > 8)
            return;
        visited.add(model);
        if (!this.remoteSignals.some(([object]) => object === model))
            this.remoteSignals.push([model, model.connect('items-changed', () => this._queueRefresh())]);
        for (let index = 0; index < Math.min(model.get_n_items(), 128); index++) {
            for (const link of ['section', 'submenu'])
                this._watchModel(model.get_item_link(index, link), visited, depth + 1);
        }
    }

    _fill(menu, model, depth = 0) {
        if (!model || depth > 8 || this.remainingItems <= 0)
            return;
        for (let index = 0; index < Math.min(model.get_n_items(), 128); index++) {
            if (this.remainingItems-- <= 0)
                break;
            if (this._attribute(model, index, 'x-dbusmenu-type')?.deep_unpack() === 'separator') {
                menu.addMenuItem(new this.PopupMenu.PopupSeparatorMenuItem());
                continue;
            }
            const section = model.get_item_link(index, 'section');
            if (section) {
                if (index > 0)
                    menu.addMenuItem(new this.PopupMenu.PopupSeparatorMenuItem());
                this._fill(menu, section, depth + 1);
                continue;
            }
            const label = this._label(model, index);
            if (!label)
                continue;
            const submenu = model.get_item_link(index, 'submenu');
            if (submenu) {
                const item = new this.PopupMenu.PopupSubMenuMenuItem(label);
                applyNativeMenuTheme(item.menu, `${this.stylePrefix}-popup-submenu`);
                item.setSensitive(this._attribute(model, index, 'x-dbusmenu-enabled')?.deep_unpack() !== false);
                const open = item.menu.open.bind(item.menu);
                item.menu.open = (...args) => {
                    if (typeof submenu.id === 'number')
                        this.requestedSubmenus.add(submenu.id);
                    submenu.aboutToShow?.();
                    return open(...args);
                };
                item.menu.connect('open-state-changed', (_menu, open) => {
                    if (!open && !this.refreshing)
                        this.requestedSubmenus.delete(submenu.id);
                });
                this.submenus.push({menu: item.menu, model: submenu});
                menu.addMenuItem(item);
                this._fill(item.menu, submenu, depth + 1);
                continue;
            }
            const item = new this.PopupMenu.PopupMenuItem(label);
            const detailed = this._attribute(model, index, 'action')?.deep_unpack();
            const target = this._attribute(model, index, 'target');
            const separator = typeof detailed === 'string' ? detailed.indexOf('.') : -1;
            const prefix = separator > 0 ? detailed.slice(0, separator) : '';
            const action = separator > 0 ? detailed.slice(separator + 1) : '';
            const group = this.groups[prefix];
            const enabled = isGlobalMenuActionEnabled(group, action, target);
            item.setSensitive(enabled);
            if (enabled) {
                const state = group.get_action_state(action);
                if (state?.get_type_string() === 'b' && state.deep_unpack())
                    item.setOrnament(this._attribute(model, index, 'x-dbusmenu-toggle-type')?.deep_unpack() === 'radio'
                        ? this.PopupMenu.Ornament.DOT : this.PopupMenu.Ornament.CHECK);
                else if (target && state?.equal(target))
                    item.setOrnament(this.PopupMenu.Ornament.DOT);
            }
            const accelerator = this._attribute(model, index, 'accel')?.deep_unpack();
            if (typeof accelerator === 'string')
                item.add_child(new this.St.Label({text: accelerator, style_class: 'popup-menu-accel-label',
                    x_expand: true, x_align: this.Clutter.ActorAlign.END}));
            const generation = this.generation;
            item.connect('activate', () => {
                if (this.disposed || generation !== this.generation ||
                    !isGlobalMenuActionEnabled(group, action, target))
                    return;
                group.activate_action(action, target ?? null);
            });
            menu.addMenuItem(item);
        }
        alignMenuRows(menu.box, this.Clutter);
    }

    _addButton(label, model, enabled = true) {
        const button = createPanelButton(this.St, this.Clutter, {
            text: label, styleClass: `${this.stylePrefix}-global-menu-button`,
            accessibleName: label, canFocus: enabled, reactive: enabled,
        });
        button.opacity = enabled ? 255 : 100;
        const metrics = this.getButtonMetrics();
        if (metrics)
            applyPanelButtonMetrics(button, metrics);
        const menu = new this.PopupMenu.PopupMenu(button, 0, this.St.Side.TOP);
        const scrollView = new this.St.ScrollView({
            hscrollbar_policy: this.St.PolicyType.AUTOMATIC,
            vscrollbar_policy: this.St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
        });
        menu._boxPointer.bin.set_child(null);
        scrollView.set_child(menu.box);
        menu._boxPointer.bin.set_child(scrollView);
        applyNativeMenuTheme(menu, `${this.stylePrefix}-popup`);
        this.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        this.menuManager.addMenu(menu);
        this._fill(menu, model);
        const open = menu.open.bind(menu);
        menu.open = (...args) => {
            this.requestedMenu = label;
            model.aboutToShow?.();
            return open(...args);
        };
        menu.connect('open-state-changed', (_menu, open) => {
            if (!open && !this.refreshing && this.requestedMenu === label)
                this.requestedMenu = null;
        });
        button.connect('clicked', () => menu.toggle());
        button.connect('popup-menu', () => menu.open());
        this.container.add_child(button);
        this.buttons.push({button, menu, label});
    }

    _refresh() {
        if (this.disposed)
            return;
        this.generation++;
        this.remainingItems = 4096;
        const open = this.buttons.find(entry => entry.menu.isOpen)?.label ?? this.requestedMenu;
        this.refreshing = true;
        this._clearButtons();
        const visited = new Set();
        for (const {kind, model} of this.models) {
            this._watchModel(model, visited);
            if (model.get_n_items() === 0)
                continue;
            if (kind === 'application') {
                this._addButton('Application', model);
                continue;
            }
            for (let index = 0; index < Math.min(model.get_n_items(), 32); index++) {
                const label = this._label(model, index);
                const submenu = model.get_item_link(index, 'submenu');
                if (label && submenu)
                    this._addButton(label, submenu, this._attribute(model, index, 'x-dbusmenu-enabled')?.deep_unpack() !== false);
            }
        }
        for (let index = this.remoteSignals.length - 1; index >= 0; index--) {
            const [object, signal] = this.remoteSignals[index];
            if (typeof object.get_n_items === 'function' && !visited.has(object)) {
                object.disconnect(signal);
                this.remoteSignals.splice(index, 1);
            }
        }
        if (this.buttons.length)
            this.container.show();
        this.refreshing = false;
        this.buttons.find(entry => entry.label === open)?.menu.open();
        for (const {menu, model} of this.submenus) {
            if (this.requestedSubmenus.has(model.id) && model.get_n_items() > 0)
                menu.open(false);
        }
    }

    destroy() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.registrarCleanup.clear();
        this._disconnectWindow();
        this._clearRemote();
        this.window = null;
    }
}