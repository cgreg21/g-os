import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const extensionSource = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
const dockOrderSource = await readFile(new URL('../src/dock/dockOrder.ts', import.meta.url), 'utf8');
const dockFoldersSource = await readFile(new URL('../src/dock/dockFolders.ts', import.meta.url), 'utf8');

const dockItemSource = await readFile(new URL('../src/dock/dockItem.ts', import.meta.url), 'utf8');

test('dock items own shared menu, tooltip and DND integration', () => {
    assert.match(dockItemSource, /bindContextMenu\\(menu: any, Clutter: any\\)/);
    assert.match(dockItemSource, /registerDragSource\\(/);
    assert.match(dockItemSource, /registerDropTarget\\(/);
    assert.match(dockItemSource, /registerShadowDragSource\\(/);
    assert.match(dockItemSource, /screen\\.lifecycle\\?\\.add\\(\\(\\) => this\\.dispose\\(\\)\\)/);
});

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
    assert.match(dockFoldersSource, /registerShadowDragSource\(\{/);
    assert.match(dockFoldersSource, /onBegin: \(\) => menu\.close\(\)/);
    assert.match(dockFoldersSource, /lifecycle: screen\.lifecycle/);
    assert.doesNotMatch(dockFoldersSource, /this\._makeDraggable\(/);
});

const dragAndDropSource = await readFile(new URL('../src/shared/interaction/dragAndDrop.ts', import.meta.url), 'utf8');

test('dock reorder uses shared source registration and generic pointer motion', () => {
    assert.match(dockOrderSource, /registerShadowDragSource\(\{[\s\S]*?actor: button[\s\S]*?callbacks: \{/);
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
    assert.match(panelSource, /registerShadowDragSource\(\{/);
    assert.doesNotMatch(panelSource, /new DragAndDropController/);
    assert.doesNotMatch(panelSource, /panelLayoutDnd/);
});

const desktopWidgetsSource = await readFile(new URL('../src/desktop/desktopWidgets.ts', import.meta.url), 'utf8');
const widgetRuntimeSource = await readFile(new URL('../src/widgets/widgetRuntime.ts', import.meta.url), 'utf8');
const desktopIconsSource = await readFile(new URL('../src/desktop/desktopIcons.ts', import.meta.url), 'utf8');

test('desktop widgets use the per-screen shared DND controller', () => {
    assert.match(desktopWidgetsSource, /registerShadowDragSource\(\{[\s\S]*?actor: widget\.dragHandle \?\? widget[\s\S]*?visualActor: widget/);
    assert.match(desktopWidgetsSource, /onMotion: event => \{/);
    assert.match(desktopWidgetsSource, /screen\.lifecycle\.add\(restore\)/);
    assert.doesNotMatch(desktopWidgetsSource, /DND\.makeDraggable|_makeDraggable\(/);
});

test('widget grid dragging uses the shared shadow source and per-screen lifecycle', () => {
    assert.match(widgetRuntimeSource, /registerShadowDragSource\(\{[\s\S]*?controller: screen\.interactionDnd[\s\S]*?visualActor: actor/);
    assert.match(widgetRuntimeSource, /onMotion: event => \{/);
    assert.match(widgetRuntimeSource, /screen\.lifecycle\.add\(\(\) => finish\(true\)\)/);
    assert.doesNotMatch(widgetRuntimeSource, /_makeDraggable\(|DND\.makeDraggable/);
    assert.match(widgetRuntimeSource, /new DelegateManager\(\)/);
    assert.match(widgetRuntimeSource, /dropTargetDelegates\.add\(actor/);
    assert.doesNotMatch(widgetRuntimeSource, /actor\._delegate = delegate/);
});

test('desktop icons use the per-screen shared DND controller', () => {
    assert.match(desktopIconsSource, /registerShadowDragSource\(\{[\s\S]*?actor: button/);
    assert.match(desktopIconsSource, /onCancelled: \(\) => finish\(true\)/);
    assert.match(desktopIconsSource, /onEnd: \(\) => finish\(false\)/);
    assert.match(desktopIconsSource, /screen\.lifecycle\.add\(\(\) => finish\(true\)\)/);
    assert.doesNotMatch(desktopIconsSource, /DND\.makeDraggable/);
    assert.doesNotMatch(widgetRuntimeSource, /_makeDraggable\(/);
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
    assert.match(dockOrderSource, /button\.connect\('destroy', \(\) => screen\.lifecycle\.animations\.cancel\(animationKey\)\)/);
    assert.match(dockOrderSource, /button owns this one-shot destroy handler/i);
    assert.doesNotMatch(dockOrderSource, /candidate\.ease\(\{/);
});


test('drag actor visuals are created only by the shared shadow source', async () => {
    const featureSources = [extensionSource, panelSource, dockOrderSource, dockFoldersSource,
        desktopIconsSource, desktopWidgetsSource, widgetRuntimeSource];
    for (const source of featureSources) {
        assert.doesNotMatch(source, /getDragActor\s*:/);
        assert.doesNotMatch(source, /interactionDnd\.registerSource\(/);
    }
    const sharedDndSource = await readFile(new URL('../src/shared/interaction/shadowDragSource.ts', import.meta.url), 'utf8');
    assert.match(sharedDndSource, /getDragActor: \(\) => \{[\s\S]*?dragActor \?\?= createDragActor\(\);[\s\S]*?return dragActor;/);
    assert.match(dragAndDropSource, /DND\.makeDraggable\(actor/);
});
