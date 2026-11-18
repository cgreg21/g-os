import assert from 'node:assert/strict';
import test from 'node:test';
import { ManagedSignalController } from '../dist/core/managedSignalController.js';

class TestController extends ManagedSignalController {
    connect(source, signal, callback) {
        return this.connectMany([[source, signal, callback]]);
    }

    connectMany(connections) {
        if (!this.beginConnect())
            return false;
        for (const [source, signal, callback] of connections)
            this.connectSignal(source, signal, callback);
        return true;
    }

    execute(callback) {
        this.run(callback);
    }
}

function createEmitter() {
    let nextId = 1;
    const handlers = new Map();
    const disconnected = [];
    return {
        handlers,
        disconnected,
        connect(signal, callback) {
            const id = nextId++;
            handlers.set(id, { signal, callback });
            return id;
        },
        disconnect(id) {
            disconnected.push(id);
            handlers.delete(id);
        },
        emit(id, ...args) {
            handlers.get(id)?.callback(...args);
        },
    };
}

test('connects only once and tracks connected signals', () => {
    const controller = new TestController();
    const emitter = createEmitter();
    const callback = () => {};

    assert.equal(controller.connect(emitter, 'changed', callback), true);
    assert.equal(controller.connect(emitter, 'changed', callback), false);
    assert.equal(controller.size, 1);
    assert.equal(emitter.handlers.size, 1);
});

test('disconnects signals automatically on destroy', () => {
    const controller = new TestController();
    const first = createEmitter();
    const second = createEmitter();
    controller.connectMany([
        [first, 'first', () => {}],
        [second, 'second', () => {}],
    ]);
    controller.destroy();
    assert.deepEqual(first.disconnected, [1]);
    assert.deepEqual(second.disconnected, [1]);
    assert.equal(controller.size, 0);
    assert.equal(controller.isDestroyed, true);
});

test('destroy is idempotent and disconnects in reverse order', () => {
    const controller = new TestController();
    const emitter = createEmitter();
    controller.connectMany([
        [emitter, 'first', () => {}],
        [emitter, 'second', () => {}],
    ]);
    controller.destroy();
    controller.destroy();
    assert.deepEqual(emitter.disconnected, [2, 1]);
});

test('does not reconnect after destruction', () => {
    const controller = new TestController();
    const emitter = createEmitter();
    controller.destroy();
    assert.equal(controller.connect(emitter, 'changed', () => {}), false);
    assert.equal(emitter.handlers.size, 0);
    assert.equal(controller.size, 0);
});

test('ignores signal callbacks delivered after destruction', () => {
    const controller = new TestController();
    const emitter = createEmitter();
    let calls = 0;
    controller.connect(emitter, 'changed', () => calls++);
    const callback = [...emitter.handlers.values()][0].callback;
    controller.destroy();
    callback();
    assert.equal(calls, 0);
});

test('run ignores callbacks after destruction', () => {
    const controller = new TestController();
    let calls = 0;
    controller.execute(() => calls++);
    controller.destroy();
    controller.execute(() => calls++);
    assert.equal(calls, 1);
});
