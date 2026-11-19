import assert from 'node:assert/strict';
import test from 'node:test';
import {AnimationManager} from '../dist/core/animationManager.js';

class FakeActor {
    animations = [];
    removed = [];
    ease(params) { this.animations.push(params); }
    remove_transition(property) { this.removed.push(property); }
    complete(index = this.animations.length - 1) {
        this.animations[index]?.onComplete?.();
    }
}

const options = {durationMs: 240, mode: 1};

test('animates actors independently and releases completed animations', () => {
    const manager = new AnimationManager();
    const first = new FakeActor();
    const second = new FakeActor();
    manager.animate('first', first, {translation_x: 0, opacity: 255}, options);
    manager.animate('second', second, {translation_x: 0}, options);
    assert.equal(manager.size, 2);
    first.complete();
    assert.equal(manager.size, 1);
    second.complete();
    assert.equal(manager.size, 0);
});

test('replacing an animation cancels only its previous properties', () => {
    const manager = new AnimationManager();
    const actor = new FakeActor();
    let completed = 0;
    manager.animate('slide', actor, {translation_x: 10, translation_y: 0}, {
        ...options, onComplete: () => completed++,
    });
    const stale = actor.animations[0].onComplete;
    manager.animate('slide', actor, {translation_x: 0}, options);
    assert.deepEqual(actor.removed, ['translation-x', 'translation-y']);
    stale();
    assert.equal(manager.size, 1);
    assert.equal(completed, 0);
    actor.complete();
    assert.equal(manager.size, 0);
});

test('cancel and destroy are idempotent and reject stale callbacks', () => {
    const manager = new AnimationManager();
    const actor = new FakeActor();
    let completed = 0;
    manager.animate('fade', actor, {opacity: 0}, {
        ...options, onComplete: () => completed++,
    });
    const finish = actor.animations[0].onComplete;
    manager.cancel('fade');
    manager.cancel('fade');
    finish();
    manager.animate('late', actor, {opacity: 255}, options);
    const late = actor.animations[1].onComplete;
    manager.destroy();
    manager.destroy();
    late();
    manager.animate('ignored', actor, {opacity: 1}, options);
    assert.deepEqual(actor.removed, ['opacity', 'opacity']);
    assert.equal(completed, 0);
    assert.equal(manager.size, 0);
    assert.equal(manager.isDestroyed, true);
});

test('continues cancelling remaining properties when a disposed actor rejects one transition', () => {
    const manager = new AnimationManager();
    const removed = [];
    const logged = [];
    const previousLogError = globalThis.logError;
    globalThis.logError = (error, message) => logged.push({error, message});
    const actor = {
        ease() {},
        remove_transition(property) {
            removed.push(property);
            if (property === 'translation-x')
                throw new Error('actor already disposed');
        },
    };

    try {
        manager.animate('dock', actor, {
            translation_x: 10,
            opacity: 0,
            translation_y: 5,
        }, options);
        manager.destroy();

        assert.deepEqual(removed, ['translation-x', 'opacity', 'translation-y']);
        assert.equal(logged.length, 1);
        assert.match(logged[0].message, /translation-x/);
        assert.equal(manager.size, 0);
        assert.equal(manager.isDestroyed, true);
    } finally {
        if (previousLogError === undefined)
            delete globalThis.logError;
        else
            globalThis.logError = previousLogError;
    }
});
