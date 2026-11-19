import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {
    applyPanelButtonMetrics,
    calculatePanelButtonMetrics,
    calculatePanelLabelFontSize,
    createPanelButton,
    createPanelMenuButton,
} from '../dist/panel/panelButton.js';

test('panel button dimensions account for both panel and button vertical padding', () => {
    assert.deepEqual(calculatePanelButtonMetrics({
        panelHeight: 48,
        panelVerticalPadding: 4,
        buttonPadding: 2,
        itemSpacing: 5,
    }), {
        contentHeight: 36,
        iconSize: 25,
        fontSize: 23,
        padding: 2,
        itemSpacing: 5,
        contentSpacing: 4,
    });
});

test('panel button dimensions scale with available topbar height', () => {
    const compact = calculatePanelButtonMetrics({
        panelHeight: 32, panelVerticalPadding: 2, buttonPadding: 2, itemSpacing: 3,
    });
    const roomy = calculatePanelButtonMetrics({
        panelHeight: 64, panelVerticalPadding: 4, buttonPadding: 3, itemSpacing: 6,
    });
    assert.ok(roomy.iconSize > compact.iconSize);
    assert.ok(roomy.fontSize > compact.fontSize);
    assert.equal(compact.padding, 2);
    assert.equal(roomy.padding, 3);
    assert.equal(compact.itemSpacing, 3);
    assert.equal(roomy.itemSpacing, 6);
});

