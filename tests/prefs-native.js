import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

import * as Shared from '../dist/shared/appFolders.js';
import {openWidgetManager} from '../dist/widgets/widgetManager.js';
import {readWidgetCatalog, readWidgetDescription, importWidgetDirectory, removeImportedWidget} from '../dist/widgets/widgetCatalog.js';
import {readWidgetInstances} from '../dist/widgets/widgetRegistry.js';

Gtk.init();
Adw.init();
Gtk.Settings.get_default().gtk_icon_theme_name = 'Adwaita';

const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.g-os'});
settings.set_strv('dock-folders', ['file:///tmp']);
class ExtensionPreferences {
    getSettings() { return settings; }
    get path() { return Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('dist').get_path(); }
}
const [, bytes] = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('dist').get_child('prefs.js').load_contents(null);
const source = new TextDecoder().decode(bytes).replace(/^import .*;\n/gm, '').replace('export default class', 'return class');
const Preferences = new Function('Adw', 'Gio', 'GioUnix', 'Gtk', 'Gdk', 'GLib',
    'readAppFolders', 'writeAppFolders', 'FOLDER_VIEW_OPTIONS', 'folderViewOptions', 'ExtensionPreferences', source)(
    Adw, Gio, GioUnix, Gtk, Gdk, GLib, Shared.readAppFolders, Shared.writeAppFolders,
    Shared.FOLDER_VIEW_OPTIONS, Shared.folderViewOptions, ExtensionPreferences);
const window = new Adw.PreferencesWindow();
const preferences = new Preferences();
preferences.fillPreferencesWindow(window);
window.present();

const find = (root, predicate) => {
    const result = [];
    const visit = widget => {
        if (predicate(widget))
            result.push(widget);
        for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
            visit(child);
    };
    visit(root);
    return result;
};
const wait = milliseconds => new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
});

const desktopIconPreferences = find(window, widget => widget instanceof Adw.PreferencesGroup &&
    widget.title === 'Icônes du bureau')[0];
const dockLocationPreferences = find(window, widget => widget instanceof Adw.PreferencesGroup &&
    widget.title === 'Emplacements du Dock')[0];
if (!desktopIconPreferences || !dockLocationPreferences)
    throw new Error('Desktop icon and independent Dock location preferences are missing');
for (const title of ['Contenu du dossier Bureau du système', 'Dossier personnel',
    'Périphériques USB et amovibles', 'Partages réseau']) {
    if (!find(desktopIconPreferences, widget => widget instanceof Adw.SwitchRow && widget.title === title).length)
        throw new Error(`Missing desktop icon toggle: ${title}`);
}
const iconSize = find(desktopIconPreferences, widget => widget instanceof Adw.SpinRow && widget.title === 'Taille des icônes (px)')[0];
const gridSize = find(desktopIconPreferences, widget => widget instanceof Adw.SpinRow &&
    widget.title === 'Taille de la grille des icônes (px)')[0];
const alignment = find(desktopIconPreferences, widget => widget instanceof Adw.ComboRow &&
    widget.title === 'Alignement automatique')[0];
const labelPosition = find(desktopIconPreferences, widget => widget instanceof Adw.ComboRow &&
    widget.title === 'Position des libellés')[0];
if (!iconSize || !gridSize || !alignment || !labelPosition || alignment.model.get_n_items() !== 3 ||
    labelPosition.model.get_n_items() !== 3)
    throw new Error('Desktop icon size, grid, alignment or label controls are incomplete');
for (const title of ['Dossier personnel', 'Périphériques USB et amovibles', 'Partages réseau']) {
    if (!find(dockLocationPreferences, widget => widget instanceof Adw.SwitchRow && widget.title === title).length)
        throw new Error(`Missing independent Dock location: ${title}`);
}
iconSize.value = 64;
gridSize.value = 128;
alignment.selected = 2;
labelPosition.selected = 0;
settings.set_boolean('desktop-icons-show-home', true);
settings.set_boolean('dock-icons-show-home', true);
if (settings.get_int('desktop-icons-size') !== 64 || settings.get_int('desktop-icons-grid-size') !== 128 ||
    settings.get_int('desktop-icons-alignment') !== 2 || settings.get_int('desktop-icons-label-position') !== 0 ||
    !settings.get_boolean('desktop-icons-show-home') || !settings.get_boolean('dock-icons-show-home'))
    throw new Error('Desktop icon or Dock location controls did not update GSettings');
