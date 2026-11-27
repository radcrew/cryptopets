import { DEFAULT_SKILL_CONFIG, type SkillConfig } from '../combat/skills';
import { DEFAULT_TEAM_CONFIG, type TeamConfig } from '../combat/team';
import { MAX_ROUNDS } from '../combat/sim';
import { DEFAULT_MAX_LEVEL } from '../combat/xp';
import { assertSupportedSchemaVersion, currentSchemaVersion } from '../domain/schemaVersions';

/**
 * What one item type does to a pet's attributes (roadmap §4).
 *
 * Part of the ruleset rather than a separate artifact, so a rebalance changes
 * `rulesetHash` on its own. That is the mechanism §4 asks for: outstanding defence
 * authorizations are bound to the hash, so re-pricing a sword invalidates consent given
 * under the old numbers instead of silently re-interpreting it.
 *
 * Only equipment appears here. A potion or a badge cannot change a fight, and listing
 * one would make adding a collectible invalidate every player's consent for nothing.
 */
export interface ItemModifier {
    /** ERC-1155 token id. */
    itemType: bigint;
    /** Equip slot 0-2, matching ItemCore.SLOT_*. */
    slot: number;
    hp: number;
    atk: number;
    def: number;
    int: number;
    mdef: number;
}

/**
 * A versioned, content-addressed statement of the rules a battle was fought under.
 *
 * Every receipt records `rulesetVersion` and `rulesetHash`, and defence consent is
 * bound to the hash. That is what makes "I agreed to the old combat rules" a
 * checkable claim rather than an argument: the rules a battle used are named in the
 * receipt, and the named bundle is published so anyone can replay against exactly
 * those numbers years later (§F, §H).
 *
 * Three kinds of thing live here, and the distinctions matter:
 *
 * - **Parameters the engine reads at runtime**: the skill/balance config and the
 *   level cap. These come from `GameConfig` on chain and are owner-tunable, so they
 *   have to travel with the receipt.
 * - **Engine identity**: `engineId` and `engineVersion`, plus `maxRounds` as a
 *   declared constant. The engine's own code cannot hash itself, so a fight-math
 *   change is recorded by bumping `engineVersion`. That bump is a manual step, and
 *   skipping it is how two different implementations end up claiming one ruleset.
 * - **Content that changes outcomes**: the item catalog (§4). Off-chain and
 *   owner-editable like the balance knobs, and in here for the same reason: a fight it
 *   could have changed has to name the version it ran under.
 */
export interface Ruleset {
    /** Monotonic ruleset version. The number a receipt reports. */
    version: number;
    /** Which engine implements the fight. */
    engineId: string;
    /** Bumped whenever fight math or progression logic changes. */
    engineVersion: number;
    /** Round cap the engine enforces. Declared here so a bundle is self-describing. */
    maxRounds: number;
    /** Skill balance values, sourced from `GameConfig` on chain. */
    skillConfig: SkillConfig;
    /** Level cap, sourced from `GameConfig.maxLevel`. */
    maxLevel: number;
    /**
     * Every combat-affecting item, ordered by `itemType` (schema v2+).
     *
     * Absent or empty on a deployment with no equipment, which is what every version 1
     * ruleset is. The values here are the *declared* effects; a snapshot carries the
     * modifiers actually applied, and a verifier compares the two.
     */
    itemCatalog?: ItemModifier[];
    /**
     * The team rules' tunable values (schema v3+, docs/battle-protocol.md §F).
     *
     * Required from version 3 and refused before it, like the catalog. Inside the hash for
     * the same reason the skill config is: a defender's consent covers how hard a combo
     * hits as much as how hard a crit does. A duel never reads it.
     */
    teamConfig?: TeamConfig;
    /**
     * Which layout this ruleset was written under. Absent means 1.
     *
     * Same rule as the snapshot's, for the same reason: published bundles predate this
     * field, and re-encoding one at the current version would change the `rulesetHash`
     * every receipt naming it was signed against.
     */
    schemaVersion?: number;
}

/** The engine this package implements. */
export const ENGINE_ID = 'cryptopets-combat-ts';

/**
 * The layout `SOURCE_DEFAULT_RULESET` declares. Absent means 1, for published bundles that
 * predate the field.
 *
 * Held at 2 although this build implements 3, and deliberately: the backend serves this
 * ruleset (plus its item catalog), and defence consent is bound to its hash. Moving it to
 * 3 would cancel every defender's consent on the next deploy, which is the team-battle
 * rollout's job to do on purpose, not a side effect of the code existing.
 */
export const RULESET_SCHEMA_VERSION = 2;

/** The layout that carries the team rules. */
export const TEAM_RULESET_SCHEMA_VERSION = currentSchemaVersion('ruleset');

