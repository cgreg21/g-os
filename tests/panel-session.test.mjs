import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('session action availability stays synchronized while the menu is open', async () => {
    const source = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    const start = source.indexOf('_populateSessionMenu(button)');
    const end = source.indexOf('_updateClocks()', start);
    const session = source.slice(start, end);
    for (const signal of ['can-restart', 'can-power-off', 'can-logout', 'can-lock-screen', 'can-suspend'])
        assert.ok(session.includes(`notify::${signal}`), `missing live update for ${signal}`);
    assert.match(session, /button\.connect\('destroy', \(\) => capabilityCleanup\.clear\(\)\)/);
    assert.match(session, /button\.menu\.connect\('open-state-changed'[\s\S]*?updateSensitivity\(\)/);
});
