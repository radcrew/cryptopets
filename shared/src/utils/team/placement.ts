/**
 * Where a pet goes when it joins a team without being placed: the front line first, the middle
 * row first, so a pet added without a choice stands where it fights. Shared by the squad a
 * player challenges with and the defence plan they save, so both fill their zone the same way.
 * Tiles are [col, row] in the owner's own zone, col 2 the front.
 */
export const DEFAULT_TILE_ORDER: readonly (readonly [number, number])[] = [
    [2, 1],
    [2, 0],
    [2, 2],
    [1, 1],
    [1, 0],
    [1, 2],
    [0, 1],
    [0, 0],
    [0, 2],
];

/** The first tile in `DEFAULT_TILE_ORDER` nobody in `taken` stands on, or undefined when all are. */
export function firstFreeTile(taken: readonly { col: number; row: number }[]): readonly [number, number] | undefined {
    return DEFAULT_TILE_ORDER.find(([col, row]) => !taken.some((t) => t.col === col && t.row === row));
}
