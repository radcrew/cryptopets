import { SQUAD_SIZE } from '../combat/team';
import { chainFamily, evmChainIdNumber } from '../domain/chainId';
import { assertProtocolDomain, type ProtocolDomain, writeHeader } from '../domain/deployment';
import { assertPlacements, type Placement, writePlacement } from '../domain/placement';
import { TEAM_SCHEMA_VERSIONS } from '../domain/schemaVersions';
import { type Hex, hexToBytes } from '../encoding/bytes';
import { DOMAIN_TAGS } from '../encoding/domain';
import { keccak256Hex } from '../encoding/hash';
import { CanonicalWriter } from '../encoding/writer';

import { EIP712_INTENT_DOMAIN_NAME, EIP712_INTENT_DOMAIN_VERSION } from './signing';
import { assertAccount, assertId, assertPetId } from './types';

/**
 * A wallet-signed request for a team battle: intent schema version 2.
 *
 * The duel intent's job (§D), for three pets against a defence plan. The attacker signs
 * where each of their pets stands and what it does, so the backend cannot rearrange a squad
 * any more than it can pick a different pet in a duel. It names the defender's plan by
 * hash rather than by pet: the plan's three pets are the defenders, and naming the hash stops
 * the defender from swapping them after seeing the challenge.
 */
export interface TeamBattleIntent {
    domain: ProtocolDomain;
    attackerOwner: string;
    /** Exactly three pets, in slot order. */
    attackers: AttackerPlacement[];
    defenderOwner: string;
    /** The defence plan being challenged. */
    defensePlanHash: Hex;
    challengeId: string | null;
    clientNonce: string;
    rulesetHash: Hex;
    expiresAt: number;
}

export interface AttackerPlacement extends Placement {
    petId: bigint;
}

/** Validates an untrusted team intent, returning a normalized copy. */
export function assertTeamBattleIntent(intent: TeamBattleIntent): TeamBattleIntent {
    const domain = assertProtocolDomain(intent.domain);
    const attackerOwner = assertAccount(intent.attackerOwner, 'attackerOwner');
    const defenderOwner = assertAccount(intent.defenderOwner, 'defenderOwner');

    if (!Array.isArray(intent.attackers) || intent.attackers.length !== SQUAD_SIZE) {
        throw new Error(`a team intent names exactly ${SQUAD_SIZE} attacking pets`);
    }
    const seen = new Set<bigint>();
    const attackers = intent.attackers.map((a, i) => {
        const petId = assertPetId(a.petId, `attackers[${i}].petId`);
        if (seen.has(petId)) throw new Error(`attackers[${i}]: pet ${petId} is listed twice`);
        seen.add(petId);
        return { petId, col: a.col, row: a.row, tactic: a.tactic };
    });
    assertPlacements(attackers, 'attackers');

    if (hexToBytes(intent.defensePlanHash).length !== 32) throw new Error('defensePlanHash must be a 32-byte hash');
    if (intent.challengeId !== null) assertId(intent.challengeId, 'challengeId', 1, 64);
    assertId(intent.clientNonce, 'clientNonce', 8, 128);
    if (hexToBytes(intent.rulesetHash).length !== 32) throw new Error('rulesetHash must be a 32-byte hash');
    if (!Number.isSafeInteger(intent.expiresAt) || intent.expiresAt <= 0) {
        throw new Error(`expiresAt must be a positive unix-seconds integer, got ${intent.expiresAt}`);
    }

    return {
        domain,
        attackerOwner,
        attackers,
        defenderOwner,
        defensePlanHash: intent.defensePlanHash,
        challengeId: intent.challengeId,
        clientNonce: intent.clientNonce,
        rulesetHash: intent.rulesetHash,
        expiresAt: intent.expiresAt,
    };
}

/**
 * Canonical encoding: header at version 2, then the duel intent's fields with the single
 * attacking pet replaced by the three placements, and the defending pet by the plan hash.
 */
