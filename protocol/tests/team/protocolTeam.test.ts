import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    assertBattleReceipt,
    assertDefensePlan,
    assertRuleset,
    assertTeamBattleIntent,
    assertTeamBattleReceipt,
    assertTeamBattleSnapshot,
    type BattleCommitment,
    type BattleReceipt,
    type DefensePlan,
    defensePlanTypedData,
    hashBattleCommitment,
    hashDefensePlan,
    hashRuleset,
    hashTeamBattleIntent,
    hashTeamBattleReceipt,
    hashTeamBattleSnapshot,
    hashTeamCombatLog,
    parseRulesetBundle,
    petPreviousReceiptHash,
    planCovers,
    replayTeamBattle,
    type Ruleset,
    serializeRuleset,
    SOURCE_DEFAULT_RULESET,
    type TeamBattleIntent,
    type TeamBattleReceipt,
    teamBattleIntentTypedData,
    type TeamBattleSnapshot,
    teamFighterIds,
    teamReceiptFromWire,
    TEAM_SOURCE_DEFAULT_RULESET,
    verifyReceiptChain,
    verifyTeamReceiptProgression,
    type WireTeamBattleReceipt,
} from '../../src';

/**
 * contracts/test-vectors/protocol-team.json: every object team battles added, rebuilt from
 * its wire form and hashed. A failure means an encoding drifted; fix the code, never the
 * vector (`AGENTS.md`).
 */
interface Named {
    name: string;
    note: string;
}
type Vectors = {
    defensePlans: (Named & { plan: unknown; expectedPlanHash: string })[];
    teamIntents: (Named & { intent: unknown; expectedIntentHash: string })[];
    teamSnapshots: (Named & { snapshot: unknown; expectedSnapshotHash: string })[];
    rulesets: (Named & { bundle: string; expectedRulesetHash: string })[];
    commitments: (Named & { commitment: unknown; expectedCommitmentHash: string })[];
    teamReceipts: (Named & { receipt: WireTeamBattleReceipt; expectedReceiptHash: string })[];
};

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, '../../../contracts/test-vectors/protocol-team.json'), 'utf8')) as Vectors;

// Wire to typed: the bigint fields of each object. Receipts go through `teamReceiptFromWire`.
const big = (v: unknown) => BigInt(v as string);
const planFromWire = (w: unknown): DefensePlan => {
    const p = w as DefensePlan & { roster: { petId: string }[] };
    return { ...p, roster: p.roster.map((e) => ({ ...e, petId: big(e.petId) })) } as DefensePlan;
};
const intentFromWire = (w: unknown): TeamBattleIntent => {
    const i = w as TeamBattleIntent & { attackers: { petId: string }[] };
    return { ...i, attackers: i.attackers.map((a) => ({ ...a, petId: big(a.petId) })) } as TeamBattleIntent;
};
const snapshotFromWire = (w: unknown): TeamBattleSnapshot =>
    teamReceiptFromWire({ snapshot: w, progression: [] } as unknown as WireTeamBattleReceipt).snapshot;

const receipts = vectors.teamReceipts.map((c) => teamReceiptFromWire(c.receipt));
// Every object in the file is bound to the geared team ruleset; replay needs its catalog-free
// numbers and level cap, which the parsed bundle supplies.
const RULESET = parseRulesetBundle(vectors.rulesets.find((r) => r.name === 'team-geared')!.bundle);
const [first, linked] = receipts as [TeamBattleReceipt, TeamBattleReceipt];

describe('protocol-team.json', () => {
    it.each(vectors.defensePlans)('defence plan: $name', (c) => {
        expect(hashDefensePlan(planFromWire(c.plan))).toBe(c.expectedPlanHash);
    });

    it.each(vectors.teamIntents)('team intent: $name', (c) => {
        expect(hashTeamBattleIntent(intentFromWire(c.intent))).toBe(c.expectedIntentHash);
    });

    it.each(vectors.teamSnapshots)('team snapshot: $name', (c) => {
        expect(hashTeamBattleSnapshot(snapshotFromWire(c.snapshot))).toBe(c.expectedSnapshotHash);
    });

    it.each(vectors.rulesets)('ruleset v3: $name', (c) => {
        const ruleset = parseRulesetBundle(c.bundle);
        expect(hashRuleset(ruleset)).toBe(c.expectedRulesetHash);
        expect(serializeRuleset(ruleset)).toBe(c.bundle);
    });

    it.each(vectors.commitments)('commitment: $name', (c) => {
        const w = c.commitment as BattleCommitment;
        expect(hashBattleCommitment({ ...w, snapshot: snapshotFromWire(w.snapshot) })).toBe(c.expectedCommitmentHash);
    });

    it.each(vectors.teamReceipts)('team receipt: $name', (c) => {
        expect(hashTeamBattleReceipt(teamReceiptFromWire(c.receipt))).toBe(c.expectedReceiptHash);
    });

    // The receipts are only worth pinning if they are true. Replay each one from scratch.
    it.each(receipts.map((r) => [r.battleId, r] as const))('replays %s to the recorded result and log', (_id, r) => {
        expect(hashRuleset(RULESET)).toBe(r.rulesetHash);
        const outcome = replayTeamBattle(r.snapshot, r.seed, RULESET);
        expect(outcome.result.attackerWins).toBe(r.result.attackerWon);
        expect(outcome.result.rounds).toBe(r.result.rounds);
        expect(outcome.result.winnerHpRemaining).toBe(r.result.winnerHpRemaining);
        expect(hashTeamCombatLog(outcome)).toBe(r.combatLogHash);
        expect(verifyTeamReceiptProgression(r, { maxLevel: RULESET.maxLevel })).toEqual({ ok: true });
    });
});

