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
    }
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
            }
        },
    };
    const button = createPanelMenuButton(fakeSt, fakeClutter, PopupMenu, {
        iconName: 'applications', accessibleName: 'Applications',
    });
    assert.ok(button instanceof fakeSt.Button);
    assert.equal(button.container, button);
    assert.equal(button.menu.source, button);
    assert.equal(button.menu.alignment, 0.5);
    assert.equal(button.menu.side, 'top');
});

test('topbar modules delegate every button construction to the shared factory', async () => {
    const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    const globalMenu = await readFile(new URL('../src/panel/globalMenu.ts', import.meta.url), 'utf8');
    const extension = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');

    assert.doesNotMatch(panel, /new St[.]Button/);
    assert.doesNotMatch(globalMenu, /new this[.]St[.]Button/);
    assert.match(panel, /createPanelMenuButton[(]St, Clutter, PopupMenu/);
    assert.match(extension, /createPanelMenuButton[(]St, Clutter, PopupMenu/);
    assert.match(globalMenu, /createPanelButton[(]this[.]St, this[.]Clutter/);
});
