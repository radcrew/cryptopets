import { bonusFromEquipment } from '../combat/equipment';
import { simulateTeam, type TeamFighter, type TeamOutcome } from '../combat/team';
import { drawDefenders, ROSTER_SIZE, SQUAD_SIZE } from '../combat/teamDraw';
import { assertProtocolDomain, type ProtocolDomain, writeHeader } from '../domain/deployment';
import { assertPlacements, type Placement, writePlacement } from '../domain/placement';
import { DUEL_SCHEMA_VERSIONS, TEAM_SCHEMA_VERSIONS } from '../domain/schemaVersions';
import type { Hex } from '../encoding/bytes';
import { DOMAIN_TAGS } from '../encoding/domain';
import { keccak256Hex } from '../encoding/hash';
import { CanonicalWriter } from '../encoding/writer';
import type { Ruleset } from '../ruleset/types';

import { hashBattleSnapshot, writePetSnapshot } from './hash';
import { assertBattleSnapshot, assertPetSnapshot, type BattleSnapshot, type PetSnapshot } from './types';

/**
 * Every pet in a team battle, frozen at acceptance: snapshot schema version 3.
 *
 * The duel snapshot's two jobs, for eight pets: the three attackers and the defender's whole
 * five-pet roster. The whole roster rather than the three who fight, because the draw that
 * picks them runs on the battle seed, and the seed is derived from this snapshot's hash; the
 * three are known only once the seed is, so all five have to be frozen first. Each pet is
 * frozen exactly as a duel freezes one (the version 2 layout, equipment included), with its
 * placement and, for the roster, its rank.
 */
export interface TeamBattleSnapshot {
    domain: ProtocolDomain;
    /** Exactly three, in slot order. */
    attackers: SquadMember[];
    /** Exactly five, in roster order. */
    roster: RosterMember[];
    takenAt: number;
    /** Always 3. Required rather than defaulted: an absent version means a version 1 duel. */
    schemaVersion: number;
}

export interface SquadMember extends Placement {
    pet: PetSnapshot;
}

export interface RosterMember extends SquadMember {
    rank: number;
}

/** Validates an untrusted team snapshot, returning a normalized copy. */
export function assertTeamBattleSnapshot(snapshot: TeamBattleSnapshot): TeamBattleSnapshot {
    const domain = assertProtocolDomain(snapshot.domain);
    if (snapshot.schemaVersion !== TEAM_SCHEMA_VERSIONS.snapshot) {
        throw new Error(`a team snapshot is schema version ${TEAM_SCHEMA_VERSIONS.snapshot}, got ${snapshot.schemaVersion}`);
    }
    if (!Array.isArray(snapshot.attackers) || snapshot.attackers.length !== SQUAD_SIZE) {
        throw new Error(`a team snapshot has exactly ${SQUAD_SIZE} attackers`);
    }
    if (!Array.isArray(snapshot.roster) || snapshot.roster.length !== ROSTER_SIZE) {
        throw new Error(`a team snapshot has exactly ${ROSTER_SIZE} roster pets`);
    }

    const attackers = snapshot.attackers.map((m, i) => ({
        pet: assertPetSnapshot(m.pet, `attackers[${i}]`),
        col: m.col,
        row: m.row,
        tactic: m.tactic,
    }));
    const roster = snapshot.roster.map((m, i) => ({
        pet: assertPetSnapshot(m.pet, `roster[${i}]`),
        rank: m.rank,
        col: m.col,
        row: m.row,
        tactic: m.tactic,
    }));
    assertPlacements(attackers, 'attackers');
    assertPlacements(roster, 'roster');

    const ranks = roster.map((m) => m.rank).sort((a, b) => a - b);
    if (ranks.some((rank, i) => rank !== i + 1)) {
        throw new Error(`roster ranks must be 1 to ${ROSTER_SIZE}, each used once; got ${roster.map((m) => m.rank).join(', ')}`);
    }

    const ids = [...attackers, ...roster].map((m) => m.pet.petId);
    if (new Set(ids).size !== ids.length) {
        throw new Error('a pet appears twice in one team battle');
    }
    // One owner a side, and not the same owner on both: the snapshot freezes who owned each
    // pet, and a battle the intent and plan could never have authorized is not one to hash.
    const attackerOwner = attackers[0]?.pet.owner;
    const defenderOwner = roster[0]?.pet.owner;
    if (attackers.some((m) => m.pet.owner !== attackerOwner) || roster.some((m) => m.pet.owner !== defenderOwner)) {
        throw new Error('every pet on one side of a team battle must have the same owner');
    }
    if (attackerOwner === defenderOwner) {
        throw new Error('a team battle cannot pit one owner against themselves');
    }

    if (!Number.isSafeInteger(snapshot.takenAt) || snapshot.takenAt < 1 || snapshot.takenAt > 0xffffffffffff) {
        throw new Error(`takenAt must be a unix-seconds integer >= 1, got ${snapshot.takenAt}`);
    }
    return { domain, attackers, roster, takenAt: snapshot.takenAt, schemaVersion: TEAM_SCHEMA_VERSIONS.snapshot };
}

