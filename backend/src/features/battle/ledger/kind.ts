/**
 * Duels and team battles share the ledger, intent and receipt tables (docs/plan-team-battles-3v3.md,
 * Phase 4), marked by `kind`. A duel's single attacker and defender pet columns are null on a team
 * battle, so code that only ever handles duels narrows a row with `assertDuel` first.
 *
 * It cannot fail on a real duel: the `*_kind_shape` CHECK constraints keep both columns filled on
 * every duel row. What it does is turn "this code assumes a duel" from a silent assumption into a
 * loud one, so a team battle routed into duel-only code fails at the door rather than as a null
 * three calls deeper.
 */
export const BATTLE_KIND = { duel: 'duel', team: 'team' } as const;
export type BattleKind = (typeof BATTLE_KIND)[keyof typeof BATTLE_KIND];

export interface DuelColumns {
    attackerPetId: string;
    defenderPetId: string;
}

export function assertDuel<T extends { kind: string; attackerPetId: string | null; defenderPetId: string | null }>(
    row: T,
): T & DuelColumns {
    if (row.kind !== BATTLE_KIND.duel || row.attackerPetId === null || row.defenderPetId === null) {
        throw new Error(`expected a duel, got a ${row.kind} battle`);
    }
    return row as T & DuelColumns;
}
