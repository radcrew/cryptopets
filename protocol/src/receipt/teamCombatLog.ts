import type { TeamOutcome, TeamStrikeLogEntry } from '../combat/team';
import { TEAM_SCHEMA_VERSIONS } from '../domain/schemaVersions';
import type { Hex } from '../encoding/bytes';
import { DOMAIN_TAGS } from '../encoding/domain';
import { keccak256Hex } from '../encoding/hash';
import { CanonicalWriter } from '../encoding/writer';

/**
 * A team battle's combat log: combat log schema version 2.
 *
 * Its job is the duel log's (see `./combatLog`): binding its hash into the receipt stops the
 * playback and the result telling two different stories. A team strike says more than a
 * duel strike (who it aimed at, who took it, which cooperation rules fired), and all of it is
 * bound, because a playback that showed a guard nobody made would be the same lie as one
 * showing the wrong winner.
 *
 * Fighters are named by side and slot; the receipt's `drawn` says which roster pets the
 * defenders' slots are.
 */
export function encodeTeamCombatLog(outcome: TeamOutcome): Uint8Array {
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.COMBAT_LOG).u16(TEAM_SCHEMA_VERSIONS.combatLog);
    for (const side of outcome.startHp) {
        writer.array(side, (w, hp) => w.u32(Number(hp)));
    }
    return writer.array(outcome.log, (w, entry) => writeStrike(w, entry)).build();
}

/** A team battle's `combatLogHash`. */
export function hashTeamCombatLog(outcome: TeamOutcome): Hex {
    return keccak256Hex(encodeTeamCombatLog(outcome));
}

function writeStrike(writer: CanonicalWriter, s: TeamStrikeLogEntry): void {
    writer
        .u32(s.round)
        .u8(s.side)
        .u8(s.actor)
        .u8(s.target)
        .u8(s.victim)
        .bool(s.isMagic)
        .bool(s.crit)
        .u32(Number(s.damage))
        .u16(s.elementMult)
        .u8(s.combo)
        .bool(s.longShot)
        .bool(s.furyTriggered)
        .bool(s.temperament)
        .bool(s.exposed)
        .bool(s.guarded)
        .bool(s.secondChance)
        .bool(s.knockedOut)
        .u32(Number(s.heal))
        .optional(s.healed, (w, slot) => w.u8(slot))
        .u32(Number(s.victimHpAfter));
}
