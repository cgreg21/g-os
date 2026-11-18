import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const extensionSource = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');

test('dock chrome actors are registered with the per-screen chrome manager', () => {
    assert.match(extensionSource, /screen\.lifecycle\.chrome\?\.add\(screen\.dockContainer, \{trackFullscreen: true\}\)/);
    assert.match(extensionSource, /screen\.lifecycle\.chrome\?\.add\(screen\.edge, \{trackFullscreen: true\}\)/);
    assert.match(extensionSource, /screen\.lifecycle\.chrome\?\.add\(screen\.tooltip\)/);
});

test('tooltip keeps top-chrome registration semantics through the manager', () => {
    assert.match(extensionSource, /actor === topChromeActor[\s\S]*?Main\.layoutManager\.addTopChrome\(actor, options\)/);
    assert.match(extensionSource, /topChromeActor = screen\.tooltip/);
});

test('dock chrome actors are no longer removed manually during screen teardown', () => {
    const teardownStart = extensionSource.indexOf('        _destroyScreens() {');
    const teardownEnd = extensionSource.indexOf('        _updateWindowButtons()', teardownStart);
    const teardown = extensionSource.slice(teardownStart, teardownEnd);

    assert.doesNotMatch(teardown, /Main\.layoutManager\.removeChrome\?\.\(screen\.(?:edge|dockContainer|tooltip|dockReservation)\)/);
    assert.match(teardown, /screen\.lifecycle\.destroy\(\)/);
});

const dockVisibilitySource = await readFile(new URL('../src/dock/dockVisibility.ts', import.meta.url), 'utf8');

test('dock reservation uses the lifecycle manager while preserving its stacking order', () => {
    assert.match(dockVisibilitySource, /screen\.lifecycle\.chrome\?\.add\(reservation, \{affectsStruts: true, trackFullscreen: true\}\)/);
    assert.match(dockVisibilitySource, /screen\.lifecycle\.chrome\?\.remove\(reservation\)/);
    assert.match(dockVisibilitySource, /Main\.layoutManager\.uiGroup\.set_child_below_sibling\(reservation, screen\.dockContainer\)/);
});

test('dock actor hover signals are owned by the screen lifecycle', () => {
    assert.match(extensionSource, /screen\.lifecycle\.addSignal\(screen\.dockContainer,[\s\S]*?notify::hover/);
    assert.match(extensionSource, /screen\.lifecycle\.addSignal\(screen\.edge,[\s\S]*?notify::hover/);
});

test('dock adjustment signals are replaceable and released by the screen lifecycle', () => {
    assert.match(extensionSource, /dockAdjustmentCleanup: CleanupManager/);
    assert.match(extensionSource, /screen\.lifecycle\.add\(\(\) => screen\.dockAdjustmentCleanup\.clear\(\)\)/);
    assert.match(extensionSource, /screen\.dockAdjustmentCleanup\.clear\(\);[\s\S]*?screen\.dockAdjustmentCleanup = new CleanupManager\(\)/);
    assert.match(extensionSource, /screen\.dockAdjustmentCleanup\.addSignal\(adjustment/);
    assert.doesNotMatch(extensionSource, /dockAdjustmentSignals/);
});

const dockAppearanceSource = await readFile(new URL('../src/dock/dockAppearance.ts', import.meta.url), 'utf8');

test('dock keyboard controller signal is owned by the screen lifecycle', () => {
    assert.match(extensionSource, /screen\.lifecycle\.addSignal\(screen\.dockKeyController,[\s\S]*?key-press/);
});

test('dock appearance screen signals are owned by the screen lifecycle', () => {
    assert.match(dockAppearanceSource, /screen\.lifecycle\.addSignal\(screen\.dockContainer,[\s\S]*?notify::allocation/);
    assert.match(dockAppearanceSource, /screen\.lifecycle\.addSignal\(screen\.dock,[\s\S]*?notify::allocation/);
    assert.match(dockAppearanceSource, /screen\.lifecycle\.addSignal\(screen\.tooltip, screen\.tooltipMeasureSignal\)/);
});

test('dock magnification releases settings signals and pending work through the screen lifecycle', () => {
    assert.match(dockAppearanceSource, /screen\.lifecycle\.addSignal\(motion, signal\)/);
    assert.match(dockAppearanceSource, /screen\.lifecycle\.add\(\(\) => \{[\s\S]*?laters\.remove\(screen\.magnificationUpdateSource\)/);
    assert.doesNotMatch(dockAppearanceSource, /screen\.dockContainer\.connect\('destroy'/);
});

test('magnification background is registered through the chrome manager', () => {
    assert.match(dockAppearanceSource, /screen\.lifecycle\.chrome\?\.add\(screen\.magnificationBackground, \{trackFullscreen: true\}\)/);
    assert.doesNotMatch(dockAppearanceSource, /Main\.layoutManager\.addChrome\(screen\.magnificationBackground/);
});
