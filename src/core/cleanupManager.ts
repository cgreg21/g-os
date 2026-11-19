/** Owns cleanup callbacks and runs them once, in reverse registration order. */
export class CleanupManager {
    private cleanups: Array<() => void> = [];
    private cleared = false;

    add(cleanup: () => void): void {
        if (this.cleared) {
            this.runCleanup(cleanup);
            return;
        }
        this.cleanups.push(cleanup);
    }

    addSignal(emitter: { disconnect(id: number): void }, id: number): void {
        this.add(() => emitter.disconnect(id));
    }

    clear(): void {
        if (this.cleared)
            return;
        this.cleared = true;
        const cleanups = this.cleanups.splice(0);
        for (let index = cleanups.length - 1; index >= 0; index--)
            this.runCleanup(cleanups[index]!);
    }

    private runCleanup(cleanup: () => void): void {
        try {
            cleanup();
        } catch (error) {
            // Logging is best-effort too: a broken host logger must not prevent
            // the remaining resources from being released.
            try {
                logError(error as Error, 'Unable to release g-os resource');
            } catch {
                // Preserve cleanup isolation even if the logger itself fails.
            }
        }
    }

    get size(): number {
        return this.cleanups.length;
    }
}
