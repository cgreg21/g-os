import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {readAppFolders, writeAppFolders, folderViewOptions} from '../shared/appFolders.js';

type DockFolderButton = St.Button & {
    dockFocusKey: string;
    folderUri?: string;
    appFolderId?: string;
    folderMenu?: PopupMenu.PopupMenu;
    _delegate?: {getDragActor: () => St.Widget; getDragActorSource: () => Clutter.Actor};
};

type DockFolderEntry = {name: string; uri: string; isDirectory: boolean; icon: Gio.Icon;
    size: number; modified: number};

export function withDockFolders(Base) {
    return class extends Base {
        _addDockFolder(screen, uri, iconSize, iconPadding) {
            const folder = Gio.File.new_for_uri(uri);
            const name = folder.get_basename() || uri;
            const iconName = this._desktopFolderIconName?.(uri) ?? 'folder';
            const button = new St.Button({
                style_class: 'g-os-dock-item g-os-dock-folder',
                accessible_name: name,
                can_focus: true,
                reactive: true,
                track_hover: true,
                child: new St.Icon({icon_name: iconName, icon_size: iconSize}),
            }) as DockFolderButton;
            button.set_style(`padding: ${iconPadding}px;`);
            button.dockFocusKey = `folder:${uri}`;
            button.folderUri = uri;
            this._attachTooltip(screen, button, name);
            button.connect('clicked', () => this._openDockFolder(screen, button, folder));
            screen.folderButtons.push(button);
            screen.dock.add_child(button);
            return button;
        }

        _createAppFolderIcon(folder, iconSize) {
            if (folder.icon) {
                return new St.Icon({icon_size: iconSize,
                    ...(folder.icon.startsWith('file:')
                        ? {gicon: new Gio.FileIcon({file: Gio.File.new_for_uri(folder.icon)})}
                        : {icon_name: folder.icon})});
            }
            const preview = new St.Widget({style_class: 'g-os-dock-app-folder-preview',
                width: iconSize, height: iconSize});
            const cell = Math.floor(iconSize / 2);
            folder.apps.slice(0, 4).forEach((id, index) => {
                const app = this._appSystem.lookup_app(id);
                const icon = app?.create_icon_texture?.(cell - 4) ??
                    new St.Icon({icon_name: 'application-x-executable', icon_size: cell - 4});
                icon.set_size(cell - 4, cell - 4);
                icon.set_position(2 + index % 2 * cell, 2 + Math.floor(index / 2) * cell);
                preview.add_child(icon);
            });
            return preview;
        }

        _addDockAppFolder(screen, folder, iconSize, iconPadding) {
            const button = new St.Button({
                style_class: 'g-os-dock-item g-os-dock-app-folder', accessible_name: folder.name,
                can_focus: true, reactive: true, track_hover: true,
                child: this._createAppFolderIcon(folder, iconSize),
            }) as DockFolderButton;
            button.set_style(`padding: ${iconPadding}px;`);
            button.dockFocusKey = `app-folder:${folder.id}`;
            button.appFolderId = folder.id;
            button._delegate = {
                getDragActor: () => this._createAppFolderIcon(folder, iconSize),
                getDragActorSource: () => button.get_child(),
            };
            this._attachTooltip(screen, button, folder.name);
            button.connect('clicked', () => {
                button.folderMenu ??= this._createShortcutMenu(screen, button, {onOpen: menu => {
                    const current = readAppFolders(this._settings).find(item => item.id === folder.id);
                    const files = (current?.apps ?? []).map(id => this._appSystem.lookup_app(id)).filter(Boolean)
                        .map(app => ({name: app.get_name(), app, isDirectory: false,
                            icon: app.get_app_info?.().get_icon() ?? null}));
                    const adapter = {get_uri: () => `app-folder:${folder.id}`, view: current?.view ?? -1,
                        open: () => Main.overview.showApps()};
                    this._renderDockFolderMenu(menu, adapter, files, screen);
                }});
                button.folderMenu.open();
            });
            screen.dock.add_child(button);
        }

        _groupDockApplications(sourceId, targetId, folderId = null, screen = null) {
            if (!this._appSystem.lookup_app(sourceId) || !this._settings.is_writable('dock-app-folders'))
                return false;
            const folders = readAppFolders(this._settings);
            let target = folderId ? folders.find(folder => folder.id === folderId) : null;
            const created = !target;
            const dock = screen?.dock ?? this._screens.find(item => item.dock)?.dock;
            const order = [...new Set([...this._settings.get_strv('dock-item-order'),
                ...(dock?.get_children().filter(button => button.dockFocusKey).map(button => button.dockFocusKey) ?? [])])];
            if (folderId && !target)
                return false;
            if (!target) {
                if (sourceId === targetId || (targetId && !this._appSystem.lookup_app(targetId)))
                    return false;
                target = {id: GLib.uuid_string_random(), name: 'Applications', apps: targetId ? [targetId] : [], icon: '', view: -1};
                folders.push(target);
            }
            for (const folder of folders)
                folder.apps = folder.apps.filter(id => id !== sourceId && (folder === target || id !== targetId));
            if (!target.apps.includes(sourceId))
                target.apps.push(sourceId);
            const saved = writeAppFolders(this._settings, folders);
            if (saved && created && this._settings.is_writable('dock-item-order')) {
                const index = order.indexOf(`app:${targetId ?? sourceId}`);
                order.splice(index >= 0 ? index : order.length, 0, `app-folder:${target.id}`);
                this._settings.set_strv('dock-item-order', order);
            }
            return saved;
        }

        _openDockFolder(screen, button, folder) {
            if (!button.folderMenu) {
                let request = null;
                let disposed = false;
                button.folderMenu = this._createShortcutMenu(screen, button, {
                    onOpen: menu => {
                        request?.cancel();
                        menu.removeAll();
                        this._addOpenFolderAction(menu, folder);
                        menu.addMenuItem(new PopupMenu.PopupMenuItem('Chargement...', {
                            reactive: false,
                            can_focus: false,
                        }));
                        const token = new Gio.Cancellable();
                        request = token;
                        this._readDockFolderContents(folder, token).then(files => {
                            if (disposed || request !== token || token.is_cancelled() || !menu.isOpen)
                                return;
                            this._renderDockFolderMenu(menu, folder, files, screen);
                        }).catch(() => {
                            if (disposed || request !== token || token.is_cancelled() || !menu.isOpen)
                                return;
                            menu.removeAll();
                            this._addOpenFolderAction(menu, folder);
                            menu.addMenuItem(new PopupMenu.PopupMenuItem('Dossier indisponible', {
                                reactive: false,
                                can_focus: false,
                            }));
                        });
                    },
                    onClose: () => {
                        request?.cancel();
                        request = null;
                    },
                    onDestroy: () => {
                        disposed = true;
                        request?.cancel();
                        request = null;
                    },
                });
            }
            button.folderMenu.open();
        }

        _addOpenFolderAction(menu, folder) {
            const item = menu.addAction('Ouvrir le dossier', () => this._openLocation(folder.get_uri()));
            item.add_style_class_name('g-os-dock-folder-open');
            return item;
        }

        _sortDockFolderFiles(files, order) {
            const criterion = Math.floor(order / 2);
            const direction = order % 2 === 0 ? 1 : -1;
            return [...files].sort((first, second) => {
                const directories = Number(Boolean(second.isDirectory)) - Number(Boolean(first.isDirectory));
                const difference = criterion === 1 ? (first.size ?? 0) - (second.size ?? 0)
                    : criterion === 2 ? (first.modified ?? 0) - (second.modified ?? 0)
                    : first.name.localeCompare(second.name);
                return directories || direction * (difference || first.name.localeCompare(second.name) ||
                    (first.uri ?? '').localeCompare(second.uri ?? ''));
            });
        }

        _renderDockFolderMenu(menu, folder, files, screen = null) {
            menu.removeAll();
            menu.actor.remove_style_class_name('g-os-dock-folder-menu-fan');
            menu.actor.remove_style_class_name('g-os-dock-folder-menu-grid');
            if (!folder.open)
                this._addOpenFolderAction(menu, folder);
            if (files.length === 0) {
                menu.addMenuItem(new PopupMenu.PopupMenuItem('Dossier vide', {
                    reactive: false,
                    can_focus: false,
                }));
                return;
            }

            const view = folder.view ?? this._settings.get_value('dock-folder-views').deep_unpack()[folder.get_uri()];
            const fan = (view === 0 || view === 1 ? view : this._settings.get_int('dock-folder-view')) === 0;
            const options = folderViewOptions(this._settings, fan ? 'pile' : 'grille',
                folder.open ? folder.get_uri() : `folder:${folder.get_uri()}`);
            if (!folder.open)
                files = this._sortDockFolderFiles(files, options['sort-order']);
            if (fan) {
                menu.actor.add_style_class_name('g-os-dock-folder-menu-fan');
                if (screen?.position === 0 && menu.sourceActor)
                    menu._boxPointer?.setPosition(menu.sourceActor, 0.82);
            } else
                menu.actor.add_style_class_name('g-os-dock-folder-menu-grid');
            let content = fan
                ? new St.Widget({style_class: 'g-os-dock-folder-fan'})
                : new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'g-os-dock-folder-grid'});
            let scrollHeight = 0;
            let scrollWidth = 0;
            const cellWidth = Math.max(72, options['icon-size'] + 20);
            const cellHeight = Math.max(72, options['icon-size'] + options['text-size'] * 2 + 12);
            const openItem = file => {
                menu.close();
                if (file.app) {
                    file.app.activate();
                    Main.overview.hide();
                } else {
                    this._openLocation(file.uri);
                }
            };
            const createItem = file => {
                const layout = new St.BoxLayout({
                    orientation: fan ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
                    style_class: 'g-os-dock-folder-item-content',
                });
                const icon = new St.Icon({
                    ...(file.icon ? {gicon: file.icon}
                        : {icon_name: file.isDirectory ? 'folder' : 'text-x-generic'}),
                    icon_size: options['icon-size'],
                    y_align: Clutter.ActorAlign.CENTER,
                    x_align: Clutter.ActorAlign.CENTER,
                });
                const label = new St.Label({
                    text: file.name,
                    style_class: 'g-os-dock-folder-item-label',
                    y_align: Clutter.ActorAlign.CENTER,
                    x_align: fan ? Clutter.ActorAlign.END : Clutter.ActorAlign.CENTER,
                    x_expand: fan,
                });
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                label.add_style_class_name(`g-os-folder-text-size-${options['text-size']}`);
                if (fan) {
                    layout.add_child(new St.Bin({width: 200, child: label,
                        y_align: Clutter.ActorAlign.CENTER}));
                    layout.add_child(icon);
                } else {
                    layout.add_child(icon);
                    layout.add_child(label);
                }
                const item = new St.Button({
                    style_class: fan ? 'g-os-dock-folder-item g-os-dock-folder-fan-item' : 'g-os-dock-folder-item',
                    accessible_name: file.name,
                    can_focus: true,
                    reactive: true,
                    track_hover: true,
                    child: layout,
                });
                item.connect('clicked', () => openItem(file));
                if (!fan)
                    item.set_size(cellWidth, cellHeight);
                if (file.app) {
                    const delegate = {
                        app: file.app,
                        folderId: folder.get_uri().slice(11),
                        getDragActor: () => file.app.create_icon_texture(this._settings.get_int('icon-size')),
                        getDragActorSource: () => icon,
                    };
                    if (screen?.interactionDnd) {
                        screen.interactionDnd.registerSource(item, delegate, {
                            onBegin: () => menu.close(),
                        }, {}, screen.lifecycle);
                    } else {
                        item._delegate = delegate;
                        this._makeDraggable(item, () => menu.close(), () => {}, () => {});
                    }
                }
                return item;
            };

            if (fan) {
                const availableHeight = (screen?.monitor.height ?? 720) - 240;
                const itemHeight = Math.max(40, options['icon-size'] + 4, options['text-size'] + 26);
                const step = itemHeight + options.spacing;
                const count = Math.max(1, Math.floor(availableHeight / step));
                const visibleFiles = folder.open ? files : files.slice(0, options['max-files']);
                if (visibleFiles.length > count)
                    scrollHeight = Math.max(96, availableHeight);
                content.set_size(292 + options['icon-size'],
                    visibleFiles.length * itemHeight + Math.max(0, visibleFiles.length - 1) * options.spacing + 4);
                visibleFiles.forEach((file, index) => {
                    const item = createItem(file);
                    item.set_size(232 + options['icon-size'], itemHeight);
                    item.set_position(28, 4 + index * step);
                    content.add_child(item);
                });
            } else {
                const columns = options.columns;
                const rowHeight = cellHeight + options['vertical-spacing'];
                const rows = Math.max(1, Math.floor(((screen?.monitor.height ?? 720) - 240) / rowHeight));
                const visibleFiles = folder.open ? files : files.slice(0, columns * options.rows);
                if (visibleFiles.length > columns * rows)
                    scrollHeight = rows * rowHeight;
                const gridWidth = columns * cellWidth + Math.max(0, columns - 1) * options['horizontal-spacing'] + 4;
                const availableWidth = Math.max(96, (screen?.monitor.width ?? 1280) - 96);
                if (gridWidth > availableWidth)
                    scrollWidth = availableWidth;
                content.set_style(`spacing: ${options['vertical-spacing']}px;`);
                for (let index = 0; index < visibleFiles.length; index += columns) {
                    const row = new St.BoxLayout({style_class: 'g-os-dock-folder-grid-row',
                        style: `spacing: ${options['horizontal-spacing']}px;`});
                    for (const file of visibleFiles.slice(index, index + columns))
                        row.add_child(createItem(file));
                    content.add_child(row);
                }
            }

            if (scrollHeight > 0 || scrollWidth > 0) {
                const holder = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
                holder.add_child(content);
                const scroll = new St.ScrollView({child: holder,
                    hscrollbar_policy: scrollWidth > 0 ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER,
                    vscrollbar_policy: scrollHeight > 0 ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER,
                    style_class: 'g-os-dock-app-folder-scroll'});
                if (scrollHeight > 0)
                    scroll.set_height(scrollHeight);
                if (scrollWidth > 0)
                    scroll.set_width(scrollWidth);
                content = scroll;
            }
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            item.add_style_class_name(fan ? 'g-os-dock-folder-stack-container' : 'g-os-dock-folder-grid-container');
            item.add_child(content);
            menu.addMenuItem(item);
            if (fan && screen?.position === 0 && menu.sourceActor && menu._boxPointer) {
                const stack = scrollHeight > 0 || scrollWidth > 0
                    ? ((content as St.ScrollView).get_child() as unknown as St.Widget).get_children()[0] : content;
                this._alignDockStack(menu, stack);
            }
        }

        _alignDockStack(menu, stack) {
            let source = 0;
            let alignment = 0.82;
            const update = () => {
                if (source)
                    return;
                source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    source = 0;
                    const target = menu.sourceActor?.get_child();
                    const icon = stack.get_children()[0]?.get_child()?.get_children()[1];
                    if (!menu.isOpen || !target?.mapped || !icon?.mapped || !menu.actor.mapped)
                        return GLib.SOURCE_REMOVE;
                    const [targetX] = target.get_transformed_position();
                    const [targetWidth] = target.get_transformed_size();
                    const [iconX] = icon.get_transformed_position();
                    const [iconWidth] = icon.get_transformed_size();
                    const lastIcon = stack.get_children().at(-1)?.get_child()?.get_children()[1];
                    const dock = menu.sourceActor.get_parent();
                    if (lastIcon?.mapped && dock?.mapped) {
                        const [, dockY] = dock.get_transformed_position();
                        const [, lastY] = lastIcon.get_transformed_position();
                        const [, lastHeight] = lastIcon.get_transformed_size();
                        const desiredGap = 12 * St.ThemeContext.get_for_stage(global.stage).scale_factor;
                        const verticalDelta = dockY - lastY - lastHeight - desiredGap;
                        if (Number.isFinite(verticalDelta) && Math.abs(verticalDelta) > 0.5)
                            menu.actor.translation_y += verticalDelta;
                    }
                    const delta = iconX + iconWidth / 2 - targetX - targetWidth / 2;
                    const theme = menu.actor.get_theme_node();
                    const margin = 4 * theme.get_length('-arrow-border-radius') +
                        theme.get_length('-arrow-border-width') + theme.get_length('-arrow-base');
                    const [, , width] = menu.actor.get_preferred_size();
                    if (Number.isFinite(delta) && Math.abs(delta) > 1 && width > margin) {
                        const next = Math.max(0, Math.min(1, alignment + delta / (width - margin)));
                        if (Math.abs(next - alignment) > 0.001) {
                            alignment = next;
                            menu._boxPointer.setPosition(menu.sourceActor, alignment);
                        }
                    }
                    return GLib.SOURCE_REMOVE;
                });
            };
            const allocation = menu.actor.connect('notify::allocation', update);
            stack.connect('notify::allocation', update);
            stack.connect('destroy', () => {
                if (source)
                    GLib.source_remove(source);
                menu.actor.disconnect(allocation);
            });
            update();
        }

        async _readDockFolderContents(folder, cancellable): Promise<DockFolderEntry[]> {
            const enumerator = await new Promise<Gio.FileEnumerator>((resolve, reject) => {
                folder.enumerate_children_async(
                    'standard::name,standard::display-name,standard::type,standard::is-hidden,standard::icon,' +
                        'standard::size,time::modified',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (source, result) => {
                        try { resolve(source.enumerate_children_finish(result)); } catch (error) { reject(error); }
                    });
            });
            const files: DockFolderEntry[] = [];
            try {
                while (true) {
                    const batch = await new Promise<Gio.FileInfo[]>((resolve, reject) => {
                        enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
                            try { resolve(source.next_files_finish(result)); } catch (error) { reject(error); }
                        });
                    });
                    if (batch.length === 0)
                        break;
                    for (const info of batch) {
                        if (info.get_is_hidden())
                            continue;
                        const child = folder.get_child(info.get_name());
                        files.push({
                            name: info.get_display_name(),
                            uri: child.get_uri(),
                            isDirectory: info.get_file_type() === Gio.FileType.DIRECTORY,
                            icon: info.get_icon(),
                            size: info.get_size(),
                            modified: info.get_attribute_uint64('time::modified'),
                        });
                    }
                }
                return files;
            } finally {
                await new Promise<void>(resolve => {
                    enumerator.close_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
                        try { source.close_finish(result); } catch {}
                        resolve();
                    });
                });
            }
        }

    };
}