/**
 * Canonical encoding: header at version 3, the attackers in slot order (each pet in the
 * duel's version 2 layout, then its placement), the roster in order (pet, rank, placement),
 * and `takenAt`.
 */
export function encodeTeamBattleSnapshot(snapshot: TeamBattleSnapshot): Uint8Array {
    const checked = assertTeamBattleSnapshot(snapshot);
    const petLayout = DUEL_SCHEMA_VERSIONS.snapshot;
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.SNAPSHOT);
    writeHeader(writer, 'snapshot', checked.domain, TEAM_SCHEMA_VERSIONS.snapshot)
        .array(checked.attackers, (w, m) => {
            writePetSnapshot(w, m.pet, petLayout);
            writePlacement(w, m);
        })
        .array(checked.roster, (w, m) => {
            writePetSnapshot(w, m.pet, petLayout);
            writePlacement(w.u8(m.rank), m);
        });
    return writer.u64(checked.takenAt).build();
}

/** A team battle's `snapshotHash`: carried by the commitment and the receipt, and an input
 *  to the battle seed exactly as a duel's is. */
export function hashTeamBattleSnapshot(snapshot: TeamBattleSnapshot): Hex {
    return keccak256Hex(encodeTeamBattleSnapshot(snapshot));
}

/** A snapshot of either kind, for the objects that carry one by hash: the commitment. */
export type AnyBattleSnapshot = BattleSnapshot | TeamBattleSnapshot;

export function isTeamBattleSnapshot(snapshot: AnyBattleSnapshot): snapshot is TeamBattleSnapshot {
    return snapshot.schemaVersion === TEAM_SCHEMA_VERSIONS.snapshot;
}

export function assertAnyBattleSnapshot(snapshot: AnyBattleSnapshot): AnyBattleSnapshot {
    return isTeamBattleSnapshot(snapshot) ? assertTeamBattleSnapshot(snapshot) : assertBattleSnapshot(snapshot);
}

export function hashAnyBattleSnapshot(snapshot: AnyBattleSnapshot): Hex {
    return isTeamBattleSnapshot(snapshot) ? hashTeamBattleSnapshot(snapshot) : hashBattleSnapshot(snapshot);
}

/** What replaying a team battle produces. */
export interface TeamReplay {
    /** Roster indices of the three defenders, in roster order. */
    drawn: number[];
    outcome: TeamOutcome;
}

/**
 * Replays a team battle from its snapshot, seed and ruleset: the draw, then the team engine.
 *
 * The one place a snapshot becomes engine inputs, so the backend that computes a battle and
 * the verifier that checks it cannot build them differently. Ruleset layout 3 has no
 * Attributes 2.0 data, so every pet fights neutral: Melee, no temperament, and the `int`
 * turn order the ruleset is required to name.
 */
export function replayTeamBattle(snapshot: TeamBattleSnapshot, seed: Hex, ruleset: Ruleset): TeamReplay {
    const checked = assertTeamBattleSnapshot(snapshot);
    if (!ruleset.teamConfig) {
        throw new Error(`ruleset version ${ruleset.version} has no team rules`);
    }
    const seedValue = BigInt(seed);
    const drawn = drawDefenders(checked.roster.map((m) => m.rank), seedValue);
    const defenders = drawn.map((index) => {
        const member = checked.roster[index];
        if (!member) throw new Error(`draw picked roster index ${index}, which does not exist`);
        return member;
    });
    const outcome = simulateTeam(
        checked.attackers.map(toFighter),
        defenders.map(toFighter),
        seedValue,
        ruleset.skillConfig,
        ruleset.teamConfig,
    );
    return { drawn, outcome };
}

function toFighter(member: SquadMember): TeamFighter {
    const { pet } = member;
    return {
        dna: pet.dna,
        rarity: pet.rarity,
        level: pet.level,
        skill: pet.skill,
        bonus: bonusFromEquipment(pet.equipment),
        col: member.col,
        row: member.row,
        tactic: member.tactic,
        range: 'melee',
        temperament: 'none',
        speed: 0,
    };
}
