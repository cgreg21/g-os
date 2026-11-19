import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/shared/interaction/dragAndDrop.ts', import.meta.url), 'utf8');

test('generic DND controller registers sources through GNOME Shell makeDraggable', () => {
    assert.match(source, /DND\.makeDraggable\(actor/);
    assert.match(source, /drag-begin/);
    assert.match(source, /drag-end/);
    assert.match(source, /drag-cancelled/);
    assert.match(source, /onMotion\?: \(event: any\) => void/);
    assert.match(source, /DND\.addDragMonitor\(dragMonitor\)/);
    assert.match(source, /DND\.removeDragMonitor\(monitor\)/);
    assert.match(source, /callbacks\.onMotion\?\.\(event\)/);
});

test('generic DND controller composes source and target delegates through the shared manager', () => {
    assert.match(source, /this\.delegates\.add\(actor, delegate\)/);
    assert.match(source, /new DelegateManager<DelegateActor>\(\)/);
});

test('generic DND controller registers drop targets independently of feature policies', () => {
    assert.match(source, /registerTarget\(/);
    assert.match(source, /handleDragOver\?/);
    assert.match(source, /acceptDrop\?/);
    assert.doesNotMatch(source, /isFavorite|onCreateFolder|insertionIndex|removalZone/);
});

test('generic DND registrations are idempotently disposable and lifecycle-aware', () => {
    assert.match(source, /lifecycle\?\.add\(dispose\)/);
    assert.match(source, /if \(disposed\)\s*return/);
    assert.match(source, /destroy\(\): void/);
    assert.match(source, /this\.sources\.clear\(\)/);
    assert.match(source, /this\.targets\.clear\(\)/);
});

const panelSource = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');

test('topbar registers its existing drop zones with the shared controller', () => {
    assert.match(panelSource, /interactionDnd\.registerTarget\(zone/);
    assert.doesNotMatch(panelSource, /zone\._delegate = \{/);
});

test('shadow drag source memoizes the exact actor requested by GNOME Shell', async () => {
    const shadowSource = await readFile(new URL('../src/shared/interaction/shadowDragSource.ts', import.meta.url), 'utf8');
    assert.match(shadowSource, /getDragActor: \(\) => \{[\s\S]*?dragActor \?\?= createDragActor\(\);[\s\S]*?return dragActor;/);
    assert.match(shadowSource, /onBegin: \(\) => \{[\s\S]*?dragActor \?\?= createDragActor\(\);[\s\S]*?onDragActor\?\.\(dragActor\);/);
    assert.doesNotMatch(shadowSource, /getDragActor: \(\) => dragActor \?\? createDragActor\(\)/);
});

test('topbar uses the shared controller while preserving shadow drag callbacks', () => {
    assert.match(panelSource, /registerShadowDragSource\(\{/);
    assert.match(panelSource, /getDragActorSource: \(\) => actor/);
    assert.match(panelSource, /registerShadowDragSource\(\{/);
    assert.match(panelSource, /onDragActor: dragActor => this\._beginPanelShadowDrag\(screen, id, actor, dragActor\)/);
    assert.match(panelSource, /source: dragActor\.get_child_at_index\(0\) \?\? dragActor/);
    assert.match(panelSource, /onEnd: success => this\._finishPanelShadowDrag/);
    assert.match(panelSource, /onCancelled: \(\) => this\._finishPanelShadowDrag\(screen, false\)/);
    assert.match(panelSource, /onDestroy: \(\) => \{/);
    assert.doesNotMatch(panelSource, /DND\.makeDraggable\(actor/);
});

const extensionSource = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
test('topbar and dock share the lifecycle-owned per-screen controller', () => {
    assert.match(extensionSource, /interactionDnd: new DragAndDropController\(\)/);
    assert.match(extensionSource, /screen\.lifecycle\.add\(\(\) => screen\.interactionDnd\.destroy\(\)\)/);
});

test('generic DND cleanup continues when Shell teardown rejects signal or monitor removal', () => {
    assert.match(source, /DND\.removeDragMonitor\(monitor\)/);
    assert.match(source, /disconnectIfConnected\(draggable, signalId\)/);
    assert.match(source, /disconnectIfConnected\(actor, actorDestroySignal\)/);
    assert.match(source, /emitter instanceof GObject\.Object && !GObject\.signal_handler_is_connected\(emitter, id\)/);
    assert.match(source, /actorDestroySignal = 0;[\s\S]*?callbacks\.onDestroy\?\.\(\)[\s\S]*?dispose\(\)/);
    assert.match(source, /actorDestroySignal = 0;[\s\S]*?dispose\(\);[\s\S]*?this\.targets\.set/);
});

test('generic DND source setup rolls back partially acquired resources', () => {
    assert.match(source, /const signalIds: number\[\] = \[\]/);
    assert.match(source, /signalIds\.push\(draggable\.connect/);
    assert.match(source, /catch \(error\) \{\s*\/\/ Signal setup can fail part-way through[\s\S]*?dispose\(\);\s*throw error;/);
    assert.match(source, /catch \(error\) \{\s*removeDelegate\(\);\s*throw error;/);
});

test('generic DND target setup restores the previous delegate when signal registration fails', () => {
    assert.match(source, /try \{\s*actorDestroySignal = actor\.connect\('destroy', dispose\);\s*this\.targets\.set\(actor, dispose\);[\s\S]*?catch \(error\) \{\s*\/\/ Restore the previous delegate[\s\S]*?dispose\(\);\s*throw error;/);
});

test('drag callbacks stop immediately when begin re-enters source disposal', () => {
    assert.match(source, /if \(disposed\)\s*return;\s*callbacks\.onBegin\?\.\(\);/);
    assert.match(source, /if \(disposed \|\| !callbacks\.onMotion\)\s*return;/);
    assert.match(source, /if \(!disposed\)\s*callbacks\.onMotion\?\.\(event\)/);
    assert.match(source, /if \(disposed\)\s*return;\s*removeDragMonitor\(\);\s*callbacks\.onEnd/);
});

test('generic DND cleanup isolates host logger failures', () => {
    assert.match(source, /function logCleanupError\(error: unknown, message: string\): void/);
    assert.match(source, /catch \{\s*\/\/ Logging must never interrupt release of the remaining DND resources\./);
    assert.equal((source.match(/logCleanupError\(error,/g) ?? []).length, 4);
    assert.doesNotMatch(source, /logError\(error as Error, 'Unable to (?:remove g-os drag monitor|disconnect g-os)/);
});
