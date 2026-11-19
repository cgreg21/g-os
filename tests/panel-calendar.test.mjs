import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const panel = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
const extension = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');

test('clock control uses the shared generic button and supports pointer and popup gestures', () => {
    assert.match(panel, /screen\.clockButton = createPanelButton\(St, Clutter,[\s\S]*?accessibleName: 'Calendrier et événements'/);
    assert.match(panel, /screen\.clockButton\.connect\('clicked',[\s\S]*?_togglePanelCalendar\(screen\)/);
    assert.match(panel, /screen\.clockButton\.connect\('popup-menu',[\s\S]*?_togglePanelCalendar\(screen\)/);
});

test('calendar reuses the native GNOME calendar and event source', () => {
    assert.match(panel, /screen\.calendar = dateMenu\._calendar/);
    assert.match(panel, /screen\.calendarEventSource = dateMenu\._eventSource/);
    assert.match(panel, /calendar\.connect\('selected-date-changed'/);
    assert.match(panel, /screen\.calendarEventSource\.connect\('changed'/);
});

test('calendar actor is restored before panel screens and their menus are destroyed', () => {
    const destroyStart = extension.indexOf('_destroyScreens() {');
    assert.notEqual(destroyStart, -1);
    const restore = extension.indexOf('this._restorePanelCalendar();', destroyStart);
    const screenLoop = extension.indexOf('for (const screen of this._screens)', destroyStart);
    assert.ok(restore > destroyStart);
    assert.ok(screenLoop > restore);
    assert.match(panel, /const currentParent = getActorParent\(calendar\);[\s\S]*?removeActorFromParent\(calendar, currentParent\)[\s\S]*?parent\.insert_child_at_index\(calendar, this\._panelCalendarOriginalIndex\)/);
    assert.match(panel, /this\._panelCalendarCleanup\?\.clear\(\)/);
});
