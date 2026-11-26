/**
 * Schema versions for every signed or hashed protocol object.
 *
 * Each object carries its own version inside the bytes that get hashed, so a
 * digest states which field list produced it. Two rules make that useful:
 *
 * - **Bump on any encoding change.** Adding, removing, reordering, or retyping a
 *   field changes what a digest means. Reusing the version would leave two
 *   incompatible layouts claiming to be the same thing, and no verifier could
 *   tell which one a historical receipt used.
 * - **An unknown version is a hard error.** Never parse an object at a version
 *   this build does not implement, and never fall back to the nearest known
 *   layout. Refusing is recoverable (upgrade the verifier); a best-effort read
 *   produces a confident wrong answer.
 *
 * Old versions stay listed here as they accumulate, because historical receipts
 * must keep verifying.
 *
 * **Some kinds have two live layouts.** Team battles (docs/battle-protocol.md §F) arrived
 * as new versions of the intent, snapshot, receipt and combat log, while duels carry on
 * in the layouts they always had. For those kinds the highest version here is not "the
 * one to write": a duel writes `DUEL_SCHEMA_VERSIONS`, a team battle writes
 * `TEAM_SCHEMA_VERSIONS`, and every producer names one of the two explicitly.
 */
export const SCHEMA_VERSIONS = {
    /** 2 is a team battle's intent; duels still write 1. */
    intent: 2,
    defenseAuthorization: 1,
    /** A team battle's defence plan: the roster, its ranks, tiles and tactics, and consent. */
    defensePlan: 1,
    /** Delegated battle-intent signing (§D). Not carried by any receipt. */
    sessionDelegation: 1,
    /** 2 adds per-pet equipment (roadmap §4). Version 1 snapshots carry none. 3 is a team
     *  battle's snapshot; duels still write 2. */
    snapshot: 3,
    /** 2 adds the combat-affecting item catalog (roadmap §4). 3 adds the team rules. */
    ruleset: 3,
    /** One layout serves both battle types: its snapshot and consent fields are hashes,
     *  and each of those names its own kind and version. */
    commitment: 1,
    /** 2 is a team battle's receipt; duels still write 1. */
    receipt: 2,
    /** 2 is a team battle's log; duels still write 1. */
    combatLog: 2,
    merkleLeaf: 1,
    merkleRewardLeaf: 1,
} as const;

/** Kinds of object this protocol versions. */
export type SchemaKind = keyof typeof SCHEMA_VERSIONS;

/** Versions this build can produce and verify, per kind. */
const SUPPORTED_VERSIONS: Record<SchemaKind, readonly number[]> = {
    intent: [1, 2],
    defenseAuthorization: [1],
    defensePlan: [1],
    sessionDelegation: [1],
    // 1 stays supported: every receipt signed before equipment existed names a v1
    // snapshot, and those have to keep verifying forever (§H).
    snapshot: [1, 2, 3],
    // 1 stays supported for the same reason: bundles published before equipment
    // existed are named by receipts that must keep verifying.
    ruleset: [1, 2, 3],
    commitment: [1],
    receipt: [1, 2],
    combatLog: [1, 2],
    merkleLeaf: [1],
    merkleRewardLeaf: [1],
};

/**
 * The layouts a duel writes. Pinned rather than read from `SCHEMA_VERSIONS`, because adding
 * team battles raised those numbers without changing what a duel is.
 */
export const DUEL_SCHEMA_VERSIONS = { intent: 1, snapshot: 2, receipt: 1, combatLog: 1 } as const;

/** The layouts a team battle writes. */
export const TEAM_SCHEMA_VERSIONS = { intent: 2, defensePlan: 1, snapshot: 3, receipt: 2, combatLog: 2 } as const;

/**
 * The highest version this build implements for `kind`. For a kind with a duel and a team
 * layout, write the one from `DUEL_SCHEMA_VERSIONS` or `TEAM_SCHEMA_VERSIONS` instead.
 */
export function currentSchemaVersion(kind: SchemaKind): number {
    return SCHEMA_VERSIONS[kind];
}

/**
 * Throws unless this build implements `version` of `kind`. Call before reading an
 * object that came from outside this process, including our own older receipts.
 */
export function assertSupportedSchemaVersion(kind: SchemaKind, version: number): void {
    const supported = SUPPORTED_VERSIONS[kind];
    if (!supported) {
        throw new Error(`unknown protocol object kind: ${kind}`);
    }
    if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error(`${kind} schema version must be a positive integer, got ${version}`);
    }
    if (!supported.includes(version)) {
        throw new Error(
            `unsupported ${kind} schema version ${version}; this build implements ${supported.join(', ')}`,
        );
    }
}
