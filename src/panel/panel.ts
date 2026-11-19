import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import {SoundStatusMenu, RadioStatusMenu, BatteryStatusMenu, DisplayStatusMenu,
    createPowerDeviceClient, alignMenuRows} from './panelStatusMenus.js';
import {GtkGlobalMenu} from './globalMenu.js';
import {applyNativeMenuTheme} from './menuTheme.js';
import {createStatusNotifierPixbuf} from './statusNotifier.js';
import {DbusMenuClient} from './dbusMenu.js';
import {resolveInsertionIndex} from '../shared/geometry/insertion.js';
import {CleanupManager} from '../core/cleanupManager.js';
import {calculatePanelButtonMetrics, calculatePanelLabelFontSize, applyPanelButtonMetrics, createPanelButton, createPanelMenuButton} from './panelButton.js';

const PANEL_LAYOUT_GROUPS = ['left', 'center', 'right'];
const DEFAULT_PANEL_LAYOUT = [
    'left:launcher', 'left:application', 'left:global-menu', 'left:transfer',
    'center:clock',
    'right:search', 'right:preferences', 'right:notifications', 'right:tray',
    'right:wifi', 'right:bluetooth', 'right:sound', 'right:brightness', 'right:battery', 'right:session',
];

type NativeDateMenu = typeof Main.panel.statusArea.dateMenu & {
    _calendar?: Clutter.Actor;
    _eventSource?: any;
};

type QuickSettingsInternals = {
    _network?: {_wirelessToggle?: unknown};
    _bluetooth?: {quickSettingsItems?: unknown[]};
    _system?: {_systemItem?: {powerToggle?: unknown; _powerToggle?: unknown};
        quickSettingsItems?: {powerToggle?: unknown}[]};
    _powerProfiles?: {_powerProfilesToggle?: unknown};
};

type StatusButton = St.Button & {
    statusKind: string;
    statusIcon: St.Icon;
    batteryLevelLabel?: St.Label;
    statusMenu: PopupMenu.PopupMenu;
    statusController: {adjustVolume?: (direction: Clutter.ScrollDirection) => void};
};

class StatusNotifierMenu {
    [key: string]: any;

    constructor(button, item) {
        this.button = button;
        this.path = item.properties.Menu;
        this.client = new DbusMenuClient(item.bus, this.path,
            {Gio, GLib, timestamp: () => global.get_current_time()});
        this.menu = new PopupMenu.PopupMenu(button, 0.5, St.Side.TOP);
        applyNativeMenuTheme(this.menu, 'g-os-popup');
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        Main.panel.menuManager.addMenu(this.menu);
        this.cleanup = new CleanupManager();
        this.cleanup.addSignal(this.client.model,
            this.client.model.connect('items-changed', () => this.refresh()));
        this.cleanup.addSignal(this.menu, this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this.client.model.aboutToShow();
                this.client.refresh();
                this.refresh();
            }
        }));
        this.refresh();
    }

    _attribute(model, index, name) {
        return model.get_item_attribute_value(index, name)?.deep_unpack();
    }

    _fill(menu, model, depth = 0) {
        if (depth > 8)
            return;
        for (let index = 0; index < Math.min(model.get_n_items(), 128); index++) {
            if (this._attribute(model, index, 'x-dbusmenu-type') === 'separator') {
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                continue;
            }
            const rawLabel = this._attribute(model, index, 'label');
            if (!rawLabel)
                continue;
            const label = rawLabel.replace(/__/g, '\u0000').replace(/_/g, '').replace(/\u0000/g, '_');
            const enabled = this._attribute(model, index, 'x-dbusmenu-enabled') !== false;
            const submenu = model.get_item_link(index, 'submenu');
            if (submenu) {
                const entry = new PopupMenu.PopupSubMenuMenuItem(label);
                applyNativeMenuTheme(entry.menu, 'g-os-popup-submenu');
                entry.setSensitive(enabled);
                entry.menu.connect('open-state-changed', (_menu, open) => {
                    if (open) {
                        submenu.aboutToShow?.();
                        this.client.refresh();
                    }
                });
                this._fill(entry.menu, submenu, depth + 1);
                menu.addMenuItem(entry);
                continue;
            }
            const entry = new PopupMenu.PopupMenuItem(label);
            const action = this._attribute(model, index, 'action');
            const actionId = typeof action === 'string' && action.startsWith('dbus.')
                ? action.slice(5) : '';
            entry.setSensitive(enabled && Boolean(actionId) && this.client.actions.get_action_enabled(actionId));
            const state = actionId ? this.client.actions.get_action_state(actionId) : null;
            if (state?.get_type_string() === 'b' && state.deep_unpack())
                entry.setOrnament(this._attribute(model, index, 'x-dbusmenu-toggle-type') === 'radio'
                    ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.CHECK);
            entry.connect('activate', () => {
                if (actionId)
                    this.client.actions.activate_action(actionId);
            });
            menu.addMenuItem(entry);
        }
        alignMenuRows(menu.box, Clutter);
    }

    refresh() {
        if (!this.menu || this.client.disposed)
            return;
        this.menu.removeAll();
        this._fill(this.menu, this.client.model);
    }

    toggle() {
        this.menu.toggle();
    }

    open() {
        this.menu.open();
    }

    destroy() {
        if (!this.menu)
            return;
        this.cleanup.clear();
        this.menu.close({animate: false});
        Main.panel.menuManager.removeMenu(this.menu);
        this.menu.destroy();
        this.client.destroy();
        this.menu = null;
        this.client = null;
    }
}

