import type { Hex } from '../encoding/bytes';

import { assertRulesetHash, hashRuleset } from './hash';
import { assertRuleset, type Ruleset, SKILL_CONFIG_FIELDS, TEAM_CONFIG_FIELDS } from './types';

/**
 * The published, content-addressed ruleset artifact (§H item 2).
 *
 * A receipt names a `rulesetHash`; without the matching bundle, a third party has the
 * name of the rules but not the rules, so replay stops being possible. Each version is
 * therefore published as an immutable JSON document, and its integrity does not depend
 * on where it was fetched from: a verifier parses it, recomputes `rulesetHash`, and
 * compares against the receipt.
 *
 * The JSON is transport only. Hashing goes through the binary encoder, so the artifact
 * does not have to be canonical JSON, and no verifier has to agree with us about
 * property order or number formatting.
 */

/** Serializes a ruleset for publication. Stable key order, so diffs stay readable. */
export function serializeRuleset(ruleset: Ruleset): string {
    const checked = assertRuleset(ruleset);
    const skillConfig: Record<string, number> = {};
    for (const field of SKILL_CONFIG_FIELDS) {
        skillConfig[field] = checked.skillConfig[field];
    }
    const document: Record<string, unknown> = {
        version: checked.version,
        engineId: checked.engineId,
        engineVersion: checked.engineVersion,
        maxRounds: checked.maxRounds,
        maxLevel: checked.maxLevel,
        skillConfig,
    };

    // Emitted only from version 2 on, so a bundle published before the item catalog
    // existed serializes byte-identically to how it always did. Item types are decimal
    // strings: a uint256 does not survive JSON's number type, and a bundle that lost
    // precision on an id would name the wrong item.
    if ((checked.schemaVersion ?? 1) >= 2) {
        document.schemaVersion = checked.schemaVersion;
        document.itemCatalog = (checked.itemCatalog ?? []).map((item) => ({
            itemType: item.itemType.toString(),
            slot: item.slot,
            hp: item.hp,
            atk: item.atk,
            def: item.def,
            int: item.int,
            mdef: item.mdef,
        }));
    }
    // Likewise only from version 3, so earlier bundles still serialize as they always did.
    if (checked.teamConfig) {
        const teamConfig: Record<string, unknown> = { turnOrder: checked.teamConfig.turnOrder };
        for (const field of TEAM_CONFIG_FIELDS) {
            teamConfig[field] = checked.teamConfig[field];
        }
        document.teamConfig = teamConfig;
    }

    return `${JSON.stringify(document, null, 2)}\n`;
}

const RULESET_KEYS = [
    'version',
    'engineId',
    'engineVersion',
    'maxRounds',
    'maxLevel',
    'skillConfig',
    'itemCatalog',
    'teamConfig',
    'schemaVersion',
] as const;

const ITEM_KEYS = ['itemType', 'slot', 'hp', 'atk', 'def', 'int', 'mdef'] as const;

/**
 * Parses a published bundle.
 *
 * Unknown keys are rejected. A bundle carrying an extra field would hash identically to
 * one without it, so two different documents would answer to one `rulesetHash`, and a
 * reader would have no way to tell which the battle used. Missing keys are rejected by
 * `assertRuleset`.
 */
export function parseRulesetBundle(json: string): Ruleset {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        throw new Error(`ruleset bundle is not valid JSON: ${(error as Error).message}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('ruleset bundle must be a JSON object');
    }
    const record = parsed as Record<string, unknown>;

    const unexpected = Object.keys(record).filter((key) => !RULESET_KEYS.includes(key as never));
    if (unexpected.length > 0) {
        throw new Error(`ruleset bundle has unexpected keys: ${unexpected.join(', ')}`);
    }
    const skillConfig = record.skillConfig;
    if (typeof skillConfig === 'object' && skillConfig !== null) {
        const unexpectedSkills = Object.keys(skillConfig as Record<string, unknown>).filter(
            (key) => !SKILL_CONFIG_FIELDS.includes(key as never),
        );
        if (unexpectedSkills.length > 0) {
            throw new Error(`ruleset bundle skillConfig has unexpected keys: ${unexpectedSkills.join(', ')}`);
        }
    }

    // Item types come back as decimal strings; `assertRuleset` wants bigints, and doing the
    // conversion here keeps the JSON transport detail out of the validator.
    const parsedCatalog = Array.isArray(record.itemCatalog)
        ? record.itemCatalog.map((entry, index) => {
              if (typeof entry !== 'object' || entry === null) {
                  throw new Error(`ruleset bundle itemCatalog[${index}] is not an object`);
              }
              const item = entry as Record<string, unknown>;
              const unexpectedItemKeys = Object.keys(item).filter((key) => !ITEM_KEYS.includes(key as never));
              if (unexpectedItemKeys.length > 0) {
                  throw new Error(
                      `ruleset bundle itemCatalog[${index}] has unexpected keys: ${unexpectedItemKeys.join(', ')}`,
                  );
              }
              if (typeof item.itemType !== 'string' || !/^[0-9]+$/.test(item.itemType)) {
                  throw new Error(
                      `ruleset bundle itemCatalog[${index}].itemType must be a decimal string, got ${JSON.stringify(item.itemType)}`,
                  );
              }
              return { ...item, itemType: BigInt(item.itemType) };
          })
        : record.itemCatalog;

    const teamConfig = record.teamConfig;
    if (typeof teamConfig === 'object' && teamConfig !== null) {
        const known: readonly string[] = ['turnOrder', ...TEAM_CONFIG_FIELDS];
        const unexpectedTeam = Object.keys(teamConfig).filter((key) => !known.includes(key));
        if (unexpectedTeam.length > 0) {
            throw new Error(`ruleset bundle teamConfig has unexpected keys: ${unexpectedTeam.join(', ')}`);
        }
    }

    return assertRuleset({ ...record, itemCatalog: parsedCatalog } as unknown as Ruleset);
}

/**
 * Parses a bundle and confirms it is the one a receipt named.
 *
 * This is the call a verifier makes: fetching a bundle from anywhere is safe as long as
 * its hash matches the receipt, because the hash is the identity.
 */
export function loadRulesetBundle(json: string, expectedHash: Hex): Ruleset {
    const ruleset = parseRulesetBundle(json);
    assertRulesetHash(ruleset, expectedHash);
    return ruleset;
}

/** Convenience for publishing: the artifact plus the hash it will be addressed by. */
export function publishRuleset(ruleset: Ruleset): { hash: Hex; json: string } {
    return { hash: hashRuleset(ruleset), json: serializeRuleset(ruleset) };
}
