import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

type DesktopMonitor = (typeof Main.layoutManager.monitors)[number] & {connector?: string};
type DesktopBackgroundManager = {
    backgroundActor?: St.Widget & {_backgroundMenu?: PopupMenu.PopupMenu};
    connect(signal: 'changed', callback: () => void): number;
};
type DesktopWidgetActor = St.BoxLayout & {
    mediaView?: St.Widget;
    dragHandle?: Clutter.Actor;
    timeLabel?: St.Label;
    dateLabel?: St.Label;
    monthLabel?: St.Label;
    dayLabel?: St.Label;
    weekdayLabel?: St.Label;
};

const desktopBackgroundManagers = () =>
    (Main.layoutManager as typeof Main.layoutManager & {_bgManagers?: DesktopBackgroundManager[]})._bgManagers ?? [];

export function withDesktopWidgets(Base) {
    return class extends Base {
        _openWidgetManager(target, monitor = null) {
            this._settings.set_string('widget-manager-request', JSON.stringify({target, monitor}));
            this.openPreferences();
        }

        _setupDesktopWidgetMenu() {
            this._nativeDesktopWidgetItems = new Map();
            this._nativeDesktopWidgetManagers = new Map();
            if (this._refreshDesktopWidgetMenus())
                return;
            const background = Main.layoutManager._backgroundGroup;
            if (!background)
                return;
            this._desktopWidgetBackground = background;
            this._desktopWidgetBackgroundReactive = background.reactive;
            background.reactive = true;
            this._desktopWidgetGesture = new Clutter.ClickGesture({required_button: Clutter.BUTTON_SECONDARY,
                recognize_on_press: true});
            this._desktopWidgetGesture.connect('recognize', () => {
                const [x, y] = global.get_pointer();
                if (!this._desktopWidgetMenu) {
                    this._desktopWidgetAnchor = new St.Widget({width: 1, height: 1, opacity: 0});
                    Main.layoutManager.addTopChrome(this._desktopWidgetAnchor);
                    this._desktopWidgetMenu = new PopupMenu.PopupMenu(this._desktopWidgetAnchor, 0.5, St.Side.TOP);
                    this._desktopWidgetMenu.actor.add_style_class_name('g-os-popup');
                    this._desktopWidgetMenu.addAction('Configuration des widgets du bureau', () => {
                        const [pointerX, pointerY] = global.get_pointer();
                        const monitor = Main.layoutManager.monitors.find(value => pointerX >= value.x && pointerX < value.x + value.width &&
                            pointerY >= value.y && pointerY < value.y + value.height);
                        this._openWidgetManager('desktop', (monitor as DesktopMonitor | undefined)?.connector ||
                            (monitor ? `monitor-${monitor.index}` : null));
                    });
                    Main.uiGroup.add_child(this._desktopWidgetMenu.actor);
                    Main.panel.menuManager.addMenu(this._desktopWidgetMenu);
                }
                this._desktopWidgetAnchor.set_position(x, y);
                this._desktopWidgetMenu.open();
            });
            background.add_action(this._desktopWidgetGesture);
        }

        _destroyDesktopWidgetMenu() {
            for (const item of this._nativeDesktopWidgetItems?.values() ?? [])
                item.destroy();
            this._nativeDesktopWidgetItems?.clear();
            for (const [manager, id] of this._nativeDesktopWidgetManagers ?? []) {
                try { manager.disconnect(id); } catch {}
            }
            this._nativeDesktopWidgetManagers?.clear();
            this._destroyDesktopWidgetFallback();
        }

        _destroyDesktopWidgetFallback() {
            if (this._desktopWidgetGesture) {
                this._desktopWidgetBackground?.remove_action(this._desktopWidgetGesture);
                this._desktopWidgetBackground.reactive = this._desktopWidgetBackgroundReactive;
            }
            if (this._desktopWidgetMenu) {
                Main.panel.menuManager.removeMenu(this._desktopWidgetMenu);
                this._desktopWidgetMenu.destroy();
            }
            this._desktopWidgetAnchor?.destroy();
            this._desktopWidgetMenu = null;
            this._desktopWidgetGesture = null;
            this._desktopWidgetAnchor = null;
        }

        _refreshDesktopWidgetMenus() {
            if (!this._nativeDesktopWidgetItems)
                return false;
            const managers = desktopBackgroundManagers();
            let attached = false;
            for (const [index, manager] of managers.entries()) {
                const attach = () => {
                    const menu = manager.backgroundActor?._backgroundMenu;
                    if (!menu)
                        return;
                    attached = true;
                    if (this._nativeDesktopWidgetItems.has(menu))
                        return;
                    const item = menu.addAction('Configuration des widgets du bureau', () => {
                        const monitor = Main.layoutManager.monitors[index];
                        this._openWidgetManager('desktop', (monitor as DesktopMonitor | undefined)?.connector || `monitor-${index}`);
                    });
                    this._nativeDesktopWidgetItems.set(menu, item);
                    item.connect('destroy', () => this._nativeDesktopWidgetItems.delete(menu));
                };
                attach();
                if (!this._nativeDesktopWidgetManagers.has(manager))
                    this._nativeDesktopWidgetManagers.set(manager, manager.connect('changed', attach));
            }
            if (attached && this._desktopWidgetGesture)
                this._destroyDesktopWidgetFallback();
            return attached;
        }

            _syncDesktopWidgets() {
                if (!this._desktopWidgets || !this._settings)
                    return;
                this._syncMediaPlayers();
                if (this._widgetRuntime) {
                    this._widgetRuntime.syncDesktop();
                    return;
                }
                this._destroyDesktopWidgets();
                const parent = Main.layoutManager._backgroundGroup;
                if (!parent)
                    return;
                for (const monitor of Main.layoutManager.monitors) {
                    if (this._settings.get_boolean('desktop-widget-clock'))
                        this._createDesktopWidget('clock', monitor, parent);
                    if (this._settings.get_boolean('desktop-widget-calendar'))
                        this._createDesktopWidget('calendar', monitor, parent);
                    if (this._settings.get_boolean('desktop-widget-media'))
                        this._createDesktopWidget('media', monitor, parent);
                }
            }

            _destroyDesktopWidgets() {
                if (!this._desktopWidgets)
                    return;
                const parent = Main.layoutManager._backgroundGroup;
                for (const widget of this._desktopWidgets.values()) {
                    parent?.remove_child(widget);
                    widget.destroy();
                }
                this._desktopWidgets.clear();
            }

            _createDesktopWidget(type, monitor, parent) {
                const widget = new St.BoxLayout({
                    style_class: `g-os-desktop-widget g-os-desktop-widget-${type}`,
                    orientation: Clutter.Orientation.VERTICAL,
                    reactive: true,
                    track_hover: true,
                }) as DesktopWidgetActor;
                widget.set_width(this._settings.get_int('desktop-widget-width'));

                if (type === 'media') {
                    const view = this._createMediaView({monitor});
                    widget.mediaView = view;
                    widget.dragHandle = view.dragHandle;
                    widget.add_child(view);
                } else if (type === 'clock') {
                    widget.timeLabel = new St.Label({
                        style_class: 'g-os-desktop-widget-time',
                        text: this._wallClock.clock,
                    });
                    widget.dateLabel = new St.Label({style_class: 'g-os-desktop-widget-date'});
                    widget.add_child(widget.timeLabel);
                    widget.add_child(widget.dateLabel);
                } else {
                    widget.monthLabel = new St.Label({style_class: 'g-os-desktop-widget-month'});
                    widget.dayLabel = new St.Label({style_class: 'g-os-desktop-widget-day'});
                    widget.weekdayLabel = new St.Label({style_class: 'g-os-desktop-widget-weekday'});
                    widget.add_child(widget.monthLabel);
                    widget.add_child(widget.dayLabel);
                    widget.add_child(widget.weekdayLabel);
                }

                const xKey = `desktop-widget-${type}-x`;
                const yKey = `desktop-widget-${type}-y`;
                widget.set_position(monitor.x + this._settings.get_int(xKey),
                    monitor.y + this._settings.get_int(yKey));
                this._attachDesktopWidgetDrag(widget, monitor, xKey, yKey);
                parent.add_child(widget);
                this._desktopWidgets.set(`${type}:${monitor.index}`, widget);
                this._updateDesktopWidget(widget, type);
            }

            _attachDesktopWidgetDrag(widget, monitor, xKey, yKey) {
                let origin = null;
                let pointerOrigin = null;
                let destination = null;
                this._makeDraggable(widget.dragHandle ?? widget, () => {
                    origin = widget.get_position();
                    const [pointerX, pointerY] = global.get_pointer();
                    pointerOrigin = [pointerX, pointerY];
                    destination = origin;
                }, event => {
                    if (!origin)
                        return;
                    const [, preferredWidth] = widget.get_preferred_width(-1);
                    const [, preferredHeight] = widget.get_preferred_height(preferredWidth);
                    const width = widget.width || preferredWidth;
                    const height = widget.height || preferredHeight;
                    const x = Math.max(monitor.x, Math.min(origin[0] + event.x - pointerOrigin[0],
                        monitor.x + monitor.width - width));
                    const y = Math.max(monitor.y, Math.min(origin[1] + event.y - pointerOrigin[1],
                        monitor.y + monitor.height - height));
                    widget.set_position(Math.round(x), Math.round(y));
                    destination = [Math.round(x), Math.round(y)];
                }, () => {
                    if (!origin)
                        return;
                    const [x, y] = destination;
                    origin = null;
                    pointerOrigin = null;
                    this._settings.set_int(xKey, Math.max(0, Math.round(x - monitor.x)));
                    this._settings.set_int(yKey, Math.max(0, Math.round(y - monitor.y)));
                });
            }

            _makeDraggable(actor, onBegin, onMotion, onEnd) {
                const draggable = DND.makeDraggable(actor, {});
                let monitor = null;
                let cancelled = false;
                const removeMonitor = () => {
                    if (!monitor)
                        return;
                    DND.removeDragMonitor(monitor);
                    monitor = null;
                };
                draggable.connect('drag-begin', () => {
                    cancelled = false;
                    onBegin();
                    monitor = {
                        dragMotion: event => {
                            onMotion(event);
                            return DND.DragMotionResult.CONTINUE;
                        },
                    };
                    DND.addDragMonitor(monitor);
                });
                draggable.connect('drag-cancelled', () => { cancelled = true; });
                draggable.connect('drag-end', () => {
                    removeMonitor();
                    onEnd(cancelled);
                });
                actor.connect('destroy', () => {
                    if (monitor) {
                        removeMonitor();
                        onEnd(true);
                    }
                });
                return draggable;
            }

            _updateDesktopWidgets() {
                if (this._widgetRuntime) {
                    this._widgetRuntime.updateDesktop();
                    return;
                }
                for (const [key, widget] of this._desktopWidgets ?? [])
                    this._updateDesktopWidget(widget, key.split(':')[0]);
            }

            _updateDesktopWidget(widget, type) {
                if (type === 'media')
                    return;
                const date = GLib.DateTime.new_now_local();
                if (type === 'clock') {
                    widget.timeLabel.text = this._wallClock.clock;
                    widget.dateLabel.text = date.format('%A, %d %B');
                } else {
                    widget.monthLabel.text = date.format('%B %Y');
                    widget.dayLabel.text = date.format('%d');
                    widget.weekdayLabel.text = date.format('%A');
                }
            }

    };
}
