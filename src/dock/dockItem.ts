/**
 * Shared behavioral base for every dock actor.
 *
 * GNOME Shell's AppIcon and St.Button cannot share a native superclass, so
 * DockItem provides one composition-based contract while preserving each
 * actor's native rendering and activation implementation.
 */
export class DockItem {
    private static readonly instances = new WeakMap<object, DockItem>();

    readonly actor: any;
    readonly screen: any;
    private disposed = false;
    private destroySignal = 0;
    private tooltipUpdater: ((coordinates?: [number, number] | null) => void) | null = null;
    private contextMenu: any = null;
    private dragDelegate: any = null;

    private constructor(actor: any, screen: any) {
        this.actor = actor;
        this.screen = screen;
        this.destroySignal = actor.connect('destroy', () => this.dispose());
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

    setDragSource(delegate: any): this {
        this.dragDelegate = delegate;
        this.actor._delegate = delegate;
        return this;
    }

    get menu(): any {
        return this.contextMenu;
    }

    get dragSource(): any {
        return this.dragDelegate;
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
        this.dragDelegate = null;
        if (this.destroySignal) {
            try {
                this.actor.disconnect(this.destroySignal);
            } catch {
                // The actor may already be finalizing.
            }
            this.destroySignal = 0;
        }
        DockItem.instances.delete(this.actor);
    }
}
