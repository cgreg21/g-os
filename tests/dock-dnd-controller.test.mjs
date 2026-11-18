import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const extensionSource = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
const dockOrderSource = await readFile(new URL('../src/dock/dockOrder.ts', import.meta.url), 'utf8');
const dockFoldersSource = await readFile(new URL('../src/dock/dockFolders.ts', import.meta.url), 'utf8');

test('each screen owns and destroys one shared interaction controller', () => {
    assert.match(extensionSource, /interactionDnd: new DragAndDropController\(\)/);
    assert.match(extensionSource, /screen\.lifecycle\.add\(\(\) => screen\.interactionDnd\.destroy\(\)\)/);
});

test('application grouping targets are registered with the shared controller', () => {
    assert.match(dockOrderSource, /screen\.interactionDnd\.registerTarget\(button,[\s\S]*?handleDragOver:[\s\S]*?acceptDrop:/);
    assert.doesNotMatch(dockOrderSource, /button\._delegate\.handleDragOver\s*=/);
    assert.doesNotMatch(dockOrderSource, /button\._delegate\.acceptDrop\s*=/);
});

test('dock-level drop target uses shared lifecycle ownership', () => {
    assert.match(dockOrderSource, /screen\.interactionDnd\.registerTarget\(screen\.dock,[\s\S]*?screen\.lifecycle\)/);
    assert.doesNotMatch(dockOrderSource, /screen\.dock\._delegate = \{/);
});

test('folder application drags use shared source registration when a screen exists', () => {
    assert.match(dockFoldersSource, /screen\.interactionDnd\.registerSource\(item, delegate/);
    assert.match(dockFoldersSource, /onBegin: \(\) => menu\.close\(\)/);
    assert.match(dockFoldersSource, /\}, \{\}, screen\.lifecycle\)/);
    assert.doesNotMatch(dockFoldersSource, /this\._makeDraggable\(/);
});

const dragAndDropSource = await readFile(new URL('../src/shared/interaction/dragAndDrop.ts', import.meta.url), 'utf8');

test('dock reorder uses shared source registration and generic pointer motion', () => {
    assert.match(dockOrderSource, /screen\.interactionDnd\.registerSource\(button, \{\}, \{/);
    assert.match(dockOrderSource, /onMotion: event => \{/);
    assert.match(dockOrderSource, /onCancelled: \(\) => \{ cancelled = true; \}/);
    assert.match(dockOrderSource, /onEnd: \(\) => finish\(cancelled\)/);
    assert.match(dockOrderSource, /screen\.lifecycle\.add\(\(\) => \{\s*if \(screen\.reorder\?\.button === button\)\s*finish\(true\)/);
    assert.doesNotMatch(dockOrderSource, /this\._makeDraggable\(button/);
    assert.match(dragAndDropSource, /DND\.addDragMonitor\(dragMonitor\)/);
});

const panelSource = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
test('panel and dock share the per-screen interaction controller', () => {
    assert.match(panelSource, /screen\.interactionDnd\.registerTarget\(zone/);
    assert.match(panelSource, /screen\.interactionDnd\.registerSource\(actor/);
    assert.doesNotMatch(panelSource, /new DragAndDropController/);
    assert.doesNotMatch(panelSource, /panelLayoutDnd/);
});

const desktopWidgetsSource = await readFile(new URL('../src/desktop/desktopWidgets.ts', import.meta.url), 'utf8');
const desktopIconsSource = await readFile(new URL('../src/desktop/desktopIcons.ts', import.meta.url), 'utf8');

test('desktop widgets use the per-screen shared DND controller', () => {
    assert.match(desktopWidgetsSource, /screen\.interactionDnd\.registerSource\(widget\.dragHandle \?\? widget/);
    assert.match(desktopWidgetsSource, /onMotion: event => \{/);
    assert.match(desktopWidgetsSource, /screen\.lifecycle\.add\(restore\)/);
    assert.doesNotMatch(desktopWidgetsSource, /DND\.makeDraggable|_makeDraggable\(/);
});

test('desktop icons use the per-screen shared DND controller', () => {
    assert.match(desktopIconsSource, /screen\.interactionDnd\.registerSource\(button/);
    assert.match(desktopIconsSource, /onCancelled: \(\) => finish\(true\)/);
    assert.match(desktopIconsSource, /onEnd: \(\) => finish\(false\)/);
    assert.match(desktopIconsSource, /screen\.lifecycle\.add\(\(\) => finish\(true\)\)/);
    assert.doesNotMatch(desktopIconsSource, /DND\.makeDraggable/);
});

test('the shared controller is the only GNOME makeDraggable integration', () => {
    assert.match(dragAndDropSource, /DND\.makeDraggable\(actor/);
    assert.doesNotMatch(dockOrderSource, /DND\.makeDraggable|_makeDraggable\(/);
    assert.doesNotMatch(dockFoldersSource, /DND\.makeDraggable|_makeDraggable\(/);
    assert.doesNotMatch(desktopWidgetsSource, /DND\.makeDraggable|_makeDraggable\(/);
    assert.doesNotMatch(desktopIconsSource, /DND\.makeDraggable/);
    assert.doesNotMatch(panelSource, /DND\.makeDraggable/);
});

test('dock reorder transitions are owned by the screen animation manager', () => {
    assert.match(dockOrderSource, /screen\.lifecycle\.animations\.animate\(/);
    assert.match(dockOrderSource, /screen\.lifecycle\.animations\.cancel\(/);
    assert.match(dockOrderSource, /dock-reorder:/);
    assert.match(dockOrderSource, /screen\.lifecycle\.addSignal\(button, button\.connect\('destroy'/);
    assert.doesNotMatch(dockOrderSource, /candidate\.ease\(\{/);
});
