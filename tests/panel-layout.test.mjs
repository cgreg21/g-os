import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const panelSource = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
const extensionSource = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
const layoutStart = panelSource.indexOf('        _initializePanelLayout(screen) {');
const layoutEnd = panelSource.indexOf('_normalizePanelLayout(saved)', layoutStart);
const layoutSource = panelSource.slice(layoutStart, layoutEnd);

test('panel zones use expanding spacers to anchor left and right content', () => {
    assert.match(layoutSource, /const zone = new St\.BoxLayout\([\s\S]*?x_expand: true/);
    assert.match(layoutSource, /if \(group !== 'left'\)[\s\S]*?zone\.add_child\(new St\.Widget\(\{x_expand: true, y_expand: true\}\)\);[\s\S]*?zone\.add_child\(content\)/);
    assert.match(layoutSource, /if \(group !== 'right'\)[\s\S]*?zone\.add_child\(new St\.Widget\(\{x_expand: true, y_expand: true\}\)\)/);
    assert.doesNotMatch(layoutSource, /new Clutter\.BinLayout/);
});

test('panel drop zones retain drag-and-drop handlers', () => {
    assert.match(layoutSource, /handleDragOver:/);
    assert.match(layoutSource, /acceptDrop:/);
    assert.match(layoutSource, /this\._movePanelItem\(screen, itemId, group, x\)/);
});

test('the GNOME launcher participates in the same panel DND source registry', () => {
    assert.match(panelSource, /\['launcher', screen\.menuButton\.container\]/);
    assert.match(layoutSource, /for \(const \[id, actor\] of screen\.panelLayoutItems\)[\s\S]*?this\._attachPanelItemDraggable\(screen, id, actor\)/);
    assert.match(panelSource, /_attachPanelItemDraggable\(screen, id, actor\)[\s\S]*?actor\._panelLayoutItem = \{screen, id\}[\s\S]*?registerShadowDragSource\(\{/);
});

test('topbar shadow drag uses a clone and a movable insertion placeholder', async () => {
    const dragStart = panelSource.indexOf('        _attachPanelItemDraggable(screen, id, actor) {');
    const dragEnd = panelSource.indexOf('        _getPanelLayoutItem(screen, source) {', dragStart);
    const dragSource = panelSource.slice(dragStart, dragEnd);
    assert.match(dragSource, /registerShadowDragSource\(\{/);
    assert.match(dragSource, /getDragActorSource: \(\) => actor/);
    const sharedDnd = await readFile(new URL('../src/shared/interaction/shadowDragSource.ts', import.meta.url), 'utf8');
    assert.match(sharedDnd, /g-os-dnd-drag-actor/);
    assert.match(sharedDnd, /new Clutter\.Clone\(\{source: visualActor, reactive: false\}\)/);
    assert.match(sharedDnd, /getDragActorSource/);
    assert.match(sharedDnd, /originalDelegate\?\.getDragActorSource/);
    assert.match(sharedDnd, /getDragActor: \(\) => \{[\s\S]*?dragActor \?\?= createDragActor\(\);[\s\S]*?return dragActor;/);
    assert.match(sharedDnd, /dragActor = null/);
    assert.match(dragSource, /_finishPanelShadowDrag\(screen, false\)/);
    assert.match(panelSource, /_movePanelDropPlaceholder\(screen, group, x\)/);
    assert.match(panelSource, /source: dragActor\.get_child_at_index\(0\) \?\? dragActor/);
    assert.match(panelSource, /if \(!actor \|\| actor\.is_destroyed\(\) \|\| !dragActor \|\| dragActor\.is_destroyed\(\)\)/);
    assert.match(panelSource, /if \(actor\.get_parent\(\) === parent\)\s*parent\.remove_child\(actor\)/);
    assert.match(panelSource, /state\.parent && !state\.parent\.is_destroyed\(\) && !state\.actor\.get_parent\(\)/);
    assert.match(panelSource, /if \(!state\.placeholder\.is_destroyed\(\)\)\s*state\.placeholder\.destroy\(\)/);
    const stylesheet = await readFile(new URL('../stylesheet.css', import.meta.url), 'utf8');
    assert.doesNotMatch(stylesheet, /\.g-os-panel-dnd-placeholder\s*\{[^}]*?(?:background-color|border|shadow)/s);
    assert.match(panelSource, /if \(currentIndex === index\)\s*return;/);
});


test('topbar lifecycle scope owns DND signals and chrome registration', () => {
    assert.match(panelSource, /screen\.lifecycle\.chrome\?\.add\(screen\.panel, \{affectsStruts: true, trackFullscreen: true\}\)/);
    assert.match(panelSource, /registerShadowDragSource\(\{/);
    assert.match(panelSource, /onDestroy: \(\) => \{/);
    assert.match(extensionSource, /screen\.lifecycle\.add\(\(\) => screen\.interactionDnd\.destroy\(\)\)/);
    assert.match(panelSource, /screen\.lifecycle\.add\(\(\) => this\._finishPanelShadowDrag\(screen, false\)\)/);
});


test('topbar opts into the native GNOME Shell panel theme when styling is enabled', () => {
    const createPanelStart = panelSource.indexOf('        _createPanel(screen) {');
    const createPanelEnd = panelSource.indexOf('        _initializePanelLayout(screen) {', createPanelStart);
    const createPanelSource = panelSource.slice(createPanelStart, createPanelEnd);
    assert.match(createPanelSource, /if \(this\._settings\.get_boolean\('panel-style'\)\) \{[\s\S]*?add_style_class_name\('panel'\)[\s\S]*?add_style_class_name\('g-os-panel'\)/);
    assert.match(panelSource, /style_class: 'g-os-secondary-panel'/);
});
