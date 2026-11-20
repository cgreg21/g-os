import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Soup from 'gi://Soup?version=3.0';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};

const extensionMetadata = JSON.parse(new TextDecoder().decode(Gio.File.new_for_uri(import.meta.url)
    .get_parent().get_parent().get_child('dist').get_child('metadata.json').load_contents(null)[1]));

let loadedThemeDirectory = null;
const loadShellTheme = (directory = GLib.getenv('MACOS_THEME_DIR')) => {
    if (!directory || loadedThemeDirectory === directory)
        return;
    St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(
        Gio.File.new_for_path(`${directory}/gnome-shell/gnome-shell.css`));
    loadedThemeDirectory = directory;
};

let currentMenuTest = null;
const startCurrentMenuTest = () => currentMenuTest ??= GLib.getenv('G_OS_FEATURE_TEST')
    ? checkFeatureScenario() : GLib.getenv('G_OS_EXPLORATORY_TEST') === '1'
    ? checkExploratoryDock() : GLib.getenv('G_OS_INKSCAPE_MENU_TEST') === '1'
    ? checkInkscapeGlobalMenu() : GLib.getenv('G_OS_GLOBAL_MENU_TEST') === '1'
        ? checkCurrentGlobalMenus() : GLib.getenv('G_OS_COVERFLOW_TEST') === '1'
    ? checkCurrentCoverflow() : GLib.getenv('G_OS_WINDOW_PREVIEW_TEST') === '1'
        ? checkCurrentWindowPreviews() : GLib.getenv('G_OS_MAGNIFICATION_TEST') === '1'
            ? checkLargeMagnification() : GLib.getenv('G_OS_APP_GRID_FAVORITES_TEST') === '1'
                ? checkAppGridFavorites() : GLib.getenv('G_OS_DOCK_APP_GRID_DROP_TEST') === '1'
                    ? checkAppGridDockDrop() : GLib.getenv('G_OS_DOCK_CONTEXT_TEST') === '1'
                        ? checkCurrentDockContextMenus() : checkReservedDockOverview();
if (GLib.getenv('G_OS_FEATURE_TEST') || GLib.getenv('G_OS_EXPLORATORY_TEST') === '1' || GLib.getenv('G_OS_INKSCAPE_MENU_TEST') === '1' || GLib.getenv('G_OS_GLOBAL_MENU_TEST') === '1' || GLib.getenv('G_OS_WINDOW_PREVIEW_TEST') === '1' || GLib.getenv('G_OS_COVERFLOW_TEST') === '1' || GLib.getenv('G_OS_MAGNIFICATION_TEST') === '1' || GLib.getenv('G_OS_DOCK_CONTEXT_TEST') === '1' || GLib.getenv('G_OS_APP_GRID_FAVORITES_TEST') === '1' || GLib.getenv('G_OS_RESERVED_OVERVIEW_TEST') === '1' || GLib.getenv('G_OS_DOCK_APP_GRID_DROP_TEST') === '1') {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        startCurrentMenuTest().then(protocols => {
            const output = GLib.getenv('SHELL_PERF_OUTPUT');
            if (output) {
                const report = {events: [], metrics: [], monitors: Main.layoutManager.monitors.map(monitor => ({
                    x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
                })), log: {type: 'functional-native-ui', verifiedCases: protocols}};
                Gio.File.new_for_path(output).replace_contents(new TextEncoder().encode(JSON.stringify(report)),
                    null, false, Gio.FileCreateFlags.NONE, null);
            }
            global.context.terminate();
        }).catch(error => {
            logError(error, 'Current global menu test failed');
            Meta.exit(Meta.ExitCode.ERROR);
        });
        return GLib.SOURCE_REMOVE;
    });
}

async function checkReservedDockOverview() {
    const uuid = extensionMetadata.uuid;
    const waitUntil = async (predicate, state) => {
        for (let attempt = 0; attempt < 160; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error(`Reserved Dock Overview did not reach ${state}`);
    };
    await waitUntil(() => Main.extensionManager?.lookup(uuid)?.stateObj?._screens?.length > 0,
        'extension startup');
    Main.overview.hide();
    await waitUntil(() => !Main.overview.visible, 'closed Overview state');
    const extension = Main.extensionManager.lookup(uuid).stateObj;
    extension._settings.set_boolean('reserve-dock-space', true);
    await waitUntil(() => extension._screens[0].dockReservationRegistered, 'initial reservation registration');
    const screen = extension._screens[0];
    const reservation = screen.dockReservation;
    const reservationGeometry = () => [...reservation.get_position(), reservation.width, reservation.height];
    await waitUntil(() => reservationGeometry().every(Number.isFinite) && reservation.width > 0 &&
        reservation.height > 0 && reservation.width <= screen.monitor.width &&
        reservation.height <= screen.monitor.height, 'reservation actor allocation');
    const stableReservationGeometry = async state => {
        let previous = null;
        let stable = 0;
        for (let attempt = 0; attempt < 60; attempt++) {
            const current = reservationGeometry();
            if (previous && current.every((value, index) => value === previous[index]))
                stable++;
            else
                stable = 0;
            if (stable >= 3)
                return current;
            previous = current;
            await Scripting.sleep(50);
        }
        throw new Error(`Dock reservation geometry did not stabilize ${state}`);
    };
    const stableWorkArea = async state => {
        let previous = null;
        let stable = 0;
        for (let attempt = 0; attempt < 60; attempt++) {
            const area = Main.layoutManager.getWorkAreaForMonitor(screen.monitor.index);
            const current = [area.x, area.y, area.width, area.height];
            if (previous && current.every((value, index) => value === previous[index]))
                stable++;
            else
                stable = 0;
            if (stable >= 3)
                return current;
            previous = current;
            await Scripting.sleep(50);
        }
        throw new Error(`Dock work area did not stabilize ${state}`);
    };
    const initialReservation = await stableReservationGeometry('before Overview');
    const initialArea = await stableWorkArea('before Overview');
    const initialHeight = initialArea[3];
    const dockPosition = screen.dockContainer.get_position();
    print(`Reserved Dock Overview: initial work area ${initialArea.join(',')}`);
    Main.overview.show();
    await waitUntil(() => !screen.dockReservationRegistered, 'Overview reservation release');
    await waitUntil(() => Main.layoutManager.getWorkAreaForMonitor(screen.monitor.index).height > initialHeight,
        'work area expansion during Overview');
    const overviewArea = Main.layoutManager.getWorkAreaForMonitor(screen.monitor.index);
    if (overviewArea.height <= initialHeight)
        throw new Error(`Overview work area did not recover the Dock reservation: ${initialHeight} -> ${overviewArea.height}`);
    if (screen.dockContainer.get_position().some((value, index) => value !== dockPosition[index]))
        throw new Error('Dock moved while the Overview was opening');
    Main.overview.hide();
    await waitUntil(() => screen.dockReservationRegistered, 'reservation restoration after Overview');
    const restoredArea = await stableWorkArea('after Overview');
    if (restoredArea.slice(0, 3).some((value, index) => value !== initialArea[index]) ||
        Math.abs(restoredArea[3] - initialHeight) > 2)
        throw new Error(`Overview close did not restore the reserved work area within 2px: ` +
            `${initialArea.join(',')} -> ${restoredArea.join(',')}`);
    const restoredReservation = await stableReservationGeometry('after Overview');
    if (restoredReservation.some((value, index) => Math.abs(value - initialReservation[index]) > 2))
        throw new Error(`Dock reservation geometry was not restored: ${initialReservation} -> ${restoredReservation}`);
    Main.extensionManager.disableExtension(uuid);
    print('Reserved Dock strut suspends for the full Overview transition and restores afterward');
    return ['reserved-dock-overview-animation', 'reservation-restored'];
}

async function checkAppGridFavorites() {
    const uuid = extensionMetadata.uuid;
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 160; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error('All applications grid did not reach the expected state');
    };
    await waitUntil(() => Main.extensionManager?.lookup(uuid)?.stateObj?._overviewAppDisplay);
    const extension = Main.extensionManager.lookup(uuid).stateObj;
    const appDisplay = extension._overviewAppDisplay;
    let favorite = extension._favorites.getFavorites()[0];
    if (!favorite) {
        const appInfo = Shell.AppSystem.get_default().get_installed()[0];
        if (!appInfo)
            throw new Error('No installed application is available for the native favorites test');
        extension._favorites.addFavorite(appInfo.get_id());
        await waitUntil(() => extension._favorites.getFavorites().length > 0);
        favorite = extension._favorites.getFavorites()[0];
    }
    const items = appDisplay._loadApps();
    if (!items.some(item => item.id === favorite.get_id()))
        throw new Error(`Favorite application ${favorite.get_id()} is missing from All applications`);
    if (!extension._favorites.isFavorite(favorite.get_id()))
        throw new Error('Showing the app grid item removed its Dock favorite status');
    const folders = ['Outils', 'Jeux'].map(name => ({name,
        has_style_class_name: style => style === 'app-folder'}));
    const applications = ['Zulu', 'Alfa'].map(name => ({name,
        has_style_class_name: () => false}));
    const ordered = [...applications, ...folders].sort(appDisplay._compareItems);
    if (ordered.map(item => item.name).join(',') !== 'Jeux,Outils,Alfa,Zulu')
        throw new Error(`All applications order is incorrect: ${ordered.map(item => item.name)}`);
    const patchedLoader = extension._overviewAppDisplayLoadAppsOverride;
    Main.extensionManager.disableExtension(uuid);
    await waitUntil(() => appDisplay._loadApps !== patchedLoader);
    if (appDisplay._loadApps === patchedLoader)
        throw new Error('Disabling the extension did not restore the native app grid loader');
    if (appDisplay._loadApps().some(item => item.id === favorite.get_id()))
        throw new Error('Native app grid loader was not restored after disable');
    print(`Native All applications keeps ${favorite.get_id()} and sorts folders before applications`);
    return ['favorite-in-app-grid', 'folders-first-alphabetical-order', 'dock-favorite-preserved', 'loader-restored'];
}

async function checkAppGridDockDrop() {
    const uuid = extensionMetadata.uuid;
    const waitUntil = async (predicate, state) => {
        for (let attempt = 0; attempt < 160; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error(`App Grid to Dock drop did not reach ${state}`);
    };
    await waitUntil(() => Main.extensionManager?.lookup(uuid)?.stateObj?._overviewAppDisplay, 'extension startup');
    const extension = Main.extensionManager.lookup(uuid).stateObj;
    const appDisplay = extension._overviewAppDisplay;
    const appFavorites = extension._favorites;
    const originalFavorites = appFavorites.getFavorites().map(app => app.get_id());
    Main.overview.showApps();
    await waitUntil(() => appDisplay.getAllItems().some(item => item.app && !originalFavorites.includes(item.id)),
        'an installed non-favorite app icon');
    const source = appDisplay.getAllItems().find(item => item.app && !originalFavorites.includes(item.id));
    const appId = source.app.get_id();
    const screen = extension._screens[0];
    if (!appDisplay.contains(source) || !extension._isOverviewAppGridSource(source))
        throw new Error(`Could not identify native App Grid source ${appId}`);
    if (screen.dock._delegate.handleDragOver(source) !== DND.DragMotionResult.MOVE_DROP)
        throw new Error(`Dock did not accept the native App Grid source ${appId}`);
    if (!screen.dock._delegate.acceptDrop(source))
        throw new Error(`Dock rejected the native App Grid source ${appId}`);
    await waitUntil(() => !extension._deferredDockDrops?.size, 'deferred drop callback');
    if (!extension._favorites.isFavorite(appId))
        throw new Error(`Deferred drop did not add ${appId} to Dock favorites ` +
            `(favorite writable=${global.settings.is_writable('favorite-apps')}, ` +
            `favorite=${extension._favorites.isFavorite(appId)}, ` +
            `disposed=${screen.disposed}, settings=${Boolean(extension._settings)}, ` +
            `current=${extension._favorites.getFavorites().map(app => app.get_id()).join(',')})`);
    const folders = JSON.parse(extension._settings.get_string('dock-app-folders'));
    if (folders.some(folder => folder.apps.includes(appId)))
        throw new Error('Dropping an App Grid item created a one-application folder');
    print(`Native App Grid drop added ${appId} to Dock favorites without grouping`);
    Main.extensionManager.disableExtension(uuid);
    for (const app of appFavorites.getFavorites()) {
        if (!originalFavorites.includes(app.get_id()))
            appFavorites.removeFavorite(app.get_id());
    }
    for (const id of originalFavorites) {
        if (!appFavorites.isFavorite(id))
            appFavorites.addFavorite(id);
    }
    return ['app-grid-source-drop', 'favorite-added-once', 'no-single-app-folder'];
}

async function checkCurrentDockContextMenus() {
    const uuid = extensionMetadata.uuid;
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 160; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error('Dock context menus did not reach the expected state');
    };
    await waitUntil(() => Main.extensionManager?.lookup(uuid)?.stateObj?._screens?.length > 0);
    const extension = Main.extensionManager.lookup(uuid).stateObj;
    const settings = extension._settings;
    settings.set_boolean('show-dock-shortcuts', true);
    settings.set_boolean('shortcut-trash', true);
    settings.set_boolean('dock-widget-clock', true);
    await Scripting.waitLeisure();
    const screen = extension._screens[0];
    const trash = screen.trashButton;
    trash.emit('popup-menu');
    const trashActions = trash.trashMenu._getMenuItems().map(item => item.label?.text).filter(Boolean);
    if (!trashActions.includes('Ouvrir la corbeille') || !trashActions.includes('Vider la corbeille'))
        throw new Error(`Trash context actions missing: ${trashActions}`);
    trash.trashMenu.close();
    const widget = screen.dock.get_children().find(actor => actor.dockWidgetType === 'clock');
    widget.emit('popup-menu');
    const widgetActions = widget.shortcutMenu._getMenuItems().map(item => item.label?.text).filter(Boolean);
    if (!widgetActions.includes('Retirer ce widget'))
        throw new Error(`Dock widget removal action missing: ${widgetActions}`);
    widget.shortcutMenu.close();
    print('Native Dock context menus expose open/empty Trash and remove-widget actions');
    Main.extensionManager.disableExtension(uuid);
    return ['trash-context-menu', 'dock-widget-remove-menu'];
}

async function checkLargeMagnification() {
    const uuid = extensionMetadata.uuid;
    const waitUntil = async (predicate, state = 'expected animation state') => {
        for (let attempt = 0; attempt < 160; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        const description = typeof state === 'function' ? state() : state;
        throw new Error(`Large magnification did not reach ${description}`);
    };
    await waitUntil(() => Main.extensionManager?.lookup(uuid)?.stateObj?._screens?.length > 0);
    const extension = Main.extensionManager.lookup(uuid).stateObj;
    const settings = extension._settings;
    new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean('enable-animations', true);
    settings.set_boolean('dock-autohide', false);
    settings.set_boolean('dock-hide-when-covered', false);
    settings.set_int('dock-hover-animation', 4);
    settings.set_int('dock-magnify-max', 400);
    Main.overview.hide();
    await waitUntil(() => St.Settings.get().enable_animations);
    const reachabilityCases = [];
    for (const {position, size} of [0, 1, 2].flatMap(position =>
        [24, 40, 64].map(size => ({position, size})))) {
        settings.delay();
        settings.set_int('dock-position', position);
        settings.set_int('icon-size', size);
        settings.apply();
        await Scripting.sleep(350);
        await Scripting.waitLeisure();
        await waitUntil(() => {
            const current = extension._screens[0];
            const currentLauncher = current?.dock?.get_children()
                .find(actor => actor.dockFocusKey === 'shortcut:applications');
            const currentApp = current?.dock?.get_children().find(actor => actor.app);
            return current?.dock?.mapped && current?.dockContainer?.mapped &&
                currentLauncher?.mapped && currentLauncher.get_child()?.icon_size === size &&
                currentApp?.icon?.icon?.icon_size === Math.ceil(size * 1.8);
        }, () => {
            const current = extension._screens[0];
            const currentLauncher = current?.dock?.get_children()
                .find(actor => actor.dockFocusKey === 'shortcut:applications');
            const currentApp = current?.dock?.get_children().find(actor => actor.app);
            return `Dock actors rebuilt at position ${position}, size ${size}: ` +
                `mapped=${current?.dock?.mapped}/${current?.dockContainer?.mapped}/` +
                `${currentLauncher?.mapped}, iconSize=${currentLauncher?.get_child()?.icon_size}/` +
                `${currentApp?.icon?.icon?.icon_size}, screens=${extension._screens.length}, ` +
                `settings=${settings.get_int('dock-position')}/${settings.get_int('icon-size')}`;
        });
        const screen = extension._screens[0];
        await waitUntil(() => {
            const [width, height] = screen.dockContainer.get_transformed_size();
            return width > 100 && width < 2000 && height > 100 && height < 1200;
        }, `allocated Dock at position ${position}`);
        const buttons = screen.dock.get_children().filter(button => button.app);
        const button = buttons[Math.floor(buttons.length / 2)];
        if (!button) throw new Error('No Dock application button available');
        await waitUntil(() => [...button.get_transformed_position(), ...screen.magnificationBackground.get_transformed_position(),
            ...screen.magnificationBackground.get_transformed_size()].every(Number.isFinite), 'valid actor geometry');
        const launcher = screen.dock.get_children().find(actor => actor.dockFocusKey === 'shortcut:applications');
        const launcherIcon = launcher.get_child();
        const [launcherWidth, launcherHeight] = launcherIcon.get_transformed_size();
        const [appWidth, appHeight] = button.icon.icon.get_transformed_size();
        if (launcherIcon.icon_size !== size || Math.abs(launcherWidth - appWidth) > 1 ||
            Math.abs(launcherHeight - appHeight) > 1)
            throw new Error(`Launchpad icon size differs at position ${position}: launcher=${launcherIcon.icon_size},${launcherWidth}x${launcherHeight}; app=${appWidth}x${appHeight}`);
        const icon = button.icon.icon;
        screen.dockContainer.track_hover = false;
        screen.dockContainer.hover = true;
        screen.magnificationPoint = null;
        extension._updateDockMagnification(screen, null, false, true);
        await Scripting.waitLeisure();
        const [buttonX, buttonY] = button.get_transformed_position();
        const [buttonWidth, buttonHeight] = button.get_transformed_size();
        const [backgroundX, backgroundY] = screen.magnificationBackground.get_transformed_position();
        const [backgroundWidth, backgroundHeight] = screen.magnificationBackground.get_transformed_size();
        const inside = position === 0
            ? [buttonX + buttonWidth / 2, backgroundY + backgroundHeight / 2]
            : [backgroundX + backgroundWidth / 2, buttonY + buttonHeight / 2];
        // Magnification intentionally follows the pointer across the entire Dock,
        // not only over its background. Reset it by leaving the Dock itself.
        screen.magnificationPoint = null;
        screen.dockContainer.hover = false;
        extension._updateDockMagnification(screen, null, false, false);
        await waitUntil(() => Math.abs(button.scale_x - 1) <= 0.02,
            `normal scale outside magnification background at position ${position}`);
        if (Math.abs(button.scale_x - 1) > 0.02)
            throw new Error(`Magnification started outside the background at position ${position}`);
        screen.dockContainer.hover = true;
        screen.magnificationPoint = inside;
        extension._updateDockMagnification(screen, inside, false, true);
        await waitUntil(() => screen.dockContainer.hover && button.scale_x > 1,
            () => `magnification start at dock position ${position}: scale=${button.scale_x}, ` +
                `dockHovered=${screen.dockContainer.hover}, buttonHovered=${button.hover}, ` +
                `inside=${inside}, dock=${screen.dockContainer.get_transformed_position()}, ` +
                `dockSize=${screen.dockContainer.get_transformed_size()}, ` +
                `point=${screen.magnificationPoint}, background=${screen.magnificationBackground.get_transformed_position()}, ` +
                `size=${screen.magnificationBackground.get_transformed_size()}`);
        await Scripting.sleep(25);
        if (button.scale_x >= 3.9)
            throw new Error(`Magnification entry skipped its transition at position ${position}`);
        await waitUntil(() => button.scale_x > 1.01, () =>
            `entry scale at dock position ${position}, size ${size}: scale=${button.scale_x}, ` +
            `target=${button.magnificationScale}, available growth=${screen.magnificationGrowth}, ` +
            `dock=${screen.dockContainer.get_transformed_size()}`);
        if (button.scale_x <= 1.01)
            throw new Error(`Magnification did not start inside the background at position ${position}: scale=${icon.scale_x}, point=${inside}, background=${backgroundX},${backgroundY},${backgroundWidth},${backgroundHeight}, hover=${screen.dockContainer.hover}, animation=${St.Settings.get().enable_animations}, fullscreen=${screen.monitor.inFullscreen}`);
        await Scripting.waitLeisure();
        const [iconX, iconY] = icon.get_transformed_position();
        const [iconWidth, iconHeight] = icon.get_transformed_size();
        const [dockX, dockY] = screen.dockContainer.get_transformed_position();
        const [dockWidth, dockHeight] = screen.dockContainer.get_transformed_size();
        if (iconX < dockX - 1 || iconY < dockY - 1 ||
            iconX + iconWidth > dockX + dockWidth + 1 || iconY + iconHeight > dockY + dockHeight + 1)
            throw new Error(`Magnified icon clipped at position ${position}: icon=${iconX},${iconY},${iconWidth},${iconHeight}; dock=${dockX},${dockY},${dockWidth},${dockHeight}`);
        const [buttonHitX, buttonHitY] = button.get_transformed_position();
        const [buttonHitWidth, buttonHitHeight] = button.get_transformed_size();
        for (const horizontal of [0.1, 0.5, 0.9]) {
            for (const vertical of [0.1, 0.5, 0.9]) {
                const hitX = Math.round(buttonHitX + buttonHitWidth * horizontal);
                const hitY = Math.round(buttonHitY + buttonHitHeight * vertical);
                const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, hitX, hitY);
                if (hitX < dockX || hitX >= dockX + dockWidth || hitY < dockY || hitY >= dockY + dockHeight ||
                    !picked || !(picked === button || button.contains(picked)))
                    throw new Error(`Magnified button is not pointer-reachable at ${position}/${size}: ` +
                        `point=${hitX},${hitY}, picked=${picked?.constructor.name ?? 'none'}, ` +
                        `button=${buttonHitX},${buttonHitY},${buttonHitWidth},${buttonHitHeight}`);
            }
        }
        const pointerPoint = screen.magnificationPoint?.slice();
        if (!pointerPoint)
            throw new Error(`Magnification lost its pointer position at dock position ${position}, size ${size}`);
        const maintainPointer = () => {
            screen.dockContainer.hover = true;
            screen.magnificationPoint = pointerPoint;
            extension._updateDockMagnification(screen, pointerPoint, false, true);
        };
        const basePadding = Math.ceil((size + 8) * 0.8);
        const maximumPadding = Math.ceil((size + 8) * 3);
        settings.set_int('dock-magnify-max', 180);
        await waitUntil(() => {
            maintainPointer();
            return screen.magnificationPadding === basePadding &&
            screen.dockContainer.hover && screen.magnificationPoint?.every((coordinate, index) =>
                coordinate === pointerPoint[index]);
        },
            `live magnification sizing at position ${position}, size ${size}`);
        maintainPointer();
        if (!screen.dock.contains(button) || !screen.magnificationPoint ||
            screen.magnificationPoint.some((coordinate, index) => coordinate !== pointerPoint[index]))
            throw new Error(`Live magnification resize lost the hovered target at ${position}/${size}`);
        settings.set_int('dock-magnify-max', 400);
        await waitUntil(() => {
            maintainPointer();
            return screen.magnificationPadding === maximumPadding &&
            screen.dockContainer.hover && screen.magnificationPoint?.every((coordinate, index) =>
                coordinate === pointerPoint[index]);
        },
            `restored magnification sizing at position ${position}, size ${size}`);
        maintainPointer();
        if (!screen.dock.contains(button) || !screen.magnificationPoint ||
            screen.magnificationPoint.some((coordinate, index) => coordinate !== pointerPoint[index]))
            throw new Error(`Restoring magnification size lost the hovered target at ${position}/${size}`);
        // Exit the Dock entirely so the pointer state matches the test intent.
        screen.dockContainer.hover = false;
        screen.magnificationPoint = null;
        extension._updateDockMagnification(screen, null, false, false);
        await waitUntil(() => Math.abs(button.scale_x - 1) <= 0.02, () =>
            `exit scale at dock position ${position}: scale=${button.scale_x}, target=${button.magnificationScale}, ` +
            `transition=${Boolean(button.get_transition('scale-x'))}, engaged=${screen.magnificationEngaged}, ` +
            `hover=${button.hover}, dockHovered=${screen.dockContainer.hover}, parent=${button.get_parent() === screen.dock}, ` +
            `point=${screen.magnificationPoint}`);
        if (Math.abs(button.scale_x - 1) > 0.02)
            throw new Error(`Magnification did not stop outside the background at position ${position}`);
        const [launcherX, launcherY] = launcher.get_transformed_position();
        const [launcherButtonWidth, launcherButtonHeight] = launcher.get_transformed_size();
        const launcherPoint = [launcherX + launcherButtonWidth / 2, launcherY + launcherButtonHeight / 2];
        screen.dockContainer.hover = true;
        screen.magnificationPoint = launcherPoint;
        extension._updateDockMagnification(screen, launcherPoint, false, true);
        const launcherTarget = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE,
            Math.round(launcherPoint[0]), Math.round(launcherPoint[1]));
        if (!launcherTarget || !(launcherTarget === launcher || launcher.contains(launcherTarget)))
            throw new Error(`Launchpad is not pointer-reachable at dock position ${position}, size ${size}: ` +
                `point=${launcherPoint}, picked=${launcherTarget?.constructor.name ?? 'none'}, ` +
                `launcher=${launcher.get_transformed_position()},${launcher.get_transformed_size()},` +
                `dock=${screen.dockContainer.get_transformed_position()},${screen.dockContainer.get_transformed_size()}`);
        const pointer = global.stage.get_context().get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        screen.dockContainer.track_hover = true;
        extension._updateDockMagnification(screen, null, true, true);
        move(screen.monitor.width / 2, screen.monitor.height / 2);
        await waitUntil(() => Math.abs(button.scale_x - 1) <= 0.02, 'settled pointer outside Dock');
        const [targetX, targetY] = button.get_transformed_position();
        const [targetWidth, targetHeight] = button.get_transformed_size();
        move(targetX + targetWidth / 2, targetY + targetHeight / 2);
        await waitUntil(() => button.hover && button.scale_x > 1.01, () =>
            `magnified application hover at position ${position}: hover=${button.hover}, ` +
            `scale=${button.scale_x}, dockHovered=${screen.dockContainer.hover}, ` +
            `point=${screen.magnificationPoint}, button=${button.get_transformed_position()},` +
            `${button.get_transformed_size()}`);
        const [hitX, hitY] = button.get_transformed_position();
        const [hitWidth, hitHeight] = button.get_transformed_size();
        move(hitX + hitWidth / 2, hitY + hitHeight / 2);
        await waitUntil(() => button.hover && screen.tooltip.visible &&
            screen.tooltip.text.includes(button.app.get_name()), () =>
            `magnified application tooltip at position ${position}: hover=${button.hover}, ` +
            `scale=${button.scale_x}, tooltip=${screen.tooltip.visible}, text=${screen.tooltip.text}, ` +
            `button=${button.get_transformed_position()},${button.get_transformed_size()}`);
        if (!button.hover || !screen.tooltip.visible || !screen.tooltip.text.includes(button.app.get_name()))
            throw new Error(`Magnified application tooltip missing at position ${position}: hover=${button.hover}, scale=${button.scale_x}, tooltip=${screen.tooltip.visible}, text=${screen.tooltip.text}`);
        let activations = 0;
        button.activate = () => { activations++; };
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await waitUntil(() => activations === 1, 'click on magnified application');
        move(screen.monitor.width / 2, screen.monitor.height / 2);
        screen.dockContainer.track_hover = false;
        extension._updateDockMagnification(screen, null, true, true);
        await waitUntil(() => Math.abs(button.scale_x - 1) <= 0.02, 'reset pointer before edge magnification');
        await Scripting.waitLeisure();
        const [edgeBackgroundX, edgeBackgroundY] = screen.magnificationBackground.get_transformed_position();
        const [edgeBackgroundWidth, edgeBackgroundHeight] = screen.magnificationBackground.get_transformed_size();
        const edgeAxis = position === 0 ? 0 : 1;
        const edgeStart = edgeAxis === 0 ? edgeBackgroundX : edgeBackgroundY;
        const edgeEnd = edgeStart + (edgeAxis === 0 ? edgeBackgroundWidth : edgeBackgroundHeight);
        const visibleButtons = buttons.filter(candidate => {
            const [x, y] = candidate.get_transformed_position();
            const [width, height] = candidate.get_transformed_size();
            const center = edgeAxis === 0 ? x + width / 2 : y + height / 2;
            return center >= edgeStart && center <= edgeEnd;
        });
        if (!visibleButtons.length)
            throw new Error(`No visible application button at dock position ${position}`);
        const edgeButton = visibleButtons.reduce((last, candidate) =>
            candidate.get_transformed_position()[edgeAxis] > last.get_transformed_position()[edgeAxis]
                ? candidate : last);
        const [edgeX, edgeY] = edgeButton.get_transformed_position();
        const [edgeWidth, edgeHeight] = edgeButton.get_transformed_size();
        const edgePoint = position === 0
            ? [edgeX + edgeWidth / 2, edgeBackgroundY + edgeBackgroundHeight / 2]
            : [edgeBackgroundX + edgeBackgroundWidth / 2, edgeY + edgeHeight / 2];
        const [viewportX, viewportY] = screen.dockContainer.get_transformed_position();
        const [viewportWidth, viewportHeight] = screen.dockContainer.get_transformed_size();
        const visibleDockButtons = screen.dock.get_children().filter(candidate => {
            if (!candidate.dockFocusKey)
                return false;
            const candidateIcon = candidate.icon?.icon ?? candidate.get_child();
            if (!candidateIcon)
                return false;
            const [x, y] = candidateIcon.get_transformed_position();
            const [width, height] = candidateIcon.get_transformed_size();
            return x >= viewportX && y >= viewportY &&
                x + width <= viewportX + viewportWidth && y + height <= viewportY + viewportHeight;
        });
        screen.dockContainer.track_hover = true;
        move(edgePoint[0], edgePoint[1]);
        await waitUntil(() => screen.magnificationPoint !== null &&
            Math.abs(screen.magnificationPoint[edgeAxis] - edgePoint[edgeAxis]) <= 1 &&
            edgeButton.scale_x > 1.01, () =>
            `edge magnification at dock position ${position}: scale=${edgeButton.scale_x}, ` +
            `target=${edgeButton.magnificationScale}, engaged=${screen.magnificationEngaged}, ` +
            `point=${screen.magnificationPoint}, edgePoint=${edgePoint}, ` +
            `dockHovered=${screen.dockContainer.hover}, reorder=${screen.reorder}, ` +
            `fullscreen=${screen.monitor.inFullscreen}, animations=${St.Settings.get().enable_animations}, ` +
            `max=${settings.get_int('dock-magnify-max')}, radius=${settings.get_int('dock-magnify-icons')}, ` +
            `dock=${screen.dockContainer.get_transformed_position()},${screen.dockContainer.get_transformed_size()}`);

        await Scripting.waitLeisure();
        for (const candidate of visibleDockButtons) {
            const candidateIcon = candidate.icon?.icon ?? candidate.get_child();
            if (!candidateIcon)
                continue;
            const [x, y] = candidateIcon.get_transformed_position();
            const [width, height] = candidateIcon.get_transformed_size();
            if (x < viewportX - 1 || y < viewportY - 1 ||
                x + width > viewportX + viewportWidth + 1 || y + height > viewportY + viewportHeight + 1)
                throw new Error(`Edge magnification clipped at position ${position}: icon=${x},${y},${width},${height}; ` +
                    `dock=${viewportX},${viewportY},${viewportWidth},${viewportHeight}`);
        }
        extension._updateDockMagnification(screen, null, true, true);
        await waitUntil(() => Math.abs(edgeButton.scale_x - 1) <= 0.02,
            `edge magnification reset at dock position ${position}`);
        reachabilityCases.push(`${position}/${size}`);
        print(`Large magnification fits and stays pointer-reachable at dock position ${position}, size ${size}`);
    }
    Main.extensionManager.disableExtension(uuid);
    return ['large-magnification', 'background-hover-boundary', 'three-dock-positions', 'three-icon-sizes',
        'magnified-application-tooltip', 'magnified-application-click', 'expanded-button-hit-targets',
        'live-magnification-settings',
        ...reachabilityCases.map(testCase => `case:${testCase}`)];
}

