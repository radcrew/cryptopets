import { useCallback, useMemo, useRef, useState } from 'react';

import type { BattleReceipt } from '@cryptopets/protocol';

import type { BattleResolvedResult } from '../../types/battle';

import { useBackendBattle } from './useBackendBattle';
import { useSubmitBattleIntent } from './useSubmitBattleIntent';
import { useVerifiedBattleReceipt } from './useVerifiedBattleReceipt';

/**
 * Starting a battle and following it to a verified result (§D, §E, §J).
 *
 * Battles are resolved by the backend, not on chain, so this no longer goes through the
 * chain adapter: there is nothing chain-specific left about running a fight. The wallet
 * still signs — the intent is what authorizes the battle (§D) — but no transaction is sent
 * and no gas is paid.
 *
 * What this returns is deliberately the same shape as the on-chain version, so the battle
 * UI keeps working: a `mutate`, a phase, a `liveReplay` to animate, and an `onSuccess`
 * carrying the resolved outcome.
 *
 * One thing genuinely changed, and it is the point of the design: `liveReplay` and the
 * authoritative result are now the *same computation*. The old flow animated a local
 * prediction and reconciled it against the chain afterwards; here the client verifies the
 * signed receipt and replays that, so what is animated is what the receipt commits to, or
 * nothing is animated at all.
 */

export interface BattlePetsArgs {
    /** Attacker — must be a pet the caller owns. */
    petId1: string;
    /** Defender — may belong to another player. */
    petId2: string;
    /** Owner of the defender pet. The intent binds both owners (§D). */
    defenderOwner?: string;
}

export type UseBattlePetsOptions = {
    /**
     * Fires once, when the receipt is signed and has verified locally.
     *
     * Never fires with a null result: an unverified receipt is simply not surfaced.
     */
    onSuccess?: (result: BattleResolvedResult) => void;
    /** Room to follow for push updates, and the socket to reach it on. */
    roomId?: string | null;
    roomSocketUrl?: string | undefined;
};

/** Where a battle is, in the vocabulary the existing UI already speaks. */
export type BackendBattlePhase =
    | 'idle'
    | 'requesting'
    | 'awaiting-vrf'
    | 'resolving'
    | 'resolved'
    | 'error';

const TERMINAL_FAILURES = new Set(['rejected', 'forfeited', 'verification_failed', 'signing_failed']);

export const useBattlePets = (options?: UseBattlePetsOptions) => {
    const { submit, isPending: isSubmitting, error: submitError } = useSubmitBattleIntent();
    const [battleId, setBattleId] = useState<string | null>(null);

    const onSuccessRef = useRef(options?.onSuccess);
    onSuccessRef.current = options?.onSuccess;

    const battle = useBackendBattle(battleId, {
        roomId: options?.roomId ?? null,
        roomSocketUrl: options?.roomSocketUrl,
    });

    // Only fetched once a receipt exists. Verification runs locally and gates the
    // animation: an unverified receipt yields no outcome, so nothing is shown.
    const hasReceipt = battle.data ? battle.isSettled && !TERMINAL_FAILURES.has(battle.data.state) : false;
    const verified = useVerifiedBattleReceipt(hasReceipt ? battleId : null);

    const result = useMemo(
        () => (verified.data?.verified ? toResolvedResult(verified.data.receipt) : null),
        [verified.data],
    );

    // Fired exactly once per battle, when the verified result first lands.
    const firedForRef = useRef<string | null>(null);
    if (result && battleId && firedForRef.current !== battleId) {
        firedForRef.current = battleId;
        onSuccessRef.current?.(result);
    }

    const mutate = useCallback(
        async (args: BattlePetsArgs) => {
            setBattleId(null);
            firedForRef.current = null;
            const accepted = await submit({
                attackerPetId: args.petId1,
                defenderPetId: args.petId2,
                defenderOwner: args.defenderOwner ?? '',
                ...(options?.roomId ? { roomId: options.roomId } : {}),
            });
            if (accepted) setBattleId(accepted.battleId);
        },
        [submit, options?.roomId],
    );

    const reset = useCallback(() => {
        setBattleId(null);
        firedForRef.current = null;
    }, []);

    // Every error, not just the submit one. Reading the battle's state or verifying its
    // receipt can both fail, and while those were excluded the UI had no way to notice:
    // `phase` stayed non-error, `isPending` stayed true, and the overlay spun on a
    // "confirming" toast forever with the actual failure sitting unread in `error`.
    const error = submitError ?? (battle.error as Error | null) ?? (verified.error as Error | null) ?? null;
    const phase = derivePhase(isSubmitting, battle.data?.state, Boolean(result), Boolean(error));

    return {
        mutate,
        isPending: isSubmitting || (battleId !== null && !result && phase !== 'error'),
        isConfirming: phase === 'resolving',
        /** Waiting on the committed drand round — the backend-mode analogue of VRF. */
        isAwaitingVrf: phase === 'awaiting-vrf',
        phase,
        result,
        /**
         * The client's own replay of the verified receipt. Present only once every check
         * passed, so the UI can never animate a fight the receipt does not commit to.
         */
        liveReplay: verified.data?.outcome ?? null,
        reset,
        clearErrors: reset,
        /** The battle id, which replaces the transaction hash as this battle's identifier. */
        hash: battleId ?? undefined,
        error,
        /** Kept for the shared, phase-driven <TransactionStatus/> contract. */
        lifecycle: {
            phase: phase === 'resolved' ? ('success' as const) : phase === 'error' ? ('error' as const) : ('confirming' as const),
            hash: battleId ?? undefined,
            error,
            reset,
        },
        /** Every local check and its verdict, so a UI can show *why* a result is trusted. */
        checks: verified.data?.checks ?? [],
        /** The receipt those checks ran on, once fetched, so a UI can say which battle they cover. */
        verifiedReceipt: verified.data?.receipt ?? null,
        /**
         * The battle's server-side state and, if it failed, why.
         *
         * Exposed because a backend battle passes through six states after the signature
         * and the UI rendered one word for all of them. A battle stalled at `computed`
         * (waiting on the independent Go verifier) looked exactly like one about to
         * finish, so "it is stuck" and "it is working" were the same screen.
         */
        state: battle.data?.state ?? null,
        failureReason: battle.data?.failureReason ?? null,
    };
};