/**
 * Bumped when `src/combat/` changes what a fight or a progression delta produces.
 *
 * Not bumped for refactors that cannot change output, which is exactly the judgement
 * call that makes this dangerous: when in doubt, bump. A missed bump means two
 * implementations disagree while both claim the same `rulesetHash`, and the golden
 * vectors are the only thing that would notice.
 *
 * 2: the engine reads equipment modifiers (roadmap §4). An ungeared fight resolves
 * identically, which the unchanged golden vectors prove, but the engine is no longer the
 * same function of its inputs, so the version moves.
 *
 * Not bumped for team battles (§F). A duel resolves exactly as before, which team.json's
 * one-on-one replays prove, and the team rules are identified by ruleset layout 3: a build
 * without the team engine refuses that layout outright, so no two implementations can
 * disagree under one `rulesetHash`. A later change to how a team fight resolves bumps this.
 */
export const ENGINE_VERSION = 2;

/**
 * The ruleset this build implements with source defaults.
 *
 * Source defaults, not live values: on chain the skill config and level cap come
 * from `GameConfig` and are owner-tunable, so a deployment builds its ruleset by
 * reading the contract. This constant is the local-development baseline and the
 * thing golden vectors are anchored to.
 */
export const SOURCE_DEFAULT_RULESET: Ruleset = {
    version: 1,
    engineId: ENGINE_ID,
    engineVersion: ENGINE_VERSION,
    maxRounds: MAX_ROUNDS,
    skillConfig: DEFAULT_SKILL_CONFIG,
    maxLevel: DEFAULT_MAX_LEVEL,
    // Empty, and it has to be: the item catalog is content owned by a PolyForm package,
    // and this one is MIT and cannot import it. A deployment builds its ruleset by reading
    // its own catalog, exactly as it already reads skillConfig from GameConfig rather than
    // trusting the constant beside it.
    itemCatalog: [],
    schemaVersion: RULESET_SCHEMA_VERSION,
};

/**
 * The source-default ruleset with the team rules: layout 3 and the launch team
 * configuration. What a deployment serves once team battles roll out, with its own skill
 * values and catalog joined on exactly as it does for `SOURCE_DEFAULT_RULESET`.
 */
export const TEAM_SOURCE_DEFAULT_RULESET: Ruleset = {
    ...SOURCE_DEFAULT_RULESET,
    version: 2,
    teamConfig: DEFAULT_TEAM_CONFIG,
    schemaVersion: TEAM_RULESET_SCHEMA_VERSION,
};

/** Field order for `teamConfig`'s numbers, which is also their canonical encoding order. */
export const TEAM_CONFIG_FIELDS = [
    'comboStepPct',
    'exposePct',
    'auraPct',
    'tailwindBps',
    'longShotPct',
    'temperamentPct',
] as const satisfies readonly (keyof TeamConfig)[];

/** `teamConfig.turnOrder` as one byte. */
export const TURN_ORDER_CODES = { int: 0, speed: 1 } as const;

/** Field order for `skillConfig`, which is also its canonical encoding order. */
export const SKILL_CONFIG_FIELDS = [
    'tankHpMult',
    'shellDefMult',
    'swiftCritBonus',
    'cunningCritCap',
    'furyDmgMult',
    'furyHpThreshold',
    'sageMdefMult',
    'bloodlustBps',
] as const satisfies readonly (keyof SkillConfig)[];

/**
 * Sanity bounds, not game-design opinions.
 *
 * Multipliers are x/100 and must be positive: a zero HP multiplier would produce a
 * pet that cannot exist. Basis-point fields cap at 10000 (100%), since a crit chance
 * above certainty is not a tuning choice, it is a typo. Anything inside these bounds
 * is the owner's call.
 */
const MULTIPLIER_BOUNDS = { min: 1, max: 10000 } as const;
const BPS_BOUNDS = { min: 0, max: 10000 } as const;

const MULTIPLIER_FIELDS: readonly (keyof SkillConfig)[] = [
    'tankHpMult',
    'shellDefMult',
    'furyDmgMult',
    'sageMdefMult',
];

const SAFE_ENGINE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** Validates an untrusted ruleset, returning a normalized copy. */
export function assertRuleset(ruleset: Ruleset): Ruleset {
    // Absent means 1, matching the snapshot's rule and for the same reason: bundles
    // published before the item catalog existed are named by receipts already signed.
    const schemaVersion = ruleset.schemaVersion ?? 1;
    assertSupportedSchemaVersion('ruleset', schemaVersion);
    assertPositiveInt(ruleset.version, 'version');
    assertPositiveInt(ruleset.engineVersion, 'engineVersion');
    assertPositiveInt(ruleset.maxRounds, 'maxRounds');
    assertPositiveInt(ruleset.maxLevel, 'maxLevel');

    if (typeof ruleset.engineId !== 'string' || !SAFE_ENGINE_ID_PATTERN.test(ruleset.engineId)) {
        throw new Error(`engineId is not a valid identifier: ${JSON.stringify(ruleset.engineId)}`);
    }
    if (ruleset.maxRounds > 0xffff) {
        throw new Error(`maxRounds must fit in 16 bits, got ${ruleset.maxRounds}`);
    }
    if (ruleset.maxLevel > 0xffff) {
        throw new Error(`maxLevel must fit in 16 bits, got ${ruleset.maxLevel}`);
    }

    const skillConfig = {} as SkillConfig;
    for (const field of SKILL_CONFIG_FIELDS) {
        const value = ruleset.skillConfig?.[field];
        const bounds = MULTIPLIER_FIELDS.includes(field) ? MULTIPLIER_BOUNDS : BPS_BOUNDS;
        if (!Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
            throw new Error(
                `skillConfig.${field} must be an integer between ${bounds.min} and ${bounds.max}, got ${value}`,
            );
        }
        skillConfig[field] = value;
    }

    const itemCatalog = assertItemCatalog(ruleset.itemCatalog);
    if (schemaVersion < 2 && itemCatalog.length > 0) {
        // Refused rather than dropped: version 1 has nowhere to put the catalog, so
        // encoding this would publish rules that omit the gear they were meant to price.
        throw new Error('ruleset schema version 1 cannot carry an item catalog; use version 2');
    }
    const teamConfig = assertTeamConfig(ruleset.teamConfig, schemaVersion);

    return {
        version: ruleset.version,
        engineId: ruleset.engineId,
        engineVersion: ruleset.engineVersion,
        maxRounds: ruleset.maxRounds,
        skillConfig,
        maxLevel: ruleset.maxLevel,
        itemCatalog,
        ...(teamConfig && { teamConfig }),
        schemaVersion,
    };
}