async function checkExploratoryDock() {
    const uuid = extensionMetadata.uuid;
    for (let attempt = 0; attempt < 160 && !Main.extensionManager?.lookup(uuid)?.stateObj?._screens?.length; attempt++)
        await Scripting.sleep(50);
    const extension = Main.extensionManager.lookup(uuid)?.stateObj;
    if (!extension?._screens?.length)
        throw new Error('Exploratory test could not start the extension');
    const settings = extension._settings;
    new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean('enable-animations', true);
    settings.set_boolean('dock-window-previews', false);
    settings.set_boolean('dock-hide-when-covered', false);
    settings.set_boolean('dock-autohide', false);
    settings.set_int('dock-hover-animation', 4);
    Main.overview.hide();
    await Scripting.sleep(2200);
    await Scripting.waitLeisure();
    const pointer = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    const cases = [];
    const activateApp = extension._activateAppFromDock;
    let clicks = [];
    extension._activateAppFromDock = app => {
        clicks.push(app.get_id());
        return true;
    };
    const selectedCase = GLib.getenv('G_OS_EXPLORATORY_CASE');
    const describe = actor => actor ? {
        type: actor.constructor.name,
        style: actor.get_style_class_name?.(),
        bounds: [...actor.get_transformed_position(), ...actor.get_transformed_size()],
        reactive: actor.reactive,
        clipToAllocation: actor.clip_to_allocation,
        clipToView: actor.clip_to_view,
    } : null;
    const ancestry = actor => {
        const path = [];
        for (let current = actor; current && path.length < 8; current = current.get_parent())
            path.push(describe(current));
        return path;
    };
    let activeFrames = null;
    const paintSignal = global.stage.connect('after-paint', () => activeFrames?.push(GLib.get_monotonic_time()));
    try {
        for (const position of [0, 1, 2]) {
            for (const size of [32, 64]) {
                for (const maximum of [180, 400]) {
                    if (selectedCase && selectedCase !== [position, size, maximum].join(','))
                        continue;
                    move(640, 100);
                    settings.set_int('dock-position', position);
                    settings.set_int('icon-size', size);
                    settings.set_int('dock-magnify-max', maximum);
                    await Scripting.sleep(400);
                    const screen = extension._screens[0];
                    const buttons = screen.appButtons;
                    let button = buttons[Math.floor(buttons.length / 2)];
                    const result = {position, size, maximum, samples: [], issues: []};
                    cases.push(result);
                    if (!button) {
                        result.issues.push('missing-application-button');
                        continue;
                    }
                    clicks = [];
                    const appId = button.app.get_id();
                    const currentButton = () => screen.appButtons.find(candidate => candidate.app.get_id() === appId);
                    extension._revealDock(screen);
                    await Scripting.sleep(200);
                    button = currentButton();
                    const [buttonX, buttonY] = button.get_transformed_position();
                    const [buttonWidth, buttonHeight] = button.get_transformed_size();
                    activeFrames = [];
                    move(buttonX + buttonWidth / 2, buttonY + buttonHeight / 2);
                    await Scripting.sleep(40);
                    button = currentButton();
                    result.entryTransition = Boolean(button.get_transition('scale-x') ||
                        button.icon.icon.get_transition('scale-x'));
                    await Scripting.sleep(260);
                    button = currentButton();
                    const frames = activeFrames;
                    activeFrames = null;
                    const gaps = frames.slice(1).map((time, index) => (time - frames[index]) / 1000).sort((left, right) => left - right);
                    result.entryFrames = gaps.length;
                    result.entryFrameP95Ms = gaps.length ? gaps[Math.floor((gaps.length - 1) * 0.95)] : null;
                    result.entryFrameMaxMs = gaps.at(-1) ?? null;
                    if (!button.hover)
                        result.issues.push('application-center-not-hovered');
                    for (const fraction of [0.2, 0.5, 0.8]) {
                        move(640, 100);
                        await Scripting.sleep(250);
                        button = currentButton();
                        const [originX, originY] = button.get_transformed_position();
                        const [originWidth, originHeight] = button.get_transformed_size();
                        move(originX + originWidth / 2, originY + originHeight / 2);
                        await Scripting.sleep(300);
                        await Scripting.waitLeisure();
                        button = currentButton();
                        const icon = button.icon.icon;
                        const [iconX, iconY] = icon.get_transformed_position();
                        const [iconWidth, iconHeight] = icon.get_transformed_size();
                        const point = position === 0 ? [iconX + iconWidth / 2, iconY + iconHeight * fraction]
                            : [iconX + iconWidth * fraction, iconY + iconHeight / 2];
                        const geometryBefore = {icon: describe(icon), button: describe(button)};
                        const updateMagnification = extension._updateDockMagnification;
                        const freezePicking = GLib.getenv('G_OS_DOCK_FREEZE_PICK_PROBE') === '1';
                        if (freezePicking)
                            extension._updateDockMagnification = () => {};
                        move(...point);
                        await Scripting.sleep(200);
                        await Scripting.waitLeisure();
                        button = currentButton();
                        const actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, ...point);
                        const [viewX, viewY] = screen.dockContainer.get_transformed_position();
                        const [viewWidth, viewHeight] = screen.dockContainer.get_transformed_size();
                        const [backgroundX, backgroundY] = screen.magnificationBackground.get_transformed_position();
                        const [backgroundWidth, backgroundHeight] = screen.magnificationBackground.get_transformed_size();
                        const [paintX, paintY] = button.icon.icon.get_transformed_position();
                        const [paintWidth, paintHeight] = button.icon.icon.get_transformed_size();
                        const sample = {fraction, hover: button.hover,
                            tooltip: screen.tooltip.visible && screen.tooltip.text.includes(button.app.get_name()),
                            pickedButton: actor === button || button.contains(actor),
                            clicks: [], expected: button.app.get_id(),
                            point, pointer: global.get_pointer().slice(0, 2), geometryBefore,
                            geometryAfter: {icon: describe(button.icon.icon), button: describe(button)},
                            viewport: [viewX, viewY, viewWidth, viewHeight],
                            magnificationBackground: [backgroundX, backgroundY, backgroundWidth, backgroundHeight],
                            pickedPath: ancestry(actor), buttonPath: ancestry(button),
                            dockHover: screen.dockContainer.hover, magnificationEngaged: screen.magnificationEngaged,
                            freezePicking,
                            iconInsideViewport: paintX >= viewX - 1 && paintY >= viewY - 1 &&
                                paintX + paintWidth <= viewX + viewWidth + 1 &&
                                paintY + paintHeight <= viewY + viewHeight + 1};
                        const before = clicks.length;
                        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
                        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
                        await Scripting.sleep(60);
                        button = currentButton();
                        extension._updateDockMagnification = updateMagnification;
                        sample.clicks = clicks.slice(before);
                        result.samples.push(sample);
                        if (!sample.hover || !sample.pickedButton)
                            result.issues.push(`hit-target-${fraction}`);
                        if (!sample.tooltip)
                            result.issues.push(`tooltip-${fraction}`);
                        if (!sample.iconInsideViewport)
                            result.issues.push(`clipped-icon-${fraction}`);
                        if (sample.clicks.length !== 1 || sample.clicks[0] !== sample.expected)
                            result.issues.push(`activation-${fraction}`);
                    }
                    if (size === 64 && maximum === 400)
                        await capture(`exploratory-dock-${position}.png`);
                    move(640, 100);
                    await Scripting.sleep(250);
                    await Scripting.waitLeisure();
                    button = currentButton();
                    result.exitScale = button.scale_x * button.icon.icon.scale_x;
                    result.exitHover = button.hover;
                    result.exitDockHover = screen.dockContainer.hover;
                    result.exitPointer = global.get_pointer().slice(0, 2);
                    if (Math.abs(result.exitScale - 1) > 0.01)
                        result.issues.push('magnification-not-reset');
                    const duration = extension._dockSlideDuration();
                    extension._hideDock(screen);
                    await Scripting.sleep(duration + 120);
                    result.hidden = !screen.dockContainer.visible;
                    if (!result.hidden)
                        result.issues.push('dock-not-hidden');
                    extension._revealDock(screen);
                    await Scripting.sleep(duration + 120);
                    result.revealed = screen.dockContainer.visible && screen.dockContainer.opacity === 255;
                    if (!result.revealed)
                        result.issues.push('dock-not-revealed');
                    print(`Exploratory Dock ${position}/${size}/${maximum}: ${result.issues.join(', ') || 'no issue detected'}`);
                }
            }
        }
        const directory = GLib.getenv('MACOS_VISUAL_OUTPUT');
        if (directory)
            Gio.File.new_for_path(`${directory}/exploratory-dock.json`).replace_contents(
                new TextEncoder().encode(JSON.stringify({environment: 'headless GNOME Shell', cases}, null, 2)),
                null, false, Gio.FileCreateFlags.NONE, null);
        Main.extensionManager.disableExtension(uuid);
        return [`exploratory-dock-cases:${cases.length}`, `cases-with-findings:${cases.filter(result => result.issues.length).length}`];
    } finally {
        extension._activateAppFromDock = activateApp;
        global.stage.disconnect(paintSignal);
    }
}

