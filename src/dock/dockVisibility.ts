import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {rectanglesOverlap} from '../shared/geometry/rectangle.js';

export function withDockVisibility(Base) {
    return class extends Base {
        _dockWindowTrackingEnabled() {
            return this._settings.get_boolean('dock-hide-when-covered') ||
                (this._settings.get_boolean('reserve-dock-space') &&
                    this._settings.get_boolean('dock-maximize-slide'));
        }
        _trackDockCoverageWindow(window) {
            if (!window || !this._dockWindowTrackingEnabled() ||
                this._dockCoverageWindows.has(window))
                return;
            const signals = [];
            for (const signal of ['position-changed', 'size-changed'])
                signals.push(window.connect(signal, () => this._queueDockCoverageUpdate()));
            for (const signal of ['workspace-changed', 'notify::minimized', 'notify::maximized-horizontally',
                'notify::maximized-vertically', 'notify::fullscreen'])
                signals.push(window.connect(signal, () => this._updateDockCoverage()));
            signals.push(window.connect('unmanaged', () => this._untrackDockCoverageWindow(window)));
            this._dockCoverageWindows.set(window, signals);
        }

        _untrackDockCoverageWindow(window) {
            const signals = this._dockCoverageWindows.get(window);
            if (!signals)
                return;
            for (const id of signals)
                window.disconnect(id);
            this._dockCoverageWindows.delete(window);
            this._updateDockCoverage();
        }

        _syncDockCoverageWindows() {
            if (!this._dockWindowTrackingEnabled()) {
                this._disconnectDockCoverageWindows();
                return;
            }
            for (const actor of global.get_window_actors())
                this._trackDockCoverageWindow(actor.meta_window);
        }

        _disconnectDockCoverageWindows() {
            if (this._dockCoverageSource)
                GLib.source_remove(this._dockCoverageSource);
            this._dockCoverageSource = 0;
            for (const [window, signals] of this._dockCoverageWindows ?? []) {
                for (const id of signals)
                    window.disconnect(id);
            }
            this._dockCoverageWindows?.clear();
        }

        _queueDockCoverageUpdate() {
            if (this._dockCoverageSource)
                return;
            this._dockCoverageSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._dockCoverageSource = 0;
                if (this._settings)
                    this._updateDockCoverage();
                return GLib.SOURCE_REMOVE;
            });
        }

        _windowCoversDock(screen, window) {
            if (!window || window.minimized ||
                window.get_window_type?.() === Meta.WindowType.DESKTOP ||
                (typeof window.showing_on_its_workspace === 'function' && !window.showing_on_its_workspace()))
                return false;
            const activeWorkspace = global.workspace_manager.get_active_workspace();
            const workspace = window.get_workspace?.();
            if (workspace && workspace !== activeWorkspace && !window.is_on_all_workspaces?.())
                return false;
            const frame = window.get_frame_rect?.();
            if (!frame || frame.width <= 0 || frame.height <= 0)
                return false;
            const [dockX, dockY] = screen.dockContainer.get_position();
            const [, preferredWidth] = screen.dockContainer.get_preferred_width(-1);
            const dockWidth = screen.dockContainer.width || preferredWidth;
            const [, preferredHeight] = screen.dockContainer.get_preferred_height(dockWidth);
            const dockHeight = screen.dockContainer.height || preferredHeight;
            return rectanglesOverlap(
                {x: frame.x, y: frame.y, width: frame.width, height: frame.height},
                {x: dockX, y: dockY, width: dockWidth, height: dockHeight},
            );
        }

        _updateDockCoverage() {
            if (!this._settings?.get_boolean('show-dock'))
                return;
            const hideWhenCovered = this._settings.get_boolean('dock-hide-when-covered');
            const slideForMaximized = this._settings.get_boolean('reserve-dock-space') &&
                this._settings.get_boolean('dock-maximize-slide');
            if (!hideWhenCovered && !slideForMaximized)
                return;
            const windows = global.get_window_actors().map(actor => actor.meta_window)
                .filter(window => this._dockCoverageWindows.has(window));
            for (const screen of this._screens) {
                if (!screen.dockContainer)
                    continue;
                const docked = slideForMaximized && !screen.monitor.inFullscreen &&
                    windows.some(window => this._windowMaximizedOnScreen(screen, window));
                if (screen.dockDocked !== docked) {
                    screen.dockDocked = docked;
                    this._positionDock(true, screen);
                }
                if (!hideWhenCovered || screen.monitor.inFullscreen)
                    continue;
                const covered = windows.some(window => this._windowCoversDock(screen, window));
                screen.dockCovered = covered;
                if (!covered)
                    screen.dockPeek = false;
                if (covered) {
                    if (!screen.dockPeek)
                        this._hideDock(screen);
                } else if (!this._settings.get_boolean('dock-autohide') || screen.edge?.hover ||
                    screen.dockContainer.hover || this._dockHasFocus(screen)) {
                    this._revealDock(screen);
                } else if (screen.dockContainer.visible && !screen.hideSource) {
                    this._queueDockHide(screen);
                }
            }
        }

        _windowMaximizedOnScreen(screen, window) {
            return Boolean(window && !window.minimized && !window.fullscreen &&
                window.maximized_horizontally && window.maximized_vertically &&
                window.get_monitor?.() === screen.monitor.index &&
                (typeof window.showing_on_its_workspace !== 'function' || window.showing_on_its_workspace()));
        }

        _cancelDockHide(screen) {
            if (screen.hideSource)
                GLib.source_remove(screen.hideSource);
            screen.hideSource = 0;
        }

        _dockHasFocus(screen) {
            const focus = global.stage.get_key_focus();
            return (screen.appButtons ?? []).some(button => button.windowPreview?.isOpen) ||
                Boolean(focus && screen.dockContainer?.contains(focus));
        }

        _dockSlideOffset(screen) {
            const extent = screen.position === 0
                ? screen.dockContainer.height : screen.dockContainer.width;
            const margin = screen.dockDocked ? 0 : this._settings.get_int('dock-edge-margin');
            const distance = Math.max(24, Math.ceil(extent || 0) + margin);
            if (screen.position === 1)
                return [-distance, 0];
            if (screen.position === 2)
                return [distance, 0];
            return [0, distance];
        }

        _dockSlideDuration() {
            const motion = St.Settings.get();
            const reduced = 'ReducedMotion' in St &&
                (motion.reduced_motion ?? motion.reducedMotion) === St.ReducedMotion.REDUCE;
            return motion.enable_animations && !reduced ? this._settings.get_int('dock-slide-duration') : 0;
        }

        _dockSlideMode(fallback) {
            return [fallback, Clutter.AnimationMode.LINEAR, Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                Clutter.AnimationMode.EASE_OUT_QUAD][this._settings.get_int('dock-slide-curve')] ?? fallback;
        }

        _finishDockHide(screen, token = screen.dockAnimationToken) {
            if (!screen.dockContainer || screen.dockAnimationToken !== token)
                return;
            screen.dockContainer.hide();
            screen.dockContainer.opacity = 0;
            screen.dockContainer.translation_x = 0;
            screen.dockContainer.translation_y = 0;
            screen.dockHiding = false;
            if (screen.magnificationBackground) {
                screen.magnificationBackground.hide();
                screen.magnificationBackground.opacity = 255;
                screen.magnificationBackground.translation_x = 0;
                screen.magnificationBackground.translation_y = 0;
            }
        }

        _revealDock(screen) {
            if (screen.disposed || !screen.dockContainer || screen.monitor.inFullscreen)
                return;
            this._cancelDockHide(screen);
            const dock = screen.dockContainer;
            const background = screen.magnificationBackground;
            const transparent = this._settings.get_int('dock-background-style') === 3;
            const slide = !dock.visible || screen.dockHiding || dock.opacity === 0;
            const token = (screen.dockAnimationToken ?? 0) + 1;
            screen.dockAnimationToken = token;
            screen.dockHiding = false;
            dock.remove_all_transitions();
            background?.remove_all_transitions();
            this._setDockInteraction(screen, true);
            dock.track_hover = !transparent;
            background && (background.reactive = false, background.track_hover = false);
            if (screen.dockContainer)
                screen.dockContainer.track_hover = !transparent;
            if (screen.dockViewport) {
                screen.dockViewport.reactive = false;
                screen.dockViewport.track_hover = !transparent;
            }
            dock.show();
            background?.show();
            this._positionDock();
            if (!slide) {
                dock.opacity = 255;
                this._updateDockIconGeometries(screen);
                return;
            }

            const duration = this._dockSlideDuration();
            const [offsetX, offsetY] = this._dockSlideOffset(screen);
            dock.translation_x = duration > 0 ? offsetX : 0;
            dock.translation_y = duration > 0 ? offsetY : 0;
            dock.opacity = duration > 0 ? 0 : 255;
            if (background) {
                background.translation_x = duration > 0 ? offsetX : 0;
                background.translation_y = duration > 0 ? offsetY : 0;
                background.opacity = duration > 0 ? 0 : 255;
            }
            if (duration > 0) {
                dock.ease({
                    translation_x: 0,
                    translation_y: 0,
                    opacity: 255,
                    duration,
                    mode: this._dockSlideMode(Clutter.AnimationMode.EASE_OUT_QUAD),
                    onComplete: () => {
                        if (screen.dockAnimationToken !== token || screen.disposed)
                            return;
                        if (background) {
                            background.translation_x = 0;
                            background.translation_y = 0;
                            background.opacity = 255;
                        }
                        this._updateDockIconGeometries(screen);
                    },
                });
                background?.ease({
                    translation_x: 0,
                    translation_y: 0,
                    opacity: 255,
                    duration,
                    mode: this._dockSlideMode(Clutter.AnimationMode.EASE_OUT_QUAD),
                });
            } else {
                this._updateDockIconGeometries(screen);
            }
        }

        _hideDock(screen, immediate = false) {
            for (const button of screen.appButtons ?? [])
                button.windowPreview?.close();
            this._cancelDockHide(screen);
            screen.dockPeek = false;
            const dock = screen.dockContainer;
            if (!dock)
                return;
            dock.reactive = false;
            dock.track_hover = false;
            screen.magnificationBackground && (screen.magnificationBackground.reactive = false,
                screen.magnificationBackground.track_hover = false);
            this._updateDockMagnification(screen, null, true);
            this._clearDockIconGeometry(screen);
            screen.tooltip.hide();
            const duration = immediate ? 0 : this._dockSlideDuration();
            const [offsetX, offsetY] = this._dockSlideOffset(screen);
            const token = (screen.dockAnimationToken ?? 0) + 1;
            screen.dockAnimationToken = token;
            screen.dockHiding = duration > 0 && dock.visible;
            dock.remove_all_transitions();
            screen.magnificationBackground?.remove_all_transitions();
            this._setDockInteraction(screen, false);
            if (duration === 0 || !dock.visible) {
                dock.opacity = 0;
                dock.translation_x = 0;
                dock.translation_y = 0;
                this._finishDockHide(screen, token);
                return;
            }
            dock.ease({
                translation_x: offsetX,
                translation_y: offsetY,
                opacity: 0,
                duration,
                mode: this._dockSlideMode(Clutter.AnimationMode.EASE_IN_QUAD),
                onComplete: () => this._finishDockHide(screen, token),
            });
            screen.magnificationBackground?.ease({
                translation_x: offsetX,
                translation_y: offsetY,
                opacity: 0,
                duration,
                mode: this._dockSlideMode(Clutter.AnimationMode.EASE_IN_QUAD),
            });
        }

        _queueDockHide(screen) {
            if (screen.disposed || !screen.edge || screen.hideSource)
                return;
            screen.hideSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                this._settings.get_int('dock-hide-delay'), () => {
                screen.hideSource = 0;
                const engaged = screen.reorder || screen.dockContainer.hover || screen.edge.hover ||
                    this._dockHasFocus(screen) || (screen.appButtons ?? []).some(button => button._menu?.isOpen) ||
                    (screen.shortcutMenus ?? []).some(menu => menu.isOpen);
                if (!engaged && (this._settings.get_boolean('dock-autohide') || screen.dockCovered))
                    this._hideDock(screen);
                return GLib.SOURCE_REMOVE;
            });
        }

        _setDockPosition(screen, x, y, animate) {
            const dock = screen.dockContainer;
            const [currentX, currentY] = dock.get_position();
            const motion = St.Settings.get();
            const reduced = 'ReducedMotion' in St &&
                (motion.reduced_motion ?? motion.reducedMotion) === St.ReducedMotion.REDUCE;
            const duration = this._settings.get_int('dock-maximize-slide-duration') || 240;
            if (animate && dock.visible !== false && !screen.dockHiding && motion.enable_animations && !reduced &&
                duration > 0 && (currentX !== x || currentY !== y)) {
                dock.ease({x, y, duration, mode: this._dockSlideMode(Clutter.AnimationMode.EASE_IN_OUT_QUAD)});
            } else {
                dock.set_position(x, y);
            }
        }

        _positionDock(animate = false, targetScreen = null) {
            for (const screen of this._screens) {
            if (targetScreen && targetScreen !== screen)
                continue;
            const {monitor, dock, dockContainer} = screen;
            if (!dock)
                continue;
            const padding = screen.magnificationPadding ?? 0;

            if (screen.position !== 0) {
                const panel = screen.panel ?? Main.panel;
                const [, panelHeight] = panel.get_preferred_height(monitor.width);
                const availableHeight = Math.max(1, monitor.height - panelHeight - 24);
                const [, naturalHeight] = dock.get_preferred_height(-1);
                const height = Math.min(naturalHeight, availableHeight);
                dockContainer.set_height(height);
                const [, width] = dockContainer.get_preferred_width(height);
                const margin = screen.dockDocked ? 0 : this._settings.get_int('dock-edge-margin');
                const x = screen.position === 1 ? monitor.x + margin : monitor.x + monitor.width - width - margin;
                const y = monitor.y + panelHeight + 12 + (availableHeight - height) / 2;
                this._setDockPosition(screen, Math.round(x), Math.round(y), animate);
                this._positionDockReservation(screen, width, height);
                if (screen.edge) {
                    screen.edge.set_width(10);
                    screen.edge.set_height(Math.max(1, monitor.height - panelHeight));
                    screen.edge.set_position(screen.position === 1 ? monitor.x : monitor.x + monitor.width - 10,
                        monitor.y + panelHeight);
                }
                continue;
            }

            const [, naturalWidth] = dock.get_preferred_width(-1);
            const width = Math.min(naturalWidth, Math.max(1, monitor.width - 24));
            dockContainer.set_width(width);
            const [, height] = dockContainer.get_preferred_height(width);
            const margin = screen.dockDocked ? 0 : this._settings.get_int('dock-edge-margin');
            this._setDockPosition(screen,
                Math.round(monitor.x + (monitor.width - width) / 2),
                Math.round(monitor.y + monitor.height - height - margin), animate);
            this._positionDockReservation(screen, width, height);
            if (screen.edge) {
                screen.edge.set_width(monitor.width);
                screen.edge.set_height(10);
                screen.edge.set_position(monitor.x, monitor.y + monitor.height - 10);
            }
            }
        }

        _positionDockReservation(screen, dockWidth, dockHeight) {
            const {monitor, position} = screen;
            const reservation = screen.dockReservation;
            if (!reservation)
                return;
            const margin = this._settings.get_boolean('dock-maximize-slide') ? 0 : this._settings.get_int('dock-edge-margin') +
                this._settings.get_int('dock-window-margin');

            if (position === 0) {
                const height = dockHeight + margin;
                reservation.set_width(monitor.width);
                reservation.set_height(height);
                reservation.set_position(monitor.x, monitor.y + monitor.height - height);
            } else {
                const width = dockWidth + margin;
                reservation.set_width(width);
                reservation.set_height(monitor.height);
                reservation.set_position(position === 1 ? monitor.x : monitor.x + monitor.width - width,
                    monitor.y);
            }
            this._setDockReservationRegistered(screen, !Main.overview.visible);
        }

        _setDockReservationsRegistered(registered) {
            for (const screen of this._screens ?? [])
                this._setDockReservationRegistered(screen, registered);
        }

        _setDockReservationRegistered(screen, registered) {
            const reservation = screen.dockReservation;
            if (!reservation || screen.dockReservationRegistered === registered)
                return;
            if (registered) {
                screen.lifecycle.chrome?.add(reservation, {affectsStruts: true, trackFullscreen: true});
                Main.layoutManager.uiGroup.set_child_below_sibling(reservation, screen.dockContainer);
            } else {
                screen.lifecycle.chrome?.remove(reservation);
            }
            screen.dockReservationRegistered = registered;
        }

    };
}