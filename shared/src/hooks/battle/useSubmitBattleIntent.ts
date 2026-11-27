import {
    battleIntentSolanaMessageBytes,
    battleIntentTypedData,
    type BattleIntent,
} from '@cryptopets/protocol';
import { useCallback, useState } from 'react';
import { useSignTypedData } from 'wagmi';

import { getSolanaAuthSigner } from '../../auth/solanaAuthStore';
import { useApiClient } from '../../contexts/ApiClientContext';
import { toBattleRejection } from '../../utils/battleFailureMessage';
import { saveBattleEvidence, type BattleEvidence } from '../../utils/battleEvidence';
import { normalizeSolanaSignatureToBase58 } from '../../utils/solana/signatureAuthCodec';

import { useActiveChain } from '../session/useActiveChain';
import { chainIdFor } from './chainIdFor';
import { type StoredSessionKey } from '../../auth/sessionKeyStore';
import { signIntentWithSession, useBattleSession } from './useBattleSession';
import { useBattleConfig } from './useBattleConfig';

/**
 * Submits a wallet-signed battle intent and captures the signed commitment that comes back
 * (§D, §E).
 *
 * Two round trips, in this order, because the protocol needs them separate:
 *
 * 1. `POST /api/battle/intents` — the wallet signature here is what *authorizes* the battle.
 *    The JWT only says who is calling; §D deliberately does not let a session token start a
 *    fight on a pet's behalf.
 * 2. `POST /api/battle/intents/:intentHash/accept` — freezes both pets, commits to a future
 *    drand round, and returns the signed commitment synchronously. This is the only time that
 *    commitment is handed over as part of a write, so it is persisted immediately.
 *
 * What is signed is never an opaque digest. EVM wallets get EIP-712 typed data and Solana
 * wallets get a labelled text message, both built by `@cryptopets/protocol`, so the prompt
 * names which pet is fighting whom, under which ruleset, until when.
 */

export interface SubmitBattleIntentVars {
    attackerPetId: string;
    defenderOwner: string;
    defenderPetId: string;
    /** Links the battle to a shareable room, so spectators get pushed state changes (§J). */
    roomId?: string;
    /** Optional challenge this intent answers. */
    challengeId?: string;
}

export interface AcceptedBattle {
    battleId: string;
    commitmentHash: string;
    signature: string;
    signingKeyId: string;
    commitment: unknown;
}

/** How long a signed intent stays submittable. Long enough to sign, short enough to bound replay. */
const INTENT_TTL_SECONDS = 300;

interface SubmitIntentResponse {
    intentHash: string;
}

