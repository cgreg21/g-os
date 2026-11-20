import {CleanupManager} from '../core/cleanupManager.js';
import {registerShadowDragSource, type ShadowDragSourceOptions} from '../shared/interaction/shadowDragSource.js';
import type {DropTargetDelegate} from '../shared/interaction/dragAndDrop.js';

/**
 * Shared interaction contract for dock items.
 *
 * GNOME actor classes remain untouched: AppIcon keeps its native app behavior,
 * while St.Button keeps its own activation and accessibility behavior.
 */
export class DockItem {
    private static readonly instances = new WeakMap<object, DockItem>();

    readonly actor: any;
    readonly screen: any;
    private readonly cleanup = new CleanupManager();
    private readonly boundMenus = new WeakSet<object>();
    private tooltipUpdater: ((coordinates?: [number, number] | null) => void) | null = null;
    private contextMenu: any = null;
    private disposed = false;

    private constructor(actor: any, screen: any) {
        this.actor = actor;
        this.screen = screen;

        const destroySignal = actor.connect('destroy', () => this.dispose());
        this.cleanup.add(() => {
            try {
                actor.disconnect(destroySignal);
            } catch {
                // The actor may already be finalizing.
            }
        });
        screen.lifecycle?.add(() => this.dispose());
    }

    static for(actor: any, screen: any): DockItem {
        let item = this.instances.get(actor);
        if (!item) {
            item = new DockItem(actor, screen);
            this.instances.set(actor, item);
        }
        return item;
    }

    setIdentity(key: string, type: string): this {
        this.actor.dockFocusKey = key;
        this.actor.dockItemType = type;
        return this;
    }

    setTooltip(update: (coordinates?: [number, number] | null) => void): this {
        this.tooltipUpdater = update;
        this.actor.updateDockTooltip = update;
        return this;
    }

    setContextMenu(menu: any, property = 'shortcutMenu'): this {
        this.contextMenu = menu;
        this.actor.dockContextMenu = menu;
        if (property)
            this.actor[property] = menu;
        return this;
    }

    /**
     * Give every custom dock menu the same keyboard and pointer entry points.
     * Menu contents and open/close policy remain owned by the feature creating it.
     */
    bindContextMenu(menu: any, Clutter: any): this {
        if (!menu || this.disposed || this.boundMenus.has(menu))
            return this;

        this.boundMenus.add(menu);

        const previousTooltipGate = this.actor.shouldShowTooltip;
        const tooltipGate = () => this.actor.hover && !menu.isOpen;
        this.actor.shouldShowTooltip = tooltipGate;
        this.cleanup.add(() => {
            if (this.actor.shouldShowTooltip !== tooltipGate)
                return;
            if (previousTooltipGate === undefined)
                delete this.actor.shouldShowTooltip;
            else
                this.actor.shouldShowTooltip = previousTooltipGate;
        });

        const click = new Clutter.ClickGesture({
            required_button: Clutter.BUTTON_SECONDARY,
            recognize_on_press: true,
        });
        click.connect('recognize', () => {
            if (!this.disposed)
                menu.toggle();
        });
        this.actor.add_action(click);
        this.cleanup.add(() => this.actor.remove_action(click));

        const popupSignal = this.actor.connect('popup-menu', () => {
            if (!this.disposed)
                menu.open();
            return Clutter.EVENT_STOP;
        });
        this.cleanup.addSignal(this.actor, popupSignal);

        return this;
    }

    registerDragSource(options: Omit<ShadowDragSourceOptions, 'controller' | 'actor' | 'lifecycle'>): () => void {
        if (this.disposed || !this.screen.interactionDnd)
            return () => {};
        return registerShadowDragSource({
            ...options,
            controller: this.screen.interactionDnd,
            actor: this.actor,
            lifecycle: this.screen.lifecycle,
        });
    }

    registerDropTarget(delegate: DropTargetDelegate): () => void {
        if (this.disposed || !this.screen.interactionDnd)
            return () => {};
        return this.screen.interactionDnd.registerTarget(
            this.actor, delegate, this.screen.lifecycle);
    }

    get menu(): any {
        return this.contextMenu;
    }

    updateTooltip(coordinates: [number, number] | null = null): void {
        this.tooltipUpdater?.(coordinates);
    }

    dispose(): void {
        if (this.disposed)
            return;
        this.disposed = true;
        this.tooltipUpdater = null;
        this.contextMenu = null;
        this.cleanup.clear();
        DockItem.instances.delete(this.actor);
    }
}
