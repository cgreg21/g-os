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


test('network overview avoids duplicate status and keeps Wi-Fi scanning in its detail view', async () => {
    const menus = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const start = menus.indexOf('export class NetworkStatusMenu');
    const end = menus.indexOf('export class RadioStatusMenu', start);
    const source = menus.slice(start, end);
    const overviewStart = source.indexOf('    _buildOverview()');
    const detailStart = source.indexOf('    showDetail(toggle)');
    const overview = source.slice(overviewStart, detailStart);
    const detailEnd = source.indexOf('    refresh()', detailStart);
    const detail = source.slice(detailStart, detailEnd);
    assert.ok(!overview.includes('connectionCard'));
    assert.ok(!overview.includes('connectionSummary'));
    assert.ok(!overview.includes('Actualiser'));
    assert.ok(!overview.includes('_refreshNetworks'));
    assert.ok(overview.includes('g-os-network-rows'));
    assert.ok(overview.includes('PopupMenuItem'));
    assert.ok(overview.includes("button.label.set_x_expand(true)"));
    assert.ok(overview.includes("button.connect('activate'"));
    assert.ok(overview.includes('PopupSeparatorMenuItem'));
    assert.ok(!overview.includes('emblem-system-symbolic'));
    assert.ok(!overview.includes('g-os-network-popup'));
    assert.ok(!overview.includes('g-os-network-row-button'));
    assert.ok(overview.includes('_buildTrafficGraph'));
    assert.ok(overview.includes('_updateOverviewVisibility'));
    assert.ok(overview.includes('button.visible = active'));
    assert.ok(!overview.includes("_label('Réseau'"));
    assert.ok(detail.includes("_button('Rechercher', 'g-os-network-action'"));
    assert.ok(detail.includes("'Activer le Wi-Fi'"));
    assert.ok(!detail.includes('Service activé'));
    assert.ok(!detail.includes("_label(state.entry.title, 'g-os-network-title')"));
    assert.ok(detail.includes('toggle._startScanning?.()'));
    assert.ok(detail.includes('toggle._reorderDeviceItems?.()'));
    assert.ok(detail.includes('state.content.mount(toggle.menu, true)'));
    assert.ok(detail.includes("_button('Retour', 'g-os-network-back'"));
    assert.ok(detail.includes('_appendSettingsItem'));
});

test('Wi-Fi overview row displays the active SSID and native signal-strength icon', async () => {
    const menus = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const start = menus.indexOf('export class NetworkStatusMenu');
    const end = menus.indexOf('export class RadioStatusMenu', start);
    const source = menus.slice(start, end);
    assert.ok(source.includes("toggle.subtitle || title"));
    assert.ok(source.includes("toggle.icon_name || 'network-wireless-signal-none-symbolic'"));
    assert.ok(source.includes("notify::subtitle"));
    assert.ok(source.includes("notify::icon-name"));
    assert.ok(source.includes('_refreshWifiRow(toggle)'));
    assert.ok(source.includes('state.button.label.text = toggle.subtitle || state.entry.title'));
    assert.ok(source.includes('state.icon.icon_name = toggle.icon_name'));
});

test('network traffic graph reads only interfaces carrying the active default route', async () => {
    const menus = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const start = menus.indexOf('export class NetworkStatusMenu');
    const end = menus.indexOf('export class RadioStatusMenu', start);
    const source = menus.slice(start, end);
    assert.ok(source.includes("this._readProcFile('/proc/net/route')"));
    assert.ok(source.includes("this._readProcFile('/proc/net/ipv6_route')"));
    assert.ok(source.includes("fields[1] === '00000000'"));
    assert.ok(source.includes("fields[0] === '00000000000000000000000000000000'"));
    assert.ok(source.includes('activeInterfaces.has(iface)'));
    assert.ok(source.includes("source.split('\\n')"));
    assert.ok(source.includes('split(/\\s+/)'));
    assert.ok(source.includes("this.lastTraffic.interfaces === counters.interfaces"));
});

