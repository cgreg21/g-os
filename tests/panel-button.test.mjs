import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {
    applyPanelButtonMetrics,
    calculatePanelButtonMetrics,
    createPanelButton,
    createPanelMenuButton,
} from '../dist/panel/panelButton.js';

test('panel button dimensions account for both panel and button vertical padding', () => {
    assert.deepEqual(calculatePanelButtonMetrics({
        panelHeight: 48,
        panelVerticalPadding: 4,
        buttonPadding: 2,
        spacing: 5,
    }), {
        contentHeight: 36,
        iconSize: 25,
        fontSize: 23,
        padding: 2,
        spacing: 5,
    });
});

test('panel button dimensions scale with available topbar height', () => {
    const compact = calculatePanelButtonMetrics({
        panelHeight: 32, panelVerticalPadding: 2, buttonPadding: 2, spacing: 3,
    });
    const roomy = calculatePanelButtonMetrics({
        panelHeight: 64, panelVerticalPadding: 4, buttonPadding: 3, spacing: 6,
    });
    assert.ok(roomy.iconSize > compact.iconSize);
    assert.ok(roomy.fontSize > compact.fontSize);
    assert.equal(compact.padding, 2);
    assert.equal(roomy.padding, 3);
    assert.equal(compact.spacing, 3);
    assert.equal(roomy.spacing, 6);
});

test('panel button dimensions reject invalid geometry', () => {
    assert.throws(() => calculatePanelButtonMetrics({
        panelHeight: 0, panelVerticalPadding: 0, buttonPadding: 0, spacing: 0,
    }), RangeError);
    assert.throws(() => calculatePanelButtonMetrics({
        panelHeight: 40, panelVerticalPadding: -1, buttonPadding: 0, spacing: 0,
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

test('shared metrics apply identical padding and spacing and scale icon and text', () => {
    const button = createPanelButton(fakeSt, fakeClutter, {
        iconName: 'wifi', text: 'Wi-Fi',
    });
    const metrics = calculatePanelButtonMetrics({
        panelHeight: 48, panelVerticalPadding: 4, buttonPadding: 2, spacing: 5,
    });
    applyPanelButtonMetrics(button, metrics);

    assert.ok(button.styles.some(style => style.includes('padding: 2px')));
    assert.ok(button.panelContent.styles.some(style => style.includes('spacing: 5px')));
    assert.ok(button.panelIcon.styles.some(style => style.includes('icon-size: 25px')));
    assert.ok(button.panelLabel.styles.some(style => style.includes('font-size: 23px')));
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
    const button = createPanelMenuButton(fakeSt, fakeClutter, PopupMenu, {
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
        panelHeight: 24, panelVerticalPadding: 1, buttonPadding: 16, spacing: 6,
    });
    assert.equal(metrics.padding, 10);
    assert.equal(metrics.contentHeight, 2);
    assert.ok(metrics.iconSize > 0);
    assert.ok(metrics.fontSize > 0);
});
