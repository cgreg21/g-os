/** GLib-compatible scheduling interface, injectable for deterministic tests. */
export interface TaskSchedulerBackend {
    timeout(delayMs: number, callback: () => boolean): number;
    idle(callback: () => boolean): number;
    remove(sourceId: number): void;
}

/** Owns keyed one-shot tasks and prevents callbacks after disposal. */
export class TaskScheduler {
    private readonly sources = new Map<string, number>();
    private destroyed = false;

    constructor(private readonly backend: TaskSchedulerBackend) {}

    timeout(key: string, delayMs: number, callback: () => void): void {
        this.schedule(key, done => this.backend.timeout(delayMs, done), callback);
    }

    idle(key: string, callback: () => void): void {
        this.schedule(key, done => this.backend.idle(done), callback);
    }

    cancel(key: string): void {
        const sourceId = this.sources.get(key);
        if (sourceId === undefined)
            return;
        this.sources.delete(key);
        this.removeSource(sourceId);
    }

    cancelAll(): void {
        for (const key of [...this.sources.keys()])
            this.cancel(key);
    }

    destroy(): void {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.cancelAll();
    }

    get size(): number {
        return this.sources.size;
    }

    private schedule(
        key: string,
        createSource: (callback: () => boolean) => number,
        callback: () => void,
    ): void {
        if (this.destroyed)
            return;
        this.cancel(key);
        let sourceId: number | undefined;
        let completedBeforeRegistration = false;
        const run = (): void => {
            try {
                callback();
            } catch (error) {
                logError(error as Error, `g-os scheduled task failed: ${key}`);
            }
        };
        const done = (): boolean => {
            if (sourceId === undefined) {
                completedBeforeRegistration = true;
                return false;
            }
            if (this.destroyed || this.sources.get(key) !== sourceId)
                return false;
            this.sources.delete(key);
            run();
            return false;
        };
        sourceId = createSource(done);
        // Injectable backends may complete synchronously, before their source ID
        // can be registered. Defer the callback until registration has returned.
        if (completedBeforeRegistration) {
            if (!this.destroyed)
                run();
            return;
        }
        if (this.destroyed)
            this.removeSource(sourceId);
        else
            this.sources.set(key, sourceId);
    }

    private removeSource(sourceId: number): void {
        try {
            this.backend.remove(sourceId);
        } catch (error) {
            // The source may already have completed or been removed by GLib.
            logError(error as Error, 'Unable to cancel g-os scheduled task');
        }
    }
}
