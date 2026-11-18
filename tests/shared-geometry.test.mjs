import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {
    resolveInsertionIndex,
    resolveInsertionIndexWithHysteresis,
    resolveReorderInsertionIndex,
} from '../dist/shared/geometry/insertion.js';
import {
    intersectRectangles,
    isValidRectangle,
    rectanglesOverlap,
    unionRectangles,
} from '../dist/shared/geometry/rectangle.js';

test('resolves insertion slots before, between and after item midpoints', () => {
    assert.equal(resolveInsertionIndex([20, 50, 80], 0), 0);
    assert.equal(resolveInsertionIndex([20, 50, 80], 20), 0);
    assert.equal(resolveInsertionIndex([20, 50, 80], 21), 1);
    assert.equal(resolveInsertionIndex([20, 50, 80], 65), 2);
    assert.equal(resolveInsertionIndex([20, 50, 80], 100), 3);
    assert.equal(resolveInsertionIndex([], 50), 0);
});

test('rejects incomplete and non-finite insertion geometry', () => {
    assert.equal(resolveInsertionIndex([10, null, 40], 50), null);
    assert.equal(resolveInsertionIndex([10, Number.NaN, 40], 50), null);
    assert.equal(resolveInsertionIndex([10, 40], Number.NaN), null);
});

test('hysteresis keeps insertion stable near boundaries and allows large jumps', () => {
    assert.equal(resolveInsertionIndexWithHysteresis([20, 50, 80], 24, 1, 8), 1);
    assert.equal(resolveInsertionIndexWithHysteresis([20, 50, 80], 16, 1, 8), 1);
    assert.equal(resolveInsertionIndexWithHysteresis([20, 50, 80], 59, 1, 8), 2);
    assert.equal(resolveInsertionIndexWithHysteresis([20, 50, 80], 41, 2, 8), 1);
    assert.equal(resolveInsertionIndexWithHysteresis([20, 50, 80], 100, 0, 8), 3);
    assert.equal(resolveInsertionIndexWithHysteresis([20, null, 80], 100, 0, 8), null);
});

test('validates rectangles and detects positive-area intersections', () => {
    const first = {x: 100, y: 100, width: 80, height: 40};
    assert.equal(isValidRectangle(first), true);
    assert.equal(rectanglesOverlap(first, {x: 150, y: 110, width: 40, height: 40}), true);
    assert.equal(rectanglesOverlap(first, {x: 180, y: 100, width: 20, height: 40}), false);
    assert.equal(rectanglesOverlap(first, {x: 0, y: 0, width: 0, height: 20}), false);
    assert.equal(rectanglesOverlap(first, {x: Number.NaN, y: 0, width: 20, height: 20}), false);
    assert.equal(rectanglesOverlap(first, {x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 20}), false);
});

test('computes rectangle intersections and unions', () => {
    assert.deepEqual(intersectRectangles(
        {x: 0, y: 0, width: 100, height: 100},
        {x: 50, y: 20, width: 100, height: 40},
    ), {x: 50, y: 20, width: 50, height: 40});
    assert.deepEqual(unionRectangles(
        {x: 10, y: 20, width: 30, height: 40},
        {x: 0, y: 35, width: 60, height: 10},
    ), {x: 0, y: 20, width: 60, height: 40});
    assert.equal(intersectRectangles(
        {x: 0, y: 0, width: 10, height: 10},
        {x: 10, y: 0, width: 10, height: 10},
    ), null);
});

const panelSource = await readFile(new URL('../src/panel/panel.ts', import.meta.url), 'utf8');
const visibilitySource = await readFile(new URL('../src/dock/dockVisibility.ts', import.meta.url), 'utf8');

test('topbar insertion and dock coverage reuse shared geometry', () => {
    assert.match(panelSource, /resolveInsertionIndex\(midpoints, dropX\)/);
    assert.match(visibilitySource, /rectanglesOverlap\(/);
});

test('resolves reorder indices with stable midpoint tie-breaking', () => {
    assert.equal(resolveReorderInsertionIndex([20, 50, 80], 0, 1), 0);
    assert.equal(resolveReorderInsertionIndex([20, 50, 80], 50, 2), 1);
    assert.equal(resolveReorderInsertionIndex([20, 50, 80], 50, 0), 1);
    assert.equal(resolveReorderInsertionIndex([20, 50, 80], 100, 1), 2);
    assert.equal(resolveReorderInsertionIndex([20, null, 80], 100, 0), null);
    assert.equal(resolveReorderInsertionIndex([20, 50], 30, 3), null);
});

const dockOrderSource = await readFile(new URL('../src/dock/dockOrder.ts', import.meta.url), 'utf8');
test('dock reorder delegates midpoint decisions to shared geometry', () => {
    assert.match(dockOrderSource, /resolveReorderInsertionIndex\(\s*midpoints, coordinate, state\.sourceIndex\)/);
});
