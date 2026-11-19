import {setChildWhenMapped} from '../core/actorUtils.js';
import {CleanupManager} from '../core/cleanupManager.js';

export class DockWindowPreview {
    [key: string]: any;
    constructor(button, screen, {GLib, St, Clutter, PopupMenu, Pango, uiGroup,
        getWindows, getDelay, allowed, activate, timestamp, onOpen, onClose}) {
        Object.assign(this, {button, screen, GLib, St, Clutter, PopupMenu, Pango, uiGroup,
            getWindows, getDelay, allowed, activate, timestamp, onOpen, onClose});
        this.showSource = 0;
        this.hideSource = 0;
        this.menu = null;
        this.rows = [];
        this.windowCleanup = new CleanupManager();
        this.ignoredWindows = new WeakSet();
        this.disposed = false;
        button.connect('notify::hover', () => this.updateHover());
        button.connect('clicked', () => this.close());
        button.connect('menu-state-changed', (_button, open) => { if (open) this.close(); });
        button.connect('destroy', () => this.destroy());
    }

    get isOpen() { return Boolean(this.menu?.isOpen); }

    _pointerInside() {
        return this.menu?.actor.hover || this.rows.some(row => row.preview.hover || row.close.hover);
    }

    _cancelSource(name) {
        if (this[name])
            this.GLib.source_remove(this[name]);
        this[name] = 0;
    }

    updateHover() {
        this._cancelSource('showSource');
        if (this.disposed)
            return;
        if (!this.button.hover) {
            this._queueClose();
            return;
        }
        this._cancelSource('hideSource');
        if (!this.allowed()) {
            this.close();
            return;
        }
        if (this.isOpen)
            return;
        this.showSource = this.GLib.timeout_add(this.GLib.PRIORITY_DEFAULT, this.getDelay(), () => {
            this.showSource = 0;
            if (!this.disposed && this.button.hover && this.allowed())
                this.show();
            return this.GLib.SOURCE_REMOVE;
        });
    }

    _queueClose() {
        this._cancelSource('hideSource');
        if (!this.isOpen || this._pointerInside())
            return;
        this.hideSource = this.GLib.timeout_add(this.GLib.PRIORITY_DEFAULT, 200, () => {
            this.hideSource = 0;
            if (!this.button.hover && !this._pointerInside())
                this.close();
            return this.GLib.SOURCE_REMOVE;
        });
    }

