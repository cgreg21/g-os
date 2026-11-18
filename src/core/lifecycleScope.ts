import { CleanupManager } from './cleanupManager.js';

/**
 * Owns the lifetime of resources created by one feature or UI component.
 *
 * Scheduled tasks and GNOME Shell chrome actors can be composed here when
 * their shared managers are introduced. Until then, this scope centralizes
 * cleanup callbacks and signal subscriptions.
 */
export class LifecycleScope {
    readonly cleanup = new CleanupManager();
    private destroyed = false;

    add(cleanup: () => void): void {
        this.cleanup.add(cleanup);
    }

    addSignal(
        emitter: { disconnect(id: number): void },
        signalId: number,
    ): void {
        this.cleanup.addSignal(emitter, signalId);
    }

    run(callback: () => void): void {
        if (!this.destroyed)
            callback();
    }

    destroy(): void {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.cleanup.clear();
    }

    get isDestroyed(): boolean {
        return this.destroyed;
    }
}
