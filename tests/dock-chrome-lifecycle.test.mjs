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

    assert.doesNotMatch(teardown, /Main\.layoutManager\.removeChrome\?\.\(screen\.(?:edge|dockContainer|tooltip)\)/);
    assert.match(teardown, /screen\.lifecycle\.destroy\(\)/);
});

const dockVisibilitySource = await readFile(new URL('../src/dock/dockVisibility.ts', import.meta.url), 'utf8');

test('dock reservation uses the lifecycle manager while preserving its stacking order', () => {
    assert.match(dockVisibilitySource, /screen\.lifecycle\.chrome\?\.add\(reservation, \{affectsStruts: true, trackFullscreen: true\}\)/);
    assert.match(dockVisibilitySource, /screen\.lifecycle\.chrome\?\.remove\(reservation\)/);
    assert.match(dockVisibilitySource, /Main\.layoutManager\.uiGroup\.set_child_below_sibling\(reservation, screen\.dockContainer\)/);
});
