import assert from 'node:assert/strict';
import test from 'node:test';
import { createGLibTaskSchedulerBackend } from '../dist/core/glibTaskSchedulerBackend.js';

test('maps timeout tasks to GLib timeout_add with a normalized delay', () => {
    const calls = [];
    const callback = () => false;
    const glib = {
        PRIORITY_DEFAULT: 0,
        PRIORITY_DEFAULT_IDLE: 200,
        timeout_add(priority, interval, fn) {
            calls.push({ kind: 'timeout', priority, interval, fn });
            return 17;
        },
        idle_add() { return 18; },
        source_remove() { return true; },
    };

    const backend = createGLibTaskSchedulerBackend(glib);
    assert.equal(backend.timeout(-2.8, callback), 17);
    assert.deepEqual(calls[0], {
        kind: 'timeout',
        priority: 0,
        interval: 0,
        fn: callback,
    });
});

test('maps idle tasks to GLib idle_add with the idle priority', () => {
    let call;
    const callback = () => false;
    const glib = {
        PRIORITY_DEFAULT: 0,
        PRIORITY_DEFAULT_IDLE: 200,
        timeout_add() { return 17; },
        idle_add(priority, fn) {
            call = { priority, fn };
            return 18;
        },
        source_remove() { return true; },
    };

    const backend = createGLibTaskSchedulerBackend(glib);
    assert.equal(backend.idle(callback), 18);
    assert.deepEqual(call, { priority: 200, fn: callback });
});

test('maps source removal to GLib source_remove', () => {
    const removed = [];
    const glib = {
        PRIORITY_DEFAULT: 0,
        PRIORITY_DEFAULT_IDLE: 200,
        timeout_add() { return 17; },
        idle_add() { return 18; },
        source_remove(id) {
            removed.push(id);
            return true;
        },
    };

    createGLibTaskSchedulerBackend(glib).remove(42);
    assert.deepEqual(removed, [42]);
});
