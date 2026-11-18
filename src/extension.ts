import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GnomeDesktop from 'gi://GnomeDesktop?version=4.0';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Soup from 'gi://Soup?version=3.0';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {readAppFolders, writeAppFolders} from './shared/appFolders.js';
import {errorMessage} from './shared/errorMessage.js';
import {LifecycleScope} from './core/lifecycleScope.js';
import {ChromeActorManager} from './core/chromeActorManager.js';
import {WidgetRuntime} from './widgets/widgetRuntime.js';
import {withDockVisibility} from './dock/dockVisibility.js';
import {withDockOrder} from './dock/dockOrder.js';
import {withMediaWidgets} from './media/mediaWidgets.js';
import {withDockFolders} from './dock/dockFolders.js';
import {withDockAppearance} from './dock/dockAppearance.js';
import {withPanel} from './panel/panel.js';
import {DbusMenuRegistrar} from './panel/menuRegistrar.js';
import {StatusNotifierHost} from './panel/statusNotifier.js';
import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';
import {CoverflowController, createCoverflowSwitcher} from './switcher/coverflow.js';
import {withDesktopWidgets} from './desktop/desktopWidgets.js';
import {withDesktopIcons} from './desktop/desktopIcons.js';
import {withDockMenus} from './dock/dockMenus.js';
import {withDockActivity} from './dock/dockActivity.js';
import {readWidgetCatalog} from './widgets/widgetCatalog.js';
import {create as createClockWidget} from './widgets/clock/widget.js';
import {create as createCalendarWidget} from './widgets/calendar/widget.js';
import {create as createMediaWidget} from './widgets/media/widget.js';

const laters = global.compositor.get_laters();

const ExtensionComponents: any = [withDockVisibility, withDockOrder, withMediaWidgets, withDockFolders,
    withDockAppearance, withPanel, withDesktopWidgets, withDesktopIcons, withDockMenus, withDockActivity]
    .reduce<any>((base, component) => component(base), Extension);

type ExtensionScreen = {
    monitor: (typeof Main.layoutManager.monitors)[number];
    position: number;
    dockDocked: boolean;
    dockViewport: St.Viewport | null;
    popupSide: St.Side;
    hoverAnimationUpdates: Set<(soft?: boolean) => void>;
    lifecycle: LifecycleScope<St.Widget>;
    [key: string]: any;
};

type DockAppMetadata = {
    dockFocusKey?: string;
    notificationBadge?: St.Label;
    progressBar?: St.Widget;
    progressFill?: St.Widget;
    windowSummary?: PopupMenu.PopupMenuItem;
    _dockHoverAnimationUpdate?: (soft?: boolean) => void;
    _dockActiveApp?: boolean;
    _dockNeedsAttention?: boolean;
};

type DockButtonMetadata = {
    dockFocusKey?: string;
    dockWidgetType?: string;
    dockWidgetSquare?: boolean;
    dockWidgetPrimary?: St.Label;
    dockWidgetSecondary?: St.Label;
    mediaView?: St.Widget & {ownerButton?: St.Button};
    shortcutMenu?: PopupMenu.PopupMenu;
};

