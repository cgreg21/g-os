/** Axis-aligned rectangle geometry shared by screen and dock interactions. */
export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

export function isValidRectangle(rectangle: Rectangle): boolean {
    if (![rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite) ||
        rectangle.width <= 0 || rectangle.height <= 0)
        return false;
    const right = rectangle.x + rectangle.width;
    const bottom = rectangle.y + rectangle.height;
    return Number.isFinite(right) && right > rectangle.x &&
        Number.isFinite(bottom) && bottom > rectangle.y;
}

export function intersectRectangles(first: Rectangle, second: Rectangle): Rectangle | null {
    if (!isValidRectangle(first) || !isValidRectangle(second))
        return null;
    const left = Math.max(first.x, second.x);
    const top = Math.max(first.y, second.y);
    const right = Math.min(first.x + first.width, second.x + second.width);
    const bottom = Math.min(first.y + first.height, second.y + second.height);
    const width = right - left;
    const height = bottom - top;
    if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0)
        return null;
    const intersection = {x: left, y: top, width, height};
    return isValidRectangle(intersection) ? intersection : null;
}

export function rectanglesOverlap(first: Rectangle, second: Rectangle): boolean {
    return intersectRectangles(first, second) !== null;
}

export function unionRectangles(first: Rectangle, second: Rectangle): Rectangle | null {
    if (!isValidRectangle(first) || !isValidRectangle(second))
        return null;
    const left = Math.min(first.x, second.x);
    const top = Math.min(first.y, second.y);
    const right = Math.max(first.x + first.width, second.x + second.width);
    const bottom = Math.max(first.y + first.height, second.y + second.height);
    const width = right - left;
    const height = bottom - top;
    if (![right, bottom, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
        return null;
    return {x: left, y: top, width, height};
}
