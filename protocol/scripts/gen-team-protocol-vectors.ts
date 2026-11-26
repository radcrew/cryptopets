/**
 * Writes contracts/test-vectors/protocol-team.json: canonical-hash vectors for every protocol
 * object team battles added (docs/battle-protocol.md §F; docs/plan-team-battles-3v3.md,
 * Phase 2). The defence plan, the team intent (intent v2), the team snapshot (snapshot v3),
 * ruleset v3, a commitment over a team snapshot, the team combat log (combat log v2) and the
 * team receipt (receipt v2).
 *
 * Run with `pnpm --filter @cryptopets/protocol vectors:protocol-team`.
 *
 * **Regenerating to make a failing test pass is forbidden** (`AGENTS.md`). These hashes are
 * what signatures will be made over; a failure means an encoding drifted. This script exists
 * to add cases. It writes its own file only, and never the duel vectors gen-vectors.ts owns.
 *
 * Objects are stored whole, in their JSON wire form, so a test rebuilds exactly what was
 * hashed. Receipts are coherent rather than field bags, as the duel ones are: a real quicknet
 * beacon, the seed derived from the receipt's own inputs, the draw and the fight replayed,
 * and progression recomputed. `assertTeamBattleReceipt` would refuse anything less.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    computeTeamProgression,
    type DefensePlan,
    deriveBattleSeed,
    type EquipEntry,
    type Hex,
    hashBattleCommitment,
    hashDefensePlan,
    hashRuleset,
    hashTeamBattleIntent,
    hashTeamBattleReceipt,
    hashTeamBattleSnapshot,
    hashTeamCombatLog,
    type PetSnapshot,
    replayTeamBattle,
    type Ruleset,
    serializeRuleset,
    type TeamBattleIntent,
    type TeamBattleReceipt,
    type TeamBattleSnapshot,
    TEAM_SOURCE_DEFAULT_RULESET,
} from '../src';

const DOMAIN = { chainId: 'eip155:84532', deploymentId: 'base-sepolia-live' } as const;
const ATTACKER_OWNER = '0xabcdef0123456789abcdef0123456789abcdef01';
const DEFENDER_OWNER = '0x2222222222222222222222222222222222222222';
const QUICKNET = '0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';

// From protocol/tests/fixtures/drand.json, fetched from the live network, as gen-vectors.ts uses it.
const BEACON = {
    chainHash: QUICKNET,
    round: 1000,
    signature:
        '0xb44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39',
    randomness: '0xfe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd',
} as const;
const BEACON_PUBLISHED_AT = 1692806367;

const SWORD: EquipEntry = { slot: 0, itemType: 3n, hp: 0, atk: 22, def: 0, int: 0, mdef: 0 };
const ARMOUR: EquipEntry = { slot: 1, itemType: 7n, hp: 45, atk: 0, def: 16, int: 0, mdef: 6 };

/**
 * The ruleset every object here is bound to: the team defaults with a catalog declaring the
 * two items the pets wear. Without it the receipts would carry gear no catalog prices, which
 * acceptance refuses, so they would lock in a receipt production can never sign.
 */
const RULESET: Ruleset = {
    ...TEAM_SOURCE_DEFAULT_RULESET,
    itemCatalog: [
        { itemType: 3n, slot: 0, hp: 0, atk: 22, def: 0, int: 0, mdef: 0 },
        { itemType: 7n, slot: 1, hp: 45, atk: 0, def: 16, int: 0, mdef: 6 },
    ],
};

function pet(petId: bigint, owner: string, dna: bigint, level: number, skill: number, extra: Partial<PetSnapshot> = {}): PetSnapshot {
    return {
        petId, owner, dna, rarity: 2, level, skill, xp: 40, lastOpponentId: 0n, streak: 0,
        readyAt: 1692800000, sourceVersion: 1692800100n, ...extra,
    };
}

