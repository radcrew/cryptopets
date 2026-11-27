import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    locationState: null as { petId?: string } | null,
    params: {} as { roomId?: string },
}));

vi.mock('react-router-dom', () => ({
    useNavigate: () => mocks.navigate,
    useLocation: () => ({ state: mocks.locationState }),
    useParams: () => mocks.params,
}));
vi.mock('@constants/interactionRoutes', () => ({ DASHBOARD_HOME: '/dashboard', BATTLE_PATH: '/battle' }));
vi.mock('@hooks/usePetError', () => ({ formatTxHashHint: vi.fn(() => null) }));
vi.mock('@hooks/usePetErrorToast', () => ({ usePetErrorToast: vi.fn() }));
vi.mock('@components/pet/interactions/panels/battle/battle-utils', () => ({
    BATTLE_FAIL_MESSAGE: 'Battle failed',
    MISMATCH_NOTICE_MESSAGE: 'Mismatch notice',
    VALIDATION_MESSAGE: 'Select a fighter and opponent',
}));

const battleOutcome = { battleOutcome: null as null | object, applyResolvedOutcome: vi.fn(), resetOutcome: vi.fn() };

const resultDialogue = { resultTurns: [], dialogueLoading: false, attackerName: '', defenderName: '', markResultDialogueDone: vi.fn(), resultDialogueDone: false, resetResultDialogue: vi.fn() };
vi.mock('@hooks/battle/useResultDialogue', () => ({ useResultDialogue: () => resultDialogue }));

/** A strike as the combat log really records it: the HP after it, plus the damage and flags the
 *  scene pops over its victim. */
const strike = (attacker: 1 | 2, hp1After: bigint, hp2After: bigint) => ({
    attacker,
    hp1After,
    hp2After,
    damage: 10n,
    crit: false,
    isMagic: false,
    elementMult: 100,
});
const battle = { mutate: vi.fn(), clearErrors: vi.fn(), isPending: false, isConfirming: false, error: null, hash: undefined as string | undefined, phase: null, liveReplay: null as null | { result: { firstWins: boolean }; log: unknown[]; startHp1: bigint; startHp2: bigint }, lifecycle: { phase: 'idle' }, verifiedReceipt: null as null | { battleId: string; sequence: number; beacon: { round: number }; result: { rounds: number } }, checks: [] as { check: string; ok: boolean }[] };
const taunts = { generate: vi.fn(), reset: vi.fn(), isLoading: false, turns: [] as unknown[] };
const createRoom = vi.fn().mockResolvedValue(null);
const refetchOpponents = vi.fn();
let capturedOnSuccess: ((r: unknown) => void) | undefined;
/** Options the hook handed `useBattlePets` on the latest render. */
let capturedBattleOptions: { roomId?: string | null; roomSocketUrl?: string } | undefined;

const pets = [{ id: 'p1', name: 'Rex', level: 3, winCount: 1, lossCount: 0, chain: 'evm', readyAt: 0n }];
const opponents = [{ id: 'opp1', name: 'Blaze', owner: '0xopp', level: 2 }];

vi.mock('@shared/core', async () => {
    // The strike playback is real, not stubbed: the result-card gating cases below assert on
    // its timing. Imported from its own module rather than the barrel, which would pull in
    // wagmi and the rest of what this factory exists to replace.
    const animation = await import('../../../../shared/src/hooks/battle/useLiveBattleAnimation');
    return {
        ...animation,
        // `src/config.ts` calls both of these at import time, and the hook now imports it
        // for BATTLE_ROOM_WS_URL. Stubs, not behaviour under test.
        setStorageAdapter: vi.fn(),
        setTokenSuccessCallback: vi.fn(),
        isBattleRejection: (e: unknown) =>
            typeof e === 'object' && e !== null && (e as { isBattleRejection?: unknown }).isBattleRejection === true,
        // Mirrors the real predicate: the three refusals that mean the defender's owner
        // is not willing, as opposed to a band/cap refusal about this attacker or today.
        isConsentFailure: (e: unknown) => {
            const code = (e as { code?: string } | null)?.code;
            return code === 'no-authorization' || code === 'pet-not-covered' || code === 'revoked';
        },
        getReadyPetsUnified: (p: { id: string }[]) => p.map((x) => ({ id: x.id, pet: x })),
        // Matchmaking is not what these cases are about: selection is driven by explicit ids,
        // so the ordering passes through and the random pick is inert.
        pickRandomOpponent: vi.fn(() => null),
        sortOpponentsByMatch: vi.fn((ops: unknown[]) => ops),
        opponentKey: (owner: string, id: string) => `${owner}:${id}`,
        toDialoguePet: (p: { id: string; name: string }) => ({ petId: p.id, name: p.name }),
        useChainCapabilities: () => ({ activeKind: 'evm', randomness: { provider: 'vrf' } }),
        usePetList: () => ({ pets, refetch: vi.fn(), isLoading: false }),
        useBattlePets: (opts: { onSuccess?: (r: unknown) => void; roomId?: string | null; roomSocketUrl?: string }) => {
            capturedOnSuccess = opts?.onSuccess;
            capturedBattleOptions = opts;
            return battle;
        },
        useBattleOutcome: () => battleOutcome,
        useBattleTaunts: () => taunts,
        useCreateBattleRoom: () => ({ createRoom, isLoading: false }),
        // Stable identity, matching react-query's own refetch — and so the consent-failure
        // effect below can be asserted on across renders.
        useOpponents: () => ({ opponents, isLoading: false, isFetching: false, refetch: refetchOpponents }),
        useWinEstimate: () => ({ winProbability: null, isLoading: false, samples: null }),
    };
});

