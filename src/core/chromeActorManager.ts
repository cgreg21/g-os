export interface ChromeActorOptions {
    affectsStruts?: boolean;
    trackFullscreen?: boolean;
}

/** Owns actors registered with GNOME's chrome layer and releases them once. */
export class ChromeActorManager<T extends object> {
    private readonly actors = new Set<T>();
    private destroyed = false;

    constructor(
        private readonly addActor: (actor: T, options: ChromeActorOptions) => void,
        private readonly removeActor: (actor: T) => void,
    ) {}

    add(actor: T, options: ChromeActorOptions = {}): void {
        if (this.destroyed || this.actors.has(actor))
            return;
        // Track ownership before calling host code: registration can re-enter
        // this manager (including destroy()) through GNOME signal delivery.
        this.actors.add(actor);
        try {
            this.addActor(actor, options);
        } catch (error) {
            // Roll back only if ownership remains here; host code may already
            // have re-entered remove() or destroy() and released the actor.
            if (this.actors.delete(actor))
                this.release(actor);
            throw error;
        }
    }

    remove(actor: T): void {
        if (!this.actors.delete(actor))
            return;
        this.release(actor);
    }

    destroy(): void {
        if (this.destroyed)
            return;
        this.destroyed = true;
        const actors = [...this.actors];
        this.actors.clear();
        for (let index = actors.length - 1; index >= 0; index--)
            this.release(actors[index]!);
    }

    private release(actor: T): void {
        try {
            this.removeActor(actor);
        } catch (error) {
            logError(error as Error, 'Unable to remove g-os chrome actor');
        }
    }

    get size(): number {
        return this.actors.size;
    }

    get isDestroyed(): boolean {
        return this.destroyed;
    }
}
