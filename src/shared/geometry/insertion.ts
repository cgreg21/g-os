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
