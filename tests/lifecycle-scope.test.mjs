import assert from 'node:assert/strict';
import test from 'node:test';
import { LifecycleScope } from '../dist/core/lifecycleScope.js';

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
