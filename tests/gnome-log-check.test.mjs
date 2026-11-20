import assert from 'node:assert/strict';
import test from 'node:test';
import {scanGnomeLogText, validateRunSummary} from '../scripts/check-gnome-logs.mjs';

const scenarios = [
    'unit', 'dock', 'motion', 'hit-testing', 'appearance', 'reachability',
    'settings', 'desktop', 'layout', 'widgets', 'panel', 'notifications',
    'margins', 'options', 'daily',
];

test('GNOME log audit detects JavaScript errors and native criticals', () => {
    const result = scanGnomeLogText([
        'Gjs-Message: JS LOG: normal startup',
        'JS ERROR: TypeError: broken callback',
        'St-CRITICAL **: widget is detached',
        'GNOME Shell-CRITICAL **: feature assertion failed',
        'Gtk-WARNING **: benign layout warning',
    ].join('\n'), 'gnome.log');
    assert.equal(result.findings.length, 3);
    assert.deepEqual(result.findings.map(item => item.rule), [
        'GJS JavaScript error',
        'GLib/GObject/GTK/Clutter/St/Mutter critical',
        'GLib/GObject/GTK/Clutter/St/Mutter critical',
    ]);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.findings[0].file, 'gnome.log');
    assert.equal(result.findings[0].line, 2);
});

test('GNOME log audit detects promise rejections and native crashes', () => {
    const result = scanGnomeLogText([
        'UnhandledPromiseRejection: rejected',
        'Process terminated with Segmentation fault (core dumped)',
    ].join('\n'));
    assert.equal(result.findings.length, 2);
});

test('full GNOME summary requires every scenario to pass exactly once', () => {
    const summary = {
        selection: 'all',
        status: 'passed',
        tests: scenarios.map(id => ({id, status: 'passed'})),
    };
    assert.deepEqual(validateRunSummary(summary), []);
    assert.ok(validateRunSummary({...summary, tests: summary.tests.slice(1)}).some(issue => issue.includes('Missing scenario result: unit')));
    assert.ok(validateRunSummary({...summary, tests: summary.tests.map(item =>
        item.id === 'panel' ? {...item, status: 'failed'} : item)}).some(issue => issue.includes('Scenario panel status is failed')));
    assert.ok(validateRunSummary({...summary, selection: 'panel'}).some(issue => issue.includes('full scenario selection')));
});