export function useSubmitBattleIntent() {
    const apiClient = useApiClient();
    const activeChain = useActiveChain();
    const { data: config } = useBattleConfig();
    const { signTypedDataAsync } = useSignTypedData();
    // Null unless the wallet approved a session key; the submit path falls back to the
    // wallet prompt when it is, which is exactly the behaviour that existed before.
    const session = useBattleSession();

    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const submit = useCallback(
        async (vars: SubmitBattleIntentVars): Promise<AcceptedBattle | null> => {
            if (activeChain.kind === 'none') {
                setError(new Error('connect a wallet before starting a battle'));
                return null;
            }
            if (!config) {
                // Without the served deployment and ruleset an intent would be built against
                // guesses, and refused after the wallet prompt rather than before it.
                setError(new Error('battle configuration is not loaded yet'));
                return null;
            }

            setIsPending(true);
            setError(null);
            try {
                const chainId = chainIdFor(activeChain.kind, config.chainIds);
                const intent: BattleIntent = {
                    domain: { chainId, deploymentId: config.deploymentId },
                    attackerOwner: activeChain.address,
                    attackerPetId: BigInt(vars.attackerPetId),
                    defenderOwner: vars.defenderOwner,
                    defenderPetId: BigInt(vars.defenderPetId),
                    challengeId: vars.challengeId ?? null,
                    clientNonce: newClientNonce(),
                    rulesetHash: config.ruleset.hash as `0x${string}`,
                    expiresAt: Math.floor(Date.now() / 1000) + INTENT_TTL_SECONDS,
                };

                // The delegated key when the wallet approved one, the wallet otherwise
                // (§D). Same signature over the same intent either way — what differs is
                // only who holds the key, and therefore how often a human is asked.
                const signAndSubmit = async (withSession: StoredSessionKey | null) => {
                    const { signature, signatureFormat, sessionKey } = withSession
                        ? {
                              signature: await signIntentWithSession(withSession, battleIntentTypedData(intent)),
                              signatureFormat: 'eip712' as const,
                              sessionKey: withSession.address,
                          }
                        : activeChain.kind === 'evm'
                          ? {
                                signature: await signEvmIntent(intent, signTypedDataAsync),
                                signatureFormat: 'eip712' as const,
                                sessionKey: undefined,
                            }
                          : {
                                signature: await signSolanaIntent(intent),
                                signatureFormat: 'solana-message' as const,
                                sessionKey: undefined,
                            };

                    return apiClient.post<SubmitIntentResponse>('/api/battle/intents', {
                        intent: toWire(intent),
                        signature,
                        signatureFormat,
                        ...(sessionKey ? { sessionKey } : {}),
                    });
                };

                // A dead session key is the one refusal here the client can clear on its
                // own. The server has just said this key is not authorized — it lapsed, or
                // was revoked from another tab — so it will never work again, and leaving
                // it in storage fails every future battle the same way. Drop it and sign
                // this one with the wallet, which is the pre-session path and costs a
                // prompt rather than the battle.
                //
                // Retried once, never in a loop: if the wallet's own signature is refused
                // too, the problem is not the session key.
                let submitted;
                try {
                    ({ data: submitted } = await signAndSubmit(session.key));
                } catch (err) {
                    if (!session.key || toBattleRejection(err)?.code !== 'session-not-authorized') {
                        throw err;
                    }
                    session.discardLocalKey();
                    ({ data: submitted } = await signAndSubmit(null));
                }

                // The same intent, so a retry cannot burn a second `clientNonce` or move
                // `expiresAt`. The refused submit consumed nothing.

                const { data: accepted } = await apiClient.post<AcceptedBattle>(
                    `/api/battle/intents/${submitted.intentHash}/accept`,
                    vars.roomId ? { roomId: vars.roomId } : {},
                );

                // Written before this function returns, so a reload one second later still
                // finds the player's own proof of what they were promised.
                const evidence: BattleEvidence = { ...accepted, storedAt: Date.now() };
                saveBattleEvidence(evidence);

                return accepted;
            } catch (err) {
                // Both controllers answer with a precise reason. Surfacing it here rather
                // than letting the raw Axios error through is what lets the UI say which
                // of a dozen refusals happened — they are otherwise indistinguishable.
                const rejection = toBattleRejection(err);
                setError(rejection ?? (err instanceof Error ? err : new Error(String(err))));
                return null;
            } finally {
                setIsPending(false);
            }
        },
        [activeChain, apiClient, config, session, signTypedDataAsync],
    );

    return { submit, isPending, error };
}

async function signEvmIntent(
    intent: BattleIntent,
    signTypedDataAsync: ReturnType<typeof useSignTypedData>['signTypedDataAsync'],
): Promise<string> {
    const typed = battleIntentTypedData(intent);
    return signTypedDataAsync({
        domain: typed.domain,
        types: typed.types,
        primaryType: typed.primaryType,
        // The protocol types the account fields as plain `string`, because the same intent
        // shape carries base58 Solana addresses. wagmi wants the EIP-712 `address` fields as
        // `0x${string}`. Narrowing rather than widening the protocol type: this branch only
        // runs for EVM intents, and `battleIntentTypedData` itself throws for any other
        // chain family, so these really are 0x addresses by the time execution gets here.
        message: typed.message as typeof typed.message & {
            attackerOwner: `0x${string}`;
            defenderOwner: `0x${string}`;
            rulesetHash: `0x${string}`;
        },
    });
}

async function signSolanaIntent(intent: BattleIntent): Promise<string> {
    const signer = getSolanaAuthSigner();
    if (!signer) {
        throw new Error('no Solana signer is connected');
    }
    const signed = await signer.signMessage(battleIntentSolanaMessageBytes(intent));
    // Base58, matching what the auth flow already sends. The backend accepts hex and base64
    // too, but sending one form everywhere keeps the wire predictable.
    return normalizeSolanaSignatureToBase58(signed);
}

/** Serializes an intent for the wire: bigints become decimal strings, as JSON requires. */
function toWire(intent: BattleIntent) {
    return {
        chainId: intent.domain.chainId,
        deploymentId: intent.domain.deploymentId,
        attackerOwner: intent.attackerOwner,
        attackerPetId: intent.attackerPetId.toString(),
        defenderOwner: intent.defenderOwner,
        defenderPetId: intent.defenderPetId.toString(),
        challengeId: intent.challengeId,
        clientNonce: intent.clientNonce,
        rulesetHash: intent.rulesetHash,
        expiresAt: intent.expiresAt,
    };
}

/**
 * A per-submission nonce, which is what makes one signature un-replayable (threat T7).
 *
 * `crypto.randomUUID` where available; a random-plus-time fallback otherwise, since older
 * WebViews and some React Native runtimes lack it. Uniqueness is enforced server-side by a
 * unique constraint either way, so a collision is refused rather than accepted twice.
 */
export function newClientNonce(): string {
    const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (typeof cryptoApi?.randomUUID === 'function') {
        return cryptoApi.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