for (const key of ['desktop-icons-size', 'desktop-icons-grid-size', 'desktop-icons-alignment',
    'desktop-icons-label-position', 'desktop-icons-show-home', 'dock-icons-show-home'])
    settings.reset(key);
print('Native desktop icon size, grid, alignment, labels and independent Dock toggles passed');

function captureWidget(widget, name) {
    const directory = GLib.getenv('G_OS_WIDGET_CAPTURE');
    if (!directory)
        return;
    GLib.mkdir_with_parents(directory, 0o755);
    const paintable = new Gtk.WidgetPaintable({widget});
    const snapshot = new Gtk.Snapshot();
    paintable.snapshot(snapshot, widget.get_width(), widget.get_height());
    const node = snapshot.to_node();
    const texture = widget.get_native().get_renderer().render_texture(node, null);
    if (!texture.save_to_png(GLib.build_filenamev([directory, name])))
        throw new Error('Widget manager screenshot could not be saved');
}

async function run() {
    await wait(100);
    const panelLauncher = find(window, widget => widget instanceof Adw.ActionRow && widget.title === 'Icône de la topbar')[0];
    const dockLauncher = find(window, widget => widget instanceof Adw.ActionRow && widget.title === 'Icône des applications du Dock')[0];
    const panelSelector = find(panelLauncher, widget => widget instanceof Gtk.DropDown)[0];
    const dockSelector = find(dockLauncher, widget => widget instanceof Gtk.DropDown)[0];
    if (!panelSelector?.enable_search || !dockSelector?.enable_search)
        throw new Error('Searchable launcher icon selectors are missing');
    print('Native preference probe: launcher selectors found');
    const selectIcon = (row, name) => {
        const model = row.model;
        for (let index = 0; index < model.get_n_items(); index++) {
            if (model.get_string(index) === name) {
                print(`Native preference probe: selecting ${name}`);
                row.selected = index;
                print(`Native preference probe: selected ${name}`);
                return;
            }
        }
        throw new Error(`Current icon theme does not expose ${name}`);
    };
    const panelModel = panelSelector.model;
    const dockModel = dockSelector.model;
    selectIcon(panelSelector, 'starred-symbolic');
    selectIcon(dockSelector, 'folder-symbolic');
    if (panelSelector.model !== panelModel || dockSelector.model !== dockModel)
        throw new Error('Selecting an existing icon replaced the native selector model');
    if (settings.get_string('panel-launcher-icon-name') !== 'starred-symbolic' ||
        settings.get_string('dock-launcher-icon-name') !== 'folder-symbolic')
        throw new Error('Native launcher icon selectors are not independent');
    const logo = preferences.path + '/icons/gnome-logo-symbolic.svg';
    settings.set_string('panel-launcher-icon-file', logo);
    await wait(100);
    if (!panelLauncher.subtitle.includes(logo) || dockLauncher.subtitle)
        throw new Error('Custom topbar image leaked into Dock icon preferences');
    settings.reset('panel-launcher-icon-file');
    settings.reset('panel-launcher-icon-name');
    settings.reset('dock-launcher-icon-name');
    settings.set_string('panel-launcher-icon-name', 'g-os-native-test-missing-symbolic');
    if (panelSelector.model === panelModel ||
        panelSelector.model.get_string(panelSelector.selected) !== 'g-os-native-test-missing-symbolic')
        throw new Error('A new configured icon was not added to the selector model');
    settings.reset('panel-launcher-icon-name');
    print('Native launcher icon search, themed selection, image preview and independence verified');
    if (GLib.getenv('G_OS_PREFS_LAUNCHERS_ONLY') === '1') {
        window.close();
        return;
    }
    const dockWidgets = find(window, widget => widget instanceof Adw.PreferencesGroup &&
        widget.title === 'Widgets du Dock')[0];
    const clock = find(dockWidgets, widget => widget instanceof Adw.SwitchRow && widget.title === 'Horloge')[0];
    const calendar = find(dockWidgets, widget => widget instanceof Adw.SwitchRow && widget.title === 'Date')[0];
    if (!clock || !calendar || clock.active || calendar.active)
        throw new Error('Dock widget switches are missing or enabled by default');
    clock.active = true;
    calendar.active = true;
    if (!settings.get_boolean('dock-widget-clock') || !settings.get_boolean('dock-widget-calendar'))
        throw new Error('Dock widget switches did not update their settings');
    settings.set_boolean('show-dock', false);
    if (clock.sensitive || calendar.sensitive)
        throw new Error('Dock widget switches remain available while the Dock is hidden');
    settings.set_boolean('show-dock', true);
    const group = find(window, widget => widget instanceof Adw.PreferencesGroup &&
        widget.title === 'Options par défaut des vues')[0];
    const pile = find(group, widget => widget instanceof Adw.ExpanderRow && widget.title === 'Pile')[0];
    const globalIcon = find(pile, widget => widget instanceof Adw.SpinRow && widget.title === 'Taille des icônes (px)')[0];
    if (!globalIcon)
        throw new Error('Missing global view options');
    globalIcon.value = 64;
    if (Shared.folderViewOptions(settings, 'pile')['icon-size'] !== 64)
        throw new Error('Global value was not saved');
    preferences._editFolderViewOptions(window, settings, 'folder:file:///tmp', 'tmp', true);
    await wait(100);
    let dialog = window.get_visible_dialog();
    let sections = find(dialog.get_extra_child(), widget => widget instanceof Adw.PreferencesGroup);
    let pileSection = sections.find(widget => widget.title === 'Pile');
    const icon = find(pileSection, widget => widget instanceof Adw.SpinRow && widget.title === 'Taille des icônes (px)')[0];
    if (!icon || icon.value !== 64)
        throw new Error('Folder did not inherit the global option');
    icon.value = 80;
    dialog.emit('response', 'save');
    dialog.close();
    await wait(100);
    if (Shared.folderViewOptions(settings, 'pile', 'folder:file:///tmp')['icon-size'] !== 80)
        throw new Error('Folder override was not saved');
    preferences._editFolderViewOptions(window, settings, 'folder:file:///tmp', 'tmp', true);
    await wait(100);
    dialog = window.get_visible_dialog();
    dialog.emit('response', 'reset');
    dialog.close();
    await wait(100);
    if (Shared.folderViewOptions(settings, 'pile', 'folder:file:///tmp')['icon-size'] !== 64)
        throw new Error('Folder reset did not restore inheritance');
    preferences._editFolderViewOptions(window, settings, 'app-folder:test', 'Applications', false);
    await wait(100);
    dialog = window.get_visible_dialog();
    sections = find(dialog.get_extra_child(), widget => widget instanceof Adw.PreferencesGroup);
    pileSection = sections.find(widget => widget.title === 'Pile');
    if (find(pileSection, widget => widget instanceof Adw.SpinRow && widget.title === 'Nombre maximal de fichiers').length)
        throw new Error('File-only limit is shown for an application folder');
    dialog.close();
    await wait(100);
    settings.set_string('widget-monitors', JSON.stringify([
        {id: 'monitor-0', index: 0, name: 'Ecran principal', x: 0, y: 0, width: 1280, height: 720},
        {id: 'monitor-1', index: 1, name: 'Second ecran', x: 1280, y: 0, width: 1280, height: 720},
    ]));
    const rootDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    const distributionDirectory = rootDirectory.get_child('dist');
    const catalog = readWidgetCatalog(distributionDirectory);
    const compatibilityDirectory = Gio.File.new_for_path(GLib.dir_make_tmp('g-os-widget-compat-XXXXXX'));
    const exampleDirectory = rootDirectory.get_child('examples').get_child('example-status');
    try {
        for (const name of ['widget.js', 'widget.css', 'preview.svg'])
            exampleDirectory.get_child(name).copy(compatibilityDirectory.get_child(name), Gio.FileCopyFlags.NONE, null, null);
        const manifest = JSON.parse(new TextDecoder().decode(exampleDirectory.get_child('widget.json').load_contents(null)[1]));
        manifest.template = 'metadata-only';
        compatibilityDirectory.get_child('widget.json').replace_contents(new TextEncoder().encode(JSON.stringify(manifest)),
            null, false, Gio.FileCreateFlags.NONE, null);
        if (readWidgetDescription(compatibilityDirectory).entry !== 'widget.js')
            throw new Error('JavaScript widget metadata was not preserved');
    } finally {
        for (const name of ['widget.json', 'widget.js', 'widget.css', 'preview.svg']) {
            try { compatibilityDirectory.get_child(name).delete(null); } catch {}
        }
        compatibilityDirectory.delete(null);
    }
    if (!['clock', 'calendar', 'media', 'notes', 'tasks', 'calculator', 'timer', 'stopwatch', 'world-clock', 'system-monitor', 'storage'].every(id =>
        catalog.entries.some(entry => entry.description.id === id)) || catalog.errors.length > 0)
        throw new Error(`Builtin widget catalog is invalid: ${JSON.stringify(catalog.errors)}`);
    let manager = openWidgetManager(window, settings, 'desktop', 'monitor-0');
    await wait(200);
    const button = (root, title) => find(root, widget => widget instanceof Gtk.Button && widget.tooltip_text === title)[0];
    if (!settings.get_boolean('widgets-managed'))
        throw new Error('Legacy widgets were not migrated');
    button(manager, 'Ajouter Horloge').emit('clicked');
    await wait(100);
    let instances = readWidgetInstances(settings.get_string('widget-instances'));
    let clockInstance = instances.find(instance => instance.target === 'desktop' && instance.widget === 'clock');
    if (!clockInstance || clockInstance.monitor !== 'monitor-0')
        throw new Error('Widget was not added to the selected monitor');
    button(manager.widgetGroups.instances, 'Verrouiller').emit('clicked');
    await wait(100);
    button(manager.widgetGroups.instances, 'Mettre au premier plan').emit('clicked');
    await wait(100);
    captureWidget(manager, 'widget-manager-desktop.png');
    button(manager.widgetGroups.instances, 'Configurer ce widget').emit('clicked');
    await wait(100);
    let editor = window.get_visible_dialog();
    const column = find(editor, widget => widget instanceof Adw.SpinRow && widget.title === 'Colonne')[0];
    const date = find(editor, widget => widget instanceof Adw.SwitchRow && widget.title === 'Afficher la date')[0];
    if (!column || !date)
        throw new Error('Generated widget configuration is missing');
    column.value = 4;
    date.active = false;
    editor.emit('response', 'save');
    editor.close();
    await wait(100);
    clockInstance = readWidgetInstances(settings.get_string('widget-instances')).find(instance => instance.id === clockInstance.id);
    if (!clockInstance.locked || !clockInstance.foreground || clockInstance.column !== 4 || clockInstance.config['show-date'] !== false)
        throw new Error('Placement, locking, foreground or configuration were not saved');
    button(manager.widgetGroups.instances, 'Dupliquer ce widget').emit('clicked');
    await wait(100);
    const clockInstances = readWidgetInstances(settings.get_string('widget-instances'))
        .filter(instance => instance.widget === 'clock' && instance.target === 'desktop' && instance.monitor === 'monitor-0');
    const clockCopy = clockInstances.find(instance => instance.id !== clockInstance.id);
    if (!clockCopy || clockCopy.id === clockInstance.id || clockCopy.column === clockInstance.column &&
        clockCopy.row === clockInstance.row || clockCopy.locked || !clockCopy.enabled ||
        JSON.stringify(clockCopy.config) !== JSON.stringify(clockInstance.config))
        throw new Error('Widget duplication did not preserve configuration and allocate a free unlocked instance');
    manager.monitorRow.selected = 1;
    await wait(100);
    button(manager, 'Ajouter Calendrier').emit('clicked');
    await wait(100);
    instances = readWidgetInstances(settings.get_string('widget-instances'));
    if (!instances.some(instance => instance.widget === 'calendar' && instance.target === 'desktop' && instance.monitor === 'monitor-1'))
        throw new Error('Second-monitor widget did not get an independent instance');
    settings.set_string('widget-monitors', JSON.stringify([
        {id: 'monitor-0', index: 0, name: 'Ecran principal', width: 1280, height: 720},
    ]));
    await wait(100);
    if (!manager.monitorRow.selected_item.get_string().includes('deconnecte') ||
        button(manager, 'Ajouter Horloge').sensitive)
        throw new Error('Disconnected monitor selection or add-button sensitivity did not update');
    manager.close();
    await wait(100);
    manager = openWidgetManager(window, settings, 'dock', 'monitor-1');
    await wait(200);
    if (manager.monitorRow || manager.widgetGroups.instances.title !== 'Widgets du Dock')
        throw new Error('Dock widget manager must not select a monitor');
    const dockRows = find(manager.widgetGroups.instances, widget => widget instanceof Adw.ActionRow);
    if (!dockRows.some(row => row.title === 'Horloge') || !dockRows.some(row => row.title === 'Calendrier'))
        throw new Error('Dock widget manager did not show all migrated widgets');
    settings.set_string('widget-monitors', '[]');
    await wait(100);
    if (button(manager, 'Ajouter Moniteur systeme').sensitive)
        throw new Error('Adding Dock widgets should be disabled without a monitor');
    settings.set_string('widget-monitors', JSON.stringify([
        {id: 'monitor-0', index: 0, name: 'Ecran principal', width: 1280, height: 720},
    ]));
    await wait(100);
    if (!button(manager, 'Ajouter Moniteur systeme').sensitive)
        throw new Error('Adding Dock widgets did not recover when a monitor returned');
    button(manager, 'Ajouter Moniteur systeme').emit('clicked');
    await wait(100);
    if (!readWidgetInstances(settings.get_string('widget-instances')).some(instance =>
        instance.target === 'dock' && instance.widget === 'system-monitor' && instance.monitor === '*'))
        throw new Error('New Dock widget is not shared across monitors');
    manager.close();
    await wait(100);
    const simple = importWidgetDirectory(rootDirectory.get_child('examples').get_child('simple-counter'),
        catalog.entries.map(entry => entry.description.id));
    if (simple.language !== 'simple' || simple.entry || simple.preview)
        throw new Error('Declarative widget was not imported as a single-file package');
    manager = openWidgetManager(window, settings, 'desktop', 'monitor-0');
    await wait(200);
    const simpleCatalogRow = find(manager.widgetGroups.catalog,
        widget => widget instanceof Adw.ActionRow && widget.title === 'Compteur simple')[0];
    if (!simpleCatalogRow || !find(simpleCatalogRow, widget => widget instanceof Gtk.Image).length)
        throw new Error('Declarative widget catalog entry or default preview is missing');
    button(simpleCatalogRow, 'Ajouter Compteur simple').emit('clicked');
    await wait(100);
    if (!readWidgetInstances(settings.get_string('widget-instances')).some(instance => instance.widget === 'simple-counter'))
        throw new Error('Declarative widget instance was not added');
    button(simpleCatalogRow, 'Desinstaller ce paquet').emit('clicked');
    await wait(100);
    const simpleConfirmation = window.get_visible_dialog();
    simpleConfirmation.emit('response', 'remove');
    simpleConfirmation.close();
    await wait(100);
    if (readWidgetInstances(settings.get_string('widget-instances')).some(instance => instance.widget === 'simple-counter'))
        throw new Error('Declarative widget instances were not removed');
    manager.close();
    await wait(100);
    const flux = importWidgetDirectory(rootDirectory.get_child('examples').get_child('flux-weather'),
        catalog.entries.map(entry => entry.description.id));
    if (flux.language !== 'flux' || !flux.fluxProgram?.sources?.weather)
        throw new Error('Flux widget or its HTTP source was not imported');
    manager = openWidgetManager(window, settings, 'desktop', 'monitor-0');
    await wait(200);
    const fluxRow = find(manager.widgetGroups.catalog,
        widget => widget instanceof Adw.ActionRow && widget.title === 'Meteo Flux')[0];
    if (!fluxRow || !find(fluxRow, widget => widget instanceof Gtk.Image).length)
        throw new Error('Flux widget catalog entry or default preview is missing');
    button(fluxRow, 'Ajouter Meteo Flux').emit('clicked');
    await wait(100);
    if (!readWidgetInstances(settings.get_string('widget-instances')).some(instance => instance.widget === 'flux-weather'))
        throw new Error('Flux widget instance was not added');
    button(fluxRow, 'Desinstaller ce paquet').emit('clicked');
    await wait(100);
    const fluxConfirmation = window.get_visible_dialog();
    fluxConfirmation.emit('response', 'remove');
    fluxConfirmation.close();
    await wait(100);
    if (readWidgetInstances(settings.get_string('widget-instances')).some(instance => instance.widget === 'flux-weather'))
        throw new Error('Flux widget instances were not removed');
    manager.close();
    await wait(100);
    const imported = importWidgetDirectory(rootDirectory.get_child('examples').get_child('example-status'),
        catalog.entries.map(entry => entry.description.id));
    if (imported.id !== 'example-status')
        throw new Error('Widget package was not imported');
    let duplicateRejected = false;
    try { importWidgetDirectory(rootDirectory.get_child('examples').get_child('example-status')); } catch { duplicateRejected = true; }
    if (!duplicateRejected)
        throw new Error('Duplicate widget import was allowed');
    manager = openWidgetManager(window, settings, 'desktop', 'monitor-0');
    await wait(200);
    button(manager, 'Ajouter Widget exemple').emit('clicked');
    await wait(100);
    const exampleRow = find(manager.widgetGroups.instances, widget => widget instanceof Adw.ActionRow && widget.title === 'Widget exemple')[0];
    button(exampleRow, 'Configurer ce widget').emit('clicked');
    await wait(100);
    editor = window.get_visible_dialog();
    const caption = find(editor, widget => widget instanceof Adw.EntryRow && widget.title === 'Titre')[0];
    const mode = find(editor, widget => widget instanceof Adw.ComboRow && widget.title === 'Contenu')[0];
    const color = find(editor, widget => widget instanceof Gtk.ColorDialogButton)[0];
    if (!caption || !mode || !color)
        throw new Error('Text, selection or color configuration fields are missing');
    const editorScroll = editor.get_extra_child();
    const editorAdjustment = editorScroll.get_vadjustment();
    editorAdjustment.value = editorAdjustment.upper - editorAdjustment.page_size;
    await wait(100);
    captureWidget(editor, 'widget-manager-configuration.png');
    caption.text = 'Configuration testee';
    mode.selected = 1;
    editor.emit('response', 'save');
    editor.close();
    await wait(100);
    const example = readWidgetInstances(settings.get_string('widget-instances')).find(instance => instance.widget === 'example-status');
    if (example.config.caption !== 'Configuration testee' || example.config.mode !== 'Date')
        throw new Error('Generated imported-widget configuration was not saved');
    button(manager, 'Desinstaller ce paquet').emit('clicked');
    await wait(100);
    const confirmation = window.get_visible_dialog();
    confirmation.emit('response', 'remove');
    confirmation.close();
    await wait(100);
    if (readWidgetCatalog(distributionDirectory).entries.some(entry => entry.description.id === 'example-status') ||
        readWidgetInstances(settings.get_string('widget-instances')).some(instance => instance.widget === 'example-status'))
        throw new Error('Imported package or its instances were not removed');
    manager.close();
    await wait(100);
    window.close();
    print('Native GTK folder view defaults, overrides and reset passed');
    print('Native widget manager migration, catalog, monitors, configuration, import and uninstall passed');
}

const loop = new GLib.MainLoop(null, false);
run().then(() => loop.quit()).catch(error => {
    printerr(error.stack);
    System.exit(1);
});
loop.run();