async function checkDockHitTesting() {
    const uuid = extensionMetadata.uuid;
    await waitForExtension();
    const extension = Main.extensionManager.lookup(uuid).stateObj;
    const settings = extension._settings;
    settings.set_boolean('dock-autohide', false);
    settings.set_boolean('dock-hide-when-covered', false);
    settings.set_boolean('dock-window-previews', false);
    settings.set_boolean('reserve-dock-space', false);
    settings.set_int('dock-hover-animation', 0);
    const markerPath = `${GLib.getenv('MACOS_VISUAL_OUTPUT')}/dock-hit-test-clicks.txt`;
    const marker = Gio.File.new_for_path(markerPath);
    marker.replace_contents(new TextEncoder().encode('0'), null, false, Gio.FileCreateFlags.NONE, null);
    const childScript = [
        "imports.gi.versions.Gtk='3.0';",
        "imports.gi.versions.Gdk='3.0';",
        'const Gtk=imports.gi.Gtk, Gdk=imports.gi.Gdk, GLib=imports.gi.GLib;',
        'Gtk.init(null);',
        'let clicks=0;',
        `const marker=${JSON.stringify(markerPath)};`,
        "const window=new Gtk.Window({title:'G-OS Dock Hit Test',default_width:1280,default_height:720});",
        'const surface=new Gtk.EventBox();',
        'surface.add_events(Gdk.EventMask.BUTTON_PRESS_MASK);',
        "surface.connect('button-press-event',()=>{GLib.file_set_contents(marker,String(++clicks));return false;});",
        'window.add(surface); window.show_all(); window.maximize(); Gtk.main();',
    ].join(' ');
    const process = Gio.Subprocess.new(['gjs', '-c', childScript], Gio.SubprocessFlags.NONE);
    const report = {windowReady: false, cases: [], transparentClicks: 0, clickThroughs: 0};
    const readClicks = () => Number(new TextDecoder().decode(marker.load_contents(null)[1])) || 0;
    const waitUntil = async (predicate, state) => {
        for (let attempt = 0; attempt < 160; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error(`Dock hit-test did not reach ${state}`);
    };
    const pointer = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    const click = async (x, y) => {
        move(x, y);
        await Scripting.sleep(100);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        await Scripting.sleep(50);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await Scripting.sleep(100);
    };
    try {
        await waitUntil(() => global.get_window_actors().some(actor =>
            actor.meta_window.get_title() === 'G-OS Dock Hit Test'), 'test window');
        const window = global.get_window_actors().find(actor =>
            actor.meta_window.get_title() === 'G-OS Dock Hit Test').meta_window;
        Main.activateWindow(window);
        await waitUntil(() => global.display.focus_window === window, 'focused test window');
        const monitor = Main.layoutManager.monitors[0];
        const testWindowActor = global.get_window_actors().find(actor => actor.meta_window === window);
        const baselineX = monitor.x + monitor.width / 2;
        const baselineY = monitor.y + monitor.height / 2;
        await waitUntil(() => {
            const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, baselineX, baselineY);
            return testWindowActor && (picked === testWindowActor || testWindowActor.contains(picked));
        }, 'test window surface');
        const initialWindowClicks = readClicks();
        const screen = extension._screens[0];
        print(`Baseline pre-click: dockReactive=${screen.dockContainer.reactive}, dockVisible=${screen.dockContainer.visible}, dockPos=${screen.dockContainer.get_transformed_position()}, dockSize=${screen.dockContainer.get_transformed_size()}, bgReactive=${screen.magnificationBackground?.reactive}, bgPos=${screen.magnificationBackground?.get_transformed_position()}, bgSize=${screen.magnificationBackground?.get_transformed_size()}`);
        const pickedBefore = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, baselineX, baselineY);
        print(`Baseline picked before click: ${pickedBefore?.constructor?.name ?? null} inDock=${Boolean(pickedBefore && (pickedBefore === screen.dockContainer || pickedBefore === screen.dock || screen.dockContainer.contains(pickedBefore)))}`);
        await click(baselineX, baselineY);
        const pickedAfter = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, baselineX, baselineY);
        print(`Baseline picked after click: ${pickedAfter?.constructor?.name ?? null} inDock=${Boolean(pickedAfter && (pickedAfter === screen.dockContainer || pickedAfter === screen.dock || screen.dockContainer.contains(pickedAfter)))}, clicks=${readClicks() - initialWindowClicks}`);
        for (let attempt = 0; readClicks() <= initialWindowClicks && attempt < 2; attempt++)
            await click(baselineX, baselineY);
        await waitUntil(() => readClicks() > initialWindowClicks, 'baseline window click');
        report.windowReady = true;

        for (const position of [0, 1, 2]) {
            for (const size of [32, 64]) {
                settings.set_int('dock-position', position);
                settings.set_int('icon-size', size);
                await Scripting.sleep(350);
                await Scripting.waitLeisure();
                const screen = extension._screens[0];
                extension._revealDock(screen);
                await Scripting.waitLeisure();
                const [dockX, dockY] = screen.dockContainer.get_transformed_position();
                const [dockWidth, dockHeight] = screen.dockContainer.get_transformed_size();
                const frame = window.get_frame_rect();
                const left = Math.max(dockX, frame.x);
                const top = Math.max(dockY, frame.y);
                const right = Math.min(dockX + dockWidth, frame.x + frame.width);
                const bottom = Math.min(dockY + dockHeight, frame.y + frame.height);
                const result = {position, size, dockBounds: [dockX, dockY, dockWidth, dockHeight],
                    windowBounds: [frame.x, frame.y, frame.width, frame.height], samples: [], issues: []};
                report.cases.push(result);
                if (right <= left || bottom <= top) {
                    result.issues.push('dock-does-not-overlap-test-window');
                    continue;
                }
                const children = screen.dock.get_children().filter(actor => actor.visible && actor.mapped)
                    .map(actor => {
                        const [x, y] = actor.get_transformed_position();
                        const [width, height] = actor.get_transformed_size();
                        return {actor, x, y, right: x + width, bottom: y + height};
                    });
                const horizontal = position === 0;
                const axisStart = horizontal ? dockX : dockY;
                const axisEnd = horizontal ? dockX + dockWidth : dockY + dockHeight;
                const intervals = children.map(child => ({
                    start: Math.max(axisStart, horizontal ? child.x : child.y),
                    end: Math.min(axisEnd, horizontal ? child.right : child.bottom),
                })).filter(interval => interval.end > interval.start).sort((a, b) => a.start - b.start);
                const points = [];
                const crossFractions = [0.12, 0.5, 0.88];
                const addPoint = (axis, cross) => {
                    const point = horizontal
                        ? [Math.round(axis), Math.round(dockY + dockHeight * cross)]
                        : [Math.round(dockX + dockWidth * cross), Math.round(axis)];
                    if (point[0] < left || point[0] >= right || point[1] < top || point[1] >= bottom)
                        return;
                    if (children.some(child => point[0] >= child.x && point[0] < child.right &&
                        point[1] >= child.y && point[1] < child.bottom))
                        return;
                    if (!points.some(existing => existing[0] === point[0] && existing[1] === point[1]))
                        points.push(point);
                };
                for (const fraction of [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) {
                    for (const cross of crossFractions)
                        addPoint(axisStart + (axisEnd - axisStart) * fraction, cross);
                }
                let cursor = axisStart;
                for (const interval of intervals) {
                    if (interval.start - cursor >= 2) {
                        for (const cross of crossFractions)
                            addPoint((cursor + interval.start) / 2, cross);
                    }
                    cursor = Math.max(cursor, interval.end);
                }
                if (axisEnd - cursor >= 2) {
                    for (const cross of crossFractions)
                        addPoint((cursor + axisEnd) / 2, cross);
                }
                if (points.length < 3)
                    result.issues.push(`too-few-transparent-samples-${points.length}`);
                for (const [index, [x, y]] of points.entries()) {
                    const before = readClicks();
                    const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
                    const inDockTree = Boolean(picked && (picked === screen.dockContainer || picked === screen.dock ||
                        screen.dockContainer.contains(picked)));
                    await click(x, y);
                    const after = readClicks();
                    const sample = {index, point: [x, y], picked: picked?.constructor.name ?? null,
                        inDockTree, windowClicks: after - before};
                    result.samples.push(sample);
                    report.transparentClicks++;
                    if (!inDockTree)
                        result.issues.push(`click-target-outside-dock-${index}`);
                    if (after > before) {
                        report.clickThroughs++;
                        result.issues.push(`click-through-to-window-${index}`);
                    }
                }
                print(`Dock hit-test ${position}/${size}: ${result.samples.length} transparent points, ` +
                    `${result.issues.length} findings`);
            }
        }
        const failures = report.cases.filter(testCase => testCase.issues.length);
        Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/dock-hit-testing.json`).replace_contents(
            new TextEncoder().encode(JSON.stringify(report, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
        print(`Dock hit-test audit: ${report.cases.length} configurations, ${report.transparentClicks} transparent clicks, ` +
            `${report.clickThroughs} click-throughs, ${failures.length} with findings`);
        if (failures.length)
            throw new Error(`Dock hit-test failures: ${JSON.stringify(failures)}`);
    } finally {
        process.force_exit();
    }
}

async function checkCurrentCoverflow() {
    const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    const metadata = JSON.parse(new TextDecoder().decode(root.get_child('dist').get_child('metadata.json').load_contents(null)[1]));
    const uuid = GLib.getenv('G_OS_TEST_EXTENSION_UUID') || metadata.uuid;
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 160; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error('Native Cover Flow did not reach the expected state');
    };
    await waitUntil(() => Main.extensionManager?.lookup(uuid)?.stateObj?._screens?.length > 0);
    const extension = Main.extensionManager.lookup(uuid).stateObj;
    extension._settings.set_boolean('coverflow-enabled', true);
    extension._settings.set_boolean('coverflow-current-workspace-only', false);
    extension._settings.set_boolean('dock-window-previews', false);
    new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean('enable-animations', true);
    await waitUntil(() => extension._coverflowController?.enabled && !extension._settingsApplySource);
    loadShellTheme(GLib.getenv('G_OS_COVERFLOW_THEME') ?? GLib.getenv('MACOS_THEME_DIR'));
    Main.overview.hide();
    const process = Gio.Subprocess.new(['gjs', '-c', `
        imports.gi.versions.Gtk = '3.0';
        const Gtk = imports.gi.Gtk;
        const app = new Gtk.Application({application_id: 'org.gos.CoverflowTest'});
        app.connect('activate', () => {
            for (const name of ['A', 'B', 'C']) {
                const window = new Gtk.ApplicationWindow({application: app, title: 'Cover Flow window ' + name,
                    default_width: 480, default_height: 320});
                window.add(new Gtk.Label({label: 'Fenêtre ' + name}));
                window.show_all(); window.present();
            }
        });
        app.run([]);
    `], Gio.SubprocessFlags.NONE);
    const keyboard = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const key = (symbol, pressed) => keyboard.notify_keyval(GLib.get_monotonic_time(), symbol,
        pressed ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED);
    const tab = () => { key(Clutter.KEY_Tab, true); key(Clutter.KEY_Tab, false); };
    try {
        await waitUntil(() => global.get_window_actors().filter(actor => actor.meta_window.get_title()?.startsWith('Cover Flow window ')).length === 3);
        const focused = global.get_window_actors().find(actor => actor.meta_window.get_title() === 'Cover Flow window C').meta_window;
        Main.activateWindow(focused);
        Main.overview.hide();
        await Scripting.sleep(150);
        key(Clutter.KEY_Alt_L, true);
        tab();
        await waitUntil(() => extension._coverflowController.popup?.visible);
        const popup = extension._coverflowController.popup;
        if (!popup._haveModal || popup._cards.length < 3)
            throw new Error('Cover Flow did not capture Alt+Tab or create its window clones');
        await Scripting.sleep(250);
        const selected = popup._selectedIndex;
        const center = popup._cards[selected];
        if (!center?.source || !center.button.mapped || center.clone.get_transformed_size().some(size => size <= 0) ||
            Math.abs(center.button.rotation_angle_y) > 1 || !popup._cards.some(card => Math.abs(card.button.rotation_angle_y) > 30))
            throw new Error('Cover Flow center or tilted window previews were not rendered');
        await capture('coverflow-alt-tab.png');
        const monitor = popup._flowMonitor;
        popup._flowMonitor = {...monitor, x: monitor.x + (monitor.width - 800) / 2,
            y: monitor.y + (monitor.height - 500) / 2, width: 800, height: 500};
        popup.queue_relayout();
        await waitUntil(() => popup._sceneWidth === 800 && popup._sceneHeight === 500);
        await Scripting.sleep(100);
        if (popup._cards[popup._selectedIndex].button.get_transformed_size()[0] > 760)
            throw new Error('Cover Flow does not fit a compact display');
        await capture('coverflow-compact.png');
        popup._flowMonitor = monitor;
        popup.queue_relayout();
        await waitUntil(() => popup._sceneWidth === monitor.width);
        tab();
        await waitUntil(() => popup._selectedIndex === (selected + 1) % popup._items.length);
        await Scripting.sleep(220);
        await capture('coverflow-next-window.png');
        key(Clutter.KEY_Shift_L, true);
        tab();
        await waitUntil(() => popup._selectedIndex === selected);
        key(Clutter.KEY_Shift_L, false);
        const expected = popup._items[popup._selectedIndex].window;
        print(`Native Cover Flow release: selected=${popup._selectedIndex}, expected=${expected.get_title()}, mask=${popup._modifierMask}, pointer=${global.get_pointer()}`);
        key(Clutter.KEY_Alt_L, false);
        await Scripting.sleep(350);
        print(`Native Cover Flow release result: popup=${Boolean(extension._coverflowController.popup)}, focus=${global.display.focus_window?.get_title()}, pointer=${global.get_pointer()}`);
        await waitUntil(() => !extension._coverflowController.popup && global.display.focus_window === expected);
        const beforeEscape = global.display.focus_window;
        key(Clutter.KEY_Alt_L, true);
        tab();
        await waitUntil(() => extension._coverflowController.popup?.visible);
        key(Clutter.KEY_Escape, true);
        key(Clutter.KEY_Escape, false);
        key(Clutter.KEY_Alt_L, false);
        await waitUntil(() => !extension._coverflowController.popup);
        if (global.display.focus_window !== beforeEscape)
            throw new Error('Escape changed the active window instead of cancelling Cover Flow');
        key(Clutter.KEY_Alt_L, true);
        tab();
        await waitUntil(() => extension._coverflowController.popup?.visible);
        const closingPopup = extension._coverflowController.popup;
        const oldCount = closingPopup._items.length;
        const closeIndex = closingPopup._items.findIndex(item => item.window.get_title()?.startsWith('Cover Flow window '));
        closingPopup._select(closeIndex);
        key(Clutter.KEY_F4, true);
        key(Clutter.KEY_F4, false);
        await waitUntil(() => closingPopup._items.length === oldCount - 1 && closingPopup._cards.length === oldCount - 1);
        key(Clutter.KEY_Alt_L, false);
        await waitUntil(() => !extension._coverflowController.popup);
        extension._settings.set_boolean('coverflow-enabled', false);
        await waitUntil(() => !extension._coverflowController.enabled);
        if (extension._coverflowController.enabled)
            throw new Error('Disabling Cover Flow did not restore native bindings');
        print('Native Cover Flow: Alt+Tab, live tilted previews, compact layout, navigation, Alt release, Escape, window close and disable verified');
        process.force_exit();
        await waitUntil(() => !global.get_window_actors().some(actor => actor.meta_window.get_title()?.startsWith('Cover Flow window ')));
        Main.extensionManager.disableExtension(uuid);
        return ['coverflow-rendering', 'compact-layout', 'alt-tab', 'reverse-navigation', 'release-activation',
            'escape-cancel', 'window-close', 'native-binding-restore'];
    } finally {
        key(Clutter.KEY_Shift_L, false);
        key(Clutter.KEY_Alt_L, false);
        process.force_exit();
    }
}

async function checkCurrentWindowPreviews() {
    const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    const metadata = JSON.parse(new TextDecoder().decode(root.get_child('dist').get_child('metadata.json').load_contents(null)[1]));
    const uuid = GLib.getenv('G_OS_TEST_EXTENSION_UUID') || metadata.uuid;
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 160; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error('Native window preview did not reach the expected state');
    };
    await waitUntil(() => Main.extensionManager?.lookup(uuid)?.stateObj?._screens?.length > 0);
    const extension = Main.extensionManager.lookup(uuid).stateObj;
    const settings = extension._settings;
    if (settings.settings_schema.has_key('global-menu-enabled'))
        settings.set_boolean('global-menu-enabled', false);
    settings.set_boolean('dock-window-previews', true);
    settings.set_int('dock-window-preview-delay', 500);
    settings.set_boolean('show-running-apps', true);
    settings.set_int('dock-hover-animation', 4);
    settings.set_int('dock-magnify-max', 180);
    new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean('enable-animations', true);
    Main.overview.hide();
    const desktopFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(),
        'applications', 'org.gos.WindowPreviewTest.desktop']));
    GLib.mkdir_with_parents(desktopFile.get_parent().get_path(), 0o755);
    desktopFile.replace_contents(new TextEncoder().encode('[Desktop Entry]\nType=Application\nName=Preview Test\nExec=gjs\nIcon=application-x-executable\nStartupWMClass=org.gos.WindowPreviewTest\n'),
        null, false, Gio.FileCreateFlags.NONE, null);
    await waitUntil(() => Shell.AppSystem.get_default().lookup_app('org.gos.WindowPreviewTest.desktop'));
    const script = `
        imports.gi.versions.Gtk = '3.0';
        const Gtk = imports.gi.Gtk;
        const app = new Gtk.Application({application_id: 'org.gos.WindowPreviewTest'});
        app.connect('activate', () => {
            for (const name of ['A', 'B']) {
                const window = new Gtk.ApplicationWindow({application: app, title: 'Preview window ' + name,
                    default_width: 480, default_height: 280});
                window.add(new Gtk.Label({label: 'Contenu de la fenêtre ' + name}));
                window.show_all(); window.present();
            }
        });
        app.run([]);
    `;
    const process = Gio.Subprocess.new(['gjs', '-c', script], Gio.SubprocessFlags.NONE);
    const pointer = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    try {
        await waitUntil(() => global.get_window_actors().filter(actor => actor.meta_window.get_title()?.startsWith('Preview window ')).length === 2);
        for (const position of [0, 1, 2]) {
            settings.set_int('dock-position', position);
            settings.set_boolean('dock-autohide', true);
            Main.overview.hide();
            await Scripting.sleep(150);
            const screen = extension._screens[0];
            extension._revealDock(screen);
            await waitUntil(() => screen.appButtons.some(button => button.app.get_id() === 'org.gos.WindowPreviewTest.desktop'));
            let button = screen.appButtons.find(candidate => candidate.app.get_id() === 'org.gos.WindowPreviewTest.desktop');
            const hoverIcon = () => {
                button = screen.appButtons.find(candidate => candidate.app.get_id() === 'org.gos.WindowPreviewTest.desktop');
                const [x, y] = button.get_transformed_position();
                const [width, height] = button.get_transformed_size();
                move(x + width / 2, y + height / 2);
            };
            move(screen.monitor.x + 12, screen.monitor.y + 70);
            hoverIcon();
            await waitUntil(() => { hoverIcon(); return button.hover; });
            await Scripting.sleep(150);
            if (button.windowPreview.isOpen)
                throw new Error('Window preview opened before the configured delay');
            move(screen.monitor.x + 12, screen.monitor.y + 70);
            await Scripting.sleep(550);
            if (button.windowPreview.isOpen)
                throw new Error('Leaving an icon did not cancel the delayed preview');
            extension._revealDock(screen);
            hoverIcon();
            await waitUntil(() => { hoverIcon(); return button.windowPreview.isOpen; });
            const controller = button.windowPreview;
            if (controller.rows.length !== 2 || controller.rows.some(row => !row.clone || row.clone.get_transformed_size().some(size => size <= 0)))
                throw new Error('Real window clones were not displayed in the Dock preview');
            await Scripting.sleep(1200);
            if (!controller.isOpen || !button.hover || button.scale_x * button.icon.icon.scale_x < 1.65)
                throw new Error(`Preview disturbed Dock hover animation at position ${position}: open=${controller.isOpen}, hover=${button.hover}, scale=${button.icon.icon.scale_x}`);
            await capture(`dock-window-preview-${position}.png`);
            const row = controller.rows.find(candidate => candidate.window.get_title() === 'Preview window A');
            const [x, y] = row.preview.get_transformed_position();
            const [width, height] = row.preview.get_transformed_size();
            move(x + width / 2, y + height / 2);
            await Scripting.sleep(350);
            if (!controller.isOpen || !screen.dockContainer.visible)
                throw new Error('Moving into the preview did not keep the preview and Dock visible');
            pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
            await waitUntil(() => !controller.isOpen && global.display.focus_window === row.window);
            print(`Native Dock window preview ${position}: delay, cancellation, live clones, pointer bridge and activation verified`);
        }
        settings.set_boolean('dock-window-previews', false);
        await Scripting.sleep(100);
        if (extension._screens.some(screen => screen.appButtons.some(button => button.windowPreview)))
            throw new Error('Disabling window previews did not destroy their controllers');
        process.force_exit();
        await waitUntil(() => !global.get_window_actors().some(actor => actor.meta_window.get_title()?.startsWith('Preview window ')));
        Main.extensionManager.disableExtension(uuid);
        return ['preview-delay', 'preview-cancellation', 'live-window-clones', 'pointer-activation', 'three-dock-positions'];
    } finally {
        process.force_exit();
        desktopFile.delete(null);
    }
}

async function checkInkscapeGlobalMenu() {
    const waitUntil = async (predicate, state) => {
        for (let attempt = 0; attempt < 400; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error(`Inkscape menu test did not reach ${state}`);
    };
    const uuid = extensionMetadata.uuid;
    await waitUntil(() => Main.extensionManager?.lookup(uuid)?.stateObj?._screens?.length, 'extension startup');
    const extension = Main.extensionManager.lookup(uuid).stateObj;
    extension._settings.set_boolean('global-menu-enabled', true);
    Main.overview.hide();
    await waitUntil(() => extension._screens[0]?.sessionButton && extension._screens[0].panel.get_stage(),
        'mounted complete topbar');
    loadShellTheme();
    const directory = GLib.dir_make_tmp('g-os-inkscape-XXXXXX');
    if (GLib.getenv('G_OS_INKSCAPE_HIDE_MENUBAR') === '1') {
        GLib.mkdir_with_parents(`${directory}/config/gtk-3.0`, 0o700);
        Gio.File.new_for_path(`${directory}/config/gtk-3.0/settings.ini`).replace_contents(
            new TextEncoder().encode('[Settings]\ngtk-shell-shows-menubar=true\n'),
            null, false, Gio.FileCreateFlags.NONE, null);
    }
    const document = Gio.File.new_for_path(`${directory}/menu-test.svg`);
    document.replace_contents(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'),
        null, false, Gio.FileCreateFlags.NONE, null);
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    const process = launcher.spawnv(['flatpak', 'run', '--no-documents-portal', '--socket=x11', '--nosocket=wayland',
        '--env=GDK_BACKEND=x11', `--env=INKSCAPE_PROFILE_DIR=${directory}/profile`,
        `--env=XDG_CONFIG_HOME=${directory}/config`, `--filesystem=${directory}`,
        'org.inkscape.Inkscape', document.get_path()]);
    try {
        let window;
        await waitUntil(() => {
            window = global.get_window_actors().map(actor => actor.meta_window)
                .find(candidate => candidate.get_title()?.includes('menu-test.svg'));
            return window;
        }, 'Inkscape document');
        Main.activateWindow(window);
        const screen = extension._screens[window.get_monitor()];
        const controller = screen.globalMenu;
        await waitUntil(() => controller?.buttons.length > 3, 'exported Inkscape menus');
        await Scripting.sleep(300);
        const appMenu = screen.appMenuButton.menu;
        appMenu.open({animate: false});
        const quit = appMenu._getMenuItems().find(item => item.label?.text === 'Quitter Inkscape');
        if (!quit?.reactive || screen.menuButton.menu._getMenuItems()
            .some(item => item.label?.text?.startsWith('Quitter')))
            throw new Error('Quit action was not moved into the application title menu');
        await capture('inkscape-application-title-menu.png');
        appMenu.close({animate: false});
        for (const {button, label} of controller.buttons) {
            const text = button.get_child();
            const [, naturalHeight] = text.get_preferred_height(-1);
            const [, textY] = text.get_transformed_position();
            const [, panelY] = screen.panel.get_transformed_position();
            if (text.height < naturalHeight || textY < panelY || textY + text.height > panelY + screen.panel.height)
                throw new Error(`Inkscape topbar label is clipped: ${label}, ${text.height}/${naturalHeight}`);
        }
        const verified = [];
        for (const label of controller.buttons.map(entry => entry.label)) {
            const currentEntry = () => extension._screens[window.get_monitor()].globalMenu.buttons
                .find(entry => entry.label === label);
            currentEntry().menu.open({animate: false});
            await Scripting.sleep(300);
            await waitUntil(() => currentEntry()?.menu.isOpen && currentEntry().menu.actor.mapped, `mapped ${label} menu`);
            const entry = currentEntry();
            const [x, y] = entry.menu.actor.get_transformed_position();
            const [width, height] = entry.menu.actor.get_transformed_size();
            const monitor = screen.monitor;
            if (x < monitor.x || y < monitor.y || x + width > monitor.x + monitor.width + 1 ||
                y + height > monitor.y + monitor.height + 1)
                throw new Error(`Inkscape menu overflows: ${entry.label}, ${x},${y} ${width}x${height}`);
            const scroll = entry.menu._boxPointer.bin.get_child();
            if (!(scroll instanceof St.ScrollView))
                throw new Error(`Inkscape menu is not scrollable: ${entry.label}`);
            global.stage.queue_redraw();
            await Scripting.waitLeisure();
            await capture(`inkscape-global-menu-${verified.length}.png`);
            verified.push(entry.label);
            currentEntry()?.menu.close({animate: false});
        }
        print(`Inkscape global menus verified: ${verified.join(', ')}`);
        appMenu.open({animate: false});
        quit.emit('activate', null);
        await waitUntil(() => !global.get_window_actors().some(actor => actor.meta_window === window),
            'Inkscape quit action');
        Main.extensionManager.disableExtension(uuid);
        return ['inkscape-flatpak', 'unclipped-panel-labels', 'scrollable-monitor-bounded-menus',
            'application-title-quit-menu'];
    } finally {
        process.force_exit();
    }
}

async function checkCurrentGlobalMenus() {
    const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    const metadata = JSON.parse(new TextDecoder().decode(root.get_child('dist').get_child('metadata.json').load_contents(null)[1]));
    print(`Current global menu: waiting for ${metadata.uuid}`);
    const waitUntil = async (predicate, state = 'expected state') => {
        for (let attempt = 0; attempt < 120; attempt++) {
            if (predicate())
                return;
            await Scripting.sleep(50);
        }
        throw new Error(`Current global-menu native test did not reach ${state}`);
    };
    await waitUntil(() => Main.extensionManager?.lookup(metadata.uuid)?.stateObj?._screens?.length > 0);
    const extension = Main.extensionManager.lookup(metadata.uuid).stateObj;
    print('Current global menu: extension ready');
    if (!extension._settings.get_boolean('global-menu-dbus-enabled'))
        throw new Error('DBusMenu compatibility is not enabled by default');
    extension._settings.set_boolean('global-menu-enabled', true);
    extension._settings.set_boolean('global-menu-dbus-enabled', false);
    await waitUntil(() => !extension._menuRegistrar, 'AppMenu registrar disabled for GTK-only test');
    await waitUntil(() => extension._screens[0]?.globalMenu, 'GTK menu panel');
    if (extension._menuRegistrar)
        throw new Error('GTK Wayland menu unexpectedly depends on the X11 AppMenu registrar');
    const {DBUS_MENU_XML} = await import('../dist/panel/dbusMenu.js');
    const verifiedProtocols = [];
    for (const protocol of ['gtk', 'dbusmenu']) {
        if (protocol === 'dbusmenu') {
            extension._settings.set_boolean('global-menu-dbus-enabled', true);
            await waitUntil(() => extension._menuRegistrar?.ownsName, 'AppMenu registrar');
            print('Current global menu: registrar ready');
        }
        print(`Current global menu: starting ${protocol}`);
        const script = `
            imports.gi.versions.Gtk = '3.0';
            imports.gi.versions.GdkX11 = '3.0';
            const Gtk = imports.gi.Gtk;
            const GdkX11 = imports.gi.GdkX11;
            const Gio = imports.gi.Gio;
            const GLib = imports.gi.GLib;
            const protocol = ${JSON.stringify(protocol)};
            const app = new Gtk.Application({application_id: 'org.gos.CurrentGlobalMenuTest.' + protocol});
            let window;
            let checked = true;
            let exported;
            app.connect('startup', () => {
                if (protocol !== 'gtk') return;
                const action = new Gio.SimpleAction({name: 'test'});
                action.connect('activate', () => window.set_title('Global menu executed'));
                app.add_action(action);
                const option = new Gio.SimpleAction({name: 'option', state: new GLib.Variant('b', true)});
                option.connect('activate', () => option.set_state(new GLib.Variant('b', false)));
                app.add_action(option);
                const disabled = new Gio.SimpleAction({name: 'disabled'});
                disabled.set_enabled(false);
                app.add_action(disabled);
                const file = new Gio.Menu();
                file.append('_Tester', 'app.test'); file.append('_Option', 'app.option');
                file.append('_Indisponible', 'app.disabled');
                const bar = new Gio.Menu(); bar.append_submenu('_Fichier', file); app.set_menubar(bar);
            });
            app.connect('activate', () => {
                if (protocol === 'dbusmenu') app.hold();
                window = protocol === 'gtk'
                    ? new Gtk.ApplicationWindow({application: app, title: 'Global menu current test', show_menubar: true})
                    : new Gtk.Window({title: 'Global menu current test'});
                window.set_default_size(480, 280);
                window.add(new Gtk.Label({label: 'Test menu global ' + protocol}));
                window.connect('destroy', () => {
                    if (protocol === 'dbusmenu') app.release();
                    app.quit();
                });
                window.show_all(); window.present();
                if (protocol !== 'dbusmenu') return;
                const node = (id, properties, children = []) => [id,
                    Object.fromEntries(Object.entries(properties).map(([name, value]) => [name,
                        new GLib.Variant(typeof value === 'boolean' ? 'b' : typeof value === 'number' ? 'i' : 's', value)])),
                    children.map(child => new GLib.Variant('(ia{sv}av)', child))];
                exported = Gio.DBusExportedObject.wrapJSObject(${JSON.stringify(DBUS_MENU_XML)}, {
                    GetLayout() { return [1, node(0, {}, [node(1, {label: '&Fichier', 'children-display': 'submenu'}, [
                        node(2, {label: '&Tester'}),
                        node(3, {label: 'Option', 'toggle-type': 'checkmark', 'toggle-state': checked ? 1 : 0}),
                        node(4, {label: 'Indisponible', enabled: false}), node(5, {label: 'Masqué', visible: false}),
                    ])])]; },
                    AboutToShow() { return false; },
                    Event(id, event) {
                        if (event !== 'clicked') return;
                        if (id === 2) window.set_title('Global menu executed');
                        if (id === 3) { checked = false; exported.emit_signal('LayoutUpdated', new GLib.Variant('(ui)', [2, 0])); }
                    },
                });
                exported.export(Gio.DBus.session, '/org/gos/CurrentMenu');
                const windowId = window.get_window().get_xid?.();
                if (!windowId) return;
                Gio.DBus.session.call('com.canonical.AppMenu.Registrar', '/com/canonical/AppMenu/Registrar',
                    'com.canonical.AppMenu.Registrar', 'RegisterWindow',
                    new GLib.Variant('(uo)', [windowId, '/org/gos/CurrentMenu']),
                    null, Gio.DBusCallFlags.NONE, 3000, null, (connection, result) => connection.call_finish(result));
            });
            app.run([]);
        `;
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        if (protocol === 'gtk')
            launcher.setenv('GDK_BACKEND', 'wayland', true);
        const process = launcher.spawnv(['gjs', '-c', script]);
        try {
            let window;
            await waitUntil(() => {
                window = global.get_window_actors().map(actor => actor.meta_window)
                    .find(candidate => candidate.get_title() === 'Global menu current test');
                return Boolean(window);
            }, `${protocol} application window`);
            if (protocol === 'gtk' && window.get_client_type() !== Meta.WindowClientType.WAYLAND)
                throw new Error('GTK global-menu test did not create a native Wayland window');
            if (protocol === 'dbusmenu' && window.get_client_type() !== Meta.WindowClientType.X11) {
                print('Current global menu: dbusmenu verification skipped; headless GTK window is Wayland, but AppMenu registration requires X11');
                continue;
            }
            print(`Current global menu: ${protocol} window ready`);
            Main.activateWindow(window);
            const controller = extension._screens[window.get_monitor()].globalMenu;
            const entry = () => controller.buttons.find(candidate => candidate.label === 'Fichier');
            const item = label => entry()?.menu._getMenuItems().find(candidate => candidate.label?.text === label);
            await waitUntil(() => controller.backend === protocol && item('Tester')?.reactive,
                `${protocol} menu items`);
            print(`Current global menu: ${protocol} menu ready`);
            if (item('Indisponible')?.reactive || item('Masqué'))
                throw new Error(`Disabled or hidden ${protocol} menu item was not preserved`);
            entry().menu.open();
            await Scripting.sleep(100);
            await capture(`current-global-menu-${protocol}.png`);
            item('Tester').emit('activate', null);
            await waitUntil(() => window.get_title() === 'Global menu executed');
            item('Option').emit('activate', null);
            await waitUntil(() => (protocol === 'gtk' ? controller.groups.app.get_action_state('option')
                : controller.groups.dbus.get_action_state('3'))?.get_boolean() === false);
            window.delete(global.get_current_time());
            await waitUntil(() => !controller.container.visible);
            print(`Current global menu ${protocol}: focus, action, checked state and cleanup verified`);
            verifiedProtocols.push(protocol);
        } finally {
            process.force_exit();
        }
    }
    return verifiedProtocols;
}

async function checkFeatureScenario() {
    await waitForExtension();
    // Avoid forcing a redundant Overview teardown when the headless session
    // has already started on the desktop; detached StScrollView actors can
    // otherwise be measured during the no-op hide transition.
    if (Main.overview.visible) {
        Main.overview.hide();
        await Scripting.sleep(350);
        if (Main.overview.visible)
            throw new Error('Overview did not close before the panel visual test');
    }
    loadShellTheme();
    await Scripting.sleep(400);
    const feature = GLib.getenv('G_OS_FEATURE_TEST');
    const scenarios = {
        simple: checkSimpleWidgets,
        flux: checkFluxWidgets,
        widgets: checkWidgetSystem,
        utility: checkUtilityWidgets,
        media: checkMediaWidgets,
        folders: checkFolderViewOptions,
        stacks: checkStackAlignment,
        'dock-widgets': checkDockWidgets,
        'dock-widget-fit': () => checkDockWidgets(true),
        coverage: checkDockWindowCoverage,
        'dock-margins': checkDockMaximizeMargins,
        'dock-hit-testing': checkDockHitTesting,
        'dock-appearance': checkDockAppearance,
        notifications: checkNotificationControls,
        calendar: checkPanelCalendar,
        'settings-audit': checkSettingsAudit,
        'daily-usage': checkDailyUsage,
        'desktop-icons': checkDesktopIcons,
        'desktop-interactions': checkDesktopInteractions,
        'desktop-layout-audit': checkDesktopLayoutAudit,
        'dock-motion-audit': checkDockMotionAudit,
        magnification: checkLargeMagnification,
        'dock-rebuild-profile': checkDockRebuildProfile,
        'state-stress': checkStateStress,
        shortcuts: checkSearchShortcuts,
        panel: checkPanelControls,
    };
    if (!Object.hasOwn(scenarios, feature))
        throw new Error(`Unknown native feature scenario: ${feature}`);
    try {
        const verified = await scenarios[feature]();
        return Array.isArray(verified) && verified.length ? verified : [`native-feature:${feature}`];
    } finally {
        if (Main.extensionManager.lookup(extensionMetadata.uuid)?.stateObj?._screens?.length)
            Main.extensionManager.disableExtension(extensionMetadata.uuid);
        await Scripting.sleep(200);
    }
}

async function checkSettingsAudit() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid)?.stateObj;
    if (!extension?._settings || !extension._screens.length)
        throw new Error('Settings audit started before the extension was ready');
    const settings = extension._settings;
    const keys = settings.settings_schema.list_keys().sort();
    const originals = new Map(keys.map(key => [key, settings.get_value(key)]));
    const changedKeys = new Set();
    const cases = [];
    const cleanupIssues = [];
    const initialScreenCount = extension._screens.length;
    const signalId = settings.connect('changed', (_settings, key) => changedKeys.add(key));
    const waitUntil = async (predicate, state) => {
        for (let attempt = 0; attempt < 80; attempt++) {
            if (predicate())
                return true;
            await Scripting.sleep(25);
        }
        throw new Error(`Setting did not reach ${state}`);
    };
    const isCurrent = (key, value) => settings.get_value(key).equal(value);
    const alternateFor = (key, original) => {
        const type = original.get_type_string();
        if (type === 'b')
            return {value: new GLib.Variant('b', !original.get_boolean()), operation: 'toggle'};
        if (type === 'i') {
            const current = original.get_int32();
            for (const candidate of [current + 1, current - 1]) {
                const value = new GLib.Variant('i', candidate);
                if (settings.range_check(key, value))
                    return {value, operation: 'adjacent-valid-integer'};
            }
        }
        if (type === 'as' && key !== 'window-button-layout-backup' && original.deep_unpack().length > 0)
            return {value: new GLib.Variant('as', []), operation: 'empty-list'};
        if (type === 's' && key.endsWith('-icon-name'))
            return {value: new GLib.Variant('s', 'preferences-system-symbolic'), operation: 'icon-name'};
        return null;
    };
    try {
        for (const key of keys) {
            const original = originals.get(key);
            const writable = settings.is_writable(key);
            const candidate = alternateFor(key, original);
            const result = {key, type: original.get_type_string(), writable,
                operation: candidate?.operation ?? 'safe-round-trip', readBack: false, restored: false,
                runtimeHealthy: false, issues: []};
            try {
                if (writable && candidate && !isCurrent(key, candidate.value)) {
                    changedKeys.delete(key);
                    settings.set_value(key, candidate.value);
                    await waitUntil(() => isCurrent(key, candidate.value) && changedKeys.has(key), 'temporary value');
                    await Scripting.sleep(60);
                    result.readBack = isCurrent(key, candidate.value);
                    if (!changedKeys.has(key))
                        result.issues.push('changed-signal-not-observed');
                } else {
                    if (writable)
                        settings.set_value(key, original);
                    result.readBack = isCurrent(key, original);
                }
                result.runtimeHealthy = Main.extensionManager.lookup(extensionMetadata.uuid)?.stateObj === extension &&
                    extension._screens.length === initialScreenCount;
                if (!result.runtimeHealthy)
                    result.issues.push('extension-runtime-or-screen-count-changed');
            } catch (error) {
                result.issues.push(error.message);
            } finally {
                try {
                    if (!isCurrent(key, original))
                        settings.set_value(key, original);
                    result.restored = await waitUntil(() => isCurrent(key, original), 'original value');
                } catch (error) {
                    result.issues.push(`restore-failed: ${error.message}`);
                    cleanupIssues.push(`${key}: ${error.message}`);
                }
            }
            cases.push(result);
            if (cases.length % 12 === 0)
                print(`Settings audit: ${cases.length}/${keys.length} keys checked`);
        }
    } finally {
        for (const [key, original] of originals) {
            try {
                if (!isCurrent(key, original))
                    settings.set_value(key, original);
                if (!isCurrent(key, original))
                    cleanupIssues.push(`${key}: final value mismatch`);
            } catch (error) {
                cleanupIssues.push(`${key}: ${error.message}`);
            }
        }
        settings.disconnect(signalId);
        await Scripting.sleep(250);
    }
    const report = {schemaKeyCount: keys.length, testedKeys: cases.map(testCase => testCase.key), cases, cleanupIssues};
    Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/settings-audit.json`).replace_contents(
        new TextEncoder().encode(JSON.stringify(report, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
    const findings = cases.filter(testCase => testCase.issues.length || !testCase.writable ||
        !testCase.readBack || !testCase.restored || !testCase.runtimeHealthy).length + cleanupIssues.length;
    print(`Native settings audit: ${cases.length} keys, ${findings} with findings`);
    return keys.map(key => `setting:${key}`);
}

async function checkDailyUsage() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid)?.stateObj;
    if (!extension?._screens?.length)
        throw new Error('Daily usage started before the extension was ready');
    const settings = extension._settings;
    let screen = extension._screens[0];
    const notificationTitle = 'G-Os daily-use test';
    const previousClock = settings.get_boolean('panel-show-clock');
    const previousNotifications = settings.get_boolean('panel-show-notifications');
    const pointer = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const steps = [];
    const waitUntil = async (predicate, state) => {
        for (let attempt = 0; attempt < 80; attempt++) {
            if (predicate())
                return;
            await Scripting.sleep(25);
        }
        throw new Error(`Daily-use action did not reach ${state}`);
    };
    const waitForStablePanelActor = async (selectActor, state) => {
        let previousScreen = null;
        let previousActor = null;
        let stable = 0;
        for (let attempt = 0; attempt < 80; attempt++) {
            const current = extension._screens[0];
            const actor = current && selectActor(current);
            const [width, height] = actor?.get_transformed_size?.() ?? [0, 0];
            let parent = actor?.get_parent();
            while (parent && parent !== current.panel)
                parent = parent.get_parent();
            const ready = actor?.mapped && parent === current.panel &&
                [width, height].every(Number.isFinite) && width > 0 && height > 0;
            if (ready && current === previousScreen && actor === previousActor)
                stable++;
            else
                stable = 0;
            if (stable >= 2)
                return current;
            previousScreen = current;
            previousActor = actor;
            await Scripting.sleep(50);
        }
        throw new Error(`Daily-use ${state} did not stabilize`);
    };
    const clickActor = async (actor, button = Clutter.BUTTON_PRIMARY) => {
        if (!actor?.mapped)
            throw new Error('Expected interactive actor is not mapped');
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 ||
            x < 0 || y < 0 || x + width > global.stage.width || y + height > global.stage.height)
            throw new Error(`Interactive actor has invalid screen geometry: ${x},${y} ${width}x${height}`);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
        await Scripting.sleep(100);
        pointer.notify_button(GLib.get_monotonic_time(), button, Clutter.ButtonState.PRESSED);
        pointer.notify_button(GLib.get_monotonic_time(), button, Clutter.ButtonState.RELEASED);
        await Scripting.sleep(350);
        await Scripting.waitLeisure();
    };
    const runStep = async (id, action) => {
        const result = {id, passed: false, issues: []};
        try {
            const outcome = await action();
            if (outcome && typeof outcome === 'object') {
                result.passed = Boolean(outcome.passed);
                result.skipped = Boolean(outcome.skipped);
                result.skipReason = outcome.skipReason;
                result.issues.push(...(outcome.issues ?? []));
            } else {
                result.passed = Boolean(outcome);
            }
        } catch (error) {
            result.issues.push(error.message);
        }
        steps.push(result);
        print(`Daily usage: ${id}=${result.skipped ? `skipped (${result.skipReason})` : result.passed}` +
            `${result.issues.length ? ` · ${result.issues.join(', ')}` : ''}`);
    };
    try {
        Main.overview.hide();
        await waitUntil(() => !Main.overview.visible, 'closed initial Overview');
        await runStep('dock-ready', async () => screen.dock.mapped &&
            screen.dock.get_children().some(actor => actor.dockFocusKey));
        await runStep('open-app-grid', async () => {
            const launcher = screen.dock.get_children()
                .find(actor => actor.dockFocusKey === 'shortcut:applications');
            await clickActor(launcher);
            await waitUntil(() => Main.overview.visible, 'application grid');
            return Main.overview.visible;
        });
        await runStep('close-overview', async () => {
            Main.overview.hide();
            await waitUntil(() => !Main.overview.visible, 'closed Overview');
            screen = extension._screens[0];
            return !Main.overview.visible;
        });
        await runStep('application-menu', async () => {
            screen = extension._screens[0];
            const menu = screen.appMenuButton.menu;
            await clickActor(screen.appMenuButton);
            await waitUntil(() => menu.isOpen, 'application menu');
            const hasActions = menu._getMenuItems().length > 0;
            await capture('daily-application-menu.png');
            menu.close({animate: false});
            return hasActions && !menu.isOpen;
        });
        await runStep('quick-settings-menu', async () => {
            screen = extension._screens[0];
            const button = screen.statusButtons.find(candidate => candidate.statusMenu);
            if (!button)
                return false;
            await clickActor(button);
            await waitUntil(() => button.statusMenu.isOpen, 'quick settings menu');
            button.statusMenu.close({animate: false});
            return !button.statusMenu.isOpen;
        });
        await runStep('calendar', async () => {
            settings.set_boolean('panel-show-clock', true);
            await Scripting.sleep(150);
            await Scripting.waitLeisure();
            screen = await waitForStablePanelActor(current => current.clockButton, 'clock button');
            const dateMenu = Main.panel.statusArea.dateMenu;
            let pointerActivated = false;
            const clickSignal = screen.clockButton.connect('clicked', () => pointerActivated = true);
            await clickActor(screen.clockButton);
            screen.clockButton.disconnect(clickSignal);
            const menu = screen.calendarMenu ?? dateMenu?.menu;
            const pointerOpened = Boolean(menu?.isOpen);
            if (!menu)
                return {passed: false, issues: ['calendar-menu-unavailable']};
            if (!menu.isOpen) {
                screen.clockButton.emit('clicked', null);
                await Scripting.sleep(100);
            }
            if (!menu.isOpen)
                menu.open({animate: false});
            await Scripting.sleep(100);
            if (!menu.isOpen)
                return {passed: false, issues: ['calendar-menu-failed-to-open']};
            await capture('daily-calendar.png');
            menu.close({animate: false});
            return {passed: pointerActivated && pointerOpened && !menu.isOpen,
                issues: pointerOpened ? [] : ['mouse-click-did-not-open-calendar']};
        });
        await runStep('notification-menu', async () => {
            settings.set_boolean('panel-show-notifications', true);
            Main.notify(notificationTitle, 'Synthetic notification for the isolated daily-use scenario');
            await waitUntil(() => Main.messageTray.getSources().some(source =>
                source.notifications.some(notification => notification.title === notificationTitle)),
            'synthetic notification');
            extension._updatePanelNotifications();
            await Scripting.sleep(150);
            await Scripting.waitLeisure();
            screen = await waitForStablePanelActor(current => current.notificationButton?.container,
                'notification button');
            await clickActor(screen.notificationButton);
            const pointerOpened = screen.notificationMenu?.isOpen ?? false;
            if (!pointerOpened)
                screen.notificationMenu.open({animate: false});
            await waitUntil(() => screen.notificationMenu.isOpen, 'notification menu');
            const listed = screen.notificationMenu._getMenuItems()
                .some(item => item.label?.text?.includes(notificationTitle));
            screen.notificationMenu.close({animate: false});
            return {passed: pointerOpened && listed,
                issues: pointerOpened ? [] : ['mouse-click-did-not-open-menu']};
        });
        await runStep('clear-notification', async () => {
            const menu = screen.notificationMenu;
            menu.open({animate: false});
            await Scripting.sleep(100);
            const clear = menu._getMenuItems().find(item => item.label?.text === 'Tout effacer');
            clear?.activate(null);
            await waitUntil(() => !Main.messageTray.getSources().some(source =>
                source.notifications.some(notification => notification.title === notificationTitle)),
            'cleared synthetic notification');
            return !menu.isOpen;
        });
    } finally {
        for (const source of Main.messageTray.getSources()) {
            for (const notification of [...source.notifications]) {
                if (notification.title === notificationTitle)
                    notification.destroy();
            }
        }
        screen = extension._screens[0];
        screen.appMenuButton.menu.close({animate: false});
        screen.calendarMenu?.close({animate: false});
        screen.notificationMenu?.close({animate: false});
        for (const button of screen.statusButtons)
            button.statusMenu?.close({animate: false});
        settings.set_boolean('panel-show-clock', previousClock);
        settings.set_boolean('panel-show-notifications', previousNotifications);
        Main.overview.hide();
        await Scripting.sleep(150);
    }
    const report = {steps};
    Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/daily-usage.json`).replace_contents(
        new TextEncoder().encode(JSON.stringify(report, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
    const findings = steps.filter(step => (!step.passed && !step.skipped) || step.issues.length).length;
    print(`Daily usage: ${steps.length} steps, ${findings} with findings`);
    return steps.map(step => `daily:${step.id}`);
}

async function checkPanelControls() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj;
    const settings = extension._settings;
    const cases = [];
    // Remove GNOME startup notifications (notably the missing display-manager
    // warning in headless CI) so screenshots show the menus being tested.
    const tray = Main.messageTray;
    for (const source of tray.getSources()) {
        for (const notification of [...source.notifications])
            notification.destroy();
    }
    for (const notification of [...(tray._notificationQueue ?? [])])
        notification.destroy();
    if (tray._banner && tray._notification)
        tray._hideNotification(false);
    await Scripting.sleep(180);
    await Scripting.waitLeisure();
    const audioState = controller => controller.stream
        ? {volume: controller.stream.volume, muted: controller.stream.is_muted} : null;
    for (const height of [24, 48]) {
        settings.set_int('panel-height', height);
        await Scripting.sleep(300);
        await Scripting.waitLeisure();
        const screen = extension._screens[0];
        await capture(`g-os-panel-${height}-desktop.png`);
        for (const button of screen.statusButtons) {
            const controller = button.statusController;
            if (button.statusKind === 'sound') controller.syncOutput();
            const before = button.statusKind === 'sound' ? audioState(controller) : null;
            const nightLight = button.statusKind === 'brightness'
                ? new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'}) : null;
            const previousNightLight = nightLight ? nightLight.get_boolean('night-light-enabled') : null;
            const previousTemperature = nightLight ? nightLight.get_uint('night-light-temperature') : null;
            const nativeBox = controller.toggle?.menu?.box ?? controller.profiles?.menu?.box;
            const parent = nativeBox?.get_parent();
            button.statusMenu.open({animate: false});
            await Scripting.sleep(200);
            await Scripting.waitLeisure();
            const [x, y] = button.statusMenu.actor.get_transformed_position();
            const [width, extent] = button.statusMenu.actor.get_transformed_size();
            const monitor = screen.monitor;
            const rowPadding = button.statusMenu._getMenuItems()
                .filter(item => item.has_style_class_name?.('popup-menu-item') &&
                    !item.has_style_class_name('popup-separator-menu-item'))
                .map(item => ({top: item.get_theme_node().get_padding(St.Side.TOP),
                    bottom: item.get_theme_node().get_padding(St.Side.BOTTOM)}));
            const result = {height, kind: button.statusKind, bounds: [x, y, width, extent],
                mapped: button.statusMenu.actor.mapped, audioAvailable: Boolean(before), rowPadding, issues: []};
            if (button.statusKind === 'brightness' &&
                (!controller.brightnessSlider.mapped ||
                    (controller.temperatureRow.visible && !controller.temperatureSlider.mapped)))
                result.issues.push('brightness-or-enabled-night-light-slider-not-visible');
            if (nightLight) {
                try {
                    controller.temperatureSlider.value = 0.5;
                    if (nightLight.get_uint('night-light-temperature') !== 5500)
                        result.issues.push('night-light-temperature-slider-not-applied');
                    controller.nightLightToggle.setToggleState(!previousNightLight);
                    controller.nightLightToggle.emit('toggled', !previousNightLight);
                    if (nightLight.get_boolean('night-light-enabled') === previousNightLight)
                        result.issues.push('night-light-toggle-not-applied');
                } finally {
                    nightLight.set_boolean('night-light-enabled', previousNightLight);
                    nightLight.set_uint('night-light-temperature', previousTemperature);
                    nightLight.run_dispose();
                }
            }
            if (!result.mapped || x < monitor.x - 1 || y < monitor.y - 1 ||
                x + width > monitor.x + monitor.width + 1 || y + extent > monitor.y + monitor.height + 1)
                result.issues.push('popup-not-visible-or-outside-monitor');
            await capture(`panel-${height}-${button.statusKind}.png`);
            button.statusMenu.close({animate: false});
            await Scripting.sleep(100);
            if (nativeBox && nativeBox.get_parent() !== parent)
                result.issues.push('native-menu-parent-not-restored');
            if (button.statusKind === 'sound' && JSON.stringify(audioState(controller)) !== JSON.stringify(before))
                result.issues.push('audio-state-changed-by-opening-menu');
            cases.push(result);
        }
    }
    Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/panel-controls.json`).replace_contents(
        new TextEncoder().encode(JSON.stringify({cases}, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
    print(`Native panel controls: ${cases.length} popups, ${cases.filter(value => value.issues.length).length} with findings, audio=${cases.some(value => value.audioAvailable)}`);
    const previousLayout = settings.get_strv('panel-layout');
    try {
        const screen = extension._screens[0];
        const clock = screen.panelLayoutItems.get('clock');
        const leftZone = screen.panelLayoutGroups.get('left').zone;
        const pointer = global.stage.get_context().get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const [startX, startY] = clock.get_transformed_position();
        const [clockWidth, clockHeight] = clock.get_transformed_size();
        const [zoneX, zoneY] = leftZone.get_transformed_position();
        const [, zoneHeight] = leftZone.get_transformed_size();
        const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        const press = state => pointer.notify_button(GLib.get_monotonic_time(),
            Clutter.BUTTON_PRIMARY, state);
        move(startX + clockWidth / 2, startY + clockHeight / 2);
        await Scripting.sleep(60);
        move(startX + clockWidth / 2, startY + clockHeight / 2);
        await Scripting.sleep(60);
        press(Clutter.ButtonState.PRESSED);
        await Scripting.sleep(60);
        move(startX + clockWidth / 2 + 16, startY + clockHeight / 2);
        await Scripting.sleep(80);
        move(zoneX + 4, zoneY + zoneHeight / 2);
        await Scripting.sleep(120);
        press(Clutter.ButtonState.RELEASED);
        await Scripting.sleep(500);
        if (settings.get_strv('panel-layout')[0] !== 'left:clock' ||
            clock.get_parent() !== screen.panelLayoutGroups.get('left').content)
            throw new Error('Panel drag-and-drop layout was not persisted');
    } finally {
        settings.set_strv('panel-layout', previousLayout);
        await Scripting.sleep(150);
        await Scripting.waitLeisure();
    }
    print('Panel layout: drag-and-drop persisted and restored');
}

async function checkNotificationControls() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj;
    const settings = extension._settings;
    const title = 'G-Os isolated notification test';
    const previous = {position: settings.get_int('notification-position'),
        visible: settings.get_boolean('panel-show-notifications')};
    const cases = [];
    try {
        settings.set_boolean('panel-show-notifications', true);
        await Scripting.sleep(150);
        const hiddenWhenEmpty = extension._screens.every(screen => !screen.notificationButton.container.visible);
        Main.notify(title, 'Synthetic message in the isolated test session');
        let banner;
        for (let attempt = 0; attempt < 80; attempt++) {
            banner = Main.messageTray._bannerBin?.get_children?.().find(child => child.mapped);
            if (banner?.mapped) break;
            await Scripting.sleep(50);
        }
        if (!banner?.mapped)
            throw new Error(`Native notification did not appear; banner fields: ${Object.keys(Main.messageTray).filter(key => key.includes('banner')).join(', ')}`);
        for (let position = 0; position < 9; position++) {
            settings.set_int('notification-position', position);
            await Scripting.sleep(120);
            await Scripting.waitLeisure();
            cases.push({position, mapped: banner.mapped,
                bounds: [...banner.get_transformed_position(), ...banner.get_transformed_size()]});
        }
        await capture('native-notification-position.png');
        const panelControls = [];
        for (const visible of [false, true]) {
            settings.set_boolean('panel-show-notifications', visible);
            await Scripting.sleep(150);
            panelControls.push({visible, controls: extension._screens.map(screen =>
                Boolean(screen.notificationButton?.container.visible))});
        }
        const menu = extension._screens[0].notificationMenu;
        menu.open({animate: false});
        await Scripting.sleep(150);
        const listed = menu._getMenuItems().some(item => item.label?.text.startsWith(title));
        await capture('native-notification-menu.png');
        const clear = menu._getMenuItems().find(item => item.label?.text === 'Tout effacer');
        clear?.activate(null);
        await Scripting.sleep(100);
        const cleared = !Main.messageTray.getSources().some(source => source.notifications.some(value => value.title === title));
        const hiddenAfterClear = extension._screens.every(screen => !screen.notificationButton.container.visible);
        const report = {cases, panelControls,
            listed, cleared, hiddenWhenEmpty, hiddenAfterClear,
            hasPositionHandler: typeof extension._applyNotificationPosition === 'function',
            distinctPositions: new Set(cases.filter(value => value.mapped).map(value =>
                JSON.stringify(value.bounds.slice(0, 2)))).size};
        Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/notification-controls.json`).replace_contents(
            new TextEncoder().encode(JSON.stringify(report, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
        print(`Native notification controls: handler=${report.hasPositionHandler}, distinct positions=${report.distinctPositions}, panel=${JSON.stringify(panelControls)}`);
        if (!report.hasPositionHandler || report.distinctPositions !== 9 || !listed || !cleared ||
            !hiddenWhenEmpty || !hiddenAfterClear || menu.isOpen ||
            panelControls.some(state => state.controls.some(value => value !== state.visible)))
            throw new Error('Notification placement, listing, clearing or visibility did not match its setting');
    } finally {
        for (const source of Main.messageTray.getSources()) {
            for (const notification of [...source.notifications]) {
                if (notification.title === title)
                    notification.destroy();
            }
        }
        settings.set_int('notification-position', previous.position);
        settings.set_boolean('panel-show-notifications', previous.visible);
    }
}

async function checkPanelCalendar() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj;
    const settings = extension._settings;
    settings.set_boolean('panel-show-clock', true);
    await Scripting.sleep(250);
    await Scripting.waitLeisure();
    const nativeMenu = Main.panel.statusArea.dateMenu.menu;
    const nativeCalendar = Main.panel.statusArea.dateMenu._calendar;
    const nativeCalendarParent = nativeCalendar.get_parent();
    const notificationTitle = 'G-Os custom calendar isolation';
    Main.notify(notificationTitle, 'Notifications stay in their own menu');
    await Scripting.sleep(150);
    const eventId = 'g-os-isolated-calendar-event';
    const eventSummary = 'G-Os agenda verification';
    const start = new Date();
    start.setHours(13, 0, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    const labels = actor => [actor.text ?? '', ...actor.get_children().flatMap(labels)];
    const report = {screens: []};
    const pointer = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const clickClock = async screen => {
        const [x, y] = screen.clockButton.get_transformed_position();
        const [width, height] = screen.clockButton.get_transformed_size();
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
        await Scripting.sleep(100);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await Scripting.sleep(350);
        await Scripting.waitLeisure();
    };
    try {
        for (const screen of extension._screens) {
            await clickClock(screen);
            screen.calendar.setDate(start);
            screen.calendarEventSource._onEventsAddedOrUpdated(null, null, [[[eventId, eventSummary,
                start.getTime() / 1000, end.getTime() / 1000]]]);
            await Scripting.sleep(100);
            const menu = screen.calendarMenu;
            const bounds = [...menu.actor.get_transformed_position(), ...menu.actor.get_transformed_size()];
            const monitor = screen.monitor;
            const result = {opened: menu.isOpen, separateFromGnome: menu !== nativeMenu,
                calendarMapped: screen.calendar.mapped,
                notificationsAbsent: !menu.actor.get_children().some(actor => actor.has_style_class_name?.('message-list')),
                notificationPreserved: Main.messageTray.getSources().some(source =>
                    source.notifications.some(notification => notification.title === notificationTitle)),
                eventListed: labels(screen.calendarEventList).some(text => text.includes(eventSummary)), bounds,
                withinMonitor: bounds[0] >= monitor.x - 1 && bounds[1] >= monitor.y - 1 &&
                    bounds[0] + bounds[2] <= monitor.x + monitor.width + 1 &&
                    bounds[1] + bounds[3] <= monitor.y + monitor.height + 1};
            report.screens.push(result);
            await capture(`custom-calendar-event-${screen.monitor.index}.png`);
            const tomorrow = new Date(start.getTime() + 86400000);
            screen.calendar.setDate(tomorrow);
            await Scripting.sleep(100);
            result.dateNavigation = !labels(screen.calendarEventList).some(text => text.includes(eventSummary));
            menu.close();
            result.closed = !menu.isOpen;
        }
        await clickClock(extension._screens[0]);
        await Main.extensionManager.disableExtension(extensionMetadata.uuid);
        for (let attempt = 0; attempt < 80 && extension._screens.length; attempt++)
            await Scripting.sleep(50);
        report.cleanedUpOnDisable = extension._screens.length === 0 && nativeCalendar.get_parent() === nativeCalendarParent;
        Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/native-calendar.json`).replace_contents(
            new TextEncoder().encode(JSON.stringify(report, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
        if (!report.cleanedUpOnDisable || report.screens.some(result => !result.opened || !result.separateFromGnome ||
            !result.calendarMapped || !result.eventListed || !result.withinMonitor || !result.dateNavigation ||
            !result.closed || !result.notificationsAbsent || !result.notificationPreserved))
            throw new Error(`Native calendar failed: ${JSON.stringify(report)}`);
        print('Custom topbar calendar displays events, navigates dates, excludes notifications and cleans up on disable');
    } finally {
        for (const source of Main.messageTray.getSources()) {
            for (const notification of [...source.notifications]) {
                if (notification.title === notificationTitle)
                    notification.destroy();
            }
        }
    }
}

async function checkDesktopIcons() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj;
    const settings = extension._settings;
    const keys = ['desktop-icons-show-folder', 'desktop-icons-show-home', 'desktop-icons-show-removable',
        'desktop-icons-show-network', 'desktop-icons-grid-size', 'desktop-icons-size',
        'desktop-icons-alignment', 'desktop-icons-label-position',
        'desktop-icons-layout', 'dock-icons-show-home', 'dock-icons-show-removable', 'dock-icons-show-network',
        'show-dock-shortcuts'];
    const previous = new Map(keys.map(key => [key, settings.get_value(key).deep_unpack()]));
    const iconSizeOf = button => button.get_child().get_children().find(child => child instanceof St.Icon)?.icon_size;
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error('Desktop icons did not reach the expected state');
    };
    const report = {cases: []};
    try {
        settings.set_boolean('desktop-icons-show-folder', false);
        settings.set_boolean('desktop-icons-show-home', true);
        settings.set_boolean('desktop-icons-show-removable', false);
        settings.set_boolean('desktop-icons-show-network', false);
        settings.set_int('desktop-icons-grid-size', 96);
        settings.set_int('desktop-icons-size', 48);
        settings.set_int('desktop-icons-alignment', 0);
        settings.set_int('desktop-icons-label-position', 2);
        settings.set_string('desktop-icons-layout', '{}');
        await waitUntil(() => extension._desktopIconActors?.size === Main.layoutManager.monitors.length);
        let screen = Main.layoutManager.monitors[0];
        let button = extension._desktopIconActors.get(`${screen.index}:home`);
        const children = button.get_child().get_children();
        const homeIcon = children.find(child => child instanceof St.Icon);
        const homeLabel = children.find(child => child instanceof St.Label);
        await Scripting.waitLeisure();
        let result = {label: button.accessible_name, gridSize: 96, iconSize: homeIcon.icon_size,
            iconName: homeIcon.icon_name, labelTextAlign: homeLabel.clutter_text.line_alignment,
            labelYAlign: homeLabel.clutter_text.y_align,
            alignment: 0, position: button.get_position(),
            labelPosition: settings.get_int('desktop-icons-label-position'),
            children: button.get_child().get_children().map(child => child.constructor.name)};
        report.cases.push(result);
        await capture('desktop-icon-label-bottom.png');
        settings.set_int('desktop-icons-size', 88);
        settings.set_int('desktop-icons-label-position', 0);
        await waitUntil(() => {
            const current = extension._desktopIconActors.get(`${screen.index}:home`);
            return current && current !== button;
        });
        button = extension._desktopIconActors.get(`${screen.index}:home`);
        await Scripting.waitLeisure();
        const leftLabel = button.get_child().get_children().find(child => child instanceof St.Label);
        const leftIcon = button.get_child().get_children().find(child => child instanceof St.Icon);
        result = {labelPosition: settings.get_int('desktop-icons-label-position'),
            firstChildClass: button.get_child().get_first_child().get_style_class_name(),
            labelTextAlign: leftLabel.clutter_text.line_alignment, labelYAlign: leftLabel.clutter_text.y_align,
            iconYAlign: leftIcon.y_align};
        report.cases.push(result);
        leftLabel.text = 'Documents et fichiers personnels partagés';
        await Scripting.waitLeisure();
        await capture('desktop-icon-label-left.png');
        settings.set_int('desktop-icons-label-position', 1);
        await waitUntil(() => {
            const current = extension._desktopIconActors.get(`${screen.index}:home`);
            return current && current !== button;
        });
        button = extension._desktopIconActors.get(`${screen.index}:home`);
        await Scripting.waitLeisure();
        const rightLabel = button.get_child().get_children().find(child => child instanceof St.Label);
        rightLabel.text = 'Documents et fichiers personnels partagés';
        result = {labelPosition: settings.get_int('desktop-icons-label-position'),
            labelTextAlign: rightLabel.clutter_text.line_alignment};
        report.cases.push(result);
        await Scripting.waitLeisure();
        await capture('desktop-icon-label-right.png');
        const key = `${screen.connector || `monitor-${screen.index}`}|home`;
        settings.set_string('desktop-icons-layout', JSON.stringify({[key]: {x: 196, y: 170}}));
        settings.set_int('desktop-icons-grid-size', 128);
        settings.set_int('desktop-icons-alignment', 2);
        extension._syncDesktopIcons();
        await waitUntil(() => {
            const current = extension._desktopIconActors.get(`${screen.index}:home`);
            return current && current !== button;
        });
        button = extension._desktopIconActors.get(`${screen.index}:home`);
        result = {gridSize: 128, position: button.get_position(), labelPosition: 0};
        report.cases.push(result);
        const snapped = 24 + Math.round((196 - 24) / 128) * 128 === result.position[0] - screen.x &&
            48 + Math.round((170 - 48) / 128) * 128 === result.position[1] - screen.y;
        await capture('desktop-icon-grid-128.png');
        settings.set_int('desktop-icons-grid-size', 96);
        settings.set_int('desktop-icons-size', 64);
        settings.set_int('desktop-icons-alignment', 1);
        await waitUntil(() => {
            const current = extension._desktopIconActors.get(`${screen.index}:home`);
            return current && current !== button;
        });
        button = extension._desktopIconActors.get(`${screen.index}:home`);
        const rightAligned = button.get_position()[0] - screen.x === screen.width - 24 - 192 &&
            button.get_position()[1] - screen.y === 48 && iconSizeOf(button) === 64;
        const [stageX, stageY] = button.get_transformed_position();
        const [stageWidth, stageHeight] = button.get_transformed_size();
        result = {alignment: 1, iconSize: iconSizeOf(button), mapped: button.mapped,
            visible: button.visible, position: button.get_position(), stageBounds: [stageX, stageY, stageWidth, stageHeight]};
        report.cases.push(result);
        button.queue_redraw();
        button.get_child().queue_redraw();
        Main.layoutManager._backgroundGroup.queue_redraw();
        global.stage.queue_redraw();
        await Scripting.sleep(150);
        await Scripting.waitLeisure();
        await capture('desktop-icon-auto-right.png');
        settings.set_boolean('show-dock-shortcuts', false);
        await Scripting.waitLeisure();
        settings.set_boolean('dock-icons-show-home', true);
        await waitUntil(() => extension._screens[0].dock.get_children()
            .some(child => child.dockFocusKey === 'location:home'));
        const homeDockIcon = extension._screens[0].dock.get_children()
            .find(child => child.dockFocusKey === 'location:home');
        const filesDockIcon = extension._screens[0].dock.get_children()
            .find(child => child.dockFocusKey === 'shortcut:system-file-manager');
        const standaloneDockHome = {name: homeDockIcon.accessible_name, filesVisible: Boolean(filesDockIcon),
            shortcutsEnabled: settings.get_boolean('show-dock-shortcuts')};
        settings.set_boolean('dock-icons-show-home', false);
        await waitUntil(() => !extension._screens[0].dock.get_children()
            .some(child => child.dockFocusKey === 'location:home'));
        const originalDesktopFolder = extension._desktopIconFolder;
        const folderIcons = [];
        for (const [directory, expected] of [
            [GLib.UserDirectory.DIRECTORY_DOCUMENTS, 'folder-documents'],
            [GLib.UserDirectory.DIRECTORY_PICTURES, 'folder-pictures'],
            [GLib.UserDirectory.DIRECTORY_VIDEOS, 'folder-videos'],
            [GLib.UserDirectory.DIRECTORY_DOWNLOAD, 'folder-download'],
            [GLib.UserDirectory.DIRECTORY_MUSIC, 'folder-music'],
        ]) {
            const path = GLib.get_user_special_dir(directory);
            if (!path)
                continue;
            const uri = Gio.File.new_for_path(path).get_uri();
            const desktopIcon = extension._desktopFolderIconName(uri);
            const dockButton = extension._addDockFolder(extension._screens[0], uri, 48, 4);
            const dockIcon = dockButton.get_child().icon_name;
            folderIcons.push({uri, expected, desktopIcon, dockIcon});
            extension._screens[0].dock.remove_child(dockButton);
            dockButton.destroy();
            extension._screens[0].folderButtons.pop();
        }
        const desktopFolder = Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/system-desktop-folder`);
        const desktopFile = desktopFolder.get_child('Desktop grid probe.txt');
        let desktopFolderIcon;
        try {
            desktopFolder.make_directory(null);
            desktopFile.replace_contents(new TextEncoder().encode('grid probe'), null, false,
                Gio.FileCreateFlags.NONE, null);
            extension._desktopIconFolder = desktopFolder;
            settings.set_boolean('desktop-icons-show-home', false);
            settings.set_boolean('desktop-icons-show-folder', true);
            const fileId = `file:${desktopFile.get_uri()}`;
            await waitUntil(() => extension._desktopIconActors.has(`${screen.index}:${fileId}`));
            desktopFolderIcon = extension._desktopIconActors.get(`${screen.index}:${fileId}`).accessible_name;
        } finally {
            extension._desktopIconFolder = originalDesktopFolder;
            try { desktopFile.delete(null); } catch {}
            try { desktopFolder.delete(null); } catch {}
        }
        Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/desktop-icons.json`).replace_contents(
            new TextEncoder().encode(JSON.stringify({report, snapped, standaloneDockHome, desktopFolderIcon, folderIcons}, null, 2)), null, false,
            Gio.FileCreateFlags.NONE, null);
        if (report.cases[0].label !== 'Dossier personnel' || report.cases[0].iconSize !== 48 ||
            report.cases[0].iconName !== 'folder-home' ||
            report.cases[0].labelTextAlign !== Pango.Alignment.CENTER ||
            report.cases[0].labelYAlign !== Clutter.ActorAlign.CENTER ||
            report.cases[1].labelTextAlign !== Pango.Alignment.RIGHT ||
            report.cases[1].labelYAlign !== Clutter.ActorAlign.CENTER ||
            report.cases[1].iconYAlign !== Clutter.ActorAlign.CENTER ||
            report.cases[2].labelTextAlign !== Pango.Alignment.LEFT ||
            report.cases[3].gridSize !== 128 || !snapped || !rightAligned || !result.mapped || !result.visible ||
            result.stageBounds[0] < screen.x || result.stageBounds[0] + result.stageBounds[2] > screen.x + screen.width ||
            desktopFolderIcon !== 'Desktop grid probe.txt' ||
            folderIcons.some(folder => folder.desktopIcon !== folder.expected || folder.dockIcon !== folder.expected) ||
            standaloneDockHome.name !== 'Dossier personnel' || standaloneDockHome.filesVisible ||
            standaloneDockHome.shortcutsEnabled || report.cases[0].children.length !== 2 || !result.position.every(Number.isFinite))
            throw new Error(`Desktop icon grid, labels or independent Dock shortcut failed: ${JSON.stringify({report, snapped, standaloneDockHome})}`);
        print('Native desktop Home icon snaps to the configured grid and supports label placement');
    } finally {
        for (const [key, value] of previous) {
            const type = settings.get_value(key).get_type_string();
            if (type === 'b') settings.set_boolean(key, value);
            else if (type === 'i') settings.set_int(key, value);
            else settings.set_string(key, value);
        }
    }
}

