import GLib from 'gi://GLib';
import { TaskScheduler } from './taskScheduler.js';
import { createGLibTaskSchedulerBackend } from './glibTaskSchedulerBackend.js';

/** Creates a task scheduler backed by GNOME's GLib main loop. */
export function createGLibTaskScheduler(): TaskScheduler {
    return new TaskScheduler(createGLibTaskSchedulerBackend(GLib));
}
