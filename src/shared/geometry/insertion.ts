/**
 * Resolve an insertion slot from item midpoints on a single axis.
 * Works for horizontal and vertical layouts and refuses incomplete geometry.
 */
export function resolveInsertionIndex(
    midpoints: readonly (number | null)[],
    coordinate: number,
): number | null {
    if (!Number.isFinite(coordinate) ||
        midpoints.some(midpoint => midpoint === null || !Number.isFinite(midpoint)))
        return null;

    let index = 0;
    for (const midpoint of midpoints) {
        if (midpoint !== null && coordinate > midpoint)
            index++;
    }
    return index;
}

/**
 * Preserve the current insertion slot until the pointer crosses a midpoint
 * plus/minus the hysteresis distance, preventing jitter at item boundaries.
 */
export function resolveInsertionIndexWithHysteresis(
    midpoints: readonly (number | null)[],
    coordinate: number,
    currentIndex: number | null,
    hysteresis = 10,
): number | null {
    if (!Number.isFinite(coordinate) || !Number.isFinite(hysteresis) || hysteresis < 0 ||
        midpoints.some(midpoint => midpoint === null || !Number.isFinite(midpoint)))
        return null;

    if (currentIndex === null || !Number.isInteger(currentIndex) ||
        currentIndex < 0 || currentIndex > midpoints.length)
        return resolveInsertionIndex(midpoints, coordinate);

    let index = currentIndex;
    while (index < midpoints.length && coordinate > midpoints[index]! + hysteresis)
        index++;
    while (index > 0 && coordinate < midpoints[index - 1]! - hysteresis)
        index--;
    return index;
}

/**
 * Resolve the destination index for a reorder operation where the dragged
 * item is removed from its original slot before insertion. Equal midpoints
 * retain the original stable tie-breaking behavior.
 */
export function resolveReorderInsertionIndex(
    midpoints: readonly (number | null)[],
    coordinate: number,
    sourceIndex: number,
): number | null {
    if (!Number.isFinite(coordinate) || !Number.isInteger(sourceIndex) ||
        sourceIndex < 0 || sourceIndex >= midpoints.length ||
        midpoints.some(midpoint => midpoint === null || !Number.isFinite(midpoint)))
        return null;

    let targetIndex = midpoints.findIndex((midpoint, index) =>
        coordinate < midpoint! || (coordinate === midpoint && sourceIndex > index));
    if (targetIndex < 0)
        targetIndex = midpoints.length;
    if (sourceIndex < targetIndex)
        targetIndex--;
    return targetIndex;
}
