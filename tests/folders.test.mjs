import assert from 'node:assert/strict';
import test from 'node:test';
import {folderViewOptions, readAppFolders, writeAppFolders} from '../dist/shared/appFolders.js';

function createSettings(initial = {}) {
    const values = new Map(Object.entries(initial));
    const writable = new Set(['dock-app-folders']);
    return {
        values,
        writable,
        get_string(key) { return values.get(key) ?? ''; },
        get_value(key) { return {deep_unpack: () => values.get(key) ?? {}}; },
        is_writable(key) { return writable.has(key); },
        set_string(key, value) { values.set(key, value); return true; },
    };
}

test('folder loading sanitizes malformed entries, duplicate ids and duplicate applications', () => {
    const settings = createSettings({'dock-app-folders': JSON.stringify([
        {id: 'media', name: '  Media  ', apps: ['music.desktop', 'music.desktop', 'bad.txt'],
            icon: 'folder-music', view: 1},
        {id: 'media', name: 'Duplicate', apps: ['video.desktop']},
        {id: '../bad', name: 'Invalid id', apps: []},
        {id: 'tools', name: '   ', apps: ['music.desktop', 'calculator.desktop'], icon: 42, view: 8},
        null,
    ])});
    assert.deepEqual(readAppFolders(settings), [
        {id: 'media', name: 'Media', apps: ['music.desktop'], icon: 'folder-music', view: 1},
        {id: 'tools', name: 'Applications', apps: ['calculator.desktop'], icon: '', view: -1},
    ]);
});

test('invalid stored JSON produces an empty folder list', () => {
    assert.deepEqual(readAppFolders(createSettings({'dock-app-folders': '{'})), []);
    assert.deepEqual(readAppFolders(createSettings({'dock-app-folders': '{"not":"a list"}'})), []);
    assert.deepEqual(readAppFolders({is_writable: () => false, set_string: () => false}), []);
});

test('folder writes are blocked by locked settings and otherwise persist the full list', () => {
    const settings = createSettings();
    const folders = [{id: 'work', name: 'Work', apps: ['editor.desktop'], icon: '', view: -1}];
    assert.equal(writeAppFolders(settings, folders), true);
    assert.deepEqual(JSON.parse(settings.values.get('dock-app-folders')), folders);
    settings.writable.clear();
    assert.equal(writeAppFolders(settings, []), false);
    assert.deepEqual(JSON.parse(settings.values.get('dock-app-folders')), folders);
});

test('view options combine defaults and per-folder overrides while rejecting out-of-range values', () => {
    const settings = createSettings({'dock-view-options': {
        pile: {'icon-size': 64, spacing: 99, 'max-files': 0},
        'folder-a:pile': {'icon-size': 32, spacing: 4, 'text-size': 100},
    }});
    assert.deepEqual(folderViewOptions(settings, 'pile', 'folder-a'), {
        'text-size': 12,
        'icon-size': 32,
        spacing: 4,
        'max-files': 9,
        'sort-order': 0,
    });
    assert.deepEqual(folderViewOptions(settings, 'grille').rows, 6);
});

test('unknown folder views and malformed stored options fall back safely', () => {
    const settings = createSettings({'dock-view-options': {
        pile: null,
        'folder-a:pile': ['not', 'an', 'options', 'object'],
    }});
    assert.deepEqual(folderViewOptions(settings, 'unknown'), {});
    assert.deepEqual(folderViewOptions(settings, 'pile', 'folder-a'), {
        'text-size': 12,
        'icon-size': 48,
        spacing: 6,
        'max-files': 9,
        'sort-order': 0,
    });

    const brokenSettings = {
        ...settings,
        get_value() { throw new Error('invalid setting variant'); },
    };
    assert.deepEqual(folderViewOptions(brokenSettings, 'grille'), {
        'text-size': 10,
        'icon-size': 36,
        'horizontal-spacing': 8,
        'vertical-spacing': 8,
        columns: 4,
        rows: 6,
        'sort-order': 0,
    });
});
