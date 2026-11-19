import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');

test('G-OS preferences use the shared icon-only topbar button', () => {
    assert.match(panel, /const preferences = createPanelButton\(St, Clutter, \{[\s\S]*?icon: screen\.preferencesIcon,[\s\S]*?accessibleName: 'Préférences G-Os',[\s\S]*?visible: this\._settings\.get_boolean\('panel-show-preferences'\)/);
    assert.match(panel, /preferences\.connect\('clicked', \(\) => this\.openPreferences\(\)\)/);
});

test('preferences button participates in the configurable layout and shared metrics', () => {
    assert.match(panel, /\['preferences', screen\.preferencesButton\]/);
    assert.match(panel, /screen\.clockButton, screen\.searchButton, screen\.preferencesButton/);
});
