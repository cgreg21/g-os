import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('first topbar menu groups launcher actions and exposes GNOME Extensions', async () => {
    const source = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
    const panelStart = source.indexOf('_populatePanelMenu(button)');
    const appStart = source.indexOf('_populateAppMenu(button)', panelStart);
    const panelMenu = source.slice(panelStart, appStart);
    const appMenu = source.slice(appStart, source.indexOf('_syncPanelGlobalMenu(screen)', appStart));

    const actions = [
        'Vue d’ensemble', 'Applications', 'Rechercher',
        'Afficher le bureau',
        'Préférences', 'Gérer les extensions',
        'Paramètres système',
        'Verrouiller la session',
    ];
    let previousIndex = -1;
    for (const action of actions) {
        const index = panelMenu.indexOf(`addAction('${action}'`);
        assert.ok(index > previousIndex, `Expected "${action}" in the expected group order`);
        previousIndex = index;
    }

    assert.equal((panelMenu.match(/new PopupMenu\.PopupSeparatorMenuItem\(\)/g) ?? []).length, 4);
    assert.match(panelMenu, /lookup_app\('org\.gnome\.Extensions\.desktop'\)/);
    assert.match(panelMenu, /lookup_app\('gnome-extensions-app\.desktop'\)/);
    assert.match(panelMenu, /updateExtensions\(\)/);
    assert.match(panelMenu, /Main\.overview\.hide\(\);[\s\S]*?app\.activate\(\)/);
    assert.doesNotMatch(appMenu, /Gérer les extensions/);
});
