import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../contexts/ApiClientContext';

/**
 * The deployment, chains, and active ruleset a client needs before it can build a signable
 * intent (`GET /api/battle/config`).
 *
 * None of this is derivable client-side, and guessing it fails late: a wrong `deploymentId`
 * is refused as `wrong-deployment` and a wrong `rulesetHash` produces a defence
 * authorization nobody's battle matches — both *after* the wallet prompt, which is the worst
 * possible moment to discover a configuration mistake.
 *
 * Cached for the session. These values change only when the deployment is redeployed or the
 * ruleset is retuned, neither of which happens mid-battle, and refetching per battle would
 * put a network round trip in front of every wallet prompt for no benefit.
 */

export interface BattleConfig {
    /** False when this deployment is not accepting backend battles; offer the on-chain path. */
    enabled: boolean;
    deploymentId: string;
    chainIds: string[];
    ruleset: { hash: string; version: number };
    /**
     * Team battles: whether the deployment accepts them, and the ruleset a defence plan and a
     * team challenge must be signed against. Not the duel ruleset above, until the rollout
     * moves duels onto it. Absent from a backend that predates team battles.
     */
    team?: { enabled: boolean; ruleset: { hash: string; version: number } };
}

export const BATTLE_CONFIG_QUERY_KEY = ['battle', 'config'] as const;

export function useBattleConfig() {
    const apiClient = useApiClient();

    return useQuery({
        queryKey: BATTLE_CONFIG_QUERY_KEY,
        queryFn: async (): Promise<BattleConfig> => {
            const { data } = await apiClient.get<BattleConfig>('/api/battle/config');
            return data;
        },
        staleTime: Infinity,
    });
}