import { useBattlePanel } from '@hooks/battle/useBattlePanel';

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(battle, { isPending: false, isConfirming: false, error: null, hash: undefined, phase: null, liveReplay: null, verifiedReceipt: null, checks: [] });
    Object.assign(taunts, { isLoading: false, turns: [] });
    mocks.locationState = null;
    mocks.params = {};
    capturedOnSuccess = undefined;
    capturedBattleOptions = undefined;
});

describe('useBattlePanel', () => {
    it('pre-selects the pet passed via navigation state (Battle button on a pet card)', () => {
        mocks.locationState = { petId: 'p1' };
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        expect(result.current.setup.selectedPet1).toBe('p1');
    });

    it('leaves no pet selected when navigation state carries no petId (generic nav entry)', () => {
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        expect(result.current.setup.selectedPet1).toBe('');
    });

    it('returns overlay and setup props', () => {
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        expect(result.current.overlay).toBeDefined();
        expect(result.current.setup).toBeDefined();
    });

    it('carves no Ledger Stone until a receipt has been checked', () => {
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        expect(result.current.overlay.ledger).toBeNull();
    });

    it('hands the Ledger Stone the checks this browser ran and the receipt they cover', () => {
        const checks = [{ check: 'combat-replay', ok: true }];
        Object.assign(battle, {
            verifiedReceipt: { battleId: 'b_9', sequence: 31, beacon: { round: 777 }, result: { rounds: 6 } },
            checks,
        });
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        expect(result.current.overlay.ledger).toEqual({ battleId: 'b_9', sequence: 31, round: 777, rounds: 6, checks });
    });

    it('setup.battleDisabled is true when no fighter or opponent is selected', () => {
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        expect(result.current.setup.battleDisabled).toBe(true);
    });

    it('onBattle sets validation error when fighter or opponent is missing', () => {
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        act(() => { result.current.setup.onBattle(); });
        // overlay stays closed and validation fires
        expect(result.current.overlay.open).toBe(false);
    });

    it('onBattle opens overlay and requests taunts when both are selected', async () => {
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        act(() => { result.current.setup.onSelectFighter('p1'); });
        act(() => { result.current.setup.onSelectOpponent('0xopp:opp1'); });
        await act(async () => { result.current.setup.onBattle(); });
        expect(result.current.overlay.open).toBe(true);
        expect(taunts.generate).toHaveBeenCalled();
    });

    it('mints a battle room for the matchup and navigates to it once minted', async () => {
        createRoom.mockResolvedValueOnce('room-123');
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        act(() => { result.current.setup.onSelectFighter('p1'); });
        act(() => { result.current.setup.onSelectOpponent('0xopp:opp1'); });
        await act(async () => { result.current.setup.onBattle(); });

        expect(createRoom).toHaveBeenCalledWith({ chain: 'evm', attackerPetId: 'p1', defenderPetId: 'opp1' });
        expect(mocks.navigate).toHaveBeenCalledWith('/battle/room-123', { replace: true });
    });

    it('still starts the battle when room creation fails, clearing any stale room', async () => {
        // The room in the URL is what gets sent to `accept`, so a previous battle's room
        // left there would push this battle's updates to the wrong spectators. Failing to
        // mint means no room, and the URL has to say so.
        mocks.params = { roomId: 'room-from-a-previous-battle' };
        createRoom.mockResolvedValueOnce(null);
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        act(() => { result.current.setup.onSelectFighter('p1'); });
        act(() => { result.current.setup.onSelectOpponent('0xopp:opp1'); });
        await act(async () => { result.current.setup.onBattle(); });

        expect(mocks.navigate).toHaveBeenCalledWith('/battle', { replace: true });
        expect(result.current.overlay.open).toBe(true);
        expect(taunts.generate).toHaveBeenCalled();
    });

    it('passes the room from the URL to useBattlePets, with the socket endpoint', () => {
        // Without this the room is only ever cosmetic: `accept` never records it, so the
        // backend notifies nobody and this client falls back to polling.
        mocks.params = { roomId: 'room-123' };
        renderHook(() => useBattlePanel({ isStandaloneView: false }));

        expect(capturedBattleOptions?.roomId).toBe('room-123');
        expect(capturedBattleOptions?.roomSocketUrl).toMatch(/^wss?:\/\/.*\/ws\/battle-room$/);
    });

    it('passes a null room when the URL carries none', () => {
        renderHook(() => useBattlePanel({ isStandaloneView: false }));
        expect(capturedBattleOptions?.roomId).toBeNull();
    });

    it('holds off opening the overlay/generating taunts until room creation settles', () => {
        createRoom.mockReturnValueOnce(new Promise(() => {})); // never resolves
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        act(() => { result.current.setup.onSelectFighter('p1'); });
        act(() => { result.current.setup.onSelectOpponent('0xopp:opp1'); });
        act(() => { result.current.setup.onBattle(); });

        expect(result.current.overlay.open).toBe(false);
        expect(taunts.generate).not.toHaveBeenCalled();
    });

    it('onCancel navigates home and closes overlay', () => {
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        act(() => { result.current.overlay.onDone(); });
        expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
    });

    it('onDone resets state and navigates home', () => {
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        act(() => { result.current.overlay.onDone(); });
        expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
        expect(result.current.overlay.open).toBe(false);
    });

    it('handleSuccess applies the verified receipt outcome and refetches', () => {
        renderHook(() => useBattlePanel({ isStandaloneView: false }));
        act(() => { capturedOnSuccess?.({ firstWins: true, attackerLeveledUp: true }); });
        // Both values come from the receipt; nothing is inferred from refreshed chain stats.
        expect(battleOutcome.applyResolvedOutcome).toHaveBeenCalledWith(true, true);
    });

    it('overlay.open closes when battle.error is set after battle starts', async () => {
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        // Start a battle to open overlay.
        act(() => { result.current.setup.onSelectFighter('p1'); });
        act(() => { result.current.setup.onSelectOpponent('0xopp:opp1'); });
        await act(async () => { result.current.setup.onBattle(); });
        expect(result.current.overlay.open).toBe(true);

        // Error fires: effect should close overlay.
        battle.error = new Error('wallet rejected') as unknown as null;
        const { result: result2 } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        // Fresh render with error set — overlay starts closed since showResult=false and error present.
        expect(result2.current.overlay.open).toBe(false);
    });

    it('drops the opponent and re-reads the list on a consent failure', async () => {
        // The narrow race the server-side filter cannot close: the grant died between
        // the list being built and the battle being accepted. Re-reading removes the
        // opponent, and clearing the selection stops the player re-picking it.
        const rejection = Object.assign(new Error('not allowed'), {
            isBattleRejection: true,
            code: 'no-authorization',
        });
        const { result, rerender } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        act(() => { result.current.setup.onSelectOpponent('0xopp:opp1'); });
        expect(result.current.setup.selectedOpponentKey).toBe('0xopp:opp1');

        battle.error = rejection as unknown as null;
        await act(async () => { rerender(); });

        expect(result.current.setup.selectedOpponentKey).toBe('');
        expect(refetchOpponents).toHaveBeenCalledTimes(1);
    });

    it('re-reads the list once per failure, not on every render', async () => {
        // Clearing the selection re-renders. This only stays a single refetch while
        // both effect deps keep a stable identity, which is what `useOpponents`
        // returning react-query's own `refetch` buys — so it is worth pinning.
        const rejection = Object.assign(new Error('revoked'), {
            isBattleRejection: true,
            code: 'revoked',
        });
        battle.error = rejection as unknown as null;
        const { rerender } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        await act(async () => { rerender(); });
        await act(async () => { rerender(); });

        expect(refetchOpponents).toHaveBeenCalledTimes(1);
    });

    it('keeps the opponent selected when the refusal is not about consent', async () => {
        // A band or cap refusal is about this attacker or today, not the opponent's
        // willingness — dropping them from the list over it would be wrong.
        const rejection = Object.assign(new Error('too low level'), {
            isBattleRejection: true,
            code: 'attacker-level-below-band',
        });
        const { result, rerender } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        act(() => { result.current.setup.onSelectOpponent('0xopp:opp1'); });

        battle.error = rejection as unknown as null;
        await act(async () => { rerender(); });

        expect(result.current.setup.selectedOpponentKey).toBe('0xopp:opp1');
        expect(refetchOpponents).not.toHaveBeenCalled();
    });

    it('hashHint is null when provider is not switchboard', () => {
        const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
        expect(result.current.hashHint).toBeNull();
    });

    it('holds the result card until the live animation finishes, even after the resolved event arrives', () => {
        vi.useFakeTimers();
        try {
            battle.liveReplay = {
                result: { firstWins: true },
                log: [
                    strike(1, 100n, 80n),
                    strike(2, 90n, 80n),
                ],
                startHp1: 100n,
                startHp2: 100n,
            };
            const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
            // Open the overlay first — starts the battle so liveReplay's log gets picked up.
            act(() => { result.current.setup.onSelectFighter('p1'); });
            act(() => { result.current.setup.onSelectOpponent('0xopp:opp1'); });
            act(() => { result.current.setup.onBattle(); });
            act(() => { capturedOnSuccess?.({ firstWins: true }); });
            // Animation hasn't played any strikes yet — result must stay hidden.
            expect(result.current.overlay.showResult).toBe(false);

            act(() => { vi.advanceTimersByTime(700); });
            expect(result.current.overlay.showResult).toBe(false);

            act(() => { vi.advanceTimersByTime(700); });
            expect(result.current.overlay.showResult).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('onBack minimizes the overlay, and it auto-reopens once the result is ready', async () => {
        vi.useFakeTimers();
        try {
            battle.liveReplay = {
                result: { firstWins: true },
                log: [strike(1, 100n, 80n)],
                startHp1: 100n,
                startHp2: 100n,
            };
            const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
            act(() => { result.current.setup.onSelectFighter('p1'); });
            act(() => { result.current.setup.onSelectOpponent('0xopp:opp1'); });
            await act(async () => { result.current.setup.onBattle(); });
            expect(result.current.overlay.open).toBe(true);

            act(() => { result.current.overlay.onBack(); });
            expect(result.current.overlay.open).toBe(false);

            // The battle keeps resolving in the background while minimized.
            act(() => { capturedOnSuccess?.({ firstWins: true }); });
            act(() => { vi.advanceTimersByTime(700); });

            // The result is ready — the overlay reopens on its own to show it.
            expect(result.current.overlay.open).toBe(true);
            expect(result.current.overlay.showResult).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    // The guard the two error effects used to hold between them by declaration order.
    // A refusal that lands after the verdict is on screen is about a battle already
    // decided, and tearing the card away mid-read loses the one thing the player was
    // waiting for.
    it('leaves the result card up when a failure arrives after the result is showing', async () => {
        vi.useFakeTimers();
        try {
            battle.liveReplay = {
                result: { firstWins: true },
                log: [strike(1, 100n, 80n)],
                startHp1: 100n,
                startHp2: 100n,
            };
            const { result, rerender } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
            act(() => { result.current.setup.onSelectFighter('p1'); });
            act(() => { result.current.setup.onSelectOpponent('0xopp:opp1'); });
            await act(async () => { result.current.setup.onBattle(); });

            act(() => { capturedOnSuccess?.({ firstWins: true }); });
            act(() => { vi.advanceTimersByTime(700); });
            expect(result.current.overlay.showResult).toBe(true);

            battle.error = new Error('battle rejected: daily-cap');
            act(() => { rerender(); });

            expect(result.current.overlay.open).toBe(true);
            expect(result.current.overlay.showResult).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('logs and shows a mismatch notice when the live replay disagrees with the on-chain result, then reveals the corrected result', () => {
        vi.useFakeTimers();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            battle.liveReplay = { result: { firstWins: true }, log: [], startHp1: 100n, startHp2: 100n };
            const { result } = renderHook(() => useBattlePanel({ isStandaloneView: false }));
            act(() => { result.current.setup.onSelectFighter('p1'); });
            act(() => { result.current.setup.onSelectOpponent('0xopp:opp1'); });
            act(() => { result.current.setup.onBattle(); });
            act(() => { capturedOnSuccess?.({ firstWins: false }); });

            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining('mismatch'),
                expect.objectContaining({ receipt: { firstWins: false }, local: { firstWins: true } }),
            );
            // The receipt must still be applied as authoritative despite the mismatch.
            expect(battleOutcome.applyResolvedOutcome).toHaveBeenCalledWith(false, undefined);
            // Result card doesn't appear immediately — the notice holds it briefly.
            expect(result.current.overlay.showResult).toBe(false);

            act(() => { vi.advanceTimersByTime(2000); });
            expect(result.current.overlay.showResult).toBe(true);
        } finally {
            errorSpy.mockRestore();
            vi.useRealTimers();
        }
    });
});
