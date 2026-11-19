import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const activity = await readFile(new URL('../src/dock/dockActivity.ts', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');

test('notification source count changes refresh the topbar notification button', () => {
    assert.match(activity, /source\.connect\(signal, \(\) => \{[\s\S]*?this\._updateNotificationCounts\(\);[\s\S]*?this\._updatePanelNotifications\(\);/);
});

test('adding and removing notification sources refreshes topbar visibility', () => {
    assert.match(activity, /this\._notificationSources\.set\(source, cleanup\);[\s\S]*?this\._updateNotificationCounts\(\);[\s\S]*?this\._updatePanelNotifications\(\);/);
    assert.match(activity, /_unwatchNotificationSource\(source\) \{[\s\S]*?cleanup\.clear\(\);[\s\S]*?this\._updatePanelNotifications\(\);/);
});

test('notification button visibility follows the setting and actual source contents', () => {
    assert.match(panel, /screen\.notificationButton\.container\.visible = this\._settings\.get_boolean\('panel-show-notifications'\) &&[\s\S]*?Main\.messageTray\.getSources\(\)\.some\(source => source\.notifications\?\.length > 0\)/);
});
