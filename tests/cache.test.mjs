import assert from 'node:assert/strict';
import test from 'node:test';
import {GOSCache} from '../dist/core/cache.js';

test('stores generic values and distinguishes a cached undefined value', () => {
    const cache = new GOSCache();
    cache.set('undefined', undefined);
    assert.equal(cache.has('undefined'), true);
    assert.equal(cache.get('undefined'), undefined);
    assert.equal(cache.get('missing'), undefined);
});

test('refreshes least-recently-used entries and evicts the oldest', () => {
    const cache = new GOSCache(2);
    cache.set('first', 1);
    cache.set('second', 2);
    assert.equal(cache.get('first'), 1);
    cache.set('third', 3);
    assert.equal(cache.has('second'), false);
    assert.equal(cache.get('first'), 1);
    assert.equal(cache.get('third'), 3);
});

test('expires entries lazily and supports a zero TTL', () => {
    const cache = new GOSCache(4, 100);
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
        cache.set('short-lived', 'value', 10);
        assert.equal(cache.get('short-lived'), 'value');
        now += 10;
        assert.equal(cache.has('short-lived'), false);
        cache.set('immediate', 'value', 0);
        assert.equal(cache.get('immediate'), undefined);
        cache.set('invalid-duration', 'value', Number.NaN);
        assert.equal(cache.has('invalid-duration'), false);
    } finally {
        Date.now = originalNow;
    }
});

test('getOrCreate constructs once and exposes hit/miss statistics', () => {
    const cache = new GOSCache();
    let calls = 0;
    const factory = () => ++calls;
    assert.equal(cache.getOrCreate('key', factory), 1);
    assert.equal(cache.getOrCreate('key', factory), 1);
    assert.equal(calls, 1);
    assert.deepEqual(cache.statistics, {size: 1, hits: 1, misses: 1});
});

test('clear releases cached values and resets statistics', () => {
    const cache = new GOSCache();
    cache.set('key', 'value');
    cache.get('key');
    cache.clear();
    assert.deepEqual(cache.statistics, {size: 0, hits: 0, misses: 0});
});

test('normalizes invalid capacities and remains bounded', () => {
    const zeroCapacity = new GOSCache(0);
    zeroCapacity.set('key', 'value');
    assert.equal(zeroCapacity.size, 0);

    const invalidCapacity = new GOSCache(Number.NaN);
    for (let index = 0; index < 513; index++)
        invalidCapacity.set(String(index), index);
    assert.equal(invalidCapacity.size, 512);

    const fractionalCapacity = new GOSCache(1.9);
    fractionalCapacity.set('first', 1);
    fractionalCapacity.set('second', 2);
    assert.equal(fractionalCapacity.size, 1);
});

test('dock folder listings use a short-lived cache and skip caching cancelled reads', async () => {
    const {readFile} = await import('node:fs/promises');
    const source = await readFile(new URL('../src/dock/dockFolders.ts', import.meta.url), 'utf8');
    assert.match(source, /dock-folder-contents:\$\{folder\.get_uri\(\)\}/);
    assert.match(source, /this\._cache\?\.get\(cacheKey\) as DockFolderEntry\[\] \\| undefined/);
    assert.match(source, /if \(!cancellable\.is_cancelled\(\)\)\s+this\._cache\?\.set\(cacheKey, files, DOCK_FOLDER_CACHE_TTL_MS\)/);
    assert.match(source, /const DOCK_FOLDER_CACHE_TTL_MS = 2000/);
});

test('the extension owns the shared cache and releases it on disable', async () => {
    const {readFile} = await import('node:fs/promises');
    const source = await readFile(new URL('../src/extension.ts', import.meta.url), 'utf8');
    assert.match(source, /this\._cache = new GOSCache\(256, 5 \* 60 \* 1000\)/);
    assert.match(source, /this\._cache\?\.clear\(\);\s+this\._cache = null;/);
});
