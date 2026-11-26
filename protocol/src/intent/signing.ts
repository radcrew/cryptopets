import { chainFamily, evmChainIdNumber } from '../domain/chainId';
import { DUEL_SCHEMA_VERSIONS } from '../domain/schemaVersions';
import { utf8ToBytes } from '../encoding/bytes';

import { assertBattleIntent, type BattleIntent } from './types';

/**
 * What the wallet actually signs.
 *
 * Deliberately not the canonical hash. A wallet prompt showing one opaque digest
 * is blind signing: the owner cannot tell a battle intent from anything else we
 * might ask them to stamp. Both payloads below name every field, so the prompt
 * shows which pet is fighting whom, under which ruleset, until when.
 *
 * EVM gets EIP-712 typed data; Solana gets a labelled text message, which is what
 * its wallets can display. Neither is verified here: verification needs
 * chain-specific cryptography and belongs in the backend, which uses viem for
 * secp256k1 and an ed25519 verifier for Solana.
 */

/** EIP-712 domain for battle intents. Not tied to a contract: no contract verifies these. */
export const EIP712_INTENT_DOMAIN_NAME = 'CryptoPets Battle';
export const EIP712_INTENT_DOMAIN_VERSION = '1';

/** EIP-712 type definition, in the shape viem and ethers both accept. */
export const EIP712_INTENT_TYPES = {
    BattleIntent: [
        { name: 'schemaVersion', type: 'uint16' },
        { name: 'chainId', type: 'string' },
        { name: 'deploymentId', type: 'string' },
        { name: 'attackerOwner', type: 'address' },
        { name: 'attackerPetId', type: 'uint256' },
        { name: 'defenderOwner', type: 'address' },
        { name: 'defenderPetId', type: 'uint256' },
        { name: 'challengeId', type: 'string' },
        { name: 'clientNonce', type: 'string' },
        { name: 'rulesetHash', type: 'bytes32' },
        { name: 'expiresAt', type: 'uint64' },
    ],
} as const;

/** Typed data ready to hand to `signTypedData`. */
export interface BattleIntentTypedData {
    domain: {
        name: string;
        version: string;
        chainId: number;
    };
    types: typeof EIP712_INTENT_TYPES;
    primaryType: 'BattleIntent';
    message: {
        schemaVersion: number;
        chainId: string;
        deploymentId: string;
        attackerOwner: string;
        attackerPetId: bigint;
        defenderOwner: string;
        defenderPetId: bigint;
        challengeId: string;
        clientNonce: string;
        rulesetHash: string;
        expiresAt: bigint;
    };
}

/**
 * EIP-712 typed data for an EVM intent.
 *
 * `chainId` and `deploymentId` appear twice on purpose: the EIP-712 domain carries
 * the numeric chain id (so a wallet can warn about a network mismatch), and the
 * message carries the protocol's own chain id plus deployment id (so the
 * signature cannot be replayed against a different deployment on the same chain,
 * which the EIP-712 domain alone would allow).
 *
 * `challengeId` becomes an empty string when absent, because EIP-712 has no
 * optional fields. `assertBattleIntent` rejects an empty-string `challengeId`, so
 * absent and present can never both encode to `""`.
 */
export function battleIntentTypedData(intent: BattleIntent): BattleIntentTypedData {
    const checked = assertBattleIntent(intent);
    if (chainFamily(checked.domain.chainId) !== 'evm') {
        throw new Error(`EIP-712 typed data is for EVM intents; got ${checked.domain.chainId}`);
    }
    return {
        domain: {
            name: EIP712_INTENT_DOMAIN_NAME,
            version: EIP712_INTENT_DOMAIN_VERSION,
            chainId: evmChainIdNumber(checked.domain.chainId),
        },
        types: EIP712_INTENT_TYPES,
        primaryType: 'BattleIntent',
        message: {
            schemaVersion: DUEL_SCHEMA_VERSIONS.intent,
            chainId: checked.domain.chainId,
            deploymentId: checked.domain.deploymentId,
            attackerOwner: checked.attackerOwner,
            attackerPetId: checked.attackerPetId,
            defenderOwner: checked.defenderOwner,
            defenderPetId: checked.defenderPetId,
            challengeId: checked.challengeId ?? '',
            clientNonce: checked.clientNonce,
            rulesetHash: checked.rulesetHash,
            expiresAt: BigInt(checked.expiresAt),
        },
    };
}

/** First line of the Solana message. Doubles as its domain separator. */
export const SOLANA_INTENT_MESSAGE_HEADER = 'CryptoPets Battle Intent v1';

/**
 * Labelled text message for a Solana intent.
 *
 * One field per line, every line labelled, header first. The header is the domain
 * separator: a signature over this text cannot be replayed as a signature over
 * some other CryptoPets message, because no other message starts with this line.
 *
 * Field values cannot contain newlines (`assertBattleIntent` enforces the
 * charset), so no value can forge an extra line and change what the owner
 * believes they approved.
 */
export function battleIntentSolanaMessage(intent: BattleIntent): string {
    const checked = assertBattleIntent(intent);
    if (chainFamily(checked.domain.chainId) !== 'solana') {
        throw new Error(`Solana sign-message is for Solana intents; got ${checked.domain.chainId}`);
    }
    return [
        SOLANA_INTENT_MESSAGE_HEADER,
        `schema: ${DUEL_SCHEMA_VERSIONS.intent}`,
        `chain: ${checked.domain.chainId}`,
        `deployment: ${checked.domain.deploymentId}`,
        `attacker: ${checked.attackerOwner}`,
        `attackerPet: ${checked.attackerPetId}`,
        `defender: ${checked.defenderOwner}`,
        `defenderPet: ${checked.defenderPetId}`,
        // `(none)` cannot collide with a real id: parentheses are outside the
        // allowed id charset, so absent and present stay distinguishable.
        `challenge: ${checked.challengeId ?? '(none)'}`,
        `nonce: ${checked.clientNonce}`,
        `ruleset: ${checked.rulesetHash}`,
        `expires: ${checked.expiresAt}`,
    ].join('\n');
}

/** The Solana message as the bytes a wallet signs. */
export function battleIntentSolanaMessageBytes(intent: BattleIntent): Uint8Array {
    return utf8ToBytes(battleIntentSolanaMessage(intent));
}
