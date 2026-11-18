import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const panelSource = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
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

test('topbar shadow drag uses a clone and a movable insertion placeholder', () => {
    const dragStart = panelSource.indexOf('        _attachPanelItemDraggable(screen, id, actor) {');
    const dragEnd = panelSource.indexOf('        _getPanelLayoutItem(screen, source) {', dragStart);
    const dragSource = panelSource.slice(dragStart, dragEnd);
    assert.match(dragSource, /getDragActor = \(\) => new Clutter\.Clone\(\{source: actor\}\)/);
    assert.match(dragSource, /_beginPanelShadowDrag\(screen, id, actor\)/);
    assert.match(dragSource, /_finishPanelShadowDrag\(screen, false\)/);
    assert.match(panelSource, /_movePanelDropPlaceholder\(screen, group, x\)/);
    assert.match(panelSource, /g-os-panel-dnd-placeholder/);
});


test('topbar lifecycle scope owns DND signals and chrome registration', () => {
    assert.match(panelSource, /screen\.lifecycle\.chrome\?\.add\(screen\.panel, \{affectsStruts: true, trackFullscreen: true\}\)/);
    assert.match(panelSource, /screen\.lifecycle\.addSignal\(actor\._panelLayoutDraggable/);
    assert.match(panelSource, /screen\.lifecycle\.addSignal\(actor, actor\.connect\('destroy'/);
    assert.match(panelSource, /screen\.lifecycle\.add\(\(\) => this\._finishPanelShadowDrag\(screen, false\)\)/);
});
