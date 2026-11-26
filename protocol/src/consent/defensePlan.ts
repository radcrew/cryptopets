import { chainFamily, evmChainIdNumber } from '../domain/chainId';
import { assertProtocolDomain, type ProtocolDomain, writeHeader } from '../domain/deployment';
import { assertPlacements, type Placement, writePlacement } from '../domain/placement';
import { TEAM_SCHEMA_VERSIONS } from '../domain/schemaVersions';
import { type Hex, hexToBytes, normalizeAccount } from '../encoding/bytes';
import { DOMAIN_TAGS } from '../encoding/domain';
import { keccak256Hex } from '../encoding/hash';
import { CanonicalWriter } from '../encoding/writer';
import { SQUAD_SIZE } from '../combat/team';

import type { CoverageResult } from './types';

/**
 * A defender's team-battle roster and their consent to be challenged with it.
 *
 * The team counterpart of `DefenseAuthorization` (§D), and signed the same way, once and in
 * advance, so a defender does not have to be online. It names the three pets that defend
 * rather than a scope, because each pet's home tile and tactic are part of what the defender
 * is agreeing to fight with. The roster order is the defenders' slot order, so it is part of
 * the plan rather than a presentation choice, and it is not sorted.
 *
 * Bound to `rulesetHash` like every consent: a rules change invalidates the plan rather
 * than reinterpreting it under new combat math.
 */
export interface DefensePlan {
    domain: ProtocolDomain;
    /** Wallet that owns all three pets and signs the plan. */
    defenderOwner: string;
    /** Exactly three pets, in slot order. */
    roster: RosterEntry[];
    rulesetHash: Hex;
    /** Inclusive band for the attacking squad's highest level, so a strong pet cannot hide
     *  behind weak ones. */
    minLevel: number;
    maxLevel: number;
    /** Team battles per day against this plan, enforced by the backend's counter. */
    maxBattlesPerDay: number;
    /** Unix seconds. Validity window. */
    notBefore: number;
    expiresAt: number;
    /** Bumped by the owner to invalidate every plan and authorization signed at a lower value. */
    revocationNonce: number;
}

/** One roster pet: its home tile and tactic. */
export interface RosterEntry extends Placement {
    petId: bigint;
}

const SAFE_ACCOUNT_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_U256 = 1n << 256n;

/** Validates an untrusted plan, returning a normalized copy. */
export function assertDefensePlan(plan: DefensePlan): DefensePlan {
    const domain = assertProtocolDomain(plan.domain);
    if (typeof plan.defenderOwner !== 'string' || !SAFE_ACCOUNT_PATTERN.test(plan.defenderOwner)) {
        throw new Error(`defenderOwner is not a valid account: ${JSON.stringify(plan.defenderOwner)}`);
    }

    if (!Array.isArray(plan.roster) || plan.roster.length !== SQUAD_SIZE) {
        throw new Error(`a defence plan lists exactly ${SQUAD_SIZE} pets`);
    }
    const petIds = new Set<bigint>();
    plan.roster.forEach((entry, i) => {
        if (typeof entry.petId !== 'bigint' || entry.petId <= 0n || entry.petId >= MAX_U256) {
            throw new Error(`roster[${i}].petId is not a valid pet id: ${entry.petId}`);
        }
        if (petIds.has(entry.petId)) throw new Error(`roster[${i}]: pet ${entry.petId} is listed twice`);
        petIds.add(entry.petId);
    });
    assertPlacements(plan.roster, 'roster');

    if (hexToBytes(plan.rulesetHash).length !== 32) {
        throw new Error('rulesetHash must be a 32-byte hash');
    }
    assertLevel(plan.minLevel, 'minLevel');
    assertLevel(plan.maxLevel, 'maxLevel');
    if (plan.minLevel > plan.maxLevel) {
        throw new Error(`minLevel ${plan.minLevel} exceeds maxLevel ${plan.maxLevel}`);
    }
    if (!Number.isSafeInteger(plan.maxBattlesPerDay) || plan.maxBattlesPerDay < 1 || plan.maxBattlesPerDay > 0xffffffff) {
        throw new Error(`maxBattlesPerDay must be between 1 and 2^32-1, got ${plan.maxBattlesPerDay}`);
    }
    assertUnixSeconds(plan.notBefore, 'notBefore');
    assertUnixSeconds(plan.expiresAt, 'expiresAt');
    if (plan.notBefore >= plan.expiresAt) {
        throw new Error(`notBefore ${plan.notBefore} must be before expiresAt ${plan.expiresAt}`);
    }
    if (!Number.isSafeInteger(plan.revocationNonce) || plan.revocationNonce < 0 || plan.revocationNonce > 0xffffffff) {
        throw new Error(`revocationNonce must be between 0 and 2^32-1, got ${plan.revocationNonce}`);
    }

    return {
        domain,
        defenderOwner: normalizeAccount(plan.defenderOwner),
        roster: plan.roster.map((e) => ({ petId: e.petId, col: e.col, row: e.row, tactic: e.tactic })),
        rulesetHash: plan.rulesetHash,
        minLevel: plan.minLevel,
        maxLevel: plan.maxLevel,
        maxBattlesPerDay: plan.maxBattlesPerDay,
        notBefore: plan.notBefore,
        expiresAt: plan.expiresAt,
        revocationNonce: plan.revocationNonce,
    };
}

/** What a specific team battle needs the plan to permit. */
export interface PlanCoverageQuery {
    /** The attacking squad's highest level. */
    attackerLevel: number;
    rulesetHash: Hex;
    /** Unix seconds. Always passed in: protocol code never reads the clock. */
    nowSeconds: number;
}

