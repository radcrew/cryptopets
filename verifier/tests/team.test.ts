import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    hashRuleset,
    hashTeamBattleReceipt,
    parseRulesetBundle,
    type Ruleset,
    type TeamBattleReceipt,
    teamReceiptFromWire,
    TEAM_SOURCE_DEFAULT_RULESET,
    type WireTeamBattleReceipt,
} from '@cryptopets/protocol';

import { builtInRulesets, type SignedReceiptEnvelope, verifyReceipts } from '../src';
import { pinnedRulesets } from '../src/ruleset';
import { buildReceipt, envelopeFor, signWithTestKey, testTrustedKey } from './fixtures/signedReceipt';

/**
 * Team receipts through the public verifier (§H), using the coherent receipts in
 * contracts/test-vectors/protocol-team.json: real beacon, derived seed, replayed fight.
 * Signed here with the test key, since the vectors pin hashes, not signatures.
 */
const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, '../../contracts/test-vectors/protocol-team.json'), 'utf8')) as {
    rulesets: { name: string; bundle: string }[];
    teamReceipts: { receipt: WireTeamBattleReceipt }[];
};
const GEARED = parseRulesetBundle(vectors.rulesets.find((r) => r.name === 'team-geared')!.bundle);
const [FIRST, LINKED] = vectors.teamReceipts.map((c) => teamReceiptFromWire(c.receipt)) as [TeamBattleReceipt, TeamBattleReceipt];

const toWire = (r: TeamBattleReceipt) =>
    JSON.parse(JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))) as WireTeamBattleReceipt;

function envelope(receipt: TeamBattleReceipt): SignedReceiptEnvelope {
    const receiptHash = hashTeamBattleReceipt(receipt);
    return { receiptHash, signature: signWithTestKey(receiptHash), signingKeyId: receipt.signingKeyId, payload: toWire(receipt) };
}

const registry = (ruleset: Ruleset = GEARED) => new Map([[hashRuleset(GEARED).toLowerCase(), ruleset]]);
const verify = (envelopes: SignedReceiptEnvelope[], ruleset?: Ruleset) =>
    verifyReceipts(envelopes, [testTrustedKey()], { rulesets: registry(ruleset) });
const failed = (report: ReturnType<typeof verify>) => report.results.filter((r) => !r.ok).map((r) => r.check);

describe('team receipts in the public verifier', () => {
    it('verifies an honest pair end to end', () => {
        const report = verify([envelope(FIRST), envelope(LINKED)]);
        expect(failed(report)).toEqual([]);
        const checks = new Set(report.results.map((r) => r.check));
        for (const check of ['seed-derivation', 'operator-signature', 'beacon-signature', 'combat-replay', 'equipment', 'progression', 'chain-continuity']) {
            expect(checks).toContain(check);
        }
    });

    it('catches a flipped result even when it is re-signed', () => {
        const forged = { ...FIRST, result: { ...FIRST.result, attackerWon: !FIRST.result.attackerWon } };
        expect(failed(verify([envelope(forged)]))).toEqual(expect.arrayContaining(['combat-replay', 'progression']));
        expect(failed(verify([envelope(forged)]))).not.toContain('operator-signature');
    });

    it('refuses a receipt whose defenders were rearranged after the battle', () => {
        // The seed derives from the snapshot hash, so reordering who defended breaks it. Built
        // by hand: such a receipt cannot even be hashed, so the forger reuses an honest
        // envelope around the tampered payload.
        const [a, b, c] = FIRST.snapshot.roster;
        const snapshot = { ...FIRST.snapshot, roster: [b!, a!, c!] };
        const forged: SignedReceiptEnvelope = { ...envelope(FIRST), payload: toWire({ ...FIRST, snapshot }) };
        expect(failed(verify([forged]))).toContain('malformed-receipt');
    });

    it('checks gear on the whole roster against the catalog, not only the first pet a side', () => {
        // The published catalog prices the armour differently from what the snapshot applied.
        const repriced: Ruleset = {
            ...GEARED,
            itemCatalog: GEARED.itemCatalog!.map((item) => (item.itemType === 7n ? { ...item, def: 10 } : item)),
        };
        const report = verify([envelope(FIRST)], repriced);
        const equipment = report.results.find((r) => r.check === 'equipment');
        expect(equipment?.ok).toBe(false);
        expect(equipment?.detail).toMatch(/roster\[2\]/);
    });

    it('notices a reordered chain', () => {
        expect(failed(verify([envelope(LINKED), envelope(FIRST)]))).toContain('chain-continuity');
    });

    it('follows one signing key through duels and team battles alike', () => {
        const duel = buildReceipt({
            battleId: 'btl_duel_after_team',
            sequence: 3,
            previousReceiptHash: hashTeamBattleReceipt(LINKED),
            createdAt: LINKED.createdAt + 5,
        });
        const rulesets = new Map([...builtInRulesets(), ...registry()]);
        const report = verifyReceipts([envelope(FIRST), envelope(LINKED), envelopeFor(duel)], [testTrustedKey()], { rulesets });
        expect(failed(report)).toEqual([]);
    });
});

describe('team rulesets', () => {
    it('are built in, and pinned so today team battles stay replayable later', () => {
        const hash = hashRuleset(TEAM_SOURCE_DEFAULT_RULESET).toLowerCase();
        expect(builtInRulesets().get(hash)).toEqual(TEAM_SOURCE_DEFAULT_RULESET);
        expect(pinnedRulesets().get(hash)).toEqual(TEAM_SOURCE_DEFAULT_RULESET);
    });
});
