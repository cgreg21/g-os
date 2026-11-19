import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');

test('search is an icon-only shared topbar button with an accessible name', () => {
    assert.match(panel, /screen\.searchIcon = new St\.Icon\(\{icon_name: 'system-search-symbolic'/);
    assert.match(panel, /const search = createPanelButton\(St, Clutter, \{[\s\S]*?icon: screen\.searchIcon,[\s\S]*?accessibleName: 'Rechercher',[\s\S]*?visible: this\._settings\.get_boolean\('panel-show-search'\)/);
    assert.match(panel, /search\.connect\('clicked', \(\) => Main\.overview\.focusSearch\(\)\)/);
});

test('search control participates in shared topbar layout and metrics', () => {
    assert.match(panel, /\['search', screen\.searchButton\]/);
    assert.match(panel, /screen\.clockButton, screen\.searchButton, screen\.preferencesButton/);
});