/**
 * Whether this plan permits one team battle. The same answers as `authorizationCovers`,
 * minus `pet-not-covered`: a plan covers exactly its own roster, so there is no pet to ask
 * about. `maxBattlesPerDay` needs a count and is the backend's to enforce.
 */
export function planCovers(plan: DefensePlan, query: PlanCoverageQuery): CoverageResult {
    if (query.nowSeconds < plan.notBefore) return { covered: false, reason: 'not-yet-valid' };
    if (query.nowSeconds >= plan.expiresAt) return { covered: false, reason: 'expired' };
    if (plan.rulesetHash.toLowerCase() !== query.rulesetHash.toLowerCase()) {
        return { covered: false, reason: 'ruleset-mismatch' };
    }
    if (query.attackerLevel < plan.minLevel) return { covered: false, reason: 'attacker-level-below-band' };
    if (query.attackerLevel > plan.maxLevel) return { covered: false, reason: 'attacker-level-above-band' };
    return { covered: true };
}

/**
 * Canonical encoding: header, then the owner, the roster in slot order (pet id, column, row,
 * tactic), and the consent fields in the same order as a defence authorization's.
 */
export function encodeDefensePlan(plan: DefensePlan): Uint8Array {
    const checked = assertDefensePlan(plan);
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.DEFENSE_PLAN);
    writeHeader(writer, 'defensePlan', checked.domain, TEAM_SCHEMA_VERSIONS.defensePlan)
        .account(checked.defenderOwner)
        .array(checked.roster, (w, e) => writePlacement(w.u256(e.petId), e));
    return writer
        .hash(checked.rulesetHash)
        .u16(checked.minLevel)
        .u16(checked.maxLevel)
        .u32(checked.maxBattlesPerDay)
        .u64(checked.notBefore)
        .u64(checked.expiresAt)
        .u32(checked.revocationNonce)
        .build();
}

/** `defensePlanHash`: named by a team intent, and carried by the commitment and receipt. */
export function hashDefensePlan(plan: DefensePlan): Hex {
    return keccak256Hex(encodeDefensePlan(plan));
}

/** EIP-712 domain for defence plans: the defence authorization's, with its own primary type. */
export const EIP712_DEFENSE_PLAN_TYPES = {
    DefensePlan: [
        { name: 'schemaVersion', type: 'uint16' },
        { name: 'chainId', type: 'string' },
        { name: 'deploymentId', type: 'string' },
        { name: 'defenderOwner', type: 'address' },
        { name: 'roster', type: 'RosterEntry[]' },
        { name: 'rulesetHash', type: 'bytes32' },
        { name: 'minLevel', type: 'uint16' },
        { name: 'maxLevel', type: 'uint16' },
        { name: 'maxBattlesPerDay', type: 'uint32' },
        { name: 'notBefore', type: 'uint64' },
        { name: 'expiresAt', type: 'uint64' },
        { name: 'revocationNonce', type: 'uint32' },
    ],
    // The tactic is shown by name: this is the prompt where the owner checks what each pet
    // will do, and a number would not tell them.
    RosterEntry: [
        { name: 'petId', type: 'uint256' },
        { name: 'col', type: 'uint8' },
        { name: 'row', type: 'uint8' },
        { name: 'tactic', type: 'string' },
    ],
} as const;

export interface DefensePlanTypedData {
    domain: { name: string; version: string; chainId: number };
    types: typeof EIP712_DEFENSE_PLAN_TYPES;
    primaryType: 'DefensePlan';
    message: {
        schemaVersion: number;
        chainId: string;
        deploymentId: string;
        defenderOwner: string;
        roster: { petId: bigint; col: number; row: number; tactic: string }[];
        rulesetHash: string;
        minLevel: number;
        maxLevel: number;
        maxBattlesPerDay: number;
        notBefore: bigint;
        expiresAt: bigint;
        revocationNonce: number;
    };
}

/**
 * EIP-712 typed data for an EVM plan. Base ships first (D6 in
 * docs/plan-team-battles-3v3.md), so there is no Solana message yet.
 */
export function defensePlanTypedData(plan: DefensePlan): DefensePlanTypedData {
    const checked = assertDefensePlan(plan);
    if (chainFamily(checked.domain.chainId) !== 'evm') {
        throw new Error(`EIP-712 typed data is for EVM plans; got ${checked.domain.chainId}`);
    }
    return {
        domain: { name: 'CryptoPets Defense', version: '1', chainId: evmChainIdNumber(checked.domain.chainId) },
        types: EIP712_DEFENSE_PLAN_TYPES,
        primaryType: 'DefensePlan',
        message: {
            schemaVersion: TEAM_SCHEMA_VERSIONS.defensePlan,
            chainId: checked.domain.chainId,
            deploymentId: checked.domain.deploymentId,
            defenderOwner: checked.defenderOwner,
            roster: checked.roster.map((e) => ({ petId: e.petId, col: e.col, row: e.row, tactic: e.tactic })),
            rulesetHash: checked.rulesetHash,
            minLevel: checked.minLevel,
            maxLevel: checked.maxLevel,
            maxBattlesPerDay: checked.maxBattlesPerDay,
            notBefore: BigInt(checked.notBefore),
            expiresAt: BigInt(checked.expiresAt),
            revocationNonce: checked.revocationNonce,
        },
    };
}

function assertLevel(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > 0xffff) {
        throw new Error(`${field} must be between 1 and 65535, got ${value}`);
    }
}

function assertUnixSeconds(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffffffffffff) {
        throw new Error(`${field} must be a positive unix-seconds integer, got ${value}`);
    }
}
