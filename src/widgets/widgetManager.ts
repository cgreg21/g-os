import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import {readWidgetCatalog, readWidgetDescription, importWidgetDirectory, removeImportedWidget} from './widgetCatalog.js';
import {duplicateWidgetInstance, effectiveWidgetInstances, migrateWidgetDockOrder, nextWidgetGridCell, readWidgetInstances, WIDGET_APPEARANCE_FIELDS, widgetConfiguration, widgetMinimumSize} from './widgetRegistry.js';
import {errorMessage} from '../shared/errorMessage.js';

type WidgetManagerDialog = Adw.Dialog & {
    widgetPage: Adw.PreferencesPage;
    widgetGroups: {instances: Adw.PreferencesGroup; catalog: Adw.PreferencesGroup; errors: Adw.PreferencesGroup};
    monitorRow: Adw.ComboRow | null;
};

function readJSON(text, fallback) {
    try { return JSON.parse(text); } catch { return fallback; }
}

function configurationRow(field, value) {
    let row;
    let getValue;
    if (field.type === 'switch') {
        row = new Adw.SwitchRow({title: field.title, active: value});
        getValue = () => row.active;
    } else if (field.type === 'number') {
        row = Adw.SpinRow.new_with_range(field.min, field.max, field.step ?? 1);
        row.title = field.title;
        row.value = value;
        getValue = () => row.value;
    } else if (field.type === 'select') {
        row = new Adw.ComboRow({title: field.title, model: Gtk.StringList.new(field.choices),
            selected: Math.max(0, field.choices.indexOf(value))});
        getValue = () => field.choices[row.selected];
    } else if (field.type === 'color') {
        row = new Adw.ActionRow({title: field.title});
        const rgba = new Gdk.RGBA();
        rgba.parse(value);
        const button = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: true}), rgba,
            valign: Gtk.Align.CENTER});
        row.add_suffix(button);
        getValue = () => {
            const color = button.rgba;
            return `#${[color.red, color.green, color.blue, color.alpha]
                .map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;
        };
    } else {
        row = new Adw.EntryRow({title: field.title, text: value});
        getValue = () => row.text;
    }
    return {row, getValue};
}

export function openWidgetManager(parent, settings, target = 'desktop', requestedMonitor = null) {
    const directory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    let liveMonitors = readJSON(settings.get_string('widget-monitors'), []);
    if (!settings.get_boolean('widgets-managed') && liveMonitors.length > 0 &&
        settings.is_writable('widgets-managed') && settings.is_writable('widget-instances')) {
        const instances = effectiveWidgetInstances(settings, liveMonitors.map(monitor => ({...monitor, connector: monitor.id})))
            .map(instance => { const result = {...instance}; delete result.legacy; return result; });
        const writer = new Gio.Settings({settings_schema: settings.settings_schema});
        writer.delay();
        writer.set_string('widget-instances', JSON.stringify(instances));
        if (settings.is_writable('dock-item-order'))
            writer.set_strv('dock-item-order', migrateWidgetDockOrder(settings.get_strv('dock-item-order'), instances));
        writer.set_boolean('widgets-managed', true);
        writer.apply();
    }
    let catalog = readWidgetCatalog(directory);
    let closed = false;
    const signals = [];
    const body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 0});
    const header = new Adw.HeaderBar();
    body.append(header);
    const importButton = new Gtk.Button({icon_name: 'folder-download-symbolic', tooltip_text: 'Importer un dossier de widget'});
    importButton.sensitive = settings.is_writable('widget-catalog-revision');
    header.pack_start(importButton);
    const page = new Adw.PreferencesPage();
    const scroll = new Gtk.ScrolledWindow({child: page, vexpand: true, hscrollbar_policy: Gtk.PolicyType.NEVER});
    const toastOverlay = new Adw.ToastOverlay({child: scroll});
    body.append(toastOverlay);
    const dialog = new Adw.Dialog({title: target === 'desktop' ? 'Configuration des widgets du bureau' : 'Gestion des widgets du Dock',
        content_width: 760, content_height: 640, child: body}) as WidgetManagerDialog;
    const placement = target === 'desktop' ? new Adw.PreferencesGroup({title: 'Ecran et disposition'}) : null;
    if (placement)
        page.add(placement);
    const storedInstances = () => readWidgetInstances(settings.get_string('widget-instances')).map(instance =>
        widgetMinimumSize(instance, catalog.entries.find(entry => entry.description.id === instance.widget)?.description,
            settings.get_int('widget-grid-size')));
    const monitors = target === 'desktop' ? [...liveMonitors] : [];
    for (const instance of storedInstances().filter(value => value.target === 'desktop')) {
        if (!monitors.some(monitor => monitor.id === instance.monitor))
            monitors.push({id: instance.monitor, name: `${instance.monitor} (deconnecte)`});
    }
    const monitorRow = target === 'desktop' ? new Adw.ComboRow({title: 'Ecran', model: Gtk.StringList.new(monitors.length > 0
        ? monitors.map(monitor => `${monitor.name} (${monitor.id})`) : ['Aucun ecran disponible']),
        selected: Math.max(0, monitors.findIndex(monitor => monitor.id === requestedMonitor))}) : null;
    if (monitorRow)
        placement.add(monitorRow);
    if (target === 'desktop') {
        const grid = Adw.SpinRow.new_with_range(8, 128, 8);
        grid.title = 'Pas de la grille (px)';
        settings.bind('widget-grid-size', grid, 'value', Gio.SettingsBindFlags.DEFAULT);
        placement.add(grid);
        const showGrid = new Adw.SwitchRow({title: 'Afficher la grille du bureau'});
        settings.bind('widget-show-grid', showGrid, 'active', Gio.SettingsBindFlags.DEFAULT);
        placement.add(showGrid);
    }
    const instancesGroup = new Adw.PreferencesGroup({title: target === 'desktop' ? 'Widgets sur cet ecran' : 'Widgets du Dock'});
    const catalogGroup = new Adw.PreferencesGroup({title: 'Catalogue'});
    const errorsGroup = new Adw.PreferencesGroup({title: 'Erreurs'});
    page.add(instancesGroup);
    page.add(catalogGroup);
    page.add(errorsGroup);
    const rows: Record<'instances' | 'catalog' | 'errors', Adw.ActionRow[]> = {
        instances: [], catalog: [], errors: [],
    };
    const selectedMonitor = () => target === 'desktop' ? monitors[monitorRow.selected]?.id ?? null : '*';
    const write = values => {
        if (settings.is_writable('widget-instances')) {
            const removed = storedInstances().filter(instance => !values.some(value => value.id === instance.id));
            settings.set_string('widget-instances', JSON.stringify(values));
            if (removed.length > 0 && settings.is_writable('widget-state')) {
                const state = readJSON(settings.get_string('widget-state'), {});
                for (const instance of removed)
                    delete state[instance.id];
                settings.set_string('widget-state', JSON.stringify(state));
            }
        }
    };
    const update = (id, changes) => write(storedInstances().map(instance => instance.id === id ? {...instance, ...changes} : instance));
    const addIcon = (row, icon, title, callback) => {
        const button = new Gtk.Button({icon_name: icon, tooltip_text: title, valign: Gtk.Align.CENTER});
        button.add_css_class('flat');
        button.connect('clicked', callback);
        row.add_suffix(button);
        return button;
    };
    const edit = instance => {
        const entry = catalog.entries.find(value => value.description.id === instance.widget);
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12});
        const positionGroup = new Adw.PreferencesGroup({title: 'Position et format'});
        box.append(positionGroup);
        const screenChoices = target === 'desktop' ? monitors.map(monitor => ({...monitor})) : [];
        const screen = target === 'desktop' ? new Adw.ComboRow({title: 'Ecran',
            model: Gtk.StringList.new(screenChoices.map(monitor => monitor.name)),
            selected: Math.max(0, screenChoices.findIndex(monitor => monitor.id === instance.monitor))}) : null;
        if (screen)
            positionGroup.add(screen);
        const positionRows = new Map();
        if (target === 'desktop') {
            const minimumSize = widgetMinimumSize({...instance, columns: 1, rows: 1}, entry?.description,
                settings.get_int('widget-grid-size'));
            const positionFields: [string, string, number, number][] = [
                ['column', 'Colonne', 0, 1024], ['row', 'Ligne', 0, 1024],
                ['columns', 'Largeur (cases)', 1, 40], ['rows', 'Hauteur (cases)', 1, 40],
            ];
            for (const [key, title, minimum, maximum] of positionFields) {
                const effectiveMinimum = key === 'columns' ? minimumSize.columns : key === 'rows' ? minimumSize.rows : minimum;
                const row = Adw.SpinRow.new_with_range(effectiveMinimum, maximum, 1);
                row.title = title;
                row.value = instance[key];
                positionGroup.add(row);
                positionRows.set(key, row);
            }
        } else {
            const size = new Adw.ComboRow({title: 'Format du Dock', model: Gtk.StringList.new(['Large', '1x1']),
                selected: instance.dockSize});
            positionGroup.add(size);
            positionRows.set('dockSize', size);
        }
        const locked = new Adw.SwitchRow({title: 'Verrouiller le placement', active: instance.locked});
        positionGroup.add(locked);
        const foreground = new Adw.SwitchRow({title: 'Au premier plan', active: instance.foreground,
            visible: target === 'desktop'});
        positionGroup.add(foreground);
        const options = new Adw.PreferencesGroup({title: 'Configuration du widget'});
        const appearance = new Adw.PreferencesGroup({title: 'Apparence'});
        box.append(options);
        box.append(appearance);
        const configuration = entry ? widgetConfiguration(entry.description, instance.config) : {};
        const fields = new Map();
        for (const field of entry?.description.configuration ?? []) {
            const control = configurationRow(field, configuration[field.key]);
            options.add(control.row);
            fields.set(field.key, control.getValue);
        }
        for (const field of WIDGET_APPEARANCE_FIELDS) {
            const control = configurationRow(field, configuration[field.key]);
            appearance.add(control.row);
            fields.set(field.key, control.getValue);
        }
        const content = new Gtk.ScrolledWindow({child: box, min_content_height: 280, max_content_height: 520,
            propagate_natural_height: true, hscrollbar_policy: Gtk.PolicyType.NEVER});
        const editor = new Adw.AlertDialog({heading: entry?.description.name ?? instance.widget, extra_child: content,
            default_response: 'save', close_response: 'cancel'});
        editor.add_response('cancel', 'Annuler');
        editor.add_response('save', 'Enregistrer');
        editor.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
        editor.connect('response', (alert, response) => {
            if (response !== 'save')
                return;
            const positions = Object.fromEntries([...positionRows].map(([key, row]) =>
                [key, Math.round(key === 'dockSize' ? row.selected : row.value)]));
            update(instance.id, {...positions, monitor: target === 'desktop' ? screenChoices[screen.selected]?.id ?? instance.monitor : '*',
                locked: locked.active, foreground: foreground.active,
                config: Object.fromEntries([...fields].map(([key, getter]) => [key, getter()]))});
        });
        editor.present(parent);
    };
    const reorder = (instance, direction) => {
        const values = storedInstances();
        const indices = values.map((value, index) => value.target === target &&
            (target === 'dock' || value.monitor === instance.monitor) ? index : -1)
            .filter(index => index >= 0);
        const index = indices.findIndex(value => values[value].id === instance.id);
        const neighbor = indices[index + direction];
        if (neighbor === undefined)
            return;
        [values[indices[index]], values[neighbor]] = [values[neighbor], values[indices[index]]];
        const keys = values.filter(value => value.target === 'dock')
            .map(value => `widget-instance:${value.id}`);
        if (settings.is_writable('dock-item-order')) {
            const existing = settings.get_strv('dock-item-order').filter(key => !keys.includes(key));
            settings.set_strv('dock-item-order', [...existing, ...keys]);
        }
        write(values);
    };
    const rebuild = () => {
        if (closed)
            return;
        const groups: [keyof typeof rows, Adw.PreferencesGroup][] = [
            ['instances', instancesGroup], ['catalog', catalogGroup], ['errors', errorsGroup],
        ];
        for (const [kind, group] of groups) {
            for (const row of rows[kind])
                group.remove(row);
            rows[kind] = [];
        }
        for (const instance of storedInstances().filter(value => value.target === target &&
            (target === 'dock' || value.monitor === selectedMonitor()))) {
            const entry = catalog.entries.find(value => value.description.id === instance.widget);
            const row = new Adw.ActionRow({title: entry?.description.name ?? instance.widget,
                subtitle: target === 'desktop' ? `Colonne ${instance.column}, ligne ${instance.row} - ${instance.columns}x${instance.rows}`
                    : instance.dockSize === 1 ? '1x1' : 'Large',
                sensitive: settings.get_boolean('widgets-managed') && settings.is_writable('widget-instances')});
            const enabled = new Gtk.Switch({active: instance.enabled, valign: Gtk.Align.CENTER});
            enabled.connect('notify::active', () => update(instance.id, {enabled: enabled.active}));
            row.add_suffix(enabled);
            addIcon(row, instance.locked ? 'changes-prevent-symbolic' : 'changes-allow-symbolic',
                instance.locked ? 'Deverrouiller' : 'Verrouiller', () => update(instance.id, {locked: !instance.locked}));
            if (target === 'desktop')
                addIcon(row, 'window-maximize-symbolic', instance.foreground ? 'Retirer du premier plan' : 'Mettre au premier plan',
                    () => update(instance.id, {foreground: !instance.foreground}));
            else {
                addIcon(row, 'go-up-symbolic', 'Deplacer avant', () => reorder(instance, -1));
                addIcon(row, 'go-down-symbolic', 'Deplacer apres', () => reorder(instance, 1));
            }
            addIcon(row, 'document-properties-symbolic', 'Configurer ce widget', () => edit(instance));
            addIcon(row, 'edit-copy-symbolic', 'Dupliquer ce widget', () => {
                const duplicate = duplicateWidgetInstance(instance, storedInstances(), liveMonitors,
                    settings.get_int('widget-grid-size'), GLib.uuid_string_random());
                if (!duplicate) {
                    toastOverlay.add_toast(new Adw.Toast({title: 'Pas de zone libre sur cet ecran'}));
                    return;
                }
                write([...storedInstances(), duplicate]);
            });
            addIcon(row, 'user-trash-symbolic', 'Retirer ce widget', () => write(storedInstances().filter(value => value.id !== instance.id)));
            instancesGroup.add(row);
            rows.instances.push(row);
        }
        for (const entry of catalog.entries.filter(value => value.description.targets.includes(target))) {
            const row = new Adw.ActionRow({title: entry.description.name, subtitle: entry.description.description ?? ''});
            const picture = entry.description.preview
                ? new Gtk.Picture({file: entry.directory.resolve_relative_path(entry.description.preview),
                    width_request: 96, height_request: 64, can_shrink: true, content_fit: Gtk.ContentFit.CONTAIN})
                : new Gtk.Image({icon_name: entry.description.icon || 'applications-utilities-symbolic',
                    pixel_size: 32, width_request: 96, height_request: 64});
            row.add_prefix(picture);
            const add = addIcon(row, 'list-add-symbolic', `Ajouter ${entry.description.name}`, () => {
                let instance = {id: GLib.uuid_string_random(), widget: entry.description.id, target, monitor: selectedMonitor(),
                    column: 1, row: 2, columns: entry.description.size?.columns ?? 7, rows: entry.description.size?.rows ?? 4,
                    locked: false, foreground: false, enabled: true, dockSize: 0, config: {}};
                instance = widgetMinimumSize(instance, entry.description, settings.get_int('widget-grid-size'));
                if (target === 'desktop') {
                    const monitor = liveMonitors.find(value => value.id === instance.monitor);
                    const cell = nextWidgetGridCell(storedInstances(), instance.monitor, instance.columns, instance.rows,
                        settings.get_int('widget-grid-size'), monitor.workArea?.width ?? monitor.width,
                        monitor.workArea?.height ?? monitor.height);
                    if (!cell) {
                        toastOverlay.add_toast(new Adw.Toast({title: 'Pas de zone libre sur cet ecran'}));
                        return;
                    }
                    Object.assign(instance, cell);
                }
                write([...storedInstances(), instance]);
            });
            add.sensitive = settings.get_boolean('widgets-managed') && settings.is_writable('widget-instances') &&
                (target === 'dock' ? liveMonitors.length > 0 : liveMonitors.some(monitor => monitor.id === selectedMonitor()));
            catalogGroup.add(row);
            rows.catalog.push(row);
            if (!entry.builtin) {
                addIcon(row, 'user-trash-symbolic', 'Desinstaller ce paquet', () => {
                    const confirmation = new Adw.AlertDialog({heading: `Desinstaller ${entry.description.name} ?`,
                        body: 'Le paquet importe et ses instances seront retires.', default_response: 'cancel', close_response: 'cancel'});
                    confirmation.add_response('cancel', 'Annuler');
                    confirmation.add_response('remove', 'Desinstaller');
                    confirmation.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
                    confirmation.connect('response', (alert, response) => {
                        if (response !== 'remove' || closed)
                            return;
                        try {
                            removeImportedWidget(entry.description.id);
                            write(storedInstances().filter(instance => instance.widget !== entry.description.id));
                            catalog = readWidgetCatalog(directory);
                            settings.set_int('widget-catalog-revision', settings.get_int('widget-catalog-revision') + 1);
                            rebuild();
                        } catch (error) {
                            toastOverlay.add_toast(new Adw.Toast({title: errorMessage(error)}));
                        }
                    });
                    confirmation.present(parent);
                });
            }
        }
        const failures = {...readJSON(settings.get_string('widget-errors'), {})};
        for (const error of catalog.errors)
            failures[error.id] = error.message;
        for (const [id, message] of Object.entries(failures)) {
            const row = new Adw.ActionRow({title: id, subtitle: String(message)});
            errorsGroup.add(row);
            rows.errors.push(row);
        }
        errorsGroup.visible = rows.errors.length > 0;
    };
    importButton.connect('clicked', () => {
        const chooser = new Gtk.FileDialog({title: 'Importer un dossier de widget'});
        chooser.select_folder(parent, null, (source, result) => {
            let folder;
            try { folder = source.select_folder_finish(result); } catch { return; }
            let description;
            try { description = readWidgetDescription(folder); } catch (error) {
                toastOverlay.add_toast(new Adw.Toast({title: errorMessage(error)}));
                return;
            }
            const origins = description.language === 'flux'
                ? [...new Set(Object.values(description.fluxProgram.sources).map((item: any) => {
                    const uri = GLib.Uri.parse(item.url, GLib.UriFlags.NONE);
                    const port = uri.get_port();
                    return `${uri.get_scheme()}://${uri.get_host()}${port >= 0 ? `:${port}` : ''}`;
                }))] : [];
            const network = origins.length > 0 ? `\nSources HTTP (locales ou externes) :\n${origins.join('\n')}\n` : '';
            const confirmation = new Adw.AlertDialog({heading: 'Faire confiance a ce widget ?',
                body: `Les widgets JavaScript utilisent vos droits et les widgets Flux peuvent acceder au reseau. Importez uniquement des paquets de confiance.${network}\n${folder.get_path()}`,
                default_response: 'cancel', close_response: 'cancel'});
            confirmation.add_response('cancel', 'Annuler');
            confirmation.add_response('import', 'Importer');
            confirmation.connect('response', (alert, response) => {
                if (response !== 'import' || closed)
                    return;
                try {
                    const description = importWidgetDirectory(folder, catalog.entries.map(entry => entry.description.id));
                    catalog = readWidgetCatalog(directory);
                    settings.set_int('widget-catalog-revision', settings.get_int('widget-catalog-revision') + 1);
                    toastOverlay.add_toast(new Adw.Toast({title: `${description.name} importe`}));
                    rebuild();
                } catch (error) {
                    toastOverlay.add_toast(new Adw.Toast({title: errorMessage(error)}));
                }
            });
            confirmation.present(parent);
        });
    });
    monitorRow?.connect('notify::selected', rebuild);
    signals.push(settings.connect('changed::widget-instances', rebuild));
    signals.push(settings.connect('changed::widget-errors', rebuild));
    if (target === 'desktop')
        signals.push(settings.connect('changed::widget-monitors', () => {
            if (closed)
                return;
            const selected = selectedMonitor();
            liveMonitors = readJSON(settings.get_string('widget-monitors'), []);
            const available = [...liveMonitors];
            const saved = storedInstances().filter(instance => instance.target === 'desktop').map(instance => instance.monitor);
            if (selected)
                saved.push(selected);
            for (const id of saved) {
                if (!available.some(monitor => monitor.id === id))
                    available.push({id, name: `${id} (deconnecte)`});
            }
            monitors.splice(0, monitors.length, ...available);
            monitorRow.model = Gtk.StringList.new(monitors.length > 0 ? monitors.map(monitor => `${monitor.name} (${monitor.id})`)
                : ['Aucun ecran disponible']);
            monitorRow.selected = Math.max(0, monitors.findIndex(monitor => monitor.id === selected));
            rebuild();
        }));
    else
        signals.push(settings.connect('changed::widget-monitors', () => {
            liveMonitors = readJSON(settings.get_string('widget-monitors'), []);
            rebuild();
        }));
    signals.push(settings.connect('writable-changed', rebuild));
    dialog.connect('closed', () => {
        closed = true;
        for (const id of signals)
            settings.disconnect(id);
    });
    dialog.widgetPage = page;
    dialog.widgetGroups = {instances: instancesGroup, catalog: catalogGroup, errors: errorsGroup};
    dialog.monitorRow = monitorRow;
    rebuild();
    dialog.present(parent);
    return dialog;
}