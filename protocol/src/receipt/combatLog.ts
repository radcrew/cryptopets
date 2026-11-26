import type { SimOutcome, StrikeLogEntry } from '../combat/sim';
import { DUEL_SCHEMA_VERSIONS } from '../domain/schemaVersions';
import type { Hex } from '../encoding/bytes';
import { DOMAIN_TAGS } from '../encoding/domain';
import { keccak256Hex } from '../encoding/hash';
import { CanonicalWriter } from '../encoding/writer';

/**
 * Hash of the blow-by-blow combat log.
 *
 * The log is presentation data: the client animates from it. Binding its hash into
 * the receipt is what stops the animation and the result being two different stories.
 * Without it, a player could be shown any sequence of strikes ending in the recorded
 * winner, and nothing would contradict it.
 *
 * The log is not itself in the receipt, because it is large and most readers never
 * want it. It is served separately and checked against this hash.
 *
 * No chain id or deployment id: the log is a pure function of the fight inputs, and the
 * receipt that references this hash already carries the domain.
 */
export function encodeCombatLog(outcome: SimOutcome): Uint8Array {
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.COMBAT_LOG)
        .u16(DUEL_SCHEMA_VERSIONS.combatLog)
        .u256(outcome.startHp1)
        .u256(outcome.startHp2);
    return writer.array(outcome.log, (w, entry) => writeStrike(w, entry)).build();
}

/** `combatLogHash`, as recorded in the receipt. */
export function hashCombatLog(outcome: SimOutcome): Hex {
    return keccak256Hex(encodeCombatLog(outcome));
}

function writeStrike(writer: CanonicalWriter, entry: StrikeLogEntry): void {
    writer
        .u32(entry.round)
        .u8(entry.attacker)
        .bool(entry.isMagic)
        .bool(entry.crit)
        .u256(entry.damage)
        .u256(entry.heal)
        .u16(entry.elementMult)
        .bool(entry.furyTriggered)
        .bool(entry.rebirthTriggered)
        .u256(entry.hp1After)
        .u256(entry.hp2After);
}
