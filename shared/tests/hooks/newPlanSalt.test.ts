import { describe, expect, it, vi } from 'vitest';

import { newPlanSalt } from '../../src/hooks/battle/useDefensePlan';

describe('newPlanSalt', () => {
    it('is 32 random bytes as hex, different every time', () => {
        const a = newPlanSalt();
        const b = newPlanSalt();
        expect(a).toMatch(/^0x[0-9a-f]{64}$/);
        expect(b).toMatch(/^0x[0-9a-f]{64}$/);
        expect(a).not.toBe(b);
    });

    // A guessable salt would hand the hidden roster to anyone hashing candidate rosters, so
    // without a secure source the plan is not saved at all rather than salted weakly.
    it('refuses rather than fall back to a weak source', () => {
        vi.stubGlobal('crypto', {});
        try {
            expect(() => newPlanSalt()).toThrow(/no secure random source/);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
