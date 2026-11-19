import assert from 'node:assert/strict';
import test from 'node:test';
import { ChromeActorManager } from '../dist/core/chromeActorManager.js';

test('registers each actor once and preserves registration options', () => {
    const added = [];
    const removed = [];
    const manager = new ChromeActorManager(
        (actor, options) => added.push({ actor, options }),
        actor => removed.push(actor),
    );
    const actor = {};
    const options = { affectsStruts: true, trackFullscreen: false };

    manager.add(actor, options);
    manager.add(actor, options);

    assert.deepEqual(added, [{ actor, options }]);
    assert.equal(manager.size, 1);
    assert.deepEqual(removed, []);
});

test('removes an actor once and ignores unknown actors', () => {
    const removed = [];
    const manager = new ChromeActorManager(() => {}, actor => removed.push(actor));
    const actor = {};

    manager.add(actor);
    manager.remove(actor);
    manager.remove(actor);
    manager.remove({});

    assert.deepEqual(removed, [actor]);
    assert.equal(manager.size, 0);
});

test('destroys actors in reverse registration order and is idempotent', () => {
    const removed = [];
    const manager = new ChromeActorManager(() => {}, actor => removed.push(actor));
    const first = {};
    const second = {};
    const third = {};
    manager.add(first);
    manager.add(second);
    manager.add(third);

    manager.destroy();
    manager.destroy();

    assert.deepEqual(removed, [third, second, first]);
    assert.equal(manager.size, 0);
    assert.equal(manager.isDestroyed, true);
});

test('ignores actor registration after destruction', () => {
    const added = [];
    const manager = new ChromeActorManager(actor => added.push(actor), () => {});
    manager.destroy();
    manager.add({});

    assert.deepEqual(added, []);
    assert.equal(manager.size, 0);
});

test('continues releasing actors when a removal callback fails', () => {
    const removed = [];
    const originalLogError = globalThis.logError;
    globalThis.logError = () => {};
    try {
        const manager = new ChromeActorManager(() => {}, actor => {
            removed.push(actor);
            if (actor.fail)
                throw new Error('remove failed');
        });
        const first = {};
        const failing = { fail: true };
        const last = {};
        manager.add(first);
        manager.add(failing);
        manager.add(last);
        manager.destroy();
    } finally {
        globalThis.logError = originalLogError;
    }

    assert.equal(removed.length, 3);
});


test('releases an actor when host registration re-enters destroy', () => {
    const actor = {};
    const removed = [];
    let manager;
    manager = new ChromeActorManager(
        () => manager.destroy(),
        value => removed.push(value),
    );

    manager.add(actor);

    assert.deepEqual(removed, [actor]);
    assert.equal(manager.size, 0);
    assert.equal(manager.isDestroyed, true);
});

test('does not retain an actor when host registration throws', () => {
    const actor = {};
    const manager = new ChromeActorManager(
        () => { throw new Error('registration failed'); },
        () => {},
    );

    assert.throws(() => manager.add(actor), /registration failed/);
    assert.equal(manager.size, 0);
});

test('rolls back a partially registered actor when host registration throws', () => {
    const actor = {};
    const registered = [];
    const removed = [];
    const originalLogError = globalThis.logError;
    globalThis.logError = () => {};
    try {
        const manager = new ChromeActorManager(
            value => {
                registered.push(value);
                throw new Error('registration failed after side effect');
            },
            value => removed.push(value),
        );

        assert.throws(() => manager.add(actor), /registration failed after side effect/);
        assert.deepEqual(registered, [actor]);
        assert.deepEqual(removed, [actor]);
        assert.equal(manager.size, 0);
    } finally {
        if (originalLogError === undefined)
            delete globalThis.logError;
        else
            globalThis.logError = originalLogError;
    }
});

test('does not release an actor twice when registration removes it before throwing', () => {
    const actor = {};
    const removed = [];
    let manager;
    manager = new ChromeActorManager(
        () => {
            manager.remove(actor);
            throw new Error('registration failed after reentrant removal');
        },
        value => removed.push(value),
    );

    assert.throws(() => manager.add(actor), /registration failed after reentrant removal/);
    assert.deepEqual(removed, [actor]);
    assert.equal(manager.size, 0);
});

test('preserves a reentrant replacement registration when the original add throws', () => {
    const actor = {};
    const removed = [];
    let manager;
    let registrations = 0;
    manager = new ChromeActorManager(
        () => {
            registrations++;
            if (registrations === 1) {
                manager.remove(actor);
                manager.add(actor);
                throw new Error('original registration failed');
            }
        },
        value => removed.push(value),
    );

    assert.throws(() => manager.add(actor), /original registration failed/);
    assert.deepEqual(removed, [actor]);
    assert.equal(manager.size, 1);

    manager.destroy();
    assert.deepEqual(removed, [actor, actor]);
    assert.equal(manager.size, 0);
});