async function checkDockMotionAudit() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj;
    const settings = extension._settings;
    new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean('enable-animations', true);
    settings.set_boolean('dock-autohide', false);
    settings.set_boolean('dock-hide-when-covered', false);
    settings.set_boolean('dock-window-previews', false);
    settings.set_int('icon-size', 40);
    const pointer = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    const cases = [];
    let frames = null;
    const signal = global.stage.connect('after-paint', () => frames?.push(GLib.get_monotonic_time()));
    try {
        await Scripting.sleep(2200);
        await Scripting.waitLeisure();
        for (const position of [0, 1, 2]) {
            for (const mode of [0, 1, 2, 3, 4]) {
                for (const duration of [80, 400]) {
                    move(640, 100);
                    settings.set_int('dock-position', position);
                    settings.set_int('dock-hover-animation', mode);
                    settings.set_int('dock-hover-duration', duration);
                    await Scripting.sleep(350);
                    await Scripting.waitLeisure();
                    const screen = extension._screens[0];
                    extension._revealDock(screen);
                    let button = screen.appButtons[Math.floor(screen.appButtons.length / 2)];
                    let icon = button.icon.icon;
                    let scaleActor = mode === 4 ? button : icon;
                    const appId = button.app.get_id();
                    let actorsReplaced = false;
                    const refresh = () => {
                        const current = extension._screens[0].appButtons.find(actor => actor.app.get_id() === appId);
                        if (current !== button)
                            actorsReplaced = true;
                        button = current;
                        icon = button.icon.icon;
                        scaleActor = mode === 4 ? button : icon;
                    };
                    const [x, y] = button.get_transformed_position();
                    const [width, height] = button.get_transformed_size();
                    frames = [];
                    move(x + width / 2, y + height / 2);
                    await Scripting.sleep(25);
                    refresh();
                    const entryScale = scaleActor.scale_x;
                    const entryTransition = Boolean(scaleActor.get_transition('scale-x') ||
                        scaleActor.get_transition('translation-y'));
                    await Scripting.sleep(duration * 2 + 120);
                    refresh();
                    const settledScale = scaleActor.scale_x;
                    const settledTranslation = scaleActor.translation_y;
                    const dockHoveredAtSettle = screen.dockContainer.hover;
                    const gaps = frames.slice(1).map((value, index) => (value - frames[index]) / 1000).sort((a, b) => a - b);
                    frames = null;
                    const hovered = button.hover;
                    move(640, 100);
                    await Scripting.sleep(25);
                    refresh();
                    const exitTransition = Boolean(scaleActor.get_transition('scale-x') ||
                        scaleActor.get_transition('translation-y'));
                    move(x + width / 2, y + height / 2);
                    await Scripting.sleep(duration * 2 + 120);
                    refresh();
                    const reentryScale = scaleActor.scale_x;
                    const reentryHovered = button.hover;
                    move(640, 100);
                    await Scripting.sleep(duration + 160);
                    refresh();
                    const motion = St.Settings.get();
                    const result = {position, mode, duration, actorsReplaced, hovered,
                        animationEnabled: motion.enable_animations,
                        reducedMotion: 'ReducedMotion' in St ? motion.reduced_motion ?? motion.reducedMotion : null,
                        dockHoveredAtSettle,
                        hasHoverUpdate: typeof button._dockHoverAnimationUpdate === 'function',
                        hoverState: button._dockHoverState ?? null,
                        hoverUpdates: screen.hoverAnimationUpdates.size,
                        dockHovered: extension._screens[0].dockContainer.hover,
                        entryScale, entryTransition, exitTransition, reentryScale, reentryHovered,
                        scaleActor: mode === 4 ? 'button' : 'icon',
                        settledScale, settledTranslation, exitScale: scaleActor.scale_x,
                        exitTranslation: scaleActor.translation_y,
                        frameCount: gaps.length, frameP95Ms: gaps.length ? gaps[Math.floor((gaps.length - 1) * 0.95)] : null,
                        frameMaxMs: gaps.at(-1) ?? null, issues: []};
                    if (!actorsReplaced && !hovered) result.issues.push('hover-not-reached');
                    if (!actorsReplaced && mode && settledScale <= 1.01) result.issues.push('hover-effect-missing');
                    if (!actorsReplaced && !mode && Math.abs(settledScale - 1) > 0.01) result.issues.push('disabled-effect-still-active');
                    if (!actorsReplaced && !reentryHovered) result.issues.push('rapid-reentry-not-reached');
                    if (!actorsReplaced && mode && reentryScale <= 1.01) result.issues.push('rapid-reentry-effect-missing');
                    if (!actorsReplaced && (Math.abs(result.exitScale - 1) > 0.01 || Math.abs(result.exitTranslation) > 0.5))
                        result.issues.push('hover-state-not-reset');
                    cases.push(result);
                }
            }
        }
        Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/dock-motion-audit.json`).replace_contents(
            new TextEncoder().encode(JSON.stringify(cases, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
        const findings = cases.filter(result => result.issues.length);
        print(`Dock motion audit: ${cases.length} cases, ${findings.length} with findings`);
        if (findings.length)
            throw new Error(`Dock motion audit found ${findings.length} failing cases`);
    } finally {
        global.stage.disconnect(signal);
    }
}

async function checkDockAppearance() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj;
    const settings = extension._settings;
    const screen = extension._screens[0];
    if (!screen?.dock || !screen.magnificationBackground)
        throw new Error('Dock appearance actors are unavailable');

    const report = {appearanceCases: [], metricsCases: []};
    const backgroundClasses = ['', 'g-os-dock-background-subtle', 'g-os-dock-background-opaque',
        'g-os-dock-background-transparent'];
    const record = (area, result) => report[area].push(result);
    for (const radius of [0, 12, 28, 48]) {
        for (const background of [0, 1, 2, 3]) {
            for (const border of [false, true]) {
                for (const shadow of [false, true]) {
                    settings.set_int('dock-border-radius', radius);
                    settings.set_int('dock-background-style', background);
                    settings.set_boolean('dock-show-border', border);
                    settings.set_boolean('dock-show-shadow', shadow);
                    await Scripting.waitLeisure();
                    const expectedRadius = `g-os-dock-radius-${radius}`;
                    const result = {radius, background, border, shadow, issues: []};
                    const hasClass = (actor, name) => actor.has_style_class_name(name);
                    if (!hasClass(screen.dock, expectedRadius) ||
                        !hasClass(screen.magnificationBackground, expectedRadius))
                        result.issues.push('radius-class-not-synchronized');
                    if (screen.dockRadiusClass !== expectedRadius)
                        result.issues.push('radius-state-out-of-sync');
                    if (screen.dockBackgroundStyleClass !== backgroundClasses[background] ||
                        (backgroundClasses[background] &&
                            !hasClass(screen.magnificationBackground, backgroundClasses[background])))
                        result.issues.push('background-style-not-applied');
                    if (hasClass(screen.magnificationBackground, 'g-os-dock-no-border') === border)
                        result.issues.push('border-visibility-not-applied');
                    if (hasClass(screen.magnificationBackground, 'g-os-dock-no-shadow') === shadow)
                        result.issues.push('shadow-visibility-not-applied');
                    record('appearanceCases', result);
                }
            }
        }
    }

    for (const position of [0, 1, 2]) {
        for (const animation of [0, 4]) {
            settings.set_int('dock-position', position);
            settings.set_int('dock-hover-animation', animation);
            settings.set_int('icon-size', 40);
            settings.set_int('dock-icon-padding', 4);
            settings.set_int('dock-padding-horizontal', 9);
            settings.set_int('dock-padding-top', 6);
            settings.set_int('dock-padding-bottom', 6);
            settings.set_int('dock-item-spacing', 8);
            await Scripting.sleep(350);
            await Scripting.waitLeisure();
            const current = extension._screens[0];
            const magnified = animation === 4;
            const padding = Math.ceil((40 + 4 * 2) * Math.max(0.8, settings.get_int('dock-magnify-max') / 100 - 1));
            const axisPadding = Math.ceil(40 * 0.8) * 3;
            const expectedTop = 6 + (magnified ? position === 0 ? padding : axisPadding : 0);
            const expectedBottom = 6 + (magnified && position !== 0 ? axisPadding : 0);
            const expectedLeft = 9 + (magnified ? position === 0 ? axisPadding : position === 2 ? padding : 0 : 0);
            const expectedRight = 9 + (magnified ? position === 0 ? axisPadding : position === 1 ? padding : 0 : 0);
            const style = current.dock.get_style();
            const result = {position, animation, style, issues: []};
            const expectedPadding = `padding: ${expectedTop}px ${expectedRight}px ${expectedBottom}px ${expectedLeft}px;`;
            if (!style.includes(expectedPadding))
                result.issues.push(`dock-padding-mismatch-${expectedPadding}`);
            if (!style.includes('spacing: 8px;'))
                result.issues.push('dock-item-spacing-not-applied');
            record('metricsCases', result);
        }
    }

    Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/dock-appearance.json`).replace_contents(
        new TextEncoder().encode(JSON.stringify(report, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
    const findings = [...report.appearanceCases, ...report.metricsCases].filter(result => result.issues.length);
    print(`Dock appearance audit: ${report.appearanceCases.length + report.metricsCases.length} cases, ` +
        `${findings.length} with findings`);
    if (findings.length)
        throw new Error(`Dock appearance audit found ${findings.length} failing cases`);
}

async function checkDesktopLayoutAudit() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj;
    const settings = extension._settings;
    for (const category of ['folder', 'home', 'removable', 'network'])
        settings.set_boolean(`desktop-icons-show-${category}`, false);
    settings.set_int('desktop-icons-size', 48);
    await Scripting.sleep(150);
    const monitor = Main.layoutManager.monitors[0];
    const cases = [];
    for (const [cell, iconSize] of [[64, 24], [64, 48], [64, 96], [96, 24], [96, 48], [96, 96],
        [256, 24], [256, 48], [256, 96]]) {
        settings.set_int('desktop-icons-size', iconSize);
        for (const labelPosition of [0, 1, 2]) {
            for (const alignment of [0, 1, 2]) {
                settings.set_int('desktop-icons-grid-size', cell);
                settings.set_int('desktop-icons-label-position', labelPosition);
                settings.set_int('desktop-icons-alignment', alignment);
                await Scripting.sleep(80);
                extension._destroyDesktopIconActors();
                for (let index = 0; index < 20; index++)
                    extension._createDesktopIcon({id: `audit:${index}`, category: 'folder',
                        name: `Document ${index + 1}`, uri: `file:///tmp/g-os-layout-audit-${index}`,
                        iconName: 'folder', isDirectory: true}, monitor, index, {});
                await Scripting.sleep(100);
                await Scripting.waitLeisure();
                const actors = [...extension._desktopIconActors.values()];
                const geometry = actors.map(actor => ({position: actor.get_position(), size: actor.get_transformed_size()}));
                const seen = new Map();
                const duplicates = [];
                geometry.forEach((value, index) => {
                    const key = value.position.join(',');
                    if (seen.has(key)) duplicates.push([seen.get(key), index]);
                    else seen.set(key, index);
                });
                const first = geometry[0];
                const marginRight = monitor.x + monitor.width - first.position[0] - first.size[0];
                const view = extension._desktopIconViews?.get(monitor.index);
                const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
                const viewport = view?.scroll ?? Main.layoutManager._backgroundGroup;
                const [viewX, viewY] = viewport.get_transformed_position();
                const [viewWidth, viewHeight] = viewport.get_transformed_size();
                const outsideWorkarea = view ? Number(viewX < area.x || viewY < area.y ||
                    viewX + viewWidth > area.x + area.width + 1 || viewY + viewHeight > area.y + area.height + 1) :
                    geometry.filter(value => value.position[1] + value.size[1] > area.height).length;
                const overflowingChildren = actors.flatMap((actor, index) => {
                    const [x, y] = actor.get_transformed_position();
                    const [width, height] = actor.get_transformed_size();
                    return actor.get_child().get_children().filter(child => child.visible && child.mapped)
                        .filter(child => {
                            const [childX, childY] = child.get_transformed_position();
                            const [childWidth, childHeight] = child.get_transformed_size();
                            return childX < x - 1 || childY < y - 1 || childX + childWidth > x + width + 1 ||
                                childY + childHeight > y + height + 1;
                        }).map(child => ({index, type: child.constructor.name,
                            bounds: [...child.get_transformed_position(), ...child.get_transformed_size()]}));
                });
                const result = {cell, iconSize, labelPosition, alignment, icons: actors.length, marginRight,
                    duplicates, outsideWorkarea, overflowingChildren, geometry, issues: []};
                if (duplicates.length) result.issues.push('icons-share-same-position');
                if (alignment === 1 && Math.abs(marginRight - 24) > 1)
                    result.issues.push('right-alignment-inconsistent-margin');
                if (outsideWorkarea) result.issues.push('icons-outside-workarea');
                if (overflowingChildren.length) result.issues.push('icon-content-outside-cell');
                cases.push(result);
                if (cell === 256 && labelPosition === 0 && alignment === 0)
                    await capture('desktop-grid-overlapping-icons.png');
                if (cell === 256 && labelPosition === 2 && alignment === 1)
                    await capture('desktop-grid-right-margin.png');
                if (overflowingChildren.length && labelPosition === 2 && alignment === 0)
                    await capture(`desktop-content-overflow-${cell}-${iconSize}.png`);
                if (view && duplicates.length === 0 && cell === 256) {
                    const adjustment = view.scroll.vadjustment;
                    adjustment.value = adjustment.upper - adjustment.page_size;
                    await Scripting.sleep(60);
                    const last = actors.at(-1);
                    const [lastX, lastY] = last.get_transformed_position();
                    const [lastWidth, lastHeight] = last.get_transformed_size();
                    result.lastIconReachable = lastX >= viewX - 1 && lastY >= viewY - 1 &&
                        lastX + lastWidth <= viewX + viewWidth + 1 && lastY + lastHeight <= viewY + viewHeight + 1;
                    if (!result.lastIconReachable)
                        result.issues.push('last-icon-not-reachable-by-scroll');
                }
            }
        }
    }
    Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/desktop-layout-audit.json`).replace_contents(
        new TextEncoder().encode(JSON.stringify(cases, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
    print(`Desktop layout audit: ${cases.length} configurations, ${cases.filter(result => result.issues.length).length} with findings`);
}

async function checkDesktopInteractions() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj;
    const settings = extension._settings;
    const root = Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/desktop-interactions-fixture`);
    root.make_directory(null);
    const first = root.get_child('A document.txt');
    const second = root.get_child('B document.txt');
    const folder = root.get_child('C folder');
    const nested = folder.get_child('nested.txt');
    first.replace_contents(new TextEncoder().encode('first'), null, false, Gio.FileCreateFlags.NONE, null);
    second.replace_contents(new TextEncoder().encode('second'), null, false, Gio.FileCreateFlags.NONE, null);
    folder.make_directory(null);
    nested.replace_contents(new TextEncoder().encode('nested'), null, false, Gio.FileCreateFlags.NONE, null);
    const originalFolder = extension._desktopIconFolder;
    const originalOpen = extension._openDesktopIcon;
    const opened = [];
    extension._openDesktopIcon = item => opened.push(item.uri);
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error('Desktop interaction state timed out');
    };
    const pointer = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const keyboard = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    const press = (button, state) => pointer.notify_button(GLib.get_monotonic_time(), button, state);
    const clickAt = async (x, y, mouseButton = Clutter.BUTTON_PRIMARY) => {
        move(x, y);
        await Scripting.sleep(50);
        press(mouseButton, Clutter.ButtonState.PRESSED);
        press(mouseButton, Clutter.ButtonState.RELEASED);
        await Scripting.sleep(80);
    };
    const actorFor = file => [...extension._desktopIconActors.values()]
        .find(actor => actor.desktopItem.uri === file.get_uri());
    const click = async (file, mouseButton = Clutter.BUTTON_PRIMARY) => {
        const actor = actorFor(file);
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        await clickAt(x + width / 2, y + height / 2, mouseButton);
    };
    const menuLabels = () => extension._desktopIconContextMenu._getMenuItems()
        .map(item => item.label?.text).filter(Boolean);
    const report = {};
    try {
        extension._desktopIconFolder = root;
        settings.set_boolean('desktop-icons-show-home', false);
        settings.set_boolean('desktop-icons-show-removable', false);
        settings.set_boolean('desktop-icons-show-network', false);
        settings.set_boolean('desktop-icons-show-folder', true);
        settings.set_int('desktop-icons-alignment', 0);
        settings.set_int('desktop-icons-label-position', 2);
        settings.set_int('desktop-icons-grid-size', 96);
        extension._syncDesktopIcons();
        await waitUntil(() => actorFor(first) && actorFor(second) && actorFor(folder));
        await Scripting.waitLeisure();
        await click(first);
        await Scripting.sleep(global.stage.get_context().get_settings().double_click_time + 50);
        report.singleClickSelects = opened.length === 0 && extension._desktopIconSelection.size === 1;
        print(`Desktop interaction: single click=${report.singleClickSelects}`);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        await Scripting.sleep(50);
        await click(second);
        report.controlAdds = extension._desktopIconSelection.size === 2;
        await click(first);
        report.controlRemoves = extension._desktopIconSelection.size === 1 &&
            extension._desktopIconSelection.has(actorFor(second).desktopItem.id);
        print(`Desktop interaction: Ctrl add=${report.controlAdds}, remove=${report.controlRemoves}`);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        await Scripting.sleep(50);
        await click(first);
        await click(first);
        report.doubleClickOpensOnce = opened.length === 1 && opened[0] === first.get_uri();
        print(`Desktop interaction: double click=${report.doubleClickOpensOnce}`);
        await click(first, Clutter.BUTTON_SECONDARY);
        await waitUntil(() => extension._desktopIconContextMenu?.isOpen);
        report.fileMenu = menuLabels();
        extension._closeDesktopIconMenu();
        await click(folder, Clutter.BUTTON_SECONDARY);
        await waitUntil(() => extension._desktopIconContextMenu?.isOpen);
        report.folderMenu = menuLabels();
        print(`Desktop interaction: menus=${JSON.stringify(report.folderMenu)}`);
        await capture('desktop-file-context-menu.png');
        extension._closeDesktopIconMenu();
        const monitor = Main.layoutManager.monitors[0];
        move(monitor.x + 18, monitor.y + 40);
        press(Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        await Scripting.sleep(80);
        move(monitor.x + 130, monitor.y + 235);
        await Scripting.sleep(100);
        await capture('desktop-rubber-band-selection.png');
        press(Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await Scripting.sleep(100);
        report.rectangleSelects = extension._desktopIconSelection.size === 2;
        report.rectangleRemoved = !extension._desktopIconRubberBand;
        print(`Desktop interaction: rectangle=${report.rectangleSelects}, removed=${report.rectangleRemoved}`);
        extension._openDesktopIconMenu(actorFor(first));
        await Scripting.waitLeisure();
        report.multipleMenu = menuLabels();
        extension._closeDesktopIconMenu();
        extension._copyDesktopItems([{uri: first.get_uri()}], false);
        await extension._pasteDesktopItems(folder.get_uri());
        report.fileCopied = folder.get_child(first.get_basename()).query_exists(null);
        print(`Desktop interaction: file copied=${report.fileCopied}`);
        const destination = root.get_child('destination');
        destination.make_directory(null);
        extension._copyDesktopItems([{uri: folder.get_uri()}], false);
        await extension._pasteDesktopItems(destination.get_uri());
        report.folderCopied = destination.get_child(folder.get_basename()).get_child('nested.txt').query_exists(null);
        print(`Desktop interaction: folder copied=${report.folderCopied}`);
        const movable = root.get_child('move-test.txt');
        movable.replace_contents(new TextEncoder().encode('move only within the test fixture'), null, false,
            Gio.FileCreateFlags.NONE, null);
        extension._copyDesktopItems([{uri: movable.get_uri()}], true);
        await extension._pasteDesktopItems(destination.get_uri());
        report.fileMoved = !movable.query_exists(null) && destination.get_child('move-test.txt').query_exists(null);
        extension._newDesktopFolder(root.get_uri());
        let dialog = extension._desktopIconRenameDialog;
        let entry = dialog.contentLayout.get_children().find(actor => actor instanceof St.Entry);
        entry.set_text('Created folder');
        entry.clutter_text.emit('activate');
        await waitUntil(() => root.get_child('Created folder').query_exists(null));
        report.folderCreated = true;
        await waitUntil(() => actorFor(second));
        extension._renameDesktopItem(actorFor(second));
        dialog = extension._desktopIconRenameDialog;
        entry = dialog.contentLayout.get_children().find(actor => actor instanceof St.Entry);
        entry.set_text('B renamed.txt');
        entry.clutter_text.emit('activate');
        await waitUntil(() => root.get_child('B renamed.txt').query_exists(null));
        await waitUntil(() => extension._desktopIconRenameDialog === null);
        report.renamed = !second.query_exists(null);
        const backgroundMenu = Main.layoutManager._bgManagers[0].backgroundActor._backgroundMenu;
        await waitUntil(() => extension._desktopIconViews.get(monitor.index));
        const view = extension._desktopIconViews.get(monitor.index);
        const backgroundPoints = Array.from({length: 16}, (_, index) => {
            const column = index % 4;
            const row = Math.floor(index / 4);
            return [monitor.x + monitor.width * (column + 1) / 5,
                monitor.y + monitor.height * (row + 1) / 5];
        }).map(([x, y]) => {
            const actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
            return {point: [x, y], actor, type: actor?.constructor.name,
                parent: actor?.get_parent()?.constructor.name,
                selected: actor === view.scroll || actor === view.content};
        });
        const backgroundPoint = backgroundPoints.find(item => item.selected)?.point;
        if (!backgroundPoint)
            throw new Error(`No unobstructed desktop background point was found: ${JSON.stringify(
                backgroundPoints.map(({point, type, parent}) => ({point, type, parent})))}`);
        await clickAt(...backgroundPoint, Clutter.BUTTON_SECONDARY);
        await waitUntil(() => backgroundMenu.isOpen);
        report.backgroundOpensByPointer = backgroundMenu.isOpen;
        backgroundMenu.close(0);
        report.backgroundActions = backgroundMenu._getMenuItems().map(item => item.label?.text).filter(Boolean);
        Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/desktop-interactions.json`).replace_contents(
            new TextEncoder().encode(JSON.stringify(report, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
        const checks = [
            report.singleClickSelects,
            report.controlAdds,
            report.controlRemoves,
            report.doubleClickOpensOnce,
            report.rectangleSelects,
            report.rectangleRemoved,
            report.fileCopied,
            report.folderCopied,
            report.renamed,
            report.fileMoved,
            report.folderCreated,
            report.backgroundOpensByPointer,
            report.multipleMenu.includes('Ouvrir les éléments sélectionnés') &&
                !report.multipleMenu.includes('Renommer…'),
            report.backgroundActions.includes('Tout sélectionner'),
            report.fileMenu.includes('Renommer…') && report.fileMenu.includes('Propriétés'),
            report.folderMenu.includes('Coller'),
        ];
        const findings = checks.filter(passed => !passed).length;
        print(`Desktop interaction audit: ${checks.length} checks, ${findings} with findings`);
        if (findings)
            throw new Error(`Desktop interactions failed: ${JSON.stringify(report)}`);
        print('Native desktop double-click, Ctrl selection, rectangle, file menus, copy and rename pass');
    } finally {
        extension._desktopIconFolder = originalFolder;
        extension._openDesktopIcon = originalOpen;
        extension._closeDesktopIconMenu();
        extension._desktopIconRenameDialog?.close();
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        const remove = file => {
            const info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                const enumerator = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
                try {
                    let child;
                    while ((child = enumerator.next_file(null)))
                        remove(file.get_child(child.get_name()));
                } finally { enumerator.close(null); }
            }
            file.delete(null);
        };
        remove(root);
    }
}

async function checkSearchShortcuts() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj;
    const settings = extension._settings;
    const previous = {enabled: settings.get_boolean('enable-spotlight'), keys: settings.get_strv('spotlight-search')};
    const nativeSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
    const nativeInputKeys = nativeSettings.get_strv('switch-input-source');
    const clearConflict = GLib.getenv('G_OS_AUDIT_SEARCH_NO_CONFLICT') === '1';
    if (clearConflict)
        nativeSettings.set_strv('switch-input-source', []);
    const keyboard = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const key = (symbol, pressed) => keyboard.notify_keyval(GLib.get_monotonic_time(), symbol,
        pressed ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED);
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error('Search shortcut state timed out');
    };
    const cases = [];
    const trigger = modifiers => {
        for (const modifier of modifiers) key(modifier, true);
        key(Clutter.KEY_space, true);
        key(Clutter.KEY_space, false);
        for (const modifier of [...modifiers].reverse()) key(modifier, false);
    };
    try {
        for (const [accelerator, requestedModifiers] of [
            ['<Super>space', [Clutter.KEY_Super_L]],
            ['<Control><Alt>space', [Clutter.KEY_Control_L, Clutter.KEY_Alt_L]],
        ]) {
            settings.set_strv('spotlight-search', [accelerator]);
            settings.set_boolean('enable-spotlight', true);
            Main.overview.hide();
            await Scripting.sleep(350);
            await Scripting.waitLeisure();
            const registered = extension._searchBinding;
            const effective = extension._searchFallbackSettings?.get_strv('spotlight-search')[0] ?? accelerator;
            const modifiers = effective === '<Control><Alt>space' ? [Clutter.KEY_Control_L, Clutter.KEY_Alt_L]
                : effective === '<Super><Control>space' ? [Clutter.KEY_Super_L, Clutter.KEY_Control_L] : requestedModifiers;
            trigger(modifiers);
            await Scripting.sleep(500);
            const focus = global.stage.get_key_focus();
            const focusPath = [];
            for (let actor = focus; actor && focusPath.length < 8; actor = actor.get_parent())
                focusPath.push({type: actor.constructor.name, style: actor.get_style_class_name?.() ?? ''});
            const result = {accelerator, effective, registered, nativeInputKeys, clearConflict, overviewOpened: Main.overview.visible,
                searchFocused: Boolean(Main.overview.searchEntry?.contains(focus)) ||
                    focusPath.some(actor => actor.style.split(' ').includes('search-entry')), focusPath, issues: []};
            if (!registered) result.issues.push('binding-not-registered');
            const entry = findActor(Main.layoutManager.uiGroup, actor => actor.has_style_class_name?.('search-entry'));
            const beforeTyping = entry?.get_text?.() ?? '';
            key(Clutter.KEY_a, true);
            key(Clutter.KEY_a, false);
            await Scripting.sleep(200);
            result.textAfterTyping = entry?.get_text?.() ?? null;
            result.typingWorks = result.textAfterTyping !== null && result.textAfterTyping.length > beforeTyping.length;
            if (!result.overviewOpened || !result.typingWorks) result.issues.push('search-not-usable');
            Main.overview.hide();
            await waitUntil(() => !Main.overview.visible);
            settings.set_boolean('enable-spotlight', false);
            await waitUntil(() => !extension._searchBinding);
            result.disabledBinding = extension._searchBinding;
            result.overviewClosedBeforeDisabledTrigger = !Main.overview.visible;
            trigger(modifiers);
            await Scripting.sleep(350);
            result.disabledOpenedOverview = !result.overviewClosedBeforeDisabledTrigger || Main.overview.visible;
            if (result.disabledOpenedOverview) result.issues.push('disabled-binding-still-active');
            cases.push(result);
        }
        if (JSON.stringify(nativeSettings.get_strv('switch-input-source')) !== JSON.stringify(clearConflict ? [] : nativeInputKeys))
            throw new Error('Search binding changed the native language shortcut');
        Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/search-shortcuts.json`).replace_contents(
            new TextEncoder().encode(JSON.stringify({cases}, null, 2)),
            null, false, Gio.FileCreateFlags.NONE, null);
        print(`Native search shortcuts: ${JSON.stringify(cases)}`);
        if (cases.some(result => result.issues.length))
            throw new Error('Search shortcut regression: see search-shortcuts.json');
    } finally {
        for (const modifier of [Clutter.KEY_Super_L, Clutter.KEY_Control_L, Clutter.KEY_Alt_L]) key(modifier, false);
        Main.overview.hide();
        settings.set_strv('spotlight-search', previous.keys);
        settings.set_boolean('enable-spotlight', previous.enabled);
        if (clearConflict)
            nativeSettings.set_strv('switch-input-source', nativeInputKeys);
    }
}