    _ensureMenu() {
        if (this.menu)
            return;
        this.menu = new this.PopupMenu.PopupMenu(this.button, 0.5, this.screen.popupSide);
        this.menu.actor.add_style_class_name('g-os-popup');
        this.menu.actor.add_style_class_name('g-os-window-previews');
        this.menu.actor.reactive = true;
        this.menu.actor.track_hover = true;
        this.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        this.menu.actor.connect('notify::hover', () => {
            if (this.menu.actor.hover)
                this._cancelSource('hideSource');
            else
                this._queueClose();
        });
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (!open) {
                this._disconnectWindows();
                this.menu.removeAll();
                this.rows = [];
                this.onClose();
            }
        });
    }

    _disconnectWindows() {
        this.windowCleanup.clear();
        this.windowCleanup = new CleanupManager();
    }

    _render() {
        this._disconnectWindows();
        this.menu.removeAll();
        this.rows = [];
        const windows = this.getWindows().filter(window => !this.ignoredWindows.has(window));
        if (!windows.length)
            return false;
        const horizontal = this.screen.position === 0;
        const availableWidth = Math.max(120, this.screen.monitor.width - 56);
        const width = Math.min(220, availableWidth);
        const height = Math.min(140, Math.max(60, this.screen.monitor.height - 150));
        const box = new this.St.BoxLayout({orientation: horizontal ? this.Clutter.Orientation.HORIZONTAL
            : this.Clutter.Orientation.VERTICAL, style_class: 'g-os-window-preview-list'});
        for (const window of windows) {
            const content = new this.St.BoxLayout({orientation: this.Clutter.Orientation.VERTICAL,
                style_class: 'g-os-window-preview', width});
            const header = new this.St.BoxLayout({style_class: 'g-os-window-preview-header'});
            const title = new this.St.Label({text: window.get_title?.() || 'Fenêtre',
                x_expand: true, y_align: this.Clutter.ActorAlign.CENTER, style: `max-width: ${Math.max(60, width - 36)}px;`});
            title.clutter_text.ellipsize = this.Pango.EllipsizeMode.END;
            header.add_child(title);
            const close = new this.St.Button({can_focus: true, accessible_name: 'Fermer cette fenêtre',
                track_hover: true,
                style_class: 'button g-os-window-preview-close',
                child: new this.St.Icon({icon_name: 'window-close-symbolic', icon_size: 16})});
            close.connect('clicked', () => window.delete(this.timestamp()));
            header.add_child(close);
            content.add_child(header);
            const viewport = new this.St.Widget({width, height, clip_to_allocation: true,
                layout_manager: new this.Clutter.FixedLayout()});
            const actor = window.get_compositor_private?.();
            const source = actor;
            const frame = window.get_frame_rect?.();
            const [sourceWidth, sourceHeight] = source?.get_size?.() ?? [frame?.width ?? 0, frame?.height ?? 0];
            let clone = null;
            if (source && sourceWidth > 0 && sourceHeight > 0) {
                const scale = Math.min(width / sourceWidth, height / sourceHeight);
                clone = new this.Clutter.Clone({source, reactive: false});
                clone.set_size(sourceWidth, sourceHeight);
                clone.scale_x = scale;
                clone.scale_y = scale;
                clone.set_position(Math.round((width - sourceWidth * scale) / 2),
                    Math.round((height - sourceHeight * scale) / 2));
                viewport.add_child(clone);
            } else {
                viewport.add_child(new this.St.Icon({icon_name: 'application-x-executable-symbolic', icon_size: 48,
                    x_align: this.Clutter.ActorAlign.CENTER, y_align: this.Clutter.ActorAlign.CENTER}));
            }
            const preview = new this.St.Button({child: viewport, can_focus: true, track_hover: true,
                accessible_name: `Activer ${window.get_title?.() || 'la fenêtre'}`});
            preview.connect('clicked', () => {
                this.close();
                if (!this.ignoredWindows.has(window))
                    this.activate(window);
            });
            content.add_child(preview);
            box.add_child(content);
            this.rows.push({window, preview, clone, close, viewport});
            for (const target of [preview, close]) {
                target.connect('notify::hover', () => {
                    if (this._pointerInside())
                        this._cancelSource('hideSource');
                    else
                        this._queueClose();
                });
            }
            if (typeof window.connect === 'function') {
                for (const signal of ['notify::title', 'size-changed'])
                    this.windowCleanup.addSignal(window, window.connect(signal, () => this.refresh()));
                this.windowCleanup.addSignal(window, window.connect('unmanaged', () => {
                    this.ignoredWindows.add(window);
                    this.refresh();
                }));
            }
        }
        if (typeof this.button.app?.connect === 'function')
            this.windowCleanup.addSignal(this.button.app, this.button.app.connect('windows-changed', () => this.refresh()));
        const scroll = new this.St.ScrollView({
            width: horizontal ? Math.min(availableWidth, windows.length * (width + 12)) : width,
            hscrollbar_policy: horizontal ? this.St.PolicyType.AUTOMATIC : this.St.PolicyType.NEVER,
            vscrollbar_policy: horizontal ? this.St.PolicyType.NEVER : this.St.PolicyType.AUTOMATIC,
            style: `max-height: ${Math.max(height + 36, Math.min(480, this.screen.monitor.height - 80))}px;`});
        const item = new this.PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(scroll);
        this.menu.addMenuItem(item);
        setChildWhenMapped(scroll, box);
        return true;
    }

    show() {
        if (this.disposed || !this.allowed() || !this.getWindows().length)
            return;
        this._ensureMenu();
        if (this._render()) {
            this.onOpen();
            this.menu.open(0);
        }
    }

    refresh() {
        if (!this.isOpen || this.disposed)
            return;
        if (!this.allowed() || !this._render())
            this.close();
    }

    close() {
        this._cancelSource('showSource');
        this._cancelSource('hideSource');
        if (this.menu?.isOpen)
            this.menu.close(0);
    }

    destroy() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.close();
        this._disconnectWindows();
        if (this.menu) {
            this.menu.destroy();
        }
        this.menu = null;
        this.rows = [];
    }
}