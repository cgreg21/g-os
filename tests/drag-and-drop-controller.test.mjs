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
    assert.match(source, /DND\.removeDragMonitor\(dragMonitor\)/);
    assert.match(source, /callbacks\.onMotion\?\.\(event\)/);
});

test('generic DND controller composes delegates without discarding existing behavior', () => {
    assert.match(source, /Object\.create\(previousDelegate \?\? null\)/);
    assert.match(source, /actor\._delegate = composedDelegate/);
    assert.match(source, /actor\._delegate === composedDelegate/);
    assert.match(source, /actor\._delegate = previousDelegate/);
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

test('topbar uses the shared controller while preserving shadow drag callbacks', () => {
    assert.match(panelSource, /interactionDnd\.registerSource\(actor/);
    assert.match(panelSource, /getDragActorSource: \(\) => screen\.panelDragState\?\.actor === actor/);
    assert.match(panelSource, /onBegin: \(\) => this\._beginPanelShadowDrag/);
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
    assert.match(source, /const monitor = dragMonitor;\s*dragMonitor = null;\s*try \{\s*DND\.removeDragMonitor\(monitor\)/);
    assert.match(source, /try \{\s*draggable\.disconnect\(signalId\);\s*\} catch/);
    assert.match(source, /try \{\s*actor\.disconnect\(actorDestroySignal\);\s*\} catch/);
});