describe('team receipts', () => {
    it('refuses a seed that does not follow from its inputs', () => {
        expect(() => assertTeamBattleReceipt({ ...first, battleId: 'btl_other' })).toThrow(/does not follow/);
    });

    it('lists the six fighters, attackers then defenders', () => {
        expect(teamFighterIds(first)).toEqual([11n, 12n, 13n, 21n, 22n, 23n]);
        const shuffled = [first.progression[1]!, first.progression[0]!, ...first.progression.slice(2)];
        expect(() => assertTeamBattleReceipt({ ...first, progression: shuffled })).toThrow(/progression\[0\]/);
    });

    it('catches a wrong XP award', () => {
        const tampered = first.progression.map((p, i) => (i === 4 ? { ...p, xpAwarded: p.xpAwarded + 1 } : p));
        const result = verifyTeamReceiptProgression({ ...first, progression: tampered }, { maxLevel: 100 });
        expect(result.ok).toBe(false);
    });

    it('is refused by the duel validator, and the reverse', () => {
        expect(() => assertBattleReceipt(first as unknown as BattleReceipt)).toThrow(/not a duel receipt/);
        expect(() => assertTeamBattleReceipt({ ...first, schemaVersion: 1 as never })).toThrow(/schema version 2/);
    });

    it('chains: the second links to the first', () => {
        expect(verifyReceiptChain([first, linked], null)).toEqual({ ok: true });
        expect(verifyReceiptChain([linked, first], null).ok).toBe(false);
    });

    it('links each of the six fighters, and no pet that did not fight', () => {
        const fighters = teamFighterIds(linked);
        expect(petPreviousReceiptHash(linked, fighters[0]!)).toBe(`0x${'a1'.repeat(32)}`);
        expect(petPreviousReceiptHash(linked, fighters[4]!)).toBe(`0x${'b2'.repeat(32)}`);
        expect(petPreviousReceiptHash(linked, fighters[5]!)).toBeNull();
        expect(petPreviousReceiptHash(linked, 99n)).toBeUndefined();
    });
});

describe('defence plans', () => {
    const plan = planFromWire(vectors.defensePlans[0]!.plan);

    it.each([
        ['two pets', { roster: plan.roster.slice(0, 2) }, /exactly 3/],
        ['a pet twice', { roster: [plan.roster[0]!, ...plan.roster.slice(0, 2)] }, /listed twice/],
        ['two pets on one tile', { roster: plan.roster.map((e, i) => (i === 1 ? { ...e, col: 1, row: 1 } : e)) }, /share tile/],
        ['an unknown tactic', { roster: plan.roster.map((e, i) => (i === 1 ? { ...e, tactic: 'charge' as never } : e)) }, /unknown tactic/],
    ])('refuses %s', (_name, patch, error) => {
        expect(() => assertDefensePlan({ ...plan, ...patch })).toThrow(error);
    });

    it('covers a squad inside its level band, under its ruleset, in its window', () => {
        const query = { attackerLevel: 13, rulesetHash: plan.rulesetHash, nowSeconds: 1692806361 };
        expect(planCovers(plan, query)).toEqual({ covered: true });
        expect(planCovers(plan, { ...query, attackerLevel: 21 })).toEqual({ covered: false, reason: 'attacker-level-above-band' });
        expect(planCovers(plan, { ...query, rulesetHash: hashRuleset(SOURCE_DEFAULT_RULESET) })).toEqual({ covered: false, reason: 'ruleset-mismatch' });
        expect(planCovers(plan, { ...query, nowSeconds: plan.expiresAt })).toEqual({ covered: false, reason: 'expired' });
    });

    it('shows the owner every pet, tile and tactic by name', () => {
        const typed = defensePlanTypedData(plan);
        expect(typed.primaryType).toBe('DefensePlan');
        expect(typed.message.schemaVersion).toBe(1);
        expect(typed.message.roster).toHaveLength(3);
        expect(typed.message.roster[2]).toEqual({ petId: 23n, col: 2, row: 0, tactic: 'bodyguard' });
    });
});