export default class GOsExtension extends ExtensionComponents {
    [key: string]: any;
    enable() {
            this._nativePanelState = {
                visible: Main.panel.visible ?? true,
                reactive: Main.panel.reactive ?? true,
            };
            this._appSystem = Shell.AppSystem.get_default();
            this._favorites = AppFavorites.getAppFavorites();
        this._settings = this.getSettings();
        this._statusNotifierHost = new StatusNotifierHost({Gio, GLib,
            onChanged: () => {
                for (const screen of this._screens ?? [])
                    this._syncStatusNotifierItems(screen);
            }});
        this._statusNotifierHost.start();
        this._gnomeLogo = new Gio.FileIcon({file: this.dir.get_child('icons').get_child('gnome-logo-symbolic.svg')});
            if (this._settings.get_boolean('dock-magnify') &&
                this._settings.get_user_value?.('dock-hover-animation') === null &&
                (this._settings.is_writable?.('dock-hover-animation') ?? true))
                this._settings.set_int('dock-hover-animation', 1);
        this._screens = [];
        this._settingsApplySource = 0;
        this._desktopWidgets = new Map();
        this._widgetAreaSource = 0;
        this._mediaPlayers = new Map();
        this._mediaViews = new Set();
        this._mediaSourceSignals = [];
        this._desktopWindows = new Map();
        this._dockCoverageWindows = new Map();
        this._runningAppSignals = new Map();
        this._attentionWindows = new Map();
        this._workspaceSignals = [];
        this._notificationSources = new Map();
        this._launcherEntries = new Map();
        this._activeTransfers = new Map();
        this._activityRevision = 0;
        this._trashCount = null;
            this._connections = [];
            this._wallClock = new GnomeDesktop.WallClock();
            this._widgetRuntime = new WidgetRuntime(this, {Gio, GLib, St, Clutter, Pango, GnomeDesktop, DND, PopupMenu, Main, Soup, stage: global.stage,
                pointer: () => global.get_pointer()}, readWidgetCatalog,
                {clock: createClockWidget, calendar: createCalendarWidget, media: createMediaWidget});
            this._connect(this._wallClock, 'notify::clock', () => {
                this._updateClocks();
                this._updateDesktopWidgets();
                this._updateDockWidgets();
            });

            this._menu = new PanelMenu.Button(0.0, 'Applications');
            this._menu.add_style_class_name('g-os-panel-menu');
            this._menuBox = new St.BoxLayout({style_class: 'g-os-panel-menu-box'});
            this._menuIcon = new St.Icon({
                gicon: this._launcherIcon('panel'),
                fallback_gicon: this._gnomeLogo,
                style_class: 'system-status-icon',
            });
            this._menuBox.add_child(this._menuIcon);
            this._activeAppLabel = new St.Label({
                text: 'Finder',
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'g-os-active-app',
            });
            this._transferLabel = new St.Label({
                style_class: 'g-os-transfer-total',
                y_align: Clutter.ActorAlign.CENTER,
                visible: false,
            });
            this._menu.add_child(this._menuBox);
            this._populatePanelMenu(this._menu);

            this._connect(Main.messageTray, 'source-added', (tray, source) => this._watchNotificationSource(source));
            this._connect(Main.messageTray, 'source-removed', (tray, source) => {
                this._unwatchNotificationSource(source);
                this._updateNotificationCounts();
            });
            for (const source of Main.messageTray.getSources())
                this._watchNotificationSource(source);
            this._startLauncherTracking();

            for (const signal of ['window-demands-attention', 'window-marked-urgent'])
                this._connect(global.display, signal, (display, window) => this._trackAttentionWindow(window));
            for (const actor of global.get_window_actors()) {
                const window = actor.meta_window;
                if (window.demands_attention || window.urgent)
                    this._trackAttentionWindow(window);
            }
            this._connect(global.display, 'window-created', (display, window) => {
                this._trackDockCoverageWindow(window);
                this._queueDockCoverageUpdate();
            });

            this._connect(this._favorites, 'changed', () => this._queueDockRebuild());
            this._connect(this._appSystem, 'app-state-changed', (system, app) => this._handleAppStateChanged(app));
            this._connect(this._appSystem, 'installed-changed', () => {
                this._normalizeDockAppFolders();
                this._queueDockRebuild();
            });
            this._connect(global.display, 'notify::focus-window', () => this._updateActiveApp());
            this._connect(global.display, 'in-fullscreen-changed', () => {
                for (const screen of this._screens) {
                    if (screen.monitor.inFullscreen)
                        this._hideDock(screen, true);
                    else if (!screen.edge)
                        this._revealDock(screen);
                }
                this._updateDockCoverage();
            });
            this._connect(global.stage, 'notify::key-focus', () => {
                for (const screen of this._screens) {
                    if (this._dockHasFocus(screen))
                        this._revealDock(screen);
                    else
                        this._queueDockHide(screen);
                }
            });
            this._connect(Main.layoutManager, 'monitors-changed', () => this._applySettings());
            this._connect(global.display, 'workareas-changed', () => {
                if (this._widgetAreaSource)
                    return;
                this._widgetAreaSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._refreshDesktopWidgetMenus();
                    this._widgetRuntime?.syncWorkAreas();
                    this._widgetAreaSource = 0;
                    return GLib.SOURCE_REMOVE;
                });
            });
            this._connect(global.workspace_manager, 'active-workspace-changed', () => {
                this._updateDesktopButtons();
                if (this._settings.get_boolean('dock-current-workspace'))
                    this._queueDockRebuild();
                this._updateDockCoverage();
            });
            this._connect(this._settings, 'changed', (settings, key) => {
                if (['widget-monitors', 'widget-errors', 'widget-manager-request', 'widget-state'].includes(key))
                    return;
                if (key === 'notification-position') {
                    this._applyNotificationPosition?.();
                    return;
                }
                if (['panel-launcher-icon-name', 'panel-launcher-icon-file',
                    'dock-launcher-icon-name', 'dock-launcher-icon-file'].includes(key)) {
                    this._updateLauncherIcons();
                    return;
                }
                if (key === 'widget-catalog-revision')
                    this._widgetRuntime.reloadCatalog();
                if (key === 'show-active-app') {
                    for (const screen of this._screens) {
                        screen.appLabel.visible = settings.get_boolean(key);
                        screen.appMenuButton.container.visible = screen.appLabel.visible;
                    }
                    return;
                }
                if (key === 'panel-show-notifications') {
                    this._updatePanelNotifications();
                    return;
                }
                if (key.startsWith('desktop-icons-')) {
                    if (key === 'desktop-icons-layout')
                        return;
                    this._syncDesktopIcons();
                    return;
                }
                if (key.startsWith('dock-icons-show-')) {
                    this._queueDockRebuild();
                    return;
                }
                if (key.startsWith('desktop-widget-'))
                    this._syncDesktopWidgets();
                else if (key !== 'window-button-layout-backup')
                    this._queueSettingsApply(key);
            });
            this._connectOverviewDash();
            this._setupDesktopWidgetMenu();
            this._applySettings();
            this._updateActiveApp();
    }

    disable() {
            if (this._settingsApplySource)
                GLib.source_remove(this._settingsApplySource);
            this._settingsApplySource = 0;
            this._settingsApplyKeys = null;
            this._destroyDesktopWidgetMenu();
            this._stopMediaTracking();
            this._stopDesktopIconTracking();
            this._widgetRuntime?.destroy();
            this._widgetRuntime = null;
            this._stopTrashTracking();
            for (const window of [...this._attentionWindows.keys()])
                this._forgetAttentionWindow(window);
            this._disconnectDockCoverageWindows();
            this._syncRunningAppSignals([]);
            this._syncWorkspaceSignals(null);
            if (this._dockRebuildSource)
                GLib.source_remove(this._dockRebuildSource);
            this._dockRebuildSource = 0;
            if (this._transferIndicatorSource)
                GLib.source_remove(this._transferIndicatorSource);
            this._transferIndicatorSource = 0;
            for (const id of this._dbusSubscriptions)
                Gio.DBus.session.signal_unsubscribe(id);
            this._dbusSubscriptions = [];
            if (this._unityOwner)
                Gio.bus_unown_name(this._unityOwner);
            this._unityOwner = 0;
            this._launcherEntries.clear();
            this._activeTransfers.clear();
            for (const source of [...this._notificationSources.keys()])
                this._unwatchNotificationSource(source);
            for (const [object, id] of this._connections)
                object.disconnect(id);
            this._connections = [];
            this._overviewDash?.show();
            this._overviewDash = null;
            if (this._overviewAppDisplay &&
                this._overviewAppDisplay._loadApps === this._overviewAppDisplayLoadAppsOverride)
                this._overviewAppDisplay._loadApps = this._overviewAppDisplayLoadApps;
            if (this._overviewAppDisplay &&
                this._overviewAppDisplay._compareItems === this._overviewAppDisplayCompareItemsOverride)
                this._overviewAppDisplay._compareItems = this._overviewAppDisplayCompareItems;
            this._overviewAppDisplay = null;
            this._overviewAppDisplayLoadApps = null;
            this._overviewAppDisplayLoadAppsOverride = null;
            this._overviewAppDisplayCompareItems = null;
            this._overviewAppDisplayCompareItemsOverride = null;
            this._destroyDesktopWidgets();
            this._wallClock.run_dispose();
            this._wallClock = null;
            this._dockWallClock?.run_dispose();
            this._dockWallClock = null;
            this._dockClockSettings = null;
            for (const workspace of [...this._desktopWindows.keys()])
                this._restoreDesktop(workspace, false);
            this._restoreWindowButtons();
            this._windowSettings = null;
            if (this._searchBinding)
                Main.wm.removeKeybinding('spotlight-search');
            this._searchBinding = false;
            this._searchSystemSettings = null;
            this._searchFallbackSettings = null;
            this._coverflowController?.destroy();
            this._coverflowController = null;
            for (const id of this._deferredDockDrops ?? [])
                GLib.source_remove(id);
            this._deferredDockDrops?.clear();
            this._destroyScreens();
            this._statusNotifierHost?.destroy();
            this._statusNotifierHost = null;
            this._menuRegistrar?.destroy();
            this._menuRegistrar = null;
            if (this._widgetAreaSource)
                GLib.source_remove(this._widgetAreaSource);
            this._widgetAreaSource = 0;
            this._menu?.destroy();
            this._menu = null;
            this._restoreNotificationPosition?.();
            this._restoreNativePanel();
            this._appSystem = null;
            this._favorites = null;
            this._settings = null;
            this._transferLabel = null;
    }
    
        _connect(object, signal, callback) {
            this._connections.push([object, object.connect(signal, callback)]);
        }

        _launcherIcon(target) {
            const file = this._settings.get_string(`${target}-launcher-icon-file`);
            if (file)
                return new Gio.FileIcon({file: Gio.File.new_for_path(file)});
            const name = this._settings.get_string(`${target}-launcher-icon-name`);
            return name && name !== 'gnome-logo-symbolic' ? new Gio.ThemedIcon({name}) : this._gnomeLogo;
        }

        _updateLauncherIcons() {
            const panelIcon = this._launcherIcon('panel');
            const dockIcon = this._launcherIcon('dock');
            for (const screen of this._screens) {
                screen.menuIcon.gicon = panelIcon;
                const launcher = screen.dock?.get_children().find(child => child.dockFocusKey === 'shortcut:applications');
                if (launcher)
                    launcher.get_child().gicon = dockIcon;
            }
        }

            _connectOverviewDash() {
                this._connect(Main.overview, 'showing', () => this._setDockReservationsRegistered(false));
                this._connect(Main.overview, 'hidden', () => {
                    this._positionDock(false);
                    this._setDockReservationsRegistered(true);
                });
                const dash = Main.overview.dash;
                if (!dash?.showAppsButton)
                    return;
                this._overviewDash = dash;
                dash.hide();
                const appDisplay = Main.overview._overview?.controls?.appDisplay;
                if (typeof appDisplay?._loadApps !== 'function')
                    return;
                this._overviewAppDisplay = appDisplay;
                this._overviewAppDisplayLoadApps = appDisplay._loadApps;
                const originalLoadApps = this._overviewAppDisplayLoadApps;
                this._overviewAppDisplayLoadAppsOverride = (...args) => {
                    const favorites = appDisplay._appFavorites;
                    const favoriteFilter = Object.create(favorites);
                    favoriteFilter.isFavorite = () => false;
                    appDisplay._appFavorites = favoriteFilter;
                    try {
                        return originalLoadApps.apply(appDisplay, args);
                    } finally {
                        appDisplay._appFavorites = favorites;
                    }
                };
                appDisplay._loadApps = this._overviewAppDisplayLoadAppsOverride;
                if (typeof appDisplay._compareItems === 'function') {
                    this._overviewAppDisplayCompareItems = appDisplay._compareItems;
                    this._overviewAppDisplayCompareItemsOverride = (first, second) => {
                        const firstIsFolder = Boolean(first.has_style_class_name?.('app-folder'));
                        const secondIsFolder = Boolean(second.has_style_class_name?.('app-folder'));
                        if (firstIsFolder !== secondIsFolder)
                            return firstIsFolder ? -1 : 1;
                        return String(first.name ?? '').localeCompare(String(second.name ?? ''), undefined,
                            {sensitivity: 'base', numeric: true});
                    };
                    appDisplay._compareItems = this._overviewAppDisplayCompareItemsOverride;
                }
            }

        _queueSettingsApply(key = null) {
            if (!this._settings)
                return;
            (this._settingsApplyKeys ??= new Set()).add(key);
            if (this._settingsApplySource)
                return;
            this._settingsApplySource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._settingsApplySource = 0;
                if (this._settings)
                    this._applySettings(this._settingsApplyKeys);
                return GLib.SOURCE_REMOVE;
            });
        }

        _applyLiveSettings(keys) {
            if (!keys?.size || !this._screens.length)
                return false;
            const live = new Set(['icon-size', 'dock-hover-animation', 'dock-hover-duration', 'dock-hover-strength',
                'panel-height', 'panel-layout', 'global-menu-enabled', 'dock-window-preview-delay', 'dock-hide-delay',
                'dock-slide-duration', 'dock-slide-curve', 'dock-maximize-slide-duration',
                'dock-launch-animation', 'dock-launch-mode', 'dock-launch-strength', 'dock-launch-duration',
                'dock-edge-margin', 'dock-item-spacing', 'dock-padding-top', 'dock-padding-bottom',
                'dock-padding-horizontal', 'dock-icon-padding', 'dock-border-radius', 'dock-show-border',
                'dock-show-shadow', 'dock-background-style', 'dock-magnify-icons', 'dock-magnify-max']);
            const dockMetricsChanged = ['dock-item-spacing', 'dock-padding-top', 'dock-padding-bottom',
                'dock-padding-horizontal', 'dock-icon-padding', 'dock-magnify-max'].some(key => keys.has(key));
            const dockMagnificationChanged = ['dock-magnify-icons', 'dock-magnify-max'].some(key => keys.has(key));
            const magnificationPointers = dockMagnificationChanged
                ? this._screens.map(screen => ({screen, point: screen.magnificationPoint?.slice() ?? null,
                    hovered: screen.dockContainer?.hover ?? false}))
                : [];
            const dockIconPaddingChanged = keys.has('dock-icon-padding');
            const dockAppearanceChanged = ['dock-border-radius', 'dock-show-border', 'dock-show-shadow',
                'dock-background-style'].some(key => keys.has(key));
            const rebuildDock = ['icon-size', 'dock-hover-animation'].some(key => keys.has(key));
            for (const key of keys) {
                if (key === 'dock-position' && this._screens.every(screen => screen.position === this._settings.get_int(key)))
                    continue;
                if (key === 'show-dock' && this._screens.every(screen => Boolean(screen.dock) === this._settings.get_boolean(key)))
                    continue;
                if (!live.has(key))
                    return false;
            }
            if (keys.has('global-menu-enabled') && this._settings.get_boolean('global-menu-dbus-enabled'))
                return false;
            if (dockIconPaddingChanged && this._screens.some(screen =>
                screen.dock?.get_children().some(button => button.dockWidgetType)))
                return false;
            for (const screen of this._screens) {
                if (screen.dock && dockAppearanceChanged)
                    this._syncDockAppearance(screen);
                if (screen.dock && dockIconPaddingChanged) {
                    const padding = this._settings.get_int('dock-icon-padding');
                    for (const button of screen.dock.get_children()) {
                        if (button.dockFocusKey && button.has_style_class_name?.('g-os-dock-item'))
                            button.set_style(`padding: ${padding}px;`);
                    }
                }
                if (screen.dock && dockMetricsChanged && !rebuildDock)
                    this._applyDockMetrics(screen);
                if (screen.dock && keys.has('dock-hover-animation') && Boolean(screen.dockViewport) !==
                    (this._settings.get_int('dock-hover-animation') === 4)) {
                    for (const [adjustment, id] of screen.dockAdjustmentSignals ?? [])
                        adjustment.disconnect(id);
                    screen.dockContainer.set_child(null);
                    if (screen.dockViewport) {
                        screen.dockViewport.remove_child(screen.dock);
                        screen.dockViewport.destroy();
                        screen.dockViewport = null;
                    } else {
                        screen.dockViewport = new St.Viewport({layout_manager: new Clutter.BinLayout(),
                            clip_to_view: false, style: 'padding: 0;'});
                        screen.dockViewport.add_child(screen.dock);
                    }
                    screen.dockContainer.set_child(screen.dockViewport ?? screen.dock);
                    screen.dockAdjustmentSignals = [];
                    for (const adjustment of [screen.dockContainer.hadjustment, screen.dockContainer.vadjustment]) {
                        if (adjustment)
                            screen.dockAdjustmentSignals.push([adjustment,
                                adjustment.connect('notify::value', () => this._updateDockIconGeometries(screen))]);
                    }
                }
                if (keys.has('panel-height')) {
                    screen.panel.set_height(this._settings.get_int('panel-height'));
                    this._applyPanelMetrics(screen);
                }
                if (keys.has('panel-layout')) {
                    screen.panelLayout = this._normalizePanelLayout(this._settings.get_strv('panel-layout'));
                    this._applyPanelLayout(screen);
                }
                if (keys.has('global-menu-enabled')) {
                    this._syncPanelGlobalMenu(screen);
                    this._applyPanelMetrics(screen);
                }
            }
            if (rebuildDock)
                this._rebuildDock();
            else {
                if (keys.has('dock-hover-duration') || keys.has('dock-hover-strength')) {
                    for (const screen of this._screens) {
                        for (const update of screen.hoverAnimationUpdates)
                            update(true);
                    }
                }
                if (keys.has('panel-height') || keys.has('global-menu-enabled') || dockMetricsChanged ||
                    keys.has('dock-edge-margin'))
                    this._positionDock();
                if (dockMetricsChanged || keys.has('dock-edge-margin'))
                    this._updateDockIconGeometries();
                if (dockMagnificationChanged) {
                    for (const {screen, point, hovered} of magnificationPointers) {
                        if (!screen.magnificationConnected)
                            continue;
                        if (point) {
                            screen.magnificationPoint = point;
                            if (hovered)
                                screen.dockContainer.hover = true;
                        }
                        this._queueDockMagnification(screen, point ?? screen.magnificationPoint, false, true);
                    }
                }
            }
            if (rebuildDock || keys.has('panel-height') || keys.has('global-menu-enabled'))
                this._updateActiveApp();
            if (keys.has('panel-height'))
                this._queueDesktopIconLayout();
            return true;
        }

        _applySettings(keys = null) {
            if (this._settingsApplySource)
                GLib.source_remove(this._settingsApplySource);
            this._settingsApplySource = 0;
            this._settingsApplyKeys = null;
            if (this._applyLiveSettings(keys))
                return;
            this._normalizeDockAppFolders();
            this._refreshDesktopWidgetMenus();
            const focus = this._captureDockFocus();
            this._widgetRuntime?.publishMonitors();
            this._syncMediaPlayers();
            this._updateWindowButtons();
            this._updateSearchBinding();
            this._updateCoverflow();
            this._hideNativePanel();
            this._applyNotificationPosition?.();

            this._destroyScreens();
            if (this._settings.get_boolean('global-menu-enabled') && this._settings.get_boolean('global-menu-dbus-enabled')) {
                if (!this._menuRegistrar) {
                    this._menuRegistrar = new DbusMenuRegistrar({Gio, GLib, Meta});
                    this._menuRegistrar.start();
                }
            } else {
                this._menuRegistrar?.destroy();
                this._menuRegistrar = null;
            }
            for (const monitor of Main.layoutManager.monitors) {
                const position = this._settings.get_int('dock-position');
                let topChromeActor: St.Widget | null = null;
                const chrome = new ChromeActorManager<St.Widget>(
                    (actor, options) => actor === topChromeActor
                        ? Main.layoutManager.addTopChrome(actor, options)
                        : Main.layoutManager.addChrome(actor, options),
                    actor => Main.layoutManager.removeChrome(actor));
                const screen: ExtensionScreen = {monitor, position, dockDocked: false,
                    dockViewport: null as St.Viewport | null,
                    popupSide: [St.Side.TOP, St.Side.LEFT, St.Side.RIGHT][position],
                    hoverAnimationUpdates: new Set(),
                    lifecycle: new LifecycleScope(undefined, chrome)};
                this._screens.push(screen);
                this._createPanel(screen);
                if (this._settings.get_boolean('show-dock')) {
                    screen.tooltip = new St.Label({style_class: 'dash-label g-os-dock-tooltip', visible: false});
                    screen.tooltip.clutter_text.line_wrap = true;
                    screen.tooltip.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                    topChromeActor = screen.tooltip;
                    screen.lifecycle.chrome?.add(screen.tooltip);
                    screen.dock = new St.BoxLayout({
                        style_class: 'dash-background g-os-dock',
                        clip_to_view: false,
                        style: `padding-top: ${this._settings.get_int('dock-padding-top')}px; ` +
                            `padding-bottom: ${this._settings.get_int('dock-padding-bottom')}px; ` +
                            `padding-left: ${this._settings.get_int('dock-padding-horizontal')}px; ` +
                            `padding-right: ${this._settings.get_int('dock-padding-horizontal')}px; ` +
                            `spacing: ${this._settings.get_int('dock-item-spacing')}px;`,
                        reactive: false,
                        orientation: position === 0 ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
                    });
                    screen.dock.add_style_class_name(this._dockRadiusClass());
                    if (position !== 0)
                        screen.dock.add_style_class_name('g-os-dock-vertical');
                    let dockContent = screen.dock;
                    if (this._settings.get_int('dock-hover-animation') === 4) {
                        screen.dockViewport = new St.Viewport({
                            layout_manager: new Clutter.BinLayout(),
                            clip_to_view: false,
                            style: 'padding: 0;',
                        });
                        screen.dockViewport.add_child(screen.dock);
                        dockContent = screen.dockViewport;
                    }
                    screen.dockContainer = new St.ScrollView({
                        child: dockContent,
                        clip_to_allocation: true,
                        reactive: false,
                        track_hover: true,
                        hscrollbar_policy: position === 0 ? St.PolicyType.EXTERNAL : St.PolicyType.NEVER,
                        vscrollbar_policy: position === 0 ? St.PolicyType.NEVER : St.PolicyType.EXTERNAL,
                    });
                    screen.lifecycle.chrome?.add(screen.dockContainer, {trackFullscreen: true});
                    screen.dockContainer.connect('notify::hover', () => {
                        for (const update of screen.hoverAnimationUpdates)
                            update();
                    });
                    this._configureDockBackground(screen);
                    screen.dockAdjustmentSignals = [];
                    for (const adjustment of [screen.dockContainer.hadjustment, screen.dockContainer.vadjustment]) {
                        if (!adjustment)
                            continue;
                        const id = adjustment.connect('notify::value', () => this._updateDockIconGeometries(screen));
                        screen.dockAdjustmentSignals.push([adjustment, id]);
                    }
                    if (this._settings.get_boolean('reserve-dock-space')) {
                        screen.dockReservation = new St.Widget({
                            opacity: 0,
                            reactive: false,
                            can_focus: false,
                        });
                    }
                    if (this._settings.get_boolean('dock-autohide') ||
                        this._settings.get_boolean('dock-hide-when-covered')) {
                        screen.edge = new St.Widget({reactive: true, track_hover: true, width: 10, height: 10});
                        screen.lifecycle.chrome?.add(screen.edge, {trackFullscreen: true});
                        screen.edge.connect('notify::hover', () => {
                            if (screen.edge.hover) {
                                if (screen.dockCovered)
                                    screen.dockPeek = true;
                                this._revealDock(screen);
                            } else {
                                this._queueDockHide(screen);
                            }
                        });
                        screen.dockContainer.connect('notify::hover', () => {
                            if (screen.dockContainer.hover)
                                this._revealDock(screen);
                            else
                                this._queueDockHide(screen);
                        });
                        if (this._settings.get_boolean('dock-autohide'))
                            this._hideDock(screen);
                    }
                    Main.ctrlAltTabManager.addGroup(screen.dockContainer,
                        `Dock - écran ${monitor.index + 1}`, 'shell-focus-dash-symbolic', {
                            proxy: screen.edge ?? screen.dockContainer,
                            focusCallback: () => {
                                if (screen.monitor.inFullscreen)
                                    return;
                                this._revealDock(screen);
                                screen.dockContainer.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
                            },
                        });
                    screen.dockKeyController = new Clutter.KeyController();
                    screen.dockKeyController.connect('key-press', () => {
                        const [, key] = screen.dockKeyController.get_key();
                        if (key !== Clutter.KEY_Escape)
                            return Clutter.EVENT_PROPAGATE;
                        screen.tooltip.hide();
                        global.display.focus_default_window(global.get_current_time());
                        this._queueDockHide(screen);
                        return Clutter.EVENT_STOP;
                    });
                    screen.dockContainer.add_action(screen.dockKeyController);
                }
            }
            this._syncDockCoverageWindows();
            this._rebuildDock();
            this._updateActiveApp();
            this._updateClocks();
            this._syncTrashTracking();
            this._updateDockCoverage();
            this._restoreDockFocus(focus);
            this._syncDesktopWidgets();
            this._syncDesktopIcons();
        }

        _hideNativePanel() {
            Main.panel.hide();
            Main.panel.reactive = false;
        }

        _restoreNativePanel() {
            if (!this._nativePanelState)
                return;
            Main.panel.visible = this._nativePanelState.visible;
            Main.panel.reactive = this._nativePanelState.reactive;
            this._nativePanelState = null;
        }

        _syncTrashTracking() {
            if (!this._settings.get_boolean('show-dock') || !this._settings.get_boolean('show-dock-shortcuts') ||
                !this._settings.get_boolean('shortcut-trash')) {
                this._stopTrashTracking();
                return;
            }
            if (this._trashFile)
                return;
            this._trashFile = Gio.File.new_for_uri('trash:///');
            try {
                this._trashMonitor = this._trashFile.monitor_directory(Gio.FileMonitorFlags.NONE, null);
                this._trashMonitorId = this._trashMonitor.connect('changed', () => {
                    if (this._trashRefreshSource)
                        return;
                    this._trashRefreshSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                        this._trashRefreshSource = 0;
                        this._refreshTrash();
                        return GLib.SOURCE_REMOVE;
                    });
                });
            } catch {
                this._trashPollSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
                    this._refreshTrash();
                    return GLib.SOURCE_CONTINUE;
                });
            }
            this._refreshTrash();
        }

        _refreshTrash() {
            if (!this._trashFile)
                return;
            if (this._trashRequest) {
                this._trashDirty = true;
                return;
            }
            const token = new Gio.Cancellable();
            this._trashRequest = token;
            this._trashFile.query_info_async('trash::item-count', Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT, token, (file, result) => {
                    let count = null;
                    try {
                        const info = file.query_info_finish(result);
                        if (info.has_attribute('trash::item-count'))
                            count = info.get_attribute_uint32('trash::item-count');
                    } catch {
                        count = null;
                    }
                    if (this._trashRequest !== token)
                        return;
                    this._trashRequest = null;
                    this._trashCount = count;
                    this._updateTrashButtons();
                    if (this._trashDirty) {
                        this._trashDirty = false;
                        this._refreshTrash();
                    }
                });
        }

        _stopTrashTracking() {
            this._trashRequest?.cancel();
            this._trashRequest = null;
            if (this._trashMonitor) {
                this._trashMonitor.disconnect(this._trashMonitorId);
                this._trashMonitor.cancel();
            }
            this._trashMonitor = null;
            for (const id of [this._trashRefreshSource, this._trashPollSource]) {
                if (id)
                    GLib.source_remove(id);
            }
            this._trashRefreshSource = 0;
            this._trashPollSource = 0;
            this._trashFile = null;
            this._trashDirty = false;
            this._trashCount = null;
        }

        _trashDescription() {
            if (this._trashCount === null)
                return 'Corbeille : état indisponible';
            if (this._trashCount === 0)
                return 'Corbeille vide';
            return `Corbeille : ${this._trashCount} élément${this._trashCount > 1 ? 's' : ''}`;
        }

        _updateTrashButtons() {
            for (const screen of this._screens) {
                if (!screen.trashButton)
                    continue;
                screen.trashButton.get_child().icon_name = this._trashCount > 0 ? 'user-trash-full' : 'user-trash';
                screen.trashButton.accessible_name = this._trashDescription();
            }
        }

        _destroyScreens() {
            this._restorePanelCalendar();
            for (const screen of this._screens) {
                screen.lifecycle.destroy();
                screen.disposed = true;
                this._destroyStatusNotifierMenus(screen);
                for (const id of screen.dropSources ?? [])
                    GLib.source_remove(id);
                screen.dropSources?.clear();
                this._clearDockIconGeometry(screen);
                for (const [adjustment, id] of screen.dockAdjustmentSignals ?? [])
                    adjustment.disconnect(id);
                if (screen.menuButton) {
                    Main.panel.menuManager.removeMenu(screen.menuButton.menu);
                    if (screen.menuButton === this._menu)
                        screen.menuButton.container.get_parent()?.remove_child(screen.menuButton.container);
                }
                if (screen.sessionButton)
                    Main.panel.menuManager.removeMenu(screen.sessionButton.menu);
                if (screen.appMenuButton)
                    Main.panel.menuManager.removeMenu(screen.appMenuButton.menu);
                if (screen.appLabel === this._activeAppLabel)
                    screen.appMenuButton?.remove_child(screen.appLabel);
                if (screen.transferLabel === this._transferLabel)
                    screen.transferLabel.get_parent()?.remove_child(screen.transferLabel);
                this._cancelDockHide(screen);
                if (screen.edge) {
                    if (screen.edge.get_parent())
                        screen.edge.get_parent().remove_child(screen.edge);
                    screen.edge.destroy();
                }
                if (screen.dockReservation) {
                    Main.layoutManager.removeChrome?.(screen.dockReservation);
                    if (screen.dockReservation.get_parent())
                        screen.dockReservation.get_parent().remove_child(screen.dockReservation);
                    screen.dockReservation.destroy();
                }
                if (screen.magnificationBackground) {
                    Main.layoutManager.removeChrome?.(screen.magnificationBackground);
                    const magnificationParent = screen.magnificationBackground.get_parent();
                    if (magnificationParent)
                        magnificationParent.remove_child(screen.magnificationBackground);
                    screen.magnificationBackground.destroy();
                }
                screen.globalMenu?.destroy();
                if (screen.notificationMenu) {
                    screen.notificationMenu.close();
                    Main.panel.menuManager.removeMenu(screen.notificationMenu);
                }
                if (screen.calendarMenu) {
                    screen.calendarMenu.close();
                    Main.panel.menuManager.removeMenu(screen.calendarMenu);
                    screen.calendarMenu.destroy();
                }
                for (const button of screen.statusButtons ?? []) {
                    button.statusController?.destroy();
                    Main.panel.menuManager.removeMenu(button.statusMenu);
                    button.statusMenu.destroy();
                }
                if (screen.dockViewport) {
                    if (screen.dock && screen.dock.get_parent() === screen.dockViewport)
                        screen.dockViewport.remove_child(screen.dock);
                    if (screen.dockContainer && screen.dockContainer.get_child() === screen.dockViewport)
                        screen.dockContainer.set_child(null);
                    const dockViewportParent = screen.dockViewport.get_parent();
                    if (dockViewportParent)
                        dockViewportParent.remove_child(screen.dockViewport);
                    screen.dockViewport.destroy();
                    screen.dockViewport = null;
                }
                if (screen.dockContainer) {
                    Main.ctrlAltTabManager.removeGroup?.(screen.dockContainer);
                    const dockContainerParent = screen.dockContainer.get_parent();
                    if (dockContainerParent)
                        dockContainerParent.remove_child(screen.dockContainer);
                    if (screen.dockContainer.get_parent() !== null)
                        screen.dockContainer.set_child(null);
                    screen.dockContainer.destroy();
                    screen.dockContainer = null;
                }
                if (screen.tooltip) {
                    screen.tooltip.destroy();
                }
                if (screen.panel)
                    screen.panel.destroy();
            }
            this._screens = [];
        }

        _updateWindowButtons() {
            if (!this._settings.get_boolean('window-buttons-left')) {
                this._restoreWindowButtons();
                return;
            }
            if (this._settings.get_strv('window-button-layout-backup').length > 0)
                return;
            this._windowSettings ??= new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
            if (!this._windowSettings.is_writable('button-layout')) {
                Main.notifyError('Disposition des boutons indisponible', 'Le réglage système est verrouillé.');
                return;
            }
            const previous = this._windowSettings.get_user_value('button-layout');
            const backup = previous ? ['user', previous.unpack()] : ['default'];
            if (!this._settings.set_strv('window-button-layout-backup', backup))
                return;
            if (!this._windowSettings.set_string('button-layout', 'close,minimize,maximize:'))
                this._settings.set_strv('window-button-layout-backup', []);
        }

        _restoreWindowButtons() {
            const backup = this._settings.get_strv('window-button-layout-backup');
            if (backup.length === 0)
                return;
            this._windowSettings ??= new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
            if (this._windowSettings.get_string('button-layout') === 'close,minimize,maximize:') {
                if (!this._windowSettings.is_writable('button-layout'))
                    return;
                if (backup[0] === 'default')
                    this._windowSettings.reset('button-layout');
                else if (backup[0] === 'user' && backup.length === 2 &&
                    !this._windowSettings.set_string('button-layout', backup[1]))
                    return;
            }
            this._settings.set_strv('window-button-layout-backup', []);
        }

        _updateCoverflow() {
            if (!this._coverflowController && !this._settings.get_boolean('coverflow-enabled'))
                return;
            if (!this._coverflowController) {
                const Popup = createCoverflowSwitcher({GObject, AltTab, St, Clutter, Meta, Pango, Main, global});
                this._coverflowController = new CoverflowController({
                    wm: Main.wm, settings: this._settings,
                    createPopup: settings => {
                        for (const screen of this._screens) {
                            for (const button of screen.appButtons ?? [])
                                button.windowPreview?.close();
                        }
                        return new Popup(settings);
                    },
                    modes: Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                });
            }
            this._coverflowController.update();
        }

        _updateSearchBinding() {
            if (this._searchBinding)
                Main.wm.removeKeybinding('spotlight-search');
            this._searchBinding = false;
            this._searchFallbackSettings = null;
            if (this._settings.get_boolean('enable-spotlight')) {
                if (!this._searchSystemSettings) {
                    this._searchSystemSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
                    this._connect(this._searchSystemSettings, 'changed', () => this._updateSearchBinding());
                }
                const normalize = accelerator => accelerator.toLowerCase().replace('<primary>', '<control>');
                const occupied = new Set(this._searchSystemSettings.settings_schema.list_keys()
                    .flatMap(key => this._searchSystemSettings.get_strv(key)).map(normalize));
                const requested = this._settings.get_strv('spotlight-search');
                let bindingSettings = this._settings;
                if (requested.some(accelerator => occupied.has(normalize(accelerator)))) {
                    const fallback = ['<Control><Alt>space', '<Super><Control>space']
                        .find(accelerator => !occupied.has(normalize(accelerator)));
                    const available = requested.filter(accelerator => !occupied.has(normalize(accelerator)));
                    if (fallback && !available.length)
                        available.push(fallback);
                    this._searchFallbackSettings = new Gio.Settings({settings_schema: this._settings.settings_schema,
                        backend: Gio.memory_settings_backend_new()});
                    this._searchFallbackSettings.set_strv('spotlight-search', available);
                    bindingSettings = this._searchFallbackSettings;
                }
                const action = Main.wm.addKeybinding('spotlight-search', bindingSettings,
                    Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                    Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                    () => Main.overview.focusSearch());
                this._searchBinding = action !== Meta.KeyBindingAction.NONE;
            }
        }

        _rebuildDock() {
            const focus = this._captureDockFocus();
            const favorites = this._favorites.getFavorites();
            const favoriteIds = new Set(favorites.map(app => app.get_id()));
            const running = this._settings.get_boolean('show-running-apps')
                ? this._appSystem.get_running() : [];
            const workspaceApps = this._settings.get_boolean('dock-current-workspace');
            const workspace = workspaceApps ? global.workspace_manager.get_active_workspace() : null;
            const tracking = this._settings.get_boolean('show-dock') && this._settings.get_boolean('show-running-apps');
            this._syncWorkspaceSignals(tracking ? workspace : null);
            this._syncRunningAppSignals(workspaceApps && tracking ? running : []);
            const iconSize = this._settings.get_int('icon-size');
            const iconPadding = this._settings.get_int('dock-icon-padding');
            const dockFolders = this._settings.get_strv('dock-folders');
            const appFolders = readAppFolders(this._settings);
            const groupedApps = new Set(appFolders.flatMap(folder => folder.apps));
            const visibleFavorites = favorites.filter(app => !groupedApps.has(app.get_id()));
            const shortcuts = new Set(this._settings.get_boolean('show-dock-shortcuts')
                ? ['overview', 'desktop', 'files', 'downloads', 'trash']
                    .filter(name => this._settings.get_boolean(`shortcut-${name}`)) : []);
            const downloads = shortcuts.has('downloads')
                ? GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) : null;
            if (!downloads)
                shortcuts.delete('downloads');

            for (const screen of this._screens) {
                if (!screen.dock)
                    continue;
                const menuOpen = (screen.appButtons ?? []).some(button => button._menu?.isOpen) ||
                    (screen.shortcutMenus ?? []).some(menu => menu.isOpen);
                if (menuOpen || screen.reorder) {
                    screen.rebuildPending = true;
                    for (const button of screen.appButtons ?? []) {
                        if (button.app.state === Shell.AppState.STARTING)
                            button.add_style_pseudo_class('starting');
                        else
                            button.remove_style_pseudo_class('starting');
                    }
                    continue;
                }
                screen.rebuildPending = false;
                const existingAppButtons = new Map<string, AppDisplay.AppIcon & DockAppMetadata>();
                for (const button of (screen.appButtons ?? []) as (AppDisplay.AppIcon & DockAppMetadata)[])
                    existingAppButtons.set(button.app.get_id(), button);
                for (const button of existingAppButtons.values()) {
                    if (button.get_parent() === screen.dock)
                        screen.dock.remove_child(button);
                }
                screen.tooltip.hide();
                screen.hoverAnimationUpdates.clear();
                screen.dock.destroy_all_children();
                screen.appButtons = [];
                screen.shortcutMenus = [];
                screen.desktopButton = null;
                screen.trashButton = null;
                screen.folderButtons = [];
                const apps = [...visibleFavorites, ...running.filter(app =>
                    !groupedApps.has(app.get_id()) && !favoriteIds.has(app.get_id()) && (!workspaceApps || app.get_windows().some(window =>
                        !window.skip_taskbar && window.located_on_workspace(workspace))))];
                for (const app of apps) {
                    const existingButton = existingAppButtons.get(app.get_id());
                    if (existingButton?.app === app) {
                        existingAppButtons.delete(app.get_id());
                        existingButton.accessible_name = this._appDescription(app, screen);
                        existingButton.icon.setIconSize(iconSize);
                        existingButton.set_style(`padding: ${iconPadding}px;`);
                        existingButton.progressBar.set_style(`width: ${iconSize}px;`);
                        if (app.state === Shell.AppState.STARTING)
                            existingButton.add_style_pseudo_class('starting');
                        else
                            existingButton.remove_style_pseudo_class('starting');
                        if (!existingButton._dockHoverAnimationUpdate)
                            this._attachMagnification(screen, existingButton, existingButton.icon.icon);
                        existingButton._dockHoverAnimationUpdate?.(true);
                        if (existingButton._dockHoverAnimationUpdate)
                            screen.hoverAnimationUpdates.add(existingButton._dockHoverAnimationUpdate);
                        screen.appButtons.push(existingButton);
                        screen.dock.add_child(existingButton);
                        this._positionNotificationBadge(existingButton);
                        this._positionTransferProgress(existingButton);
                        continue;
                    }
                    if (existingButton) {
                        existingAppButtons.delete(app.get_id());
                        existingButton.destroy();
                    }
                    const button = new AppDisplay.AppIcon(app, {
                        setSizeManually: true,
                        showLabel: false,
                        isDraggable: false,
                        popupMenuSide: screen.popupSide,
                    }) as AppDisplay.AppIcon & DockAppMetadata;
                    button.add_style_class_name('g-os-dock-item');
                    button.dockFocusKey = `app:${app.get_id()}`;
                    button.accessible_name = this._appDescription(app, screen);
                    if (app.state === Shell.AppState.STARTING)
                        button.add_style_pseudo_class('starting');
                    button.icon.setIconSize(iconSize);
                    button.set_style(`padding: ${iconPadding}px;`);
                    const updateIconGeometry = () => this._queueDockIconGeometry(screen, button);
                    button.connect('notify::allocation', updateIconGeometry);
                    button.connect('destroy', () => this._clearAppDockIconGeometry(screen, app));
                    const nativeAnimateLaunch = button.animateLaunch?.bind(button) ?? (() => {});
                    button.animateLaunch = () => {
                        if (!this._settings.get_boolean('dock-launch-animation'))
                            return;
                        const mode = this._settings.get_int('dock-launch-mode');
                        if (mode === 1 || (mode === 0 && this._settings.get_int('dock-hover-animation') === 3))
                            this._animateDockLaunch(button, screen);
                        else
                            nativeAnimateLaunch();
                    };
                    const activate = button.activate.bind(button);
                    button.activate = mouseButton => {
                        if (!this._activateAppFromDock(app, mouseButton, screen))
                            activate(mouseButton);
                    };
                    button.connect('scroll-event', (actor, event) => {
                        if (button._menu?.isOpen)
                            return Clutter.EVENT_PROPAGATE;
                        const direction = event.get_scroll_direction();
                        const delta = direction === Clutter.ScrollDirection.UP ? -1
                            : direction === Clutter.ScrollDirection.DOWN ? 1 : 0;
                        if (delta === 0)
                            return Clutter.EVENT_PROPAGATE;
                        return this._cycleAppWindowFromDock(app, delta, screen)
                            ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
                    });
                    button.notificationBadge = new St.Label({
                        style_class: 'g-os-notification-badge',
                        x_align: Clutter.ActorAlign.START,
                        y_align: Clutter.ActorAlign.START,
                        visible: false,
                    });
                    button.get_child().add_child(button.notificationBadge);
                    let badgePositionSource = 0;
                    const positionBadge = () => {
                        this._positionNotificationBadge(button);
                        this._positionTransferProgress(button);
                        if (!badgePositionSource) {
                            badgePositionSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                badgePositionSource = 0;
                                this._positionNotificationBadge(button);
                                this._positionTransferProgress(button);
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                    };
                    for (const signal of ['notify::allocation', 'notify::scale-x', 'notify::scale-y',
                        'notify::translation-x', 'notify::translation-y'])
                        button.icon.icon.connect(signal as any, positionBadge);
                    button.get_child().connect('notify::allocation', positionBadge);
                    button.notificationBadge.connect('notify::allocation', positionBadge);
                    button.connect('destroy', () => {
                        if (badgePositionSource)
                            GLib.source_remove(badgePositionSource);
                        badgePositionSource = 0;
                    });
                    button.progressBar = new St.Widget({
                        style_class: 'g-os-transfer-progress',
                        style: `width: ${iconSize}px;`,
                        layout_manager: new Clutter.BinLayout(),
                        clip_to_allocation: true,
                        x_align: Clutter.ActorAlign.START,
                        y_align: Clutter.ActorAlign.START,
                        visible: false,
                    });
                    button.progressBar.set_pivot_point(0, 0);
                    button.progressFill = new St.Widget({
                        style_class: 'g-os-transfer-progress-fill',
                        x_expand: true,
                        y_expand: true,
                        scale_x: 0,
                    });
                    button.progressFill.set_pivot_point(0, 0);
                    button.progressBar.add_child(button.progressFill);
                    button.get_child().add_child(button.progressBar);
                    button.progressBar.connect('notify::allocation', positionBadge);
                    this._attachTooltip(screen, button, () => this._appDescription(app, screen));
                    let summarySignal = 0;
                    const updateSummary = () => {
                        const count = this._windowsForDock(app, screen).length;
                        if (!button.windowSummary) {
                            button.windowSummary = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
                            button._menu.addMenuItem(button.windowSummary, 0);
                        }
                        button.windowSummary.label.text = `${count} fenêtre${count === 1 ? '' : 's'} dans ce Dock`;
                        button.windowSummary.accessible_name = button.windowSummary.label.text;
                        this._updateNotificationCounts();
                    };
                    const disconnectSummary = () => {
                        if (summarySignal)
                            app.disconnect(summarySignal);
                        summarySignal = 0;
                    };
                    button.connect('menu-state-changed', (actor, opened) => {
                        if (screen.disposed) {
                            disconnectSummary();
                            return;
                        }
                        screen.tooltip.hide();
                        if (opened) {
                            button._menu.actor.add_style_class_name('g-os-popup');
                            this._revealDock(screen);
                            updateSummary();
                            if (!summarySignal)
                                summarySignal = app.connect('windows-changed', updateSummary);
                        } else {
                            disconnectSummary();
                            this._finishDockMenu(screen);
                            this._queueDockHide(screen);
                        }
                    });
                    button.connect('destroy', disconnectSummary);
                    screen.appButtons.push(button);
                    screen.dock.add_child(button);
                }
                for (const button of existingAppButtons.values())
                    button.destroy();

            const showApps = new St.Button({
                style_class: 'g-os-dock-item g-os-show-apps',
                accessible_name: 'Afficher les applications',
                can_focus: true,
                reactive: true,
                track_hover: true,
            }) as St.Button & DockButtonMetadata;
            showApps.set_child(new St.Icon({gicon: this._launcherIcon('dock'), fallback_gicon: this._gnomeLogo, icon_size: iconSize}));
            showApps.set_style(`padding: ${iconPadding}px;`);
            showApps.dockFocusKey = 'shortcut:applications';
            showApps.connect('clicked', () => Main.overview.showApps());
            this._attachLaunchpadMenu(screen, showApps);
            this._attachTooltip(screen, showApps, 'Applications');
            screen.dock.add_child(showApps);
            if (shortcuts.size > 0) {
                if (shortcuts.has('overview'))
                    this._addDockShortcut(screen, 'Fenêtres et espaces de travail',
                        'view-paged-symbolic', iconSize, () => Main.overview.show());
                if (shortcuts.has('desktop'))
                    screen.desktopButton = this._addDockShortcut(screen, () => this._desktopActionName(),
                        'user-desktop', iconSize, () => this._toggleDesktop());
                if (shortcuts.has('files')) {
                    const button = this._addDockShortcut(screen, 'Fichiers', 'system-file-manager', iconSize,
                        () => this._openLocation(Gio.File.new_for_path(GLib.get_home_dir()).get_uri()));
                    this._attachPlacesMenu(screen, button);
                }
                if (shortcuts.has('downloads')) {
                    const button = this._addDockShortcut(screen, 'Téléchargements', 'folder-download', iconSize,
                        () => this._openLocation(Gio.File.new_for_path(downloads).get_uri()));
                    this._attachDownloadsMenu(screen, button, downloads);
                }
                if (shortcuts.has('trash')) {
                    screen.trashButton = this._addDockShortcut(screen, () => this._trashDescription(), 'user-trash', iconSize,
                        () => this._openLocation('trash:///'));
                    this._attachTrashMenu(screen, screen.trashButton);
                }
            }
                this._appendDockLocationShortcuts(screen, iconSize);
                for (const uri of dockFolders)
                    this._addDockFolder(screen, uri, iconSize, iconPadding);
                for (const folder of appFolders)
                    this._addDockAppFolder(screen, folder, iconSize, iconPadding);
                this._widgetRuntime.makeDock(screen, iconSize, iconPadding);
                this._configureDockOrder(screen);
                this._configureDockMagnification(screen);
                this._setDockInteraction(screen, this._settings.get_int('dock-background-style') !== 3);
            }
            this._positionDock();
            this._updateDockIconGeometries();
            this._updateActiveApp();
            this._updateNotificationCounts();
            this._updateTransferIndicators();
            this._updateTrashButtons();
            this._updateAttentionIndicators();
            this._restoreDockFocus(focus);
        }

        _normalizeDockAppFolders() {
            if (this._normalizingDockAppFolders || !this._settings.is_writable('dock-app-folders'))
                return;
            const folders = [];
            const collapsed = [];
            let changed = false;
            for (const folder of readAppFolders(this._settings)) {
                const apps = folder.apps.filter(id => this._appSystem.lookup_app(id));
                if (apps.length !== folder.apps.length)
                    changed = true;
                if (apps.length < 2) {
                    changed = true;
                    collapsed.push({folderId: folder.id, appId: apps[0] ?? null});
                } else {
                    folders.push({...folder, apps});
                }
            }
            if (!changed)
                return;
            const currentOrder = this._settings.get_strv('dock-item-order');
            let order = [...currentOrder];
            for (const {folderId, appId} of collapsed) {
                const folderKey = `app-folder:${folderId}`;
                if (!appId) {
                    order = order.filter(key => key !== folderKey);
                    continue;
                }
                const appKey = `app:${appId}`;
                const folderIndex = order.indexOf(folderKey);
                const appIndex = order.indexOf(appKey);
                const index = folderIndex >= 0 ? folderIndex : appIndex >= 0 ? appIndex : order.length;
                order = order.filter(key => key !== folderKey && key !== appKey);
                order.splice(Math.min(index, order.length), 0, appKey);
            }
            this._normalizingDockAppFolders = true;
            try {
                if (!writeAppFolders(this._settings, folders))
                    return;
                if (this._settings.is_writable('dock-item-order') &&
                    order.join('\n') !== currentOrder.join('\n'))
                    this._settings.set_strv('dock-item-order', order);
                for (const {appId} of collapsed) {
                    if (appId && !this._favorites.isFavorite(appId))
                        this._favorites.addFavorite(appId);
                }
            } finally {
                this._normalizingDockAppFolders = false;
            }
        }

        _positionNotificationBadge(button) {
            const icon = button.icon.icon;
            const badge = button.notificationBadge;
            const [iconX, iconY] = icon.get_transformed_position();
            const [iconWidth, iconHeight] = icon.get_transformed_size();
            if (iconWidth <= 0 || iconHeight <= 0)
                return;
            const [success, x, y] = button.get_child().transform_stage_point(iconX + iconWidth, iconY);
            if (!success || !Number.isFinite(x) || !Number.isFinite(y))
                return;
            const [, width] = badge.get_preferred_width(-1);
            const [, height] = badge.get_preferred_height(width);
            const allocation = badge.get_allocation_box();
            if (![width, height, allocation.x1, allocation.y1].every(Number.isFinite))
                return;
            badge.translation_x = x - allocation.x1 - width / 2;
            badge.translation_y = y - allocation.y1 - height / 2;
        }

        _positionTransferProgress(button) {
            const bar = button.progressBar;
            if (!bar || !bar.visible || button.destroyed)
                return;
            const icon = button.icon.icon;
            const [iconX, iconY] = icon.get_transformed_position();
            const [iconWidth, iconHeight] = icon.get_transformed_size();
            const container = button.get_child();
            const [success, x, bottom] = container.transform_stage_point(iconX, iconY + iconHeight);
            const [rightSuccess, right] = container.transform_stage_point(iconX + iconWidth, iconY + iconHeight);
            const [, height] = bar.get_preferred_height(-1);
            const allocation = bar.get_allocation_box();
            if (!success || !rightSuccess || iconWidth <= 0 || iconHeight <= 0 ||
                ![x, bottom, right, height, allocation.x1, allocation.y1].every(Number.isFinite))
                return;
            bar.scale_x = (right - x) / this._settings.get_int('icon-size');
            bar.translation_x = x - allocation.x1;
            bar.translation_y = bottom - height - allocation.y1;
        }

        _updateDockIconGeometries(screen = null) {
            for (const candidate of screen ? [screen] : this._screens) {
                for (const button of candidate.appButtons ?? [])
                    this._queueDockIconGeometry(candidate, button);
            }
        }

        _queueDockIconGeometry(screen, button) {
            if (screen.disposed || button.destroyed)
                return;
            (screen.dockGeometryButtons ??= new Set()).add(button);
            if (screen.dockGeometrySource)
                return;
            screen.dockGeometrySource = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
                screen.dockGeometrySource = 0;
                const buttons = [...(screen.dockGeometryButtons ?? [])];
                screen.dockGeometryButtons?.clear();
                if (screen.disposed)
                    return GLib.SOURCE_REMOVE;
                const viewport = {
                    position: screen.dockContainer.get_transformed_position(),
                    size: screen.dockContainer.get_transformed_size(),
                };
                for (const candidate of buttons) {
                    if (!candidate.destroyed && candidate.get_parent() === screen.dock)
                        this._updateDockIconGeometry(screen, candidate, viewport);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        _updateDockIconGeometry(screen, button, viewport = null) {
            const {monitor, dockContainer} = screen;
            const [x, y] = button.get_transformed_position();
            const [width, height] = button.get_transformed_size();
            const [viewX, viewY] = viewport?.position ?? dockContainer.get_transformed_position();
            const [viewWidth, viewHeight] = viewport?.size ?? dockContainer.get_transformed_size();
            const visible = dockContainer.visible !== false && !monitor.inFullscreen &&
                x + width > viewX && x < viewX + viewWidth &&
                y + height > viewY && y < viewY + viewHeight;
            const geometry = visible && width > 0 && height > 0
                ? new Mtk.Rectangle({
                    x: Math.round(x),
                    y: Math.round(y),
                    width: Math.round(width),
                    height: Math.round(height),
                }) : null;

            const windows = button.app.get_windows();
            const activeWindows = new Set(windows);
            const screenCache = screen.dockIconGeometries ??= new Map();
            let cache = screenCache.get(button.app);
            if (!cache) {
                cache = new Map();
                screenCache.set(button.app, cache);
            }
            for (const [window, previous] of cache) {
                if (!activeWindows.has(window)) {
                    if (previous !== null && typeof window.set_icon_geometry === 'function')
                        window.set_icon_geometry(null);
                    cache.delete(window);
                }
            }
            for (const window of windows) {
                if (typeof window.get_monitor !== 'function' || typeof window.set_icon_geometry !== 'function')
                    continue;
                const target = window.get_monitor() === monitor.index ? geometry : null;
                const targetKey = target ? `${target.x}:${target.y}:${target.width}:${target.height}` : null;
                const hasPrevious = cache.has(window);
                const previous = cache.get(window);
                if (!hasPrevious || previous !== targetKey) {
                    if (targetKey !== null || (hasPrevious && previous !== null))
                        window.set_icon_geometry(target);
                    cache.set(window, targetKey);
                }
            }
        }

        _clearAppDockIconGeometry(screen, app) {
            const cache = screen.dockIconGeometries?.get(app);
            if (cache) {
                for (const [window, geometry] of cache) {
                    if (geometry !== null && typeof window.set_icon_geometry === 'function')
                        window.set_icon_geometry(null);
                }
                screen.dockIconGeometries.delete(app);
                return;
            }
            for (const window of app.get_windows()) {
                if (typeof window.set_icon_geometry !== 'function')
                    continue;
                if (typeof window.get_monitor === 'function' && window.get_monitor() === screen.monitor.index)
                    window.set_icon_geometry(null);
            }
        }

        _clearDockIconGeometry(screen) {
            if (screen.dockGeometrySource)
                laters.remove(screen.dockGeometrySource);
            screen.dockGeometrySource = 0;
            screen.dockGeometryButtons?.clear();
            for (const button of screen.appButtons ?? []) {
                this._clearAppDockIconGeometry(screen, button.app);
            }
        }

        _desktopActionName() {
            return this._desktopWindows.has(global.workspace_manager.get_active_workspace())
                ? 'Restaurer les fenêtres' : 'Afficher le bureau';
        }

        _updateDesktopButtons() {
            for (const screen of this._screens) {
                if (screen.desktopButton)
                    screen.desktopButton.accessible_name = this._desktopActionName();
            }
        }

        _toggleDesktop() {
            const workspace = global.workspace_manager.get_active_workspace();
            Main.overview.hide();
            if (this._desktopWindows.has(workspace)) {
                this._restoreDesktop(workspace);
                return;
            }
            const windows = workspace.list_windows().filter(window =>
                !window.minimized && !window.skip_taskbar && window.can_minimize());
            if (windows.length === 0)
                return;
            const group = {windows: new Map(), focusedWindow: global.display.focus_window};
            this._desktopWindows.set(workspace, group);
            for (const window of windows) {
                const ids = [
                    window.connect('unmanaged', () => this._forgetDesktopWindow(workspace, window)),
                    window.connect('notify::minimized', () => {
                        if (!window.minimized)
                            this._forgetDesktopWindow(workspace, window);
                    }),
                ];
                group.windows.set(window, ids);
                window.minimize();
            }
            this._updateDesktopButtons();
        }

        _forgetDesktopWindow(workspace, window) {
            const group = this._desktopWindows.get(workspace);
            const ids = group?.windows.get(window);
            if (!ids)
                return;
            for (const id of ids)
                window.disconnect(id);
            group.windows.delete(window);
            if (group.windows.size === 0)
                this._desktopWindows.delete(workspace);
            this._updateDesktopButtons();
        }

        _restoreDesktop(workspace, restoreFocus = true) {
            const group = this._desktopWindows.get(workspace);
            if (!group)
                return;
            this._desktopWindows.delete(workspace);
            let focusedWindowRestored = false;
            for (const [window, ids] of group.windows) {
                for (const id of ids)
                    window.disconnect(id);
                if (window.minimized && window.located_on_workspace(workspace)) {
                    window.unminimize();
                    focusedWindowRestored ||= window === group.focusedWindow;
                }
            }
            if (restoreFocus && focusedWindowRestored &&
                global.workspace_manager.get_active_workspace() === workspace)
                Main.activateWindow(group.focusedWindow);
            this._updateDesktopButtons();
        }

        _activateAppFromDock(app, mouseButton, screen) {
            const cycle = this._settings.get_boolean('dock-cycle-windows');
            const filtered = this._settings.get_boolean('dock-current-workspace');
            if (Main.overview.visible ||
                (mouseButton && mouseButton !== Clutter.BUTTON_PRIMARY))
                return false;
            const modifiers = Clutter.get_current_event()?.get_state() ?? 0;
            const shortcutModifiers = Clutter.ModifierType.CONTROL_MASK |
                Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.MOD1_MASK |
                Clutter.ModifierType.SUPER_MASK;
            if (modifiers & shortcutModifiers)
                return false;
            const workspace = global.workspace_manager.get_active_workspace();
            const matching = filtered ? this._windowsForDock(app, screen)
                : app.get_windows().filter(window => !window.skip_taskbar && window.located_on_workspace(workspace));
            const windows = matching.filter(window => window.located_on_workspace(workspace))
                .sort((first, second) => first.get_stable_sequence() - second.get_stable_sequence());
            const focus = global.display.focus_window;
            const index = windows.indexOf(focus);
            if (index >= 0) {
                if (cycle && windows.length > 1) {
                    const target = windows[(index + 1) % windows.length];
                    if (target.minimized)
                        target.unminimize();
                    Main.activateWindow(target);
                    return true;
                }
                if (focus.minimized) {
                    focus.unminimize();
                    Main.activateWindow(focus);
                    return true;
                }
                if (focus.can_minimize?.() !== false) {
                    focus.minimize();
                    return true;
                }
            }
            const minimized = windows.find(window => window.minimized);
            if (minimized) {
                minimized.unminimize();
                Main.activateWindow(minimized);
                return true;
            }
            if (filtered && matching.length > 0) {
                const target = matching.includes(focus) ? focus
                    : matching.find(window => window.located_on_workspace(workspace) && !window.minimized) ??
                        matching.find(window => window.located_on_workspace(workspace)) ?? matching[0];
                if (target.minimized)
                    target.unminimize();
                Main.activateWindow(target);
                return true;
            }
            return false;
        }

        _cycleAppWindowFromDock(app, direction, screen) {
            if (Main.overview.visible)
                return false;
            const workspace = global.workspace_manager.get_active_workspace();
            const filtered = this._settings.get_boolean('dock-current-workspace');
            const matching = filtered ? this._windowsForDock(app, screen) : app.get_windows();
            const windows = matching.filter(window => !window.skip_taskbar && window.located_on_workspace(workspace))
                .sort((first, second) => first.get_stable_sequence() - second.get_stable_sequence());
            if (windows.length < 2)
                return false;
            const index = windows.indexOf(global.display.focus_window);
            const next = index < 0 ? direction > 0 ? 0 : windows.length - 1
                : (index + direction + windows.length) % windows.length;
            Main.activateWindow(windows[next]);
            return true;
        }

        _addDockWidget(screen, type, iconSize, iconPadding, instance = null) {
            if (type === 'clock' && !this._dockWallClock) {
                this._dockWallClock = new GnomeDesktop.WallClock({time_only: true});
                this._dockClockSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
                this._connect(this._dockWallClock, 'notify::clock', () => this._updateDockWidgets());
            }
            const square = instance && !instance.legacy ? instance.dockSize === 1
                : this._settings.get_value('dock-widget-sizes').deep_unpack()[type] === 1;
            const thickness = iconSize + iconPadding * 2;
            const length = square ? thickness : type === 'media'
                ? Math.max(180, Math.round(thickness * 4.5)) : Math.round(thickness * 2.5);
            const contentLength = length - iconPadding * 2;
            const horizontal = screen.position === 0;
            const content = new St.BoxLayout({
                style_class: `g-os-dock-widget-content g-os-dock-widget-${type}${iconSize < 32 ? ' g-os-dock-widget-compact' : ''}${square ? ' g-os-dock-widget-square' : ''}`,
                orientation: Clutter.Orientation.VERTICAL,
                width: contentLength,
                height: iconSize,
            });
            const primary = new St.Label({style_class: 'g-os-dock-widget-primary'});
            const secondary = new St.Label({style_class: 'g-os-dock-widget-secondary'});
            primary.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            secondary.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            const mediaView = type === 'media' ? this._createMediaView({compact: !square, square, iconSize, screen}) : null;
            if (mediaView)
                content.add_child(mediaView);
            else {
                content.add_child(primary);
                content.add_child(secondary);
            }
            content.set_pivot_point(0.5, 0.5);
            content.rotation_angle_z = horizontal || type === 'media' ? 0 : screen.position === 1 ? 90 : -90;
            if (!horizontal && type === 'media') {
                content.set_size(iconSize, contentLength);
                if (!square)
                    content.add_style_class_name('g-os-media-vertical-content');
            }
            const viewport = new St.Widget({layout_manager: new Clutter.FixedLayout(),
                width: horizontal ? length : thickness, height: horizontal ? thickness : length});
            viewport.add_child(content);
            content.set_position(horizontal || type === 'media' ? iconPadding : (thickness - contentLength) / 2,
                horizontal || type === 'media' ? iconPadding : (length - iconSize) / 2);
            this._widgetRuntime.fitDockContent(content,
                !horizontal && type === 'media' ? iconSize : contentLength,
                !horizontal && type === 'media' ? contentLength : iconSize,
                horizontal || type === 'media' ? iconPadding : (thickness - contentLength) / 2,
                horizontal || type === 'media' ? iconPadding : (length - iconSize) / 2);
            const button = new St.Button({style_class: 'g-os-dock-widget', child: viewport,
                accessible_name: type === 'media' ? 'Lecteur média' : type === 'clock' ? 'Horloge' : 'Date',
                can_focus: true, reactive: true, track_hover: true}) as St.Button & DockButtonMetadata;
            button.set_size(horizontal ? length : thickness, horizontal ? thickness : length);
            button.dockFocusKey = `widget:${type}`;
            button.dockWidgetType = type;
            button.dockWidgetSquare = square;
            button.dockWidgetPrimary = primary;
            button.dockWidgetSecondary = secondary;
            button.mediaView = mediaView;
            button._delegate = {
                getDragActor: () => new Clutter.Clone({source: viewport}),
                getDragActorSource: () => viewport,
            };
            if (mediaView) {
                mediaView.ownerButton = button;
                if (square)
                    button.connect('clicked', () => button.shortcutMenu.toggle());
            } else
                button.connect('clicked', () => Main.panel.statusArea?.dateMenu?.menu?.toggle());
            this._attachTooltip(screen, button, () => button.accessible_name, {magnify: type !== 'media'});
            this._createShortcutMenu(screen, button, {onOpen: menu => {
                menu.removeAll();
                if (type === 'media') {
                    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
                    item.add_child(this._createMediaView({screen}));
                    menu.addMenuItem(item);
                    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                }
                for (const [size, title] of [[1, '1×1'], [0, 'Large']]) {
                    const item = menu.addAction(title, () => {
                        if (!this._settings.is_writable('dock-widget-sizes'))
                            return;
                        const sizes = this._settings.get_value('dock-widget-sizes').deep_unpack();
                        sizes[type] = size;
                        menu.close();
                        if (instance && !instance.legacy)
                            this._widgetRuntime.updateInstance(instance, {dockSize: size});
                        else
                            this._settings.set_value('dock-widget-sizes', new GLib.Variant('a{si}', sizes));
                    });
                    item.setOrnament((square ? 1 : 0) === size ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
                    item.setSensitive(this._settings.is_writable('dock-widget-sizes'));
                }
                const remove = menu.addAction('Retirer ce widget', () => {
                    menu.close();
                    this._widgetRuntime.removeInstance(instance);
                });
                const writableKey = instance?.legacy ? `dock-widget-${type}` : 'widget-instances';
                remove.setSensitive(Boolean(instance) && this._settings.is_writable(writableKey));
            }});
            screen.dock.add_child(button);
            this._updateDockWidget(button);
            return button;
        }

        _updateDockWidget(button) {
            if (!['clock', 'calendar', 'media'].includes(button.dockWidgetType))
                return;
            if (button.dockWidgetType === 'media') {
                this._refreshMediaWidgets();
                return;
            }
            const date = GLib.DateTime.new_now_local();
            if (button.dockWidgetType === 'clock') {
                button.dockWidgetPrimary.text = button.dockWidgetSquare
                    ? date.format(this._dockClockSettings.get_string('clock-format') === '12h' ? '%I' : '%H')
                    : this._dockWallClock.clock;
                button.dockWidgetSecondary.text = date.format(button.dockWidgetSquare ? '%M' : '%a %d %b');
                button.accessible_name = `Horloge ${this._dockWallClock.clock}`;
                if (!button.dockWidgetSquare && button.widgetConfig?.format && button.widgetConfig.format !== 'Systeme')
                    button.dockWidgetPrimary.text = date.format(button.widgetConfig.format === '12 h' ? '%I:%M %p' : '%H:%M');
                button.dockWidgetSecondary.visible = button.dockWidgetSquare || button.widgetConfig?.['show-date'] !== false;
            } else {
                button.dockWidgetPrimary.text = date.format(button.dockWidgetSquare ? '%d' : '%d %b');
                button.dockWidgetSecondary.text = date.format(button.dockWidgetSquare ? '%b' : '%A');
                button.accessible_name = date.format('%A %d %B');
                button.dockWidgetSecondary.visible = button.dockWidgetSquare || button.widgetConfig?.['show-weekday'] !== false;
            }
        }

        _updateDockWidgets() {
            for (const screen of this._screens ?? []) {
                for (const button of screen.dock?.get_children() ?? []) {
                    if (button.dockWidgetType)
                        this._updateDockWidget(button);
                }
            }
        }

        _addDockShortcut(screen, name, iconName, iconSize, callback) {
            const button = new St.Button({
                style_class: 'g-os-dock-item',
                accessible_name: typeof name === 'function' ? name() : name,
                can_focus: true,
                reactive: true,
                track_hover: true,
                child: new St.Icon({icon_name: iconName, icon_size: iconSize}),
            }) as St.Button & DockButtonMetadata;
            button.set_style(`padding: ${this._settings.get_int('dock-icon-padding')}px;`);
            button.dockFocusKey = `shortcut:${iconName}`;
            this._attachTooltip(screen, button, name);
            button.connect('clicked', callback);
            screen.dock.add_child(button);
            return button;
        }

        _openLocation(uri) {
            Gio.AppInfo.launch_default_for_uri_async(uri,
                global.create_app_launch_context(global.get_current_time(), -1), null,
                (source, result) => {
                    try {
                        Gio.AppInfo.launch_default_for_uri_finish(result);
                    } catch (error) {
                        Main.notifyError('Impossible d’ouvrir cet emplacement', errorMessage(error));
                    }
                });
        }

        _updateActiveApp() {
            const window = global.display.focus_window;
            if (window)
                this._forgetAttentionWindow(window);
            const isDesktop = window?.get_window_type?.() === Meta.WindowType.DESKTOP;
            const app = window && !isDesktop ? Shell.WindowTracker.get_default().get_window_app(window) : null;
            const appName = app?.get_name() ?? 'Finder';
            if (this._activeAppLabel.text !== appName)
                this._activeAppLabel.text = appName;
            for (const screen of this._screens) {
                screen.globalMenu?.setWindow(isDesktop ? null : window ?? null);
                if (screen.appLabel) {
                    if (screen.appLabel.text !== appName)
                        screen.appLabel.text = appName;
                    this._applyPanelMetrics(screen);
                }
                for (const button of screen.appButtons ?? []) {
                    const active = button.app === app;
                    if (button._dockActiveApp === active)
                        continue;
                    button._dockActiveApp = active;
                    if (active)
                        button.add_style_pseudo_class('active-app');
                    else
                        button.remove_style_pseudo_class('active-app');
                }
            }
            this._updateDockIconGeometries();
        }
}