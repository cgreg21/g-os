import type { TaskSchedulerBackend } from './taskScheduler.js';

/** The small subset of GLib used by the task scheduler adapter. */
export interface GLibSchedulerApi {
    PRIORITY_DEFAULT: number;
    PRIORITY_DEFAULT_IDLE: number;
    timeout_add(
        priority: number,
        interval: number,
        callback: () => boolean,
    ): number;
    idle_add(priority: number, callback: () => boolean): number;
    source_remove(sourceId: number): boolean;
}

/** Adapts GLib source functions to the scheduler's injectable backend contract. */
export function createGLibTaskSchedulerBackend(
    glib: GLibSchedulerApi,
): TaskSchedulerBackend {
    return {
        timeout: (delayMs, callback) => glib.timeout_add(
            glib.PRIORITY_DEFAULT,
            Math.max(0, Math.trunc(delayMs)),
            callback,
        ),
        idle: callback => glib.idle_add(
            glib.PRIORITY_DEFAULT_IDLE,
            callback,
        ),
        remove: sourceId => {
            glib.source_remove(sourceId);
        },
    };
}
