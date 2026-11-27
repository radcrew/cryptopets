import { concatBytes, hexToBytes, keccak256Hex, normalizeAccount, utf8ToBytes, type Hex } from '@cryptopets/protocol';
import type { Prisma } from '@generated/prisma/client';

import { ITEM_CATALOG } from './catalog.data';
import type { ItemDefinitionSeed } from './catalog';

/**
 * Battle-reward drops (roadmap §4).
 *
 * Seeded from the battle's own drand seed rather than from a new randomness source. That
 * seed is committed to a future drand round before the fight resolves, so nobody including
 * this server can grind a drop by re-rolling: changing the outcome would mean changing a
 * value that was published in advance. That property is real and it is the reason this
 * derives from the seed at all.
 *
 * Be precise about how far it goes, because it is easy to overstate and this comment used
 * to. A third party holding the receipt **cannot** recompute what should have dropped.
 * Two of the three inputs are unpublished: `DropRates` and `DROP_POOL` are constants in
 * this file and in `catalog.data.ts`, and neither reaches the ruleset, so neither is
 * covered by `rulesetHash` or by anything the receipt names. Only the seed and the battle
 * id are signed. Someone reading this source can reproduce a drop; someone holding only a
 * receipt and the published bundle cannot.
 *
 * Nor is the payout pinned by the receipt: `rates` is an argument, so the same seed and
 * battle id yield different answers under different odds, and no row records which applied.
 *
 * Be equally precise about that, because it is easy to overstate in turn. The only
 * production caller (`sign.worker`) passes no rates at all, so the odds in force are
 * `DEFAULT_DROP_RATES` below, a constant that changes only by code change and deploy. Git
 * history and the deployment record are a real audit trail, just not one a receipt holder
 * can check. The parameter is a test seam today; it becomes the gap this paragraph
 * describes only if something ever starts passing per-battle rates, which is worth a second
 * look if anyone proposes it.
 *
 * Closing that means publishing the rates and the drop pool, which puts non-equipment
 * items into the ruleset. §4 deliberately keeps them out: a `rulesetHash` that moved every
 * time a collectible was added would re-prompt every defender for consent and train
 * players to click through the one prompt that matters. So this is a standing design
 * tension, not a missing field, and it is tracked as D2 in
 * `docs/plan-battle-inventory-hardening.md` rather than quietly fixed here.
 *
 * The pool is read from the shipped catalog constant rather than from `item_definition`,
 * deliberately. A replay has to reproduce what a battle dropped, and a table that content
 * edits underneath would give a different answer next month for the same seed.
 */

/** A drop the battle owes one wallet. */
export interface Drop {
    owner: string;
    itemType: string;
    quantity: number;
}

/**
 * Odds and eligibility. Inputs, not a formula this file decides.
 *
 * How often a battle should pay, and whether losing pays at all, is game balance that
 * depends on sinks that do not exist yet — the same reason `rewards/entitlements.ts`
 * takes its rates as inputs. What lives here is the mechanism: derive deterministically,
 * weight by rarity, pay at most one item per side.
 */
export interface DropRates {
    /** Chance in basis points that the winner receives an item. */
    winnerChanceBps: number;
    /** Chance in basis points for the loser. Non-zero keeps losing from being nothing. */
    loserChanceBps: number;
}

/**
 * A deliberately modest default: a win pays about one time in four, a loss about one in
 * twenty. Low enough that a bag fills slowly while quests and crates are still missing,
 * and easy to raise once there is something to spend items on.
 */
export const DEFAULT_DROP_RATES: DropRates = {
    winnerChanceBps: 2500,
    loserChanceBps: 500,
};

/**
 * What can drop: everything except equipment.
 *
 * Gear is the tier §4 gates behind its own design review, and having it fall out of
 * ordinary battles would settle that question by accident. Consumables, collectibles and
 * materials are the categories whose whole purpose is to accumulate.
 */
const DROP_POOL: readonly ItemDefinitionSeed[] = ITEM_CATALOG.filter((item) => item.category !== 'equipment');

/**
 * Rarity is the weight, inverted: a Common is five times as likely as a Legendary.
 *
 * Derived from the tier rather than hand-tabled, so adding an item to the catalog puts it
 * in the pool at a sensible weight without a second list to keep in step.
 */
function weightOf(item: ItemDefinitionSeed): number {
    return 6 - item.rarity;
}

const TOTAL_WEIGHT = DROP_POOL.reduce((sum, item) => sum + weightOf(item), 0);

/**
 * What a battle owes, derived from its seed.
 *
 * Pure: same seed and same battle id give the same answer on any machine, at any time,
 * to anyone holding the receipt. No clock and no ambient randomness, for the same reason
 * `protocol` forbids both.
 *
 * Each side draws from its own labelled stream, so the two rolls cannot correlate and the
 * loser's outcome cannot be inferred from the winner's.
 */
