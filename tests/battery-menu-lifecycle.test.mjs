import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('battery menu restores native profiles on close and only destroys them on teardown', async () => {
    const source = await readFile(new URL('../src/panel/panelStatusMenus.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export class BatteryStatusMenu');
    const end = source.indexOf('export function createPowerDeviceClient', start);
    const battery = source.slice(start, end);
    assert.match(battery, /if \(open\) \{[\s\S]*?this\.content\.mount\(profiles\?\.menu\)[\s\S]*?\} else\s+this\.content\.restore\(\)/);
    assert.match(battery, /destroy\(\) \{[\s\S]*?this\.destroyed = true;[\s\S]*?this\.content\.destroy\(\)/);
});
