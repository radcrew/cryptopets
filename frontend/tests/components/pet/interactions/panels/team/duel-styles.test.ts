import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The team screens borrow the duel's showdown and battle scene styles (`../battle/index.module.css`,
 * imported as `duel`), so the two battles share one look. A CSS module returns `undefined` for a
 * class it does not have, so renaming or removing one of those classes in the duel would silently
 * unstyle the team screens. This keeps that failure loud: every `duel.<name>` a team component
 * uses must be a class the duel's stylesheet defines.
 */
const panels = `${resolve(__dirname, '../../../../../../src/components/pet/interactions/panels')}/`;

const classesIn = (css: string) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]));

describe('the duel styles the team screens borrow', () => {
    const duelClasses = classesIn(readFileSync(`${panels}battle/index.module.css`, 'utf8'));
    const teamFiles = readdirSync(`${panels}team`).filter((f) => f.endsWith('.tsx'));

    it('are all defined in the duel stylesheet', () => {
        const missing: string[] = [];
        let used = 0;
        for (const file of teamFiles) {
            const source = readFileSync(`${panels}team/${file}`, 'utf8');
            for (const [, name] of source.matchAll(/\bduel\.([a-zA-Z0-9]+)/g)) {
                used += 1;
                if (!duelClasses.has(name!)) missing.push(`${file}: duel.${name}`);
            }
        }
        expect(used).toBeGreaterThan(0);
        expect(missing).toEqual([]);
    });
});
