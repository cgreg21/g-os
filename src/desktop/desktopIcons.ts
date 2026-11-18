import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {errorMessage} from '../shared/errorMessage.js';
import {classifyDesktopMount, desktopIconGridPosition, desktopIconLayoutKey, desktopSpecialFolderIcon} from './desktopIconLayout.js';

type DesktopIconItem = {
    id: string;
    category: string;
    name: string;
    uri?: string;
    iconName?: string | null;
    icon?: Gio.Icon | null;
    isDirectory?: boolean;
    contentType?: string | null;
    canRename?: boolean;
    canTrash?: boolean;
    canWrite?: boolean;
    mount?: Gio.Mount;
    volume?: Gio.Volume;
    createDirectory?: boolean;
};

type DesktopIconButton = St.Button & {
    desktopItem: DesktopIconItem;
    desktopGrid: {monitor: DesktopMonitor; index: number; cell: number; columnSpan: number; alignment: number;
        saved: {x: number; y: number} | null};
};

type DesktopBackgroundManager = {backgroundActor?: St.Widget & {_backgroundMenu?: PopupMenu.PopupMenu}};

type DesktopMonitor = (typeof Main.layoutManager.monitors)[number];

type DesktopIconView = {scroll: St.ScrollView; content: St.Viewport; monitor: DesktopMonitor};

const desktopBackgroundManagers = () =>
    (Main.layoutManager as typeof Main.layoutManager & {_bgManagers?: DesktopBackgroundManager[]})._bgManagers ?? [];

