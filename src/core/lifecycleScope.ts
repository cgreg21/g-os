import { ChromeActorManager } from './chromeActorManager.js';
import {AnimationManager} from './animationManager.js';
import { CleanupManager } from './cleanupManager.js';
import { TaskScheduler } from './taskScheduler.js';

/**
 * Owns the lifetime of resources created by one feature or UI component.
 */
export class LifecycleScope<T extends object = object> {
    readonly cleanup = new CleanupManager();
    readonly animations = new AnimationManager();
    private destroyed = false;

    constructor(
        readonly tasks?: TaskScheduler,
        readonly chrome?: ChromeActorManager<T>,
    ) {}

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
        // Stop asynchronous callbacks before releasing their dependent resources.
        this.tasks?.destroy();
        this.cleanup.clear();
        this.animations.destroy();
        this.chrome?.destroy();
    }

    get isDestroyed(): boolean {
        return this.destroyed;
    }
}