async function checkStateStress() {
    const uuid = extensionMetadata.uuid;
    let extension = Main.extensionManager.lookup(uuid).stateObj;
    const settings = extension._settings;
    const cases = [];
    const measuredExtension = extension;
    const originalApply = extension._applySettings;
    const rebuildTimes = [];
    const applyDetails = [];
    measuredExtension._applySettings = (...args) => {
        const panels = measuredExtension._screens.map(screen => screen.panel);
        const start = GLib.get_monotonic_time();
        const result = originalApply.apply(measuredExtension, args);
        rebuildTimes.push((GLib.get_monotonic_time() - start) / 1000);
        applyDetails.push({keys: [...(args[0] ?? [])], panelsPreserved: panels.every((panel, index) =>
            panel === measuredExtension._screens[index]?.panel), durationMs: rebuildTimes.at(-1)});
        return result;
    };
    const process = Gio.Subprocess.new(['gjs', '-c', `
        imports.gi.versions.Gtk = '3.0';
        const Gtk = imports.gi.Gtk;
        const app = new Gtk.Application({application_id: 'org.gos.StateStressTest'});
        app.connect('activate', () => {
            const window = new Gtk.ApplicationWindow({application: app, title: 'G-Os state stress window',
                default_width: 400, default_height: 240});
            window.add(new Gtk.Label({label: 'Isolated state transitions'}));
            window.show_all(); window.present();
        });
        app.run([]);
    `], Gio.SubprocessFlags.NONE);
    try {
        for (let attempt = 0; attempt < 100 && !global.get_window_actors().some(actor =>
            actor.meta_window.get_title() === 'G-Os state stress window'); attempt++)
            await Scripting.sleep(50);
        for (const position of [0, 1, 2]) {
            for (const height of [24, 48]) {
                for (const size of [24, 64]) {
                    for (const animation of [0, 4]) {
                        const showDock = cases.length % 5 !== 0;
                        const firstRebuild = rebuildTimes.length;
                        const updateStart = GLib.get_monotonic_time();
                        const settingTimes = [];
                        for (const [key, method, value] of [
                            ['dock-position', 'set_int', position],
                            ['panel-height', 'set_int', height],
                            ['icon-size', 'set_int', size],
                            ['dock-hover-animation', 'set_int', animation],
                            ['show-dock', 'set_boolean', showDock],
                            ['show-active-app', 'set_boolean', cases.length % 2 === 0],
                            ['global-menu-enabled', 'set_boolean', cases.length % 3 === 0],
                        ]) {
                            const changed = settings.get_value(key).deep_unpack() !== value;
                            const start = GLib.get_monotonic_time();
                            settings[method](key, value);
                            settingTimes.push({key, changed, durationMs: (GLib.get_monotonic_time() - start) / 1000});
                        }
                        const settingsBlockMs = (GLib.get_monotonic_time() - updateStart) / 1000;
                        await Scripting.sleep(180);
                        await Scripting.waitLeisure();
                        const screen = extension._screens[0];
                        const result = {position, height, size, animation, showDock, settingsBlockMs, settingTimes,
                            rebuildTimes: rebuildTimes.slice(firstRebuild), applyDetails: applyDetails.slice(firstRebuild), issues: []};
                        cases.push(result);
                        const panels = Main.layoutManager.uiGroup.get_children().filter(actor =>
                            actor.has_style_class_name?.('g-os-secondary-panel'));
                        if (panels.length !== extension._screens.length)
                            result.issues.push('panel-actor-count');
                        if (!screen.appLabel?.clutter_text || !screen.appMenuButton.contains(screen.appLabel))
                            result.issues.push('destroyed-or-detached-title');
                        if (Math.abs(screen.panel.height - height) > 1)
                            result.issues.push('panel-height');
                        if (Boolean(screen.dockContainer) !== showDock)
                            result.issues.push('dock-visibility-setting');
                        if (screen.dockContainer) {
                            const [x, y] = screen.dockContainer.get_transformed_position();
                            const [width, extent] = screen.dockContainer.get_transformed_size();
                            const monitor = screen.monitor;
                            if (![x, y, width, extent].every(Number.isFinite) ||
                                x < monitor.x - 1 || y < monitor.y - 1 ||
                                x + width > monitor.x + monitor.width + 1 ||
                                y + extent > monitor.y + monitor.height + 1)
                                result.issues.push('dock-outside-monitor');
                        }
                    }
                }
            }
        }
        settings.set_boolean('show-dock', true);
        settings.set_int('dock-hover-animation', 1);
        await Scripting.sleep(250);
        await Scripting.waitLeisure();
        const liveCases = [];
        for (let index = 0; index < 12; index++) {
            const buttons = extension._screens.map(screen => [...screen.appButtons]);
            const firstApply = rebuildTimes.length;
            settings.set_int('dock-hover-duration', index % 2 ? 80 : 400);
            settings.set_int('dock-hover-strength', index % 2 ? 100 : 150);
            await Scripting.sleep(80);
            await Scripting.waitLeisure();
            liveCases.push({applyTimes: rebuildTimes.slice(firstApply),
                buttonsPreserved: buttons.every((items, screenIndex) => items.every((button, itemIndex) =>
                    button === extension._screens[screenIndex]?.appButtons[itemIndex]))});
        }
        if (extension._applyLiveSettings && liveCases.some(result => !result.buttonsPreserved))
            throw new Error('Hover parameters unnecessarily replaced Dock buttons');
        const cycles = [];
        measuredExtension._applySettings = originalApply;
        for (let cycle = 0; cycle < 3; cycle++) {
            Main.extensionManager.disableExtension(uuid);
            await Scripting.sleep(200);
            const remainingPanels = Main.layoutManager.uiGroup.get_children().filter(actor =>
                actor.has_style_class_name?.('g-os-secondary-panel')).length;
            Main.extensionManager.enableExtension(uuid);
            for (let attempt = 0; attempt < 100 && !Main.extensionManager.lookup(uuid)?.stateObj?._screens?.[0]?.sessionButton; attempt++)
                await Scripting.sleep(50);
            extension = Main.extensionManager.lookup(uuid).stateObj;
            await Scripting.sleep(200);
            cycles.push({cycle, remainingPanels,
                titleValid: Boolean(extension._screens[0]?.appLabel?.clutter_text)});
        }
        Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/state-stress.json`).replace_contents(
            new TextEncoder().encode(JSON.stringify({cases, liveCases, cycles}, null, 2)),
            null, false, Gio.FileCreateFlags.NONE, null);
        print(`Native state stress: ${cases.length} configurations, ${cases.filter(value => value.issues.length).length} with findings, cycles=${JSON.stringify(cycles)}`);
    } finally {
        measuredExtension._applySettings = originalApply;
        if (Main.extensionManager.lookup(uuid)?.stateObj?._screens?.length)
            Main.extensionManager.disableExtension(uuid);
        process.force_exit();
    }
}

async function checkDockRebuildProfile() {
    const uuid = extensionMetadata.uuid;
    const extension = Main.extensionManager.lookup(uuid)?.stateObj;
    const outputDir = GLib.getenv('MACOS_VISUAL_OUTPUT');
    if (!extension?._screens?.length || !outputDir)
        throw new Error('Dock rebuild profiling requires an enabled extension and output directory');
    const settings = extension._settings;
    const favoriteIds = extension._favorites.getFavorites().slice(0, 2).map(app => app.get_id());
    if (favoriteIds.length < 2)
        throw new Error('Dock rebuild profiling needs two favorite applications');
    const previousSettings = {
        dockFolders: settings.get_strv('dock-folders'),
        appFolders: settings.get_string('dock-app-folders'),
        widgetsManaged: settings.get_boolean('widgets-managed'),
        widgetInstances: settings.get_string('widget-instances'),
        clock: settings.get_boolean('dock-widget-clock'),
        calendar: settings.get_boolean('dock-widget-calendar'),
        media: settings.get_boolean('dock-widget-media'),
    };
    const folderUri = Gio.File.new_for_path(GLib.get_home_dir()).get_uri();

    const phaseTargets = [
        ['focusCapture', extension, '_captureDockFocus'],
        ['workspaceSync', extension, '_syncWorkspaceSignals'],
        ['runningAppSync', extension, '_syncRunningAppSignals'],
        ['appDescription', extension, '_appDescription'],
        ['badgePosition', extension, '_positionNotificationBadge'],
        ['transferPosition', extension, '_positionTransferProgress'],
        ['shortcutCreation', extension, '_addDockShortcut'],
        ['tooltipSetup', extension, '_attachTooltip'],
        ['locations', extension, '_appendDockLocationShortcuts'],
        ['dockFolders', extension, '_addDockFolder'],
        ['appFolders', extension, '_addDockAppFolder'],
        ['widgets', extension._widgetRuntime, 'makeDock'],
        ['ordering', extension, '_configureDockOrder'],
        ['magnification', extension, '_configureDockMagnification'],
        ['positioning', extension, '_positionDock'],
        ['iconGeometry', extension, '_updateDockIconGeometries'],
        ['activeApp', extension, '_updateActiveApp'],
        ['notifications', extension, '_updateNotificationCounts'],
        ['transfers', extension, '_updateTransferIndicators'],
        ['trash', extension, '_updateTrashButtons'],
        ['attention', extension, '_updateAttentionIndicators'],
        ['focusRestore', extension, '_restoreDockFocus'],
    ];
    const originals = [];
    const profiles = [];
    let activePhaseTimes = null;
    const dockActorTargets = () => extension._screens.flatMap(screen => [
        ['dockChildAdds', screen.dock, 'add_child'],
        ['dockChildRemovals', screen.dock, 'remove_child'],
        ['dockClear', screen.dock, 'destroy_all_children'],
    ]);
    const installTargets = targets => {
        for (const [phase, target, method] of targets) {
            if (originals.some(entry => entry.target === target && entry.method === method))
                continue;
            const original = target?.[method];
            if (typeof original !== 'function')
                throw new Error(`Missing Dock profiling target: ${method}`);
            const hadOwn = Object.hasOwn(target, method);
            originals.push({target, method, original, hadOwn});
            if (!phaseTargets.some(([, candidate, name]) => candidate === target && name === method))
                phaseTargets.push([phase, target, method]);
            target[method] = function (...args) {
                const start = GLib.get_monotonic_time();
                try {
                    return original.apply(this, args);
                } finally {
                    activePhaseTimes?.[phase].push((GLib.get_monotonic_time() - start) / 1000);
                }
            };
        }
    };

    try {
        installTargets([...phaseTargets, ...dockActorTargets()]);

        const measure = async label => {
            const samples = [];
            for (let iteration = 0; iteration < 3; iteration++) {
                await Scripting.waitLeisure();
                const phaseTimes = Object.fromEntries([...new Set(phaseTargets.map(([phase]) => phase))]
                    .map(phase => [phase, []]));
                activePhaseTimes = phaseTimes;
                const start = GLib.get_monotonic_time();
                extension._rebuildDock();
                const totalMs = (GLib.get_monotonic_time() - start) / 1000;
                activePhaseTimes = null;
                if (!extension._screens.some(screen => screen.dock.get_children().length))
                    throw new Error(`Dock rebuild left no children during ${label}`);

                const phases = Object.fromEntries(Object.entries(phaseTimes).map(([phase, times]) => [phase, {
                    calls: times.length,
                    totalMs: times.reduce((sum, value) => sum + value, 0),
                    maxMs: times.length ? Math.max(...times) : 0,
                }]));
                samples.push({iteration, totalMs, phases});
            }
            profiles.push({label, screens: extension._screens.map(screen => ({
                apps: screen.appButtons?.length ?? 0,
                dockFolders: screen.folderButtons?.filter(button => button.folderUri).length ?? 0,
                appFolders: screen.dock?.get_children().filter(button => button.appFolderId).length ?? 0,
                widgets: screen.dock?.get_children().filter(button => button.dockWidgetType).length ?? 0,
                children: screen.dock?.get_children().length ?? 0,
            })), samples});
        };

        await measure('default');
        settings.set_strv('dock-folders', [folderUri]);
        settings.set_string('dock-app-folders', JSON.stringify([
            {id: 'profile_apps', name: 'Profilage', apps: favoriteIds, icon: '', view: -1},
        ]));
        settings.set_boolean('widgets-managed', false);
        settings.set_string('widget-instances', '[]');
        settings.set_boolean('dock-widget-clock', true);
        settings.set_boolean('dock-widget-calendar', true);
        settings.set_boolean('dock-widget-media', true);
        await Scripting.sleep(200);
        await Scripting.waitLeisure();
        installTargets(dockActorTargets());

        const screen = extension._screens[0];
        const fixture = {
            dockFolders: screen.folderButtons?.filter(button => button.folderUri).length ?? 0,
            appFolders: screen.dock?.get_children().filter(button => button.appFolderId).length ?? 0,
            widgets: screen.dock?.get_children().filter(button => button.dockWidgetType).length ?? 0,
        };
        if (fixture.dockFolders !== 1 || fixture.appFolders !== 1 || fixture.widgets !== 3)
            throw new Error(`Dock profiling fixtures were not created: ${JSON.stringify(fixture)}`);
        await measure('folders-widgets');

        const result = {fixture, profiles};
        Gio.File.new_for_path(`${outputDir}/dock-rebuild-profile.json`).replace_contents(
            new TextEncoder().encode(JSON.stringify(result, null, 2)),
            null, false, Gio.FileCreateFlags.NONE, null);
        print(`Dock rebuild profile: ${JSON.stringify(result)}`);
    } finally {
        activePhaseTimes = null;
        try {
            settings.set_strv('dock-folders', previousSettings.dockFolders);
            settings.set_string('dock-app-folders', previousSettings.appFolders);
            settings.set_boolean('widgets-managed', previousSettings.widgetsManaged);
            settings.set_string('widget-instances', previousSettings.widgetInstances);
            settings.set_boolean('dock-widget-clock', previousSettings.clock);
            settings.set_boolean('dock-widget-calendar', previousSettings.calendar);
            settings.set_boolean('dock-widget-media', previousSettings.media);
            await Scripting.sleep(100);
            await Scripting.waitLeisure();
        } finally {
            for (const {target, method, original, hadOwn} of originals.reverse()) {
                if (hadOwn)
                    target[method] = original;
                else
                    delete target[method];
            }
        }
    }
}

async function checkFluxWidgets() {
    const extensionInfo = Main.extensionManager.lookup(extensionMetadata.uuid);
    const source = Gio.SettingsSchemaSource.new_from_directory(extensionInfo.dir.get_child('schemas').get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup(extensionMetadata['settings-schema'], true)});
    const catalog = await import('../dist/widgets/widgetCatalog.js');
    const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    const example = root.get_child('examples').get_child('flux-weather');
    const temporary = Gio.File.new_for_path(GLib.dir_make_tmp('g-os-flux-XXXXXX'));
    const server = new Soup.Server();
    let requests = 0;
    let temperature = 21;
    let cities = [{name: 'Paris', visible: true}, {name: 'Lyon', visible: true}];
    server.add_handler(null, (_server, message) => {
        requests++;
        message.set_status(200, null);
        message.set_response('application/json', Soup.MemoryUse.COPY,
            new TextEncoder().encode(JSON.stringify({current: {temperature_2m: temperature}, items: cities})));
    });
    server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
    const endpoint = server.get_uris()[0].to_string();
    const previous = {managed: settings.get_boolean('widgets-managed'), instances: settings.get_string('widget-instances')};
    const monitors = JSON.parse(settings.get_string('widget-monitors'));
    let imported = false;
    const read = name => new TextDecoder().decode(example.get_child(name).load_contents(null)[1]);
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 80; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error('Flux widget did not reach the expected state');
    };
    try {
        for (const name of ['widget.json', 'widget.flux', 'template.flux']) {
            let content = read(name);
            if (name === 'widget.flux')
                content = content.replace('https://api.open-meteo.com/v1/forecast?latitude=48.85&longitude=2.35&current=temperature_2m', endpoint);
            if (name === 'template.flux') {
                const extra = [
                    '  - type: text',
                    '    text: "{{#data.weather.items}}{{name}};{{/data.weather.items}}"',
                    '  - type: repeat',
                    '    items: data.weather.items',
                    '    children:',
                    '      - type: text',
                    '        text: "Ville : {{item.name}}"',
                    '        when: item.visible',
                ].join('\n');
                content = content.replace('\ndock:', `\n${extra}\ndock:`);
            }
            temporary.get_child(name).replace_contents(new TextEncoder().encode(content), null, false,
                Gio.FileCreateFlags.NONE, null);
        }
        catalog.importWidgetDirectory(temporary);
        imported = true;
        settings.set_int('widget-catalog-revision', settings.get_int('widget-catalog-revision') + 1);
        settings.set_boolean('widgets-managed', true);
        settings.set_string('widget-instances', JSON.stringify([
            {id: 'flux-desktop', widget: 'flux-weather', target: 'desktop', monitor: monitors[0].id,
                column: 2, row: 2, columns: 7, rows: 4},
            {id: 'flux-dock', widget: 'flux-weather', target: 'dock', monitor: '*', dockSize: 1},
        ]));
        await Scripting.sleep(800);
        const desktop = () => findActor(Main.layoutManager.uiGroup, actor => actor.widgetInstance?.id === 'flux-desktop');
        const dock = () => findActor(Main.layoutManager.uiGroup, actor => actor.dockFocusKey === 'widget-instance:flux-dock');
        await waitUntil(() => desktop() && dock() &&
            findActor(desktop(), actor => actor instanceof St.Label && actor.text === '21 °C') &&
            findActor(dock(), actor => actor instanceof St.Label && actor.text === '21°') &&
            findActor(desktop(), actor => actor instanceof St.Label && actor.text === 'Paris;Lyon;') &&
            findActor(desktop(), actor => actor instanceof St.Label && actor.text === 'Ville : Lyon'));
        const beforeDetail = requests;
        dock().emit('clicked', 1);
        await Scripting.sleep(250);
        if (requests !== beforeDetail)
            throw new Error('Flux Dock detail duplicated the shared HTTP request');
        const detail = dock().shortcutMenu;
        const refresh = findActor(detail.box, actor => actor.accessible_name === 'Actualiser');
        if (!detail.isOpen || !refresh)
            throw new Error('Flux detail template or refresh action is missing');
        temperature = 22;
        cities = [{name: 'Nice', visible: true}];
        refresh.emit('clicked', 1);
        await waitUntil(() => findActor(dock(), actor => actor instanceof St.Label && actor.text === '22°') &&
            findActor(detail.box, actor => actor instanceof St.Label && actor.text === '22 °C') &&
            findActor(detail.box, actor => actor instanceof St.Label && actor.text === 'Nice;') &&
            findActor(detail.box, actor => actor instanceof St.Label && actor.text === 'Ville : Nice'));
        if (findActor(detail.box, actor => actor instanceof St.Label && actor.text === 'Ville : Lyon'))
            throw new Error('Flux repeat did not remove stale components');
        if (requests !== beforeDetail + 1)
            throw new Error('Flux refresh did not perform exactly one HTTP request');
        detail.close();
        print('Native Flux widgets load local HTTP JSON, share sources and update Mustache loops and components');
    } finally {
        settings.set_string('widget-instances', previous.instances);
        settings.set_boolean('widgets-managed', previous.managed);
        if (imported) catalog.removeImportedWidget('flux-weather');
        server.disconnect();
        for (const name of ['widget.json', 'widget.flux', 'template.flux']) {
            try { temporary.get_child(name).delete(null); } catch {}
        }
        temporary.delete(null);
    }
}

async function checkSimpleWidgets() {
    const extensionInfo = Main.extensionManager.lookup(extensionMetadata.uuid);
    const source = Gio.SettingsSchemaSource.new_from_directory(extensionInfo.dir.get_child('schemas').get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup(extensionMetadata['settings-schema'], true)});
    const catalog = await import('../dist/widgets/widgetCatalog.js');
    const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    const monitors = JSON.parse(settings.get_string('widget-monitors'));
    const previous = {managed: settings.get_boolean('widgets-managed'),
        instances: settings.get_string('widget-instances'), state: settings.get_string('widget-state')};
    let imported = false;
    try {
        catalog.importWidgetDirectory(root.get_child('examples').get_child('simple-counter'));
        imported = true;
        settings.set_int('widget-catalog-revision', settings.get_int('widget-catalog-revision') + 1);
        settings.set_boolean('widgets-managed', true);
        settings.set_string('widget-instances', JSON.stringify([
            {id: 'simple-desktop', widget: 'simple-counter', target: 'desktop', monitor: monitors[0].id,
                column: 2, row: 2, columns: 7, rows: 4, config: {title: 'Test'}},
            {id: 'simple-dock', widget: 'simple-counter', target: 'dock', monitor: '*', dockSize: 1},
        ]));
        await Scripting.sleep(800);
        let desktop;
        let dock;
        for (let attempt = 0; attempt < 60 && (!desktop || !dock); attempt++) {
            await Scripting.sleep(50);
            desktop = findActor(Main.layoutManager.uiGroup, actor => actor.widgetInstance?.id === 'simple-desktop');
            dock = findActor(Main.layoutManager.uiGroup, actor => actor.dockFocusKey === 'widget-instance:simple-dock');
        }
        if (!desktop || !dock)
            throw new Error('Declarative desktop or Dock widget was not rendered');
        const label = findActor(desktop, actor => actor instanceof St.Label && actor.text === 'Test : 0');
        const button = findActor(desktop, actor => actor.accessible_name === 'Ajouter');
        if (!label || !button)
            throw new Error('Declarative widget content or action is missing');
        button.emit('clicked', 1);
        await Scripting.sleep(100);
        desktop = findActor(Main.layoutManager.uiGroup, actor => actor.widgetInstance?.id === 'simple-desktop');
        if (!findActor(desktop, actor => actor instanceof St.Label && actor.text === 'Test : 1') ||
            JSON.parse(settings.get_string('widget-state'))['simple-desktop']?.count !== 1)
            throw new Error('Declarative widget did not update its persisted state');
        dock.emit('clicked', 1);
        await Scripting.sleep(100);
        const detailButton = findActor(dock.shortcutMenu.box, actor => actor.accessible_name === 'Ajouter');
        if (!dock.shortcutMenu.isOpen || !detailButton)
            throw new Error('Declarative Dock detail panel did not open');
        detailButton.emit('clicked', 1);
        await Scripting.sleep(100);
        const saved = JSON.parse(settings.get_string('widget-state'));
        if (saved['simple-dock']?.count !== 1 || saved['simple-desktop']?.count !== 1)
            throw new Error('Declarative widget instances did not persist independent state');
        dock.shortcutMenu.close();
        print('Native declarative widgets render and persist independent desktop and Dock state');
    } finally {
        settings.set_string('widget-instances', previous.instances);
        settings.set_boolean('widgets-managed', previous.managed);
        settings.set_string('widget-state', previous.state);
        if (imported)
            catalog.removeImportedWidget('simple-counter');
    }
}

async function checkDockMaximizeMargins() {
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj;
    const settings = extension._settings;
    const cases = [];
    const rectangle = rect => [rect.x, rect.y, rect.width, rect.height];
    const waitUntil = async (predicate, state) => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (predicate()) return;
            await Scripting.sleep(50);
        }
        throw new Error(`Dock margins did not reach ${state}`);
    };
    settings.set_boolean('reserve-dock-space', true);
    settings.set_boolean('dock-maximize-slide', true);
    settings.set_boolean('dock-autohide', false);
    settings.set_boolean('dock-hide-when-covered', false);
    new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean('enable-animations', true);
    const process = Gio.Subprocess.new(['gjs', '-c',
        "imports.gi.versions.Gtk='3.0'; const Gtk=imports.gi.Gtk; Gtk.init(null); " +
        "const window=new Gtk.Window({title:'G-Os Dock Margins Test',default_width:300,default_height:250}); " +
        "window.connect('destroy',Gtk.main_quit); window.show_all(); Gtk.main();"], Gio.SubprocessFlags.NONE);
    try {
        await waitUntil(() => global.get_window_actors().some(actor =>
            actor.meta_window.get_title() === 'G-Os Dock Margins Test'), 'test window');
        const window = global.get_window_actors().find(actor =>
            actor.meta_window.get_title() === 'G-Os Dock Margins Test').meta_window;
        for (const position of [0, 1, 2]) {
            for (const hover of [0, 4]) {
                for (const [edgeMargin, windowMargin] of [[24, 0], [0, 24], [18, 30]]) {
                    settings.set_int('dock-position', position);
                    settings.set_int('dock-hover-animation', hover);
                    settings.set_int('dock-edge-margin', edgeMargin);
                    settings.set_int('dock-window-margin', windowMargin);
                    await Scripting.sleep(350);
                    await Scripting.waitLeisure();
                    const screen = extension._screens[0];
                    const area = () => rectangle(Main.layoutManager.getWorkAreaForMonitor(screen.monitor.index));
                    const reservation = () => [...screen.dockReservation.get_position(),
                        screen.dockReservation.width, screen.dockReservation.height];
                    const initialArea = area();
                    const initialReservation = reservation();
                    const result = {position, hover, edgeMargin, windowMargin, initialArea,
                        initialReservation, frames: [], issues: []};
                    cases.push(result);
                    for (const cycle of [1, 2]) {
                        window.maximize(...(window.maximize.length ? [Meta.MaximizeFlags.BOTH] : []));
                        await waitUntil(() => screen.dockDocked, 'docked state');
                        await Scripting.sleep(450);
                        await Scripting.waitLeisure();
                        const frame = rectangle(window.get_frame_rect());
                        result.frames.push(frame);
                        const [dockX, dockY] = screen.dockContainer.get_position();
                        const {monitor, dockContainer} = screen;
                        const edgeDistance = position === 0
                            ? monitor.y + monitor.height - dockY - dockContainer.height
                            : position === 1 ? dockX - monitor.x
                                : monitor.x + monitor.width - dockX - dockContainer.width;
                        if (Math.abs(edgeDistance) > 1)
                            result.issues.push(`dock-not-at-edge-cycle-${cycle}`);
                        if (JSON.stringify(area()) !== JSON.stringify(initialArea))
                            result.issues.push(`workarea-changed-cycle-${cycle}`);
                        if (JSON.stringify(reservation()) !== JSON.stringify(initialReservation))
                            result.issues.push(`reservation-changed-cycle-${cycle}`);
                        if (frame.some((value, index) => Math.abs(value - initialArea[index]) > 1))
                            result.issues.push(`window-does-not-fill-workarea-cycle-${cycle}`);
                        window.unmaximize(...(window.unmaximize.length ? [Meta.MaximizeFlags.BOTH] : []));
                        await waitUntil(() => !screen.dockDocked, 'floating state');
                        await Scripting.sleep(300);
                    }
                    if (JSON.stringify(result.frames[0]) !== JSON.stringify(result.frames[1]))
                        result.issues.push('first-and-second-maximization-differ');
                }
            }
        }
        const output = GLib.getenv('MACOS_VISUAL_OUTPUT');
        if (output)
            Gio.File.new_for_path(`${output}/dock-margins.json`).replace_contents(
                new TextEncoder().encode(JSON.stringify(cases, null, 2)),
                null, false, Gio.FileCreateFlags.NONE, null);
        const failures = cases.filter(result => result.issues.length);
        print(`Native Dock margin audit: ${cases.length} cases, ${failures.length} with findings`);
        if (failures.length)
            throw new Error(`Native Dock margins failures: ${JSON.stringify(failures)}`);
        print(`Native Dock first/second maximization and stable workareas pass for ${cases.length} margin cases`);
    } finally {
        process.force_exit();
    }
}

async function checkDockWindowCoverage() {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(source.lookup(extensionMetadata['settings-schema'], true), null, null);
    settings.set_boolean('dock-autohide', false);
    settings.set_boolean('dock-hide-when-covered', true);
    new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean('enable-animations', true);
    await Scripting.sleep(300);
    const extension = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj;
    const screen = extension._screens[0];
    const dock = screen.dockContainer;
    const process = Gio.Subprocess.new(['gjs', '-c',
        "imports.gi.versions.Gtk='3.0'; const Gtk=imports.gi.Gtk; Gtk.init(null); " +
        "const window=new Gtk.Window({title:'MacOS Dock Coverage Test',default_width:300,default_height:250}); " +
        "window.connect('destroy',Gtk.main_quit); window.show_all(); Gtk.main();"], Gio.SubprocessFlags.NONE);
    try {
        let window;
        for (let attempt = 0; attempt < 50 && !window; attempt++) {
            await Scripting.sleep(100);
            window = global.get_window_actors().map(actor => actor.meta_window)
                .find(candidate => candidate.get_title() === 'MacOS Dock Coverage Test');
        }
        if (!window)
            throw new Error('Coverage test window did not appear');
        window.move_frame(true, screen.monitor.x, screen.monitor.y + 80);
        await Scripting.sleep(900);
        const initialPosition = dock.get_position();
        const [dockX, dockY] = initialPosition;
        window.move_frame(true, dockX, dockY - 100);
        await Scripting.sleep(900);
        if (!screen.dockCovered || dock.visible)
            throw new Error('Dock did not hide beneath the test window');
        const pointer = global.stage.get_context().get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        move(screen.monitor.x + 10, screen.monitor.y + 80);
        await Scripting.sleep(100);
        move(dockX + dock.width / 2, screen.monitor.y + screen.monitor.height - 1);
        await Scripting.sleep(900);
        if (!dock.visible || !screen.dockPeek)
            throw new Error('Moving the pointer to the screen edge did not reveal the covered Dock');
        move(dockX + dock.width / 2, dockY + dock.height / 2);
        await Scripting.sleep(200);
        window.move_frame(true, dockX + 5, dockY - 100);
        await Scripting.sleep(900);
        if (!dock.visible || !screen.dockPeek || !screen.dockCovered)
            throw new Error('Covered Dock did not stay visible during pointer interaction');
        move(screen.monitor.x + 10, screen.monitor.y + 80);
        await Scripting.sleep(1200);
        if (dock.visible)
            throw new Error('Covered Dock did not hide after the pointer left');
        window.move_frame(true, screen.monitor.x, screen.monitor.y + 80);
        await Scripting.sleep(900);
        if (screen.dockCovered || !dock.visible || dock.translation_x !== 0 || dock.translation_y !== 0 ||
            dock.get_position().some((value, index) => value !== initialPosition[index]))
            throw new Error(`Dock did not return after moving: covered=${screen.dockCovered}, visible=${dock.visible}, ` +
                `translation=${dock.translation_x},${dock.translation_y}, position=${dock.get_position()}, ` +
                `initial=${initialPosition}, frame=${JSON.stringify(window.get_frame_rect())}`);
        window.move_frame(true, dockX, dockY - 100);
        await Scripting.sleep(900);
        window.minimize();
        await Scripting.sleep(900);
        if (screen.dockCovered || !dock.visible || dock.translation_x !== 0 || dock.translation_y !== 0)
            throw new Error('Dock did not return after minimizing the window');
        window.unminimize();
        await Scripting.sleep(900);
        window.delete(global.get_current_time());
        await Scripting.sleep(900);
        if (screen.dockCovered || !dock.visible || dock.translation_x !== 0 || dock.translation_y !== 0)
            throw new Error('Dock did not return after closing the window');
        print('Native Dock returns after moving, minimizing and closing an overlapping window');
    } finally {
        process.force_exit();
    }
}

async function checkDockWidgets(fitOnly = false) {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(source.lookup(extensionMetadata['settings-schema'], true), null, null);
    settings.set_boolean('dock-widget-clock', true);
    settings.set_boolean('dock-widget-calendar', true);
    settings.set_boolean('dock-widget-media', true);
    settings.set_strv('dock-item-order', ['widget:clock', 'widget:calendar', 'widget:media']);
    settings.set_int('dock-hover-animation', 4);
    const currentDock = () => Main.extensionManager.lookup(extensionMetadata.uuid).stateObj._screens[0].dock;
    const cases = [];
    const bounds = actor => {
        const vertices = actor.get_abs_allocation_vertices();
        const left = Math.min(...vertices.map(vertex => vertex.x));
        const top = Math.min(...vertices.map(vertex => vertex.y));
        return [left, top, Math.max(...vertices.map(vertex => vertex.x)) - left,
            Math.max(...vertices.map(vertex => vertex.y)) - top];
    };
    const leaves = actor => actor.get_children().length ? actor.get_children().flatMap(leaves) : [actor];
    for (const [size, format] of [[24, 0], [40, 0], [64, 0], [24, 1], [40, 1], [64, 1]]) {
        settings.set_value('dock-widget-sizes', new GLib.Variant('a{si}', {clock: format, calendar: format, media: format}));
        settings.set_int('icon-size', size);
        for (const position of [0, 1, 2]) {
            settings.set_int('dock-position', position);
            await Scripting.sleep(350);
            const dock = currentDock();
            const children = dock.get_children().filter(actor => actor.dockFocusKey);
            const widgets = children.filter(actor => actor.dockWidgetType);
            if (widgets.length !== 3)
                throw new Error(`Expected three Dock widgets at position ${position}, got ${widgets.length}`);
            for (const widget of widgets) {
                const content = widget.get_child().get_first_child();
                const [x, y] = widget.get_transformed_position();
                const [width, height] = widget.get_transformed_size();
                const vertices = content.get_abs_allocation_vertices();
                const contentX = Math.min(...vertices.map(vertex => vertex.x));
                const contentY = Math.min(...vertices.map(vertex => vertex.y));
                const contentWidth = Math.max(...vertices.map(vertex => vertex.x)) - contentX;
                const contentHeight = Math.max(...vertices.map(vertex => vertex.y)) - contentY;
                print(`Widget ${widget.dockWidgetType} ${position}/${size}: ${x},${y} ${width}x${height}; content ${contentX},${contentY} ${contentWidth}x${contentHeight}`);
                const margin = settings.get_int('dock-icon-padding');
                if (format === 1 && Math.abs(contentWidth - contentHeight) > 1)
                    throw new Error('1x1 widget is not square');
                if (Math.abs((position === 0 ? contentHeight : contentWidth) - size) > 1 ||
                    Math.abs(width - contentWidth - margin * 2) > 2 || Math.abs(height - contentHeight - margin * 2) > 2 ||
                    Math.abs(x + margin - contentX) > 2 || Math.abs(y + margin - contentY) > 2 ||
                    (widget.dockWidgetType !== 'media' && (!widget.dockWidgetPrimary.text || !widget.dockWidgetSecondary.text)))
                    throw new Error(`Widget content does not fit its allocation at position ${position}`);
                const overflowing = leaves(content).filter(actor => actor.visible && actor.mapped).filter(actor => {
                    const [left, top, leafWidth, leafHeight] = bounds(actor);
                    return left < contentX - 2 || top < contentY - 2 ||
                        left + leafWidth > contentX + contentWidth + 2 || top + leafHeight > contentY + contentHeight + 2;
                }).map(actor => ({type: actor.constructor.name, text: actor.text, bounds: bounds(actor)}));
                cases.push({position, size, format, widget: widget.dockWidgetType, scale: content.scale_y,
                    bounds: [contentX, contentY, contentWidth, contentHeight], overflowing});
            }
            for (let index = 1; index < children.length; index++) {
                const previous = children[index - 1];
                const current = children[index];
                const [previousX, previousY] = previous.get_transformed_position();
                const [previousWidth, previousHeight] = previous.get_transformed_size();
                const [currentX, currentY] = current.get_transformed_position();
                if ((position === 0 ? currentX - previousX - previousWidth : currentY - previousY - previousHeight) < -1)
                    throw new Error(`Dock items overlap at position ${position}`);
            }
            await capture(`g-os-dock-widgets-${position}-${size}-${format}.png`);
        }
    }
    Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/dock-widget-fit.json`).replace_contents(
        new TextEncoder().encode(JSON.stringify(cases, null, 2)), null, false, Gio.FileCreateFlags.NONE, null);
    if (cases.some(result => result.overflowing.length))
        throw new Error(`Dock widget children overflow: ${JSON.stringify(cases.filter(result => result.overflowing.length))}`);
    if (fitOnly) {
        print(`Dock widget full-content fitting passes ${cases.length} native cases`);
        return;
    }
    settings.set_value('dock-widget-sizes', new GLib.Variant('a{si}', {}));
    settings.set_int('dock-position', 0);
    await Scripting.sleep(350);
    const dock = currentDock();
    const clock = dock.get_children().find(actor => actor.dockWidgetType === 'clock');
    const calendar = dock.get_children().find(actor => actor.dockWidgetType === 'calendar');
    const [clockX, clockY] = clock.get_transformed_position();
    const [clockWidth, clockHeight] = clock.get_transformed_size();
    const [calendarX, calendarY] = calendar.get_transformed_position();
    const [calendarWidth, calendarHeight] = calendar.get_transformed_size();
    const pointer = global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    const press = state => pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, state);
    move(clockX + clockWidth / 2, clockY + clockHeight / 2);
    await Scripting.sleep(80);
    move(clockX + clockWidth / 2, clockY + clockHeight / 2);
    await Scripting.sleep(80);
    press(Clutter.ButtonState.PRESSED);
    await Scripting.sleep(80);
    move(clockX + clockWidth / 2 + 16, clockY + clockHeight / 2);
    await Scripting.sleep(80);
    print(`Widget drag monitors after start: ${DND.dragMonitors.length}`);
    move(calendarX + calendarWidth * 0.9, calendarY + calendarHeight / 2);
    await Scripting.sleep(120);
    press(Clutter.ButtonState.RELEASED);
    await Scripting.sleep(400);
    const order = settings.get_strv('dock-item-order');
    print(`Widget order after drag: ${order.join(', ')}`);
    if (order.indexOf('widget:clock') <= order.indexOf('widget:calendar'))
        throw new Error('Native pointer drag did not reorder the Dock widgets');
    print('Native pointer drag reordered Dock widgets');
    const resizedDock = currentDock();
    const latestClock = resizedDock.get_children().find(actor => actor.dockWidgetType === 'clock');
    const [latestX, latestY] = latestClock.get_transformed_position();
    const [latestWidth, latestHeight] = latestClock.get_transformed_size();
    move(latestX + latestWidth / 2, latestY + latestHeight / 2);
    await Scripting.sleep(100);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
    await Scripting.sleep(100);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
    await Scripting.sleep(150);
    if (!latestClock.shortcutMenu.isOpen)
        throw new Error('Right click did not open the widget size menu');
    await capture('g-os-dock-widget-size-menu.png');
    latestClock.shortcutMenu._getMenuItems()[0].activate(null);
    await Scripting.sleep(350);
    if (settings.get_value('dock-widget-sizes').deep_unpack().clock !== 1)
        throw new Error('Widget context menu did not save the square size');
    print('Native widget right-click size menu saved the 1x1 format');
    print('Dock widgets fit and rotate without overlapping at all positions');
}

