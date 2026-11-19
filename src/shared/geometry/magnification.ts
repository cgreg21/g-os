export interface DockMagnificationInput {
    centers: readonly number[];
    buttonSizes: readonly number[];
    excluded: readonly boolean[];
    coordinate: number | null;
    maximumScale: number;
    radius: number;
    engaged: boolean;
    viewStart: number;
    viewEnd: number;
}

export interface DockMagnificationGeometry {
    scales: number[];
    shifts: number[];
    growth: number;
    start: number;
}

/** Pure dock magnification layout calculation, independent of GNOME actors. */
export function calculateDockMagnificationGeometry(
    input: DockMagnificationInput,
): DockMagnificationGeometry | null {
    const {
        centers, buttonSizes, excluded, coordinate, maximumScale, radius,
        engaged, viewStart, viewEnd,
    } = input;
    const count = centers.length;
    if (buttonSizes.length !== count || excluded.length !== count ||
        ![maximumScale, radius, viewStart, viewEnd].every(Number.isFinite) ||
        (coordinate !== null && !Number.isFinite(coordinate)) ||
        centers.some((center, index) => !Number.isFinite(center) ||
            (index > 0 && center < centers[index - 1])) ||
        buttonSizes.some(size => !Number.isFinite(size) || size < 0) ||
        maximumScale < 1 || radius < 0 || viewEnd < viewStart)
        return null;

    let pointerIndex = 0;
    if (coordinate !== null && Number.isFinite(coordinate)) {
        const next = centers.findIndex(center => center >= coordinate);
        if (next === -1)
            pointerIndex = count - 1;
        else if (next > 0 && centers[next] !== centers[next - 1])
            pointerIndex = next - 1 +
                (coordinate - centers[next - 1]) / (centers[next] - centers[next - 1]);
    }

    const clamp = (value: number, minimum: number, maximum: number) =>
        Math.min(maximum, Math.max(minimum, value));
    let scales = centers.map((_center, index) => {
        const distance = Math.abs(index - pointerIndex);
        const progress = Math.min(1, distance / (radius + 1));
        const falloff = 1 - progress * progress * (3 - 2 * progress);
        if (!engaged || excluded[index])
            return 1;
        const value = 1 + (maximumScale - 1) * falloff;
        return Number.isFinite(value) ? clamp(value, 1, maximumScale) : 1;
    });

    const visibleIndices = centers.map((center, index) =>
        center >= viewStart && center <= viewEnd ? index : -1).filter(index => index >= 0);
    if (visibleIndices.length > 0) {
        const first = visibleIndices[0];
        const last = visibleIndices[visibleIndices.length - 1];
        const occupied = centers[last] - centers[first] +
            (buttonSizes[first] + buttonSizes[last]) / 2;
        const availableGrowth = Math.max(0, viewEnd - viewStart - occupied);
        const requestedGrowth = visibleIndices.reduce((total, index) =>
            total + buttonSizes[index] * (scales[index] - 1) * 2, 0);
        const fit = requestedGrowth > availableGrowth && requestedGrowth > 0
            ? availableGrowth / requestedGrowth : 1;
        if (fit < 1)
            scales = scales.map(scale => 1 + (scale - 1) * fit);
    }

    let extra = 0;
    const offsets = scales.map((scale, index) => {
        // Each dock button can have a different base size (for example,
        // widgets and launchers); use its own dimensions for scale growth.
        const growth = buttonSizes[index]! * (scale - 1);
        const offset = extra + growth / 2;
        extra += growth;
        return Number.isFinite(offset) ? offset : 0;
    });

    let left = -1;
    let right = -1;
    if (coordinate !== null && Number.isFinite(coordinate)) {
        centers.forEach((center, index) => {
            if (center <= coordinate && (left === -1 || center > centers[left]))
                left = index;
            if (center >= coordinate && (right === -1 || center < centers[right]))
                right = index;
        });
    }

    let anchorOffset = 0;
    if (left === -1) {
        if (right !== -1)
            anchorOffset = offsets[right];
    } else if (right === -1) {
        anchorOffset = offsets[left];
    } else if (left === right || centers[left] === centers[right]) {
        anchorOffset = offsets[left];
    } else {
        const progress = (coordinate! - centers[left]) / (centers[right] - centers[left]);
        anchorOffset = offsets[left] + (offsets[right] - offsets[left]) * progress;
    }

    const shifts = offsets.map((offset, index) => {
        let shift = offset - anchorOffset;
        if (coordinate !== null && centers[index] >= viewStart && centers[index] <= viewEnd) {
            const halfSize = buttonSizes[index] * scales[index] / 2;
            shift = Math.max(viewStart + halfSize - centers[index],
                Math.min(viewEnd - halfSize - centers[index], shift));
        }
        return Number.isFinite(shift) ? shift : 0;
    });

    return {
        scales,
        shifts,
        growth: Number.isFinite(extra) ? extra : 0,
        start: shifts.length > 0 && Number.isFinite(shifts[0])
            ? shifts[0] - buttonSizes[0]! * (scales[0]! - 1) / 2
            : 0,
    };
}
