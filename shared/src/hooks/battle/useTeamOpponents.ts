import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../contexts/ApiClientContext';
import { useAuth } from '../../contexts/AuthContext';
import { useActiveChain } from '../session/useActiveChain';
import { chainIdFor } from './chainIdFor';
import { useBattleConfig } from './useBattleConfig';

/**
 * A defence plan as the opponent list offers it: who defends and which squads may challenge, but
 * not the defending pets. Their identities, tiles and tactics are what an attacker would
 * counter-build from, so the backend does not serve them and the battle reveals them.
 */
export interface TeamOpponent {
    planHash: string;
    defenderOwner: string;
    minLevel: number;
    maxLevel: number;
    expiresAt: number;
    /** All three pets are off cooldown, which a challenge needs. */
    ready: boolean;
}

/**
 * Defence plans the player can challenge right now: live, under the served team rules, not
 * their own, with every pet still the defender's (`GET /api/battle/team-opponents`).
 *
 * Asked only once the player is signed in: the endpoint needs the session, and without it the
 * empty answer would read as "no teams are open" rather than "sign in first".
 */
export function useTeamOpponents(limit = 20) {
    const apiClient = useApiClient();
    const { isAuthenticated } = useAuth();
    const activeChain = useActiveChain();
    const { data: config } = useBattleConfig();
    const chainId = activeChain.kind === 'evm' && config ? chainIdFor('evm', config.chainIds) : null;
    return useQuery({
        queryKey: ['battle', 'team-opponents', chainId, limit] as const,
        enabled: Boolean(chainId && config?.team?.enabled && isAuthenticated),
        queryFn: async (): Promise<TeamOpponent[]> => {
            const { data } = await apiClient.get<{ opponents: TeamOpponent[] }>(
                `/api/battle/team-opponents?chainId=${encodeURIComponent(chainId ?? '')}&limit=${limit}`,
            );
            return data.opponents;
        },
    });
}
