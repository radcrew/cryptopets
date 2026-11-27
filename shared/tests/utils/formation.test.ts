import { describe, expect, it } from 'vitest';

import { analyzeFormation, type FormationPet } from '../../src/utils/team/formation';
import { previewSquadTurnOrder } from '../../src/utils/team/teamPlayback';

// Skill indices as the engine numbers them.
const TANK = 0;
const SHELL = 1;
const SWIFT = 2;
const FURY = 4;
const SAGE = 5;
const BLOODLUST = 7;

/** DNA built pair by pair from the right: element 0, then every stat gene 34 except INT (pair 4). */
const dnaWithInt = (intGene: number) =>
    [0, 34, 34, 34, intGene, 34, 34, 34].reduce((dna, gene, k) => dna + BigInt(gene) * 100n ** BigInt(k), 0n);

const pet = (name: string, col: number, row: number, skill: number, intGene = 40): FormationPet => ({
    name,
    col,
    row,
    skill,
    // Only the INT gene differs between pets, so it alone decides turn order among non-Shell pets.
    dna: dnaWithInt(intGene),
    rarity: 1,
    level: 10,
});

const texts = (pets: FormationPet[]) => analyzeFormation(pets).notes.map((n) => `${n.kind}: ${n.text}`);

describe('analyzeFormation', () => {
    it('warns when one fragile pet holds the front line alone, and approves a lone Tank or Shell', () => {
        expect(texts([pet('Ember', 2, 1, FURY), pet('Nyx', 1, 1, FURY)])[0]).toBe(
            'warning: Ember holds the front line alone, so every Melee strike lands on it until it falls.',
        );
        expect(texts([pet('Brook', 2, 1, SHELL), pet('Nyx', 0, 1, FURY)])[0]).toBe(
            'good: Brook holds the front line alone, and is built to take the hits.',
        );
        expect(texts([pet('Ember', 2, 0, FURY), pet('Volt', 2, 2, FURY)])[0]).toBe(
            'info: Ember and Volt share the front line, so Melee strikes are spread between them.',
        );
    });

    it('reports the front line as the front-most occupied column, wherever that is', () => {
        const report = analyzeFormation([pet('A', 0, 0, FURY), pet('B', 1, 0, FURY), pet('C', 1, 2, FURY)]);
        expect(report.frontLine).toEqual([1, 2]);
    });

    it('counts only side-by-side tiles as neighbours, never a diagonal', () => {
        // Fern and Brook touch along a side; Comet is diagonal to Fern.
        const notes = texts([pet('Fern', 2, 0, TANK), pet('Brook', 2, 1, SHELL), pet('Comet', 1, 1, SAGE)]);
        expect(notes).toContain('good: Fern can guard Brook from one knockout blow per battle.');
        expect(notes).toContain("good: Brook's Shell aura gives Fern and Comet 10% more DEF.");
        expect(notes).toContain("good: Comet's Sage aura gives Brook 10% more MDEF.");
    });

    it('flags support skills with no teammate in reach', () => {
        const notes = texts([pet('Fern', 2, 0, TANK), pet('Volt', 2, 2, SWIFT), pet('Vex', 0, 1, BLOODLUST)]);
        expect(notes).toContain('warning: Fern is a Tank with no neighbour to guard.');
        expect(notes).toContain("warning: Volt's Tailwind reaches no teammate.");
        expect(notes).toContain("info: Vex's Lifelink can only heal itself, with no neighbour.");
    });

    it('orders the team exactly as the turn-order preview does', () => {
        const pets = [pet('A', 2, 0, FURY, 10), pet('B', 2, 1, SHELL, 90), pet('C', 1, 1, FURY, 60)];
        expect(analyzeFormation(pets).turnOrder).toEqual(previewSquadTurnOrder(pets));
        // The Shell pet acts last despite the highest INT, and C (INT 60) before A (INT 10).
        expect(analyzeFormation(pets).turnOrder).toEqual([2, 0, 1]);
    });

    it('says nothing about an empty team', () => {
        expect(analyzeFormation([])).toEqual({ turnOrder: [], frontLine: [], notes: [] });
    });
});