async function checkFolderViewOptions() {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(schemaSource.lookup(extensionMetadata['settings-schema'], true), null, null);
    const uri = Gio.File.new_for_path('/usr/share').get_uri();
    settings.set_strv('dock-folders', [uri]);
    settings.set_int('dock-folder-view', 0);
    settings.set_value('dock-view-options', new GLib.Variant('a{sa{si}}', {
        pile: {'icon-size': 50, 'text-size': 14, spacing: 10, 'max-files': 6},
        [`folder:${uri}:pile`]: {'icon-size': 64, 'text-size': 18, spacing: 14, 'max-files': 3},
        [`folder:${uri}:grille`]: {'icon-size': 56, 'text-size': 16, 'horizontal-spacing': 15,
            'vertical-spacing': 21, columns: 3, rows: 2},
    }));
    const currentDock = () => Main.extensionManager.lookup(extensionMetadata.uuid).stateObj._screens[0].dock;
    const open = async (predicate, style) => {
        await Scripting.sleep(350);
        const button = currentDock().get_children().find(predicate);
        if (!button)
            throw new Error('Configured folder is missing');
        button.emit('clicked', 1);
        let content;
        for (let attempt = 0; attempt < 60 && !content; attempt++) {
            await Scripting.sleep(50);
            content = button.folderMenu.box.get_children().flatMap(item => item.get_children())
                .find(item => item.has_style_class_name?.(style));
        }
        if (!content)
            throw new Error(`Configured folder did not render ${style}`);
        await Scripting.sleep(200);
        return [button, content];
    };
    let [button, content] = await open(actor => actor.folderUri === uri, 'g-os-dock-folder-fan');
    const stackItems = content.get_children();
    const stackLabel = stackItems[0].get_child().get_children()[0].get_child();
    const stackIcon = stackItems[0].get_child().get_children()[1];
    if (stackItems.length !== 3 || stackIcon.icon_size !== 64 ||
        !stackLabel.has_style_class_name('g-os-folder-text-size-18') ||
        stackItems[1].y - stackItems[0].y !== 82)
        throw new Error('Configured stack dimensions or file limit were not applied');
    const [labelX] = stackLabel.get_transformed_position();
    const [labelWidth] = stackLabel.get_transformed_size();
    const [iconX] = stackIcon.get_transformed_position();
    if (iconX - labelX - labelWidth < 7 || iconX - labelX - labelWidth > 9)
        throw new Error('Configured stack label is not right-aligned next to its icon');
    const stackFont = stackLabel.get_theme_node().get_font().get_size();
    const stackColor = stackLabel.get_theme_node().get_foreground_color();
    await capture('g-os-folder-options-stack.png');
    button.folderMenu.close();
    settings.set_int('dock-folder-view', 1);
    [button, content] = await open(actor => actor.folderUri === uri, 'g-os-dock-folder-grid');
    const rows = content.get_children();
    const gridItem = rows[0].get_children()[0];
    const [gridIcon, gridLabel] = gridItem.get_child().get_children();
    const gridColor = gridLabel.get_theme_node().get_foreground_color();
    if (['red', 'green', 'blue', 'alpha'].some(channel => gridColor[channel] !== stackColor[channel]))
        throw new Error('Grid label color differs from the stack label color');
    if (rows.length !== 2 || rows[0].get_children().length !== 3 || gridIcon.icon_size !== 56 ||
        !gridLabel.has_style_class_name('g-os-folder-text-size-16') ||
        rows[0].get_theme_node().get_length('spacing') !== 15 ||
        content.get_theme_node().get_length('spacing') !== 21 ||
        gridItem.width !== 76 || gridItem.height !== 100 ||
        content.get_theme_node().get_padding(St.Side.LEFT) !== 2 ||
        stackFont <= gridLabel.get_theme_node().get_font().get_size())
        throw new Error('Configured grid dimensions, text size, spacing or limits were not applied');
    await capture('g-os-folder-options-grid.png');
    const openFolder = button.folderMenu.box.get_children().find(actor =>
        actor.has_style_class_name?.('g-os-dock-folder-open'));
    if (!openFolder)
        throw new Error('Open-folder action is missing');
    for (const state of ['active', 'focus', 'hover'])
        openFolder.add_style_pseudo_class(state);
    await Scripting.sleep(120);
    const hoverColor = openFolder.get_theme_node().get_background_color();
    if (hoverColor.alpha !== 255 || hoverColor.blue < 200 || hoverColor.red > 32)
        throw new Error('Open-folder hover is not blue');
    await capture('g-os-folder-open-hover.png');
    openFolder.remove_style_pseudo_class('hover');
    await Scripting.sleep(120);
    if (openFolder.get_theme_node().get_background_color().alpha !== 0)
        throw new Error('Open-folder action remains blue after leaving hover');
    if (!button.folderMenu.isOpen || !content.mapped || !gridItem.mapped)
        throw new Error('Folder grid disappears after leaving the open-folder action');
    content.queue_redraw();
    currentDock().queue_redraw();
    global.stage.queue_redraw();
    await Scripting.waitLeisure();
    await capture('g-os-folder-open-rest.png');
    openFolder.remove_style_pseudo_class('active');
    openFolder.remove_style_pseudo_class('focus');
    print('Native open-folder hover returns to neutral while focus and active states persist');
    button.folderMenu.close();
    settings.set_value('dock-view-options', new GLib.Variant('a{sa{si}}', {
        [`folder:${uri}:grille`]: {'icon-size': 96, 'text-size': 32, 'horizontal-spacing': 48,
            'vertical-spacing': 48, columns: 10, rows: 3},
    }));
    let scroll;
    [button, scroll] = await open(actor => actor.folderUri === uri, 'g-os-dock-app-folder-scroll');
    const extremeGrid = scroll.get_child().get_children()[0];
    if (scroll.hscrollbar_policy !== St.PolicyType.AUTOMATIC ||
        scroll.vscrollbar_policy !== St.PolicyType.AUTOMATIC ||
        extremeGrid.get_children().length !== 3 || extremeGrid.get_children()[0].get_children().length !== 10 ||
        scroll.hadjustment.upper <= scroll.hadjustment.page_size ||
        scroll.vadjustment.upper <= scroll.vadjustment.page_size)
        throw new Error('Extreme grid settings are not bounded and scrollable in both directions');
    await capture('g-os-folder-options-extreme.png');
    button.folderMenu.close();
    const apps = global.settings.get_strv('favorite-apps').slice(0, 3);
    settings.set_string('dock-app-folders', JSON.stringify([{id: 'options-test', name: 'Applications', apps, icon: '', view: 0}]));
    settings.set_value('dock-view-options', new GLib.Variant('a{sa{si}}', {
        pile: {'icon-size': 50}, 'app-folder:options-test:pile': {'icon-size': 72, 'text-size': 20, spacing: 20},
    }));
    [button, content] = await open(actor => actor.appFolderId === 'options-test', 'g-os-dock-folder-fan');
    const appItems = content.get_children();
    if (appItems.length !== apps.length || appItems[0].get_child().get_children()[1].icon_size !== 72 ||
        !appItems[0].get_child().get_children()[0].get_child().has_style_class_name('g-os-folder-text-size-20'))
        throw new Error('Application folder override was not applied');
    await capture('g-os-app-folder-options.png');
    button.folderMenu.close();
    print('Native folder view options applied independently to files and application folders');
}

