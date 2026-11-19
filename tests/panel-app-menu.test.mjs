import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('application menu exposes the GNOME Extensions manager when installed', async () => {
    const source = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    const start = source.indexOf('_populateAppMenu(button)');
    const end = source.indexOf('_syncPanelGlobalMenu(screen)', start);
    const menu = source.slice(start, end);
    assert.match(menu, /addAction\('Gérer les extensions'/);
    assert.match(menu, /lookup_app\('org\.gnome\.Extensions\.desktop'\)/);
    assert.match(menu, /lookup_app\('gnome-extensions-app\.desktop'\)/);
    assert.match(menu, /extensions\.setSensitive\(Boolean\(lookupExtensionsApp\(\)\)\)/);
    assert.match(menu, /Main\.overview\.hide\(\);[\s\S]*?app\.activate\(\)/);
    assert.match(menu, /open\)[\s\S]*?updateExtensions\(\)/);
});
