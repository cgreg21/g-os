import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {readAppFolders, writeAppFolders} from '../shared/appFolders.js';

export function withDockOrder(Base) {
    return class extends Base {
        _configureDockOrder(screen) {
            const saved = this._settings.get_strv('dock-item-order');
            const buttons = screen.dock.get_children().filter(button => button.dockFocusKey);
            if (saved.length > 0) {
                const ranks = new Map(saved.map((key, index) => [key, index]));
                buttons.sort((first, second) =>
                    (ranks.get(first.dockFocusKey) ?? saved.length) - (ranks.get(second.dockFocusKey) ?? saved.length));
                for (const child of screen.dock.get_children()) {
                    if (!child.dockFocusKey) {
                        screen.dock.remove_child(child);
                        child.destroy();
                    }
                }
                buttons.forEach((button, index) => screen.dock.set_child_at_index(button, index));
                screen.appButtons = buttons.filter(button => button.app);
                screen.folderButtons = buttons.filter(button => button.folderUri);
            }
            for (const button of buttons) {
                if (button.widgetInstance?.locked)
                    continue;
                if (!button._delegate) {
                    if (button.app) {
                        button._delegate = button;
                    } else {
                        const icon = button.get_child();
                        button._delegate = {
                            getDragActor: () => new St.Icon({
                                ...(icon.gicon ? {gicon: icon.gicon} : {icon_name: icon.icon_name}),
                                icon_size: this._settings.get_int('icon-size'),
                            }),
                            getDragActorSource: () => icon,
                        };
                    }
                }
                this._attachDockReorder(screen, button,
                    () => screen.dock.get_children().filter(candidate => candidate.dockFocusKey),
                    targetIndex => this._commitDockOrder(screen, button, targetIndex));
                if (button.app || button.appFolderId)
                    this._attachApplicationDrop(screen, button);
            }
        }

        _attachApplicationDrop(screen, button) {
            const accepts = (source, x, y) => {
                const [width, height] = button.get_transformed_size();
                const id = source?.app?.get_id();
                return this._settings.is_writable('dock-app-folders') && id &&
                    id !== button.app?.get_id() && source !== button._delegate &&
                    (!screen.reorder || (screen.reorder.groupTarget === button && screen.reorder.groupPreviewActive)) &&
                    x >= width * 0.25 && x <= width * 0.75 && y >= height * 0.2 && y <= height * 0.8;
            };
            button._delegate.handleDragOver = (source, actor, x, y) => {
                const accepted = accepts(source, x, y);
                if (accepted) {
                    button.add_style_pseudo_class('drop');
                    this._revealDock(screen);
                } else {
                    button.remove_style_pseudo_class('drop');
                }
                return accepted ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.CONTINUE;
            };
            button._delegate.acceptDrop = (source, actor, x, y) => {
                button.remove_style_pseudo_class('drop');
                if (!accepts(source, x, y))
                    return false;
                const sourceId = source.app.get_id();
                const targetId = button.app?.get_id();
                const folderId = button.appFolderId;
                if (screen.reorder)
                    screen.reorder.grouped = {sourceId, targetId, folderId};
                else
                    this._deferDockDrop(screen, () => this._groupDockApplications(sourceId, targetId, folderId, screen));
                return true;
            };
        }

        _deferDockDrop(screen, callback, surviveScreenDisposal = false) {
            const sources = surviveScreenDisposal
                ? (this._deferredDockDrops ??= new Set())
                : (screen.dropSources ??= new Set());
            const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                sources.delete(id);
                if ((surviveScreenDisposal || !screen.disposed) && this._settings)
                    callback();
                return GLib.SOURCE_REMOVE;
            });
            sources.add(id);
        }

        _clearDockGroupPreview(screen) {
            const state = screen.reorder;
            if (!state)
                return;
            if (state.groupSource)
                GLib.source_remove(state.groupSource);
            state.groupSource = 0;
            state.groupTarget?.remove_style_pseudo_class('drop');
            state.groupTarget = null;
            state.groupPreviewActive = false;
        }

        _commitDockOrder(screen, button, targetIndex) {
            if (!this._settings.is_writable('dock-item-order'))
                return;
            const visible = screen.dock.get_children().filter(candidate => candidate.dockFocusKey)
                .map(candidate => candidate.dockFocusKey);
            const desired = visible.filter(key => key !== button.dockFocusKey);
            desired.splice(targetIndex, 0, button.dockFocusKey);
            const visibleKeys = new Set(visible);
            const saved = [...new Set([...this._settings.get_strv('dock-item-order'), ...visible])];
            let index = 0;
            const order = saved.map(key => visibleKeys.has(key) ? desired[index++] : key);
            const favoriteIds = desired.filter(key => key.startsWith('app:') && this._favorites.isFavorite(key.slice(4)))
                .map(key => key.slice(4));
            const folders = desired.filter(key => key.startsWith('folder:')).map(key => key.slice(7));
            this._settings.set_strv('dock-item-order', order);
            if (button.app && this._favorites.isFavorite(button.app.get_id())) {
                const favoriteIndex = favoriteIds.indexOf(button.app.get_id());
                if (favoriteIndex !== this._favorites.getFavorites().findIndex(app => app.get_id() === button.app.get_id()))
                    this._favorites.moveFavoriteToPos(button.app.get_id(), favoriteIndex);
            }
            if (button.folderUri && this._settings.is_writable('dock-folders') &&
                folders.join('\n') !== this._settings.get_strv('dock-folders').join('\n'))
                this._settings.set_strv('dock-folders', folders);
        }

        _attachDockReorder(screen, button, getButtons, commit) {
            if (!screen.dock._delegate) {
                screen.dock._delegate = {
                    handleDragOver: source => screen.reorder ||
                        (source?.app && this._settings.is_writable('dock-app-folders'))
                        ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.CONTINUE,
                    acceptDrop: source => {
                        if (screen.reorder)
                            return source === screen.reorder.button || source === screen.reorder.button._delegate;
                        if (!source?.app)
                            return false;
                        if (this._isOverviewAppGridSource(source)) {
                            const appId = source.app.get_id();
                            if (!global.settings.is_writable('favorite-apps'))
                                return false;
                            this._deferDockDrop(screen, () => {
                                if (!this._favorites.isFavorite(appId))
                                    this._favorites.addFavorite(appId);
                            }, true);
                            return true;
                        }
                        if (source.folderId) {
                            if (!this._settings.is_writable('dock-app-folders'))
                                return false;
                            const folders = readAppFolders(this._settings);
                            const folder = folders.find(item => item.id === source.folderId);
                            if (!folder)
                                return false;
                            folder.apps = folder.apps.filter(id => id !== source.app.get_id());
                            if (!this._favorites.isFavorite(source.app.get_id()))
                                this._favorites.addFavorite(source.app.get_id());
                            return writeAppFolders(this._settings, folders);
                        }
                        return this._groupDockApplications(source.app.get_id(), null, null, screen);
                    },
                };
            }
            button._dockDraggable = this._makeDraggable(button, () => {
                this._updateDockMagnification(screen, null, true);
                const buttons = getButtons();
                const sourceIndex = buttons.indexOf(button);
                screen.reorder = {
                    button, buttons, sourceIndex, targetIndex: sourceIndex,
                    slots: buttons.map(candidate => ({
                        position: candidate.get_transformed_position(),
                        size: candidate.get_transformed_size(),
                    })),
                };
                button.opacity = 0;
                screen.tooltip.hide();
                this._revealDock(screen);
            }, event => {
                const state = screen.reorder;
                if (!state || screen.disposed)
                    return;
                const axis = screen.position === 0 ? 0 : 1;
                const coordinate = axis === 0 ? event.x : event.y;
                const grouping = button.app && this._settings.is_writable('dock-app-folders')
                    ? state.buttons.find((candidate, index) => candidate !== button && (candidate.app || candidate.appFolderId) &&
                        event.x >= state.slots[index].position[0] + state.slots[index].size[0] * 0.25 &&
                        event.x <= state.slots[index].position[0] + state.slots[index].size[0] * 0.75 &&
                        event.y >= state.slots[index].position[1] + state.slots[index].size[1] * 0.2 &&
                        event.y <= state.slots[index].position[1] + state.slots[index].size[1] * 0.8)
                    : null;
                const refreshPreview = state.groupPreviewActive && grouping !== state.groupTarget;
                if (grouping !== state.groupTarget) {
                    this._clearDockGroupPreview(screen);
                    if (grouping) {
                        state.groupTarget = grouping;
                        state.groupSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
                            state.groupSource = 0;
                            if (screen.disposed || screen.reorder !== state)
                                return GLib.SOURCE_REMOVE;
                            grouping.add_style_pseudo_class('drop');
                            state.groupPreviewActive = true;
                            for (const candidate of state.buttons) {
                                candidate.remove_all_transitions();
                                candidate.translation_x = 0;
                                candidate.translation_y = 0;
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }
                let targetIndex = state.slots.findIndex((slot, index) => {
                    const center = slot.position[axis] + slot.size[axis] / 2;
                    return coordinate < center || (coordinate === center && state.sourceIndex > index);
                });
                if (targetIndex < 0)
                    targetIndex = state.buttons.length;
                if (state.sourceIndex < targetIndex)
                    targetIndex--;
                if (targetIndex === state.targetIndex && !refreshPreview)
                    return;
                state.targetIndex = targetIndex;
                const order = state.buttons.filter(candidate => candidate !== button);
                order.splice(targetIndex, 0, button);
                const motion = St.Settings.get();
                const reduced = 'ReducedMotion' in St &&
                    (motion.reduced_motion ?? motion.reducedMotion) === St.ReducedMotion.REDUCE;
                let sizeOffset = 0;
                const destinations = order.map((candidate, index) => {
                    const destination = state.slots[index].position[axis] + sizeOffset;
                    sizeOffset += state.slots[state.buttons.indexOf(candidate)].size[axis] - state.slots[index].size[axis];
                    return destination;
                });
                for (const candidate of state.buttons) {
                    const original = state.slots[state.buttons.indexOf(candidate)].position;
                    const destination = destinations[order.indexOf(candidate)];
                    candidate.ease({
                        translation_x: axis === 0 ? destination - original[0] : 0,
                        translation_y: axis === 1 ? destination - original[1] : 0,
                        duration: motion.enable_animations && !reduced ? 120 : 0,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            }, cancelled => {
                const state = screen.reorder;
                if (!state || state.button !== button)
                    return;
                this._clearDockGroupPreview(screen);
                screen.reorder = null;
                for (const candidate of state.buttons) {
                    candidate.remove_all_transitions();
                    candidate.translation_x = 0;
                    candidate.translation_y = 0;
                }
                button.opacity = 255;
                if (!screen.disposed) {
                    if (screen.rebuildPending || (!cancelled && (state.grouped || state.targetIndex !== state.sourceIndex))) {
                        this._deferDockDrop(screen, () => {
                            if (!cancelled && state.grouped) {
                                const {sourceId, targetId, folderId} = state.grouped;
                                this._groupDockApplications(sourceId, targetId, folderId, screen);
                            } else if (!cancelled && state.targetIndex !== state.sourceIndex) {
                                commit(state.targetIndex);
                            }
                            if (!screen.disposed && screen.rebuildPending)
                                this._queueDockRebuild();
                        });
                    }
                    this._queueDockHide(screen);
                }
            });
        }

        _isOverviewAppGridSource(source) {
            const appDisplay = Main.overview._overview?.controls?.appDisplay;
            return Boolean(appDisplay?.contains?.(source));
        }

    };
}
