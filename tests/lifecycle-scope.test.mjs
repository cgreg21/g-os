import assert from 'node:assert/strict';
import test from 'node:test';
import { LifecycleScope } from '../dist/core/lifecycleScope.js';
import { TaskScheduler } from '../dist/core/taskScheduler.js';
import { ChromeActorManager } from '../dist/core/chromeActorManager.js';

function createEmitter() {
    const disconnected = [];
    return {
        disconnected,
        disconnect(id) {
            disconnected.push(id);
        },
    };
}

test('releases registered resources in reverse order on destroy', () => {
    const scope = new LifecycleScope();
    const calls = [];
    scope.add(() => calls.push('first'));
    scope.add(() => calls.push('second'));

    scope.destroy();
    scope.destroy();

    assert.deepEqual(calls, ['second', 'first']);
    assert.equal(scope.isDestroyed, true);
    assert.equal(scope.cleanup.size, 0);
});

test('disconnects registered signals on destroy', () => {
    const scope = new LifecycleScope();
    const emitter = createEmitter();
    scope.addSignal(emitter, 10);
    scope.addSignal(emitter, 20);

    scope.destroy();

    assert.deepEqual(emitter.disconnected, [20, 10]);
});

test('runs newly registered cleanup immediately after destruction', () => {
    const scope = new LifecycleScope();
    const calls = [];
    scope.destroy();
    scope.add(() => calls.push('late'));

    assert.deepEqual(calls, ['late']);
    assert.equal(scope.cleanup.size, 0);
});

test('guards callbacks after destruction', () => {
    const scope = new LifecycleScope();
    const calls = [];

    scope.run(() => calls.push('before'));
    scope.destroy();
    scope.run(() => calls.push('after'));

    assert.deepEqual(calls, ['before']);
});

test('does not reconnect or retain signal cleanup after destruction', () => {
    const scope = new LifecycleScope();
    const emitter = createEmitter();

    scope.destroy();
    scope.addSignal(emitter, 42);

    assert.deepEqual(emitter.disconnected, [42]);
    assert.equal(scope.cleanup.size, 0);
});


test('destroys scheduled tasks before releasing other resources', () => {
    const removed = [];
    const backend = {
        timeout(_delay, _callback) { return 7; },
        idle(_callback) { return 8; },
        remove(id) { removed.push(id); },
    };
    const tasks = new TaskScheduler(backend);
    const scope = new LifecycleScope(tasks);
    const calls = [];
    tasks.timeout('refresh', 100, () => calls.push('task'));
    scope.add(() => calls.push('cleanup'));

    scope.destroy();

    assert.deepEqual(removed, [7]);
    assert.deepEqual(calls, ['cleanup']);
    assert.equal(tasks.size, 0);
});


test('destroys chrome actors after scheduled tasks and registered cleanup', () => {
    const order = [];
    const tasks = new TaskScheduler({
        timeout(_delay, _callback) { return 1; },
        idle(_callback) { return 2; },
        remove() { order.push('tasks'); },
    });
    const actor = {};
    const actorManager = new ChromeActorManager(
        () => {},
        removed => {
            assert.equal(removed, actor);
            order.push('chrome');
        },
    );
    actorManager.add(actor);
    const scope = new LifecycleScope(tasks, actorManager);
    scope.add(() => order.push('cleanup'));
    tasks.timeout('scheduled', 10, () => order.push('task'));

    scope.destroy();
    scope.destroy();

    assert.deepEqual(order, ['tasks', 'cleanup', 'chrome']);
});