const ATTACKERS: TeamBattleSnapshot['attackers'] = [
    { pet: pet(11n, ATTACKER_OWNER, 3412405035806012n, 12, 4, { equipment: [SWORD] }), col: 2, row: 1, tactic: 'focus' },
    { pet: pet(12n, ATTACKER_OWNER, 3412477554741624n, 13, 3), col: 1, row: 1, tactic: 'breaker' },
    { pet: pet(13n, ATTACKER_OWNER, 3412457044705502n, 11, 2, { lastOpponentId: 21n, streak: 2 }), col: 1, row: 2, tactic: 'hunter' },
];
const ROSTER: TeamBattleSnapshot['roster'] = [
    { pet: pet(21n, DEFENDER_OWNER, 3412757264528005n, 14, 5), rank: 1, col: 1, row: 1, tactic: 'breaker' },
    { pet: pet(22n, DEFENDER_OWNER, 3412555075457001n, 12, 1), rank: 2, col: 2, row: 1, tactic: 'hunter' },
    { pet: pet(23n, DEFENDER_OWNER, 3412506055309003n, 10, 0, { equipment: [ARMOUR] }), rank: 3, col: 2, row: 0, tactic: 'bodyguard' },
    { pet: pet(24n, DEFENDER_OWNER, 3412604060506004n, 9, 7), rank: 4, col: 2, row: 2, tactic: 'focus' },
    { pet: pet(25n, DEFENDER_OWNER, 3412306070405002n, 8, 6), rank: 5, col: 0, row: 1, tactic: 'focus' },
];
const SNAPSHOT: TeamBattleSnapshot = {
    domain: DOMAIN, attackers: ATTACKERS, roster: ROSTER, takenAt: BEACON_PUBLISHED_AT - 6, schemaVersion: 3,
};

const PLAN: DefensePlan = {
    domain: DOMAIN,
    defenderOwner: DEFENDER_OWNER,
    roster: ROSTER.map((m) => ({ petId: m.pet.petId, rank: m.rank, col: m.col, row: m.row, tactic: m.tactic })),
    rulesetHash: hashRuleset(RULESET),
    minLevel: 1,
    maxLevel: 20,
    maxBattlesPerDay: 5,
    notBefore: 1692700000,
    expiresAt: 1695300000,
    revocationNonce: 0,
};

const INTENT: TeamBattleIntent = {
    domain: DOMAIN,
    attackerOwner: ATTACKER_OWNER,
    attackers: ATTACKERS.map((m) => ({ petId: m.pet.petId, col: m.col, row: m.row, tactic: m.tactic })),
    defenderOwner: DEFENDER_OWNER,
    defensePlanHash: hashDefensePlan(PLAN),
    challengeId: null,
    clientNonce: '01hq8z0000000000000000',
    rulesetHash: hashRuleset(RULESET),
    expiresAt: 1692806661,
};

const rulesetCases: { name: string; note: string; ruleset: Ruleset }[] = [
    { name: 'team-source-default', note: 'TEAM_SOURCE_DEFAULT_RULESET: layout 3 with the launch team rules and an empty catalog.', ruleset: TEAM_SOURCE_DEFAULT_RULESET },
    { name: 'team-geared', note: 'The team defaults plus a catalog declaring the two items the vector pets wear. Every other object in this file is bound to it.', ruleset: RULESET },
    {
        name: 'team-tuned-with-catalog',
        note: 'Every team value moved off its default, plus a two-item catalog, so each field provably reaches the hash.',
        ruleset: {
            ...TEAM_SOURCE_DEFAULT_RULESET,
            version: 3,
            itemCatalog: [
                { itemType: 3n, slot: 0, hp: 0, atk: 22, def: 0, int: 0, mdef: 0 },
                { itemType: 7n, slot: 1, hp: 45, atk: 0, def: 16, int: 0, mdef: 6 },
            ],
            teamConfig: { turnOrder: 'int', comboStepPct: 12, exposePct: 125, auraPct: 108, tailwindBps: 150, longShotPct: 80, temperamentPct: 104 },
        },
    },
];

function receipt(battleId: string, sequence: number, previous: Hex | null, links: (Hex | null)[]): TeamBattleReceipt {
    const ruleset = RULESET;
    const rulesetHash = hashRuleset(ruleset);
    const seed = deriveBattleSeed({
        domain: DOMAIN,
        drandRandomness: BEACON.randomness,
        battleId,
        snapshotHash: hashTeamBattleSnapshot(SNAPSHOT),
        rulesetHash,
    }).hex;
    const { drawn, outcome } = replayTeamBattle(SNAPSHOT, seed, ruleset);
    return {
        schemaVersion: 2,
        domain: DOMAIN,
        battleId,
        intentHash: hashTeamBattleIntent(INTENT),
        commitmentHash: `0x${'22'.repeat(32)}`,
        defensePlanHash: hashDefensePlan(PLAN),
        snapshot: SNAPSHOT,
        beacon: BEACON,
        seed,
        rulesetVersion: ruleset.version,
        rulesetHash,
        drawn,
        result: {
            attackerWon: outcome.result.attackerWins,
            rounds: outcome.result.rounds,
            winnerHpRemaining: outcome.result.winnerHpRemaining,
        },
        combatLogHash: hashTeamCombatLog(outcome),
        progression: computeTeamProgression(SNAPSHOT, drawn, outcome.result.attackerWins, { maxLevel: ruleset.maxLevel }),
        sequence,
        previousReceiptHash: previous,
        fighterPreviousReceiptHashes: links,
        createdAt: BEACON_PUBLISHED_AT + 1,
        signingKeyId: 'battle-signer-2026-07',
    };
}

