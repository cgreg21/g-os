import assert from 'node:assert/strict';
import test from 'node:test';
import {applyNativeMenuTheme} from '../dist/panel/menuTheme.js';

function actor() {
    const classes = new Set();
    return {
        classes,
        add_style_class_name(name) {
            classes.add(name);
        },
    };
}

test('native popup menus explicitly retain GNOME Shell theme classes', () => {
    const menu = {actor: actor(), box: actor()};

    assert.equal(applyNativeMenuTheme(menu, 'g-os-popup', 'g-os-calendar-menu'), true);
    assert.equal(menu.actor.classes.has('popup-menu'), true);
    assert.equal(menu.actor.classes.has('g-os-popup'), true);
    assert.equal(menu.actor.classes.has('g-os-calendar-menu'), true);
    assert.equal(menu.box.classes.has('popup-menu-content'), true);
});

test('native popup menu theming is idempotent and does not define colors', () => {
    const menu = {actor: actor(), box: actor()};

    assert.equal(applyNativeMenuTheme(menu, 'g-os-popup'), true);
    assert.equal(applyNativeMenuTheme(menu, 'g-os-popup'), true);
    assert.equal(menu.actor.classes.size, 2);
    assert.equal(menu.box.classes.size, 1);
    assert.equal(Object.hasOwn(menu.actor, 'style'), false);
});

test('invalid menu actors are ignored safely', () => {
    assert.equal(applyNativeMenuTheme(null, 'g-os-popup'), false);
    assert.equal(applyNativeMenuTheme({actor: actor()}, 'g-os-popup'), false);
});