export function encodeTeamBattleIntent(intent: TeamBattleIntent): Uint8Array {
    const checked = assertTeamBattleIntent(intent);
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.INTENT);
    writeHeader(writer, 'intent', checked.domain, TEAM_SCHEMA_VERSIONS.intent)
        .account(checked.attackerOwner)
        .array(checked.attackers, (w, a) => writePlacement(w.u256(a.petId), a));
    return writer
        .account(checked.defenderOwner)
        .hash(checked.defensePlanHash)
        .optional(checked.challengeId, (w, v) => w.text(v))
        .text(checked.clientNonce)
        .hash(checked.rulesetHash)
        .u64(checked.expiresAt)
        .build();
}

/** The team intent's `intentHash`, stored by the ledger and named by the receipt. */
export function hashTeamBattleIntent(intent: TeamBattleIntent): Hex {
    return keccak256Hex(encodeTeamBattleIntent(intent));
}

/** EIP-712 types for a team intent. Same domain as the duel intent, its own primary type. */
export const EIP712_TEAM_INTENT_TYPES = {
    TeamBattleIntent: [
        { name: 'schemaVersion', type: 'uint16' },
        { name: 'chainId', type: 'string' },
        { name: 'deploymentId', type: 'string' },
        { name: 'attackerOwner', type: 'address' },
        { name: 'attackers', type: 'AttackerPlacement[]' },
        { name: 'defenderOwner', type: 'address' },
        { name: 'defensePlanHash', type: 'bytes32' },
        { name: 'challengeId', type: 'string' },
        { name: 'clientNonce', type: 'string' },
        { name: 'rulesetHash', type: 'bytes32' },
        { name: 'expiresAt', type: 'uint64' },
    ],
    AttackerPlacement: [
        { name: 'petId', type: 'uint256' },
        { name: 'col', type: 'uint8' },
        { name: 'row', type: 'uint8' },
        { name: 'tactic', type: 'string' },
    ],
} as const;

export interface TeamBattleIntentTypedData {
    domain: { name: string; version: string; chainId: number };
    types: typeof EIP712_TEAM_INTENT_TYPES;
    primaryType: 'TeamBattleIntent';
    message: {
        schemaVersion: number;
        chainId: string;
        deploymentId: string;
        attackerOwner: string;
        attackers: { petId: bigint; col: number; row: number; tactic: string }[];
        defenderOwner: string;
        defensePlanHash: string;
        challengeId: string;
        clientNonce: string;
        rulesetHash: string;
        expiresAt: bigint;
    };
}

/**
 * EIP-712 typed data for an EVM team intent. `challengeId` becomes `""` when absent, as in
 * the duel intent; the validator rejects an empty id, so the two cannot collide. Base ships
 * first (D6 in docs/plan-team-battles-3v3.md), so there is no Solana message yet.
 */
export function teamBattleIntentTypedData(intent: TeamBattleIntent): TeamBattleIntentTypedData {
    const checked = assertTeamBattleIntent(intent);
    if (chainFamily(checked.domain.chainId) !== 'evm') {
        throw new Error(`EIP-712 typed data is for EVM intents; got ${checked.domain.chainId}`);
    }
    return {
        domain: {
            name: EIP712_INTENT_DOMAIN_NAME,
            version: EIP712_INTENT_DOMAIN_VERSION,
            chainId: evmChainIdNumber(checked.domain.chainId),
        },
        types: EIP712_TEAM_INTENT_TYPES,
        primaryType: 'TeamBattleIntent',
        message: {
            schemaVersion: TEAM_SCHEMA_VERSIONS.intent,
            chainId: checked.domain.chainId,
            deploymentId: checked.domain.deploymentId,
            attackerOwner: checked.attackerOwner,
            attackers: checked.attackers.map((a) => ({ petId: a.petId, col: a.col, row: a.row, tactic: a.tactic })),
            defenderOwner: checked.defenderOwner,
            defensePlanHash: checked.defensePlanHash,
            challengeId: checked.challengeId ?? '',
            clientNonce: checked.clientNonce,
            rulesetHash: checked.rulesetHash,
            expiresAt: BigInt(checked.expiresAt),
        },
    };
}
