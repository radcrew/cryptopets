import type { Tactic } from '../combat/team';
import type { CanonicalWriter } from '../encoding/writer';

/**
 * Where a team-battle pet stands and how it picks targets (docs/battle-protocol.md §F).
 *
 * Shared by the three objects that carry placements, the defence plan, the team intent and
 * the team snapshot, so they validate and encode a placement one way. A tile is a column in
 * the side's own 3×3 zone (0 back, 1 mid, 2 front) and a row.
 */
export interface Placement {
    col: number;
    row: number;
    tactic: Tactic;
}

/** A tactic as one byte. The order is part of every encoding that carries a placement. */
export const TACTIC_CODES: Readonly<Record<Tactic, number>> = { focus: 0, breaker: 1, hunter: 2, bodyguard: 3 };

/**
 * Validates one side's placements: tiles inside the zone, no two pets on one tile, and a
 * known tactic. A shared tile is refused rather than resolved, because no engine rule says
 * which pet would stand there.
 */
export function assertPlacements(placements: readonly Placement[], label: string): void {
    const tiles = new Set<number>();
    placements.forEach((p, i) => {
        const where = `${label}[${i}]`;
        if (!isTileIndex(p.col) || !isTileIndex(p.row)) {
            throw new Error(`${where}: col and row must be 0, 1 or 2, got ${p.col}, ${p.row}`);
        }
        const tile = p.col * 3 + p.row;
        if (tiles.has(tile)) {
            throw new Error(`${where}: two pets share tile ${p.col},${p.row}`);
        }
        tiles.add(tile);
        if (!Object.hasOwn(TACTIC_CODES, p.tactic)) {
            throw new Error(`${where}: unknown tactic ${JSON.stringify(p.tactic)}`);
        }
    });
}

/** Writes a placement as three bytes: column, row, tactic. */
export function writePlacement(writer: CanonicalWriter, p: Placement): CanonicalWriter {
    return writer.u8(p.col).u8(p.row).u8(TACTIC_CODES[p.tactic]);
}

function isTileIndex(n: number): boolean {
    return n === 0 || n === 1 || n === 2;
}
