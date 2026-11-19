import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const extensionSource = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');

test('dock chrome actors are registered with the per-screen chrome manager', () => {
    assert.match(extensionSource, /screen\.lifecycle\.chrome\?\.add\(screen\.dockContainer, \{trackFullscreen: true\}\)/);
    assert.match(extensionSource, /screen\.lifecycle\.chrome\?\.add\(screen\.edge, \{trackFullscreen: true\}\)/);
    assert.match(extensionSource, /screen\.lifecycle\.chrome\?\.add\(screen\.tooltip\)/);
});

test('dock scroll view is staged before its content is attached', () => {
    const construction = extensionSource.indexOf('screen.dockContainer = new St.ScrollView({');
    const registration = extensionSource.indexOf('screen.lifecycle.chrome?.add(screen.dockContainer, {trackFullscreen: true});', construction);
    const attachContent = extensionSource.indexOf('screen.dockContainer.set_child(dockContent);', registration);

    assert.ok(construction >= 0);
    assert.ok(registration > construction);
    assert.ok(attachContent > registration);
    assert.doesNotMatch(extensionSource.slice(construction, registration), /child:\s*dockContent/);
});

test('monitor changes defer screen teardown until Mutter finishes its layout pass', () => {
    assert.match(extensionSource, /monitors-changed', \(\) => this\._queueSettingsApply\(\)\)/);
});

test('tooltip keeps top-chrome registration semantics through the manager', () => {
    assert.match(extensionSource, /actor === topChromeActor[\s\S]*?Main\.layoutManager\.addTopChrome\(actor, options\)/);
    assert.match(extensionSource, /topChromeActor = screen\.tooltip/);
});

test('dock chrome actors are no longer removed manually during screen teardown', () => {
    const teardownStart = extensionSource.indexOf('        _destroyScreens() {');
    const teardownEnd = extensionSource.indexOf('        _updateWindowButtons()', teardownStart);
    const teardown = extensionSource.slice(teardownStart, teardownEnd);

    assert.doesNotMatch(teardown, /Main\.layoutManager\.removeChrome\?\.\(screen\.(?:edge|dockContainer|tooltip|dockReservation|magnificationBackground)\)/);
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


const panelSourceMappedAttachment = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
const globalMenuSourceMappedAttachment = await readFile(new URL('../src/panel/globalMenu.ts', import.meta.url), 'utf8');
const desktopIconsSourceMappedAttachment = await readFile(new URL('../src/desktop/desktopIcons.ts', import.meta.url), 'utf8');
const widgetRuntimeSourceMappedAttachment = await readFile(new URL('../src/widgets/widgetRuntime.ts', import.meta.url), 'utf8');
const windowPreviewsSourceMappedAttachment = await readFile(new URL('../src/dock/windowPreviews.ts', import.meta.url), 'utf8');

test('panel notification scroll view is parented before its content is attached', () => {
    assert.match(panelSourceMappedAttachment, /menu\._boxPointer\.bin\.set_child\(scroll\);[\s\S]*?scroll\.set_child\(menu\.box\)/);
});

test('calendar scroll view is parented into the staged menu before its content is attached', () => {
    assert.match(panelSourceMappedAttachment, /content\.add_child\(scroll\);[\s\S]*?menu\.box\.add_child\(content\);[\s\S]*?scroll\.set_child\(screen\.calendarEventList\)/);
});

test('global menu scroll view is staged before its content is attached', () => {
    assert.match(globalMenuSourceMappedAttachment, /this\.uiGroup\.add_child\(menu\.actor\);[\s\S]*?menu\._boxPointer\.bin\.set_child\(scrollView\);[\s\S]*?scrollView\.set_child\(menu\.box\)/);
});

test('desktop icon scroll view is parented before its content is attached', () => {
    assert.match(desktopIconsSourceMappedAttachment, /parent\.add_child\(scroll\);[\s\S]*?scroll\.set_child\(content\)/);
});

test('widget list scroll view waits until it is mapped before attaching content', () => {
    assert.match(widgetRuntimeSourceMappedAttachment, /actor\.connect\('notify::mapped', attachContent\)/);
    assert.match(widgetRuntimeSourceMappedAttachment, /if \(!actor\.is_mapped\(\)\)[\s\S]*?actor\.set_child\(content\)/);
});

test('window preview scroll view is inserted into the staged menu before attaching content', () => {
    assert.match(windowPreviewsSourceMappedAttachment, /item\.add_child\(scroll\);[\s\S]*?this\.menu\.addMenuItem\(item\);[\s\S]*?scroll\.set_child\(box\)/);
});


const actorUtilsSourceMappedAttachment = await readFile(new URL('../src/core/actorUtils.ts', import.meta.url), 'utf8');
const panelSourceMappedAttachment = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
const globalMenuSourceMappedAttachment = await readFile(new URL('../src/panel/globalMenu.ts', import.meta.url), 'utf8');
const windowPreviewsSourceMappedAttachment = await readFile(new URL('../src/dock/windowPreviews.ts', import.meta.url), 'utf8');
const desktopIconsSourceMappedAttachment = await readFile(new URL('../src/desktop/desktopIcons.ts', import.meta.url), 'utf8');
const widgetRuntimeSourceMappedAttachment = await readFile(new URL('../src/widgets/widgetRuntime.ts', import.meta.url), 'utf8');

test('scroll view content is attached only after the actor is mapped on stage', () => {
    assert.match(actorUtilsSourceMappedAttachment, /if \(!actor\.is_mapped\(\)\)[\s\S]*?actor\.set_child\(child\)/);
    assert.match(actorUtilsSourceMappedAttachment, /actor\.connect\('notify::mapped', attach\)/);
    assert.match(panelSourceMappedAttachment, /setChildWhenMapped\(scroll, menu\.box\)/);
    assert.match(panelSourceMappedAttachment, /setChildWhenMapped\(scroll, screen\.calendarEventList\)/);
    assert.match(globalMenuSourceMappedAttachment, /setChildWhenMapped\(scrollView, menu\.box\)/);
    assert.match(windowPreviewsSourceMappedAttachment, /setChildWhenMapped\(scroll, box\)/);
    assert.match(desktopIconsSourceMappedAttachment, /setChildWhenMapped\(scroll, content\)/);
    assert.match(widgetRuntimeSourceMappedAttachment, /setChildWhenMapped\(actor, content\)/);
});
