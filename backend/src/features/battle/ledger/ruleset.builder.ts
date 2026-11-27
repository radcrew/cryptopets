import {
    hashRuleset,
    type Hex,
    type ItemModifier,
    type Ruleset,
    SOURCE_DEFAULT_RULESET,
    TEAM_SOURCE_DEFAULT_RULESET,
} from '@cryptopets/protocol';

import { getCombatCatalog, itemCatalogGeneration } from '@features/inventory';

/**
 * Builds the ruleset this deployment fights under (roadmap §4).
 *
 * `SOURCE_DEFAULT_RULESET` is the local-development baseline and ships with an empty item
 * catalog, deliberately: `@cryptopets/protocol` is MIT and cannot import the catalog,
 * which is content owned by a PolyForm package. So the catalog is joined on here, the same
 * way a deployment already reads `skillConfig` from `GameConfig` rather than trusting the
 * constant beside it.
 *
 * Only equipment reaches the ruleset. A potion cannot change a fight, and listing one
 * would make adding a collectible move `rulesetHash` — which invalidates every outstanding
 * defence authorization, since consent is bound to that hash. Re-prompting every defender
 * because a badge was added would train players to click through the one prompt that
 * matters.
 */

/**
 * Cached for the process's life.
 *
 * The catalog changes when someone runs the seeder, which is a deploy-shaped event, and
 * this is read on every accept. Re-querying per battle would put a table scan on the hot
 * path to answer the same question. A catalog edit therefore needs a restart to take
 * effect, which is the right shape for something that invalidates outstanding consent:
 * it should be a deliberate rollout, not a row edit that quietly re-prices live battles.
 *
 * Stamped with the catalog generation it was built from, so dropping the catalog drops
 * this too. Two independent process-life caches over the same rows was a trap: whichever
 * one a caller knew to reset, the other kept answering from data that no longer existed.
 */
let cached: { ruleset: Ruleset; hash: Hex; team: Ruleset; teamHash: Hex; generation: number } | null = null;

export async function servedRuleset(): Promise<Ruleset> {
    // Read before the await, not after: a reset landing mid-build then stamps this result
    // with the older generation, so the next call rebuilds. The other order would stamp a
    // half-stale ruleset as current.
    const generation = itemCatalogGeneration();
    if (cached && cached.generation === generation) {
        return cached.ruleset;
    }

    // The strict read: an equipment row whose modifier will not parse throws here rather
    // than dropping out of the list. Dropping it would move `rulesetHash` and invalidate
    // every outstanding defence authorization on the strength of one bad column.
    const catalog = await getCombatCatalog();
    const itemCatalog: ItemModifier[] = [];
    for (const item of catalog) {
        if (item.effect?.kind !== 'stat_bonus' || item.slot === null) {
            continue;
        }
        itemCatalog.push({
            itemType: BigInt(item.itemType),
            slot: item.slot,
            hp: item.effect.hp,
            atk: item.effect.atk,
            def: item.effect.def,
            int: item.effect.int,
            mdef: item.effect.mdef,
        });
    }

    // Ascending by item type, which the protocol requires: the order is part of the
    // ruleset digest, and `assertRuleset` refuses to sort silently so a duplicate item
    // type surfaces rather than being tidied away.
    itemCatalog.sort((a, b) => (a.itemType < b.itemType ? -1 : a.itemType > b.itemType ? 1 : 0));

    const ruleset: Ruleset = { ...SOURCE_DEFAULT_RULESET, itemCatalog };
    // The team ruleset is built here, from the same catalog read and stamped with the same
    // generation, rather than in a cache of its own: two caches over one catalog is the trap
    // the generation stamp exists to prevent.
    const team: Ruleset = { ...TEAM_SOURCE_DEFAULT_RULESET, itemCatalog };
    cached = { ruleset, hash: hashRuleset(ruleset), team, teamHash: hashRuleset(team), generation };
    return cached.ruleset;
}

/**
 * The hash of the served ruleset, derived once per catalog generation.
 *
 * Every caller that needs it used to run `hashRuleset(await servedRuleset())` itself, and
 * four sites doing that is four chances to hash something else. It was not hypothetical:
 * matchmaking hashed `SOURCE_DEFAULT_RULESET` while defenders signed against the served
 * one, so the consent filter matched no authorization ever written and the opponent list
 * came back empty on a deployment full of consenting pets. Nothing detected it, because an
 * empty list is also the correct answer when nobody has consented.
 *
 * Deriving it beside the ruleset it belongs to makes that class of divergence impossible
 * rather than merely fixed: there is one place the value comes from, and a caller cannot
 * reach the ruleset without the matching hash being right there.
 *
 * It also takes a keccak over the whole ruleset — item catalog included — off the
 * matchmaking query path, which ran it per request.
 */
export async function servedRulesetHash(): Promise<Hex> {
    await servedRuleset();
    // Non-null: `servedRuleset` either returns from the cache or fills it.
    return cached!.hash;
}

/**
 * The ruleset team battles fight under: layout 3, the launch team rules, and the same item
 * catalog as `servedRuleset`.
 *
 * A separate ruleset rather than moving duels onto layout 3, because a different ruleset is a
 * different `rulesetHash`, and duel consent is bound to the hash. Serving duels a new one
 * would cancel every defender's authorization on deploy; that is the rollout's decision
 * (Phase 6 in docs/plan-team-battles-3v3.md), not a side effect of team battles existing.
 * Defence plans bind to this hash instead.
 */
export async function servedTeamRuleset(): Promise<Ruleset> {
    await servedRuleset();
    return cached!.team;
}

/** The hash of `servedTeamRuleset`, derived with it. */
export async function servedTeamRulesetHash(): Promise<Hex> {
    await servedRuleset();
    return cached!.teamHash;
}

/**
 * Test seam: drops the memoized ruleset directly.
 *
 * Rarely the one to reach for now. `resetItemCatalog()` invalidates this as well, which is
 * what a caller changing catalog rows actually wants; this is for a test that stubs the
 * catalog module itself and so never bumps a generation.
 */
export function resetServedRuleset(): void {
    cached = null;
}
