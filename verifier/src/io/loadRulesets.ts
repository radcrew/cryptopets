import { hashRuleset, parseRulesetBundle, type Ruleset, SOURCE_DEFAULT_RULESET, TEAM_SOURCE_DEFAULT_RULESET } from '@cryptopets/protocol';

import { readJsonFrom } from './source';
import { isRecord } from './util';

/**
 * Published ruleset bundles, keyed by lowercase `rulesetHash` (§H item 2).
 *
 * The hash is the identity, so where a bundle came from does not matter: every entry here
 * is keyed by the hash recomputed from its own contents, never by a hash the source
 * claimed. A bundle fetched from a hostile mirror either hashes to what the receipt names
 * or it does not get used.
 */
export type RulesetRegistry = ReadonlyMap<string, Ruleset>;

/**
 * The ruleset this build implements with source defaults, keyed by its own hash.
 *
 * Enough on its own to replay any battle fought under source defaults — which is every
 * local-development battle and anything the golden vectors are anchored to. A deployment
 * that tuned `GameConfig` produces a different hash, and those bundles must be supplied
 * with `loadRulesets`.
 */
export function builtInRulesets(): Map<string, Ruleset> {
    return new Map(
        [SOURCE_DEFAULT_RULESET, TEAM_SOURCE_DEFAULT_RULESET].map((ruleset) => [hashRuleset(ruleset).toLowerCase(), ruleset]),
    );
}

/**
 * Loads published bundles from a local file or an `http(s)` URL.
 *
 * Accepts what `backend/API.md` serves from `GET /api/battle/rulesets/:rulesetHash`
 * (`{ ..., bundle: {...} }`), a bare bundle object saved to a file by hand, or an array of
 * either.
 */
export async function loadRulesets(source: string): Promise<Map<string, Ruleset>> {
    const json = await readJsonFrom(source);
    const entries = Array.isArray(json) ? json : [json];
    const registry = new Map<string, Ruleset>();
    for (const entry of entries) {
        const ruleset = parseOne(entry);
        registry.set(hashRuleset(ruleset).toLowerCase(), ruleset);
    }
    return registry;
}

function parseOne(entry: unknown): Ruleset {
    if (!isRecord(entry)) {
        throw new Error('a ruleset entry must be an object');
    }
    // The bundle is transport-only JSON; `parseRulesetBundle` takes a string, and going
    // back through `JSON.stringify` is what the backend's own compute worker does too.
    const bundle = isRecord(entry.bundle) ? entry.bundle : entry;
    return parseRulesetBundle(JSON.stringify(bundle));
}
