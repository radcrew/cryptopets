import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    parseRulesetBundle,
    replayTeamBattle,
    teamReceiptFromWire,
    type WireTeamBattleReceipt,
} from '@cryptopets/protocol';

import {
    buildTeamPlayback,
    CombatLogMismatchError,
    describeStrike,
    previewSquadTurnOrder,
    summarizeTeamBattle,
    type TeamCombatLogWire,
} from '../../src/utils/team/teamPlayback';

/**
 * Driven by the first team receipt in contracts/test-vectors/protocol-team.json, with the combat
 * log rebuilt the way the backend stores and serves it (bigints as strings). So playback is
 * checked against the real engine's own final HP, not against itself.
 */
const vectors = JSON.parse(readFileSync(join(__dirname, '../../../contracts/test-vectors/protocol-team.json'), 'utf8')) as {
    rulesets: { name: string; bundle: string }[];
    teamReceipts: { receipt: WireTeamBattleReceipt }[];
};
const RECEIPT = teamReceiptFromWire(vectors.teamReceipts[0]!.receipt);
const RULESET = parseRulesetBundle(vectors.rulesets.find((r) => r.name === 'team-geared')!.bundle);
const { outcome } = replayTeamBattle(RECEIPT.snapshot, RECEIPT.seed, RULESET);
const SERVED: TeamCombatLogWire = JSON.parse(
    JSON.stringify({ startHp: outcome.startHp, log: outcome.log }, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
);

describe('buildTeamPlayback', () => {
    const playback = buildTeamPlayback(RECEIPT, SERVED);

    it('places the three attackers and the three drawn defenders on the board', () => {
        expect(playback.fighters[0].map((f) => f.petId)).toEqual(RECEIPT.snapshot.attackers.map((m) => m.pet.petId.toString()));
        expect(playback.fighters[1].map((f) => f.petId)).toEqual(RECEIPT.drawn.map((i) => RECEIPT.snapshot.roster[i]!.pet.petId.toString()));
        // Board columns: the attackers' own columns, the defenders' mirrored onto 3 to 5.
        for (const f of playback.fighters[1]) expect(f.x).toBe(5 - f.col);
    });

    it('ends every fighter on the HP the engine itself ended them on', () => {
        const last = playback.frames[playback.frames.length - 1]!;
        expect(last.hp).toEqual(outcome.finalHp.map((side) => side.map(Number)));
        expect(playback.frames).toHaveLength(outcome.log.length);
    });

    it('refuses a log that is not the one the receipt signed', () => {
        const tampered = structuredClone(SERVED);
        tampered.log[0] = { ...tampered.log[0], damage: String(Number(tampered.log[0]!.damage) + 1) };
        expect(() => buildTeamPlayback(RECEIPT, tampered)).toThrow(CombatLogMismatchError);
    });
});

describe('summarizeTeamBattle', () => {
    it('totals damage per fighter and names the winning side top scorer', () => {
        const playback = buildTeamPlayback(RECEIPT, SERVED);
        const summary = summarizeTeamBattle(playback, RECEIPT.result.attackerWon);
        const dealt = outcome.log.reduce((sum, s) => sum + Number(s.damage), 0);
        expect(summary.damage.flat().reduce((a, b) => a + b, 0)).toBe(dealt);
        expect(summary.rounds).toBe(RECEIPT.result.rounds);
        expect(summary.mvp?.side).toBe(RECEIPT.result.attackerWon ? 0 : 1);
        const winner = summary.damage[summary.mvp!.side];
        expect(winner[summary.mvp!.slot]).toBe(Math.max(...winner));
    });
});

describe('describeStrike', () => {
    it('names both fighters and every rule that fired', () => {
        const line = describeStrike(
            { round: 0, side: 0, actor: 1, target: 0, victim: 2, isMagic: false, crit: true, damage: 80, elementMult: 100, combo: 1,
                longShot: false, furyTriggered: false, temperament: false, exposed: true, guarded: true, secondChance: false,
                knockedOut: true, heal: 0, healed: null, victimHpAfter: 0 },
            (side, slot) => `${side === 0 ? 'A' : 'D'}${slot}`,
        );
        expect(line).toBe('A1 hits D0 for 80 (critical, combo ×2, exposed). D2 takes the hit for D0. D2 is knocked out.');
    });
});

describe('previewSquadTurnOrder', () => {
    it('matches the order the engine actually used for the attackers in round one', () => {
        const order = previewSquadTurnOrder(RECEIPT.snapshot.attackers.map((m) => ({ ...m.pet, equipment: m.pet.equipment ?? [] })));
        const engineOrder = outcome.log.filter((s) => s.round === 0 && s.side === 0).map((s) => s.actor);
        expect(order).toEqual(engineOrder);
    });

    it('puts a Shell pet last whatever its INT, and breaks an INT tie for Swift', () => {
        // The INT gene is DNA pair 4, as `extract` reads it.
        const pet = (skill: number, intGene: number) => ({ dna: 3400000000000000n + BigInt(intGene) * 100000000n, rarity: 1, level: 10, skill });
        expect(previewSquadTurnOrder([pet(1, 99), pet(99, 1), pet(99, 1)])).toEqual([1, 2, 0]);
        expect(previewSquadTurnOrder([pet(99, 50), pet(2, 50)])).toEqual([1, 0]);
        expect(previewSquadTurnOrder([pet(99, 10), pet(99, 60)])).toEqual([1, 0]);
    });
});
