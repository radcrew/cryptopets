import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useApiClient } from '../../contexts/ApiClientContext';
import { readBattleEvidence, type BattleEvidence } from '../../utils/battleEvidence';

import { useBattleRoomSocket } from './useBattleRoomSocket';

/**
 * The authoritative view of one backend-resolved battle (§J).
 *
 * `GET /api/battle/:battleId` is the source of truth, and the room socket is only a hint
 * that it is worth asking again. That ordering is the whole design: a client that missed
 * every notification, or was never connected, converges on exactly the same state by
 * polling this endpoint. The socket makes that faster, never more authoritative — so a
 * dropped connection degrades to slower updates, not to wrong ones.
 *
 * The refetch on reconnect matters as much as the one on notification. A socket that was
 * down for ten seconds missed whatever happened in those ten seconds, and reconnecting
 * without re-reading would leave the client confidently stale.
 */

export interface BattleStateSummary {
    battleId: string;
    chainId: string;
    deploymentId: string;
    state: string;
    failureReason: string | null;
    /** 'duel' | 'team'. Absent from a backend that predates team battles, which means a duel. */
    kind?: string;
    /** Null on a team battle, whose pets are in its snapshot. */
    attackerPetId: string | null;
    attackerOwner: string;
    /** Null on a team battle, whose pets are in its snapshot. */
    defenderPetId: string | null;
    defenderOwner: string;
    rulesetHash: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * States the pipeline never leaves, so there is nothing further to wait for.
 *
 * All three receipt-bearing states belong here, not just the first and last.
 * `published` sits between `signed` and `batched`, and omitting it stranded every
 * battle on a deployment that never runs the Merkle batcher: `isSettled` gates
 * `hasReceipt` in useBattlePets, so verification never started, no result was ever
 * produced, and the poll below never stopped either. A battle that had settled
 * correctly showed "Receipt signed. Checking it…" indefinitely.
 */
const TERMINAL_STATES = new Set([
    'signed',
    'published',
    'batched',
    'rejected',
    'forfeited',
    'verification_failed',
    'signing_failed',
]);

export function battleStateQueryKey(battleId: string | null | undefined) {
    return ['battle', 'state', battleId] as const;
}

export interface UseBackendBattleOptions {
    /** Room to subscribe to for change notifications. Without one, polling is the only signal. */
    roomId?: string | null;
    /** Base URL of the battle-room socket, e.g. `wss://api.example.com/ws/battle-room`. */
    roomSocketUrl?: string | undefined;
    /**
     * Fallback poll interval while the battle is still in flight, in milliseconds.
     *
     * Deliberately not disabled when a socket is connected. The socket is a notification
     * channel with no delivery guarantee, and a battle that silently stopped updating
     * because one message was lost is a worse failure than a request every few seconds.
     */
    pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;

export function useBackendBattle(battleId: string | null | undefined, options: UseBackendBattleOptions = {}) {
    const apiClient = useApiClient();
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    const query = useQuery({
        queryKey: battleStateQueryKey(battleId),
        enabled: Boolean(battleId),
        queryFn: async (): Promise<BattleStateSummary> => {
            const { data } = await apiClient.get<BattleStateSummary>(`/api/battle/${battleId}`);
            return data;
        },
        // Stops once the battle reaches a state it will never leave, rather than polling a
        // finished battle forever.
        refetchInterval: (q) => (isSettled(q.state.data) ? false : pollIntervalMs),
    });

    const { refetch } = query;
    const { connected } = useBattleRoomSocket({
        url: options.roomSocketUrl,
        roomId: options.roomId ?? null,
        // A notification and a reconnect mean the same thing here: go ask the authoritative
        // endpoint. Neither carries battle content to trust.
        //
        // Guarded on `battleId`, because `refetch` ignores `enabled` — a spectator sitting
        // in a room before any battle exists would otherwise fetch `/api/battle/null` on
        // every notification and every reconnect, and get a 404 each time.
        onNotification: () => {
            if (battleId) void refetch();
        },
        onReconnect: () => {
            if (battleId) void refetch();
        },
    });

    return {
        ...query,
        /** Whether the notification channel is currently live. Presentation only. */
        socketConnected: connected,
        isSettled: isSettled(query.data),
    };
}

function isSettled(summary: BattleStateSummary | undefined): boolean {
    return summary ? TERMINAL_STATES.has(summary.state) : false;
}

/**
 * The player's own stored commitment for this battle, if this client is the one that
 * accepted it.
 *
 * Read from local storage rather than refetched, because the point of holding it is that it
 * does not depend on us continuing to serve it. Returns null on any other client, which is
 * correct: a spectator was never promised anything.
 */
export function useStoredBattleEvidence(battleId: string | null | undefined): BattleEvidence | null {
    const [evidence, setEvidence] = useState<BattleEvidence | null>(null);

    useEffect(() => {
        setEvidence(battleId ? readBattleEvidence(battleId) : null);
    }, [battleId]);

    return evidence;
}
