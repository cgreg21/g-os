import assert from 'node:assert/strict';
import test from 'node:test';
import {calculatePanelButtonMetrics} from '../dist/panel/panelButton.js';

test('panel button dimensions account for both panel and button vertical padding', () => {
    assert.deepEqual(calculatePanelButtonMetrics({
        panelHeight: 48,
        panelVerticalPadding: 4,
        buttonPadding: 2,
        spacing: 5,
    }), {
        contentHeight: 36,
        iconSize: 25,
        fontSize: 23,
        padding: 2,
        spacing: 5,
    });
});

test('panel button dimensions scale with available topbar height', () => {
    const compact = calculatePanelButtonMetrics({
        panelHeight: 32, panelVerticalPadding: 2, buttonPadding: 2, spacing: 3,
    });
    const roomy = calculatePanelButtonMetrics({
        panelHeight: 64, panelVerticalPadding: 4, buttonPadding: 3, spacing: 6,
    });
    assert.ok(roomy.iconSize > compact.iconSize);
    assert.ok(roomy.fontSize > compact.fontSize);
    assert.equal(compact.padding, 2);
    assert.equal(roomy.padding, 3);
    assert.equal(compact.spacing, 3);
    assert.equal(roomy.spacing, 6);
});

test('panel button dimensions reject invalid geometry', () => {
    assert.throws(() => calculatePanelButtonMetrics({
        panelHeight: 0, panelVerticalPadding: 0, buttonPadding: 0, spacing: 0,
    }), RangeError);
    assert.throws(() => calculatePanelButtonMetrics({
        panelHeight: 40, panelVerticalPadding: -1, buttonPadding: 0, spacing: 0,
    }), RangeError);
});
