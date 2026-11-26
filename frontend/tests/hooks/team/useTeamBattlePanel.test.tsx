import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const submit = vi.fn();
const state = {
    opponents: [] as unknown[],
    pets: [] as unknown[],
    battle: undefined as { state: string; failureReason: string | null } | undefined,
    result: { data: undefined as unknown, isError: false, error: null as Error | null },
    pending: false,
};

vi.mock('@shared/core', async () => ({
    ...(await vi.importActual<object>('@shared/core')),
    useTeamOpponents: () => ({ data: state.opponents, isLoading: false }),
    usePetList: () => ({ pets: state.pets }),
    useSubmitTeamChallenge: () => ({ submit, isPending: state.pending, error: null }),
    useBackendBattle: (battleId: string | null) => ({ data: battleId ? state.battle : undefined }),
    useTeamBattleResult: () => state.result,
}));

import { useTeamBattlePanel } from '@hooks/team/useTeamBattlePanel';

const pet = (id: string, level = 10) => ({ id, name: `Pet ${id}`, dna: 1234567890123456n + BigInt(id), level, rarity: 2, readyAt: 0, speciesId: 3 });
const OPPONENT = { planHash: '0xplan', defenderOwner: '0xdef', minLevel: 1, maxLevel: 30, expiresAt: 0, roster: [], ready: true };

beforeEach(() => {
    vi.clearAllMocks();
    state.opponents = [OPPONENT];
    state.pets = [pet('1'), pet('2'), pet('3'), pet('4')];
    state.battle = undefined;
    state.result = { data: undefined, isError: false, error: null };
    state.pending = false;
});

describe('building a squad', () => {
    it('places each added pet on the first free tile, front line first, and stops at three', () => {
        const { result } = renderHook(() => useTeamBattlePanel());
        act(() => {
            result.current.addPet('1');
            result.current.addPet('2');
            result.current.addPet('3');
            result.current.addPet('4');
        });
        expect(result.current.squad.map((m) => [m.petId, m.col, m.row])).toEqual([
            ['1', 2, 1],
            ['2', 2, 0],
            ['3', 2, 2],
        ]);
    });

    it('swaps two pets when one is moved onto the other tile', () => {
        const { result } = renderHook(() => useTeamBattlePanel());
        act(() => {
            result.current.addPet('1');
            result.current.addPet('2');
        });
        act(() => result.current.placePet('1', 2, 0));
        expect(result.current.squad.find((m) => m.petId === '1')).toMatchObject({ col: 2, row: 0 });
        expect(result.current.squad.find((m) => m.petId === '2')).toMatchObject({ col: 2, row: 1 });
    });

    it('can start only with three ready pets against a ready team', () => {
        const { result } = renderHook(() => useTeamBattlePanel());
        act(() => result.current.chooseOpponent(OPPONENT as never));
        expect(result.current.phase).toBe('build-squad');
        act(() => {
            result.current.addPet('1');
            result.current.addPet('2');
        });
        expect(result.current.canStart).toBe(false);
        act(() => result.current.addPet('3'));
        expect(result.current.canStart).toBe(true);
        expect(result.current.turnOrder).toHaveLength(3);
    });
});

describe('the battle', () => {
    it('signs the squad against the chosen plan, then follows the battle to its result', async () => {
        submit.mockResolvedValue({ battleId: 'btl_1' });
        state.battle = { state: 'computed', failureReason: null };
        const { result, rerender } = renderHook(() => useTeamBattlePanel());
        act(() => {
            result.current.chooseOpponent(OPPONENT as never);
            result.current.addPet('1');
            result.current.addPet('2');
            result.current.addPet('3');
        });
        await act(async () => result.current.start());

        expect(submit).toHaveBeenCalledWith({
            attackers: [
                { petId: '1', col: 2, row: 1, tactic: 'focus' },
                { petId: '2', col: 2, row: 0, tactic: 'focus' },
                { petId: '3', col: 2, row: 2, tactic: 'focus' },
            ],
            defenderOwner: '0xdef',
            defensePlanHash: '0xplan',
        });
        expect(result.current.phase).toBe('running');

        state.battle = { state: 'signed', failureReason: null };
        state.result = { data: { playback: {}, summary: {}, receipt: {} }, isError: false, error: null };
        rerender();
        expect(result.current.phase).toBe('result');
    });

    it('reports a failed battle, and a signed one whose result does not check out', async () => {
        submit.mockResolvedValue({ battleId: 'btl_1' });
        state.battle = { state: 'verification_failed', failureReason: 'engine mismatch' };
        const { result, rerender } = renderHook(() => useTeamBattlePanel());
        act(() => {
            result.current.chooseOpponent(OPPONENT as never);
            ['1', '2', '3'].forEach((id) => result.current.addPet(id));
        });
        await act(async () => result.current.start());
        expect(result.current.phase).toBe('failed');
        expect(result.current.failureReason).toBe('engine mismatch');

        state.battle = { state: 'signed', failureReason: null };
        state.result = { data: undefined, isError: true, error: new Error('combat log hashes to something else') };
        rerender();
        expect(result.current.phase).toBe('failed');
    });
});