async function checkUtilityWidgets() {
    const extensionInfo = Main.extensionManager.lookup(extensionMetadata.uuid);
    const source = Gio.SettingsSchemaSource.new_from_directory(extensionInfo.dir.get_child('schemas').get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup(extensionMetadata['settings-schema'], true)});
    const monitor = JSON.parse(settings.get_string('widget-monitors'))[0];
    const requestedWidgets = GLib.getenv('MACOS_UTILITY_WIDGETS')?.split(',').filter(Boolean);
    const widgets = requestedWidgets?.length ? requestedWidgets
        : ['notes', 'tasks', 'calculator', 'timer', 'stopwatch', 'world-clock', 'system-monitor', 'storage'];
    const rootDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (predicate())
                return;
            await Scripting.sleep(50);
        }
        throw new Error('Utility widget did not update');
    };
    const getActor = id => findActor(Main.layoutManager.uiGroup, actor => actor.widgetInstance?.id === id);
    const hasClass = (actor, name) => actor.has_style_class_name?.(name);
    const findButton = (actor, title) => findActor(actor, child => child.accessible_name === title);
    const ensureBounds = root => {
        const [x, y] = root.get_transformed_position();
        const [width, height] = root.get_transformed_size();
        const visit = actor => {
            if (actor.mapped && (actor instanceof St.Label || actor instanceof St.Entry || actor instanceof St.Button)) {
                const [childX, childY] = actor.get_transformed_position();
                const [childWidth, childHeight] = actor.get_transformed_size();
                if (childX < x - 1 || childY < y - 1 || childX + childWidth > x + width + 1 || childY + childHeight > y + height + 1)
                    throw new Error(`Utility widget content exceeds frame: ${root.widgetInstance.widget}, ` +
                        `${actor.get_style_class_name() ?? actor.text ?? actor.accessible_name ?? actor.constructor.name}, ` +
                        `${childX},${childY} ${childWidth}x${childHeight} outside ${x},${y} ${width}x${height}`);
            }
            for (const child of actor.get_children())
                visit(child);
        };
        visit(root);
    };
    const snapshots = {managed: settings.get_boolean('widgets-managed'), instances: settings.get_string('widget-instances'),
        state: settings.get_string('widget-state'), size: settings.get_int('icon-size'), position: settings.get_int('dock-position')};
    try {
        settings.set_boolean('widgets-managed', true);
        for (const widget of widgets) {
            const [, bytes] = rootDirectory.get_child('widgets').get_child(widget).get_child('widget.json').load_contents(null);
            const description = JSON.parse(new TextDecoder().decode(bytes));
            const config = widget === 'system-monitor'
                ? {'background-style': 'dynamic', 'background-color': '#2ca875a0', shadow: 'strong'}
                : widget === 'storage' ? {'background-style': 'solid', 'background-color': '#b78d2480', shadow: 'soft'} : {};
            const instances = [
                {id: `test-${widget}-desktop`, widget, target: 'desktop', monitor: monitor.id,
                    column: 1, row: 1, columns: description.size.columns, rows: description.size.rows, config},
                {id: `test-${widget}-dock`, widget, target: 'dock', monitor: monitor.id, dockSize: 0, config},
            ];
            settings.set_int('icon-size', 40);
            settings.set_int('dock-position', 0);
            settings.set_string('widget-instances', JSON.stringify(instances));
            await waitUntil(() => getActor(instances[0].id) && getActor(instances[1].id));
            await Scripting.sleep(250);
            const desktop = getActor(instances[0].id);
            if (widget === 'notes') {
                const entry = findActor(desktop, actor => actor instanceof St.Entry);
                entry.set_text('Note de test persistante');
                await waitUntil(() => JSON.parse(settings.get_string('widget-state'))[instances[0].id]?.text === 'Note de test persistante');
            } else if (widget === 'tasks') {
                const entry = findActor(desktop, actor => actor instanceof St.Entry);
                entry.set_text('Tester les widgets');
                findButton(desktop, 'Ajouter la tache').emit('clicked', 1);
                await waitUntil(() => JSON.parse(settings.get_string('widget-state'))[instances[0].id]?.items?.length === 1);
                findButton(desktop, 'Terminer la tache').emit('clicked', 1);
            } else if (widget === 'calculator') {
                findActor(desktop, actor => actor instanceof St.Entry).set_text('2 + 3 * 4');
                findButton(desktop, 'Calculer').emit('clicked', 1);
                await waitUntil(() => JSON.parse(settings.get_string('widget-state'))[instances[0].id]?.result === '14');
            } else if (widget === 'timer' || widget === 'stopwatch') {
                findButton(desktop, 'Demarrer ou mettre en pause').emit('clicked', 1);
                if (widget === 'stopwatch')
                    findButton(desktop, 'Enregistrer un tour').emit('clicked', 1);
            } else if (widget === 'system-monitor' || widget === 'storage') {
                await waitUntil(() => !findActor(desktop, actor => actor instanceof St.Label && /\.\.\./.test(actor.text)));
                if (findActor(desktop, actor => actor instanceof St.Label && /indisponible/.test(actor.text)))
                    throw new Error(`Utility widget could not read its data source: ${widget}`);
            }
            ensureBounds(desktop);
            const errors = JSON.parse(settings.get_string('widget-errors'));
            if (errors[instances[0].id] || errors[instances[1].id])
                throw new Error(`Utility widget raised an error: ${JSON.stringify(errors)}`);
            global.stage.queue_redraw();
            await Scripting.waitLeisure();
            await capture(`g-os-utility-${widget}.png`);
            const dock = getActor(instances[1].id);
            dock.emit('clicked', 1);
            await Scripting.sleep(200);
            if (!dock.shortcutMenu?.isOpen || !findActor(dock.shortcutMenu.box, actor => hasClass(actor, 'g-os-utility-widget')))
                throw new Error(`Utility Dock detail panel did not open: ${widget}`);
            await capture(`g-os-utility-${widget}-panel.png`);
            dock.shortcutMenu.close();
            instances[1].dockSize = 1;
            settings.set_string('widget-instances', JSON.stringify(instances));
            await Scripting.sleep(200);
            ensureBounds(getActor(instances[1].id));
            settings.set_int('dock-position', 1);
            await Scripting.sleep(200);
            ensureBounds(getActor(instances[1].id));
        }
        print('Native utility widgets create desktop, Dock, square and side views with working inputs and services');
    } finally {
        settings.set_string('widget-instances', snapshots.instances);
        settings.set_boolean('widgets-managed', snapshots.managed);
        settings.set_string('widget-state', snapshots.state);
        settings.set_int('icon-size', snapshots.size);
        settings.set_int('dock-position', snapshots.position);
    }
}

async function checkWidgetSystem() {
    const extensionInfo = Main.extensionManager.lookup(extensionMetadata.uuid);
    const source = Gio.SettingsSchemaSource.new_from_directory(extensionInfo.dir.get_child('schemas').get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup(extensionMetadata['settings-schema'], true)});
    const catalog = await import('../dist/widgets/widgetCatalog.js');
    const snapshots = {managed: settings.get_boolean('widgets-managed'),
        instances: settings.get_string('widget-instances'), grid: settings.get_boolean('widget-show-grid')};
    const monitors = JSON.parse(settings.get_string('widget-monitors'));
    if (monitors.length === 0)
        throw new Error('Widget monitor list was not published');
    const monitor = Main.layoutManager.monitors[0];
    const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 60; attempt++) {
            if (predicate())
                return;
            await Scripting.sleep(50);
        }
        throw new Error('Managed widget did not appear');
    };
    const actor = id => findActor(Main.layoutManager.uiGroup, value => value.widgetInstance?.id === id);
    let imported = false;
    try {
        const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
        catalog.importWidgetDirectory(root.get_child('examples').get_child('example-status'));
        imported = true;
        settings.set_int('widget-catalog-revision', settings.get_int('widget-catalog-revision') + 1);
        settings.set_boolean('widgets-managed', true);
        settings.set_int('widget-grid-size', 32);
        settings.set_boolean('widget-show-grid', true);
        settings.set_string('widget-instances', JSON.stringify([
            {id: 'desktop-clock-test', widget: 'clock', target: 'desktop', monitor: monitors[0].id,
                column: 2, row: 3, columns: 7, rows: 4, locked: true, config: {'show-date': false}},
            {id: 'desktop-calendar-test', widget: 'calendar', target: 'desktop', monitor: monitors[0].id,
                column: 10, row: 2, columns: 7, rows: 5, foreground: true},
            {id: 'dock-clock-test', widget: 'clock', target: 'dock', monitor: monitors[0].id, dockSize: 1},
            {id: 'imported-desktop-test', widget: 'example-status', target: 'desktop', monitor: monitors[0].id,
                column: 18, row: 2, columns: 7, rows: 4, config: {caption: 'Widget importe'}},
        ]));
        await waitUntil(() => actor('imported-desktop-test')?.get_children()[0]?.text === 'Widget importe');
        await Scripting.sleep(250);
        await Scripting.waitLeisure();
        const clock = actor('desktop-clock-test');
        const calendar = actor('desktop-calendar-test');
        const dock = actor('dock-clock-test');
        const desktopGrid = () => findActor(Main.layoutManager._backgroundGroup,
            value => value.has_style_class_name?.('g-os-widget-grid'));
        const gridActor = desktopGrid();
        if (!gridActor)
            throw new Error('Desktop widget grid is not rendered');
        const [gridX, gridY] = gridActor.get_transformed_position();
        let clockPosition = clock.get_transformed_position();
        for (let attempt = 0; attempt < 20; attempt++) {
            await Scripting.waitLeisure();
            clockPosition = clock.get_transformed_position();
            if (Math.abs(clockPosition[0] - gridX - 64) <= 1 &&
                Math.abs(clockPosition[1] - gridY - 96) <= 1)
                break;
            await Scripting.sleep(50);
        }
        const [parentX, parentY] = clock.get_parent().get_transformed_position();
        const [clockLocalX, clockLocalY] = clock.get_position();
        const [clockX, clockY] = clockPosition;
        if (Math.abs(clockX - gridX - 64) > 1 || Math.abs(clockY - gridY - 96) > 1 || clock.dateLabel.visible)
            throw new Error(`Managed clock grid placement or configuration is wrong: position=${clockX},${clockY}, ` +
            `local=${clockLocalX},${clockLocalY}, parent=${parentX},${parentY}, ` +
                `grid=${gridX},${gridY}, area=${area.x},${area.y}, date=${clock.dateLabel.visible}`);
        if (!clock.widgetInstance.locked || calendar.get_parent() !== Main.layoutManager.uiGroup)
            throw new Error('Managed locking or foreground layer did not apply');
        if (!dock.dockWidgetSquare || dock.dockFocusKey !== 'widget-instance:dock-clock-test')
            throw new Error('Managed Dock widget format is incorrect');
        global.stage.queue_redraw();
        await Scripting.waitLeisure();
        await capture('g-os-widget-system-grid.png');
        const importedActor = actor('imported-desktop-test');
        const dragHandle = importedActor.dragHandle;
        const [handleX, handleY] = dragHandle.get_transformed_position();
        const [handleWidth, handleHeight] = dragHandle.get_transformed_size();
        const pointer = global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        const startX = handleX + handleWidth / 2;
        const startY = handleY + handleHeight / 2;
        move(startX, startY);
        await Scripting.sleep(100);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        await Scripting.sleep(50);
        move(startX + 12, startY + 12);
        await Scripting.sleep(80);
        move(startX + 64, startY + 64);
        await Scripting.sleep(150);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await waitUntil(() => {
            const instance = JSON.parse(settings.get_string('widget-instances')).find(value => value.id === 'imported-desktop-test');
            return instance.column !== 18 || instance.row !== 2;
        });
        const moved = JSON.parse(settings.get_string('widget-instances')).find(value => value.id === 'imported-desktop-test');
        const immediatePosition = actor('imported-desktop-test').get_transformed_position();
        await Scripting.sleep(300);
        await Scripting.waitLeisure();
        const [movedX, movedY] = actor('imported-desktop-test').get_transformed_position();
        const [dragGridX, dragGridY] = desktopGrid().get_transformed_position();
        if (Math.abs(movedX - dragGridX - moved.column * 32) > 1 ||
            Math.abs(movedY - dragGridY - moved.row * 32) > 1)
            throw new Error(`Desktop drag did not snap to the saved grid cell: immediate=${immediatePosition}, ` +
            `settled=${movedX},${movedY}, cell=${moved.column},${moved.row}, grid=${dragGridX},${dragGridY}`);
        print('Native desktop widget drag is accepted and snaps to the saved grid');
        const launchpad = extensionInfo.stateObj._screens[0].dock.get_children()
            .find(value => value.dockFocusKey === 'shortcut:applications');
        launchpad.emit('popup-menu');
        await Scripting.sleep(150);
        if (!launchpad.shortcutMenu.box.get_children().some(item => item.label?.text === 'Gestion des widgets du Dock'))
            throw new Error('Launchpad widget manager action is missing');
        await capture('g-os-widget-system-dock-menu.png');
        launchpad.shortcutMenu.close();
        move(area.x + area.width - 80, area.y + Math.min(480, area.height - 80));
        await Scripting.sleep(100);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
        await Scripting.sleep(100);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
        await Scripting.sleep(200);
        const desktopAction = findActor(Main.layoutManager.uiGroup,
            value => value.label?.text === 'Configuration des widgets du bureau' && value.mapped);
        if (!desktopAction)
            throw new Error('Desktop right click did not show the widget manager action');
        await capture('g-os-widget-system-desktop-menu.png');
        extensionInfo.stateObj?._desktopWidgetMenu?.close();
        for (const manager of Main.layoutManager._bgManagers)
            manager.backgroundActor._backgroundMenu?.close();
        const values = JSON.parse(settings.get_string('widget-instances'));
        values.find(value => value.id === 'desktop-clock-test').column = 4;
        settings.set_string('widget-instances', JSON.stringify(values));
        await Scripting.sleep(200);
        if (Math.abs(actor('desktop-clock-test').get_transformed_position()[0] -
            desktopGrid().get_transformed_position()[0] - 128) > 1)
            throw new Error('Managed widget position did not update');
        settings.set_string('widget-instances', JSON.stringify(values.filter(value => value.id !== 'imported-desktop-test')));
        await Scripting.sleep(200);
        if (actor('imported-desktop-test'))
            throw new Error('Removed imported widget remains on the desktop');
        print('Native widget modules, import, grid, locking, foreground, Dock format and live updates passed');
    } finally {
        settings.set_string('widget-instances', snapshots.instances);
        settings.set_boolean('widgets-managed', snapshots.managed);
        settings.set_boolean('widget-show-grid', snapshots.grid);
        if (imported)
            catalog.removeImportedWidget('example-status');
    }
}

async function checkMediaWidgets() {
    const extensionInfo = Main.extensionManager.lookup(extensionMetadata.uuid);
    const source = Gio.SettingsSchemaSource.new_from_directory(extensionInfo.dir.get_child('schemas').get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup(extensionMetadata['settings-schema'], true)});
    const commands = [];
    const rootXML = `<node><interface name="org.mpris.MediaPlayer2">
        <method name="Raise"/>
        <property name="Identity" type="s" access="read"/>
        <property name="DesktopEntry" type="s" access="read"/>
        <property name="CanRaise" type="b" access="read"/>
    </interface></node>`;
    const playerXML = `<node><interface name="org.mpris.MediaPlayer2.Player">
        <method name="PlayPause"/><method name="Next"/><method name="Previous"/>
        <property name="PlaybackStatus" type="s" access="read"/>
        <property name="Metadata" type="a{sv}" access="read"/>
        <property name="CanPlay" type="b" access="read"/>
        <property name="CanPause" type="b" access="read"/>
        <property name="CanGoNext" type="b" access="read"/>
        <property name="CanGoPrevious" type="b" access="read"/>
        <property name="CanControl" type="b" access="read"/>
    </interface></node>`;
    const server = {
        status: 'Playing', track: 1,
        get PlaybackStatus() { return this.status; },
        get Metadata() {
            return {'xesam:title': new GLib.Variant('s', `Piste de test ${this.track}`),
                'xesam:artist': new GLib.Variant('as', ['Artiste de test'])};
        },
        CanPlay: true, CanPause: true, CanGoNext: true, CanGoPrevious: true, CanControl: true,
        PlayPause() {
            commands.push('PlayPause');
            this.status = this.status === 'Playing' ? 'Paused' : 'Playing';
            playerExport.emit_property_changed('PlaybackStatus', new GLib.Variant('s', this.status));
        },
        Next() {
            commands.push('Next');
            this.track++;
            playerExport.emit_property_changed('Metadata', new GLib.Variant('a{sv}', this.Metadata));
        },
        Previous() {
            commands.push('Previous');
            this.track = Math.max(1, this.track - 1);
            playerExport.emit_property_changed('Metadata', new GLib.Variant('a{sv}', this.Metadata));
        },
    };
    const rootExport = Gio.DBusExportedObject.wrapJSObject(rootXML, {
        Identity: 'Lecteur de test', DesktopEntry: '', CanRaise: true,
        Raise() { commands.push('Raise'); },
    });
    const playerExport = Gio.DBusExportedObject.wrapJSObject(playerXML, server);
    rootExport.export(Gio.DBus.session, '/org/mpris/MediaPlayer2');
    playerExport.export(Gio.DBus.session, '/org/mpris/MediaPlayer2');
    let owner = Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.mpris.MediaPlayer2.MacosWidgetTest',
        Gio.BusNameOwnerFlags.NONE, null, null);
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 60; attempt++) {
            if (predicate())
                return;
            await Scripting.sleep(50);
        }
        throw new Error('Media widget state did not update');
    };
    const dockWidget = () => findActor(Main.layoutManager.uiGroup, actor => actor.dockWidgetType === 'media');
    const desktopWidget = () => findActor(Main.layoutManager._backgroundGroup,
        actor => actor.has_style_class_name?.('g-os-desktop-widget-media'));
    const verifyBounds = (widget, view) => {
        const [widgetX, widgetY] = widget.get_transformed_position();
        const [widgetWidth, widgetHeight] = widget.get_transformed_size();
        for (const actor of [view.title, view.artist, view.cover, ...Object.values(view.controls)]) {
            if (!actor?.mapped)
                continue;
            const [actorX, actorY] = actor.get_transformed_position();
            const [actorWidth, actorHeight] = actor.get_transformed_size();
            if (actorX < widgetX - 1 || actorY < widgetY - 1 || actorX + actorWidth > widgetX + widgetWidth + 1 ||
                actorY + actorHeight > widgetY + widgetHeight + 1)
                throw new Error(`Media content exceeds its widget: ${actor.get_style_class_name()}, ` +
                    `view=${view.get_style_class_name()}, widget=${widgetX},${widgetY},${widgetWidth},${widgetHeight}, ` +
                    `content=${actorX},${actorY},${actorWidth},${actorHeight}`);
        }
    };
    try {
        settings.set_boolean('desktop-widget-media', true);
        settings.set_boolean('dock-widget-media', true);
        await waitUntil(() => desktopWidget()?.mediaView.title.text === 'Piste de test 1' &&
            dockWidget()?.mediaView.title?.text === 'Piste de test 1');
        verifyBounds(desktopWidget(), desktopWidget().mediaView);
        verifyBounds(dockWidget(), dockWidget().mediaView);
        await capture('g-os-media-playing.png');
        desktopWidget().mediaView.controls.playPause.emit('clicked', 1);
        await waitUntil(() => commands.includes('PlayPause') && dockWidget().mediaView.controls.playPause.get_child().icon_name ===
            'media-playback-start-symbolic');
        dockWidget().mediaView.controls.next.emit('clicked', 1);
        await waitUntil(() => commands.includes('Next') && desktopWidget().mediaView.title.text === 'Piste de test 2');
        dockWidget().mediaView.controls.previous.emit('clicked', 1);
        await waitUntil(() => commands.includes('Previous') && desktopWidget().mediaView.title.text === 'Piste de test 1');
        desktopWidget().mediaView.controls.raise.emit('clicked', 1);
        await waitUntil(() => commands.includes('Raise'));
        settings.set_value('dock-widget-sizes', new GLib.Variant('a{si}', {media: 1}));
        await Scripting.sleep(350);
        const square = dockWidget();
        if (!square.dockWidgetSquare)
            throw new Error('Media square format did not apply');
        square.emit('clicked', 1);
        await Scripting.sleep(200);
        const expanded = findActor(square.shortcutMenu.box, actor => actor.updateMedia && actor.title);
        if (!expanded || expanded.title.text !== 'Piste de test 1')
            throw new Error('Media control panel did not open from the square widget');
        await capture('g-os-media-square-panel.png');
        square.shortcutMenu.close();
        settings.set_value('dock-widget-sizes', new GLib.Variant('a{si}', {media: 0}));
        settings.set_int('desktop-widget-width', 120);
        settings.set_int('icon-size', 24);
        for (const position of [0, 1, 2]) {
            settings.set_int('dock-position', position);
            await Scripting.sleep(350);
            verifyBounds(desktopWidget(), desktopWidget().mediaView);
            verifyBounds(dockWidget(), dockWidget().mediaView);
            await capture(`g-os-media-compact-position-${position}.png`);
        }
        Gio.bus_unown_name(owner);
        owner = 0;
        await waitUntil(() => desktopWidget().mediaView.title.text === 'Aucune lecture');
        if (desktopWidget().mediaView.controls.playPause.reactive || dockWidget().mediaView.controls.next.reactive)
            throw new Error('Media controls remain active after the player disappears');
        await capture('g-os-media-no-player.png');
        print('Native MPRIS widgets support desktop, Dock, commands, square panel, side Docks and missing players');
    } finally {
        if (owner)
            Gio.bus_unown_name(owner);
        rootExport.unexport();
        playerExport.unexport();
        settings.set_boolean('desktop-widget-media', false);
        settings.set_boolean('dock-widget-media', false);
    }
}

async function checkStackAlignment() {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(source.lookup(extensionMetadata['settings-schema'], true), null, null);
    const uri = Gio.File.new_for_path('/usr/share').get_uri();
    settings.set_strv('dock-folders', [uri]);
    settings.set_int('dock-folder-view', 0);
    settings.set_value('dock-view-options', new GLib.Variant('a{sa{si}}', {pile: {'max-files': 3}}));
    await Scripting.sleep(350);
    const check = async (findButton, image) => {
        const dock = Main.extensionManager.lookup(extensionMetadata.uuid).stateObj._screens[0].dock;
        const button = dock.get_children().find(findButton);
        if (!button)
            throw new Error('Stack folder button is missing');
        button.emit('clicked', 1);
        let stack;
        const findStack = actor => {
            if (actor.has_style_class_name?.('g-os-dock-folder-fan'))
                return actor;
            for (const child of actor.get_children()) {
                const found = findStack(child);
                if (found)
                    return found;
            }
            return null;
        };
        for (let attempt = 0; attempt < 60 && !stack; attempt++) {
            await Scripting.sleep(50);
            stack = findStack(button.folderMenu.box);
        }
        if (!stack)
            throw new Error('Stack did not open');
        const sourceIcon = button.get_child();
        const aligned = () => {
            const [sourceX] = sourceIcon.get_transformed_position();
            const [sourceWidth] = sourceIcon.get_transformed_size();
            const sourceCenter = sourceX + sourceWidth / 2;
            return stack.get_children().every(item => {
                const icon = item.get_child().get_children()[1];
                const [iconX] = icon.get_transformed_position();
                const [iconWidth] = icon.get_transformed_size();
                return Math.abs(iconX + iconWidth / 2 - sourceCenter) <= 2;
            });
        };
        for (let attempt = 0; attempt < 60 && !aligned(); attempt++)
            await Scripting.sleep(50);
        if (!aligned())
            throw new Error('Stack alignment did not settle on its source icon');
        const [sourceX] = sourceIcon.get_transformed_position();
        const [sourceWidth] = sourceIcon.get_transformed_size();
        const sourceCenter = sourceX + sourceWidth / 2;
        for (const item of stack.get_children()) {
            const [labelBox, icon] = item.get_child().get_children();
            const label = labelBox.get_child();
            const [iconX] = icon.get_transformed_position();
            const [iconWidth] = icon.get_transformed_size();
            const [labelX] = label.get_transformed_position();
            const [labelWidth] = label.get_transformed_size();
            const gap = iconX - labelX - labelWidth;
            if (Math.abs(iconX + iconWidth / 2 - sourceCenter) > 2 || item.rotation_angle_z !== 0 ||
                gap < 7 || gap > 9 || labelX < 0 || iconX + iconWidth > global.stage.width)
                throw new Error(`Stack alignment mismatch: icon=${iconX + iconWidth / 2}, source=${sourceCenter}, gap=${gap}`);
        }
            const lastIcon = stack.get_children().at(-1).get_child().get_children()[1];
            const [, lastY] = lastIcon.get_transformed_position();
            const [, lastHeight] = lastIcon.get_transformed_size();
            const [, dockY] = dock.get_transformed_position();
            const dockGap = dockY - lastY - lastHeight;
            if (dockGap < 0 || dockGap > 16) {
                Gio.File.new_for_path(`${GLib.getenv('MACOS_VISUAL_OUTPUT')}/stack-gap.json`).replace_contents(
                    new TextEncoder().encode(JSON.stringify({dockGap, dockY, lastY, lastHeight}, null, 2)),
                    null, false, Gio.FileCreateFlags.NONE, null);
                await capture('stack-gap-out-of-range.png');
                throw new Error(`Stack is too far from the Dock or overlaps it: gap=${dockGap}`);
            }
            print(`Native stack spacing: Dock gap=${Math.round(dockGap)}px, text/icon gap=8px`);
        await capture(image);
        button.folderMenu.close();
    };
    await check(actor => actor.folderUri === uri, 'g-os-folder-stack.png');
    settings.set_strv('dock-item-order', [`folder:${uri}`]);
    await Scripting.sleep(300);
    await check(actor => actor.folderUri === uri, 'g-os-folder-stack-first.png');
    const apps = global.settings.get_strv('favorite-apps').slice(0, 3);
    settings.set_string('dock-app-folders', JSON.stringify([{id: 'stack-test', name: 'Applications', apps, icon: '', view: 0}]));
    settings.set_strv('dock-item-order', ['app-folder:stack-test']);
    await Scripting.sleep(300);
    await check(actor => actor.appFolderId === 'stack-test', 'g-os-app-folder-stack.png');
    print('Native stack icons aligned above Dock source with labels on the left');
}

async function checkDockShadow() {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(source.lookup('org.gnome.shell.extensions.g-os-style', true), null, null);
    const requestedBackground = GLib.getenv('MACOS_DOCK_BACKGROUND_STYLE');
    const requestedPadding = GLib.getenv('MACOS_DOCK_PADDING_HORIZONTAL');
    if (requestedBackground !== null)
        settings.set_int('dock-background-style', Number(requestedBackground));
    if (requestedPadding !== null)
        settings.set_int('dock-padding-horizontal', Number(requestedPadding));
    for (const mode of [1, 4]) {
        settings.set_int('dock-hover-animation', mode);
        await Scripting.sleep(350);
        const actors = Main.layoutManager.uiGroup.get_children();
        const dock = actors.find(actor => actor instanceof St.ScrollView &&
            actor.get_child()?.has_style_class_name('g-os-dock'));
        const background = actors.find(actor => actor !== dock?.get_child() &&
            actor.has_style_class_name?.('g-os-dock'));
        if (!dock || !background || !background.visible || background.clip_to_allocation)
            throw new Error(`Dock background shadow is clipped or missing in mode ${mode}`);
        if (!dock.get_child().has_style_class_name('g-os-dock-magnification-content') ||
            !dock.clip_to_allocation || background.get_theme_node().get_border_radius(0) !== 28)
            throw new Error(`Dock content clipping or background radius incorrect in mode ${mode}`);
        if (requestedBackground !== null && Number(requestedBackground) !== 0) {
            const expectedAlpha = [undefined, 64, 255, 0][Number(requestedBackground)];
            if (Math.abs(background.get_theme_node().get_background_color().alpha - expectedAlpha) > 1)
                throw new Error(`Dock background opacity incorrect in mode ${mode}`);
        }
        if (requestedPadding !== null &&
            (dock.get_child().get_theme_node().get_padding(St.Side.LEFT) !== Number(requestedPadding) ||
                dock.get_child().get_theme_node().get_padding(St.Side.RIGHT) !== Number(requestedPadding)))
            throw new Error(`Dock horizontal padding incorrect in mode ${mode}`);
        const [dockX, dockY] = dock.get_transformed_position();
        const [dockWidth, dockHeight] = dock.get_transformed_size();
        const [backgroundX, backgroundY] = background.get_transformed_position();
        const [backgroundWidth, backgroundHeight] = background.get_transformed_size();
        const padding = mode === 4 ? Math.ceil(settings.get_int('icon-size') * 0.8) : 0;
        if (Math.abs(backgroundX - dockX - padding * 3) > 1 ||
            Math.abs(backgroundY - dockY - padding) > 1 ||
            Math.abs(backgroundWidth - dockWidth + padding * 6) > 1 ||
            Math.abs(backgroundHeight - dockHeight + padding) > 1)
            throw new Error(`Dock background alignment incorrect in mode ${mode}`);
        await capture(`g-os-dock-shadow-mode-${mode}.png`);
    }
    print('Native Dock shadow remains outside scroll clipping in normal and magnification modes');
}

async function checkMagnificationQuality() {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(source.lookup('org.gnome.shell.extensions.g-os-style', true), null, null);
    const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    interfaceSettings.set_boolean('enable-animations', true);
    settings.set_int('dock-hover-animation', 4);
    await Scripting.sleep(400);
    const dock = Main.layoutManager.uiGroup.get_children().find(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('g-os-dock'));
    const buttons = dock.get_child().get_children().filter(button => button.app);
    const button = buttons[Math.floor(buttons.length / 2)];
    const icon = button.icon.icon;
    const baseSize = settings.get_int('icon-size');
    if (icon.icon_size < Math.ceil(baseSize * 1.8) || icon.width !== baseSize || icon.height !== baseSize)
        throw new Error(`Icon texture/allocation mismatch: ${icon.icon_size}, ${icon.width}x${icon.height}`);
    await capture('g-os-magnification-sharp-normal.png');
    button.track_hover = false;
    button.hover = true;
    await Scripting.sleep(350);
    if (Math.abs(icon.scale_x - 1.8) > 0.01)
        throw new Error(`Icon did not magnify: ${icon.scale_x}`);
    await capture('g-os-magnification-sharp-wave.png');
    const pointer = global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const next = buttons[Math.min(buttons.length - 1, Math.floor(buttons.length / 2) + 1)];
    button.hover = false;
    button.track_hover = true;
    await Scripting.sleep(220);
    const [nextX, nextY] = next.get_transformed_position();
    const [nextWidth, nextHeight] = next.get_transformed_size();
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), nextX + nextWidth / 2, nextY + nextHeight / 2);
    await Scripting.sleep(50);
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), nextX + nextWidth / 2, nextY + nextHeight / 2);
    await Scripting.sleep(220);
    const nextIcon = next.icon?.icon ?? next.get_child();
    if (nextIcon.scale_x < 1.65)
        throw new Error(`Pointer-following magnification lagged behind: ${nextIcon.scale_x}; ` +
            `pointer=${global.get_pointer()}, target=${nextX + nextWidth / 2},${nextY + nextHeight / 2}, ` +
            `hover=${dock.hover}, nextHover=${next.hover}, scales=${buttons.map(item => item.icon.icon.scale_x)}`);
    const nearby = buttons[Math.max(0, Math.floor(buttons.length / 2) - 1)];
    const [nearX, nearY] = nearby.get_transformed_position();
    const [nearWidth, nearHeight] = nearby.get_transformed_size();
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), nearX + nearWidth / 2, nearY + nearHeight / 2);
    await Scripting.sleep(50);
    if ((nearby.icon?.icon ?? nearby.get_child()).scale_x < 1.35)
        throw new Error('Magnification did not follow the moving pointer');
    print(`Native sharp magnification: source=${icon.icon_size}, allocation=${icon.width}x${icon.height}`);
}

async function checkNativePointerDrag(dock, favorites) {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(source.lookup('org.gnome.shell.extensions.g-os-style', true), null, null);
    if (GLib.getenv('MACOS_POINTER_MAGNIFICATION') === '1') {
        new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean('enable-animations', true);
        settings.set_int('dock-hover-animation', 4);
        await Scripting.sleep(400);
    }
    const pointer = global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const currentDock = () => Main.layoutManager.uiGroup.get_children().find(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('g-os-dock'));
    const buttons = () => currentDock().get_child().get_children().filter(button => button.app);
    const center = actor => {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return [x + width / 2, y + height / 2, width];
    };
    const move = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    const press = state => pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, state);
    let [first, second] = buttons();
    const firstId = first.app.get_id();
    const secondId = second.app.get_id();
    let [startX, startY] = center(first);
    let [targetX, targetY, targetWidth] = center(second);
    move(startX, startY);
    await Scripting.sleep(60);
    move(startX, startY);
    await Scripting.sleep(60);
    press(Clutter.ButtonState.PRESSED);
    await Scripting.sleep(60);
    move(startX + 16, startY);
    await Scripting.sleep(80);
    move(targetX + targetWidth * 0.4, targetY);
    await Scripting.sleep(100);
    press(Clutter.ButtonState.RELEASED);
    await Scripting.sleep(400);
    if (settings.get_strv('dock-item-order').indexOf(`app:${firstId}`) <
        settings.get_strv('dock-item-order').indexOf(`app:${secondId}`) ||
        !settings.get_strv('dock-item-order').includes(`app:${firstId}`))
        throw new Error('Pointer drag did not reorder the two applications');
    const displayed = buttons().map(button => button.app.get_id());
    if (displayed.indexOf(firstId) < displayed.indexOf(secondId))
        throw new Error('Saved order did not update the displayed Dock');
    move(0, 0);
    await Scripting.sleep(250);
    first = buttons().find(button => button.app.get_id() === firstId);
    second = buttons().find(button => button.app.get_id() === secondId);
    [startX, startY] = center(first);
    [targetX, targetY] = center(second);
    move(startX, startY);
    await Scripting.sleep(60);
    press(Clutter.ButtonState.PRESSED);
    await Scripting.sleep(60);
    move(startX - 16, startY);
    await Scripting.sleep(80);
    move(targetX, targetY);
    await Scripting.sleep(500);
    press(Clutter.ButtonState.RELEASED);
    await Scripting.sleep(500);
    const groups = JSON.parse(settings.get_string('dock-app-folders'));
    if (!groups.some(group => group.apps.includes(firstId) && group.apps.includes(secondId)))
        throw new Error('Pointer drag did not group the two applications');
    const folder = groups.find(group => group.apps.includes(firstId) && group.apps.includes(secondId));
    const folderButton = currentDock().get_child().get_children().find(button => button.appFolderId === folder.id);
    const addedButton = buttons().find(button => ![firstId, secondId].includes(button.app.get_id()));
    if (!folderButton || !addedButton)
        throw new Error('Created application folder or remaining app is missing');
    const [addedX, addedY] = center(addedButton);
    const [folderX, folderY] = center(folderButton);
    move(addedX, addedY);
    await Scripting.sleep(60);
    press(Clutter.ButtonState.PRESSED);
    await Scripting.sleep(60);
    move(addedX + 16, addedY);
    await Scripting.sleep(80);
    move(folderX, folderY);
    await Scripting.sleep(500);
    press(Clutter.ButtonState.RELEASED);
    await Scripting.sleep(500);
    const updatedGroups = JSON.parse(settings.get_string('dock-app-folders'));
    if (!updatedGroups.some(group => group.id === folder.id && group.apps.includes(addedButton.app.get_id())))
        throw new Error('Pointer drag did not add an app to an existing application folder');
    settings.set_string('dock-app-folders', '[]');
    settings.set_strv('dock-item-order', []);
    global.settings.set_strv('favorite-apps', favorites);
    await Scripting.sleep(200);
    print('Native pointer drag reorder, folder creation, and existing-folder add completed');
    return Main.layoutManager.uiGroup.get_children().find(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('g-os-dock'));
}

