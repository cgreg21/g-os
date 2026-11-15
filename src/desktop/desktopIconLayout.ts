export function desktopIconLayoutKey(monitor, itemId) {
    return `${monitor.connector || `monitor-${monitor.index}`}|${itemId}`;
}

export function desktopSpecialFolderIcon(uri, specialFolders) {
    return specialFolders.find(folder => folder.uri === uri)?.iconName ?? null;
}

export function desktopIconGridPosition(index, monitor, cellSize, savedPosition = null, columnSpan = 1, alignment = 0,
    rowHeight = cellSize) {
    const cell = Math.max(64, cellSize);
    const rowStep = Math.max(cell, rowHeight);
    const span = Math.max(1, columnSpan);
    const tileWidth = cell * span;
    const columns = Math.max(1, Math.floor(Math.max(tileWidth, monitor.width - 48) / tileWidth));
    const rows = Math.max(1, Math.floor(Math.max(rowStep, monitor.height - 72) / rowStep));
    const capacity = columns * rows;
    const page = Math.floor(index / capacity);
    const column = Math.floor(index % capacity / rows);
    const defaultPosition = {
        x: alignment === 1 ? monitor.width - 24 - tileWidth - column * tileWidth : 24 + column * tileWidth,
        y: 48 + index % rows * rowStep + page * rows * rowStep,
    };
    const requested = alignment === 2 && savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y)
        ? savedPosition : defaultPosition;
    const minX = 24;
    const minY = 48;
    const maxX = minX + Math.floor(Math.max(0, monitor.width - tileWidth - minX) / cell) * cell;
    const maxY = minY + Math.floor(Math.max(0, monitor.height - rowStep - minY) / rowStep) * rowStep;
    const x = alignment === 1 ? requested.x
        : minX + Math.round((requested.x - minX) / cell) * cell;
    return {
        x: Math.max(minX, Math.min(alignment === 1 ? monitor.width - 24 - tileWidth : maxX, x)),
        y: alignment === 2 && savedPosition
            ? Math.max(minY, Math.min(maxY, minY + Math.round((requested.y - minY) / rowStep) * rowStep))
            : defaultPosition.y,
    };
}

export function classifyDesktopMount(uri, removable = false) {
    const scheme = String(uri).match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase() ?? '';
    if (scheme && scheme !== 'file')
        return 'network';
    return removable ? 'removable' : null;
}