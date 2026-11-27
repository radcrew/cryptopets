import { bonusFromEquipment } from '../combat/equipment';
import { simulateTeam, SQUAD_SIZE, type TeamFighter, type TeamOutcome } from '../combat/team';
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
 * The duel snapshot's two jobs, for six pets: the three attackers and the defender's three,
 * the roster their plan names. Each pet is frozen exactly as a duel freezes one (the version
 * 2 layout, equipment included), with its placement.
 */
export interface TeamBattleSnapshot {
    domain: ProtocolDomain;
    /** Exactly three, in slot order. */
    attackers: SquadMember[];
    /** The defenders: exactly three, in the plan's roster order, which is their slot order. */
    roster: SquadMember[];
    takenAt: number;
    /** Always 3. Required rather than defaulted: an absent version means a version 1 duel. */
    schemaVersion: number;
}

export interface SquadMember extends Placement {
    pet: PetSnapshot;
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
    if (!Array.isArray(snapshot.roster) || snapshot.roster.length !== SQUAD_SIZE) {
        throw new Error(`a team snapshot has exactly ${SQUAD_SIZE} defenders`);
    }

    const member = (m: SquadMember, label: string): SquadMember => ({
        pet: assertPetSnapshot(m.pet, label),
        col: m.col,
        row: m.row,
        tactic: m.tactic,
    });
    const attackers = snapshot.attackers.map((m, i) => member(m, `attackers[${i}]`));
    const roster = snapshot.roster.map((m, i) => member(m, `roster[${i}]`));
    assertPlacements(attackers, 'attackers');
    assertPlacements(roster, 'roster');

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
 * Canonical encoding: header at version 3, the attackers in slot order, then the defenders
 * in slot order (each pet in the duel's version 2 layout, then its placement), and `takenAt`.
 */
export function encodeTeamBattleSnapshot(snapshot: TeamBattleSnapshot): Uint8Array {
    const checked = assertTeamBattleSnapshot(snapshot);
    const petLayout = DUEL_SCHEMA_VERSIONS.snapshot;
    const writeMember = (w: CanonicalWriter, m: SquadMember) => {
        writePetSnapshot(w, m.pet, petLayout);
        writePlacement(w, m);
    };
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.SNAPSHOT);
    writeHeader(writer, 'snapshot', checked.domain, TEAM_SCHEMA_VERSIONS.snapshot)
        .array(checked.attackers, writeMember)
        .array(checked.roster, writeMember);
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

/**
 * Replays a team battle from its snapshot, seed and ruleset through the team engine.
 *
 * The one place a snapshot becomes engine inputs, so the backend that computes a battle and
 * the verifier that checks it cannot build them differently. Ruleset layout 3 has no
 * Attributes 2.0 data, so every pet fights neutral: Melee, no temperament, and the `int`
 * turn order the ruleset is required to name.
 */
export function replayTeamBattle(snapshot: TeamBattleSnapshot, seed: Hex, ruleset: Ruleset): TeamOutcome {
    const checked = assertTeamBattleSnapshot(snapshot);
    if (!ruleset.teamConfig) {
        throw new Error(`ruleset version ${ruleset.version} has no team rules`);
    }
    return simulateTeam(
        checked.attackers.map(toFighter),
        checked.roster.map(toFighter),
        BigInt(seed),
        ruleset.skillConfig,
        ruleset.teamConfig,
    );
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
