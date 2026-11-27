import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook as renderBare } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const submit = vi.fn();
const backendBattle = vi.fn();
const state = {
    opponents: [] as unknown[],
    pets: [] as unknown[],
    battle: undefined as { state: string; failureReason: string | null } | undefined,
    result: { data: undefined as unknown, isError: false, error: null as Error | null },
    pending: false,
};

vi.mock('@shared/core', async () => ({
    ...(await vi.importActual<object>('@shared/core')),
    useTeamOpponents: () => ({ data: state.opponents, isLoading: false, isFetching: false, refetch: vi.fn() }),
    usePetList: () => ({ pets: state.pets, isLoading: false }),
    useSubmitTeamChallenge: () => ({ submit, isPending: state.pending, error: null }),
    useBackendBattle: (battleId: string | null, options?: { pollIntervalMs?: number }) => {
        backendBattle(battleId, options);
        return { data: battleId ? state.battle : undefined };
    },
    useAuth: () => ({ isAuthenticated: true }),
    useTeamBattleResult: () => state.result,
}));

import { useTeamBattlePanel } from '@hooks/team/useTeamBattlePanel';

// The hook invalidates queries after a battle, so every render needs a client.
let queryClient: QueryClient;
const renderHook = <T,>(hook: () => T) =>
    renderBare(hook, {
        wrapper: ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
    });

const pet = (id: string, level = 10) => ({ id, name: `Pet ${id}`, dna: 1234567890123456n + BigInt(id), level, rarity: 2, readyAt: 0, speciesId: 3 });
const OPPONENT = { planHash: '0xplan', defenderOwner: '0xdef', minLevel: 1, maxLevel: 30, expiresAt: 0, ready: true };

beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient();
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

describe('the challenge screen', () => {
    it("counts the squad as its highest-level pet, and will not start against a team whose range leaves it out", () => {
        state.pets = [pet('1', 5), pet('2', 8), pet('3', 20)];
        const narrow = { ...OPPONENT, minLevel: 1, maxLevel: 15 };
        const { result } = renderHook(() => useTeamBattlePanel());
        act(() => {
            result.current.chooseOpponent(narrow as never);
            result.current.addPet('1');
            result.current.addPet('2');
            result.current.addPet('3');
        });
        expect(result.current.squadLevel).toBe(20);
        expect(result.current.levelInBand).toBe(false);
        expect(result.current.canStart).toBe(false);

        act(() => result.current.removePet('3'));
        act(() => result.current.addPet('1'));
        expect(result.current.squadLevel).toBe(8);
    });

    it('picks a random team only among ready ones the squad qualifies for', () => {
        const fits = { ...OPPONENT, planHash: '0xfits' };
        state.opponents = [
            { ...OPPONENT, planHash: '0xresting', ready: false },
            { ...OPPONENT, planHash: '0xtoohigh', minLevel: 50, maxLevel: 60 },
            fits,
        ];
        const { result } = renderHook(() => useTeamBattlePanel());
        act(() => result.current.addPet('1'));
        act(() => result.current.chooseRandomOpponent());
        expect(result.current.opponent?.planHash).toBe('0xfits');
    });

    it('clears the rival and the squad on cancel', () => {
        const { result } = renderHook(() => useTeamBattlePanel());
        act(() => {
            result.current.chooseOpponent(OPPONENT as never);
            result.current.addPet('1');
        });
        act(() => result.current.cancel());
        expect(result.current.opponent).toBeNull();
        expect(result.current.squad).toEqual([]);
    });
});

describe('while a battle is in flight', () => {
    const startBattle = async () => {
        submit.mockResolvedValue({ battleId: 'btl_1' });
        state.battle = { state: 'computed', failureReason: null };
        const hook = renderHook(() => useTeamBattlePanel());
        act(() => {
            hook.result.current.chooseOpponent(OPPONENT as never);
            hook.result.current.addPet('1');
            hook.result.current.addPet('2');
            hook.result.current.addPet('3');
        });
        await act(async () => hook.result.current.start());
        return hook;
    };

    it('locks the squad and the rival, so the running battle cannot be dropped', async () => {
        const { result } = await startBattle();
        expect(result.current.phase).toBe('running');
        expect(result.current.inFlight).toBe(true);
        expect(result.current.canStart).toBe(false);

        act(() => {
            result.current.removePet('1');
            result.current.addPet('4');
            result.current.setTactic('2', 'hunter');
            result.current.chooseOpponent(null);
            result.current.cancel();
            result.current.reset();
        });
        expect(result.current.squad.map((m) => m.petId)).toEqual(['1', '2', '3']);
        expect(result.current.squad[1]?.tactic).toBe('focus');
        expect(result.current.opponent).toEqual(OPPONENT);
        expect(result.current.battleId).toBe('btl_1');

        await act(async () => result.current.start());
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it('polls the battle every second, since a team battle has no room to push changes', async () => {
        await startBattle();
        expect(backendBattle).toHaveBeenLastCalledWith('btl_1', { pollIntervalMs: 1000 });
    });

    it('re-reads cooldowns and the team list once the battle ends, once', async () => {
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        const { result, rerender } = await startBattle();
        expect(invalidate).not.toHaveBeenCalled();

        state.battle = { state: 'signed', failureReason: null };
        state.result = { data: { playback: {}, summary: {}, receipt: {} }, isError: false, error: null };
        rerender();
        expect(result.current.phase).toBe('result');
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['battleProgress'] });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['battle', 'team-opponents'] });
        rerender();
        expect(invalidate).toHaveBeenCalledTimes(2);
    });

    it('can be put away and brought back, and a new battle opens it again', async () => {
        const { result } = await startBattle();
        expect(result.current.sceneOpen).toBe(true);
        act(() => result.current.hideScene());
        expect(result.current.sceneOpen).toBe(false);
        act(() => result.current.showScene());
        expect(result.current.sceneOpen).toBe(true);
    });
});

describe('moving a squad pet', () => {
    it('picks a pet up, moves it to the tile tapped next, and puts it down when tapped again', () => {
        const { result } = renderHook(() => useTeamBattlePanel());
        act(() => {
            result.current.addPet('1');
            result.current.addPet('2');
        });
        act(() => result.current.selectPet('1'));
        expect(result.current.moving).toBe('1');
        act(() => result.current.placeMoving(0, 0));
        expect(result.current.squad.find((m) => m.petId === '1')).toMatchObject({ col: 0, row: 0 });
        act(() => result.current.selectPet('1'));
        expect(result.current.moving).toBeNull();
    });

    it('drops the pick when that pet leaves the squad', () => {
        const { result } = renderHook(() => useTeamBattlePanel());
        act(() => result.current.addPet('1'));
        act(() => result.current.selectPet('1'));
        act(() => result.current.removePet('1'));
        expect(result.current.moving).toBeNull();
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
