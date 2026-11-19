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
    assert.match(panelSource, /function getActorParent\(actor\)[\s\S]*?actor\?\.get_parent\?\.\(\) \?\? null[\s\S]*?catch/);
    assert.doesNotMatch(panelSource, /\.is_destroyed\(\)/);
    assert.match(panelSource, /if \(getActorParent\(actor\) === parent\)\s*parent\.remove_child\(actor\)/);
    assert.match(panelSource, /if \(!success && !getActorParent\(state\.actor\)\)/);
    assert.match(panelSource, /state\.placeholder\.destroy\(\)/);
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


test('the topbar adopts native GNOME panel controls and restores their original parents', () => {
    assert.match(panelSource, /_adoptNativePanelItems\(screen\)[\s\S]*?\['activities', 'activities'\][\s\S]*?\['quick-settings', 'quickSettings'\][\s\S]*?\['accessibility', 'a11y'\][\s\S]*?\['keyboard', 'keyboard'\][\s\S]*?\['dwell-click', 'dwellClick'\][\s\S]*?\['screen-recording', 'screenRecording'\][\s\S]*?\['screen-sharing', 'screenSharing'\]/);
    assert.match(panelSource, /Main\.sessionMode\.currentMode !== 'user'/);
    assert.match(panelSource, /const availableRoles = new Set<string>\([\s\S]*?sessionPanel\.left[\s\S]*?sessionPanel\.right[\s\S]*?if \(!availableRoles\.has\(role\)\)/);
    assert.match(panelSource, /_syncNativePanelItems\(screen\)[\s\S]*?this\._restoreNativePanelItems\(screen\)[\s\S]*?this\._adoptNativePanelItems\(screen\)[\s\S]*?this\._applyPanelLayout\(screen\)/);
    assert.match(extensionSource, /this\._connect\(Main\.sessionMode, 'updated'/);
    assert.match(panelSource, /_restoreNativePanelItems\(screen\)[\s\S]*?parent\.insert_child_at_index\(actor, Math\.min\(index, parent\.get_n_children\(\)\)\)/);
    assert.match(panelSource, /\.\.\.\[\.\.\.\(screen\.nativePanelItems \?\? new Map\(\)\)\]\.map\(\(\[id, state\]\) => \[id, state\.actor\]\)/);
    assert.match(extensionSource, /this\._restoreNativePanelItems\?\.\(screen\)/);
});

test('native GNOME panel controls are part of the default draggable layout', () => {
    for (const id of ['activities', 'quick-settings', 'accessibility', 'keyboard',
        'dwell-click', 'screen-recording', 'screen-sharing']) {
        assert.match(panelSource, new RegExp('(?:left|right):' + id));
    }
});

test('topbar opts into the native GNOME Shell panel theme when styling is enabled', () => {
    const createPanelStart = panelSource.indexOf('        _createPanel(screen) {');
    const createPanelEnd = panelSource.indexOf('        _initializePanelLayout(screen) {', createPanelStart);
    const createPanelSource = panelSource.slice(createPanelStart, createPanelEnd);
    assert.match(createPanelSource, /if \(this\._settings\.get_boolean\('panel-style'\)\) \{[\s\S]*?add_style_class_name\('panel'\)[\s\S]*?add_style_class_name\('g-os-panel'\)/);
    assert.match(panelSource, /style_class: 'g-os-secondary-panel'/);
});


test('panel actor cleanup verifies the current parent before removing children', async () => {
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    assert.match(panel, /function removeActorFromParent\(actor, parent = getActorParent\(actor\)\)[\s\S]*?getActorParent\(actor\) !== parent[\s\S]*?parent\.remove_child\(actor\)/);
    assert.match(panel, /removeActorFromParent\(state\.banner, state\.container\)/);
    assert.match(panel, /removeActorFromParent\(state\.container, state\.parent\)/);
    assert.match(panel, /removeActorFromParent\(button, screen\.statusNotifierBox\)/);
    assert.match(panel, /removeActorFromParent\(actor, parent\)/);
});

test('the network panel aggregates Wi-Fi, wired, VPN and mobile native controls', async () => {
    const menus = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const start = menus.indexOf('export class NetworkStatusMenu');
    const end = menus.indexOf('export class RadioStatusMenu', start);
    const source = menus.slice(start, end);
    const panelNetworkSource = panelSource.slice(panelSource.indexOf("button.statusKind === 'wifi'"),
        panelSource.indexOf("button.statusKind === 'bluetooth'"));
    for (const feature of ['Wi-Fi', 'Ethernet', 'VPN', 'Réseau mobile'])
        assert.match(panelNetworkSource, new RegExp(feature));
    assert.match(source, /content\.mount\(toggle\.menu/);
    assert.match(source, /toggle\.emit\('clicked', 1\)/);
    assert.match(panelNetworkSource, /new NetworkStatusMenu/);
    for (const property of ['_wirelessToggle', '_wiredToggle', '_vpnToggle', '_mobileToggle'])
        assert.ok(panelSource.includes(`network?.${property}`));
    assert.match(panelSource, /\['wifi', 'network-wired-symbolic', 'Réseau'\]/);
});

test('native status menu content restores only actors it can safely reparent', async () => {
    const menus = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const start = menus.indexOf('class NativeMenuContent');
    const end = menus.indexOf('export class RadioStatusMenu', start);
    const source = menus.slice(start, end);
    assert.match(source, /if \(index < 0 \|\| !removeActorFromParent\(actor, parent\)\)/);
    assert.match(source, /if \(currentParent && currentParent !== parent\)\s+removeActorFromParent\(actor, currentParent\)/);
    assert.match(source, /if \(!getActorParent\(actor\)\)[\s\S]*?parent\.insert_child_at_index\(actor, index\)/);
});


test('network popup is a dedicated floating panel with a connection card and compact actions', async () => {
    const menus = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const start = menus.indexOf('export class NetworkStatusMenu');
    const end = menus.indexOf('export class RadioStatusMenu', start);
    const source = menus.slice(start, end);
    assert.ok(source.includes('new St.ScrollView'));
    assert.ok(source.includes('g-os-network-connection-card'));
    assert.ok(source.includes('g-os-network-rows'));
    assert.ok(source.includes('g-os-network-actions'));
    assert.ok(source.includes('showDetail(toggle)'));
    assert.ok(source.includes('Tous les réseaux'));
    assert.ok(source.includes('state.content.mount(toggle.menu, true)'));
    assert.ok(source.includes('this.connectionSummary.text ='));
    assert.ok(source.includes('_refreshNetworks()'));
});
