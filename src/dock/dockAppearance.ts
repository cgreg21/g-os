import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {DockWindowPreview} from './windowPreviews.js';
import {calculateDockMagnificationGeometry} from '../shared/geometry/magnification.js';
import {DockItem} from './dockItem.js';

const laters = global.compositor.get_laters();

export function withDockAppearance(Base) {
    return class extends Base {
        _attachTooltip(screen, button, text, {magnify = true, scroll = true} = {}) {
            if (magnify)
                this._attachMagnification(screen, button, button.icon?.icon ?? button.get_child());
            const update = (coordinates = null) => {
                if (button.windowPreview?.isOpen) {
                    screen.tooltip.hide();
                    return;
                }
                const hovered = button.hover && (!button.shouldShowTooltip || button.shouldShowTooltip());
                const focused = button.has_key_focus() && !button._menu?.isOpen && !button.shortcutMenu?.isOpen;
                if (!hovered && !focused) {
                    screen.tooltip.hide();
                    return;
                }
                const tooltipText = typeof text === 'function' ? text() : text;
                if (screen.tooltip.text !== tooltipText) {
                    screen.tooltip.text = tooltipText;
                    screen.tooltipMeasureText = null;
                }
                if (!screen.tooltipMeasureSignal) {
                    screen.tooltipMeasureSignal = screen.tooltip.connect('style-changed', () => {
                        screen.tooltipMeasureText = null;
                    });
                    screen.lifecycle.addSignal(screen.tooltip, screen.tooltipMeasureSignal);
                }
                screen.tooltip.show();
                const [buttonX, buttonY] = coordinates ?? button.get_transformed_position();
                const [buttonWidth, buttonHeight] = button.get_transformed_size();
                if (screen.tooltipMeasureText !== tooltipText) {
                    const [, width] = screen.tooltip.get_preferred_width(-1);
                    const [, height] = screen.tooltip.get_preferred_height(width);
                    screen.tooltipMeasureText = tooltipText;
                    screen.tooltipMeasureWidth = width;
                    screen.tooltipMeasureHeight = height;
                }
                const width = screen.tooltipMeasureWidth;
                const height = screen.tooltipMeasureHeight;
                const {monitor} = screen;
                let x = buttonX + (buttonWidth - width) / 2;
                let y = buttonY - height - 8;
                if (screen.position === 1) {
                    x = buttonX + buttonWidth + 8;
                    y = buttonY + (buttonHeight - height) / 2;
                } else if (screen.position === 2) {
                    x = buttonX - width - 8;
                    y = buttonY + (buttonHeight - height) / 2;
                }
                screen.tooltip.set_position(
                    Math.round(Math.max(monitor.x, Math.min(x, monitor.x + monitor.width - width))),
                    Math.round(Math.max(monitor.y, Math.min(y, monitor.y + monitor.height - height))));
            };
            DockItem.for(button, screen).setTooltip(update);
            button.connect('notify::hover', () => update());
            button.connect('key-focus-in', () => update(scroll ? this._scrollDockButtonIntoView(screen, button) : null));
            button.connect('key-focus-out', () => update());
            button.connect('clicked', () => screen.tooltip.hide());
            if (button.app && this._settings.get_boolean('dock-window-previews')) {
                button.windowPreview = new DockWindowPreview(button, screen, {
                    GLib, St, Clutter, PopupMenu, Pango,
                    uiGroup: Main.uiGroup,
                    getWindows: () => this._windowsForDock(button.app, screen),
                    getDelay: () => this._settings.get_int('dock-window-preview-delay'),
                    allowed: () => !screen.disposed && !screen.monitor.inFullscreen && !screen.reorder &&
                        screen.dockContainer.visible !== false && !Main.overview.visible && Main.sessionMode?.currentMode !== 'unlock-dialog' &&
                        !button._menu?.isOpen && !(screen.shortcutMenus ?? []).some(menu => menu.isOpen),
                    activate: window => Main.activateWindow(window), timestamp: () => global.get_current_time(),
                    onOpen: () => {
                        for (const other of this._screens) {
                            for (const candidate of other.appButtons ?? []) {
                                if (candidate !== button)
                                    candidate.windowPreview?.close();
                            }
                        }
                        screen.tooltip.hide();
                        this._revealDock(screen);
                    },
                    onClose: () => { if (!screen.disposed) this._queueDockHide(screen); },
                });
                const overviewSignal = Main.overview.connect('showing', () => button.windowPreview.close());
                button.connect('destroy', () => Main.overview.disconnect(overviewSignal));
            }
        }

        _scrollDockButtonIntoView(screen, button) {
            const horizontal = screen.position === 0;
            const adjustment = horizontal ? screen.dockContainer.hadjustment : screen.dockContainer.vadjustment;
            if (!adjustment || adjustment.page_size <= 0)
                return null;
            const [buttonX, buttonY] = button.get_transformed_position();
            const [viewX, viewY] = screen.dockContainer.get_transformed_position();
            const [width, height] = button.get_transformed_size();
            const begin = horizontal ? buttonX - viewX : buttonY - viewY;
            const extent = horizontal ? width : height;
            const delta = begin < 0 || extent > adjustment.page_size
                ? begin : Math.max(0, begin + extent - adjustment.page_size);
            const previous = adjustment.value;
            adjustment.value = Math.max(adjustment.lower,
                Math.min(adjustment.upper - adjustment.page_size, previous + delta));
            const shift = adjustment.value - previous;
            return horizontal ? [buttonX - shift, buttonY] : [buttonX, buttonY - shift];
        }

        _attachMagnification(screen, button, icon) {
            const animation = this._settings.get_int('dock-hover-animation');
            if (animation === 0 || animation === 4)
                return;
            const motion = St.Settings.get();
            icon.set_pivot_point(0.5, 0.5);
            const update = (soft = false) => {
                // Hover notifications can fire while the Dock is temporarily reparented.
                // Never ask St to animate an icon until its button is back on the stage.
                if (!button.get_stage())
                    return;
                const animation = this._settings.get_int('dock-hover-animation');
                const hoverDuration = this._settings.get_int('dock-hover-duration');
                const strength = this._settings.get_int('dock-hover-strength') / 100;
                const reduced = 'ReducedMotion' in St &&
                    (motion.reduced_motion ?? motion.reducedMotion) === St.ReducedMotion.REDUCE;
                const animated = motion.enable_animations && !reduced;
                if (button.dockLaunchAnimating)
                    return;
                const engaged = animated && (button.hover || button.has_key_focus());
                const state = `${animation}:${animated}:${engaged}:${hoverDuration}:${strength}`;
                if (button._dockHoverState === state && !soft)
                    return;
                button._dockHoverState = state;
                let scale = 1;
                let translationY = 0;
                let duration = animated ? hoverDuration : 0;
                let mode = engaged ? Clutter.AnimationMode.EASE_OUT_QUAD : Clutter.AnimationMode.EASE_IN_OUT_QUAD;
                if (engaged) {
                    if (animation === 1) {
                        scale = 1 + 0.18 * strength;
                    } else if (animation === 2) {
                        scale = 1 + 0.08 * strength;
                        translationY = -8 * strength;
                        duration = Math.round(hoverDuration * 150 / 180);
                    } else if (animation === 3) {
                        scale = 1 + 0.12 * strength;
                        translationY = -4 * strength;
                        if (!soft) {
                            duration = hoverDuration * 2;
                            mode = Clutter.AnimationMode.EASE_OUT_BOUNCE;
                        }
                    }
                }
                icon.ease({
                    scale_x: scale,
                    scale_y: scale,
                    translation_y: translationY,
                    duration,
                    mode,
                });
            };
            button._dockHoverAnimationUpdate = update;
            screen.hoverAnimationUpdates.add(update);
            button.connect('notify::hover', () => update());
            button.connect('key-focus-in', () => update());
            button.connect('key-focus-out', () => update());
            const id = motion.connect('notify', update as any);
            button.connect('destroy', () => {
                motion.disconnect(id);
                icon.remove_all_transitions();
            });
        }

        _setDockInteraction(screen, enabled) {
            const transparent = this._settings.get_int('dock-background-style') === 3;
            const magnifying = this._settings.get_int('dock-hover-animation') === 4;
            const isDockButton = actor => {
                if (!actor)
                    return false;
                if (actor instanceof St.Button)
                    return true;
                if (actor.dockFocusKey || actor.dockWidgetType)
                    return true;
                if (typeof actor.has_style_class_name === 'function' && actor.has_style_class_name('g-os-dock-item'))
                    return true;
                return false;
            };
            const isDockShellActor = actor => actor === screen.dockContainer || actor === screen.dockViewport || actor === screen.dock;
            const actors = [screen.dockContainer, screen.dockViewport, screen.dock, screen.magnificationBackground];
            for (const actor of actors) {
                if (!actor)
                    continue;
                const interactive = actor === screen.magnificationBackground ? false :
                    actor === screen.dockContainer ? enabled && !magnifying :
                    isDockShellActor(actor) ? false : enabled || isDockButton(actor);
                if ('reactive' in actor)
                    actor.reactive = interactive;
                if ('track_hover' in actor)
                    actor.track_hover = interactive || (isDockShellActor(actor) && (enabled && !transparent));
            }
            if (screen.magnificationBackground) {
                screen.magnificationBackground.reactive = false;
                screen.magnificationBackground.track_hover = false;
            }
            const visit = actor => {
                if (!actor || typeof actor.get_children !== 'function')
                    return;
                for (const child of actor.get_children()) {
                    const interactive = child === screen.magnificationBackground ? false :
                        isDockShellActor(child) ? false : transparent ? isDockButton(child) : enabled || isDockButton(child);
                    if ('reactive' in child)
                        child.reactive = interactive;
                    if ('track_hover' in child)
                        child.track_hover = interactive || (isDockShellActor(child) && (enabled && !transparent));
                    visit(child);
                }
            };
            visit(screen.dockViewport ?? screen.dock);
            visit(screen.dockContainer);
        }

        _configureDockBackground(screen) {
            screen.dock.add_style_class_name('dash-background');
            screen.magnificationBackground = new St.Widget({
                style_class: 'dash-background',
                reactive: false,
                visible: screen.dockContainer.visible !== false,
            });
            screen.lifecycle.chrome?.add(screen.magnificationBackground, {trackFullscreen: true});
            Main.uiGroup.set_child_below_sibling(screen.magnificationBackground, screen.dockContainer);
            this._syncDockAppearance(screen);
            const update = () => {
                if (screen.disposed || screen.magnificationBackgroundSource)
                    return;
                screen.magnificationBackgroundSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._updateMagnificationBackground(screen);
                    screen.magnificationBackgroundSource = 0;
                    return GLib.SOURCE_REMOVE;
                });
            };
            screen.lifecycle.addSignal(screen.dockContainer,
                screen.dockContainer.connect('notify::allocation', update));
            screen.lifecycle.addSignal(screen.dock,
                screen.dock.connect('notify::allocation', update));
            screen.lifecycle.add(() => {
                if (screen.magnificationBackgroundSource)
                    GLib.source_remove(screen.magnificationBackgroundSource);
                screen.magnificationBackgroundSource = 0;
            });
        }

        _syncDockAppearance(screen) {
            if (!screen.dock || !screen.magnificationBackground)
                return;
            const radiusClass = `g-os-dock-radius-${this._settings.get_int('dock-border-radius')}`;
            const backgroundClasses = ['', 'g-os-dock-background-subtle', 'g-os-dock-background-opaque',
                'g-os-dock-background-transparent'];
            const backgroundClass = backgroundClasses[this._settings.get_int('dock-background-style')] ?? '';
            for (const actor of [screen.dock, screen.magnificationBackground]) {
                if (screen.dockRadiusClass)
                    actor.remove_style_class_name(screen.dockRadiusClass);
                actor.add_style_class_name(radiusClass);
                if (screen.dockBackgroundStyleClass)
                    actor.remove_style_class_name(screen.dockBackgroundStyleClass);
                if (backgroundClass)
                    actor.add_style_class_name(backgroundClass);
            }
            screen.dockRadiusClass = radiusClass;
            screen.dockBackgroundStyleClass = backgroundClass;
            screen.magnificationBackground[ this._settings.get_boolean('dock-show-border')
                ? 'remove_style_class_name' : 'add_style_class_name']('g-os-dock-no-border');
            screen.magnificationBackground[ this._settings.get_boolean('dock-show-shadow')
                ? 'remove_style_class_name' : 'add_style_class_name']('g-os-dock-no-shadow');
            this._setDockInteraction(screen, screen.dockContainer.visible !== false &&
                screen.dockContainer.opacity > 0);
        }

        _applyDockMetrics(screen) {
            if (!screen.dock || !screen.dockContainer)
                return;
            const magnified = this._settings.get_int('dock-hover-animation') === 4;
            const size = this._settings.get_int('icon-size');
            const axisPadding = Math.ceil(size * 0.8) * 3;
            const buttonSize = size + this._settings.get_int('dock-icon-padding') * 2;
            const maximumScale = this._settings.get_int('dock-magnify-max') / 100;
            const padding = Math.ceil(buttonSize * Math.max(0.8, maximumScale - 1));
            screen.magnificationPadding = magnified ? padding : 0;
            screen.magnificationAxisPadding = magnified ? axisPadding : 0;
            const horizontalPadding = this._settings.get_int('dock-padding-horizontal');
            const top = this._settings.get_int('dock-padding-top') + (magnified ? screen.position === 0 ? padding : axisPadding : 0);
            const bottom = this._settings.get_int('dock-padding-bottom') + (magnified && screen.position !== 0 ? axisPadding : 0);
            const left = horizontalPadding + (magnified ? screen.position === 0 ? axisPadding : screen.position === 2 ? padding : 0 : 0);
            const right = horizontalPadding + (magnified ? screen.position === 0 ? axisPadding : screen.position === 1 ? padding : 0 : 0);
            screen.dockContainer.set_style(magnified ? 'padding: 0;' : '');
            screen.dock.set_style(`padding: ${top}px ${right}px ${bottom}px ${left}px; spacing: ${this._settings.get_int('dock-item-spacing')}px;`);
            if (magnified)
                screen.dock.clip_to_allocation = false;
            screen.dockContainer.clip_to_allocation = true;
        }

        _configureDockMagnification(screen) {
            this._applyDockMetrics(screen);
            if (this._settings.get_int('dock-hover-animation') !== 4)
                return;
            if (!screen.magnificationConnected) {
                screen.magnificationConnected = true;
                screen.lifecycle.addSignal(screen.dockContainer,
                    screen.dockContainer.connect('motion-event', (actor, event) => {
                    const following = screen.magnificationPoint !== null;
                    screen.magnificationPoint = event.get_coords();
                    this._queueDockMagnification(screen, screen.magnificationPoint, false, following);
                    return Clutter.EVENT_PROPAGATE;
                }));
                // Reset only when the pointer actually leaves the dock actor.
                // Hover notifications can flicker while crossing child actors.
                screen.lifecycle.addSignal(screen.dockContainer,
                    screen.dockContainer.connect('leave-event', () => {
                    screen.magnificationPoint = null;
                    this._queueDockMagnification(screen, null, true);
                    return Clutter.EVENT_PROPAGATE;
                }));
                const motion = St.Settings.get();
                const signal = motion.connect('notify', () => this._queueDockMagnification(screen));
                screen.lifecycle.addSignal(motion, signal);
                screen.lifecycle.add(() => {
                    if (screen.magnificationUpdateSource)
                        laters.remove(screen.magnificationUpdateSource);
                    screen.magnificationUpdateSource = 0;
                });
            }
            for (const button of screen.dock.get_children().filter(candidate => candidate.dockFocusKey)) {
                const icon = button.icon?.icon ?? button.get_child();
                if (button.dockFocusKey !== 'shortcut:applications')
                    this._prepareMagnificationIcon(icon);
                icon.set_pivot_point(screen.position === 0 ? 0.5 : screen.position === 1 ? 0 : 1,
                    screen.position === 0 ? 1 : 0.5);
                button.set_pivot_point(screen.position === 0 ? 0.5 : screen.position === 1 ? 0 : 1,
                    screen.position === 0 ? 1 : 0.5);
                button.connect('notify::hover', () => {
                    this._queueDockMagnification(screen, screen.magnificationPoint, false,
                        screen.magnificationPoint !== null);
                });
                for (const signal of ['key-focus-in', 'key-focus-out']) {
                    button.connect(signal, () => {
                        screen.magnificationPoint = null;
                        this._queueDockMagnification(screen);
                    });
                }
            }
            screen.magnificationPoint = null;
            this._queueDockMagnification(screen);
        }

        _prepareMagnificationIcon(actor) {
            if (actor instanceof St.Icon && actor.icon_size > 0) {
                const icon = actor as St.Icon & {
                    _dockMagnificationBaseSize?: number;
                    _dockMagnificationAppliedSize?: number;
                };
                if (icon.icon_size !== icon._dockMagnificationAppliedSize)
                    icon._dockMagnificationBaseSize = icon.icon_size;
                const size = icon._dockMagnificationBaseSize ?? icon.icon_size;
                icon._dockMagnificationAppliedSize = Math.ceil(size * 1.8);
                icon.icon_size = icon._dockMagnificationAppliedSize;
                icon.set_size(size, size);
            } else {
                for (const child of actor.get_children())
                    this._prepareMagnificationIcon(child);
            }
        }

        _queueDockMagnification(screen, point = screen.magnificationPoint, reset = false, following = false) {
            if (reset)
                screen.magnificationPoint = null;
            else if (point !== undefined)
                screen.magnificationPoint = point;
            screen.magnificationUpdateReset = (screen.magnificationUpdateReset ?? false) || reset;
            screen.magnificationFollowing = following;
            if (screen.magnificationUpdateSource)
                return;
            screen.magnificationUpdateSource = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
                screen.magnificationUpdateSource = 0;
                const resetPending = screen.magnificationUpdateReset ?? false;
                screen.magnificationUpdateReset = false;
                this._updateDockMagnification(screen, screen.magnificationPoint, resetPending,
                    screen.magnificationFollowing ?? false);
                return GLib.SOURCE_REMOVE;
            });
        }

        _updateDockMagnification(screen, point = screen.magnificationPoint, reset = false, following = false) {
            if (!screen.magnificationConnected || screen.disposed)
                return;
            if (reset)
                screen.magnificationPoint = null;
            const buttons = screen.dock.get_children().filter(button => button.dockFocusKey);
            if (buttons.length === 0)
                return;
            const axis = screen.position === 0 ? 0 : 1;
            const centers = buttons.map(button => {
                const position = button.get_transformed_position();
                const size = button.get_transformed_size();
                const shift = axis === 0 ? button.translation_x ?? 0 : button.translation_y ?? 0;
                const center = position[axis] - shift + size[axis] / 2;
                return Number.isFinite(center) ? center : null;
            });
            if (centers.some(center => center === null))
                return;
            const background = screen.magnificationBackground;
            const [backgroundX, backgroundY] = background?.get_transformed_position() ?? [0, 0];
            const [backgroundWidth, backgroundHeight] = background?.get_transformed_size() ?? [0, 0];
            const hoveredButton = buttons.find(button => button.hover);
            // Keep the pointer coordinate active over the entire dock,
            // not only over the background actor. Restricting magnification
            // to the background makes the effect drop out while crossing an
            // icon, then re-engage in the gap between two icons.
            // The motion event belongs to the dock container; trust its
            // stage coordinates instead of the hover flag, which can flicker
            // when crossing between child icon actors.
            let coordinate = point && screen.dockContainer.visible !== false
                ? point[axis]
                : !screen.dockContainer.hover && hoveredButton
                ? centers[buttons.indexOf(hoveredButton)] : null;
            const motion = St.Settings.get();
            const reduced = 'ReducedMotion' in St &&
                (motion.reduced_motion ?? motion.reducedMotion) === St.ReducedMotion.REDUCE;
            const animated = motion.enable_animations && !reduced && !reset;
            const engaged = animated && coordinate !== null && !screen.reorder && screen.dockContainer.visible !== false &&
                !screen.monitor.inFullscreen && !(screen.shortcutMenus ?? []).some(menu => menu.isOpen) &&
                !(screen.appButtons ?? []).some(button => button._menu?.isOpen);
            const engagementChanged = (screen.magnificationEngaged ?? false) !== engaged;
            screen.magnificationEngaged = engaged;
            const size = this._settings.get_int('icon-size');
            const maximumScale = Math.max(1, this._settings.get_int('dock-magnify-max') / 100);
            const radius = Math.max(1, this._settings.get_int('dock-magnify-icons'));
            const [viewX, viewY] = screen.dockContainer.get_transformed_position();
            const [viewWidth, viewHeight] = screen.dockContainer.get_transformed_size();
            const viewStart = axis === 0 ? viewX : viewY;
            const viewEnd = viewStart + (axis === 0 ? viewWidth : viewHeight);
            const geometry = calculateDockMagnificationGeometry({
                centers: centers as number[],
                buttonSizes: buttons.map(button => axis === 0 ? button.width : button.height),
                excluded: buttons.map(button => Boolean(button.dockWidgetType)),
                coordinate,
                maximumScale,
                radius,
                engaged,
                viewStart,
                viewEnd,
            });
            if (!geometry)
                return;
            const {scales, shifts} = geometry;
            screen.magnificationGrowth = geometry.growth;
            screen.magnificationStart = geometry.start;
            const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
            // Retarget from the currently rendered value on every pointer
            // update. A short ease keeps motion continuous without adding the
            // lag introduced by filtering pointer coordinates.
            const duration = animated
                ? following ? 90 : Math.max(70, Math.min(110, Math.round(
                    this._settings.get_int('dock-hover-duration') * 0.9)))
                : 0;
            this._updateMagnificationBackground(screen, duration);
            buttons.forEach((button, index) => {
                const shift = shifts[index];
                const icon = button.icon?.icon ?? button.get_child();
                const targetChanged = button.magnificationShift === undefined ||
                    Math.abs(button.magnificationScale - scales[index]) > 0.0001 ||
                    Math.abs(button.magnificationShift - shift) > 0.01 ||
                    (!button.get_transition('scale-x') &&
                        (Math.abs(button.scale_x - scales[index]) > 0.0001 ||
                            Math.abs(button.scale_y - scales[index]) > 0.0001));
                button.magnificationScale = scales[index];
                button.magnificationShift = shift;
                if (!button.dockLaunchAnimating)
                    icon.ease({scale_x: 1, scale_y: 1,
                        duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                if (targetChanged || engagementChanged || reset || !animated) {
                    const scale = clamp(scales[index], 1, maximumScale);
                    const translationX = axis === 0 ? clamp(shift, -Math.max(32, size * 4), Math.max(32, size * 4)) : 0;
                    const translationY = axis === 1 ? clamp(shift, -Math.max(32, size * 4), Math.max(32, size * 4)) : 0;
                    button.ease({scale_x: scale, scale_y: scale,
                        translation_x: translationX, translation_y: translationY,
                        duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                }
                if (button.hover || button.has_key_focus())
                    button.updateDockTooltip?.();
            });
        }

        _updateMagnificationBackground(screen, duration = 0) {
            const background = screen.magnificationBackground;
            if (!background || screen.disposed)
                return;
            const [x, y] = screen.dockContainer.get_transformed_position();
            const [width, height] = screen.dockContainer.get_transformed_size();
            const padding = screen.magnificationPadding ?? 0;
            const axisPadding = screen.magnificationAxisPadding ?? 0;
            const growth = screen.magnificationGrowth ?? 0;
            const start = screen.magnificationStart ?? 0;
            const horizontal = screen.position === 0;
            if (![x, y, width, height, padding, axisPadding, growth, start].every(Number.isFinite))
                return;
            const baseWidth = Math.max(0, width - (horizontal ? axisPadding * 2 : padding));
            const baseHeight = Math.max(0, height - (horizontal ? padding : axisPadding * 2));
            if (baseWidth <= 0 || baseHeight <= 0)
                return;
            const geometry = {
                x: x + (horizontal ? axisPadding + start : screen.position === 2 ? padding : 0),
                y: y + (horizontal ? padding : axisPadding + start),
                width: Math.max(0, baseWidth + (horizontal ? growth : 0)),
                height: Math.max(0, baseHeight + (horizontal ? 0 : growth)),
            };
            if ([...Object.values(geometry)].some(value => !Number.isFinite(value)))
                return;
            if (screen.magnificationBackgroundGeometry && Object.entries(geometry).every(
                ([key, value]) => screen.magnificationBackgroundGeometry[key] === value))
                return;
            screen.magnificationBackgroundGeometry = geometry;
            screen.lifecycle.animations.animate('dock-magnification-background', background, geometry, {
                durationMs: duration,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        _animateDockLaunch(button, screen) {
            if (!this._settings.get_boolean('dock-launch-animation'))
                return;
            const icon = button.icon?.icon ?? button.get_child();
            const motion = St.Settings.get();
            const reduced = 'ReducedMotion' in St &&
                (motion.reduced_motion ?? motion.reducedMotion) === St.ReducedMotion.REDUCE;
            if (!motion.enable_animations || reduced) {
                button.dockLaunchAnimating = false;
                icon.ease({
                    scale_x: 1,
                    scale_y: 1,
                    translation_y: 0,
                    duration: 0,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                button._dockHoverAnimationUpdate?.(true);
                if (screen)
                    this._updateDockMagnification(screen);
                return;
            }
            if (button.dockLaunchAnimating)
                return;
            button.dockLaunchAnimating = true;
            icon.remove_all_transitions();
            const duration = this._settings.get_int('dock-launch-duration');
            const liftDuration = Math.round(duration * 100 / 520);
            const strength = this._settings.get_int('dock-launch-strength') / 100;
            icon.ease({
                scale_x: 0.82 + 0.18 * (1 - strength),
                scale_y: 0.72 + 0.28 * (1 - strength),
                translation_y: -12 * strength,
                duration: liftDuration,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (button.destroyed)
                        return;
                    icon.ease({
                        scale_x: 1,
                        scale_y: 1,
                        translation_y: 0,
                        duration: duration - liftDuration,
                        mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
                        onComplete: () => {
                            button.dockLaunchAnimating = false;
                            button._dockHoverAnimationUpdate?.(true);
                            if (screen)
                                this._updateDockMagnification(screen);
                        },
                    });
                },
            });
        }

    };
}