/**
 * Validates the team rules: required from layout 3, refused before it.
 *
 * Refused rather than dropped below 3, like the catalog: an older layout has nowhere to put
 * them, so encoding one would publish rules that silently omit the team rules.
 *
 * Only the `int` turn order is accepted for now. The `speed` order needs a speed for every
 * pet, which arrives with Attributes 2.0 in a later layout; a ruleset naming it today would
 * promise an order no snapshot can supply.
 */
function assertTeamConfig(config: TeamConfig | undefined, schemaVersion: number): TeamConfig | undefined {
    if (schemaVersion < 3) {
        if (config !== undefined) {
            throw new Error(`ruleset schema version ${schemaVersion} cannot carry team rules; use version 3`);
        }
        return undefined;
    }
    if (typeof config !== 'object' || config === null) {
        throw new Error('ruleset schema version 3 requires teamConfig');
    }
    if (config.turnOrder !== 'int') {
        throw new Error(`teamConfig.turnOrder must be 'int' until Attributes 2.0, got ${JSON.stringify(config.turnOrder)}`);
    }
    const checked: TeamConfig = { ...DEFAULT_TEAM_CONFIG, turnOrder: config.turnOrder };
    for (const field of TEAM_CONFIG_FIELDS) {
        const value = config[field];
        // The two bonus steps may be switched off with 0. The rest are multipliers, where 0
        // would erase the strike rather than tune it.
        const min = field === 'comboStepPct' || field === 'tailwindBps' ? 0 : 1;
        if (!Number.isSafeInteger(value) || value < min || value > 10000) {
            throw new Error(`teamConfig.${field} must be an integer between ${min} and 10000, got ${value}`);
        }
        checked[field] = value;
    }
    return checked;
}

/** Highest slot index the protocol accepts, matching ItemCore's three gear slots. */
const MAX_SLOT = 2;
/** Sanity bound on a declared bonus, mirroring the snapshot's. */
const MAX_BONUS = 0xffff;

/**
 * Validates the item catalog.
 *
 * Ordered strictly by `itemType`, which makes the encoding canonical without an implicit
 * sort and rejects one item type declared twice — two prices for one sword is not a
 * ruleset anyone can be held to.
 */
function assertItemCatalog(items: ItemModifier[] | undefined): ItemModifier[] {
    if (items === undefined) {
        return [];
    }
    if (!Array.isArray(items)) {
        throw new Error('itemCatalog must be an array');
    }

    let previous = -1n;
    return items.map((item, index) => {
        const where = `itemCatalog[${index}]`;
        if (typeof item.itemType !== 'bigint' || item.itemType <= 0n || item.itemType >= 1n << 256n) {
            throw new Error(`${where}.itemType is not a valid item type: ${item.itemType}`);
        }
        if (item.itemType <= previous) {
            throw new Error(`${where}.itemType must be strictly ascending; got ${item.itemType} after ${previous}`);
        }
        previous = item.itemType;

        if (!Number.isSafeInteger(item.slot) || item.slot < 0 || item.slot > MAX_SLOT) {
            throw new Error(`${where}.slot must be 0-${MAX_SLOT}, got ${item.slot}`);
        }

        const bonuses = {} as Record<'hp' | 'atk' | 'def' | 'int' | 'mdef', number>;
        for (const field of ['hp', 'atk', 'def', 'int', 'mdef'] as const) {
            const value = item[field];
            if (!Number.isSafeInteger(value) || value < 0 || value > MAX_BONUS) {
                throw new Error(`${where}.${field} must be 0-${MAX_BONUS}, got ${value}`);
            }
            bonuses[field] = value;
        }

        return { itemType: item.itemType, slot: item.slot, ...bonuses };
    });
}

function assertPositiveInt(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${field} must be a positive integer, got ${value}`);
    }
}