test('network popup delegates its visual styling to the active GNOME theme', async () => {
    const css = await readFile(new URL('../stylesheet.css', import.meta.url), 'utf8');
    const menus = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const start = menus.indexOf('export class NetworkStatusMenu');
    const end = menus.indexOf('export class RadioStatusMenu', start);
    const source = menus.slice(start, end);
    assert.ok(!css.includes('.g-os-network-'));
    assert.ok(!source.includes('add_style_class_name(\'g-os-network-popup\')'));
    assert.ok(!source.includes('style_class: \'g-os-network-panel\''));
});


test('Bluetooth popup stays compact and removes duplicate native heading', async () => {
    const menus = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const css = await readFile(new URL('../stylesheet.css', import.meta.url), 'utf8');
    const start = menus.indexOf('export class RadioStatusMenu');
    const end = menus.indexOf('export class BatteryStatusMenu', start);
    const source = menus.slice(start, end);
    assert.ok(source.includes('nativeMenu?._header'));
    assert.ok(source.includes('nativeHeader.hide()'));
    assert.ok(source.includes('nativeHeader.show()'));
    assert.ok(source.includes("'Aucun appareil disponible'"));
    assert.ok(source.includes("'Activez Bluetooth pour connecter un appareil'"));
});


test('all status menus share one compact theme-native popup width', async () => {
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    const css = await readFile(new URL('../stylesheet.css', import.meta.url), 'utf8');
    const menus = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    assert.ok(panel.includes("menu.actor.add_style_class_name('g-os-compact-status-popup')"));
    assert.ok(panel.includes("menu.box.add_style_class_name('g-os-compact-status-popup')"));
    assert.match(css, /\.g-os-compact-status-popup\s*\{[^}]*width:\s*420px;[^}]*max-width:\s*420px;/);
    assert.ok(!css.includes('g-os-bluetooth-popup'));
    assert.ok(!menus.includes('g-os-bluetooth-popup'));
    for (const kind of ['sound', 'wifi', 'bluetooth', 'brightness'])
        assert.ok(panel.includes(`button.statusKind === '${kind}'`));
    assert.ok(panel.includes('new BatteryStatusMenu'));
});


test('sound and display menus use compact icon-led controls', async () => {
    const source = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const sound = source.slice(source.indexOf('export class SoundStatusMenu'), source.indexOf('export class DisplayStatusMenu'));
    const display = source.slice(source.indexOf('export class DisplayStatusMenu'), source.indexOf('class NativeMenuContent'));
    assert.ok(sound.includes('g-os-status-device-grid'));
    assert.ok(sound.includes('audio-headphones-symbolic'));
    assert.ok(display.includes('Paramètres d’affichage'));
    assert.ok(display.includes('this.temperatureRow.visible = enabled'));
    assert.ok(!display.includes('Luminosité :'));
});

test('Bluetooth menu shows connected and available devices in compact icon grids', async () => {
    const source = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const bluetooth = source.slice(source.indexOf('export class RadioStatusMenu'), source.indexOf('export class BatteryStatusMenu'));
    assert.ok(bluetooth.includes('toggleDevice(device)'));
    assert.ok(bluetooth.includes('Périphériques connectés'));
    assert.ok(bluetooth.includes('g-os-status-device-grid'));
});

test('battery menu presents power profiles as direct icon-grid choices', async () => {
    const source = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const battery = source.slice(source.indexOf('export class BatteryStatusMenu'), source.indexOf('export function createPowerDeviceClient'));
    assert.ok(battery.includes('ActiveProfile = profile'));
    assert.ok(battery.includes('g-os-status-device-grid'));
    assert.ok(!battery.includes('this.content.mount(profiles?.menu)'));
    assert.ok(battery.includes('Périphériques'));
});
