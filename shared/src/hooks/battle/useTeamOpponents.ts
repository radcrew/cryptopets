import type { Tactic } from '@cryptopets/protocol';
import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../contexts/ApiClientContext';
import { useActiveChain } from '../session/useActiveChain';
import { chainIdFor } from './chainIdFor';
import { useBattleConfig } from './useBattleConfig';

/** One defending pet of a defence plan, as the opponent list serves it. */
export interface TeamOpponentPet {
    petId: string;
    col: number;
    row: number;
    tactic: Tactic;
    name: string;
    level: number;
    rarity: number;
    dna: string;
    speciesId: number;
    readyAt: number;
}

export interface TeamOpponent {
    planHash: string;
    defenderOwner: string;
    minLevel: number;
    maxLevel: number;
    expiresAt: number;
    roster: TeamOpponentPet[];
    /** All three pets are off cooldown, which a challenge needs. */
    ready: boolean;
}

/**
 * Defence plans the player can challenge right now: live, under the served team rules, not
 * their own, with every pet still the defender's (`GET /api/battle/team-opponents`).
 */
export function useTeamOpponents(limit = 20) {
    const apiClient = useApiClient();
    const activeChain = useActiveChain();
    const { data: config } = useBattleConfig();
    const chainId = activeChain.kind === 'evm' && config ? chainIdFor('evm', config.chainIds) : null;
    return useQuery({
        queryKey: ['battle', 'team-opponents', chainId, limit] as const,
        enabled: Boolean(chainId && config?.team?.enabled),
        queryFn: async (): Promise<TeamOpponent[]> => {
            const { data } = await apiClient.get<{ opponents: TeamOpponent[] }>(
                `/api/battle/team-opponents?chainId=${encodeURIComponent(chainId ?? '')}&limit=${limit}`,
            );
            return data.opponents;
        },
    });
}
