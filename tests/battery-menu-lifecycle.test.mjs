import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('battery menu owns compact profile controls and releases device resources on teardown', async () => {
    const source = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export class BatteryStatusMenu');
    const end = source.indexOf('export function createPowerDeviceClient', start);
    const battery = source.slice(start, end);
    assert.match(battery, /this\.profiles\?\._profileItems/);
    assert.match(battery, /proxy\.ActiveProfile = profile/);
    assert.match(battery, /this\.profileGrid/);
    assert.match(battery, /destroy\(\) \{[\s\S]*?this\.destroyed = true;[\s\S]*?this\.deviceClient\?\.dispose\?\.\(\)/);
    assert.doesNotMatch(battery, /this\.content\.mount\(profiles\?\.menu\)/);
});