const FIRST = receipt('btl_team_01', 1, null, [null, null, null, null, null, null]);
const LINKED = receipt('btl_team_02', 2, hashTeamBattleReceipt(FIRST), [
    `0x${'a1'.repeat(32)}`, null, `0x${'a3'.repeat(32)}`, null, `0x${'b2'.repeat(32)}`, null,
]);

/** JSON with bigints as decimal strings: the wire form the backend serves. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));

const doc = {
    description:
        'Team battle protocol vectors (docs/battle-protocol.md §F). Generated by protocol/scripts/gen-team-protocol-vectors.ts. Each object is stored whole in its JSON wire form (bigints as decimal strings) beside the hash it must encode to. Receipts are coherent: a real quicknet beacon, the seed derived from the receipt inputs, the draw and fight replayed, progression recomputed. Never edit an expectation to match new output.',
    defensePlans: [
        { name: 'five-pet-roster', note: 'Ranks in roster order, every tactic used, mixed tiles.', plan: wire(PLAN), expectedPlanHash: hashDefensePlan(PLAN) },
        {
            name: 'reordered-roster',
            note: 'The same five pets with the first two swapped. Roster order is slot order, so this is a different plan and a different hash.',
            plan: wire({ ...PLAN, roster: [PLAN.roster[1], PLAN.roster[0], ...PLAN.roster.slice(2)] }),
            expectedPlanHash: hashDefensePlan({ ...PLAN, roster: [PLAN.roster[1]!, PLAN.roster[0]!, ...PLAN.roster.slice(2)] }),
        },
    ],
    teamIntents: [
        { name: 'direct-team-challenge', note: 'No matchmaking challenge.', intent: wire(INTENT), expectedIntentHash: hashTeamBattleIntent(INTENT) },
        {
            name: 'matchmade-team-challenge',
            note: 'A matchmaking challenge id is present.',
            intent: wire({ ...INTENT, challengeId: 'mm_team_7' }),
            expectedIntentHash: hashTeamBattleIntent({ ...INTENT, challengeId: 'mm_team_7' }),
        },
    ],
    teamSnapshots: [{ name: 'eight-pets-two-geared', note: 'Three attackers and a five-pet roster; one geared pet each side.', snapshot: wire(SNAPSHOT), expectedSnapshotHash: hashTeamBattleSnapshot(SNAPSHOT) }],
    rulesets: rulesetCases.map((c) => ({ name: c.name, note: c.note, bundle: serializeRuleset(c.ruleset), expectedRulesetHash: hashRuleset(c.ruleset) })),
    commitments: [
        {
            name: 'commitment-over-team-snapshot',
            note: 'The commitment layout is unchanged; its snapshot hash is the team snapshot\'s, and its consent hash is the defence plan\'s.',
            commitment: wire({
                domain: DOMAIN, battleId: 'btl_team_01', intentHash: hashTeamBattleIntent(INTENT), defenseAuthorizationHash: hashDefensePlan(PLAN),
                snapshot: SNAPSHOT, rulesetVersion: 2, rulesetHash: hashRuleset(RULESET), drandChainHash: QUICKNET,
                drandRound: 1000, acceptedAt: BEACON_PUBLISHED_AT - 6, previousCommitmentHash: null, signingKeyId: 'battle-signer-2026-07',
            }),
            expectedCommitmentHash: hashBattleCommitment({
                domain: DOMAIN, battleId: 'btl_team_01', intentHash: hashTeamBattleIntent(INTENT), defenseAuthorizationHash: hashDefensePlan(PLAN),
                snapshot: SNAPSHOT, rulesetVersion: 2, rulesetHash: hashRuleset(RULESET), drandChainHash: QUICKNET,
                drandRound: 1000, acceptedAt: BEACON_PUBLISHED_AT - 6, previousCommitmentHash: null, signingKeyId: 'battle-signer-2026-07',
            }),
        },
    ],
    teamReceipts: [
        { name: 'first-team-receipt-under-key', note: 'Sequence 1; no fighter has fought before.', receipt: wire(FIRST), expectedReceiptHash: hashTeamBattleReceipt(FIRST) },
        { name: 'linked-team-receipt', note: 'Sequence 2, linked to the first, with some fighters linked to earlier battles and some not.', receipt: wire(LINKED), expectedReceiptHash: hashTeamBattleReceipt(LINKED) },
    ],
};

const out = join(process.cwd(), '../contracts/test-vectors/protocol-team.json');
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log('wrote', out);
console.log('  drawn', FIRST.drawn.join(','), 'result', JSON.stringify(FIRST.result), 'receipt', hashTeamBattleReceipt(FIRST));