describe('team intents', () => {
    const intent = intentFromWire(vectors.teamIntents[0]!.intent);

    it('needs exactly three distinct attackers', () => {
        expect(() => assertTeamBattleIntent({ ...intent, attackers: intent.attackers.slice(0, 2) })).toThrow(/exactly 3/);
        expect(() => assertTeamBattleIntent({ ...intent, attackers: [intent.attackers[0]!, intent.attackers[0]!, intent.attackers[2]!] })).toThrow(/listed twice/);
    });

    it('signs as intent schema version 2, with the placements by name', () => {
        const typed = teamBattleIntentTypedData(intent);
        expect(typed.primaryType).toBe('TeamBattleIntent');
        expect(typed.message.schemaVersion).toBe(2);
        expect(typed.message.attackers[1]).toEqual({ petId: 12n, col: 1, row: 1, tactic: 'breaker' });
        expect(typed.message.challengeId).toBe('');
    });

    it('refuses a Solana intent until Solana team battles exist', () => {
        expect(() => teamBattleIntentTypedData({ ...intent, domain: { ...intent.domain, chainId: 'solana:devnet' } })).toThrow(/EVM/);
    });
});

describe('team snapshots', () => {
    const snapshot = snapshotFromWire(vectors.teamSnapshots[0]!.snapshot);
    const withOwner = (owner: string) => snapshot.roster.map((m) => ({ ...m, pet: { ...m.pet, owner } }));

    it('refuses one owner on both sides', () => {
        expect(() => assertTeamBattleSnapshot({ ...snapshot, roster: withOwner(snapshot.attackers[0]!.pet.owner) })).toThrow(/against themselves/);
    });

    it('refuses two owners on one side', () => {
        const roster = snapshot.roster.map((m, i) => (i === 2 ? { ...m, pet: { ...m.pet, owner: '0x9999999999999999999999999999999999999999' } } : m));
        expect(() => assertTeamBattleSnapshot({ ...snapshot, roster })).toThrow(/same owner/);
    });

    it('refuses a pet on both sides', () => {
        const roster = snapshot.roster.map((m, i) => (i === 0 ? { ...m, pet: { ...m.pet, petId: 11n } } : m));
        expect(() => assertTeamBattleSnapshot({ ...snapshot, roster })).toThrow();
    });

    it('is always schema version 3', () => {
        expect(() => assertTeamBattleSnapshot({ ...snapshot, schemaVersion: 2 })).toThrow(/schema version 3/);
    });
});

describe('ruleset layout 3', () => {
    it('keeps the served ruleset on layout 2, so duel consent is untouched until rollout', () => {
        expect(SOURCE_DEFAULT_RULESET.schemaVersion).toBe(2);
        expect(SOURCE_DEFAULT_RULESET.teamConfig).toBeUndefined();
    });

    it('requires the team rules at 3 and refuses them before it', () => {
        const { teamConfig, ...withoutTeam } = TEAM_SOURCE_DEFAULT_RULESET;
        expect(teamConfig).toBeDefined();
        expect(() => assertRuleset(withoutTeam as Ruleset)).toThrow(/requires teamConfig/);
        expect(() => assertRuleset({ ...SOURCE_DEFAULT_RULESET, teamConfig: TEAM_SOURCE_DEFAULT_RULESET.teamConfig! })).toThrow(/cannot carry team rules/);
    });

    it('refuses the speed turn order until Attributes 2.0', () => {
        expect(() =>
            assertRuleset({ ...TEAM_SOURCE_DEFAULT_RULESET, teamConfig: { ...TEAM_SOURCE_DEFAULT_RULESET.teamConfig!, turnOrder: 'speed' } }),
        ).toThrow(/until Attributes 2.0/);
    });

    it('refuses an unknown team key in a published bundle', () => {
        const bundle = JSON.parse(serializeRuleset(TEAM_SOURCE_DEFAULT_RULESET)) as { teamConfig: Record<string, unknown> };
        bundle.teamConfig.surprise = 1;
        expect(() => parseRulesetBundle(JSON.stringify(bundle))).toThrow(/unexpected keys: surprise/);
    });
});
