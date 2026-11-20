import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import {errorMessage} from '../shared/errorMessage.js';
import {DockItem} from './dockItem.js';

export function withDockMenus(Base) {
    return class extends Base {
        _createShortcutMenu(screen, button, {onOpen, onClose = () => {}, onDestroy = () => {}}) {
            const menu = new PopupMenu.PopupMenu(button, 0.5, screen.popupSide);
            menu.actor.add_style_class_name('g-os-popup');
            menu.addMenuItem(new PopupMenu.PopupMenuItem('Chargement...', {reactive: false, can_focus: false}));
            Main.uiGroup.add_child(menu.actor);
            menu.actor.hide();
            Main.panel.menuManager.addMenu(menu);
            screen.shortcutMenus.push(menu);
            DockItem.for(button, screen).setContextMenu(menu);
            button.shouldShowTooltip = () => button.hover && !menu.isOpen;
            let disposed = false;
            menu.connect('open-state-changed', (actor, open) => {
                if (disposed)
                    return;
                if (open) {
                    screen.tooltip.hide();
                    this._revealDock(screen);
                    onOpen(menu);
                } else {
                    onClose();
                    this._finishDockMenu(screen);
                    this._queueDockHide(screen);
                }
            });
            DockItem.for(button, screen).setContextMenu(menu).bindContextMenu(menu, Clutter);
            button.connect('destroy', () => {
                disposed = true;
                onDestroy();
                Main.panel.menuManager.removeMenu(menu);
                menu.destroy();
            });
            return menu;
        }

        _attachLaunchpadMenu(screen, button) {
            const actions = SystemActions.getDefault();
            this._createShortcutMenu(screen, button, {onOpen: menu => {
                menu.removeAll();
                const addSystemAction = (label, available, activate) => {
                    const item = menu.addAction(label, () => {
                        if (actions[available])
                            actions[activate]();
                    });
                    item.setSensitive(Boolean(actions[available]));
                };

                addSystemAction('Redémarrer', 'canRestart', 'activateRestart');
                addSystemAction('Éteindre', 'canPowerOff', 'activatePowerOff');
                addSystemAction('Se déconnecter', 'canLogout', 'activateLogout');
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                menu.addAction('Préférences G-Os', () => this.openPreferences());
                menu.addAction('Gestion des widgets du Dock', () => this._openWidgetManager('dock',
                    screen.monitor.connector || `monitor-${screen.monitor.index}`));
                const settings = menu.addAction('Paramètres système', () => {
                    const app = this._appSystem.lookup_app('org.gnome.Settings.desktop');
                    if (app) {
                        Main.overview.hide();
                        app.activate();
                    }
                });
                settings.setSensitive(Boolean(this._appSystem.lookup_app('org.gnome.Settings.desktop')));
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                addSystemAction('Verrouiller la session', 'canLockScreen', 'activateLockScreen');
                addSystemAction('Suspendre', 'canSuspend', 'activateSuspend');
            }});
        }

        _attachTrashMenu(screen, button) {
            const menu = this._createShortcutMenu(screen, button, {onOpen: menu => {
                menu.removeAll();
                menu.addAction('Ouvrir la corbeille', () => this._openLocation('trash:///'));
                const empty = menu.addAction('Vider la corbeille', () => {
                    menu.close();
                    return this._emptyTrash();
                });
                empty.setSensitive(this._trashCount !== 0 && !this._trashEmptying);
            }});
            button.trashMenu = menu;
        }

        async _emptyTrash() {
            if (this._trashEmptying || this._trashCount === 0)
                return;
            this._trashEmptying = true;
            const enumerate = directory => new Promise<Gio.FileEnumerator>((resolve, reject) => {
                directory.enumerate_children_async('standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                    GLib.PRIORITY_DEFAULT, null, (file, result) => {
                        try { resolve(file.enumerate_children_finish(result)); } catch (error) { reject(error); }
                    });
            });
            const nextFiles = enumerator => new Promise<Gio.FileInfo[]>((resolve, reject) => {
                enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, null, (file, result) => {
                    try { resolve(file.next_files_finish(result)); } catch (error) { reject(error); }
                });
            });
            const close = enumerator => new Promise<boolean>((resolve, reject) => {
                enumerator.close_async(GLib.PRIORITY_DEFAULT, null, (file, result) => {
                    try { resolve(file.close_finish(result)); } catch (error) { reject(error); }
                });
            });
            const remove = file => new Promise<boolean>((resolve, reject) => {
                file.delete_async(GLib.PRIORITY_DEFAULT, null, (entry, result) => {
                    try { resolve(entry.delete_finish(result)); } catch (error) { reject(error); }
                });
            });
            const emptyDirectory = async directory => {
                const enumerator = await enumerate(directory);
                try {
                    while (true) {
                        const entries = await nextFiles(enumerator);
                        if (entries.length === 0)
                            break;
                        for (const info of entries) {
                            const entry = directory.get_child(info.get_name());
                            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                                await emptyDirectory(entry);
                            await remove(entry);
                        }
                    }
                } finally {
                    await close(enumerator);
                }
            };
            try {
                await emptyDirectory(this._trashFile ?? Gio.File.new_for_uri('trash:///'));
                this._trashCount = 0;
                this._updateTrashButtons();
                this._refreshTrash();
            } catch (error) {
                Main.notifyError('Impossible de vider la corbeille', errorMessage(error));
            } finally {
                this._trashEmptying = false;
            }
        }

        _attachPlacesMenu(screen, button) {
            this._createShortcutMenu(screen, button, {onOpen: menu => {
                menu.removeAll();
                const home = Gio.File.new_for_path(GLib.get_home_dir()).get_uri();
                const seen = new Set([home]);
                menu.addAction('Dossier personnel', () => this._openLocation(home));
                const specialDirectories: [GLib.UserDirectory, string][] = [
                    [GLib.UserDirectory.DIRECTORY_DESKTOP, 'Bureau'],
                    [GLib.UserDirectory.DIRECTORY_DOWNLOAD, 'Téléchargements'],
                    [GLib.UserDirectory.DIRECTORY_DOCUMENTS, 'Documents'],
                    [GLib.UserDirectory.DIRECTORY_PICTURES, 'Images'],
                    [GLib.UserDirectory.DIRECTORY_MUSIC, 'Musique'],
                    [GLib.UserDirectory.DIRECTORY_VIDEOS, 'Vidéos'],
                ];
                for (const [directory, title] of specialDirectories) {
                    const path = GLib.get_user_special_dir(directory);
                    if (!path)
                        continue;
                    const uri = Gio.File.new_for_path(path).get_uri();
                    if (seen.has(uri))
                        continue;
                    seen.add(uri);
                    menu.addAction(title, () => this._openLocation(uri));
                }
            }});
        }

        _attachDownloadsMenu(screen, button, path) {
            const folder = Gio.File.new_for_path(path);
            let request = null;
            let disposed = false;
            let loading = false;
            let populated = false;
            let dirty = false;
            let refreshSource = 0;
            let monitor = null;
            let monitorSignal = 0;
            const items = new Map();
            const queueRefresh = () => {
                if (disposed || !menu.isOpen)
                    return;
                dirty = true;
                if (!refreshSource) {
                    refreshSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                        refreshSource = 0;
                        load();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            };
            const stop = () => {
                request?.cancel();
                request = null;
                loading = false;
                populated = false;
                dirty = false;
                if (refreshSource)
                    GLib.source_remove(refreshSource);
                refreshSource = 0;
                if (monitor) {
                    monitor.disconnect(monitorSignal);
                    monitor.cancel();
                }
                monitor = null;
                items.clear();
            };
            const reset = message => {
                menu.removeAll();
                items.clear();
                items.set('folder', this._addOpenFolderAction(menu, folder));
                items.set('refresh', menu.addAction('Actualiser', () => load()));
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Fichiers récents'));
                if (message)
                    menu.addMenuItem(new PopupMenu.PopupMenuItem(message, {reactive: false, can_focus: false}));
            };
            const render = (files, message) => {
                const focused = global.stage.get_key_focus();
                let selected = null;
                if (focused) {
                    for (const [key, item] of items) {
                        if (item === focused || item.contains(focused)) {
                            selected = key;
                            break;
                        }
                    }
                }
                reset(message);
                for (const file of files)
                    items.set(file.uri, this._addDownloadItem(menu, file));
                if (selected)
                    (items.get(selected) ?? items.get('folder')).grab_key_focus();
            };
            const load = async () => {
                if (disposed || !menu.isOpen)
                    return;
                if (loading) {
                    dirty = true;
                    return;
                }
                loading = true;
                dirty = false;
                request?.cancel();
                const token = new Gio.Cancellable();
                request = token;
                if (!populated)
                    reset('Chargement...');
                try {
                    const files = await this._readRecentDownloads(folder, token);
                    if (disposed || request !== token || !menu.isOpen)
                        return;
                    render(files, files.length === 0 ? 'Aucun fichier' : null);
                    populated = true;
                } catch {
                    if (!disposed && request === token && !token.is_cancelled()) {
                        render([], 'Dossier indisponible');
                        populated = true;
                    }
                } finally {
                    if (request === token) {
                        loading = false;
                        if (dirty)
                            queueRefresh();
                    }
                }
            };
            const menu = this._createShortcutMenu(screen, button, {
                onOpen: () => {
                    if (!monitor) {
                        try {
                            monitor = folder.monitor_directory(Gio.FileMonitorFlags.NONE, null);
                            monitorSignal = monitor.connect('changed', queueRefresh);
                        } catch {
                            monitor = null;
                        }
                    }
                    load();
                },
                onClose: stop,
                onDestroy: () => {
                    disposed = true;
                    stop();
                },
            });
            button.downloadsMenu = menu;
        }

        _isPartialDownload(file) {
            return /\.(?:part|partial|crdownload)$/i.test(file.basename ?? file.name);
        }

        _addDownloadItem(menu, file) {
            const item = new PopupMenu.PopupBaseMenuItem({can_focus: true}) as
                PopupMenu.PopupBaseMenuItem & {label: St.Label};
            const icon = new St.Icon({style_class: 'popup-menu-icon', icon_size: 20});
            const partial = this._isPartialDownload(file);
            if (partial)
                icon.icon_name = 'document-save-symbolic';
            else if (file.icon)
                icon.gicon = file.icon;
            else
                icon.icon_name = 'text-x-generic-symbolic';
            item.add_child(icon);
            const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
            const title = new St.Label({text: file.name, style_class: 'g-os-download-label', x_expand: true});
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(title);
            item.label = title;
            const description = file.contentType ? Gio.content_type_get_description(file.contentType) : '';
            const date = Number.isFinite(file.modified) && file.modified > 0
                ? GLib.DateTime.new_from_unix_local(file.modified)?.format('%x %H:%M') : '';
            const details = [partial ? 'Fichier partiel possible' : '', description, date].filter(Boolean).join(' - ');
            if (details) {
                const label = new St.Label({
                    text: details,
                    style_class: 'g-os-download-label g-os-download-details',
                    x_expand: true,
                });
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                text.add_child(label);
            }
            item.add_child(text);
            item.accessible_name = details ? `${file.name}, ${details}` : file.name;
            item.connect('activate', (actor, event) => {
                const modifiers = (event ?? Clutter.get_current_event())?.get_state() ?? 0;
                if (partial || (modifiers & Clutter.ModifierType.CONTROL_MASK))
                    this._showFileInFolder(file.uri);
                else
                    this._openLocation(file.uri);
            });
            const keys = new Clutter.KeyController();
            keys.connect('key-press', () => {
                const [, key] = keys.get_key();
                const modifiers = Clutter.get_current_event()?.get_state() ?? 0;
                if ((key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) &&
                    (modifiers & Clutter.ModifierType.CONTROL_MASK)) {
                    menu.close();
                    this._showFileInFolder(file.uri);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            item.add_action(keys);
            menu.addMenuItem(item);
            return item;
        }

        _showFileInFolder(uri) {
            Gio.DBus.session.call('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
                'org.freedesktop.FileManager1', 'ShowItems',
                new GLib.Variant('(ass)', [[uri], '']), null, Gio.DBusCallFlags.NONE, 5000, null,
                (connection, result) => {
                    try {
                        connection.call_finish(result);
                    } catch (error) {
                        const parent = Gio.File.new_for_uri(uri).get_parent();
                        if (parent)
                            this._openLocation(parent.get_uri());
                        else
                            Main.notifyError('Impossible d’afficher le fichier dans son dossier', errorMessage(error));
                    }
                });
        }

        async _readRecentDownloads(folder, cancellable) {
            const enumerator = await new Promise<Gio.FileEnumerator>((resolve, reject) => {
                folder.enumerate_children_async(
                    'standard::name,standard::display-name,standard::type,standard::is-hidden,' +
                        'standard::symbolic-icon,standard::fast-content-type,time::modified',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancellable,
                    (source, result) => {
                        try { resolve(source.enumerate_children_finish(result)); } catch (error) { reject(error); }
                    });
            });
            let recent = [];
            try {
                while (true) {
                    const batch = await new Promise<Gio.FileInfo[]>((resolve, reject) => {
                        enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
                            try { resolve(source.next_files_finish(result)); } catch (error) { reject(error); }
                        });
                    });
                    if (batch.length === 0)
                        break;
                    for (const info of batch) {
                        if (!info.get_is_hidden() && info.get_file_type() === Gio.FileType.REGULAR) {
                            recent.push({
                                name: info.get_display_name(),
                                basename: info.get_name(),
                                uri: folder.get_child(info.get_name()).get_uri(),
                                modified: info.get_attribute_uint64('time::modified'),
                                icon: info.get_symbolic_icon(),
                                contentType: info.get_attribute_string('standard::fast-content-type'),
                            });
                        }
                    }
                    recent.sort((first, second) => second.modified - first.modified || first.name.localeCompare(second.name));
                    recent = recent.slice(0, 12);
                }
                return recent;
            } finally {
                await new Promise<boolean>((resolve, reject) => {
                    enumerator.close_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
                        try { resolve(source.close_finish(result)); } catch (error) { reject(error); }
                    });
                });
            }
        }

    };
}
