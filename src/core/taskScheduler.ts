/** GLib-compatible scheduling interface, injectable for deterministic tests. */
export interface TaskSchedulerBackend {
    timeout(delayMs: number, callback: () => boolean): number;
    idle(callback: () => boolean): number;
    remove(sourceId: number): void;
}

/** Owns keyed one-shot tasks and prevents callbacks after disposal. */
export class TaskScheduler {
    private readonly sources = new Map<string, number>();
    private readonly generations = new Map<string, symbol>();
    private destroyed = false;

    constructor(private readonly backend: TaskSchedulerBackend) {}

    timeout(key: string, delayMs: number, callback: () => void): void {
        this.schedule(key, done => this.backend.timeout(delayMs, done), callback);
    }

    idle(key: string, callback: () => void): void {
        this.schedule(key, done => this.backend.idle(done), callback);
    }

    cancel(key: string): void {
        // Invalidate a schedule that may still be registering its backend source.
        this.generations.delete(key);
        this.removeKeyedSource(key);
    }

    cancelAll(): void {
        for (const key of new Set([...this.sources.keys(), ...this.generations.keys()]))
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
        const generation = Symbol(`task:${key}`);
        this.generations.set(key, generation);
        this.removeKeyedSource(key);
        // Removing the previous backend source can synchronously re-enter the
        // scheduler. The nested request is newer and must retain ownership.
        if (this.destroyed || this.generations.get(key) !== generation)
            return;
        let sourceId: number | undefined;
        let completedBeforeRegistration = false;
        const run = (): void => {
            try {
                callback();
            } catch (error) {
                try {
                    logError(error as Error, `g-os scheduled task failed: ${key}`);
                } catch {
                    // A failing host logger must not leak a completed task callback.
                }
            }
        };
        const done = (): boolean => {
            if (sourceId === undefined) {
                completedBeforeRegistration = true;
                return false;
            }
            if (this.destroyed || this.generations.get(key) !== generation ||
                this.sources.get(key) !== sourceId)
                return false;
            this.sources.delete(key);
            this.generations.delete(key);
            run();
            return false;
        };
        try {
            sourceId = createSource(done);
        } catch (error) {
            if (this.generations.get(key) === generation)
                this.generations.delete(key);
            throw error;
        }
        // Injectable backends may complete synchronously, before their source ID
        // can be registered. Defer the callback until registration has returned.
        if (completedBeforeRegistration) {
            if (!this.destroyed && this.generations.get(key) === generation) {
                this.generations.delete(key);
                run();
            }
            return;
        }
        if (this.destroyed || this.generations.get(key) !== generation)
            this.removeSource(sourceId);
        else
            this.sources.set(key, sourceId);
    }

    private removeKeyedSource(key: string): void {
        const sourceId = this.sources.get(key);
        if (sourceId === undefined)
            return;
        this.sources.delete(key);
        this.removeSource(sourceId);
    }

    private removeSource(sourceId: number): void {
        try {
            this.backend.remove(sourceId);
        } catch (error) {
            // The source may already have completed or been removed by GLib.
            try {
                logError(error as Error, 'Unable to cancel g-os scheduled task');
            } catch {
                // Cancellation of other sources must continue despite logger failure.
            }
        }
    }
}
