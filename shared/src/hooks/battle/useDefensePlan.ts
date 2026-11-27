import { type DefensePlan, defensePlanTypedData, type Tactic, TEAM_SCHEMA_VERSIONS } from '@cryptopets/protocol';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useSignTypedData } from 'wagmi';

import { useApiClient } from '../../contexts/ApiClientContext';
import { useAuth } from '../../contexts/AuthContext';
import { toBattleRejection } from '../../utils/battleFailureMessage';
import { useActiveChain } from '../session/useActiveChain';
import { chainIdFor } from './chainIdFor';
import { useBattleConfig } from './useBattleConfig';

/**
 * A defender's team-battle roster: read, save and withdraw (docs/plan-team-battles-3v3.md).
 *
 * The team counterpart of `useDefenseAuthorization` and signed the same way, once and in
 * advance, so opponents can challenge while the defender is away. It names the three pets
 * that defend, with the home tile and tactic each fights with. Saving a plan replaces the
 * previous one.
 *
 * Bound to the *team* ruleset in the battle config, not the duel one, and EVM only for now:
 * team battles ship on Base first.
 */
export interface PlanRosterEntry {
    petId: string;
    /** Own-zone column (0 back, 1 mid, 2 front) and row. */
    col: number;
    row: number;
    tactic: Tactic;
}

export interface SaveDefensePlanVars {
    roster: PlanRosterEntry[];
    /** Inclusive band for the attacking squad's highest level. Defaults to the full range. */
    minLevel?: number;
    maxLevel?: number;
    maxBattlesPerDay?: number;
    days?: number;
}

export interface LiveDefensePlan {
    planHash: string;
    roster: PlanRosterEntry[];
    minLevel: number;
    maxLevel: number;
    maxBattlesPerDay: number;
    notBefore: number;
    expiresAt: number;
    rulesetHash: string;
    /** Signed for rules no longer served, so it covers no battle until saved again. */
    isStale: boolean;
    createdAt: string;
}

const DEFAULTS = { minLevel: 1, maxLevel: 100, maxBattlesPerDay: 20, days: 30 } as const;

export function defensePlanQueryKey(chainId: string | null, owner: string | null) {
    return ['battle', 'defense-plan', chainId, owner] as const;
}

export function useDefensePlan() {
    const apiClient = useApiClient();
    const { isAuthenticated } = useAuth();
    const activeChain = useActiveChain();
    const { data: config } = useBattleConfig();
    const { signTypedDataAsync } = useSignTypedData();
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const chainId = activeChain.kind === 'evm' && config ? chainIdFor('evm', config.chainIds) : null;
    const owner = activeChain.kind === 'none' ? null : activeChain.address;
    const query = useQuery({
        queryKey: defensePlanQueryKey(chainId, owner),
        // The plan read needs the session; without it there is no plan to show, not "none saved".
        enabled: Boolean(chainId && owner && isAuthenticated),
        queryFn: async () => {
            const { data } = await apiClient.get<{ rulesetHash: string; plan: LiveDefensePlan | null }>(
                `/api/battle/defense-plans?chainId=${encodeURIComponent(chainId ?? '')}`,
            );
            return data;
        },
    });

    const save = useCallback(
        async (vars: SaveDefensePlanVars): Promise<string | null> => {
            if (activeChain.kind !== 'evm') {
                setError(new Error('team battles are on Base only for now; connect an EVM wallet'));
                return null;
            }
            const team = config?.team;
            if (!config || !team) {
                // Signing against a guessed ruleset would produce a plan that covers nothing.
                setError(new Error('team battle configuration is not loaded yet'));
                return null;
            }
            setIsPending(true);
            setError(null);
            try {
                const now = Math.floor(Date.now() / 1000);
                const plan: DefensePlan = {
                    domain: { chainId: chainIdFor('evm', config.chainIds), deploymentId: config.deploymentId },
                    defenderOwner: activeChain.address,
                    roster: vars.roster.map((e) => ({ petId: BigInt(e.petId), col: e.col, row: e.row, tactic: e.tactic })),
                    rulesetHash: team.ruleset.hash as `0x${string}`,
                    minLevel: vars.minLevel ?? DEFAULTS.minLevel,
                    maxLevel: vars.maxLevel ?? DEFAULTS.maxLevel,
                    maxBattlesPerDay: vars.maxBattlesPerDay ?? DEFAULTS.maxBattlesPerDay,
                    notBefore: now,
                    expiresAt: now + (vars.days ?? DEFAULTS.days) * 86400,
                    revocationNonce: 0,
                    schemaVersion: TEAM_SCHEMA_VERSIONS.defensePlan,
                    salt: newPlanSalt(),
                };
                const typed = defensePlanTypedData(plan);
                const signature = await signTypedDataAsync({
                    domain: typed.domain,
                    types: typed.types,
                    primaryType: typed.primaryType,
                    // EVM only by now, so the protocol's plain-string accounts are 0x addresses.
                    message: typed.message as typeof typed.message & {
                        defenderOwner: `0x${string}`;
                        rulesetHash: `0x${string}`;
                        salt: `0x${string}`;
                    },
                });
                const { data } = await apiClient.post<{ planHash: string }>('/api/battle/defense-plans', {
                    plan: {
                        chainId: plan.domain.chainId,
                        deploymentId: plan.domain.deploymentId,
                        defenderOwner: plan.defenderOwner,
                        roster: vars.roster,
                        rulesetHash: plan.rulesetHash,
                        minLevel: plan.minLevel,
                        maxLevel: plan.maxLevel,
                        maxBattlesPerDay: plan.maxBattlesPerDay,
                        notBefore: plan.notBefore,
                        expiresAt: plan.expiresAt,
                        revocationNonce: plan.revocationNonce,
                        schemaVersion: plan.schemaVersion,
                        salt: plan.salt,
                    },
                    signature,
                    signatureFormat: 'eip712',
                });
                void query.refetch();
                return data.planHash;
            } catch (err) {
                setError(toBattleRejection(err) ?? (err instanceof Error ? err : new Error(String(err))));
                return null;
            } finally {
                setIsPending(false);
            }
        },
        [activeChain, apiClient, config, query, signTypedDataAsync],
    );

    /** Withdraws the plan. Unsigned, like consent: withdrawing can only mean fewer battles. */
    const revoke = useCallback(async (): Promise<boolean> => {
        if (!chainId) {
            setError(new Error('connect an EVM wallet first'));
            return false;
        }
        setIsPending(true);
        setError(null);
        try {
            await apiClient.delete(`/api/battle/defense-plans?chainId=${encodeURIComponent(chainId)}`);
            void query.refetch();
            return true;
        } catch (err) {
            setError(err instanceof Error ? err : new Error(String(err)));
            return false;
        } finally {
            setIsPending(false);
        }
    }, [apiClient, chainId, query]);

    return {
        plan: query.data?.plan ?? null,
        isLoading: query.isLoading,
        save,
        revoke,
        isPending,
        error,
    };
}

/**
 * 32 random bytes for a new plan's salt (defence plan version 2). Cryptographic randomness only:
 * the salt exists so nobody can guess it, and a guessable one would hand the hidden roster to
 * anyone hashing candidate rosters against the plan, so there is deliberately no fallback.
 */
export function newPlanSalt(): `0x${string}` {
    const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (bytes: Uint8Array) => Uint8Array } }).crypto;
    if (typeof cryptoApi?.getRandomValues !== 'function') {
        throw new Error('this device has no secure random source, so a defence plan cannot be salted');
    }
    const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
    return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