test('all topbar buttons use computed metrics without local padding overrides', async () => {
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    assert.equal(panel.includes("screen.clockButton.set_style('padding: 0"), false);
    assert.equal(panel.includes('button.set_style(`padding: ${buttonPadding}px'), false);
    assert.match(panel, /for \(const button of \[screen\.menuButton\.container[\s\S]*?applyPanelButtonMetrics\(button, metrics\);/);
    assert.match(panel, /for \(const button of screen\.globalMenuBox\?\.get_children\(\) \?\? \[\]\)[\s\S]*?applyPanelButtonMetrics\(button, metrics\);/);
});

test('topbar spacing and padding are not hardcoded per button style', async () => {
    const stylesheet = await readFile(new URL('../stylesheet.css', import.meta.url), 'utf8');
    assert.doesNotMatch(stylesheet, /\.g-os-(?:status-button|status-notifier-button|panel-button-content)[^{]*\{[^}]*padding:/s);
    assert.doesNotMatch(stylesheet, /\.macos-global-menu-button[^}]*\{[^}]*padding:/s);
    assert.doesNotMatch(stylesheet, /\.g-os-(?:status-notifier-items|global-menu)[^{]*\{[^}]*spacing:/s);
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    assert.match(panel, /for \(const \{content\} of screen\.panelLayoutGroups\?\.values\(\) \?\? \[\]\)[\s\S]*?content\.set_style\(`spacing:/);
});


test('live topbar geometry settings refresh shared metrics without rebuilding controls', async () => {
    const extension = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
    assert.match(extension, /'panel-height', 'panel-padding-horizontal', 'panel-padding-vertical', 'panel-icon-padding', 'panel-item-spacing'/);
    assert.match(extension, /\['panel-height', 'panel-padding-horizontal', 'panel-padding-vertical',[\s\S]*?'panel-icon-padding', 'panel-item-spacing'\]\.some\(key => keys\.has\(key\)\)[\s\S]*?this\._applyPanelMetrics\(screen\);/);
    assert.match(extension, /if \(keys\.has\('panel-height'\)\)\s+screen\.panel\.set_height/);
});

test('dynamic status notifier icons use only the shared button metrics', async () => {
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    const start = panel.indexOf('_syncStatusNotifierItems(screen)');
    const end = panel.indexOf('_destroyStatusNotifierMenus(screen)', start);
    const sync = panel.slice(start, end);
    assert.match(sync, /if \(screen\.panelButtonMetrics\)\s+applyPanelButtonMetrics\(button, screen\.panelButtonMetrics\);/);
    assert.doesNotMatch(sync, /statusIcon\.set_style\([^\n]*icon-size/);
});

test('application label font size follows shared metrics and available width', () => {
    assert.equal(calculatePanelLabelFontSize(24, 5, 200), 24);
    assert.equal(calculatePanelLabelFontSize(24, 20, 120), 10);
    assert.equal(calculatePanelLabelFontSize(24, 0, 0), 24);
    assert.throws(() => calculatePanelLabelFontSize(0, 5, 100), RangeError);
});

test('panel button dimensions reject invalid geometry', () => {
    assert.throws(() => calculatePanelButtonMetrics({
        panelHeight: 0, panelVerticalPadding: 0, buttonPadding: 0, itemSpacing: 0,
    }), RangeError);
    assert.throws(() => calculatePanelButtonMetrics({
        panelHeight: 40, panelVerticalPadding: -1, buttonPadding: 0, itemSpacing: 0,
    }), RangeError);
});

class FakeActor {
    constructor(properties = {}) {
        Object.assign(this, properties);
        this.children = [];
        this.styles = [];
        this.signals = new Map();
    }
    connect(signal, callback) { this.signals.set(signal, callback); return this.signals.size; }
    destroy() { this.signals.get('destroy')?.(); }
    hide() { this.hidden = true; }
    emit(signal) { this.signals.get(signal)?.(); }
    add_child(child) { this.children.push(child); }
    set_style(style) { this.styles.push(style); }
}

const fakeSt = {
    BoxLayout: class extends FakeActor {},
    Icon: class extends FakeActor {},
    Label: class extends FakeActor {},
    Button: class extends FakeActor {},
    Side: {TOP: 'top'},
};
const fakeUiGroup = new FakeActor();
const fakeClutter = {
    Orientation: {HORIZONTAL: 'horizontal'},
    ActorAlign: {CENTER: 'center'},
};

test('icon-only, text-only and combined controls share the same St.Button component', () => {
    const iconOnly = createPanelButton(fakeSt, fakeClutter, {iconName: 'search'});
    const textOnly = createPanelButton(fakeSt, fakeClutter, {text: 'Clock'});
    const combined = createPanelButton(fakeSt, fakeClutter, {
        iconName: 'battery', text: '80%',
    });

    for (const button of [iconOnly, textOnly, combined])
        assert.ok(button instanceof fakeSt.Button);
    assert.equal(iconOnly.panelContent.children.length, 1);
    assert.equal(textOnly.panelContent.children.length, 1);
    assert.equal(combined.panelContent.children.length, 2);
    assert.ok(combined.panelIcon);
    assert.ok(combined.panelLabel);
});

test('icon-only, text-only and combined buttons receive exactly the same padding', () => {
    const iconOnly = createPanelButton(fakeSt, fakeClutter, {iconName: 'wifi'});
    const textOnly = createPanelButton(fakeSt, fakeClutter, {text: 'Wi-Fi'});
    const combined = createPanelButton(fakeSt, fakeClutter, {iconName: 'wifi', text: 'Wi-Fi'});
    const metrics = calculatePanelButtonMetrics({
        panelHeight: 48, panelVerticalPadding: 4, buttonPadding: 2, itemSpacing: 11,
    });
    for (const button of [iconOnly, textOnly, combined])
        applyPanelButtonMetrics(button, metrics);
    assert.equal(iconOnly.styles[0], 'padding: 2px; margin: 0; min-height: 0;');
    assert.equal(textOnly.styles[0], iconOnly.styles[0]);
    assert.equal(combined.styles[0], iconOnly.styles[0]);
    assert.ok(iconOnly.panelIcon.styles.some(style => style.includes('icon-size: 25px')));
    assert.ok(textOnly.panelLabel.styles.some(style => style.includes('font-size: 23px')));
    assert.ok(combined.panelContent.styles.some(style => style.includes('spacing: 4px')));
});

test('item spacing is independent from button padding', () => {
    const compactPadding = calculatePanelButtonMetrics({panelHeight: 48, buttonPadding: 1, itemSpacing: 12});
    const roomyPadding = calculatePanelButtonMetrics({panelHeight: 48, buttonPadding: 9, itemSpacing: 12});
    assert.equal(compactPadding.itemSpacing, 12);
    assert.equal(roomyPadding.itemSpacing, 12);
    assert.equal(compactPadding.padding, 1);
    assert.equal(roomyPadding.padding, 9);
});

test('menu-capable controls are the same shared St.Button with an attached menu', () => {
    const PopupMenu = {
        PopupMenu: class {
            constructor(source, alignment, side) {
                Object.assign(this, {source, alignment, side});
                this.destroyed = false;
                this.actor = new FakeActor();
            }
            close() { this.closed = true; }
            toggle() { this.toggled = true; }
            open() { this.opened = true; }
            destroy() { this.destroyed = true; }
        },
    };
    const button = createPanelMenuButton(fakeSt, fakeClutter, PopupMenu, fakeUiGroup, {
        iconName: 'applications', accessibleName: 'Applications',
    });
    assert.ok(button instanceof fakeSt.Button);
    assert.equal(button.container, button);
    assert.equal(button.menu.source, button);
    assert.equal(button.menu.alignment, 0.5);
    assert.equal(button.menu.side, 'top');
    assert.equal(fakeUiGroup.children.includes(button.menu.actor), true);
    assert.equal(button.menu.actor.hidden, true);
});

test('topbar modules delegate every button construction to the shared factory', async () => {
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    const globalMenu = await readFile(new URL('../src/panel/globalMenu.ts', import.meta.url), 'utf8');
    const extension = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');

    assert.equal(panel.includes('new St.Button'), false);
    assert.equal(globalMenu.includes('new this.St.Button'), false);
    assert.ok(panel.includes('createPanelMenuButton(St, Clutter, PopupMenu'));
    assert.ok(extension.includes('createPanelMenuButton(St, Clutter, PopupMenu'));
    assert.equal(extension.includes('_menuBox'), false);
    assert.ok(panel.indexOf('screen.appLabel.set_style') > panel.indexOf('applyPanelButtonMetrics(button, metrics)'));
    assert.ok(globalMenu.includes('createPanelButton(this.St, this.Clutter'));
});

test('menu lifetime is owned by the shared button', () => {
    const PopupMenu = {
        PopupMenu: class {
            constructor(source, alignment, side) {
                Object.assign(this, {source, alignment, side});
                this.destroyed = false;
                this.actor = new FakeActor();
            }
            close() { this.closed = true; }
            destroy() { this.destroyed = true; }
        },
    };
    const button = createPanelMenuButton(fakeSt, fakeClutter, PopupMenu, fakeUiGroup, {
        iconName: 'applications',
    });
    const menu = button.menu;
    button.destroy();
    assert.equal(menu.closed, true);
    assert.equal(menu.destroyed, true);
});

test('menu buttons toggle on click and open from the popup-menu gesture', () => {
    const PopupMenu = {
        PopupMenu: class {
            constructor() { this.actor = new FakeActor(); }
            close() {}
            destroy() {}
            toggle() { this.toggled = true; }
            open() { this.opened = true; }
        },
    };
    const button = createPanelMenuButton(fakeSt, fakeClutter, PopupMenu, fakeUiGroup);
    button.emit('clicked');
    assert.equal(button.menu.toggled, true);
    button.emit('popup-menu');
    assert.equal(button.menu.opened, true);
});

test('button padding cannot consume the entire topbar height', () => {
    const metrics = calculatePanelButtonMetrics({
        panelHeight: 24, panelVerticalPadding: 1, buttonPadding: 16, itemSpacing: 6,
    });
    assert.equal(metrics.padding, 10);
    assert.equal(metrics.contentHeight, 2);
    assert.ok(metrics.iconSize > 0);
    assert.ok(metrics.fontSize > 0);
});


test('shared button factory does not expose a custom-child escape hatch', async () => {
    const source = await readFile(new URL('../src/panel/panelButton.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /child\s*=\s*null/);
    assert.doesNotMatch(source, /if \(!child\)/);
    const button = createPanelButton(fakeSt, fakeClutter, {
        iconName: 'search', text: 'Search',
    });
    assert.equal(button.panelContent.children.length, 2);
    assert.equal(button.panelIcon, button.panelContent.children[0]);
    assert.equal(button.panelLabel, button.panelContent.children[1]);
});

test('global menu does not retain an independent text padding setting', async () => {
    const globalMenu = await readFile(new URL('../src/panel/globalMenu.ts', import.meta.url), 'utf8');
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(globalMenu, /textPadding/);
    assert.doesNotMatch(panel, /textPadding: this\._settings\.get_int\('panel-icon-padding'\)/);
});


test('topbar item spacing is a live setting independent from button padding', async () => {
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    const extension = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
    const stylesheet = await readFile(new URL('../stylesheet.css', import.meta.url), 'utf8');
    assert.match(panel, /const itemSpacing = this\\._settings\\.get_int\\('panel-item-spacing'\\)/);
    assert.match(panel, /screen\\.panel\\.set_style\\([^\\n]*spacing: \\$\\{metrics\\.itemSpacing\\}px/);
    assert.match(panel, /content\\.set_style\\(\\`spacing: \\$\\{metrics\\.itemSpacing\\}px/);
    assert.match(extension, /'panel-icon-padding', 'panel-item-spacing'/);
    assert.doesNotMatch(stylesheet, /\\.g-os-secondary-panel\\s*\\{[^}]*\\bspacing:/s);
    assert.doesNotMatch(stylesheet, /\\.g-os-panel-zone-content\\s*\\{[^}]*\\bspacing:/s);
    assert.doesNotMatch(stylesheet, /\\.macos-global-menu\\s*\\{[^}]*\\bspacing:/s);
});

test('default metrics use the shared topbar spacing', () => {
    const metrics = calculatePanelButtonMetrics({panelHeight: 32});
    assert.equal(metrics.itemSpacing, 6);
});

test('obsolete per-text topbar padding is absent from configuration and schema', async () => {
    const config = await readFile(new URL('../config.json', import.meta.url), 'utf8');
    const schema = await readFile(new URL('../schemas/org.gnome.shell.extensions.g-os.gschema.xml', import.meta.url), 'utf8');
    const preferences = await readFile(new URL('../src/prefs.ts', import.meta.url), 'utf8');
    const extension = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(config, /panel-text-padding/);
    assert.doesNotMatch(schema, /panel-text-padding/);
    assert.doesNotMatch(preferences, /panel-text-padding/);
    assert.doesNotMatch(extension, /panel-text-padding/);
});

test('topbar metrics are initialized and refreshed for every monitor', async () => {
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    const extension = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
    assert.match(panel, /this\._initializePanelLayout\(screen\);\s+this\._applyPanelMetrics\(screen\);/);
    assert.match(extension, /for \(const screen of this\._screens\) \{[\s\S]*?this\._applyPanelMetrics\(screen\);[\s\S]*?\}/);
    assert.match(extension, /monitors-changed', \(\) => this\._applySettings\(\)/);
    assert.match(extension, /this\._applyLiveSettings\(keys\)[\s\S]*?for \(const screen of this\._screens\)/);
});


test('secondary-monitor launcher uses the configured launcher icon and fallback', async () => {
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    assert.match(panel, /screen\.menuButton = monitor\.index === Main\.layoutManager\.primaryIndex[\s\S]*?icon: new St\.Icon\(\{[\s\S]*?gicon: this\._launcherIcon\('panel'\),[\s\S]*?fallback_gicon: this\._gnomeLogo,[\s\S]*?styleClass: 'g-os-panel-menu'/);
    assert.doesNotMatch(panel, /iconName: 'view-app-grid-symbolic', accessibleName: 'Applications'/);
});


test('active application menu tracks focus changes and excludes the desktop window', async () => {
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    const extension = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
    assert.match(panel, /const isDesktop = window\?\.get_window_type\?\.\(\) === Meta\.WindowType\.DESKTOP/);
    assert.match(panel, /button\.refreshTargetApp = updateQuit/);
    assert.match(extension, /screen\.appMenuButton\?\.refreshTargetApp\?\.\(\)/);
});