/**
 * What a battle is actually waiting on, in words a player can act on.
 *
 * Deliberately names the dependency where there is one. A battle sitting in `computed` is
 * waiting for an independent recomputation by indexer-go before anything can be signed
 * (§F), and if that service is unreachable it waits forever — which is an operator problem
 * the player should not be left guessing about behind a spinner.
 */
export function describeBattleStage(state: string | null): string {
    switch (state) {
        case 'accepted':
        case 'committed':
            return 'Waiting for the committed randomness round…';
        case 'seeded':
            return 'Randomness verified. Running the fight…';
        case 'computed':
            return 'Fight computed. Waiting for the independent verifier to agree…';
        case 'verified':
            return 'Both engines agree. Signing the receipt…';
        case 'signed':
        case 'published':
        case 'batched':
            return 'Receipt signed. Checking it…';
        case 'verification_failed':
            return 'The two engines disagreed on this fight, so it was not signed.';
        case 'signing_failed':
            return 'The receipt could not be signed.';
        case 'rejected':
            return 'This battle was rejected.';
        case 'forfeited':
            return 'This battle was abandoned.';
        default:
            return 'Starting the battle…';
    }
}

function derivePhase(
    isSubmitting: boolean,
    state: string | undefined,
    hasResult: boolean,
    /** Any failure: submitting, reading the battle's state, or verifying its receipt. */
    hasError: boolean,
): BackendBattlePhase {
    if (hasError) return 'error';
    if (isSubmitting) return 'requesting';
    if (hasResult) return 'resolved';
    if (!state) return 'idle';
    if (TERMINAL_FAILURES.has(state)) return 'error';
    // `committed`/`seeded` is the wait for the drand round this battle was committed to,
    // which is the same shape of wait the old flow called `awaiting-vrf`.
    if (state === 'accepted' || state === 'committed' || state === 'seeded') return 'awaiting-vrf';
    return 'resolving';
}

/**
 * Maps a verified receipt onto the result shape the UI already renders.
 *
 * `requestId` is zero: there is no on-chain request behind a backend battle, and inventing
 * an identifier that looked like one would invite treating it as a chain reference.
 */
function toResolvedResult(receipt: BattleReceipt): BattleResolvedResult {
    const attackerWon = receipt.result.attackerWon;
    return {
        requestId: 0n,
        winnerId: attackerWon ? receipt.snapshot.attacker.petId : receipt.snapshot.defender.petId,
        loserId: attackerWon ? receipt.snapshot.defender.petId : receipt.snapshot.attacker.petId,
        vrfSeed: BigInt(receipt.seed),
        firstWins: attackerWon,
        rounds: receipt.result.rounds,
        winnerHpRemaining: receipt.result.winnerHpRemaining,
        xpWin: attackerWon ? receipt.progression.attacker.xpAwarded : receipt.progression.defender.xpAwarded,
        xpLoss: attackerWon ? receipt.progression.defender.xpAwarded : receipt.progression.attacker.xpAwarded,
        attackerLeveledUp: receipt.progression.attacker.leveledUp,
    };
}
