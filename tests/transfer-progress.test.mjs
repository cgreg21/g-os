import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveActiveTransfers} from '../dist/dock/transferProgress.js';

test('transfer aggregation ignores entries that are not visible', () => {
    const active = resolveActiveTransfers([new Map([
        ['hidden.desktop', {progress: 0.4, visible: false, revision: 1}],
    ])]);
    assert.equal(active.size, 0);
});

test('transfer aggregation keeps the newest visible report for each application', () => {
    const older = {progress: 0.25, visible: true, revision: 2};
    const newer = {progress: 0.8, visible: true, revision: 5};
    const other = {progress: 0.5, visible: true, revision: 3};
    const active = resolveActiveTransfers([
        new Map([['editor.desktop', older], ['browser.desktop', other]]),
        new Map([['editor.desktop', newer]]),
    ]);
    assert.equal(active.size, 2);
    assert.equal(active.get('editor.desktop'), newer);
    assert.equal(active.get('browser.desktop'), other);
});

test('a newer hidden report does not replace another sender active report', () => {
    const activeReport = {progress: 0.6, visible: true, revision: 4};
    const hiddenReport = {progress: 0.6, visible: false, revision: 8};
    const active = resolveActiveTransfers([
        new Map([['editor.desktop', activeReport]]),
        new Map([['editor.desktop', hiddenReport]]),
    ]);
    assert.equal(active.get('editor.desktop'), activeReport);
});

test('transfer aggregation does not mutate sender-owned maps or entries', () => {
    const entry = {progress: 1.4, visible: true, revision: 1};
    const source = new Map([['editor.desktop', entry]]);
    const active = resolveActiveTransfers([source]);
    assert.deepEqual([...source], [['editor.desktop', entry]]);
    assert.equal(entry.progress, 1.4);
    assert.equal(active.get('editor.desktop'), entry);
});
