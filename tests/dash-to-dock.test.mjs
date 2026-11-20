import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('Dash to Dock upstream source is bundled in the repository build', async () => {
    const root = new URL('../dist/dash-to-dock@micxgx.gmail.com/', import.meta.url);
    const metadata = JSON.parse(await readFile(new URL('metadata.json', root), 'utf8'));
    assert.equal(metadata.uuid, 'dash-to-dock@micxgx.gmail.com');
    assert.equal(metadata.version, 110);
    await Promise.all([
        'extension.js',
        'docking.js',
        'stylesheet.css',
        'schemas/gschemas.compiled',
        'schemas/org.gnome.shell.extensions.dash-to-dock.gschema.xml',
        'COPYING',
    ].map(path => readFile(new URL(path, root))));
});

test('G-Os keeps its legacy dock disabled outside test mode', async () => {
    const source = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
    assert.match(source, /const DASH_TO_DOCK_UUID = 'dash-to-dock@micxgx\.gmail\.com'/);
    assert.match(source, /_setLegacyDockEnabled\(keepLegacyDock\)/);
    assert.match(source, /_requestDashToDock\(true\)/);
});
