const switcherClasses = new WeakMap();

export function coverflowLayout(count, selected, width, height, cardWidth, cardHeight) {
    return Array.from({length: count}, (_entry, index) => {
        let offset = index - selected;
        if (offset > count / 2) offset -= count;
        if (offset < -count / 2) offset += count;
        const distance = Math.abs(offset);
        return {offset, x: (width - cardWidth) / 2 + Math.sign(offset) *
            (distance ? cardWidth * 0.62 + (distance - 1) * cardWidth * 0.19 : 0),
        y: Math.max(0, (height - cardHeight) / 2 - 28),
        scale: distance ? Math.max(0.58, 0.82 - distance * 0.04) : 1,
        rotation: offset === 0 ? 0 : offset < 0 ? 52 : -52,
        depth: offset === 0 ? 180 : -distance * 36,
        opacity: distance > 3 ? 0 : Math.max(100, 255 - distance * 32)};
    });
}

export function createCoverflowSwitcher({GObject, AltTab, St, Clutter, Meta, Pango, Main, global}) {
    if (switcherClasses.has(AltTab.WindowSwitcherPopup))
        return switcherClasses.get(AltTab.WindowSwitcherPopup);
    const Switcher = GObject.registerClass(class GOsCoverflowSwitcher extends AltTab.WindowSwitcherPopup {
        [key: string]: any;
        _init(settings) {
            this._coverflowSettings = settings;
            this._cards = [];
            this._windowSignals = [];
            this._flowReady = false;
            super._init();
            this._flowMonitor = Main.layoutManager.monitors?.[global.display.focus_window?.get_monitor?.()]
                ?? Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
            this._switcherList.hide();
            this.add_style_class_name('g-os-coverflow-overlay');
            this._scene = new St.Widget({layout_manager: new Clutter.FixedLayout(), clip_to_allocation: true});
            this.add_child(this._scene);
            this._title = new St.Label({style_class: 'g-os-coverflow-title', x_align: Clutter.ActorAlign.CENTER});
            this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this._scene.add_child(this._title);
            this._flowReady = true;
            this._syncCards();
            this.connect('destroy', () => this._clearCards());
        }

        _getWindowList() {
            const workspace = this._coverflowSettings.get_boolean('coverflow-current-workspace-only')
                ? global.workspace_manager.get_active_workspace() : null;
            return global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace)
                .filter(window => !window.skip_taskbar);
        }

        _clearCards() {
            for (const [window, signal] of this._windowSignals)
                window.disconnect(signal);
            this._windowSignals = [];
            for (const card of this._cards)
                card.button.destroy();
            this._cards = [];
        }

        _syncCards() {
            const windows = this._items.map(item => item.window);
            if (this._cards.length === windows.length && this._cards.every((card, index) => card.window === windows[index]))
                return;
            this._clearCards();
            for (const window of windows) {
                const viewport = new St.Widget({layout_manager: new Clutter.FixedLayout(), clip_to_allocation: true});
                const source = window.get_compositor_private?.();
                const clone = source ? new Clutter.Clone({source, reactive: false}) :
                    new St.Icon({icon_name: 'application-x-executable-symbolic', icon_size: 96});
                viewport.add_child(clone);
                const button = new St.Button({child: viewport, reactive: true, track_hover: true,
                    can_focus: true, accessible_name: window.get_title?.() || 'Fenêtre'});
                button.set_pivot_point(0.5, 0.5);
                button.connect('clicked', () => {
                    const index = this._cards.findIndex(card => card.window === window);
                    if (index >= 0) { this._select(index); this._finish(); }
                });
                button.connect('notify::hover', () => {
                    if (button.hover && this.mouseActive) {
                        const index = this._cards.findIndex(card => card.window === window);
                        if (index >= 0) this._select(index);
                    }
                });
                this._scene.add_child(button);
                this._cards.push({window, button, viewport, clone, source});
                this._windowSignals.push([window, window.connect('notify::title', () => this._layoutCards(false))]);
            }
            this._scene.set_child_above_sibling(this._title, null);
        }

        _layoutCards(animate = true) {
            if (!this._flowReady || !this._scene.width || !this._scene.height)
                return;
            this._syncCards();
            const width = this._scene.width;
            const height = this._scene.height;
            const cardWidth = Math.min(600, width * 0.47);
            const cardHeight = Math.min(400, height * 0.55);
            const motion = St.Settings.get();
            const reduced = 'ReducedMotion' in St && (motion.reduced_motion ?? motion.reducedMotion) === St.ReducedMotion.REDUCE;
            const duration = animate && motion.enable_animations && !reduced
                ? this._coverflowSettings.get_int('coverflow-animation-duration') : 0;
            const layout = coverflowLayout(this._cards.length, this._selectedIndex, width, height, cardWidth, cardHeight);
            this._cards.forEach((card, index) => {
                const target = layout[index];
                card.button.set_size(cardWidth, cardHeight);
                card.viewport.set_size(cardWidth, cardHeight);
                if (card.source) {
                    const [sourceWidth, sourceHeight] = card.source.get_size();
                    if (sourceWidth > 0 && sourceHeight > 0) {
                        const scale = Math.min(cardWidth / sourceWidth, cardHeight / sourceHeight);
                        card.clone.set_size(sourceWidth, sourceHeight);
                        card.clone.scale_x = scale;
                        card.clone.scale_y = scale;
                        card.clone.set_position((cardWidth - sourceWidth * scale) / 2, (cardHeight - sourceHeight * scale) / 2);
                    }
                } else {
                    card.clone.set_position((cardWidth - 96) / 2, (cardHeight - 96) / 2);
                }
                card.button.visible = target.opacity > 0;
                card.button.ease({translation_x: target.x, translation_y: target.y, scale_x: target.scale, scale_y: target.scale,
                    rotation_angle_y: target.rotation, translation_z: target.depth, opacity: target.opacity,
                    duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            });
            [...this._cards].sort((first, second) => layout[this._cards.indexOf(second)].depth -
                layout[this._cards.indexOf(first)].depth).reverse().forEach(card => this._scene.set_child_above_sibling(card.button, null));
            this._scene.set_child_above_sibling(this._title, null);
            this._title.text = this._items[this._selectedIndex]?.window.get_title?.() || '';
            this._title.set_width(Math.min(width - 64, 720));
            const [, titleHeight] = this._title.get_preferred_height(this._title.width);
            this._title.set_position((width - this._title.width) / 2, Math.min(height - titleHeight - 24,
                layout[this._selectedIndex]?.y + cardHeight + 40 || height - titleHeight - 24));
        }

        vfunc_allocate(box) {
            this.set_allocation(box);
            if (!this._flowReady)
                return;
            const monitor = this._flowMonitor;
            const allocation = new Clutter.ActorBox({x1: monitor.x, y1: monitor.y,
                x2: monitor.x + monitor.width, y2: monitor.y + monitor.height});
            this._scene.allocate(allocation);
            if (this._sceneWidth !== monitor.width || this._sceneHeight !== monitor.height) {
                this._sceneWidth = monitor.width;
                this._sceneHeight = monitor.height;
                this._layoutCards(false);
            }
        }

        _select(index) {
            super._select(index);
            this._layoutCards();
        }

        _itemRemoved(...args) {
            super._itemRemoved(...args);
            this._layoutCards(false);
        }

        _keyPressHandler(keysym, action) {
            if (action === Meta.KeyBindingAction.SWITCH_APPLICATIONS)
                action = Meta.KeyBindingAction.SWITCH_WINDOWS;
            else if (action === Meta.KeyBindingAction.SWITCH_APPLICATIONS_BACKWARD)
                action = Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD;
            return super._keyPressHandler(keysym, action);
        }

        _isActorOutside(actor) { return !this._scene?.contains(actor); }
    });
    switcherClasses.set(AltTab.WindowSwitcherPopup, Switcher);
    return Switcher;
}

export class CoverflowController {
    [key: string]: any;
    constructor({wm, settings, createPopup, modes}) {
        Object.assign(this, {wm, settings, createPopup, modes});
        this.enabled = false;
        this.popup = null;
        this.nativeHandler = wm._startSwitcher.bind(wm);
        this.names = ['switch-applications', 'switch-applications-backward', 'switch-windows', 'switch-windows-backward'];
        this.handler = (...args) => {
            const binding = args.at(-1);
            if (!this.enabled || !binding?.get_name)
                return;
            this.wm._workspaceSwitcherPopup?.destroy();
            this.popup?.destroy();
            const popup = this.createPopup(this.settings);
            this.popup = popup;
            popup.connect('destroy', () => { if (this.popup === popup) this.popup = null; });
            if (!popup.show(binding.is_reversed(), binding.get_name(), binding.get_mask()))
                popup.destroy();
        };
    }
    update() {
        const enabled = this.settings.get_boolean('coverflow-enabled');
        if (enabled === this.enabled)
            return;
        this.enabled = enabled;
        for (const name of this.names)
            this.wm.setCustomKeybindingHandler(name, this.modes, enabled ? this.handler : this.nativeHandler);
        if (!enabled) this.popup?.destroy();
    }
    destroy() {
        if (this.enabled) {
            for (const name of this.names)
                this.wm.setCustomKeybindingHandler(name, this.modes, this.nativeHandler);
        }
        this.enabled = false;
        this.popup?.destroy();
        this.popup = null;
    }
}