function findActor(root, predicate) {
    if (predicate(root))
        return root;
    for (const child of root.get_children?.() ?? []) {
        const match = findActor(child, predicate);
        if (match)
            return match;
    }
    return null;
}

async function checkLaunchpadContextMenu() {
    const dock = Main.layoutManager.uiGroup.get_children().find(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('g-os-dock'));
    const button = dock?.get_child().get_children().find(actor =>
        actor.dockFocusKey === 'shortcut:applications');
    if (!button)
        throw new Error('Launchpad dock button is missing');

    const [x, y] = button.get_transformed_position();
    const [width, height] = button.get_transformed_size();
    const pointer = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
    await Scripting.sleep(100);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
    await Scripting.sleep(80);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
    await Scripting.sleep(200);

    const menu = button.shortcutMenu;
    if (!menu?.isOpen)
        throw new Error('Launchpad right-click did not open its menu');
    const labels = menu._getMenuItems().map(item => item.label?.text).filter(Boolean);
    for (const label of ['Redémarrer', 'Éteindre', 'Se déconnecter', 'Préférences macOS Style',
        'Paramètres système', 'Verrouiller la session', 'Suspendre']) {
        if (!labels.includes(label))
            throw new Error(`Launchpad menu is missing ${label}`);
    }
    menu.close();
    print('Native Launchpad right-click menu opened with system actions');
}

async function waitForExtension() {
    const uuid = extensionMetadata.uuid;
    const hasCustomPanel = () => Boolean(findActor(Main.layoutManager.uiGroup,
        actor => actor.has_style_class_name?.('g-os-secondary-panel')));
    if (hasCustomPanel())
        return;
    await new Promise((resolve, reject) => {
        let signal = 0;
        const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
            Main.extensionManager.disconnect(signal);
            reject(new Error('Extension did not become ready'));
            return GLib.SOURCE_REMOVE;
        });
        signal = Main.extensionManager.connect('extension-state-changed', (manager, extension) => {
            if (extension.uuid !== uuid)
                return;
            if (hasCustomPanel()) {
                Main.extensionManager.disconnect(signal);
                GLib.source_remove(timeout);
                resolve();
            }
        });
    });
}

async function capture(name) {
    const directory = GLib.getenv('MACOS_VISUAL_OUTPUT');
    if (!directory)
        throw new Error('MACOS_VISUAL_OUTPUT must name an output directory');
    GLib.mkdir_with_parents(directory, 0o755);
    const file = Gio.File.new_for_path(GLib.build_filenamev([directory, name]));
    const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    try {
        const screenshot = new Shell.Screenshot();
        await screenshot.screenshot(false, stream);
    } finally {
        stream.close(null);
    }
}

async function checkDockReorder(dock, favorites) {
    const buttons = dock.get_child().get_children().filter(actor => actor._dockDraggable);
    if (buttons.length < 2)
        throw new Error('Two favorites are required for the reorder preview test');
    const dragged = buttons[0];
    const neighbor = buttons[1];
    const last = buttons.at(-1);
    const [lastX, lastY] = last.get_transformed_position();
    const [lastWidth, lastHeight] = last.get_transformed_size();
    if (lastWidth <= 0 || !Number.isFinite(lastX))
        throw new Error('Dock allocation is invalid before the reorder test');
    const monitorsBefore = DND.dragMonitors.length;
    dragged._dockDraggable.emit('drag-begin', global.get_current_time());
    DND.dragMonitors.at(-1).dragMotion({x: lastX + lastWidth, y: lastY + lastHeight / 2});
    await Scripting.waitLeisure();
    if (neighbor.translation_x >= 0 || dragged.opacity !== 0)
        throw new Error(`Dock preview mismatch: neighbor=${neighbor.translation_x}, opacity=${dragged.opacity}`);
    if (global.settings.get_strv('favorite-apps').join() !== favorites.join())
        throw new Error('Reorder preview persisted favorites before the drop');
    await capture('g-os-dock-reorder.png');
    dragged._dockDraggable.emit('drag-cancelled', global.get_current_time());
    dragged._dockDraggable.emit('drag-end', global.get_current_time(), false);
    await Scripting.waitLeisure();
    if (neighbor.translation_x !== 0 || dragged.opacity !== 255 || DND.dragMonitors.length !== monitorsBefore)
        throw new Error('Cancelled Dock preview was not cleaned up');
    print('Native Dock reorder preview and cancellation completed');
}

async function checkMixedDockOrder() {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(schemaSource.lookup('org.gnome.shell.extensions.g-os-style', true), null, null);
    const uri = Gio.File.new_for_path(GLib.get_tmp_dir()).get_uri();
    const folderKey = `folder:${uri}`;
    const getDocks = () => Main.layoutManager.uiGroup.get_children().filter(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('g-os-dock'));
    for (const radius of [0, 12, 48, 28]) {
        settings.set_int('dock-border-radius', radius);
        await Scripting.waitLeisure();
        for (const dock of getDocks()) {
            const measured = dock.get_child().get_theme_node().get_border_radius(0);
            if (measured !== radius)
                throw new Error(`Dock corner radius is ${measured}, expected ${radius}`);
        }
        if (radius === 12)
            await capture('g-os-dock-radius.png');
    }
    print('Native Dock radius settings applied by the external theme');
    const checkBadge = button => {
        const icon = button.icon.icon;
        const badge = button.notificationBadge;
        const [iconX, iconY] = icon.get_transformed_position();
        const [iconWidth] = icon.get_transformed_size();
        const [badgeX, badgeY] = badge.get_transformed_position();
        const [badgeWidth, badgeHeight] = badge.get_transformed_size();
        if (Math.abs(badgeX + badgeWidth / 2 - iconX - iconWidth) > 1 ||
            Math.abs(badgeY + badgeHeight / 2 - iconY) > 1)
            throw new Error(`Badge center=${badgeX + badgeWidth / 2},${badgeY + badgeHeight / 2}; ` +
                `icon corner=${iconX + iconWidth},${iconY}; badge=${badgeWidth}x${badgeHeight}`);
        if (badgeWidth > 20 || badgeHeight > 20 || badgeWidth < 12)
            throw new Error(`Notification badge dimensions are not compact: ${badgeWidth}x${badgeHeight}`);
    };
    const normalBadgeButton = getDocks()[0].get_child().get_children().find(button => button.app);
    normalBadgeButton.notificationBadge.text = '3';
    normalBadgeButton.notificationBadge.show();
    await Scripting.waitLeisure();
    checkBadge(normalBadgeButton);
    await capture('g-os-dock-notification-badge.png');
    normalBadgeButton.notificationBadge.hide();
    const animationSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const originalAnimations = animationSettings.get_boolean('enable-animations');
    animationSettings.set_boolean('enable-animations', true);
    const waitForAnimation = condition => new Promise((resolve, reject) => {
        let attempts = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            if (condition()) {
                resolve();
                return GLib.SOURCE_REMOVE;
            }
            if (++attempts >= 120) {
                reject(new Error('Magnification animation did not reach its target'));
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    });
    await waitForAnimation(() => St.Settings.get().enable_animations);
    const normalSize = getDocks()[0].get_child().get_transformed_size();
    settings.set_int('dock-hover-animation', 4);
    await Scripting.waitLeisure();
    const waveDock = getDocks()[0];
    const waveButtons = waveDock.get_child().get_children().filter(actor => actor.dockFocusKey);
    const targetIndex = Math.min(3, Math.floor(waveButtons.length / 2));
    const waveTarget = waveButtons[targetIndex];
    const waveIcon = button => button.icon?.icon ?? button.get_child();
    waveTarget.notificationBadge.text = '3';
    waveTarget.notificationBadge.show();
    waveTarget.track_hover = false;
    waveTarget.hover = true;
    await waitForAnimation(() => Math.abs(waveIcon(waveTarget).scale_x - 1.8) < 0.001);
    await Scripting.waitLeisure();
    checkBadge(waveTarget);
    if (Math.abs(waveIcon(waveTarget).scale_x - 1.8) > 0.001 ||
        waveIcon(waveButtons[targetIndex - 1]).scale_x <= 1 ||
        waveIcon(waveButtons[targetIndex - 1]).scale_x >= waveIcon(waveTarget).scale_x)
        throw new Error('Native Magnification did not enlarge the target and its neighbors progressively');
    const background = Main.layoutManager.uiGroup.get_children().find(actor =>
        actor !== waveDock.get_child() && actor.has_style_class_name?.('g-os-dock'));
    if (!background || background.width <= normalSize[0] || Math.abs(background.height - normalSize[1]) > 1)
        throw new Error('Magnification background did not follow the expanded icon row');
    await capture('g-os-dock-magnification.png');
    waveTarget.hover = false;
    await waitForAnimation(() => waveIcon(waveTarget).scale_x === 1);
    await waitForAnimation(() => Math.abs(background.width - normalSize[0]) < 1);
    if (waveIcon(waveTarget).scale_x !== 1)
        throw new Error('Native Magnification did not reset after leaving the icon');
    settings.set_int('dock-hover-animation', 1);
    await Scripting.waitLeisure();
    const simpleTarget = getDocks()[0].get_child().get_children().find(actor => actor.dockFocusKey);
    simpleTarget.track_hover = false;
    simpleTarget.hover = true;
    await waitForAnimation(() => Math.abs(waveIcon(simpleTarget).scale_x - 1.18) < 0.001);
    if (Math.abs(waveIcon(simpleTarget).scale_x - 1.18) > 0.001)
        throw new Error('The existing Agrandir mode changed');
    settings.set_int('dock-hover-animation', 0);
    animationSettings.set_boolean('enable-animations', originalAnimations);
    await Scripting.waitLeisure();
    print('Native distinct Magnification wave and unchanged Agrandir mode completed');
    print('Native compact badge centered on normal and magnified icons completed');
    settings.set_strv('dock-folders', [uri]);
    await Scripting.waitLeisure();
    const dock = getDocks()[0];
    const buttons = dock.get_child().get_children().filter(actor => actor.dockFocusKey);
    const folder = buttons.find(actor => actor.dockFocusKey === folderKey);
    if (!folder?._dockDraggable || !buttons.every(actor => actor._dockDraggable))
        throw new Error('All mixed Dock icons must be draggable');
    const [firstX, firstY] = buttons[0].get_transformed_position();
    const [, firstHeight] = buttons[0].get_transformed_size();
    folder._dockDraggable.emit('drag-begin', global.get_current_time());
    DND.dragMonitors.at(-1).dragMotion({x: firstX - 1, y: firstY + firstHeight / 2});
    await Scripting.waitLeisure();
    if (buttons[0].translation_x <= 0 || settings.get_strv('dock-item-order').length !== 0)
        throw new Error('Mixed Dock preview did not shift apps without persisting');
    if (!dock.get_child()._delegate.acceptDrop(folder._delegate))
        throw new Error('Dock refused a folder dropped among applications');
    folder._dockDraggable.emit('drag-end', global.get_current_time(), true);
    await Scripting.waitLeisure();
    if (settings.get_strv('dock-item-order')[0] !== folderKey ||
        getDocks()[0].get_child().get_children()[0].dockFocusKey !== folderKey)
        throw new Error('Mixed folder/application order was not persisted and rendered');
    await capture('g-os-dock-mixed.png');
    const gridUri = Gio.File.new_for_path('/usr/share').get_uri();
    settings.set_strv('dock-folders', [uri, gridUri]);
    settings.set_value('dock-folder-views', new GLib.Variant('a{si}', {[uri]: 0, [gridUri]: 1}));
    await Scripting.waitLeisure();
    const waitForFolder = (menu, style) => new Promise((resolve, reject) => {
        let attempts = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const content = menu.box.get_children().flatMap(item => item.get_children())
                .find(item => item.has_style_class_name(style));
            if (content) {
                resolve(content);
                return GLib.SOURCE_REMOVE;
            }
            if (++attempts >= 120) {
                reject(new Error(`Folder menu did not render ${style}`));
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    });
    const fanButton = getDocks()[0].get_child().get_children().find(actor => actor.folderUri === uri);
    fanButton.emit('clicked', 1);
    const fanContent = await waitForFolder(fanButton.folderMenu, 'g-os-dock-folder-fan');
    await Scripting.waitLeisure();
    const fanItems = fanContent.get_children();
    const [fanX, fanY] = fanContent.get_transformed_position();
    const [fanWidth, fanHeight] = fanContent.get_transformed_size();
    print(`Fan geometry: ${fanX},${fanY} ${fanWidth}x${fanHeight}, ` +
        `menu visible=${fanButton.folderMenu.actor.visible}, opacity=${fanButton.folderMenu.actor.opacity}`);
    if (fanWidth <= 0 || fanHeight <= 0 || fanY < 0 || fanY + fanHeight > global.stage.height ||
        !fanButton.folderMenu.actor.visible ||
        fanButton.folderMenu.actor.opacity !== 255)
        throw new Error('Folder fan is not visible with a valid allocation');
    if (fanItems.length < 2)
        throw new Error('The native fan test needs two folder entries');
    for (let index = 1; index < fanItems.length; index++) {
        const previous = fanItems[index - 1].get_child().get_children()[0];
        const current = fanItems[index].get_child().get_children()[0];
        const [, previousY] = previous.get_transformed_position();
        const [, previousHeight] = previous.get_transformed_size();
        const [, currentY] = current.get_transformed_position();
        if (previousY + previousHeight > currentY)
            throw new Error('Folder fan labels overlap');
    }
    await capture('g-os-folder-fan.png');
    fanButton.folderMenu.close();
    const gridButton = getDocks()[0].get_child().get_children().find(actor => actor.folderUri === gridUri);
    gridButton.emit('clicked', 1);
    await waitForFolder(gridButton.folderMenu, 'g-os-dock-folder-grid');
    await Scripting.waitLeisure();
    await capture('g-os-folder-grid.png');
    gridButton.folderMenu.close();
    const applicationButtons = getDocks()[0].get_child().get_children().filter(button => button.app);
    const groupTarget = applicationButtons[0];
    const groupSource = applicationButtons[1];
    const [targetWidth, targetHeight] = groupTarget.get_transformed_size();
    if (!groupTarget._delegate.acceptDrop(groupSource._delegate, null, targetWidth / 2, targetHeight / 2))
        throw new Error('Native application drop did not create a folder');
    await Scripting.waitLeisure();
    let groups = JSON.parse(settings.get_string('dock-app-folders'));
    const groupId = groups[0].id;
    const groupButton = () => getDocks()[0].get_child().get_children().find(button => button.appFolderId === groupId);
    for (const app of applicationButtons.slice(2, 4).map(button => button.app)) {
        const [width, height] = groupButton().get_transformed_size();
        if (!groupButton()._delegate.acceptDrop({app}, null, width / 2, height / 2))
            throw new Error('Native application drop did not add a folder member');
        await Scripting.waitLeisure();
    }
    const miniature = groupButton().get_child().get_children();
    if (miniature.length !== 4)
        throw new Error('Application folder does not preview its first four icons');
    const positions = miniature.map(icon => icon.get_position());
    if (positions[0][0] !== positions[2][0] || positions[1][0] !== positions[3][0] ||
        positions[0][1] !== positions[1][1] || positions[2][1] !== positions[3][1])
        throw new Error('Application folder preview is not aligned in a 2x2 grid');
    await new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
    await capture('g-os-app-folder-preview.png');
    groups = JSON.parse(settings.get_string('dock-app-folders'));
    groups[0].view = 1;
    settings.set_string('dock-app-folders', JSON.stringify(groups));
    await Scripting.waitLeisure();
    let applicationFolder = groupButton();
    applicationFolder.emit('clicked', 1);
    const appGrid = await waitForFolder(applicationFolder.folderMenu, 'g-os-dock-folder-grid');
    await Scripting.waitLeisure();
    const gridItems = appGrid.get_children().flatMap(row => row.get_children());
    const gridSizes = gridItems.map(item => item.get_transformed_size());
    if (gridSizes.some(size => size[0] !== gridSizes[0][0] || size[1] !== gridSizes[0][1]))
        throw new Error('Application folder grid cells are not aligned');
    await capture('g-os-app-folder-grid.png');
    applicationFolder.folderMenu.close();
    groups[0].view = 0;
    settings.set_string('dock-app-folders', JSON.stringify(groups));
    await Scripting.waitLeisure();
    applicationFolder = groupButton();
    applicationFolder.emit('clicked', 1);
    const appFan = await waitForFolder(applicationFolder.folderMenu, 'g-os-dock-folder-fan');
    await Scripting.waitLeisure();
    const appItems = appFan.get_children();
    for (let index = 1; index < appItems.length; index++) {
        const previous = appItems[index - 1].get_child().get_children()[0];
        const current = appItems[index].get_child().get_children()[0];
        const [, previousY] = previous.get_transformed_position();
        const [, previousHeight] = previous.get_transformed_size();
        const [, currentY] = current.get_transformed_position();
        if (previousY + previousHeight > currentY)
            throw new Error('Application folder fan labels overlap');
    }
    await capture('g-os-app-folder-fan.png');
    applicationFolder.folderMenu.close();
    groups[0].icon = 'folder-games';
    settings.set_string('dock-app-folders', JSON.stringify(groups));
    await Scripting.waitLeisure();
    if (groupButton().get_child().icon_name !== 'folder-games')
        throw new Error('Custom application folder icon was not applied');
    settings.set_string('dock-app-folders', '[]');
    await Scripting.waitLeisure();
    print('Native application grouping, 2x2 preview, grid/fan alignment and custom icon completed');
    settings.set_value('dock-folder-views', new GLib.Variant('a{si}', {}));
    print('Native per-folder fan/grid modes and non-overlapping fan labels completed');
    settings.set_strv('dock-item-order', []);
    settings.set_strv('dock-folders', []);
    await Scripting.waitLeisure();
    print('Native mixed Dock folder/application drop completed');
    return getDocks();
}

export async function run() {
    if (GLib.getenv('G_OS_FEATURE_TEST') || GLib.getenv('G_OS_EXPLORATORY_TEST') === '1' || GLib.getenv('G_OS_INKSCAPE_MENU_TEST') === '1' || GLib.getenv('G_OS_GLOBAL_MENU_TEST') === '1' || GLib.getenv('G_OS_WINDOW_PREVIEW_TEST') === '1' || GLib.getenv('G_OS_COVERFLOW_TEST') === '1' || GLib.getenv('G_OS_MAGNIFICATION_TEST') === '1' || GLib.getenv('G_OS_DOCK_CONTEXT_TEST') === '1' || GLib.getenv('G_OS_APP_GRID_FAVORITES_TEST') === '1' || GLib.getenv('G_OS_RESERVED_OVERVIEW_TEST') === '1' || GLib.getenv('G_OS_DOCK_APP_GRID_DROP_TEST') === '1') {
        await waitForExtension();
        loadShellTheme(GLib.getenv('G_OS_COVERFLOW_THEME') ?? GLib.getenv('MACOS_THEME_DIR'));
        await startCurrentMenuTest();
        if (GLib.getenv('G_OS_FEATURE_TEST') || GLib.getenv('G_OS_EXPLORATORY_TEST') === '1')
            await new Promise(() => {});
        return;
    }
    await waitForExtension();
    if (GLib.getenv('MACOS_THEME_DIR')) {
        loadShellTheme();
        const extraStylesheet = GLib.getenv('MACOS_THEME_EXTRA');
        if (extraStylesheet)
            St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(Gio.File.new_for_path(extraStylesheet));
        await Scripting.sleep(200);
    }
    const apps = Shell.AppSystem.get_default();
    const favorites = [
        'org.gnome.Nautilus.desktop', 'org.gnome.Settings.desktop',
        'org.gnome.TextEditor.desktop', 'org.gnome.Console.desktop',
        'org.mozilla.firefox.desktop', 'firefox.desktop', 'org.gnome.Calculator.desktop',
    ].filter(id => apps.lookup_app(id));
    global.settings.set_strv('favorite-apps', favorites);
    Main.overview.hide();
    await Scripting.sleep(300);
    let primaryPanel = findActor(Main.layoutManager.uiGroup,
        actor => actor.has_style_class_name?.('g-os-secondary-panel'));
    if (!primaryPanel || Main.panel.visible)
        throw new Error('Custom panel was not rendered or the native panel is still visible');
    let button = findActor(primaryPanel,
        actor => actor.has_style_class_name?.('g-os-panel-menu'));
    if (!button?.menu)
        throw new Error('Custom panel menu was not rendered');
    let docks = Main.layoutManager.uiGroup.get_children().filter(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('g-os-dock'));
    if (docks.length === 0 || !docks.every(actor => actor.visible && actor.width > 100 && actor.height > 30))
        throw new Error('Dock was not rendered at a usable size');
    const [dockX, dockY] = docks[0].get_transformed_position();
    const [dockWidth, dockHeight] = docks[0].get_transformed_size();
    print(`Dock allocation: ${Math.round(dockX)},${Math.round(dockY)} ${Math.round(dockWidth)}x${Math.round(dockHeight)}`);
    if (GLib.getenv('MACOS_FLUX_ONLY') === '1') {
        await checkFluxWidgets();
        return;
    }
    if (GLib.getenv('MACOS_SIMPLE_WIDGETS_ONLY') === '1') {
        await checkSimpleWidgets();
        return;
    }
    if (GLib.getenv('MACOS_DOCK_COVERAGE_ONLY') === '1') {
        await checkDockWindowCoverage();
        return;
    }
    if (GLib.getenv('MACOS_RESERVED_DOCK_ONLY') === '1') {
        const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
            Gio.SettingsSchemaSource.get_default(), false);
        const settings = Gio.Settings.new_full(schemaSource.lookup('org.gnome.shell.extensions.g-os-style', true), null, null);
        settings.set_boolean('reserve-dock-space', true);
        await Scripting.sleep(300);
        await checkNativePointerDrag(docks[0], favorites);
        return;
    }
    if (GLib.getenv('MACOS_UTILITY_WIDGETS_ONLY') === '1') {
        await checkUtilityWidgets();
        return;
    }
    if (GLib.getenv('MACOS_WIDGETS_ONLY') === '1') {
        await checkWidgetSystem();
        return;
    }
    if (GLib.getenv('MACOS_MEDIA_ONLY') === '1') {
        await checkMediaWidgets();
        return;
    }
    if (GLib.getenv('MACOS_PANEL_ONLY') === '1') {
        const requestedHeight = GLib.getenv('MACOS_PANEL_HEIGHT');
        const requestedHorizontalPadding = GLib.getenv('MACOS_PANEL_PADDING_HORIZONTAL');
        const requestedVerticalPadding = GLib.getenv('MACOS_PANEL_PADDING_VERTICAL');
        const captureWidgets = GLib.getenv('MACOS_CAPTURE_WIDGETS') === '1';
        const minimalPanel = GLib.getenv('MACOS_PANEL_MINIMAL') === '1';
        if (requestedHeight || requestedHorizontalPadding || requestedVerticalPadding || captureWidgets || minimalPanel) {
            const extensionInfo = Main.extensionManager.lookup('hello-world@greg.local');
            const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
                extensionInfo.dir.get_child('schemas').get_path(), Gio.SettingsSchemaSource.get_default(), false);
            const schema = schemaSource.lookup('org.gnome.shell.extensions.g-os-style', true);
            const settings = new Gio.Settings({settings_schema: schema});
            if (requestedHeight)
                settings.set_int('panel-height', Number(requestedHeight));
            if (requestedHorizontalPadding)
                settings.set_int('panel-padding-horizontal', Number(requestedHorizontalPadding));
            if (requestedVerticalPadding)
                settings.set_int('panel-padding-vertical', Number(requestedVerticalPadding));
            if (minimalPanel) {
                for (const kind of ['clock', 'search', 'preferences', 'wifi', 'bluetooth', 'sound', 'battery'])
                    settings.set_boolean(`panel-show-${kind}`, false);
            }
            if (captureWidgets) {
                for (const key of ['desktop-widget-clock', 'desktop-widget-calendar',
                    'dock-widget-clock', 'dock-widget-calendar'])
                    settings.set_boolean(key, true);
            }
            await Scripting.sleep(200);
            if (captureWidgets &&
                (!findActor(Main.layoutManager._backgroundGroup,
                    actor => actor.has_style_class_name?.('g-os-desktop-widget')) ||
                    !findActor(Main.layoutManager.uiGroup,
                        actor => actor.has_style_class_name?.('g-os-dock-widget'))))
                throw new Error('Desktop or Dock widgets were not created for the theme capture');
            primaryPanel = findActor(Main.layoutManager.uiGroup,
                actor => actor.has_style_class_name?.('g-os-secondary-panel'));
            const [, actualHeight] = primaryPanel.get_transformed_size();
            if (requestedHeight && Math.round(actualHeight) !== Number(requestedHeight))
                throw new Error(`Top bar height was ${actualHeight}, expected ${requestedHeight}`);
            button = findActor(primaryPanel,
                actor => actor.has_style_class_name?.('g-os-panel-menu'));
            if (requestedHeight || requestedHorizontalPadding || requestedVerticalPadding) {
                const metrics = `height-${Math.round(actualHeight)}-horizontal-${settings.get_int('panel-padding-horizontal')}-` +
                    `vertical-${settings.get_int('panel-padding-vertical')}`;
                print(`Top bar metrics applied: ${metrics}`);
                await capture(`g-os-topbar-${metrics}.png`);
            }
        }
        await capture('g-os-topbar-desktop.png');
        const statusButtons = ['wifi', 'bluetooth', 'sound', 'brightness', 'battery']
            .map(kind => findActor(primaryPanel, actor => actor.statusKind === kind));
        if (statusButtons.some(button => !button))
            throw new Error('Custom system status icons were not rendered');
        if (minimalPanel) {
            const clock = findActor(primaryPanel, actor => actor.get_name?.() === 'g-os-panel-clock');
            const optionalButtons = ['Rechercher', 'Préférences macOS Style']
                .map(name => findActor(primaryPanel, actor => actor.accessible_name === name));
            if (!clock || clock.visible || optionalButtons.some(button => !button) ||
                [...statusButtons, ...optionalButtons].some(actor => actor.visible))
                throw new Error('Optional controls remain visible in the minimal top bar');
        } else {
            const quickSettings = Main.panel.statusArea.quickSettings.menu;
            for (const statusButton of statusButtons) {
                statusButton.emit('clicked', null);
                await Scripting.sleep(200);
                if (!statusButton.statusMenu?.isOpen || quickSettings.isOpen)
                    throw new Error(`Independent ${statusButton.statusKind} menu did not open`);
                const controller = statusButton.statusController;
                if (statusButton.statusKind === 'sound' && (!controller.slider.mapped || !controller.muteButton.mapped))
                    throw new Error('Sound menu mute button or volume slider is missing');
                if (statusButton.statusKind === 'brightness' &&
                    (!controller.brightnessSlider.mapped || !controller.nightLightToggle ||
                        (controller.temperatureRow.visible && !controller.temperatureSlider.mapped)))
                    throw new Error('Brightness or enabled night-light controls are missing');
                const audioSnapshot = statusButton.statusKind === 'sound' && controller.stream
                    ? {stream: controller.stream, volume: controller.stream.volume, muted: controller.stream.is_muted} : null;
                if (statusButton.statusKind === 'sound' && GLib.getenv('MACOS_AUDIO_REQUIRED') === '1' && !audioSnapshot)
                    throw new Error('Native audio output did not appear in the sound menu');
                await capture(`g-os-topbar-${statusButton.statusKind}-menu.png`);
                statusButton.statusMenu.close();
                if (audioSnapshot && (audioSnapshot.stream.volume !== audioSnapshot.volume ||
                    audioSnapshot.stream.is_muted !== audioSnapshot.muted))
                    throw new Error('Opening the sound menu changed the volume or mute state');
                if (controller.content?.saved)
                    throw new Error('Native submenu was not restored after closing the status menu');
            }
            print('Native top bar icons open independent sound, network, Bluetooth, brightness and battery menus');
        }
        const sessionButton = findActor(primaryPanel,
            actor => actor.has_style_class_name?.('g-os-session-button'));
        if (!sessionButton?.menu)
            throw new Error('Custom session menu was not rendered');
        sessionButton.menu.open();
        await Scripting.waitLeisure();
        if (!sessionButton.menu.isOpen)
            throw new Error('Custom session menu did not open');
        await capture('g-os-topbar-session.png');
        sessionButton.menu.close();
        if (minimalPanel)
            print('Native minimal top bar hides optional controls and keeps the session menu accessible');
        return;
    }
    if (GLib.getenv('MACOS_DOCK_WIDGETS_ONLY') === '1') {
        await checkDockWidgets();
        return;
    }
    if (GLib.getenv('MACOS_VIEW_OPTIONS_ONLY') === '1') {
        await checkFolderViewOptions();
        return;
    }
    if (GLib.getenv('MACOS_STACK_ONLY') === '1') {
        await checkStackAlignment();
        return;
    }
    if (GLib.getenv('MACOS_SHADOW_ONLY') === '1') {
        await checkDockShadow();
        return;
    }
    if (GLib.getenv('MACOS_WAVE_ONLY') === '1') {
        await checkMagnificationQuality();
        return;
    }
    docks[0] = await checkNativePointerDrag(docks[0], favorites);
    if (!nativeMenu?.isOpen)
        throw new Error('Native application menu did not open');
    global.settings.set_strv('favorite-apps', [...favorites].reverse());
    await Scripting.waitLeisure();
        const statusButtons = ['wifi', 'bluetooth', 'sound', 'brightness', 'battery']
            .map(kind => findActor(primaryPanel, actor => actor.statusKind === kind));
        if (statusButtons.some(button => !button))
            throw new Error('Custom system status icons were not rendered');
        const quickSettings = Main.panel.statusArea.quickSettings.menu;
        statusButtons[0].emit('clicked');
        throw new Error('Application menu was closed while updating the Dock');
        if (!quickSettings.isOpen || quickSettings.sourceActor !== statusButtons[0])
            throw new Error('Quick Settings did not open from the Wi-Fi icon');
        await capture('g-os-topbar-quick-settings.png');
        quickSettings.close();
        const sessionButton = findActor(primaryPanel,
            actor => actor.has_style_class_name?.('g-os-session-button'));
        if (!sessionButton?.menu)
            throw new Error('Custom session menu was not rendered');
        sessionButton.menu.open();
        await Scripting.waitLeisure();
        if (!sessionButton.menu.isOpen)
            throw new Error('Custom session menu did not open');
        await capture('g-os-topbar-session.png');
        sessionButton.menu.close();
    global.stage.set_key_focus(null);
    global.settings.set_strv('favorite-apps', favorites);
    await Scripting.waitLeisure();
    print('Native application menu survived Dock updates');
    await capture('g-os-desktop.png');
    button.menu.open();
    await Scripting.waitLeisure();
    if (!button.menu.isOpen)
        throw new Error('Extension menu did not open');
    await capture('g-os-menu.png');
    button.menu.close();
    print('Visual smoke test completed');
}