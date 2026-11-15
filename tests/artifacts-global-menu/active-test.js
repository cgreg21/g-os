import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};

async function checkNativeGlobalMenu() {
    const extension = Main.extensionManager.lookup('hello-world@greg.local').stateObj;
    const script = `
        imports.gi.versions.Gtk = '3.0';
        const Gtk = imports.gi.Gtk;
        const Gio = imports.gi.Gio;
        const GLib = imports.gi.GLib;
        const app = new Gtk.Application({application_id: 'org.gos.GlobalMenuTest'});
        let window;
        app.connect('startup', () => {
            const action = new Gio.SimpleAction({name: 'test'});
            action.connect('activate', () => window.set_title('Global menu action executed'));
            app.add_action(action);
            const option = new Gio.SimpleAction({name: 'option', state: new GLib.Variant('b', true)});
            option.connect('activate', () => option.set_state(new GLib.Variant('b', !option.get_state().get_boolean())));
            app.add_action(option);
            const disabled = new Gio.SimpleAction({name: 'disabled'});
            disabled.set_enabled(false);
            app.add_action(disabled);
            const file = new Gio.Menu();
            file.append('_Tester', 'app.test');
            file.append('_Option', 'app.option');
            file.append('_Indisponible', 'app.disabled');
            const bar = new Gio.Menu();
            bar.append_submenu('_Fichier', file);
            app.set_menubar(bar);
        });
        app.connect('activate', () => {
            window = new Gtk.ApplicationWindow({application: app, title: 'Global menu test',
                default_width: 480, default_height: 280, show_menubar: true});
            window.add(new Gtk.Label({label: 'Application GTK de test'}));
            window.show_all();
            window.present();
        });
        app.run([]);
    `;
    const process = Gio.Subprocess.new(['gjs', '-c', script], Gio.SubprocessFlags.NONE);
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (predicate())
                return;
            await Scripting.sleep(50);
        }
        throw new Error('Native GTK global menu did not reach the expected state');
    };
    try {
        let window;
        await waitUntil(() => {
            window = global.get_window_actors().map(actor => actor.meta_window)
                .find(candidate => candidate.get_title() === 'Global menu test');
            return Boolean(window);
        });
        Main.activateWindow(window);
        await waitUntil(() => extension._screens.some(screen => screen.globalMenu?.buttons.some(entry => entry.label === 'Fichier')));
        const screen = extension._screens[window.get_monitor()];
        const controller = screen.globalMenu;
        await waitUntil(() => {
            const ready = controller.buttons.find(candidate => candidate.label === 'Fichier');
            const items = ready?.menu._getMenuItems() ?? [];
            return items.some(item => item.label?.text === 'Tester' && item.reactive) &&
                items.some(item => item.label?.text === 'Indisponible' && !item.reactive);
        });
        const entry = controller.buttons.find(candidate => candidate.label === 'Fichier');
        if (!entry?.button.mapped || controller.window !== window)
            throw new Error('Global menu was not attached to the active GTK window');
        entry.button.emit('clicked', 1);
        await Scripting.sleep(100);
        const items = entry.menu._getMenuItems();
        const test = items.find(item => item.label?.text === 'Tester');
        const disabled = items.find(item => item.label?.text === 'Indisponible');
        if (!test?.reactive || disabled?.reactive)
            throw new Error('Native GTK global menu did not preserve enabled states');
        await capture('macos-global-menu-gtk.png');
        test.emit('activate', null);
        await waitUntil(() => window.get_title() === 'Global menu action executed');
        const current = controller.buttons.find(candidate => candidate.label === 'Fichier');
        current.menu.open();
        const option = current.menu._getMenuItems().find(item => item.label?.text === 'Option');
        option.emit('activate', null);
        await waitUntil(() => controller.groups.app.get_action_state('option')?.get_boolean() === false);
        window.delete(global.get_current_time());
        await waitUntil(() => !controller.container.visible);
        print('Native GTK global menu: window association, exported menu, remote action, checked state and cleanup verified');
    } finally {
        process.force_exit();
    }
}

async function checkNativeTransferProgress(appId) {
    const extension = Main.extensionManager.lookup('hello-world@greg.local').stateObj;
    const emitProgress = (progress, visible) => Gio.DBus.session.emit_signal(null,
        '/com/canonical/unity/launcherentry/g_os_test', 'com.canonical.Unity.LauncherEntry', 'Update',
        new GLib.Variant('(sa{sv})', [`application://${appId}`, {
            progress: new GLib.Variant('d', progress),
            'progress-visible': new GLib.Variant('b', visible),
        }]));
    try {
        emitProgress(0.5, true);
        for (let attempt = 0; attempt < 60 && !extension._activeTransfers.has(appId); attempt++)
            await Scripting.sleep(50);
        if (!extension._activeTransfers.has(appId))
            throw new Error('Dock did not receive the native launcher progress signal');
        await Scripting.sleep(200);
        for (const screen of extension._screens) {
            const button = screen.appButtons.find(candidate => candidate.app.get_id() === appId);
            if (!button?.progressBar.mapped || !button.progressFill.mapped)
                throw new Error('Dock progress bar or fill was not mapped');
            const [barWidth, barHeight] = button.progressBar.get_transformed_size();
            const [fillWidth, fillHeight] = button.progressFill.get_transformed_size();
            const [iconX, iconY] = button.icon.icon.get_transformed_position();
            const [iconWidth, iconHeight] = button.icon.icon.get_transformed_size();
            const [barX, barY] = button.progressBar.get_transformed_position();
            print(`Native transfer progress: ${appId}, track ${barWidth}x${barHeight}, fill ${fillWidth}x${fillHeight}`);
            if (barHeight < 3 || fillHeight < 3 || Math.abs(fillWidth - barWidth / 2) > 1)
                throw new Error('Dock progress fill does not visibly cover half the track');
            if (Math.abs(barX - iconX) > 1 || Math.abs(barWidth - iconWidth) > 1 ||
                Math.abs(barY + barHeight - iconY - iconHeight) > 1)
                throw new Error('Dock progress bar is not anchored to the bottom of the icon');
        }
        await capture('macos-transfer-progress.png');
        emitProgress(1, false);
        await Scripting.sleep(200);
        if (extension._screens.some(screen => screen.appButtons.find(button => button.app.get_id() === appId).progressBar.visible))
            throw new Error('Dock progress bar did not disappear after completion');
        print('Native transfer progress reception, visible fill and completion verified');
    } finally {
        emitProgress(1, false);
    }
}

