// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUICKNET } from '@cryptopets/protocol';

import { usePulseRound } from '../../src/hooks/battle/usePulseRound';

/** One second into round `round`, on the same convention as `latestRoundAt`. */
const insideRound = (round: number) => (QUICKNET.genesisTimeSeconds + round * QUICKNET.periodSeconds + 1) * 1000;

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('usePulseRound', () => {
    it('reports the round due by the clock and when the next one lands', () => {
        vi.setSystemTime(insideRound(1000));
        const { result } = renderHook(() => usePulseRound());
        expect(result.current.round).toBe(1000);
        expect(result.current.nextBeatAt).toBe((QUICKNET.genesisTimeSeconds + 1001 * 3) * 1000);
    });

    it('moves to the next round on the beat, every 3 seconds', () => {
        vi.setSystemTime(insideRound(1000));
        const { result } = renderHook(() => usePulseRound());

        act(() => {
            vi.advanceTimersByTime(2100);
        });
        expect(result.current.round).toBe(1001);

        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(result.current.round).toBe(1002);
    });
});
