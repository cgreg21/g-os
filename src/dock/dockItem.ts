import {CleanupManager} from '../core/cleanupManager.js';

/**
 * Shared behavior for dock actors without replacing GNOME's native actor
 * classes. Rendering and activation remain owned by AppIcon or St.Button.
 */
export class DockItem {
    private static readonly instances = new WeakMap<object, DockItem>();

    readonly actor: any;
    readonly screen: any;
    private readonly cleanup = new CleanupManager();
    private tooltipUpdater: ((coordinates?: [number, number] | null) => void) | null = null;
    private contextMenu: any = null;

    private constructor(actor: any, screen: any) {
        this.actor = actor;
        this.screen = screen;

        // Use GNOME Shell's own dash item styling instead of recreating its
        // button appearance in the extension stylesheet.
        if (!actor.has_style_class_name?.('app-well-app'))
            actor.add_style_class_name?.('app-well-app');

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

    get menu(): any {
        return this.contextMenu;
    }

    updateTooltip(coordinates: [number, number] | null = null): void {
        this.tooltipUpdater?.(coordinates);
    }

    dispose(): void {
        if (!this.tooltipUpdater && !this.contextMenu)
            return;
        this.tooltipUpdater = null;
        this.contextMenu = null;
        this.cleanup.clear();
        DockItem.instances.delete(this.actor);
    }
}