async function checkFluxWidgets() {
    const extensionInfo = Main.extensionManager.lookup('hello-world@greg.local');
    const source = Gio.SettingsSchemaSource.new_from_directory(extensionInfo.dir.get_child('schemas').get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.g-os', true)});
    const catalog = await import('../dist/widgets/widgetCatalog.js');
    const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    const example = root.get_child('examples').get_child('flux-weather');
    const temporary = Gio.File.new_for_path(GLib.dir_make_tmp('macos-flux-XXXXXX'));
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
    const extensionInfo = Main.extensionManager.lookup('hello-world@greg.local');
    const source = Gio.SettingsSchemaSource.new_from_directory(extensionInfo.dir.get_child('schemas').get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.g-os', true)});
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

async function checkNativeNotifications() {
    const extension = Main.extensionManager.lookup('hello-world@greg.local').stateObj;
    const source = Gio.SettingsSchemaSource.new_from_directory(
        extension.dir.get_child('schemas').get_path(), Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.g-os', true)});
    const systemSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
    const previous = {banners: systemSettings.get_boolean('show-banners'), position: settings.get_int('notification-position')};
    const waitUntil = async predicate => {
        for (let attempt = 0; attempt < 60; attempt++) {
            if (predicate())
                return;
            await Scripting.sleep(50);
        }
        throw new Error('Native notifications did not reach the expected state');
    };
    try {
        systemSettings.set_boolean('show-banners', false);
        const notificationSource = new MessageTray.Source({title: 'Notifications de test', iconName: 'dialog-information-symbolic'});
        Main.messageTray.add(notificationSource);
        const notification = new MessageTray.Notification({source: notificationSource,
            title: 'Message non lu', body: 'Une notification conservée dans la liste GNOME.'});
        notificationSource.addNotification(notification);
        await waitUntil(() => extension._screens.every(screen => screen.notificationDot.visible));
        const screen = extension._screens[0];
        if (!screen.notificationButton.mapped || screen.notificationDot.width !== 6 || screen.notificationDot.height !== 6)
            throw new Error('Topbar notification icon or unread dot was not rendered');
        await capture('macos-notification-unread.png');
        screen.notificationButton.emit('clicked', 1);
        await waitUntil(() => screen.notificationMenu.isOpen && notification.acknowledged);
        if (!screen.notificationView.messages.some(group => group.source === notificationSource) || notificationSource.count !== 1 ||
            extension._screens.some(current => current.notificationDot.visible))
            throw new Error('Opening the native list did not preserve notifications and mark them read');
        await Scripting.sleep(250);
        await capture('macos-notification-list.png');
        const clear = findActor(screen.notificationMenu.actor, actor => actor.accessible_name === 'Tout effacer');
        if (!clear?.reactive)
            throw new Error('Native notification clear control is missing');
        clear.emit('clicked', 1);
        await waitUntil(() => screen.notificationView.empty);
        await capture('macos-notification-empty.png');
        screen.notificationMenu.close();
        print('Native unread dot, notification list, acknowledgement and clear completed');
        systemSettings.set_boolean('show-banners', true);
        const positions = [[1, 0], [0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
        for (let position = 0; position < positions.length; position++) {
            settings.set_int('notification-position', position);
            await Scripting.sleep(100);
            const bannerSource = new MessageTray.Source({title: 'Position de notification', iconName: 'dialog-information-symbolic'});
            Main.messageTray.add(bannerSource);
            const bannerNotification = new MessageTray.Notification({source: bannerSource,
                title: `Position ${position + 1}`, body: 'Bannière native GNOME'});
            bannerSource.addNotification(bannerNotification);
            await waitUntil(() => Main.messageTray._notification === bannerNotification &&
                Main.messageTray._notificationState === MessageTray.State.SHOWN);
            await Scripting.sleep(200);
            const [trayX, trayY] = Main.messageTray.get_transformed_position();
            const [trayWidth, trayHeight] = Main.messageTray.get_transformed_size();
            const banner = Main.messageTray._bannerBin;
            const [x, y] = banner.get_transformed_position();
            const [width, height] = banner.get_transformed_size();
            const [horizontal, vertical] = positions[position];
            const expectedX = trayX + (trayWidth - width) * horizontal / 2;
            const expectedY = trayY + (trayHeight - height) * vertical / 2;
            print(`Notification position ${position}: ${x},${y} ${width}x${height}, expected ${expectedX},${expectedY}`);
            if (width <= 0 || height <= 0 || Math.abs(x - expectedX) > 2 || Math.abs(y - expectedY) > 2)
                throw new Error(`Native notification banner is misplaced at position ${position}`);
            await capture(`macos-notification-position-${position}.png`);
            bannerNotification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
            await waitUntil(() => Main.messageTray._notificationState === MessageTray.State.HIDDEN);
        }
        const original = {...extension._notificationPositionBackup};
        extension.disable();
        if (Main.messageTray.bannerAlignment !== original.x || Main.messageTray._bannerBin.y_align !== original.y)
            throw new Error('Native banner positioning was not restored on disable');
        extension.enable();
        print('All nine native notification positions and restoration verified');
    } finally {
        systemSettings.set_boolean('show-banners', previous.banners);
        settings.set_int('notification-position', previous.position);
    }
}

async function checkDockFirstLaunch() {
    const extension = Main.extensionManager.lookup('hello-world@greg.local').stateObj;
    const source = Gio.SettingsSchemaSource.new_from_directory(
        extension.dir.get_child('schemas').get_path(), Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.g-os', true)});
    for (const position of [0, 1, 2]) {
        for (const animation of [0, 4]) {
            extension.disable();
            settings.set_boolean('reserve-dock-space', true);
            settings.set_boolean('dock-autohide', false);
            settings.set_boolean('dock-hide-when-covered', false);
            settings.set_boolean('dock-show-border', true);
            settings.set_boolean('dock-show-shadow', true);
            settings.set_int('dock-position', position);
            settings.set_int('dock-hover-animation', animation);
            extension.enable();
            Main.overview.hide();
            const process = Gio.Subprocess.new(['gjs', '-c',
                "imports.gi.versions.Gtk='3.0'; const Gtk=imports.gi.Gtk; Gtk.init(null); " +
                "const window=new Gtk.Window({title:'G-Os First Maximization',default_width:300,default_height:250}); " +
                "window.connect('destroy',()=>Gtk.main_quit()); window.maximize(); window.show_all(); Gtk.main();"],
            Gio.SubprocessFlags.NONE);
            try {
                let window;
                for (let attempt = 0; attempt < 50 && !window; attempt++) {
                    await Scripting.sleep(100);
                    window = global.get_window_actors().map(actor => actor.meta_window)
                        .find(candidate => candidate.get_title() === 'G-Os First Maximization');
                }
                if (!window)
                    throw new Error('First maximization test window did not appear');
                await Scripting.sleep(300);
                const screen = extension._screens[window.get_monitor()];
                const background = screen.magnificationBackground;
                const [width, height] = background.get_transformed_size();
                if (!background.mapped || width <= 0 || height <= 0 ||
                    background.get_theme_node().get_background_color().alpha === 0 ||
                    !background.get_theme_node().get_box_shadow() ||
                    background.get_theme_node().get_border_width(St.Side.TOP) === 0)
                    throw new Error(`Dock background, border or shadow missing on first launch: ${position}/${animation}`);
                const first = window.get_frame_rect();
                const area = window.get_work_area_current_monitor();
                const [, panelY] = screen.panel.get_transformed_position();
                const [, panelHeight] = screen.panel.get_transformed_size();
                print(`First maximization ${position}/${animation}: frame=${first.x},${first.y} ${first.width}x${first.height}, ` +
                    `area=${area.x},${area.y} ${area.width}x${area.height}, panel=${panelY}+${panelHeight}`);
                if (first.x !== area.x || first.y !== area.y || first.width !== area.width || first.height !== area.height ||
                    Math.abs(first.y - panelY - panelHeight) > 1)
                    throw new Error(`First maximization has a gap: frame=${JSON.stringify(first)}, area=${JSON.stringify(area)}`);
                window.unmaximize();
                await Scripting.sleep(200);
                window.maximize();
                await Scripting.sleep(200);
                const second = window.get_frame_rect();
                if (first.x !== second.x || first.y !== second.y || first.width !== second.width || first.height !== second.height)
                    throw new Error(`Maximized geometry changed after restoring: ${JSON.stringify(first)} -> ${JSON.stringify(second)}`);
                await capture(`macos-first-launch-${position}-${animation}.png`);
                print(`First Dock launch and maximization verified: ${position}/${animation}, ${width}x${height}`);
                window.delete(global.get_current_time());
                await Scripting.sleep(100);
            } finally {
                process.force_exit();
            }
        }
    }
}

async function checkDockWindowCoverage() {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(source.lookup('org.gnome.shell.extensions.g-os', true), null, null);
    settings.set_boolean('dock-autohide', false);
    settings.set_boolean('dock-hide-when-covered', true);
    new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean('enable-animations', true);
    await Scripting.sleep(300);
    const extension = Main.extensionManager.lookup('hello-world@greg.local').stateObj;
    const screen = extension._screens[0];
    const dock = screen.dockContainer;
    const process = Gio.Subprocess.new(['gjs', '-c',
        "imports.gi.versions.Gtk='3.0'; const Gtk=imports.gi.Gtk; Gtk.init(null); " +
        "const window=new Gtk.Window({title:'G-Os Dock Coverage Test',default_width:300,default_height:250}); " +
        "window.connect('destroy',Gtk.main_quit); window.show_all(); Gtk.main();"], Gio.SubprocessFlags.NONE);
    try {
        let window;
        for (let attempt = 0; attempt < 50 && !window; attempt++) {
            await Scripting.sleep(100);
            window = global.get_window_actors().map(actor => actor.meta_window)
                .find(candidate => candidate.get_title() === 'G-Os Dock Coverage Test');
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
        const pointer = Clutter.get_default_backend().get_default_seat()
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

async function checkDockWidgets() {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(source.lookup('org.gnome.shell.extensions.g-os', true), null, null);
    settings.set_boolean('dock-widget-clock', true);
    settings.set_boolean('dock-widget-calendar', true);
    settings.set_strv('dock-item-order', ['widget:clock', 'widget:calendar']);
    settings.set_int('dock-hover-animation', 4);
    for (const [size, format] of [[24, 0], [48, 0], [24, 1], [48, 1]]) {
        settings.set_value('dock-widget-sizes', new GLib.Variant('a{si}', {clock: format, calendar: format}));
        settings.set_int('icon-size', size);
        for (const position of [0, 1, 2]) {
            settings.set_int('dock-position', position);
            await Scripting.sleep(350);
            const dock = Main.layoutManager.uiGroup.get_children().find(actor =>
                actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('macos-dock'));
            const children = dock.get_child().get_children().filter(actor => actor.dockFocusKey);
            const widgets = children.filter(actor => actor.dockWidgetType);
            if (widgets.length !== 2)
                throw new Error(`Expected two Dock widgets at position ${position}, got ${widgets.length}`);
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
                    !widget.dockWidgetPrimary.text || !widget.dockWidgetSecondary.text)
                    throw new Error(`Widget content does not fit its allocation at position ${position}`);
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
            await capture(`macos-dock-widgets-${position}-${size}-${format}.png`);
        }
    }
    settings.set_value('dock-widget-sizes', new GLib.Variant('a{si}', {}));
    settings.set_int('dock-position', 0);
    await Scripting.sleep(350);
    const dock = Main.layoutManager.uiGroup.get_children().find(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('macos-dock'));
    const clock = dock.get_child().get_children().find(actor => actor.dockWidgetType === 'clock');
    const calendar = dock.get_child().get_children().find(actor => actor.dockWidgetType === 'calendar');
    const [clockX, clockY] = clock.get_transformed_position();
    const [clockWidth, clockHeight] = clock.get_transformed_size();
    const [calendarX, calendarY] = calendar.get_transformed_position();
    const [calendarWidth, calendarHeight] = calendar.get_transformed_size();
    const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
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
    const resizedDock = Main.layoutManager.uiGroup.get_children().find(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('macos-dock'));
    const latestClock = resizedDock.get_child().get_children().find(actor => actor.dockWidgetType === 'clock');
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
    await capture('macos-dock-widget-size-menu.png');
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
    const settings = Gio.Settings.new_full(schemaSource.lookup('org.gnome.shell.extensions.g-os', true), null, null);
    const uri = Gio.File.new_for_path('/usr/share').get_uri();
    settings.set_strv('dock-folders', [uri]);
    settings.set_int('dock-folder-view', 0);
    settings.set_value('dock-view-options', new GLib.Variant('a{sa{si}}', {
        pile: {'icon-size': 50, 'text-size': 14, spacing: 10, 'max-files': 6},
        [`folder:${uri}:pile`]: {'icon-size': 64, 'text-size': 18, spacing: 14, 'max-files': 3},
        [`folder:${uri}:grille`]: {'icon-size': 56, 'text-size': 16, 'horizontal-spacing': 15,
            'vertical-spacing': 21, columns: 3, rows: 2},
    }));
    const currentDock = () => Main.layoutManager.uiGroup.get_children().find(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('macos-dock'));
    const open = async (predicate, style) => {
        await Scripting.sleep(350);
        const button = currentDock().get_child().get_children().find(predicate);
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
    let [button, content] = await open(actor => actor.folderUri === uri, 'macos-dock-folder-fan');
    const stackItems = content.get_children();
    const stackLabel = stackItems[0].get_child().get_children()[0].get_child();
    const stackIcon = stackItems[0].get_child().get_children()[1];
    if (stackItems.length !== 3 || stackIcon.icon_size !== 64 ||
        !stackLabel.has_style_class_name('macos-folder-text-size-18') ||
        stackItems[1].y - stackItems[0].y !== 82)
        throw new Error('Configured stack dimensions or file limit were not applied');
    const [labelX] = stackLabel.get_transformed_position();
    const [labelWidth] = stackLabel.get_transformed_size();
    const [iconX] = stackIcon.get_transformed_position();
    if (iconX - labelX - labelWidth < 7 || iconX - labelX - labelWidth > 9)
        throw new Error('Configured stack label is not right-aligned next to its icon');
    const stackFont = stackLabel.get_theme_node().get_font().get_size();
    const stackColor = stackLabel.get_theme_node().get_foreground_color();
    await capture('macos-folder-options-stack.png');
    button.folderMenu.close();
    settings.set_int('dock-folder-view', 1);
    [button, content] = await open(actor => actor.folderUri === uri, 'macos-dock-folder-grid');
    const rows = content.get_children();
    const gridItem = rows[0].get_children()[0];
    const [gridIcon, gridLabel] = gridItem.get_child().get_children();
    const gridColor = gridLabel.get_theme_node().get_foreground_color();
    if (['red', 'green', 'blue', 'alpha'].some(channel => gridColor[channel] !== stackColor[channel]))
        throw new Error('Grid label color differs from the stack label color');
    if (rows.length !== 2 || rows[0].get_children().length !== 3 || gridIcon.icon_size !== 56 ||
        !gridLabel.has_style_class_name('macos-folder-text-size-16') ||
        rows[0].get_theme_node().get_length('spacing') !== 15 ||
        content.get_theme_node().get_length('spacing') !== 21 ||
        gridItem.width !== 76 || gridItem.height !== 100 ||
        content.get_theme_node().get_padding(St.Side.LEFT) !== 2 ||
        stackFont <= gridLabel.get_theme_node().get_font().get_size())
        throw new Error('Configured grid dimensions, text size, spacing or limits were not applied');
    await capture('macos-folder-options-grid.png');
    const openFolder = button.folderMenu.box.get_children().find(actor =>
        actor.has_style_class_name?.('macos-dock-folder-open'));
    if (!openFolder)
        throw new Error('Open-folder action is missing');
    for (const state of ['active', 'focus', 'hover'])
        openFolder.add_style_pseudo_class(state);
    await Scripting.sleep(120);
    const hoverColor = openFolder.get_theme_node().get_background_color();
    if (hoverColor.alpha !== 255 || hoverColor.blue < 200 || hoverColor.red > 32)
        throw new Error('Open-folder hover is not blue');
    await capture('macos-folder-open-hover.png');
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
    await capture('macos-folder-open-rest.png');
    openFolder.remove_style_pseudo_class('active');
    openFolder.remove_style_pseudo_class('focus');
    print('Native open-folder hover returns to neutral while focus and active states persist');
    button.folderMenu.close();
    settings.set_value('dock-view-options', new GLib.Variant('a{sa{si}}', {
        [`folder:${uri}:grille`]: {'icon-size': 96, 'text-size': 32, 'horizontal-spacing': 48,
            'vertical-spacing': 48, columns: 10, rows: 3},
    }));
    let scroll;
    [button, scroll] = await open(actor => actor.folderUri === uri, 'macos-dock-app-folder-scroll');
    const extremeGrid = scroll.get_child().get_children()[0];
    if (scroll.hscrollbar_policy !== St.PolicyType.AUTOMATIC ||
        scroll.vscrollbar_policy !== St.PolicyType.AUTOMATIC ||
        extremeGrid.get_children().length !== 3 || extremeGrid.get_children()[0].get_children().length !== 10 ||
        scroll.hadjustment.upper <= scroll.hadjustment.page_size ||
        scroll.vadjustment.upper <= scroll.vadjustment.page_size)
        throw new Error('Extreme grid settings are not bounded and scrollable in both directions');
    await capture('macos-folder-options-extreme.png');
    button.folderMenu.close();
    const apps = global.settings.get_strv('favorite-apps').slice(0, 3);
    settings.set_string('dock-app-folders', JSON.stringify([{id: 'options-test', name: 'Applications', apps, icon: '', view: 0}]));
    settings.set_value('dock-view-options', new GLib.Variant('a{sa{si}}', {
        pile: {'icon-size': 50}, 'app-folder:options-test:pile': {'icon-size': 72, 'text-size': 20, spacing: 20},
    }));
    [button, content] = await open(actor => actor.appFolderId === 'options-test', 'macos-dock-folder-fan');
    const appItems = content.get_children();
    if (appItems.length !== apps.length || appItems[0].get_child().get_children()[1].icon_size !== 72 ||
        !appItems[0].get_child().get_children()[0].get_child().has_style_class_name('macos-folder-text-size-20'))
        throw new Error('Application folder override was not applied');
    await capture('macos-app-folder-options.png');
    button.folderMenu.close();
    print('Native folder view options applied independently to files and application folders');
}

async function checkUtilityWidgets() {
    const extensionInfo = Main.extensionManager.lookup('hello-world@greg.local');
    const source = Gio.SettingsSchemaSource.new_from_directory(extensionInfo.dir.get_child('schemas').get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.g-os', true)});
    const monitor = JSON.parse(settings.get_string('widget-monitors'))[0];
    const requestedWidgets = GLib.getenv('G_OS_UTILITY_WIDGETS')?.split(',').filter(Boolean);
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
            await capture(`macos-utility-${widget}.png`);
            const dock = getActor(instances[1].id);
            dock.emit('clicked', 1);
            await Scripting.sleep(200);
            if (!dock.shortcutMenu?.isOpen || !findActor(dock.shortcutMenu.box, actor => hasClass(actor, 'macos-utility-widget')))
                throw new Error(`Utility Dock detail panel did not open: ${widget}`);
            await capture(`macos-utility-${widget}-panel.png`);
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
    const extensionInfo = Main.extensionManager.lookup('hello-world@greg.local');
    const source = Gio.SettingsSchemaSource.new_from_directory(extensionInfo.dir.get_child('schemas').get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.g-os', true)});
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
        const clock = actor('desktop-clock-test');
        const calendar = actor('desktop-calendar-test');
        const dock = actor('dock-clock-test');
        const [clockX, clockY] = clock.get_transformed_position();
        if (Math.abs(clockX - area.x - 64) > 1 || Math.abs(clockY - area.y - 96) > 1 || clock.dateLabel.visible)
            throw new Error(`Managed clock grid placement or configuration is wrong: position=${clockX},${clockY}, ` +
                `area=${area.x},${area.y}, date=${clock.dateLabel.visible}`);
        if (!clock.widgetInstance.locked || calendar.get_parent() !== Main.layoutManager.uiGroup)
            throw new Error('Managed locking or foreground layer did not apply');
        if (!dock.dockWidgetSquare || dock.dockFocusKey !== 'widget-instance:dock-clock-test')
            throw new Error('Managed Dock widget format is incorrect');
        if (!findActor(Main.layoutManager._backgroundGroup, value => value.has_style_class_name?.('macos-widget-grid')))
            throw new Error('Desktop widget grid is not rendered');
        global.stage.queue_redraw();
        await Scripting.waitLeisure();
        await capture('macos-widget-system-grid.png');
        const importedActor = actor('imported-desktop-test');
        const dragHandle = importedActor.dragHandle;
        const [handleX, handleY] = dragHandle.get_transformed_position();
        const [handleWidth, handleHeight] = dragHandle.get_transformed_size();
        const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
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
        const [movedX, movedY] = actor('imported-desktop-test').get_transformed_position();
        if (Math.abs(movedX - area.x - moved.column * 32) > 1 || Math.abs(movedY - area.y - moved.row * 32) > 1)
            throw new Error('Desktop drag did not snap to the saved grid cell');
        print('Native desktop widget drag is accepted and snaps to the saved grid');
        const launchpad = Main.layoutManager.uiGroup.get_children().find(value => value instanceof St.ScrollView &&
            value.get_child()?.has_style_class_name('macos-dock')).get_child().get_children()
            .find(value => value.get_child()?.icon_name === 'view-app-grid-symbolic');
        launchpad.emit('popup-menu');
        await Scripting.sleep(150);
        if (!launchpad.shortcutMenu.box.get_children().some(item => item.label?.text === 'Gestion des widgets du Dock'))
            throw new Error('Launchpad widget manager action is missing');
        await capture('macos-widget-system-dock-menu.png');
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
        await capture('macos-widget-system-desktop-menu.png');
        extensionInfo.stateObj?._desktopWidgetMenu?.close();
        for (const manager of Main.layoutManager._bgManagers)
            manager.backgroundActor._backgroundMenu?.close();
        const values = JSON.parse(settings.get_string('widget-instances'));
        values.find(value => value.id === 'desktop-clock-test').column = 4;
        settings.set_string('widget-instances', JSON.stringify(values));
        await Scripting.sleep(200);
        if (Math.abs(actor('desktop-clock-test').get_transformed_position()[0] - area.x - 128) > 1)
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
    const extensionInfo = Main.extensionManager.lookup('hello-world@greg.local');
    const source = Gio.SettingsSchemaSource.new_from_directory(extensionInfo.dir.get_child('schemas').get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.g-os', true)});
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
    let owner = Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.mpris.MediaPlayer2.GOsWidgetTest',
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
        actor => actor.has_style_class_name?.('macos-desktop-widget-media'));
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
        await capture('macos-media-playing.png');
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
        await capture('macos-media-square-panel.png');
        square.shortcutMenu.close();
        settings.set_value('dock-widget-sizes', new GLib.Variant('a{si}', {media: 0}));
        settings.set_int('desktop-widget-width', 120);
        settings.set_int('icon-size', 24);
        for (const position of [0, 1, 2]) {
            settings.set_int('dock-position', position);
            await Scripting.sleep(350);
            verifyBounds(desktopWidget(), desktopWidget().mediaView);
            verifyBounds(dockWidget(), dockWidget().mediaView);
            await capture(`macos-media-compact-position-${position}.png`);
        }
        Gio.bus_unown_name(owner);
        owner = 0;
        await waitUntil(() => desktopWidget().mediaView.title.text === 'Aucune lecture');
        if (desktopWidget().mediaView.controls.playPause.reactive || dockWidget().mediaView.controls.next.reactive)
            throw new Error('Media controls remain active after the player disappears');
        await capture('macos-media-no-player.png');
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
    const settings = Gio.Settings.new_full(source.lookup('org.gnome.shell.extensions.g-os', true), null, null);
    const uri = Gio.File.new_for_path('/usr/share').get_uri();
    settings.set_strv('dock-folders', [uri]);
    settings.set_int('dock-folder-view', 0);
    settings.set_value('dock-view-options', new GLib.Variant('a{sa{si}}', {pile: {'max-files': 3}}));
    await Scripting.sleep(350);
    const check = async (findButton, image) => {
        const dock = Main.layoutManager.uiGroup.get_children().find(actor =>
            actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('macos-dock'));
        const button = dock.get_child().get_children().find(findButton);
        if (!button)
            throw new Error('Stack folder button is missing');
        button.emit('clicked', 1);
        let stack;
        const findStack = actor => {
            if (actor.has_style_class_name?.('macos-dock-folder-fan'))
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
        await Scripting.sleep(200);
        const sourceIcon = button.get_child();
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
            if (dockGap < 0 || dockGap > 16)
                throw new Error(`Stack is too far from the Dock or overlaps it: gap=${dockGap}`);
            print(`Native stack spacing: Dock gap=${Math.round(dockGap)}px, text/icon gap=8px`);
        await capture(image);
        button.folderMenu.close();
    };
    await check(actor => actor.folderUri === uri, 'macos-folder-stack.png');
    settings.set_strv('dock-item-order', [`folder:${uri}`]);
    await Scripting.sleep(300);
    await check(actor => actor.folderUri === uri, 'macos-folder-stack-first.png');
    const apps = global.settings.get_strv('favorite-apps').slice(0, 3);
    settings.set_string('dock-app-folders', JSON.stringify([{id: 'stack-test', name: 'Applications', apps, icon: '', view: 0}]));
    settings.set_strv('dock-item-order', ['app-folder:stack-test']);
    await Scripting.sleep(300);
    await check(actor => actor.appFolderId === 'stack-test', 'macos-app-folder-stack.png');
    print('Native stack icons aligned above Dock source with labels on the left');
}

async function checkDockShadow() {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(source.lookup('org.gnome.shell.extensions.g-os', true), null, null);
    const requestedBackground = GLib.getenv('G_OS_DOCK_BACKGROUND_STYLE');
    const requestedPadding = GLib.getenv('G_OS_DOCK_PADDING_HORIZONTAL');
    if (requestedBackground !== null)
        settings.set_int('dock-background-style', Number(requestedBackground));
    if (requestedPadding !== null)
        settings.set_int('dock-padding-horizontal', Number(requestedPadding));
    for (const mode of [1, 4]) {
        settings.set_int('dock-hover-animation', mode);
        await Scripting.sleep(350);
        const actors = Main.layoutManager.uiGroup.get_children();
        const dock = actors.find(actor => actor instanceof St.ScrollView &&
            actor.get_child()?.has_style_class_name('macos-dock'));
        const background = actors.find(actor => actor !== dock?.get_child() &&
            actor.has_style_class_name?.('macos-dock'));
        if (!dock || !background || !background.visible || background.clip_to_allocation)
            throw new Error(`Dock background shadow is clipped or missing in mode ${mode}`);
        if (!dock.get_child().has_style_class_name('macos-dock-magnification-content') ||
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
        await capture(`macos-dock-shadow-mode-${mode}.png`);
    }
    print('Native Dock shadow remains outside scroll clipping in normal and magnification modes');
}

async function checkMagnificationQuality() {
    const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
    const source = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = Gio.Settings.new_full(source.lookup('org.gnome.shell.extensions.g-os', true), null, null);
    const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    interfaceSettings.set_boolean('enable-animations', true);
    settings.set_int('dock-hover-animation', 4);
    await Scripting.sleep(400);
    const dock = Main.layoutManager.uiGroup.get_children().find(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('macos-dock'));
    const buttons = dock.get_child().get_children().filter(button => button.app);
    const button = buttons[Math.floor(buttons.length / 2)];
    const icon = button.icon.icon;
    const baseSize = settings.get_int('icon-size');
    if (icon.icon_size < Math.ceil(baseSize * 1.8) || icon.width !== baseSize || icon.height !== baseSize)
        throw new Error(`Icon texture/allocation mismatch: ${icon.icon_size}, ${icon.width}x${icon.height}`);
    await capture('macos-magnification-sharp-normal.png');
    button.track_hover = false;
    button.hover = true;
    await Scripting.sleep(350);
    if (Math.abs(icon.scale_x - 1.8) > 0.01)
        throw new Error(`Icon did not magnify: ${icon.scale_x}`);
    await capture('macos-magnification-sharp-wave.png');
    const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
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
    const settings = Gio.Settings.new_full(source.lookup('org.gnome.shell.extensions.g-os', true), null, null);
    if (GLib.getenv('G_OS_POINTER_MAGNIFICATION') === '1') {
        new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean('enable-animations', true);
        settings.set_int('dock-hover-animation', 4);
        await Scripting.sleep(400);
    }
    const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const currentDock = () => Main.layoutManager.uiGroup.get_children().find(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('macos-dock'));
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
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('macos-dock'));
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
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('macos-dock'));
    const button = dock?.get_child().get_children().find(actor =>
        actor.dockFocusKey === 'shortcut:applications');
    if (!button)
        throw new Error('Launchpad dock button is missing');

    const [x, y] = button.get_transformed_position();
    const [width, height] = button.get_transformed_size();
    const pointer = Clutter.get_default_backend().get_default_seat()
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
    for (const label of ['Redémarrer', 'Éteindre', 'Se déconnecter', 'Préférences G-Os',
        'Paramètres système', 'Verrouiller la session', 'Suspendre']) {
        if (!labels.includes(label))
            throw new Error(`Launchpad menu is missing ${label}`);
    }
    menu.close();
    print('Native Launchpad right-click menu opened with system actions');
}

async function waitForExtension() {
    const uuid = 'hello-world@greg.local';
    const hasCustomPanel = () => Boolean(findActor(Main.layoutManager.uiGroup,
        actor => actor.has_style_class_name?.('macos-secondary-panel')));
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
    const directory = GLib.getenv('G_OS_VISUAL_OUTPUT');
    if (!directory)
        throw new Error('G_OS_VISUAL_OUTPUT must name an output directory');
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
    await capture('macos-dock-reorder.png');
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
    const settings = Gio.Settings.new_full(schemaSource.lookup('org.gnome.shell.extensions.g-os', true), null, null);
    const uri = Gio.File.new_for_path(GLib.get_tmp_dir()).get_uri();
    const folderKey = `folder:${uri}`;
    const getDocks = () => Main.layoutManager.uiGroup.get_children().filter(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('macos-dock'));
    for (const radius of [0, 12, 48, 28]) {
        settings.set_int('dock-border-radius', radius);
        await Scripting.waitLeisure();
        for (const dock of getDocks()) {
            const measured = dock.get_child().get_theme_node().get_border_radius(0);
            if (measured !== radius)
                throw new Error(`Dock corner radius is ${measured}, expected ${radius}`);
        }
        if (radius === 12)
            await capture('macos-dock-radius.png');
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
    await capture('macos-dock-notification-badge.png');
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
        actor !== waveDock.get_child() && actor.has_style_class_name?.('macos-dock'));
    if (!background || background.width <= normalSize[0] || Math.abs(background.height - normalSize[1]) > 1)
        throw new Error('Magnification background did not follow the expanded icon row');
    await capture('macos-dock-magnification.png');
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
    await capture('macos-dock-mixed.png');
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
    const fanContent = await waitForFolder(fanButton.folderMenu, 'macos-dock-folder-fan');
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
    await capture('macos-folder-fan.png');
    fanButton.folderMenu.close();
    const gridButton = getDocks()[0].get_child().get_children().find(actor => actor.folderUri === gridUri);
    gridButton.emit('clicked', 1);
    await waitForFolder(gridButton.folderMenu, 'macos-dock-folder-grid');
    await Scripting.waitLeisure();
    await capture('macos-folder-grid.png');
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
    await capture('macos-app-folder-preview.png');
    groups = JSON.parse(settings.get_string('dock-app-folders'));
    groups[0].view = 1;
    settings.set_string('dock-app-folders', JSON.stringify(groups));
    await Scripting.waitLeisure();
    let applicationFolder = groupButton();
    applicationFolder.emit('clicked', 1);
    const appGrid = await waitForFolder(applicationFolder.folderMenu, 'macos-dock-folder-grid');
    await Scripting.waitLeisure();
    const gridItems = appGrid.get_children().flatMap(row => row.get_children());
    const gridSizes = gridItems.map(item => item.get_transformed_size());
    if (gridSizes.some(size => size[0] !== gridSizes[0][0] || size[1] !== gridSizes[0][1]))
        throw new Error('Application folder grid cells are not aligned');
    await capture('macos-app-folder-grid.png');
    applicationFolder.folderMenu.close();
    groups[0].view = 0;
    settings.set_string('dock-app-folders', JSON.stringify(groups));
    await Scripting.waitLeisure();
    applicationFolder = groupButton();
    applicationFolder.emit('clicked', 1);
    const appFan = await waitForFolder(applicationFolder.folderMenu, 'macos-dock-folder-fan');
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
    await capture('macos-app-folder-fan.png');
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
    await waitForExtension();
    const themeDirectory = GLib.getenv('G_OS_THEME_DIR');
    if (themeDirectory) {
        const stylesheet = Gio.File.new_for_path(
            GLib.build_filenamev([themeDirectory, 'gnome-shell', 'gnome-shell.css']));
        St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(stylesheet);
        const extraStylesheet = GLib.getenv('G_OS_THEME_EXTRA');
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
        actor => actor.has_style_class_name?.('macos-secondary-panel'));
    if (!primaryPanel || Main.panel.visible)
        throw new Error('Custom panel was not rendered or the native panel is still visible');
    let button = findActor(primaryPanel,
        actor => actor.has_style_class_name?.('macos-panel-menu'));
    if (!button?.menu)
        throw new Error('Custom panel menu was not rendered');
    let docks = Main.layoutManager.uiGroup.get_children().filter(actor =>
        actor instanceof St.ScrollView && actor.get_child()?.has_style_class_name('macos-dock'));
    if (docks.length === 0 || !docks.every(actor => actor.visible && actor.width > 100 && actor.height > 30))
        throw new Error('Dock was not rendered at a usable size');
    const [dockX, dockY] = docks[0].get_transformed_position();
    const [dockWidth, dockHeight] = docks[0].get_transformed_size();
    print(`Dock allocation: ${Math.round(dockX)},${Math.round(dockY)} ${Math.round(dockWidth)}x${Math.round(dockHeight)}`);
    if (GLib.getenv('G_OS_GLOBAL_MENU_ONLY') === '1') {
        await checkNativeGlobalMenu();
        return;
    }
    if (GLib.getenv('G_OS_PROGRESS_ONLY') === '1') {
        await checkNativeTransferProgress(favorites[0]);
        return;
    }
    if (GLib.getenv('G_OS_NOTIFICATIONS_ONLY') === '1') {
        await checkNativeNotifications();
        return;
    }
    if (GLib.getenv('G_OS_DOCK_FIRST_LAUNCH_ONLY') === '1') {
        await checkDockFirstLaunch();
        return;
    }
    if (GLib.getenv('G_OS_FLUX_ONLY') === '1') {
        await checkFluxWidgets();
        return;
    }
    if (GLib.getenv('G_OS_SIMPLE_WIDGETS_ONLY') === '1') {
        await checkSimpleWidgets();
        return;
    }
    if (GLib.getenv('G_OS_DOCK_COVERAGE_ONLY') === '1') {
        await checkDockWindowCoverage();
        return;
    }
    if (GLib.getenv('G_OS_RESERVED_DOCK_ONLY') === '1') {
        const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
            Gio.SettingsSchemaSource.get_default(), false);
        const settings = Gio.Settings.new_full(schemaSource.lookup('org.gnome.shell.extensions.g-os', true), null, null);
        settings.set_boolean('reserve-dock-space', true);
        await Scripting.sleep(300);
        await checkNativePointerDrag(docks[0], favorites);
        return;
    }
    if (GLib.getenv('G_OS_UTILITY_WIDGETS_ONLY') === '1') {
        await checkUtilityWidgets();
        return;
    }
    if (GLib.getenv('G_OS_WIDGETS_ONLY') === '1') {
        await checkWidgetSystem();
        return;
    }
    if (GLib.getenv('G_OS_MEDIA_ONLY') === '1') {
        await checkMediaWidgets();
        return;
    }
    if (GLib.getenv('G_OS_PANEL_ONLY') === '1') {
        const requestedHeight = GLib.getenv('G_OS_PANEL_HEIGHT');
        const requestedHorizontalPadding = GLib.getenv('G_OS_PANEL_PADDING_HORIZONTAL');
        const requestedVerticalPadding = GLib.getenv('G_OS_PANEL_PADDING_VERTICAL');
        const captureWidgets = GLib.getenv('G_OS_CAPTURE_WIDGETS') === '1';
        const minimalPanel = GLib.getenv('G_OS_PANEL_MINIMAL') === '1';
        if (requestedHeight || requestedHorizontalPadding || requestedVerticalPadding || captureWidgets || minimalPanel) {
            const extensionInfo = Main.extensionManager.lookup('hello-world@greg.local');
            const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
                extensionInfo.dir.get_child('schemas').get_path(), Gio.SettingsSchemaSource.get_default(), false);
            const schema = schemaSource.lookup('org.gnome.shell.extensions.g-os', true);
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
                    actor => actor.has_style_class_name?.('macos-desktop-widget')) ||
                    !findActor(Main.layoutManager.uiGroup,
                        actor => actor.has_style_class_name?.('macos-dock-widget'))))
                throw new Error('Desktop or Dock widgets were not created for the theme capture');
            primaryPanel = findActor(Main.layoutManager.uiGroup,
                actor => actor.has_style_class_name?.('macos-secondary-panel'));
            const [, actualHeight] = primaryPanel.get_transformed_size();
            if (requestedHeight && Math.round(actualHeight) !== Number(requestedHeight))
                throw new Error(`Top bar height was ${actualHeight}, expected ${requestedHeight}`);
            button = findActor(primaryPanel,
                actor => actor.has_style_class_name?.('macos-panel-menu'));
            if (requestedHeight || requestedHorizontalPadding || requestedVerticalPadding) {
                const metrics = `height-${Math.round(actualHeight)}-horizontal-${settings.get_int('panel-padding-horizontal')}-` +
                    `vertical-${settings.get_int('panel-padding-vertical')}`;
                print(`Top bar metrics applied: ${metrics}`);
                await capture(`macos-topbar-${metrics}.png`);
            }
        }
        await capture('macos-topbar-desktop.png');
        const statusButtons = primaryPanel.get_children().filter(actor => actor.statusKind);
        if (statusButtons.map(actor => actor.statusKind).join(',') !== 'wifi,bluetooth,sound,battery')
            throw new Error('Custom system status icons were not rendered');
        if (minimalPanel) {
            const clock = primaryPanel.get_children().find(actor => actor.get_name?.() === 'macos-panel-clock');
            const optionalButtons = primaryPanel.get_children().filter(actor =>
                ['Rechercher', 'Préférences G-Os'].includes(actor.accessible_name));
            if (!clock || clock.visible || optionalButtons.length !== 2 ||
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
                const audioSnapshot = statusButton.statusKind === 'sound' && controller.stream
                    ? {stream: controller.stream, volume: controller.stream.volume, muted: controller.stream.is_muted} : null;
                if (statusButton.statusKind === 'sound' && GLib.getenv('G_OS_AUDIO_REQUIRED') === '1' && !audioSnapshot)
                    throw new Error('Native audio output did not appear in the sound menu');
                await capture(`macos-topbar-${statusButton.statusKind}-menu.png`);
                statusButton.statusMenu.close();
                if (audioSnapshot && (audioSnapshot.stream.volume !== audioSnapshot.volume ||
                    audioSnapshot.stream.is_muted !== audioSnapshot.muted))
                    throw new Error('Opening the sound menu changed the volume or mute state');
                if (controller.content?.saved)
                    throw new Error('Native submenu was not restored after closing the status menu');
            }
            print('Native top bar icons open independent sound, network, Bluetooth and battery menus');
        }
        const sessionButton = findActor(primaryPanel,
            actor => actor.has_style_class_name?.('macos-session-button'));
        if (!sessionButton?.menu)
            throw new Error('Custom session menu was not rendered');
        sessionButton.menu.open();
        await Scripting.waitLeisure();
        if (!sessionButton.menu.isOpen)
            throw new Error('Custom session menu did not open');
        await capture('macos-topbar-session.png');
        sessionButton.menu.close();
        if (minimalPanel)
            print('Native minimal top bar hides optional controls and keeps the session menu accessible');
        return;
    }
    if (GLib.getenv('G_OS_DOCK_WIDGETS_ONLY') === '1') {
        await checkDockWidgets();
        return;
    }
    if (GLib.getenv('G_OS_VIEW_OPTIONS_ONLY') === '1') {
        await checkFolderViewOptions();
        return;
    }
    if (GLib.getenv('G_OS_STACK_ONLY') === '1') {
        await checkStackAlignment();
        return;
    }
    if (GLib.getenv('G_OS_SHADOW_ONLY') === '1') {
        await checkDockShadow();
        return;
    }
    if (GLib.getenv('G_OS_WAVE_ONLY') === '1') {
        await checkMagnificationQuality();
        return;
    }
    docks[0] = await checkNativePointerDrag(docks[0], favorites);
    if (!nativeMenu?.isOpen)
        throw new Error('Native application menu did not open');
    global.settings.set_strv('favorite-apps', [...favorites].reverse());
    await Scripting.waitLeisure();
        const statusButtons = primaryPanel.get_children().filter(actor => actor.statusKind);
        if (statusButtons.map(actor => actor.statusKind).join(',') !== 'wifi,bluetooth,sound,battery')
            throw new Error('Custom system status icons were not rendered');
        const quickSettings = Main.panel.statusArea.quickSettings.menu;
        statusButtons[0].emit('clicked');
        throw new Error('Application menu was closed while updating the Dock');
        if (!quickSettings.isOpen || quickSettings.sourceActor !== statusButtons[0])
            throw new Error('Quick Settings did not open from the Wi-Fi icon');
        await capture('macos-topbar-quick-settings.png');
        quickSettings.close();
        const sessionButton = findActor(primaryPanel,
            actor => actor.has_style_class_name?.('macos-session-button'));
        if (!sessionButton?.menu)
            throw new Error('Custom session menu was not rendered');
        sessionButton.menu.open();
        await Scripting.waitLeisure();
        if (!sessionButton.menu.isOpen)
            throw new Error('Custom session menu did not open');
        await capture('macos-topbar-session.png');
        sessionButton.menu.close();
    global.stage.set_key_focus(null);
    global.settings.set_strv('favorite-apps', favorites);
    await Scripting.waitLeisure();
    print('Native application menu survived Dock updates');
    await capture('macos-desktop.png');
    button.menu.open();
    await Scripting.waitLeisure();
    if (!button.menu.isOpen)
        throw new Error('Extension menu did not open');
    await capture('macos-menu.png');
    button.menu.close();
    print('Visual smoke test completed');
}