import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const extensionSource = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
const dockOrderSource = await readFile(new URL('../src/dock/dockOrder.ts', import.meta.url), 'utf8');
const dockFoldersSource = await readFile(new URL('../src/dock/dockFolders.ts', import.meta.url), 'utf8');

test('each screen owns and destroys a shared dock DND controller', () => {
    assert.match(extensionSource, /dockDnd: new DragAndDropController\(\)/);
    assert.match(extensionSource, /screen\.lifecycle\.add\(\(\) => screen\.dockDnd\.destroy\(\)\)/);
});

test('application grouping targets are registered with the shared controller', () => {
    assert.match(dockOrderSource, /screen\.dockDnd\.registerTarget\(button,[\s\S]*?handleDragOver:[\s\S]*?acceptDrop:/);
    assert.doesNotMatch(dockOrderSource, /button\._delegate\.handleDragOver\s*=/);
    assert.doesNotMatch(dockOrderSource, /button\._delegate\.acceptDrop\s*=/);
});

test('dock-level drop target uses shared lifecycle ownership', () => {
    assert.match(dockOrderSource, /screen\.dockDnd\.registerTarget\(screen\.dock,[\s\S]*?screen\.lifecycle\)/);
    assert.doesNotMatch(dockOrderSource, /screen\.dock\._delegate = \{/);
});

test('folder application drags use shared source registration when a screen exists', () => {
    assert.match(dockFoldersSource, /screen\.dockDnd\.registerSource\(item, delegate/);
    assert.match(dockFoldersSource, /onBegin: \(\) => menu\.close\(\)/);
    assert.match(dockFoldersSource, /\}, \{\}, screen\.lifecycle\)/);
});
