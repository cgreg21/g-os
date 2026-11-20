import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('XDock is packaged as an independent GNOME Shell companion extension', async () => {
    const root = new URL('../dist/xdock@github.com/', import.meta.url);
    const metadata = JSON.parse(await readFile(new URL('metadata.json', root), 'utf8'));

    assert.equal(metadata.uuid, 'xdock@github.com');
    assert.ok(metadata['shell-version'].includes('51'));
    await readFile(new URL('extension.js', root), 'utf8');
    await readFile(new URL('COPYING', root), 'utf8');
    await readFile(new URL('../dist/licenses/xdock-COPYING', import.meta.url), 'utf8');
    await readFile(new URL('schemas/gschemas.compiled', root));
    await readFile(new URL('../dist/schemas/gschemas.compiled', import.meta.url));
    await readFile(new URL('../dist/schemas/org.gnome.shell.extensions.xdock.gschema.xml', import.meta.url));
});

test('G-Os only hides its legacy dock while the XDock handover is pending or active', async () => {
    const extension = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
    const visibility = await readFile(new URL('../src/dock/dockVisibility.ts', import.meta.url), 'utf8');

    assert.match(extension, /org\.gnome\.Shell\.Extensions/);
    assert.match(extension, /getSettings\('org.gnome.shell.extensions.xdock'\)/);
    assert.match(extension, /_syncXDockSettings\(\)/);
    assert.match(extension, /G_OS_FEATURE_TEST/);
    assert.match(extension, /G_OS_EXPLORATORY_TEST/);
    assert.match(extension, /EnableExtension/);
    assert.ok(extension.includes("new GLib.VariantType('(b)')"));
    assert.match(extension, /_setLegacyDockEnabled\(false\)/);
    assert.match(extension, /this\._xdockRequested = false;[\s\S]*?this\._setLegacyDockEnabled\(true\)/);
    assert.match(visibility, /screen\.legacyDockDisabled/);
    assert.match(visibility, /registered = registered && !screen\.legacyDockDisabled/);
});