export function withPanel(Base) {
    return class extends Base {
        _applyNotificationPosition() {
            const tray = Main.messageTray as typeof Main.messageTray & {_bannerBin?: St.Widget};
            const banner = tray._bannerBin;
            if (!banner)
                return;
            if (!this._notificationPosition) {
                const parent = banner.get_parent();
                if (!parent)
                    return;
                const index = parent.get_children().indexOf(banner);
                const container = new St.Widget({layout_manager: new Clutter.BinLayout(),
                    x_expand: true, y_expand: true, reactive: false});
                parent.remove_child(banner);
                container.add_child(banner);
                parent.insert_child_at_index(container, index);
                this._notificationPosition = {banner, parent, index, container};
            }
            const start = Clutter.ActorAlign.START;
            const center = Clutter.ActorAlign.CENTER;
            const end = Clutter.ActorAlign.END;
            const positions = [[center, start], [start, start], [end, start],
                [start, center], [center, center], [end, center],
                [start, end], [center, end], [end, end]];
            const [x, y] = positions[this._settings.get_int('notification-position')] ?? positions[0];
            this._notificationPosition.container.x_align = x;
            this._notificationPosition.container.y_align = y;
        }

        _restoreNotificationPosition() {
            const state = this._notificationPosition;
            if (!state)
                return;
            state.container.remove_child(state.banner);
            state.parent.remove_child(state.container);
            state.parent.insert_child_at_index(state.banner, state.index);
            state.container.destroy();
            this._notificationPosition = null;
        }

        _populateNotificationMenu(menu) {
            menu.removeAll();
            const notifications = Main.messageTray.getSources().flatMap(source => source.notifications ?? []);
            if (!notifications.length) {
                menu.addAction('Aucune notification', () => {}).setSensitive(false);
                return;
            }
            for (const notification of notifications) {
                const title = notification.title || notification.source?.title || 'Notification';
                const item = menu.addAction(notification.body ? `${title}\n${notification.body}` : title, () => {
                    if (Main.messageTray.getSources().some(source => source.notifications?.includes(notification)))
                        notification.activate();
                });
                if (item.label.clutter_text) {
                    item.label.clutter_text.line_wrap = true;
                    item.label.set_style('max-width: 360px;');
                }
            }
            menu.addAction('Tout effacer', () => {
                for (const source of Main.messageTray.getSources()) {
                    for (const notification of [...(source.notifications ?? [])])
                        notification.destroy();
                }
            });
        }

        _updatePanelNotificationVisibility(screen) {
            screen.notificationButton.container.visible = this._settings.get_boolean('panel-show-notifications') &&
                Main.messageTray.getSources().some(source => source.notifications?.length > 0);
            if (!screen.notificationButton.container.visible)
                screen.notificationMenu.close();
        }

        _updatePanelNotifications() {
            for (const screen of this._screens ?? []) {
                if (!screen.notificationButton)
                    continue;
                this._updatePanelNotificationVisibility(screen);
                if (screen.notificationMenu?.isOpen)
                    this._populateNotificationMenu(screen.notificationMenu);
            }
        }

        _createNotificationButton(screen) {
            const button = createPanelMenuButton(St, Clutter, PopupMenu, Main.uiGroup, {
                iconName: 'preferences-system-notifications-symbolic',
                accessibleName: 'Notifications',
            });
            const menu = button.menu as PopupMenu.PopupMenu;
            screen.notificationButton = button;
            screen.notificationMenu = menu;
            screen.notificationIcon = button.panelIcon;
            this._updatePanelNotificationVisibility(screen);
            applyNativeMenuTheme(menu, 'g-os-popup');
            if (menu._boxPointer?.bin) {
                const scroll = new St.ScrollView({vscrollbar_policy: St.PolicyType.AUTOMATIC,
                    hscrollbar_policy: St.PolicyType.NEVER});
                menu._boxPointer.bin.set_child(null);
                scroll.set_child(menu.box);
                menu._boxPointer.bin.set_child(scroll);
                screen.notificationScroll = scroll;
            }
            this._populateNotificationMenu(menu);
            menu.connect('open-state-changed', (menu, open) => {
                if (!open)
                    return;
                this._populateNotificationMenu(menu);
                alignMenuRows(menu.box, Clutter);
            });
            Main.panel.menuManager.addMenu(menu);
            screen.panel.add_child(button.container);
        }

        _updatePanelCalendarEvents(screen, selectedDate = new Date()) {
            if (!screen.calendarEventSource || !screen.calendarEventList)
                return;
            const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
            const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
            screen.calendarSelectedDate = start;
            screen.calendarEventHeading.text = selectedDate.toLocaleDateString(undefined,
                {weekday: 'long', day: 'numeric', month: 'long'});
            screen.calendarEventList.destroy_all_children();
            const events = screen.calendarEventSource.getEvents(start, end);
            if (!events.length) {
                screen.calendarEventList.add_child(new St.Label({text: 'Aucun événement',
                    style_class: 'g-os-calendar-empty'}));
                return;
            }
            for (const event of events) {
                const row = new St.BoxLayout({style_class: 'g-os-calendar-event',
                    orientation: Clutter.Orientation.VERTICAL, x_expand: true});
                const summary = new St.Label({text: event.summary || 'Événement',
                    style_class: 'g-os-calendar-event-title', x_expand: true});
                summary.clutter_text.line_wrap = true;
                summary.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                const allDay = event.date.getHours() === 0 && event.date.getMinutes() === 0 &&
                    event.end.getHours() === 0 && event.end.getMinutes() === 0;
                const time = allDay ? 'Toute la journée' : [event.date, event.end]
                    .map(date => date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}))
                    .join(' - ');
                row.add_child(summary);
                row.add_child(new St.Label({text: time, style_class: 'g-os-calendar-event-time'}));
                screen.calendarEventList.add_child(row);
            }
        }

        _restorePanelCalendar() {
            const calendar = this._panelCalendarWidget;
            const parent = this._panelCalendarOriginalParent;
            if (calendar && parent) {
                calendar.get_parent()?.remove_child(calendar);
                parent.insert_child_at_index(calendar, this._panelCalendarOriginalIndex);
            }
            this._panelCalendarCleanup?.clear();
            this._panelCalendarCleanup = null;
            this._panelCalendarWidget = null;
            this._panelCalendarOriginalParent = null;
            this._panelCalendarOriginalIndex = -1;
            this._panelCalendarEventSource = null;
        }

        _attachPanelCalendar(screen) {
            const calendar = screen.calendar;
            if (!calendar)
                return;
            const parent = calendar.get_parent();
            if (!this._panelCalendarWidget) {
                this._panelCalendarWidget = calendar;
                this._panelCalendarOriginalParent = parent;
                this._panelCalendarOriginalIndex = parent.get_children().indexOf(calendar);
                this._panelCalendarEventSource = screen.calendarEventSource;
                this._panelCalendarCleanup = new CleanupManager();
                this._panelCalendarCleanup.addSignal(calendar,
                    calendar.connect('selected-date-changed', (actor, dateTime) => {
                    const selectedDate = new Date(dateTime.to_unix() * 1000);
                    this._panelCalendarSelectedDate = selectedDate;
                    for (const candidate of this._screens)
                        this._updatePanelCalendarEvents(candidate, selectedDate);
                }));
                this._panelCalendarCleanup.addSignal(screen.calendarEventSource,
                    screen.calendarEventSource.connect('changed', () => {
                        for (const candidate of this._screens)
                            this._updatePanelCalendarEvents(candidate, this._panelCalendarSelectedDate);
                    }));
                this._panelCalendarSelectedDate = new Date(calendar._selectedDate ?? Date.now());
            }
            if (parent !== screen.calendarContent) {
                parent?.remove_child(calendar);
                screen.calendarContent.insert_child_at_index(calendar, 0);
            }
            this._updatePanelCalendarEvents(screen, this._panelCalendarSelectedDate);
        }

        _createPanelCalendar(screen) {
            const dateMenu = Main.panel.statusArea.dateMenu as NativeDateMenu;
            if (!dateMenu?._calendar || !dateMenu?._eventSource)
                return;
            const menu = new PopupMenu.PopupMenu(screen.clockButton, 0.5, St.Side.TOP);
            applyNativeMenuTheme(menu, 'g-os-popup', 'g-os-calendar-menu');
            Main.uiGroup.add_child(menu.actor);
            menu.actor.hide();
            screen.calendarMenu = menu;

            const content = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
                style_class: 'popup-menu-content g-os-calendar-content'});
            screen.calendar = dateMenu._calendar;
            screen.calendarEventSource = dateMenu._eventSource;
            screen.calendarContent = content;
            screen.calendarEventHeading = new St.Label({style_class: 'g-os-calendar-events-heading'});
            content.add_child(screen.calendarEventHeading);
            screen.calendarEventList = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
                style_class: 'g-os-calendar-events'});
            const scroll = new St.ScrollView({
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                style_class: 'g-os-calendar-scroll',
            });
            scroll.set_child(screen.calendarEventList);
            content.add_child(scroll);
            menu.box.add_child(content);
            menu.connect('open-state-changed', (menu, open) => {
                if (open)
                    this._updatePanelCalendarEvents(screen, this._panelCalendarSelectedDate);
            });
            Main.panel.menuManager.addMenu(menu);
            this._updatePanelCalendarEvents(screen, this._panelCalendarSelectedDate ?? new Date());
        }

        _togglePanelCalendar(screen) {
            const dateMenu = Main.panel.statusArea.dateMenu as NativeDateMenu;
            if (!screen.calendarMenu)
                this._createPanelCalendar(screen);
            if (!screen.calendarMenu) {
                if (!dateMenu?.menu)
                    return;
                for (const candidate of this._screens) {
                    if (candidate.calendarMenu?.isOpen)
                        candidate.calendarMenu.close();
                }
                Reflect.set(dateMenu.menu, 'sourceActor', screen.clockButton);
                dateMenu.menu.toggle();
                return;
            }
            for (const candidate of this._screens) {
                if (candidate !== screen && candidate.calendarMenu?.isOpen)
                    candidate.calendarMenu.close();
            }
            (dateMenu?.menu as PopupMenu.PopupMenu | undefined)?.close();
            this._attachPanelCalendar(screen);
            screen.calendarMenu.toggle();
        }

        _populatePanelMenu(button) {
            applyNativeMenuTheme(button.menu, 'g-os-popup');

            // Navigation
            button.menu.addAction('Vue d’ensemble', () => Main.overview.show());
            button.menu.addAction('Applications', () => Main.overview.showApps());
            button.menu.addAction('Rechercher', () => Main.overview.focusSearch());

            button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Bureau
            const desktop = button.menu.addAction('Afficher le bureau', () => this._toggleDesktop());

            button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Personnalisation
            button.menu.addAction('Préférences', () => this.openPreferences());
            const lookupExtensionsApp = () => this._appSystem.lookup_app('org.gnome.Extensions.desktop') ??
                this._appSystem.lookup_app('gnome-extensions-app.desktop');
            const extensions = button.menu.addAction('Gérer les extensions', () => {
                const app = lookupExtensionsApp();
                if (!app)
                    return;
                Main.overview.hide();
                app.activate();
            });
            const updateExtensions = () => extensions.setSensitive(Boolean(lookupExtensionsApp()));
            updateExtensions();

            button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Paramètres système
            const settings = button.menu.addAction('Paramètres système', () => {
                const app = this._appSystem.lookup_app('org.gnome.Settings.desktop');
                if (app) {
                    Main.overview.hide();
                    app.activate();
                }
            });

            button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Session
            const actions = SystemActions.getDefault() as ReturnType<typeof SystemActions.getDefault> & {
                activateLockScreen: () => void;
            };
            const lock = button.menu.addAction('Verrouiller la session', () => {
                if (actions.canLockScreen)
                    actions.activateLockScreen();
            });
            const updateLock = () => lock.setSensitive(actions.canLockScreen);
            updateLock();
            const lockSignal = actions.connect('notify::can-lock-screen', updateLock);
            button.connect('destroy', () => actions.disconnect(lockSignal));
            settings.setSensitive(Boolean(this._appSystem.lookup_app('org.gnome.Settings.desktop')));
            button.menu.connect('open-state-changed', (menu, open) => {
                if (open) {
                    desktop.label.text = this._desktopActionName();
                    settings.setSensitive(Boolean(this._appSystem.lookup_app('org.gnome.Settings.desktop')));
                    updateExtensions();
                    updateLock();
                    alignMenuRows(button.menu.box, Clutter);
                }
            });
        }

        _populateAppMenu(button) {
            applyNativeMenuTheme(button.menu, 'g-os-popup');
            const quit = button.menu.addAction('Quitter l’application', () => {
                quit.targetApp?.request_quit();
            });
            const updateQuit = () => {
                const window = global.display.focus_window;
                const isDesktop = window?.get_window_type?.() === Meta.WindowType.DESKTOP;
                const app = window && !isDesktop
                    ? Shell.WindowTracker.get_default().get_window_app(window) : null;
                quit.targetApp = typeof app?.request_quit === 'function' ? app : null;
                quit.label.text = quit.targetApp ? `Quitter ${quit.targetApp.get_name()}` : 'Quitter l’application';
                quit.setSensitive(Boolean(quit.targetApp));
            };
            button.refreshTargetApp = updateQuit;
            updateQuit();
            button.menu.connect('open-state-changed', (menu, open) => {
                if (open) {
                    updateQuit();
                    alignMenuRows(button.menu.box, Clutter);
                }
            });
        }

        _syncPanelGlobalMenu(screen) {
            if (screen.globalMenu && this._settings.get_boolean('global-menu-enabled'))
                return;
            if (!this._settings.get_boolean('global-menu-enabled')) {
                screen.panelLayoutItems?.delete('global-menu');
                screen.globalMenu?.destroy();
                screen.globalMenuBox?.destroy();
                screen.globalMenu = null;
                screen.globalMenuBox = null;
                return;
            }
            screen.globalMenuBox = new St.BoxLayout({style_class: 'g-os-global-menu'});
            if (screen.panelLayoutItems) {
                screen.panelLayoutItems.set('global-menu', screen.globalMenuBox);
                this._attachPanelItemDraggable(screen, 'global-menu', screen.globalMenuBox);
                this._applyPanelLayout(screen);
            } else {
                const index = screen.panel.get_children().indexOf(screen.appMenuButton.container) + 1;
                screen.panel.insert_child_at_index(screen.globalMenuBox, index);
            }
            screen.globalMenu = new GtkGlobalMenu(screen.globalMenuBox, {
                Gio, GLib, St, Clutter, PopupMenu,
                menuManager: Main.panel.menuManager, uiGroup: Main.uiGroup,
                registrar: this._menuRegistrar, timestamp: () => global.get_current_time(), stylePrefix: 'g-os',
                getButtonMetrics: () => screen.panelButtonMetrics ?? null,
            });
        }

        _createPanel(screen) {
            const {monitor} = screen;
            screen.panel = new St.BoxLayout({
                name: 'panel',
                style_class: 'g-os-secondary-panel',
                height: this._settings.get_int('panel-height'),
                reactive: true,
            });
            if (this._settings.get_boolean('panel-style')) {
                // Reuse GNOME Shell's native panel node so its active theme supplies
                // background, foreground, borders and state colors. St automatically restyles the actor
                // whenever the Shell theme or color scheme changes.
                screen.panel.add_style_class_name('panel');
                screen.panel.add_style_class_name('g-os-panel');
            }
            screen.menuButton = monitor.index === Main.layoutManager.primaryIndex
                ? this._menu : createPanelMenuButton(St, Clutter, PopupMenu, Main.uiGroup, {
                    icon: new St.Icon({
                        gicon: this._launcherIcon('panel'),
                        fallback_gicon: this._gnomeLogo,
                        style_class: 'system-status-icon',
                    }),
                    accessibleName: 'Applications',
                    styleClass: 'g-os-panel-menu',
                });
            screen.menuButton.add_style_class_name('g-os-panel-menu');
            if (screen.menuButton !== this._menu) {
                screen.menuIcon = screen.menuButton.panelIcon;
                this._populatePanelMenu(screen.menuButton);
            } else
                screen.menuIcon = this._menuIcon;
            Main.panel.menuManager.addMenu(screen.menuButton.menu);
            screen.panel.add_child(screen.menuButton.container);
            screen.appLabel = monitor.index === Main.layoutManager.primaryIndex
                ? this._activeAppLabel : new St.Label({
                style_class: 'g-os-active-app',
                y_align: Clutter.ActorAlign.CENTER,
                visible: this._settings.get_boolean('show-active-app'),
            });
            screen.appLabel.visible = this._settings.get_boolean('show-active-app');
            screen.appMenuButton = createPanelMenuButton(St, Clutter, PopupMenu, Main.uiGroup, {
                text: screen.appLabel, accessibleName: 'Application', styleClass: 'g-os-app-menu',
                visible: screen.appLabel.visible,
            });
            screen.appMenuButton.container.visible = screen.appLabel.visible;
            this._populateAppMenu(screen.appMenuButton);
            Main.panel.menuManager.addMenu(screen.appMenuButton.menu);
            screen.panel.add_child(screen.appMenuButton.container);
            this._syncPanelGlobalMenu(screen);
            screen.transferLabel = monitor.index === Main.layoutManager.primaryIndex
                ? this._transferLabel : new St.Label({
                style_class: 'g-os-transfer-total',
                y_align: Clutter.ActorAlign.CENTER,
                visible: false,
            });
            screen.transferButton = createPanelButton(St, Clutter, {
                text: screen.transferLabel, accessibleName: 'Transferts',
                canFocus: false, reactive: true,
            });
            screen.transferButton.bind_property('visible', screen.transferLabel, 'visible', GObject.BindingFlags.SYNC_CREATE);
            screen.panel.add_child(screen.transferButton);
            screen.panel.add_child(new St.Widget({x_expand: true}));
            screen.clock = new St.Label({name: 'g-os-panel-clock', y_align: Clutter.ActorAlign.CENTER,
                visible: this._settings.get_boolean('panel-show-clock')});
            screen.clockButton = createPanelButton(St, Clutter, {
                text: screen.clock, accessibleName: 'Calendrier et événements',
                styleClass: 'g-os-clock-button', visible: screen.clock.visible,
            });
            screen.clockButton.connect('clicked', () => this._togglePanelCalendar(screen));
            screen.clockButton.connect('popup-menu', () => this._togglePanelCalendar(screen));
            screen.panel.add_child(screen.clockButton);
            screen.searchIcon = new St.Icon({icon_name: 'system-search-symbolic', style_class: 'system-status-icon'});
            const search = createPanelButton(St, Clutter, {
                icon: screen.searchIcon, accessibleName: 'Rechercher',
                visible: this._settings.get_boolean('panel-show-search'),
            });
            screen.searchButton = search;
            search.connect('clicked', () => Main.overview.focusSearch());
            screen.panel.add_child(search);
            screen.preferencesIcon = new St.Icon({
                icon_name: 'preferences-system-symbolic', style_class: 'system-status-icon',
            });
            const preferences = createPanelButton(St, Clutter, {
                icon: screen.preferencesIcon, accessibleName: 'Préférences G-Os',
                visible: this._settings.get_boolean('panel-show-preferences'),
            });
            screen.preferencesButton = preferences;
            preferences.connect('clicked', () => this.openPreferences());
            screen.panel.add_child(preferences);
            this._createNotificationButton(screen);
            screen.statusNotifierBox = new St.BoxLayout({style_class: 'g-os-status-notifier-items'});
            screen.statusNotifierButtons = new Map();
            screen.panel.add_child(screen.statusNotifierBox);
            this._syncStatusNotifierItems(screen);
            screen.statusButtons = [];
            for (const [name, iconName, accessibleName] of [
                ['wifi', 'network-wireless-signal-excellent-symbolic', 'Réseau Wi-Fi'],
                ['bluetooth', 'bluetooth-active-symbolic', 'Bluetooth'],
                ['sound', 'audio-volume-high-symbolic', 'Son'],
                ['brightness', 'display-brightness-symbolic', 'Luminosité de l’écran'],
                ['battery', 'battery-good-symbolic', 'Batterie'],
            ]) {
                const statusIcon = new St.Icon({icon_name: iconName, style_class: 'system-status-icon'});
                const batteryLevelLabel = name === 'battery' ? new St.Label({
                    text: '',
                    style_class: 'g-os-battery-level',
                    visible: this._settings.get_boolean('panel-show-battery-level'),
                    y_align: Clutter.ActorAlign.CENTER,
                }) : null;
                const button = createPanelButton(St, Clutter, {
                    icon: statusIcon, text: batteryLevelLabel,
                    accessibleName, styleClass: 'g-os-status-button',
                    visible: this._settings.get_boolean(`panel-show-${name}`),
                }) as StatusButton;
                button.statusKind = name;
                button.statusIcon = statusIcon;
                if (batteryLevelLabel)
                    button.batteryLevelLabel = batteryLevelLabel;
                this._createStatusMenu(button);
                button.connect('clicked', () => {
                    if (!button.statusMenu.isOpen)
                        Main.panel.statusArea?.quickSettings?.menu?.close();
                    button.statusMenu.toggle();
                });
                screen.statusButtons.push(button);
                screen.panel.add_child(button);
            }
            screen.sessionButton = createPanelMenuButton(St, Clutter, PopupMenu, Main.uiGroup, {
                iconName: 'avatar-default-symbolic', accessibleName: 'Session',
                styleClass: 'g-os-session-button',
            });
            screen.sessionIcon = screen.sessionButton.panelIcon;
            this._populateSessionMenu(screen.sessionButton);
            Main.panel.menuManager.addMenu(screen.sessionButton.menu);
            screen.panel.add_child(screen.sessionButton.container);
            this._initializePanelLayout(screen);
            this._applyPanelMetrics(screen);
            screen.panel.set_position(monitor.x, monitor.y);
            screen.panel.set_width(monitor.width);
            screen.lifecycle.chrome?.add(screen.panel, {affectsStruts: true, trackFullscreen: true});
        }

        _initializePanelLayout(screen) {
            screen.panelLayoutItems = new Map([
                ['launcher', screen.menuButton.container],
                ['application', screen.appMenuButton.container],
                ['global-menu', screen.globalMenuBox],
                ['transfer', screen.transferButton],
                ['clock', screen.clockButton],
                ['search', screen.searchButton],
                ['preferences', screen.preferencesButton],
                ['notifications', screen.notificationButton.container],
                ['tray', screen.statusNotifierBox],
                ...screen.statusButtons.map(button => [button.statusKind, button]),
                ['session', screen.sessionButton.container],
            ].filter(([, actor]) => actor));
            screen.panelLayout = this._normalizePanelLayout(this._settings.get_strv('panel-layout'));
            screen.panelLayoutGroups = new Map();
            for (const group of PANEL_LAYOUT_GROUPS) {
                const zone = new St.BoxLayout({
                    name: `g-os-panel-drop-zone-${group}`,
                    style_class: 'g-os-panel-drop-zone',
                    reactive: true,
                    track_hover: true,
                    x_expand: true,
                    y_expand: true,
                });
                const content = new St.BoxLayout({
                    style_class: 'g-os-panel-zone-content',
                    y_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                // Explicit expanding spacers make the edge alignment independent of
                // BinLayout's child allocation and keep the center group screen-centered.
                if (group !== 'left')
                    zone.add_child(new St.Widget({x_expand: true, y_expand: true}));
                zone.add_child(content);
                if (group !== 'right')
                    zone.add_child(new St.Widget({x_expand: true, y_expand: true}));
                screen.interactionDnd.registerTarget(zone, {
                    handleDragOver: (source, _dragActor, x) => {
                        const accepted = Boolean(this._getPanelLayoutItem(screen, source));
                        if (screen.panelDropZone && screen.panelDropZone !== zone)
                            screen.panelDropZone.remove_style_pseudo_class('drop');
                        screen.panelDropZone = accepted ? zone : null;
                        if (accepted) {
                            zone.add_style_pseudo_class('drop');
                            this._movePanelDropPlaceholder(screen, group, x);
                        }
                        return accepted ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.CONTINUE;
                    },
                    acceptDrop: (source, _dragActor, x) => {
                        zone.remove_style_pseudo_class('drop');
                        screen.panelDropZone = null;
                        const itemId = this._getPanelLayoutItem(screen, source);
                        return itemId ? this._movePanelItem(screen, itemId, group, x) : false;
                    },
                });
                screen.panelLayoutGroups.set(group, {zone, content});
            }
            for (const child of screen.panel.get_children())
                screen.panel.remove_child(child);
            for (const group of PANEL_LAYOUT_GROUPS)
                screen.panel.add_child(screen.panelLayoutGroups.get(group).zone);
            for (const [id, actor] of screen.panelLayoutItems)
                this._attachPanelItemDraggable(screen, id, actor);
            // Registered last so cancellation runs before DND signals are disconnected.
            screen.lifecycle.add(() => this._finishPanelShadowDrag(screen, false));
            this._applyPanelLayout(screen);
        }

        _normalizePanelLayout(saved) {
            const validIds = new Set(DEFAULT_PANEL_LAYOUT.map(entry => entry.split(':')[1]));
            const layout = [];
            const seen = new Set();
            for (const entry of saved) {
                const [group, id, ...extra] = entry.split(':');
                if (!PANEL_LAYOUT_GROUPS.includes(group) || !validIds.has(id) || extra.length || seen.has(id))
                    continue;
                layout.push(`${group}:${id}`);
                seen.add(id);
            }
            for (const entry of DEFAULT_PANEL_LAYOUT) {
                const id = entry.split(':')[1];
                if (!seen.has(id))
                    layout.push(entry);
            }
            return layout;
        }

        _attachPanelItemDraggable(screen, id, actor) {
            if (!actor || screen.interactionDnd.hasSource(actor))
                return;
            actor._panelLayoutItemId = id;
            // GNOME Shell emits drag-begin before asking the delegate for its
            // drag actor. Capture the clone while the source is still parented;
            // _beginPanelShadowDrag then replaces it with the visible placeholder.
            let dragActor: Clutter.Clone | null = null;
            const finishDrag = success => {
                this._finishPanelShadowDrag(screen, success);
                dragActor = null;
            };
            screen.interactionDnd.registerSource(actor, {
                panelLayoutItem: {screen, id},
                getDragActor: () => dragActor ?? new Clutter.Clone({source: actor}),
                getDragActorSource: () => screen.panelDragState?.actor === actor
                    ? screen.panelDragState.placeholder : actor,
            }, {
                onBegin: () => {
                    dragActor = new Clutter.Clone({source: actor});
                    this._beginPanelShadowDrag(screen, id, actor);
                },
                onEnd: success => finishDrag(success),
                onCancelled: () => finishDrag(false),
                onDestroy: () => {
                    if (screen.panelDragState?.actor === actor)
                        finishDrag(false);
                    else
                        dragActor = null;
                },
            });
        }

        _beginPanelShadowDrag(screen, id, actor) {
            if (screen.panelDragState)
                this._finishPanelShadowDrag(screen, false);
            const parent = actor.get_parent();
            if (!parent)
                return;
            const index = parent.get_children().indexOf(actor);
            const [width, height] = actor.get_size();
            const placeholder = new St.Widget({
                style_class: 'g-os-panel-dnd-placeholder',
                width,
                height,
                y_expand: true,
                reactive: false,
            });
            screen.panelDragState = {id, actor, parent, index, placeholder};
            parent.insert_child_at_index(placeholder, index);
            parent.remove_child(actor);
        }

        _finishPanelShadowDrag(screen, success) {
            const state = screen.panelDragState;
            if (!state)
                return;
            screen.panelDragState = null;
            this._clearPanelDropZone(screen);
            state.placeholder.get_parent()?.remove_child(state.placeholder);
            if (!success && state.actor && !state.actor.is_destroyed())
                state.parent.insert_child_at_index(state.actor, Math.min(state.index, state.parent.get_n_children()));
            state.placeholder.destroy();
        }

        _movePanelDropPlaceholder(screen, group, x) {
            const state = screen.panelDragState;
            const target = screen.panelLayoutGroups?.get(group);
            if (!state || !target)
                return;
            const dropX = target.zone.get_transformed_position()[0] + x;
            const siblings = target.content.get_children()
                .filter(child => child !== state.placeholder);
            const midpoints = siblings.map(child => {
                const [childX] = child.get_transformed_position();
                const [childWidth] = child.get_transformed_size();
                return childX + childWidth / 2;
            });
            const index = resolveInsertionIndex(midpoints, dropX) ?? siblings.length;
            state.placeholder.get_parent()?.remove_child(state.placeholder);
            target.content.insert_child_at_index(state.placeholder, index);
        }

        _getPanelLayoutItem(screen, source) {
            const item = source?.panelLayoutItem ?? source?._delegate?.panelLayoutItem ??
                source?.actor?._delegate?.panelLayoutItem;
            return item?.screen === screen && screen.panelLayoutItems?.has(item.id) ? item.id : null;
        }

        _clearPanelDropZone(screen) {
            screen.panelDropZone?.remove_style_pseudo_class('drop');
            screen.panelDropZone = null;
        }

        _applyPanelLayout(screen) {
            if (!screen.panelLayoutGroups || !screen.panelLayoutItems)
                return;
            for (const group of PANEL_LAYOUT_GROUPS) {
                const content = screen.panelLayoutGroups.get(group).content;
                const actors = screen.panelLayout
                    .filter(entry => entry.startsWith(`${group}:`))
                    .map(entry => screen.panelLayoutItems.get(entry.slice(group.length + 1)))
                    .filter(Boolean);
                for (const actor of actors)
                    actor.get_parent()?.remove_child(actor);
                actors.forEach((actor, index) => content.insert_child_at_index(actor, index));
            }
        }

        _movePanelItem(screen, id, group, x) {
            if (!this._settings.is_writable('panel-layout'))
                return false;
            const actor = screen.panelLayoutItems.get(id);
            const target = screen.panelLayoutGroups.get(group);
            if (!actor || !target)
                return false;
            const zoneX = target.zone.get_transformed_position()[0];
            const dropX = zoneX + x;
            const visibleSiblings = target.content.get_children().filter(child =>
                child !== actor && child !== screen.panelDragState?.placeholder);
            const midpoints = visibleSiblings.map(child => {
                const [childX] = child.get_transformed_position();
                const [childWidth] = child.get_transformed_size();
                return childX + childWidth / 2;
            });
            const insertionSlot = resolveInsertionIndex(midpoints, dropX);
            const before = insertionSlot === null ? null : visibleSiblings[insertionSlot] ?? null;
            const entries = screen.panelLayout.filter(entry => !entry.endsWith(`:${id}`));
            let insertionIndex;
            if (before) {
                const beforeId = before._panelLayoutItemId;
                insertionIndex = entries.findIndex(entry => entry === `${group}:${beforeId}`);
            } else {
                const lastIndex = entries.reduce((last, entry, index) =>
                    entry.startsWith(`${group}:`) ? index : last, -1);
                insertionIndex = lastIndex + 1;
            }
            if (insertionIndex < 0)
                insertionIndex = entries.length;
            entries.splice(insertionIndex, 0, `${group}:${id}`);
            if (!this._settings.set_strv('panel-layout', entries))
                return false;
            screen.panelLayout = entries;
            this._applyPanelLayout(screen);
            return true;
        }

        _applyPanelMetrics(screen) {
            const height = this._settings.get_int('panel-height');
            const horizontalPadding = this._settings.get_int('panel-padding-horizontal');
            const buttonPadding = this._settings.get_int('panel-icon-padding');
            const itemSpacing = this._settings.get_int('panel-item-spacing');
            const verticalPadding = Math.min(this._settings.get_int('panel-padding-vertical'),
                Math.max(0, Math.floor((height - 22) / 2)));
            const metrics = calculatePanelButtonMetrics({
                panelHeight: height,
                panelVerticalPadding: verticalPadding,
                buttonPadding,
                itemSpacing,
            });
            const availableLabelWidth = Math.max(48, screen.monitor.width - 360 - horizontalPadding * 2);
            const labelLength = screen.appLabel.text?.length ?? 0;
            screen.fontSize = metrics.fontSize;
            screen.appFontSize = calculatePanelLabelFontSize(metrics.fontSize, labelLength, availableLabelWidth);
            screen.iconSize = metrics.iconSize;
            screen.panelButtonMetrics = metrics;
            screen.panel.set_style(`padding: ${verticalPadding}px ${horizontalPadding}px; spacing: ${metrics.itemSpacing}px;`);

            screen.appLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            screen.appLabel.y_align = Clutter.ActorAlign.CENTER;
            for (const label of [screen.clock, screen.transferLabel]) {
                label.y_align = Clutter.ActorAlign.CENTER;
                label.set_style(`font-size: ${screen.fontSize}px; padding: 0;`);
            }
            for (const button of [screen.menuButton.container, screen.appMenuButton.container, screen.transferButton,
                screen.clockButton, screen.searchButton, screen.preferencesButton,
                screen.notificationButton.container,
                ...screen.statusNotifierButtons.values(),
                ...screen.statusButtons, screen.sessionButton.container]) {
                button.y_align = Clutter.ActorAlign.CENTER;
                applyPanelButtonMetrics(button, metrics);
            }
            // The application label is the only width-constrained topbar text.
            // Apply its fit after the shared button metrics so generic sizing
            // does not overwrite the width-aware font size.
            screen.appLabel.set_style(`font-size: ${screen.appFontSize}px; max-width: ${availableLabelWidth}px; padding: 0;`);
            for (const {content} of screen.panelLayoutGroups?.values() ?? [])
                content.set_style(`spacing: ${metrics.itemSpacing}px;`);
            screen.statusNotifierBox?.set_style(`spacing: ${metrics.itemSpacing}px;`);
            if (screen.globalMenuBox) {
                screen.globalMenuBox.y_align = Clutter.ActorAlign.CENTER;
                screen.globalMenuBox.set_style(`font-size: ${screen.fontSize}px; spacing: ${metrics.itemSpacing}px;`);
            }
            for (const button of screen.globalMenuBox?.get_children() ?? []) {
                applyPanelButtonMetrics(button, metrics);
            }

        }

        _syncStatusNotifierItems(screen) {
            if (!screen.statusNotifierBox || !screen.statusNotifierButtons)
                return;
            const items = this._statusNotifierHost?.visibleItems() ?? [];
            const present = new Set(items.map(item => item.key));
            for (const [key, button] of screen.statusNotifierButtons) {
                if (present.has(key))
                    continue;
                button.statusMenuController?.destroy();
                screen.statusNotifierBox.remove_child(button);
                button.destroy();
                screen.statusNotifierButtons.delete(key);
            }
            for (const [index, item] of items.entries()) {
                let button = screen.statusNotifierButtons.get(item.key);
                if (!button) {
                    button = createPanelButton(St, Clutter, {
                        iconName: 'application-x-executable-symbolic',
                        styleClass: 'g-os-status-notifier-button',
                    });
                    button.statusIcon = button.panelIcon;
                    screen.statusNotifierButtons.set(item.key, button);
                    button.connect('clicked', () => {
                        if (item.properties.Menu && item.properties.Menu !== '/')
                            this._toggleStatusNotifierMenu(button, item);
                        else
                            this._activateStatusNotifierItem(button, item, 'Activate');
                    });
                    button.connect('popup-menu', () => {
                        if (item.properties.Menu && item.properties.Menu !== '/')
                            this._toggleStatusNotifierMenu(button, item);
                        else
                            this._activateStatusNotifierItem(button, item, 'ContextMenu');
                    });
                    button.connect('button-press-event', (_actor, event) => {
                        if (event.get_button() !== 3)
                            return Clutter.EVENT_PROPAGATE;
                        if (item.properties.Menu && item.properties.Menu !== '/')
                            this._toggleStatusNotifierMenu(button, item);
                        else
                            this._activateStatusNotifierItem(button, item, 'ContextMenu');
                        return Clutter.EVENT_STOP;
                    });
                    button.connect('scroll-event', (_actor, event) => {
                        const direction = event.get_scroll_direction();
                        const delta = direction === Clutter.ScrollDirection.UP ? 1
                            : direction === Clutter.ScrollDirection.DOWN ? -1 : 0;
                        if (delta)
                            this._statusNotifierHost?.activate(item, 'Scroll', 0, 0, delta, 'vertical');
                        return Clutter.EVENT_STOP;
                    });
                }
                if (button.statusMenuController &&
                    button.statusMenuController.path !== item.properties.Menu) {
                    button.statusMenuController.destroy();
                    button.statusMenuController = null;
                }
                const properties = item.properties;
                const iconName = properties.Status === 'NeedsAttention'
                    ? properties.AttentionIconName : properties.IconName;
                const pixmaps = properties.Status === 'NeedsAttention'
                    ? properties.AttentionIconPixmap : properties.IconPixmap;
                const name = iconName || properties.Id || 'application-x-executable-symbolic';
                button.statusIcon.gicon = createStatusNotifierPixbuf(pixmaps, GdkPixbuf, GLib, this._cache) ??
                    new Gio.ThemedIcon({name});
                button.accessible_name = properties.Title || properties.Id || 'Application indicator';
                const tooltip = properties.ToolTip;
                button.tooltip_text = Array.isArray(tooltip)
                    ? [tooltip[2], tooltip[3]].filter(Boolean).join('\n') || button.accessible_name
                    : button.accessible_name;
                button.visible = properties.Status !== 'Passive';
                button.y_align = Clutter.ActorAlign.CENTER;
                button.statusIcon.y_align = Clutter.ActorAlign.CENTER;
                if (screen.panelButtonMetrics)
                    applyPanelButtonMetrics(button, screen.panelButtonMetrics);
                if (button.get_parent() !== screen.statusNotifierBox ||
                    screen.statusNotifierBox.get_children().indexOf(button) !== index) {
                    button.get_parent()?.remove_child(button);
                    screen.statusNotifierBox.insert_child_at_index(button, index);
                }
            }
            screen.statusNotifierBox.visible = items.length > 0;
        }

        _destroyStatusNotifierMenus(screen) {
            for (const button of screen.statusNotifierButtons?.values() ?? []) {
                button.statusMenuController?.destroy();
                button.statusMenuController = null;
            }
        }

        _activateStatusNotifierItem(button, item, method) {
            const [x, y] = button.get_transformed_position().map(Math.round);
            this._statusNotifierHost?.activate(item, method, x, y);
        }

        _toggleStatusNotifierMenu(button, item) {
            if (!button.statusMenuController)
                button.statusMenuController = new StatusNotifierMenu(button, item);
            button.statusMenuController.toggle();
        }

        _createStatusMenu(button) {
            const menu = new PopupMenu.PopupMenu(button, 0.5, St.Side.TOP);
            applyNativeMenuTheme(menu, 'g-os-popup');
            menu.actor.add_style_class_name(`g-os-status-menu-${button.statusKind}`);
            Main.uiGroup.add_child(menu.actor);
            menu.actor.hide();
            Main.panel.menuManager.addMenu(menu);
            button.statusMenu = menu;
            const quick = Main.panel.statusArea?.quickSettings as typeof Main.panel.statusArea.quickSettings &
                QuickSettingsInternals;
            const settings = panel => () => {
                const app = this._appSystem.lookup_app(`gnome-${panel}-panel.desktop`) ??
                    this._appSystem.lookup_app('org.gnome.Settings.desktop');
                app?.activate();
            };
            if (button.statusKind === 'sound') {
                button.statusController = new SoundStatusMenu(menu, button.statusIcon, {
                    control: Volume.getMixerControl(), Gio, St, Slider, PopupMenu, Clutter,
                    openSettings: settings('sound'),
                });
                button.connect('scroll-event', (actor, event) =>
                    button.statusController.adjustVolume(event.get_scroll_direction()));
            } else if (['wifi', 'bluetooth'].includes(button.statusKind)) {
                const toggle = button.statusKind === 'wifi' ? quick?._network?._wirelessToggle
                    : quick?._bluetooth?.quickSettingsItems?.[0];
                button.statusController = new RadioStatusMenu(menu, button.statusIcon, {toggle,
                    title: button.statusKind === 'wifi' ? 'Wi-Fi' : 'Bluetooth', St, Clutter, PopupMenu,
                    deviceChangeSignal: button.statusKind === 'bluetooth' ? 'devices-changed' : null,
                    openSettings: settings(button.statusKind === 'wifi' ? 'wifi' : 'bluetooth')});
            } else if (button.statusKind === 'brightness') {
                button.statusController = new DisplayStatusMenu(menu, button.statusIcon, {
                    Gio, GLib, St, Slider, PopupMenu, Clutter, openSettings: settings('display'),
                });
            } else {
                button.statusController = new BatteryStatusMenu(menu, button.statusIcon, {
                    powerToggle: quick?._system?._systemItem?.powerToggle ?? quick?._system?._systemItem?._powerToggle ??
                        quick?._system?.quickSettingsItems?.[0]?.powerToggle,
                    deviceClient: createPowerDeviceClient(Gio), batteryKind: 2,
                    levelLabel: button.batteryLevelLabel,
                    showLevel: this._settings.get_boolean('panel-show-battery-level'),
                    profiles: quick?._powerProfiles?._powerProfilesToggle, St, Clutter, PopupMenu, openSettings: settings('power'),
                });
            }
            menu.connect('open-state-changed', (actor, open) => {
                if (open)
                    alignMenuRows(menu.box, Clutter);
            });
            button.connect('popup-menu', () => {
                Main.panel.statusArea?.quickSettings?.menu?.close();
                menu.open();
            });
        }

        _openQuickSettings(button) {
            const menu = Main.panel.statusArea?.quickSettings?.menu;
            if (!menu)
                return;
            if (menu.isOpen) {
                menu.close();
                return;
            }
            Reflect.set(menu, 'sourceActor', button);
            menu.open();
        }

        _populateSessionMenu(button) {
            const actions = SystemActions.getDefault();
            applyNativeMenuTheme(button.menu, 'g-os-popup');
            const addSystemAction = (label, available, activate) => {
                const item = button.menu.addAction(label, () => {
                    if (actions[available])
                        actions[activate]();
                });
                item.setSensitive(Boolean(actions[available]));
                return item;
            };

            const restart = addSystemAction('Redémarrer', 'canRestart', 'activateRestart');
            const powerOff = addSystemAction('Éteindre', 'canPowerOff', 'activatePowerOff');
            const logout = addSystemAction('Se déconnecter', 'canLogout', 'activateLogout');
            button.menu.addAction('Préférences G-Os', () => this.openPreferences());
            const settings = button.menu.addAction('Paramètres système', () => {
                const app = this._appSystem.lookup_app('org.gnome.Settings.desktop');
                if (app) {
                    Main.overview.hide();
                    app.activate();
                }
            });
            const lock = addSystemAction('Verrouiller la session', 'canLockScreen', 'activateLockScreen');
            const suspend = addSystemAction('Suspendre', 'canSuspend', 'activateSuspend');
            const updateSensitivity = () => {
                for (const [item, capability] of [[restart, 'canRestart'], [powerOff, 'canPowerOff'],
                    [logout, 'canLogout'], [lock, 'canLockScreen'], [suspend, 'canSuspend']])
                    item.setSensitive(Boolean(actions[capability]));
                settings.setSensitive(Boolean(this._appSystem.lookup_app('org.gnome.Settings.desktop')));
            };
            updateSensitivity();
            const capabilityCleanup = new CleanupManager();
            for (const signal of ['notify::can-restart', 'notify::can-power-off', 'notify::can-logout',
                'notify::can-lock-screen', 'notify::can-suspend'] as const)
                capabilityCleanup.addSignal(actions, actions.connect(signal, updateSensitivity));
            button.connect('destroy', () => capabilityCleanup.clear());
            button.menu.connect('open-state-changed', (menu, open) => {
                if (open) {
                    updateSensitivity();
                    alignMenuRows(button.menu.box, Clutter);
                }
            });
        }

        _updateClocks() {
            const text = this._wallClock.clock;
            for (const screen of this._screens) {
                if (screen.clock)
                    screen.clock.text = text;
            }
        }

    };
}