export function withDesktopIcons(Base) {
    return class extends Base {
        _setupDesktopIconTracking() {
            if (this._desktopIconVolumeMonitor)
                return;
            this._desktopIconActors = new Map();
            this._desktopIconViews = new Map();
            this._desktopIconSelection = new Set();
            this._desktopIconSignals = [];
            this._desktopIconVolumeMonitor = Gio.VolumeMonitor.get();
            for (const signal of ['mount-added', 'mount-removed', 'mount-changed',
                'volume-added', 'volume-removed', 'volume-changed']) {
                this._desktopIconSignals.push(this._desktopIconVolumeMonitor.connect(signal,
                    () => this._queueDesktopIconRefresh(true)));
            }
            this._desktopIconFolder = this._desktopFolder();
            this._setupDesktopIconSelection();
            this._desktopIconBackgroundMenus = new Map();
            try {
                this._desktopIconFolderMonitor = this._desktopIconFolder.monitor_directory(Gio.FileMonitorFlags.NONE, null);
                this._desktopIconFolderSignal = this._desktopIconFolderMonitor.connect('changed', () =>
                    this._queueDesktopIconRefresh(false));
            } catch {}
        }

        _desktopFolder() {
            const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) ??
                GLib.build_filenamev([GLib.get_home_dir(), 'Desktop']);
            return Gio.File.new_for_path(path);
        }

        _desktopFolderIconName(uri) {
            if (uri === Gio.File.new_for_path(GLib.get_home_dir()).get_uri())
                return 'folder-home';
            const folders = ([
                [GLib.UserDirectory.DIRECTORY_DESKTOP, 'user-desktop'],
                [GLib.UserDirectory.DIRECTORY_DOCUMENTS, 'folder-documents'],
                [GLib.UserDirectory.DIRECTORY_PICTURES, 'folder-pictures'],
                [GLib.UserDirectory.DIRECTORY_VIDEOS, 'folder-videos'],
                [GLib.UserDirectory.DIRECTORY_DOWNLOAD, 'folder-download'],
                [GLib.UserDirectory.DIRECTORY_MUSIC, 'folder-music'],
            ] as [GLib.UserDirectory, string][]).map(([directory, iconName]) => {
                const path = GLib.get_user_special_dir(directory);
                return path ? {uri: Gio.File.new_for_path(path).get_uri(), iconName} : null;
            }).filter((folder): folder is {uri: string; iconName: string} => folder !== null);
            return desktopSpecialFolderIcon(uri, folders);
        }

        _queueDesktopIconRefresh(rebuildDock) {
            if (!this._settings || this._desktopIconRefreshSource)
                return;
            this._desktopIconRefreshSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 180, () => {
                this._desktopIconRefreshSource = 0;
                if (!this._settings)
                    return GLib.SOURCE_REMOVE;
                this._syncDesktopIcons();
                if (rebuildDock)
                    this._rebuildDock();
                return GLib.SOURCE_REMOVE;
            });
        }

        _readDesktopFolder(): Promise<DesktopIconItem[]> {
            return new Promise<DesktopIconItem[]>(resolve => {
                const files: DesktopIconItem[] = [];
                this._desktopIconFolder.enumerate_children_async(
                    'standard::name,standard::display-name,standard::type,standard::icon,standard::content-type,' +
                        'access::can-rename,access::can-trash,access::can-write',
                    Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (directory, result) => {
                        let enumerator;
                        try { enumerator = directory.enumerate_children_finish(result); } catch { resolve(files); return; }
                        const close = () => enumerator.close_async(GLib.PRIORITY_DEFAULT, null, () => resolve(files));
                        const next = () => enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, null, (source, batch) => {
                            let infos;
                            try { infos = enumerator.next_files_finish(batch); } catch { close(); return; }
                            if (!infos.length) {
                                close();
                                return;
                            }
                            for (const info of infos) {
                                const file = this._desktopIconFolder.get_child(info.get_name());
                                const isDirectory = info.get_file_type() === Gio.FileType.DIRECTORY;
                                const contentType = info.get_content_type();
                                let fileIcon = null;
                                try {
                                    if (!isDirectory && contentType)
                                        fileIcon = Gio.content_type_get_icon(contentType);
                                } catch {}
                                files.push({id: `file:${file.get_uri()}`, category: 'folder',
                                    name: info.get_display_name(), uri: file.get_uri(), isDirectory, contentType,
                                    canRename: info.get_attribute_boolean('access::can-rename'),
                                    canTrash: info.get_attribute_boolean('access::can-trash'),
                                    canWrite: info.get_attribute_boolean('access::can-write'),
                                    icon: fileIcon,
                                    iconName: isDirectory ? this._desktopFolderIconName(file.get_uri()) ?? 'folder' : null});
                            }
                            next();
                        });
                        next();
                    });
            });
        }

        _desktopLocationItems() {
            const items: DesktopIconItem[] = [{id: 'home', category: 'home', name: 'Dossier personnel',
                uri: Gio.File.new_for_path(GLib.get_home_dir()).get_uri(), iconName: 'folder-home'}];
            const mounts = this._desktopIconVolumeMonitor.get_mounts();
            const mountedVolumes = new Set();
            for (const mount of mounts) {
                const volume = mount.get_volume();
                if (volume)
                    mountedVolumes.add(volume);
                const location = mount.get_default_location();
                if (!location)
                    continue;
                const drive = volume?.get_drive();
                const removable = Boolean(drive?.is_removable() || drive?.get_media_removable() || mount.can_eject());
                const category = classifyDesktopMount(location.get_uri(), removable);
                if (!category)
                    continue;
                items.push({id: `${category}:${mount.get_uuid?.() || location.get_uri()}`, category,
                    name: mount.get_name(), uri: location.get_uri(), icon: mount.get_icon(),
                    iconName: category === 'network' ? 'folder-remote-symbolic' : 'drive-removable-media-usb-symbolic',
                    mount});
            }
            for (const volume of this._desktopIconVolumeMonitor.get_volumes()) {
                if (mountedVolumes.has(volume))
                    continue;
                const drive = volume.get_drive();
                if (!drive?.is_removable() && !drive?.get_media_removable())
                    continue;
                const id = volume.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_UNIX_DEVICE) || volume.get_name();
                items.push({id: `removable:${id}`, category: 'removable', name: volume.get_name(),
                    icon: volume.get_icon(), iconName: 'drive-removable-media-usb-symbolic', volume});
            }
            return items;
        }

        _syncDesktopIcons() {
            const generation = (this._desktopIconGeneration ?? 0) + 1;
            this._desktopIconGeneration = generation;
            const enabled = ['folder', 'home', 'removable', 'network'].some(name =>
                this._settings.get_boolean(`desktop-icons-show-${name}`));
            this._destroyDesktopIconActors();
            if (!enabled)
                return;
            this._setupDesktopIconTracking();
            this._syncDesktopIconBackgroundMenus();
            Promise.all([this._settings.get_boolean('desktop-icons-show-folder')
                ? this._readDesktopFolder() : Promise.resolve<DesktopIconItem[]>([]),
                Promise.resolve(this._desktopLocationItems())])
                .then(([files, locations]) => {
                    if (generation !== this._desktopIconGeneration || !this._settings)
                        return;
                    const selected = locations.filter(item => this._settings.get_boolean(`desktop-icons-show-${item.category}`));
                    const items = [...files, ...selected].sort((first, second) =>
                        first.name.localeCompare(second.name, undefined, {sensitivity: 'base', numeric: true}));
                    for (const monitor of Main.layoutManager.monitors) {
                        const saved = this._readDesktopIconLayout();
                        items.forEach((item, index) => this._createDesktopIcon(item, monitor, index, saved));
                    }
                }).catch(() => {});
        }

        _readDesktopIconLayout() {
            try {
                const value = JSON.parse(this._settings.get_string('desktop-icons-layout'));
                return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
            } catch {
                return {};
            }
        }

        _desktopIconView(monitor) {
            if (this._desktopIconViews.has(monitor.index))
                return this._desktopIconViews.get(monitor.index);
            const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
            const content = new St.Viewport({layout_manager: new Clutter.FixedLayout(), width: area.width,
                height: area.height});
            const scroll = new St.ScrollView({child: content, reactive: true,
                hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
            const contextClick = new Clutter.ClickGesture({required_button: Clutter.BUTTON_SECONDARY,
                recognize_on_press: true});
            contextClick.connect('recognize', () => {
                const [x, y] = global.get_pointer();
                const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
                if (picked !== scroll && picked !== content)
                    return;
                const menu = desktopBackgroundManagers()[monitor.index]?.backgroundActor?._backgroundMenu;
                if (menu) {
                    this._closeDesktopIconMenu();
                    Main.layoutManager.setDummyCursorGeometry(x, y, 0, 0);
                    menu.open();
                }
            });
            scroll.add_action(contextClick);
            scroll.set_position(area.x, area.y);
            scroll.set_size(area.width, area.height);
            const parent = Main.layoutManager._backgroundGroup;
            parent.add_child(scroll);
            const background = desktopBackgroundManagers()[monitor.index]?.backgroundActor;
            if (background?.get_parent() === parent)
                parent.set_child_above_sibling(scroll, background);
            const view = {scroll, content, monitor};
            this._desktopIconViews.set(monitor.index, view);
            return view;
        }

        _queueDesktopIconLayout() {
            if (this._desktopIconLayoutSource)
                return;
            this._desktopIconLayoutSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._desktopIconLayoutSource = 0;
                for (const view of this._desktopIconViews?.values() ?? []) {
                    const area = Main.layoutManager.getWorkAreaForMonitor(view.monitor.index);
                    view.scroll.set_position(area.x, area.y);
                    view.scroll.set_size(area.width, area.height);
                    view.content.set_width(area.width);
                    const actors = [...this._desktopIconActors.values()]
                        .filter(actor => actor.desktopGrid.monitor.index === view.monitor.index);
                    const rowHeight = Math.ceil(Math.max(64, ...actors.map(actor => {
                        const [, naturalHeight] = actor.get_child().get_preferred_height(actor.width);
                        return Math.max(actor.desktopGrid.cell, naturalHeight);
                    })));
                    let contentHeight = area.height;
                    const occupied = new Set();
                    for (const actor of actors) {
                        const grid = actor.desktopGrid;
                        let position = desktopIconGridPosition(grid.index, area, grid.cell,
                            grid.saved, grid.columnSpan, grid.alignment, rowHeight);
                        let candidate = 0;
                        while (occupied.has(`${position.x}/${position.y}`))
                            position = desktopIconGridPosition(candidate++, area, grid.cell,
                                null, grid.columnSpan, grid.alignment, rowHeight);
                        occupied.add(`${position.x}/${position.y}`);
                        actor.set_height(rowHeight);
                        actor.set_position(position.x, position.y);
                        contentHeight = Math.max(contentHeight, position.y + rowHeight + 24);
                    }
                    view.content.set_height(contentHeight);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        _createDesktopIcon(item, monitor, index, savedLayout) {
            const iconSize = this._settings.get_int('desktop-icons-size');
            const cell = Math.max(this._settings.get_int('desktop-icons-grid-size'), iconSize + 16);
            const key = desktopIconLayoutKey(monitor, item.id);
            const labelPosition = this._settings.get_int('desktop-icons-label-position');
            const horizontal = labelPosition !== 2;
            const columnSpan = horizontal ? 2 : 1;
            const alignment = this._settings.get_int('desktop-icons-alignment');
            const position = desktopIconGridPosition(index, monitor, cell, savedLayout[key], columnSpan, alignment);
            const content = new St.BoxLayout({orientation: horizontal ? Clutter.Orientation.HORIZONTAL
                : Clutter.Orientation.VERTICAL, style_class: 'g-os-desktop-icon-content', x_expand: true, y_expand: true});
            const icon = new St.Icon(item.iconName ? {icon_name: item.iconName}
                : item.icon ? {gicon: item.icon} : {icon_name: 'text-x-generic'},
            );
            icon.icon_size = iconSize;
            icon.y_align = Clutter.ActorAlign.CENTER;
            if (!horizontal)
                icon.x_align = Clutter.ActorAlign.CENTER;
            const label = new St.Label({text: item.name, style_class: 'g-os-desktop-icon-label',
                x_expand: horizontal, y_expand: !horizontal});
            const labelTextAlign = labelPosition === 0 ? Pango.Alignment.RIGHT
                : labelPosition === 1 ? Pango.Alignment.LEFT : Pango.Alignment.CENTER;
            label.y_align = Clutter.ActorAlign.CENTER;
            label.clutter_text.y_align = Clutter.ActorAlign.CENTER;
            label.x_align = Clutter.ActorAlign.CENTER;
            label.clutter_text.line_wrap = true;
            label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            (label.clutter_text as typeof label.clutter_text & {max_lines: number}).max_lines = horizontal ? 3 : 2;
            const buttonWidth = cell * columnSpan;
            label.set_width(horizontal ? Math.max(24, buttonWidth - icon.icon_size - 12) : cell - 8);
            if (labelPosition === 0) {
                content.add_child(label);
                content.add_child(icon);
            } else {
                content.add_child(icon);
                content.add_child(label);
            }
            const button = new St.Button({style_class: 'g-os-desktop-icon',
                accessible_name: item.name, can_focus: true, reactive: true, track_hover: true,
                width: buttonWidth, height: cell, child: content}) as DesktopIconButton;
            button.set_position(monitor.x + position.x, monitor.y + position.y);
            button.desktopItem = item;
            button.connect('clicked', (actor, mouseButton) => {
                if (!mouseButton || mouseButton === Clutter.BUTTON_PRIMARY)
                    this._clickDesktopIcon(button);
            });
            button.connect('popup-menu', () => this._openDesktopIconMenu(button));
            const contextClick = new Clutter.ClickGesture({required_button: Clutter.BUTTON_SECONDARY,
                recognize_on_press: true});
            contextClick.connect('recognize', () => this._openDesktopIconMenu(button));
            button.add_action(contextClick);
            if (alignment === 2)
                this._attachDesktopIconDrag(button, monitor, key, cell, buttonWidth);
            button.desktopGrid = {monitor, index, cell, columnSpan, alignment, saved: savedLayout[key]};
            const view = this._desktopIconView(monitor);
            view.content.add_child(button);
            this._queueDesktopIconLayout();
            let alignmentSource = 0;
            const queueAlignment = () => {
                this._queueDesktopIconLayout();
                if (!alignmentSource)
                    alignmentSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        alignmentSource = 0;
                        label.clutter_text.set_line_alignment(labelTextAlign);
                        return GLib.SOURCE_REMOVE;
                    });
            };
            label.connect('style-changed', queueAlignment);
            queueAlignment();
            button.connect('destroy', () => {
                if (alignmentSource)
                    GLib.source_remove(alignmentSource);
                alignmentSource = 0;
            });
            this._desktopIconActors.set(`${monitor.index}:${item.id}`, button);
            if (this._desktopIconSelection?.has(item.id))
                button.add_style_pseudo_class('selected');
        }

        _openDesktopIcon(item) {
            if (item.volume && !item.mount) {
                item.volume.mount(Gio.MountMountFlags.NONE, null, null, (volume, result) => {
                    try {
                        volume.mount_finish(result);
                        const mount = volume.get_mount();
                        const location = mount?.get_default_location();
                        if (location)
                            this._openLocation(location.get_uri());
                    } catch (error) {
                        Main.notifyError('Impossible de monter le périphérique', errorMessage(error));
                    }
                });
                return;
            }
            this._openLocation(item.uri);
        }

        _setDesktopIconSelection(items) {
            this._desktopIconSelection = new Set(items);
            for (const actor of this._desktopIconActors?.values() ?? []) {
                if (this._desktopIconSelection.has(actor.desktopItem.id))
                    actor.add_style_pseudo_class('selected');
                else
                    actor.remove_style_pseudo_class('selected');
            }
        }

        _selectedDesktopItems() {
            const items = new Map();
            for (const actor of this._desktopIconActors?.values() ?? []) {
                if (this._desktopIconSelection?.has(actor.desktopItem.id))
                    items.set(actor.desktopItem.id, actor.desktopItem);
            }
            return [...items.values()];
        }

        _clickDesktopIcon(button) {
            const item = button.desktopItem;
            const control = Boolean(global.get_pointer()[2] & Clutter.ModifierType.CONTROL_MASK);
            const selected = new Set(control ? this._desktopIconSelection : []);
            if (control && selected.has(item.id))
                selected.delete(item.id);
            else
                selected.add(item.id);
            this._setDesktopIconSelection(selected);
            const now = GLib.get_monotonic_time() / 1000;
            const delay = global.stage.get_context().get_settings().double_click_time;
            if (!control && this._desktopIconLastClick?.id === item.id &&
                now - this._desktopIconLastClick.time <= delay) {
                this._desktopIconLastClick = null;
                this._openDesktopIcon(item);
            } else {
                this._desktopIconLastClick = control ? null : {id: item.id, time: now};
            }
        }

        _setupDesktopIconSelection() {
            this._desktopIconCapture = global.stage.connect('captured-event', (stage, event) => {
                const type = event.type();
                const [x, y] = event.get_coords();
                const state = this._desktopIconRubberBand;
                if (state && (type === Clutter.EventType.MOTION || type === Clutter.EventType.BUTTON_RELEASE)) {
                    const left = Math.min(state.x, x);
                    const top = Math.min(state.y, y);
                    const width = Math.abs(x - state.x);
                    const height = Math.abs(y - state.y);
                    state.actor.set_position(left, top);
                    state.actor.set_size(width, height);
                    const selected = new Set(state.selection);
                    for (const button of this._desktopIconActors.values()) {
                        const [buttonX, buttonY] = button.get_transformed_position();
                        const [buttonWidth, buttonHeight] = button.get_transformed_size();
                        if (buttonX < left + width && buttonX + buttonWidth > left &&
                            buttonY < top + height && buttonY + buttonHeight > top)
                            selected.add(button.desktopItem.id);
                    }
                    this._setDesktopIconSelection(selected);
                    if (type === Clutter.EventType.BUTTON_RELEASE) {
                        state.actor.destroy();
                        this._desktopIconRubberBand = null;
                    }
                    return Clutter.EVENT_STOP;
                }
                if (type !== Clutter.EventType.BUTTON_PRESS || event.get_button() !== Clutter.BUTTON_PRIMARY ||
                    Main.overview.visible || (Main.sessionMode as typeof Main.sessionMode & {isLocked?: boolean}).isLocked)
                    return Clutter.EVENT_PROPAGATE;
                const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
                const backgrounds = desktopBackgroundManagers();
                const isIcon = [...this._desktopIconActors.values()].some(actor => actor === picked || actor.contains(picked));
                const isBackground = !isIcon && ([...this._desktopIconViews.values()].some(view =>
                    picked === view.scroll || picked === view.content) || picked === Main.layoutManager._backgroundGroup || backgrounds.some(manager =>
                    picked === manager.backgroundActor || picked === manager.backgroundActor?.get_parent()));
                if (!isBackground)
                    return Clutter.EVENT_PROPAGATE;
                this._closeDesktopIconMenu();
                const selection = event.get_state() & Clutter.ModifierType.CONTROL_MASK
                    ? new Set(this._desktopIconSelection) : new Set();
                this._setDesktopIconSelection(selection);
                this._desktopIconLastClick = null;
                const actor = new St.Widget({style_class: 'g-os-desktop-selection', reactive: false});
                Main.uiGroup.add_child(actor);
                actor.set_position(x, y);
                this._desktopIconRubberBand = {x, y, actor, selection};
                return Clutter.EVENT_STOP;
            });
        }

        _syncDesktopIconBackgroundMenus() {
            for (const manager of desktopBackgroundManagers()) {
                const menu = manager.backgroundActor?._backgroundMenu;
                if (!menu || this._desktopIconBackgroundMenus.has(menu))
                    continue;
                const actions = [
                    menu.addAction('Ouvrir le dossier Bureau', () => this._openLocation(this._desktopFolder().get_uri())),
                    menu.addAction('Nouveau dossier…', () => this._newDesktopFolder(this._desktopFolder().get_uri())),
                    menu.addAction('Coller', () => this._pasteDesktopItems(this._desktopFolder().get_uri())),
                    menu.addAction('Tout sélectionner', () => this._setDesktopIconSelection(
                        [...this._desktopIconActors.values()].map(actor => actor.desktopItem.id))),
                ];
                const signal = menu.connect('destroy', () => this._desktopIconBackgroundMenus?.delete(menu));
                this._desktopIconBackgroundMenus.set(menu, {actions, signal});
            }
        }

        _closeDesktopIconMenu() {
            const menu = this._desktopIconContextMenu;
            if (!menu)
                return;
            this._desktopIconContextMenu = null;
            menu.close(0);
            Main.panel.menuManager.removeMenu(menu);
            menu.destroy();
        }

        _openDesktopIconMenu(button) {
            this._closeDesktopIconMenu();
            if (!this._desktopIconSelection.has(button.desktopItem.id))
                this._setDesktopIconSelection([button.desktopItem.id]);
            const items = this._selectedDesktopItems();
            const menu = new PopupMenu.PopupMenu(button, 0.5, St.Side.TOP);
            this._desktopIconContextMenu = menu;
            menu.actor.add_style_class_name('g-os-popup');
            Main.uiGroup.add_child(menu.actor);
            menu.actor.hide();
            Main.panel.menuManager.addMenu(menu);
            menu.addAction(items.length > 1 ? 'Ouvrir les éléments sélectionnés' : 'Ouvrir', () => {
                for (const item of items)
                    this._openDesktopIcon(item);
            });
            if (items.length === 1 && items[0].contentType && !items[0].isDirectory) {
                for (const app of Gio.AppInfo.get_recommended_for_type(items[0].contentType))
                    menu.addAction(`Ouvrir avec ${app.get_display_name()}`, () => {
                        try { app.launch([Gio.File.new_for_uri(items[0].uri)], global.create_app_launch_context(0, -1)); }
                        catch (error) { Main.notifyError('Impossible d’ouvrir le fichier', errorMessage(error)); }
                    });
            }
            const files = items.filter((item): item is DesktopIconItem & {uri: string} => typeof item.uri === 'string');
            if (files.length === items.length) {
                const clipboardActions: [boolean, string][] = [[false, 'Copier'], [true, 'Couper']];
                for (const [cut, title] of clipboardActions)
                    menu.addAction(title, () => this._copyDesktopItems(files, cut))
                        .setSensitive(!cut || items.every(item => item.category === 'folder' && item.canRename !== false));
                if (items.length === 1 && (items[0].isDirectory || items[0].category === 'home' || items[0].mount)) {
                    menu.addAction('Coller', () => this._pasteDesktopItems(items[0].uri));
                    menu.addAction('Nouveau dossier…', () => this._newDesktopFolder(items[0].uri));
                }
                menu.addAction('Afficher dans Fichiers', () => this._desktopFileManagerCall('ShowItems', files.map(item => item.uri)));
                if (items.length === 1 && items[0].category === 'folder')
                    menu.addAction('Renommer…', () => this._renameDesktopItem(button))
                        .setSensitive(items[0].canRename !== false);
                if (items.every(item => item.category === 'folder'))
                    menu.addAction('Mettre à la corbeille', () => this._trashDesktopItems(files))
                        .setSensitive(items.every(item => item.canTrash !== false));
                menu.addAction('Propriétés', () => this._desktopFileManagerCall('ShowItemProperties', files.map(item => item.uri)));
            }
            if (items.length === 1 && items[0].mount) {
                const mount = items[0].mount;
                if (mount.can_eject())
                    menu.addAction('Éjecter', () => this._unmountDesktopItem(mount, true));
                else if (mount.can_unmount())
                    menu.addAction(items[0].category === 'network' ? 'Déconnecter' : 'Démonter', () =>
                        this._unmountDesktopItem(mount, false));
            }
            menu.open();
        }

        _desktopFileManagerCall(method, uris) {
            Gio.DBus.session.call('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
                'org.freedesktop.FileManager1', method, new GLib.Variant('(ass)', [uris, '']), null,
                Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
                    try { connection.call_finish(result); }
                    catch (error) { Main.notifyError('Gestionnaire de fichiers indisponible', errorMessage(error)); }
                });
        }

        _copyDesktopItems(items, cut) {
            const bytes = new GLib.Bytes(new TextEncoder().encode(`${cut ? 'cut' : 'copy'}\n${items.map(item => item.uri).join('\n')}`));
            this._desktopIconClipboard = {uris: items.map(item => item.uri), cut, bytes};
            St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'x-special/gnome-copied-files',
                bytes);
        }

        async _pasteDesktopItems(uri) {
            const clipboard = St.Clipboard.get_default();
            const text = await new Promise<string | null>(resolve => clipboard.get_content(St.ClipboardType.CLIPBOARD,
                'x-special/gnome-copied-files', (source, content) => resolve(content
                    ? new TextDecoder().decode(content.get_data()) : null)));
            if (!text)
                return;
            const [operation, ...lines] = text.split('\n');
            if (!['copy', 'cut'].includes(operation))
                return;
            const uris = lines.filter(value => value && GLib.Uri.parse_scheme(value));
            const cut = operation === 'cut';
            const folder = Gio.File.new_for_uri(uri);
            try {
                for (const sourceUri of uris) {
                    const source = Gio.File.new_for_uri(sourceUri);
                    const target = folder.get_child(source.get_basename());
                    if (target.equal(source) || folder.has_prefix(source))
                        throw new Error('Impossible de coller un dossier à l’intérieur de lui-même');
                    if (cut) {
                        await new Promise<boolean>((resolve, reject) => {
                            const complete = (file, result) => {
                                try { resolve(file.move_finish(result)); } catch (error) { reject(error); }
                            };
                            source.move_async(target, Gio.FileCopyFlags.NONE, GLib.PRIORITY_DEFAULT, null, null, complete);
                        });
                    } else {
                        await this._copyDesktopFile(source, target);
                    }
                }
                if (cut) {
                    this._desktopIconClipboard = null;
                    clipboard.set_text(St.ClipboardType.CLIPBOARD, '');
                }
                this._queueDesktopIconRefresh(false);
            } catch (error) { Main.notifyError('Impossible de coller les éléments', errorMessage(error)); }
        }

        async _copyDesktopFile(source, target) {
            const info = await new Promise<Gio.FileInfo>((resolve, reject) => source.query_info_async('standard::type',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, null, (file, result) => {
                    try { resolve(file.query_info_finish(result)); } catch (error) { reject(error); }
                }));
            if (info.get_file_type() !== Gio.FileType.DIRECTORY) {
                await new Promise<boolean>((resolve, reject) => source.copy_async(target, Gio.FileCopyFlags.NOFOLLOW_SYMLINKS,
                    GLib.PRIORITY_DEFAULT, null, null, (file, result) => {
                        try { resolve(file.copy_finish(result)); } catch (error) { reject(error); }
                    }));
                return;
            }
            await new Promise<boolean>((resolve, reject) => target.make_directory_async(GLib.PRIORITY_DEFAULT, null, (file, result) => {
                try { resolve(file.make_directory_finish(result)); } catch (error) { reject(error); }
            }));
            const enumerator = await new Promise<Gio.FileEnumerator>((resolve, reject) => source.enumerate_children_async('standard::name',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, null, (file, result) => {
                    try { resolve(file.enumerate_children_finish(result)); } catch (error) { reject(error); }
                }));
            try {
                while (true) {
                    const entries = await new Promise<Gio.FileInfo[]>((resolve, reject) => enumerator.next_files_async(64,
                        GLib.PRIORITY_DEFAULT, null, (file, result) => {
                            try { resolve(file.next_files_finish(result)); } catch (error) { reject(error); }
                        }));
                    if (!entries.length)
                        break;
                    for (const entry of entries)
                        await this._copyDesktopFile(source.get_child(entry.get_name()), target.get_child(entry.get_name()));
                }
            } finally {
                await new Promise<void>(resolve => enumerator.close_async(GLib.PRIORITY_DEFAULT, null, (file, result) => {
                    try { file.close_finish(result); } catch {}
                    resolve();
                }));
            }
        }

        _renameDesktopItem(button) {
            this._promptDesktopFileName(button.desktopItem);
        }

        _newDesktopFolder(uri) {
            this._promptDesktopFileName({uri, name: 'Nouveau dossier', createDirectory: true});
        }

        _promptDesktopFileName(item) {
            this._desktopIconRenameDialog?.close();
            const dialog = new ModalDialog.ModalDialog();
            this._desktopIconRenameDialog = dialog;
            const title = item.createDirectory ? 'Nouveau dossier' : 'Renommer';
            const heading = new St.Label({text: title, style_class: 'headline'});
            const entry = new St.Entry({text: item.name, can_focus: true, x_expand: true});
            const errorLabel = new St.Label({text: '', style_class: 'g-os-desktop-file-error'});
            dialog.contentLayout.add_child(heading);
            dialog.contentLayout.add_child(entry);
            dialog.contentLayout.add_child(errorLabel);
            const rename = () => {
                const name = entry.get_text();
                if (!name || name === '.' || name === '..' || name.includes('/')) {
                    errorLabel.text = 'Nom de fichier invalide';
                    return;
                }
                if (!item.createDirectory && name === item.name) {
                    dialog.close();
                    return;
                }
                const complete = (file, result) => {
                        try {
                            if (item.createDirectory)
                                file.make_directory_finish(result);
                            else
                                file.set_display_name_finish(result);
                            if (this._desktopIconRenameDialog === dialog)
                                dialog.close();
                            this._queueDesktopIconRefresh(false);
                        } catch (error) {
                            if (this._desktopIconRenameDialog === dialog)
                                errorLabel.text = errorMessage(error);
                        }
                    };
                if (item.createDirectory)
                    Gio.File.new_for_uri(item.uri).get_child(name).make_directory_async(GLib.PRIORITY_DEFAULT, null, complete);
                else
                    Gio.File.new_for_uri(item.uri).set_display_name_async(name, GLib.PRIORITY_DEFAULT, null, complete);
            };
            dialog.setButtons([{label: 'Annuler', action: () => dialog.close(), key: Clutter.KEY_Escape},
                {label: item.createDirectory ? 'Créer' : 'Renommer', action: rename, default: true}]);
            entry.clutter_text.connect('activate', rename);
            dialog.setInitialKeyFocus(entry);
            dialog.connect('closed' as any, () => {
                if (this._desktopIconRenameDialog === dialog)
                    this._desktopIconRenameDialog = null;
            });
            dialog.open();
        }

        async _trashDesktopItems(items) {
            try {
                for (const item of items)
                    await new Promise<boolean>((resolve, reject) => Gio.File.new_for_uri(item.uri!).trash_async(
                        GLib.PRIORITY_DEFAULT, null, (file, result) => {
                            try { resolve(file.trash_finish(result)); } catch (error) { reject(error); }
                        }));
                this._queueDesktopIconRefresh(false);
            } catch (error) { Main.notifyError('Impossible de déplacer vers la corbeille', errorMessage(error)); }
        }

        _unmountDesktopItem(mount, eject) {
            const callback = (source, result) => {
                try { eject ? source.eject_with_operation_finish(result) : source.unmount_with_operation_finish(result); }
                catch (error) { Main.notifyError('Impossible de déconnecter le périphérique', errorMessage(error)); }
            };
            if (eject)
                mount.eject_with_operation(Gio.MountUnmountFlags.NONE, null, null, callback);
            else
                mount.unmount_with_operation(Gio.MountUnmountFlags.NONE, null, null, callback);
        }

        _attachDesktopIconDrag(button, monitor, key, cell, buttonWidth) {
            const screen = this._screens?.find(candidate =>
                candidate.monitor.index === monitor.index);
            if (!screen?.interactionDnd)
                return;

            let origin = null;
            let pointerOrigin = null;
            let destination = null;
            const reset = () => {
                origin = null;
                pointerOrigin = null;
                destination = null;
            };
            const finish = cancelled => {
                if (!origin)
                    return;
                if (!cancelled) {
                    const parent = button.get_parent();
                    if (!parent) {
                        button.set_position(...origin);
                        reset();
                        return;
                    }
                    const {x, y} = desktopIconGridPosition(0, {width: parent.width, height: parent.height}, cell,
                        {x: destination[0], y: destination[1]}, buttonWidth / cell, 2, button.height);
                    const layout = this._readDesktopIconLayout();
                    layout[key] = {x, y};
                    button.desktopGrid.saved = {x, y};
                    if (this._settings.is_writable('desktop-icons-layout'))
                        this._settings.set_string('desktop-icons-layout', JSON.stringify(layout));
                    button.set_position(x, y);
                    this._queueDesktopIconLayout();
                } else {
                    button.set_position(...origin);
                }
                reset();
            };
            screen.interactionDnd.registerSource(button, {}, {
                onBegin: () => {
                    origin = button.get_position();
                    pointerOrigin = global.get_pointer().slice(0, 2);
                    destination = origin;
                },
                onMotion: event => {
                    if (!origin || !pointerOrigin)
                        return;
                    const parent = button.get_parent();
                    if (!parent)
                        return;
                    const x = Math.max(24, Math.min(origin[0] + event.x - pointerOrigin[0], parent.width - buttonWidth));
                    const y = Math.max(48, Math.min(origin[1] + event.y - pointerOrigin[1], parent.height - button.height));
                    button.set_position(Math.round(x), Math.round(y));
                    destination = [Math.round(x), Math.round(y)];
                },
                onCancelled: () => finish(true),
                onEnd: () => finish(false),
                onDestroy: () => finish(true),
            }, {}, screen.lifecycle);
            screen.lifecycle.add(() => finish(true));
        }

        _destroyDesktopIconActors() {
            this._closeDesktopIconMenu();
            if (this._desktopIconLayoutSource)
                GLib.source_remove(this._desktopIconLayoutSource);
            this._desktopIconLayoutSource = 0;
            for (const button of this._desktopIconActors?.values() ?? []) {
                button.get_parent()?.remove_child(button);
                button.destroy();
            }
            this._desktopIconActors?.clear();
            for (const view of this._desktopIconViews?.values() ?? [])
                view.scroll.destroy();
            this._desktopIconViews?.clear();
        }

        _appendDockLocationShortcuts(screen, iconSize) {
            const categories = ['home', 'removable', 'network'];
            const enabled = new Set(categories.filter(category =>
                this._settings.get_boolean(`dock-icons-show-${category}`)));
            if (enabled.size === 0)
                return;
            this._setupDesktopIconTracking();
            for (const item of this._desktopLocationItems()) {
                if (!enabled.has(item.category))
                    continue;
                const themedIcon = item.icon instanceof Gio.ThemedIcon ? item.icon.get_names()[0] : null;
                const iconName = item.iconName || themedIcon || 'drive-removable-media-symbolic';
                const button = this._addDockShortcut(screen, item.name, iconName, iconSize,
                    () => this._openDesktopIcon(item));
                button.dockFocusKey = `location:${item.id}`;
            }
        }

        _stopDesktopIconTracking() {
            this._desktopIconRenameDialog?.close();
            this._desktopIconRenameDialog = null;
            if (this._desktopIconCapture)
                global.stage.disconnect(this._desktopIconCapture);
            this._desktopIconCapture = 0;
            this._desktopIconRubberBand?.actor.destroy();
            this._desktopIconRubberBand = null;
            for (const [menu, {actions, signal}] of this._desktopIconBackgroundMenus ?? []) {
                menu.disconnect(signal);
                for (const item of actions)
                    item.destroy();
            }
            this._desktopIconBackgroundMenus?.clear();
            if (this._desktopIconRefreshSource)
                GLib.source_remove(this._desktopIconRefreshSource);
            this._desktopIconRefreshSource = 0;
            if (this._desktopIconFolderMonitor) {
                this._desktopIconFolderMonitor.disconnect(this._desktopIconFolderSignal);
                this._desktopIconFolderMonitor.cancel();
            }
            this._desktopIconFolderMonitor = null;
            for (const id of this._desktopIconSignals ?? [])
                this._desktopIconVolumeMonitor?.disconnect(id);
            this._desktopIconSignals = [];
            this._desktopIconVolumeMonitor = null;
            this._desktopIconGeneration = (this._desktopIconGeneration ?? 0) + 1;
            this._destroyDesktopIconActors();
        }
    };
}