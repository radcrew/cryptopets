import { bytesToHex, concatBytes, uintToBytes, utf8ToBytes } from '../encoding/bytes';
import { DOMAIN_TAGS } from '../encoding/domain';
import { keccak256 } from '../encoding/hash';

/** Pets in a defence plan's roster. */
export const ROSTER_SIZE = 5;
/** Pets drawn from it to defend. */
export const SQUAD_SIZE = 3;

/**
 * Draws a team battle's defenders from a five-pet roster (docs/battle-protocol.md §F, "The
 * draw"). `ranks[i]` is roster pet `i`'s rank, 1 to 5 with each rank used once, and it weighs
 * `6 - rank`, so the top-ranked pet defends in about 83% of battles and the fifth in 27%.
 *
 * Returns the drawn roster indices in roster order, which is the defenders' slot order. The
 * seed is the battle seed, so nobody can know the lineup until the drand round is revealed.
 */
export function drawDefenders(ranks: readonly number[], seed: bigint): number[] {
    if (ranks.length !== ROSTER_SIZE) throw new Error(`a roster has ${ROSTER_SIZE} pets, got ${ranks.length}`);
    const sorted = [...ranks].sort((a, b) => a - b);
    if (sorted.some((rank, i) => rank !== i + 1)) {
        throw new Error(`ranks must use 1 to ${ROSTER_SIZE} once each, got ${ranks.join(', ')}`);
    }

    const remaining = ranks.map((rank, index) => ({ index, weight: BigInt(6 - rank) }));
    const drawn: number[] = [];
    for (let k = 1; k <= SQUAD_SIZE; k++) {
        const total = remaining.reduce((sum, p) => sum + p.weight, 0n);
        const digest = keccak256(concatBytes([utf8ToBytes(DOMAIN_TAGS.SQUAD_DRAW), uintToBytes(seed, 32), uintToBytes(k, 1)]));
        const roll = BigInt(bytesToHex(digest)) % total;
        let running = 0n;
        const at = remaining.findIndex((p) => (running += p.weight) > roll);
        const [pick] = remaining.splice(at, 1);
        if (!pick) throw new Error('draw walked past the roster'); // unreachable: roll < total
        drawn.push(pick.index);
    }
    return drawn.sort((a, b) => a - b);
}