export function rollDrops(
    seed: Hex,
    battleId: string,
    winnerOwner: string,
    loserOwner: string,
    rates: DropRates = DEFAULT_DROP_RATES,
): Drop[] {
    const drops: Drop[] = [];

    const winner = rollSide(seed, battleId, 'winner', rates.winnerChanceBps);
    if (winner) {
        drops.push({ owner: winnerOwner, itemType: winner, quantity: 1 });
    }

    const loser = rollSide(seed, battleId, 'loser', rates.loserChanceBps);
    if (loser) {
        drops.push({ owner: loserOwner, itemType: loser, quantity: 1 });
    }

    return drops;
}

/** One side's roll: does it pay, and if so with what. */
function rollSide(seed: Hex, battleId: string, side: 'winner' | 'loser', chanceBps: number): string | null {
    if (chanceBps <= 0 || DROP_POOL.length === 0) {
        return null;
    }

    // Two independent draws off one digest rather than two digests. The high half decides
    // whether it pays and the low half decides what, so a near-miss on the chance roll
    // cannot bias which item a hit would have produced.
    const digest = hexToBytes(
        keccak256Hex(concatBytes([hexToBytes(seed), utf8ToBytes(`${battleId}:${side}:DROP`)])),
    );

    if (readUint32(digest, 0) % 10_000 >= chanceBps) {
        return null;
    }

    let cursor = readUint32(digest, 4) % TOTAL_WEIGHT;
    for (const item of DROP_POOL) {
        const weight = weightOf(item);
        if (cursor < weight) {
            return item.itemType;
        }
        cursor -= weight;
    }
    // Unreachable: cursor started below the total of every weight subtracted above.
    return DROP_POOL[DROP_POOL.length - 1]!.itemType;
}

function readUint32(bytes: Uint8Array, offset: number): number {
    return (
        ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
    );
}


/**
 * Records a battle's drops as unclaimed entitlements.
 *
 * Called inside the same transaction that writes the receipt, so a battle cannot be
 * recorded without its drops or the reverse — the rule `battle_history` already follows,
 * and for the same reason: two writes that can disagree eventually will.
 *
 * Idempotent under the retry that transaction can take. The entitlement's unique key is
 * (sourceRef, owner, itemType), and sourceRef is the battle id, so a replay of the same
 * battle collides with its own earlier row instead of paying twice.
 *
 * That same key is why the two sides are merged before writing rather than inserted as
 * they come. A player could once fight two pets they both own, and then the winner and the
 * loser are one wallet. Intent submission now refuses that (`same-owner`), but a battle
 * accepted before the refusal existed can still be computed, and a pet sold between
 * submitting and accepting can still produce one. When both rolls land on the same item the
 * two drops share a key, and `skipDuplicates` silently keeps one. Measured on the shipped
 * pool that is about one in six of the self-battles that pay twice, each one quietly
 * costing the player an item they earned. Merging turns that into a single row of
 * quantity 2, which is what was owed.
 *
 * Returns what was written, not what was rolled, so a caller sees the same thing the table
 * does.
 */
export async function recordBattleDrops(
    tx: Prisma.TransactionClient,
    args: {
        chain: string;
        battleId: string;
        seed: Hex;
        winnerOwner: string;
        loserOwner: string;
        rates?: DropRates;
    },
): Promise<Drop[]> {
    const rolled = rollDrops(args.seed, args.battleId, args.winnerOwner, args.loserOwner, args.rates);
    if (rolled.length === 0) {
        return rolled;
    }

    const drops = mergeDrops(rolled);
    await tx.itemEntitlement.createMany({
        data: drops.map((drop) => ({
            chain: args.chain,
            owner: drop.owner,
            itemType: drop.itemType,
            quantity: drop.quantity,
            source: 'battle_drop',
            sourceRef: args.battleId,
        })),
        skipDuplicates: true,
    });

    return drops;
}

/**
 * Totals drops that would share an entitlement key, normalizing the owner first.
 *
 * The normalize has to happen here rather than at the insert, because it is part of the
 * key: two spellings of one address are one wallet to the unique index and would be two
 * groups to anything grouping on the raw value.
 */
function mergeDrops(drops: readonly Drop[]): Drop[] {
    const byKey = new Map<string, Drop>();
    for (const drop of drops) {
        const owner = normalizeAccount(drop.owner);
        const key = `${owner}:${drop.itemType}`;
        const existing = byKey.get(key);
        if (existing) {
            existing.quantity += drop.quantity;
        } else {
            byKey.set(key, { owner, itemType: drop.itemType, quantity: drop.quantity });
        }
    }
    return [...byKey.values()];
}
