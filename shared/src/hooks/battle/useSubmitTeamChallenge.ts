import { type TeamBattleIntent, teamBattleIntentTypedData } from '@cryptopets/protocol';
import { useCallback, useState } from 'react';
import { useSignTypedData } from 'wagmi';

import { type StoredSessionKey } from '../../auth/sessionKeyStore';
import { useApiClient } from '../../contexts/ApiClientContext';
import { saveBattleEvidence } from '../../utils/battleEvidence';
import { toBattleRejection } from '../../utils/battleFailureMessage';
import { useActiveChain } from '../session/useActiveChain';
import { chainIdFor } from './chainIdFor';
import { useBattleConfig } from './useBattleConfig';
import { signIntentWithSession, useBattleSession } from './useBattleSession';
import { type AcceptedBattle, newClientNonce } from './useSubmitBattleIntent';
import type { PlanRosterEntry } from './useDefensePlan';

/**
 * Submits a team challenge and keeps the signed commitment that comes back: the duel's two round
 * trips (`useSubmitBattleIntent`) for three placed pets against a defence plan.
 *
 * 1. `POST /api/battle/team-intents`: the signature, by the wallet or by an approved battle
 *    session key, is what authorizes the battle.
 * 2. `POST /api/battle/intents/:intentHash/accept`: the same accept route a duel uses. It freezes
 *    all eight pets, commits to a future drand round, and returns the signed commitment, which
 *    is stored at once as the player's evidence.
 */
export interface SubmitTeamChallengeVars {
    /** Three of the player's pets, each placed on their own 3×3 zone with a tactic. */
    attackers: PlanRosterEntry[];
    defenderOwner: string;
    defensePlanHash: string;
    roomId?: string;
}

const INTENT_TTL_SECONDS = 300;

export function useSubmitTeamChallenge() {
    const apiClient = useApiClient();
    const activeChain = useActiveChain();
    const { data: config } = useBattleConfig();
    const { signTypedDataAsync } = useSignTypedData();
    const session = useBattleSession();
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const submit = useCallback(
        async (vars: SubmitTeamChallengeVars): Promise<AcceptedBattle | null> => {
            if (activeChain.kind !== 'evm') {
                setError(new Error('team battles are on Base only for now; connect an EVM wallet'));
                return null;
            }
            const team = config?.team;
            if (!config || !team) {
                setError(new Error('team battle configuration is not loaded yet'));
                return null;
            }
            setIsPending(true);
            setError(null);
            try {
                const intent: TeamBattleIntent = {
                    domain: { chainId: chainIdFor('evm', config.chainIds), deploymentId: config.deploymentId },
                    attackerOwner: activeChain.address,
                    attackers: vars.attackers.map((a) => ({ petId: BigInt(a.petId), col: a.col, row: a.row, tactic: a.tactic })),
                    defenderOwner: vars.defenderOwner,
                    defensePlanHash: vars.defensePlanHash as `0x${string}`,
                    challengeId: null,
                    clientNonce: newClientNonce(),
                    rulesetHash: team.ruleset.hash as `0x${string}`,
                    expiresAt: Math.floor(Date.now() / 1000) + INTENT_TTL_SECONDS,
                };
                const typed = teamBattleIntentTypedData(intent);
                const signAndSubmit = async (withSession: StoredSessionKey | null) => {
                    const signature = withSession
                        ? await signIntentWithSession(withSession, typed)
                        : await signTypedDataAsync({
                              domain: typed.domain,
                              types: typed.types,
                              primaryType: typed.primaryType,
                              message: typed.message as typeof typed.message & {
                                  attackerOwner: `0x${string}`;
                                  defenderOwner: `0x${string}`;
                                  defensePlanHash: `0x${string}`;
                                  rulesetHash: `0x${string}`;
                              },
                          });
                    return apiClient.post<{ intentHash: string }>('/api/battle/team-intents', {
                        intent: {
                            chainId: intent.domain.chainId,
                            deploymentId: intent.domain.deploymentId,
                            attackerOwner: intent.attackerOwner,
                            attackers: vars.attackers,
                            defenderOwner: intent.defenderOwner,
                            defensePlanHash: intent.defensePlanHash,
                            challengeId: null,
                            clientNonce: intent.clientNonce,
                            rulesetHash: intent.rulesetHash,
                            expiresAt: intent.expiresAt,
                        },
                        signature,
                        signatureFormat: 'eip712',
                        ...(withSession ? { sessionKey: withSession.address } : {}),
                    });
                };

                let submitted: { intentHash: string };
                try {
                    ({ data: submitted } = await signAndSubmit(session.key));
                } catch (err) {
                    // A lapsed session falls back to one wallet prompt, as a duel does.
                    if (!session.key || toBattleRejection(err)?.code !== 'session-not-authorized') throw err;
                    session.discardLocalKey();
                    ({ data: submitted } = await signAndSubmit(null));
                }
                const { data: accepted } = await apiClient.post<AcceptedBattle>(
                    `/api/battle/intents/${submitted.intentHash}/accept`,
                    vars.roomId ? { roomId: vars.roomId } : {},
                );
                saveBattleEvidence({ ...accepted, storedAt: Date.now() });
                return accepted;
            } catch (err) {
                setError(toBattleRejection(err) ?? (err instanceof Error ? err : new Error(String(err))));
                return null;
            } finally {
                setIsPending(false);
            }
        },
        [activeChain, apiClient, config, session, signTypedDataAsync],
    );

    return { submit, isPending, error };
}

