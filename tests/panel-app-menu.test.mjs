import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('first topbar menu exposes the GNOME Extensions manager when installed', async () => {
    const source = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    const panelStart = source.indexOf('_populatePanelMenu(button)');
    const appStart = source.indexOf('_populateAppMenu(button)', panelStart);
    const panelMenu = source.slice(panelStart, appStart);
    const appMenu = source.slice(appStart, source.indexOf('_syncPanelGlobalMenu(screen)', appStart));
    assert.match(panelMenu, /addAction\('Gérer les extensions'/);
    assert.match(panelMenu, /lookup_app\('org\.gnome\.Extensions\.desktop'\)/);
    assert.match(panelMenu, /lookup_app\('gnome-extensions-app\.desktop'\)/);
    assert.match(panelMenu, /extensions\.setSensitive\(Boolean\(lookupExtensionsApp\(\)\)\)/);
    assert.match(panelMenu, /Main\.overview\.hide\(\);[\s\S]*?app\.activate\(\)/);
    assert.doesNotMatch(appMenu, /Gérer les extensions/);
});
