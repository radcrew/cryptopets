import type { Hex } from '../encoding/bytes';
import { DOMAIN_TAGS } from '../encoding/domain';
import { keccak256Hex } from '../encoding/hash';
import { CanonicalWriter } from '../encoding/writer';

import { assertRuleset, type Ruleset, SKILL_CONFIG_FIELDS, TEAM_CONFIG_FIELDS, TURN_ORDER_CODES } from './types';

/**
 * Canonical encoding of a ruleset.
 *
 * No chain id or deployment id, unlike every other hashed object here. A ruleset is
 * portable by design: the same rules can run on either chain, and binding the hash to
 * a deployment would give one set of rules as many identities as it has environments,
 * which would make consent bound to `rulesetHash` mean less rather than more. Where a
 * deployment matters, the object referencing the ruleset already carries it.
 *
 * The schema version is written directly for the same reason: `writeHeader` bundles
 * version with domain, and there is no domain here. It comes from the ruleset rather than
 * from this build, so re-encoding a bundle published before the item catalog existed
 * reproduces the bytes it was hashed under.
 */
export function encodeRuleset(ruleset: Ruleset): Uint8Array {
    const checked = assertRuleset(ruleset);
    const version = checked.schemaVersion ?? 1;
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.RULESET)
        .u16(version)
        .u32(checked.version)
        .text(checked.engineId)
        .u32(checked.engineVersion)
        .u16(checked.maxRounds)
        .u16(checked.maxLevel);
    for (const field of SKILL_CONFIG_FIELDS) {
        writer.u32(checked.skillConfig[field]);
    }

    if (version < 2) {
        return writer.build();
    }

    // The catalog is inside the hash rather than beside it as a digest of its own. A
    // separate `itemCatalogHash` field would be a second thing to keep in step for no
    // gain: the bundle already publishes these rows, so hashing them directly is both the
    // identity and the content.
    writer.array(checked.itemCatalog ?? [], (w, item) => {
        w.u256(item.itemType)
            .u8(item.slot)
            .u16(item.hp)
            .u16(item.atk)
            .u16(item.def)
            .u16(item.int)
            .u16(item.mdef);
    });
    if (version < 3) {
        return writer.build();
    }

    // Layout 3 appends the team rules after the catalog, so layouts 1 and 2 stay prefixes of
    // it and nothing published before team battles hashes differently.
    const team = checked.teamConfig;
    if (!team) {
        throw new Error('ruleset schema version 3 requires teamConfig'); // unreachable after assertRuleset
    }
    writer.u8(TURN_ORDER_CODES[team.turnOrder]);
    for (const field of TEAM_CONFIG_FIELDS) {
        writer.u32(team[field]);
    }
    return writer.build();
}

/** `rulesetHash`: recorded in every receipt, and what defence consent is bound to. */
export function hashRuleset(ruleset: Ruleset): Hex {
    return keccak256Hex(encodeRuleset(ruleset));
}

/** Throws unless `ruleset` hashes to `expected`. */
export function assertRulesetHash(ruleset: Ruleset, expected: Hex): void {
    const actual = hashRuleset(ruleset);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(`ruleset hash mismatch: expected ${expected}, computed ${actual}`);
    }
}
