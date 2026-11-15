import assert from 'node:assert/strict';
import test from 'node:test';
import {
    classifyDesktopMount,
    desktopIconGridPosition,
    desktopIconLayoutKey,
    desktopSpecialFolderIcon,
} from '../dist/desktop/desktopIconLayout.js';

const monitor = {index: 1, connector: 'DP-1', width: 1280, height: 720};

test('desktop layout keys prefer monitor connectors and fall back to stable indices', () => {
    assert.equal(desktopIconLayoutKey(monitor, 'home'), 'DP-1|home');
    assert.equal(desktopIconLayoutKey({index: 2}, 'home'), 'monitor-2|home');
});

test('special-folder icon lookup only returns an icon for the exact URI', () => {
    const folders = [{uri: 'file:///home/user/Documents', iconName: 'folder-documents'}];
    assert.equal(desktopSpecialFolderIcon(folders[0].uri, folders), 'folder-documents');
    assert.equal(desktopSpecialFolderIcon('file:///home/user/Downloads', folders), null);
});

test('desktop items flow through a bounded grid and continue onto later rows', () => {
    assert.deepEqual(desktopIconGridPosition(0, monitor, 96), {x: 24, y: 48});
    assert.deepEqual(desktopIconGridPosition(6, monitor, 96), {x: 120, y: 48});
    const positions = Array.from({length: 100}, (_, index) => desktopIconGridPosition(index, monitor, 96));
    assert.equal(new Set(positions.map(({x, y}) => `${x},${y}`)).size, positions.length);
    assert.ok(positions.at(-1).y > monitor.height);
});

test('saved free-form positions snap to the grid and stay inside the monitor', () => {
    assert.deepEqual(desktopIconGridPosition(0, monitor, 96, {x: 247, y: 173}, 1, 2),
        {x: 216, y: 144});
    assert.deepEqual(desktopIconGridPosition(0, monitor, 96, {x: 9000, y: 9000}, 1, 2),
        {x: 1176, y: 624});
});

test('right-aligned and multi-column icons respect their tile width', () => {
    assert.deepEqual(desktopIconGridPosition(0, monitor, 96, null, 1, 1),
        {x: 1160, y: 48});
    assert.deepEqual(desktopIconGridPosition(0, monitor, 96, null, 2, 0),
        {x: 24, y: 48});
});

test('mount classification distinguishes local, removable and network locations', () => {
    assert.equal(classifyDesktopMount('file:///home/user'), null);
    assert.equal(classifyDesktopMount('file:///run/media/user/USB', true), 'removable');
    assert.equal(classifyDesktopMount('smb://server/share'), 'network');
    assert.equal(classifyDesktopMount('HTTPS://example.test'), 'network');
    assert.equal(classifyDesktopMount('/mnt/usb', true), 'removable');
});
