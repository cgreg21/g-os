import assert from 'node:assert/strict';
import test from 'node:test';
import {DelegateManager} from '../dist/shared/interaction/delegateManager.js';

test('composes source and target delegates and removes them in either order', () => {
    const original = {baseAction: () => 'base'};
    const actor = {_delegate: original};
    const manager = new DelegateManager();
    const targetAction = () => 'target';
    const sourceAction = () => 'source';

    const removeTarget = manager.add(actor, {acceptDrop: targetAction});
    const removeSource = manager.add(actor, {getDragActorSource: sourceAction});

    assert.equal(actor._delegate.acceptDrop, targetAction);
    assert.equal(actor._delegate.getDragActorSource, sourceAction);
    assert.equal(actor._delegate.baseAction, original.baseAction);

    removeTarget();
    assert.equal(actor._delegate.acceptDrop, undefined);
    assert.equal(actor._delegate.getDragActorSource, sourceAction);
    assert.equal(actor._delegate.baseAction, original.baseAction);

    removeSource();
    assert.equal(actor._delegate, original);
    assert.equal(manager.size, 0);
});

test('restores remaining delegate layers when the top layer is removed first', () => {
    const actor = {};
    const manager = new DelegateManager();
    const targetAction = () => true;
    const sourceAction = () => false;

    const removeTarget = manager.add(actor, {acceptDrop: targetAction});
    const removeSource = manager.add(actor, {getDragActorSource: sourceAction});
    removeSource();

    assert.equal(actor._delegate.acceptDrop, targetAction);
    assert.equal(actor._delegate.getDragActorSource, undefined);

    removeTarget();
    assert.equal(actor._delegate, undefined);
    assert.equal(manager.size, 0);
});

test('does not overwrite a delegate installed externally after composition', () => {
    const actor = {};
    const manager = new DelegateManager();
    const remove = manager.add(actor, {acceptDrop: () => true});
    const external = {external: true};

    actor._delegate = external;
    remove();

    assert.equal(actor._delegate, external);
    assert.equal(manager.size, 0);
});

test('delegate layer cleanup is idempotent', () => {
    const actor = {};
    const manager = new DelegateManager();
    const remove = manager.add(actor, {acceptDrop: () => true});

    remove();
    remove();

    assert.equal(actor._delegate, undefined);
    assert.equal(manager.size, 0);
});

test('rolls back a delegate layer when composition throws', () => {
    const actor = {};
    const manager = new DelegateManager();
    const invalid = Object.defineProperty({}, 'acceptDrop', {
        enumerable: true,
        get() { throw new Error('delegate getter failed'); },
    });

    assert.throws(() => manager.add(actor, invalid), /delegate getter failed/);
    assert.equal(actor._delegate, undefined);
    assert.equal(manager.size, 0);

    const acceptDrop = () => true;
    const remove = manager.add(actor, {acceptDrop});
    assert.equal(actor._delegate.acceptDrop, acceptDrop);
    remove();
    assert.equal(actor._delegate, undefined);
});

test('preserves an externally replaced delegate when composing another layer', () => {
    const actor = {};
    const manager = new DelegateManager();
    const firstAction = () => 'first';
    const nextAction = () => 'next';
    const external = {externalAction: () => 'external'};

    const removeFirst = manager.add(actor, {firstAction});
    actor._delegate = external;
    const removeNext = manager.add(actor, {nextAction});

    assert.equal(actor._delegate.externalAction, external.externalAction);
    assert.equal(actor._delegate.firstAction, firstAction);
    assert.equal(actor._delegate.nextAction, nextAction);

    removeNext();
    assert.equal(actor._delegate.externalAction, external.externalAction);
    assert.equal(actor._delegate.firstAction, firstAction);
    removeFirst();
    assert.equal(actor._delegate, external);
    assert.equal(manager.size, 0);
});
