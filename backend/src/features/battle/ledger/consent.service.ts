import {
    assertDefenseAuthorization,
    authorizationCovers,
    type CoverageFailure,
    type DefenseAuthorization,
    defenseAuthorizationSolanaMessage,
    defenseAuthorizationTypedData,
    chainFamily,
    type ChainId,
    hashDefenseAuthorization,
    normalizeAccount,
} from '@cryptopets/protocol';
import { ethers } from 'ethers';

import { prisma } from '@config/prisma';
import { verifySolanaSignature } from '@features/auth/solana';

import { CONSENT_REFUSALS } from './constants';
import { assertServedDomain, servedDeploymentId } from './domain';
import type { SignatureFormat } from './intent.service';

/**
 * Standing defender consent (§D).
 *
 * The problem: backend ranked mode must not apply cooldown and rating changes to an
 * unwilling defender, but demanding a live signature per battle would mean you can only
 * fight players who are online. That is a large product regression, so consent is signed
 * once, in advance, and bounded by a level band, a daily cap, a validity window, and a
 * ruleset version.
 *
 * The ruleset binding is the part with a running cost: a balance change invalidates every
 * outstanding authorization and prompts every player to re-consent. That is the intended
 * trade. It is what makes "I never agreed to these combat rules" a checkable claim instead
 * of an argument.
 */

/** Wire shape of an authorization, as a client sends it. */
export interface DefenseAuthorizationWire {
    chainId: string;
    deploymentId: string;
    defenderOwner: string;
    allPets: boolean;
    petIds: string[];
    rulesetHash: string;
    minLevel: number;
    maxLevel: number;
    maxBattlesPerDay: number;
    notBefore: number;
    expiresAt: number;
    revocationNonce: number;
}

export interface SubmitAuthorizationRequest {
    authorization: DefenseAuthorizationWire;
    signature: string;
    signatureFormat: SignatureFormat;
    /** Wallet from the verified JWT. Must be the defender. */
    authenticatedWallet: string;
    nowSeconds: number;
}

export type AuthorizationRejection =
    | 'malformed-authorization'
    | 'wrong-deployment'
    | 'wallet-mismatch'
    | 'wrong-signature-format'
    | 'bad-signature'
    | 'already-expired'
    | 'stale-revocation-nonce'
    | 'duplicate-authorization';

export type SubmitAuthorizationResult =
    | { ok: true; authorizationHash: string }
    | { ok: false; reason: AuthorizationRejection; detail: string };

/** Records a signed authorization. */
export async function submitDefenseAuthorization(
    request: SubmitAuthorizationRequest,
): Promise<SubmitAuthorizationResult> {
    let authorization: DefenseAuthorization;
    try {
        authorization = assertDefenseAuthorization(toProtocolAuthorization(request.authorization));
    } catch (error) {
        return reject('malformed-authorization', (error as Error).message);
    }

    try {
        assertServedDomain(authorization.domain);
    } catch (error) {
        return reject('wrong-deployment', (error as Error).message);
    }

    if (normalizeAccount(request.authenticatedWallet) !== authorization.defenderOwner) {
        return reject(
            'wallet-mismatch',
            `authenticated wallet ${request.authenticatedWallet} is not the defender ${authorization.defenderOwner}`,
        );
    }

    if (request.nowSeconds >= authorization.expiresAt) {
        // Storing a dead authorization would only produce confusing coverage failures later.
        return reject(
            'already-expired',
            `authorization expired at ${authorization.expiresAt}, now ${request.nowSeconds}`,
        );
    }

    const expectedFormat: SignatureFormat =
        chainFamily(authorization.domain.chainId) === 'evm' ? 'eip712' : 'solana-message';
    if (request.signatureFormat !== expectedFormat) {
        return reject(
            'wrong-signature-format',
            `${authorization.domain.chainId} authorizations are signed as ${expectedFormat}`,
        );
    }
    if (!verifyAuthorizationSignature(authorization, request.signature, expectedFormat)) {
        return reject('bad-signature', 'signature does not recover to the defender owner');
    }

    const highest = await highestRevocationNonce(authorization);
    if (highest !== null && authorization.revocationNonce < highest) {
        // Revocation works by bumping this nonce, so accepting a lower one would let a
        // previously revoked grant be reinstated by resubmitting it.
        return reject(
            'stale-revocation-nonce',
            `revocationNonce ${authorization.revocationNonce} is below this owner current ${highest}`,
        );
    }

    const authorizationHash = hashDefenseAuthorization(authorization);
    const petIds = authorization.scope.kind === 'pets' ? authorization.scope.petIds.map((id) => id.toString()) : [];

    try {
        await prisma.defenseAuthorization.create({
            data: {
                authorizationHash,
                chainId: authorization.domain.chainId,
                deploymentId: authorization.domain.deploymentId,
                defenderOwner: authorization.defenderOwner,
                allPets: authorization.scope.kind === 'allPets',
                petIds,
                rulesetHash: authorization.rulesetHash,
                minLevel: authorization.minLevel,
                maxLevel: authorization.maxLevel,
                maxBattlesPerDay: authorization.maxBattlesPerDay,
                notBefore: BigInt(authorization.notBefore),
                expiresAt: BigInt(authorization.expiresAt),
                revocationNonce: authorization.revocationNonce,
                signature: request.signature,
                signatureFormat: request.signatureFormat,
            },
        });
    } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
            return reject('duplicate-authorization', `authorization ${authorizationHash} already exists`);
        }
        throw error;
    }

    return { ok: true, authorizationHash };
}

/**
 * Revokes every live authorization for a wallet, immediately.
 *
 * Only the JWT is required, not a wallet signature, and that is deliberate: the failure mode
 * of an unauthorized revocation is fewer battles, never more. Requiring a signature would
 * mean a player who has lost access to their signing device cannot withdraw consent, which
 * is the wrong way round for a safety control.
 *
 * Rows are marked rather than deleted, because receipts reference the authorization hash and
 * a verifier must still be able to see what was consented to, and when it stopped.
 */
export async function revokeDefenseAuthorizations(
    chainId: string,
    defenderOwner: string,
    revokedAt: Date,
): Promise<{ revoked: number }> {
    const { count } = await prisma.defenseAuthorization.updateMany({
        where: {
            chainId,
            deploymentId: servedDeploymentId(),
            defenderOwner: normalizeAccount(defenderOwner),
            revokedAt: null,
        },
        data: { revokedAt },
    });
    return { revoked: count };
}

/** One of the caller's own authorizations, as the read surface presents it. */
export interface DefenseAuthorizationSummary {
    authorizationHash: string;
    allPets: boolean;
    petIds: string[];
    minLevel: number;
    maxLevel: number;
    maxBattlesPerDay: number;
    /** Unix seconds. */
    notBefore: number;
    expiresAt: number;
    rulesetHash: string;
    /**
     * Whether this authorization still covers battles under the rules now being served.
     *
     * Computed rather than stored, because it is a comparison against a value that moves:
     * a grant is signed over one `rulesetHash`, and a rules change makes it cover nothing
     * without touching the row.
     */
    isStale: boolean;
    createdAt: string;
}

/**
 * Every live authorization the caller has granted, and whether each still applies.
 *
 * The missing third of the consent API. Granting and revoking both existed; reading did
 * not, so a defender had no way to learn they had consented, let alone that their consent
 * had gone stale. That matters because a rules change invalidates every outstanding grant
 * by design, and being challenged is *passive*: the defender never finds out by trying
 * something and failing. Their pets simply stop being challengeable, silently, and the
 * only person who sees an error is the attacker, who cannot fix it.
 *
 * Revoked rows are excluded rather than returned with a flag. A revocation is the owner
 * deciding this grant no longer exists, and the row survives only so a verifier can still
 * read what a historical receipt was authorized under, which is not this caller's question.
 */
export async function listDefenseAuthorizations(
    chainId: string,
    defenderOwner: string,
    servedRulesetHash: string,
): Promise<DefenseAuthorizationSummary[]> {
    const rows = await prisma.defenseAuthorization.findMany({
        where: {
            chainId,
            deploymentId: servedDeploymentId(),
            defenderOwner: normalizeAccount(defenderOwner),
            revokedAt: null,
        },
        orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => ({
        authorizationHash: row.authorizationHash,
        allPets: row.allPets,
        petIds: Array.isArray(row.petIds) ? (row.petIds as string[]) : [],
        minLevel: row.minLevel,
        maxLevel: row.maxLevel,
        maxBattlesPerDay: row.maxBattlesPerDay,
        notBefore: Number(row.notBefore),
        expiresAt: Number(row.expiresAt),
        rulesetHash: row.rulesetHash,
        isStale: row.rulesetHash.toLowerCase() !== servedRulesetHash.toLowerCase(),
        createdAt: row.createdAt.toISOString(),
    }));
}

/** What a battle needs an authorization to permit. */
export interface CoverageRequest {
    chainId: string;
    defenderOwner: string;
    defenderPetId: string;
    attackerLevel: number;
    rulesetHash: string;
    nowSeconds: number;
}

export type ConsentFailure = CoverageFailure | (typeof CONSENT_REFUSALS)[keyof typeof CONSENT_REFUSALS];

export type ConsentResult =
    | { ok: true; authorizationHash: string; maxBattlesPerDay: number }
    | { ok: false; reason: ConsentFailure; detail: string };

/**
 * Finds a live authorization covering this battle.
 *
 * Coverage itself is decided by the protocol (`authorizationCovers`), not reimplemented
 * here: the same function a third party runs against a receipt is the one that gates the
 * battle, so an operator cannot be more permissive than the published rule.
 *
 * When several authorizations could cover a battle, the most recently signed one wins. Not
 * arbitrary: a player who tightens their terms expects the new terms to apply, and the
 * alternative (picking the most permissive) would make tightening them ineffective.
 */
export async function findCoveringAuthorization(request: CoverageRequest): Promise<ConsentResult> {
    const candidates = await prisma.defenseAuthorization.findMany({
        where: {
            chainId: request.chainId,
            deploymentId: servedDeploymentId(),
            defenderOwner: normalizeAccount(request.defenderOwner),
            revokedAt: null,
            rulesetHash: request.rulesetHash,
        },
        orderBy: { createdAt: 'desc' },
    });

    if (candidates.length === 0) {
        return { ok: false, reason: CONSENT_REFUSALS.NO_AUTHORIZATION, detail: 'this defender has no live authorization' };
    }

    let lastFailure: CoverageFailure = 'pet-not-covered';
    for (const candidate of candidates) {
        const coverage = authorizationCovers(fromRow(candidate), {
            defenderPetId: BigInt(request.defenderPetId),
            attackerLevel: request.attackerLevel,
            rulesetHash: candidate.rulesetHash as `0x${string}`,
            nowSeconds: request.nowSeconds,
        });
        if (!coverage.covered) {
            lastFailure = coverage.reason;
            continue;
        }
        return {
            ok: true,
            authorizationHash: candidate.authorizationHash,
            maxBattlesPerDay: candidate.maxBattlesPerDay,
        };
    }

    // The reason from the closest candidate, so a player is told "you are below their level
    // band" rather than a generic refusal.
    return { ok: false, reason: lastFailure, detail: `no live authorization covers this battle (${lastFailure})` };
}

/** UTC epoch day for a unix-seconds timestamp. */
export function epochDay(nowSeconds: number): number {
    return Math.floor(nowSeconds / 86400);
}

/**
 * Consumes one battle from an authorization's daily budget.
 *
 * The increment is the check: `count < max` lives in the WHERE clause, so two concurrent
 * battles cannot both read "one left" and both take it. A zero-row update means either the
 * cap is reached or today's row does not exist yet, and those are distinguished by trying the
 * insert and treating a duplicate-key failure as "another request created it first", after
 * which the guarded update is retried once.
 */
export async function consumeDailyBudget(
    authorizationHash: string,
    maxBattlesPerDay: number,
    nowSeconds: number,
): Promise<{ ok: true; used: number } | { ok: false; reason: typeof CONSENT_REFUSALS.DAILY_CAP_REACHED }> {
    const dayBucket = epochDay(nowSeconds);

    const bump = async () =>
        prisma.defenseUsage.updateMany({
            where: { authorizationHash, dayBucket, count: { lt: maxBattlesPerDay } },
            data: { count: { increment: 1 } },
        });

    let result = await bump();
    if (result.count === 0) {
        try {
            await prisma.defenseUsage.create({ data: { authorizationHash, dayBucket, count: 1 } });
            return { ok: true, used: 1 };
        } catch (error) {
            if ((error as { code?: string }).code !== 'P2002') {
                throw error;
            }
            // Someone else inserted today's row between our update and our insert.
            result = await bump();
        }
    }
    if (result.count === 0) {
        return { ok: false, reason: CONSENT_REFUSALS.DAILY_CAP_REACHED };
    }
    const row = await prisma.defenseUsage.findUnique({
        where: { authorizationHash_dayBucket: { authorizationHash, dayBucket } },
        select: { count: true },
    });
    return { ok: true, used: row?.count ?? 1 };
}

/** Verifies the defender's signature over the chain-specific payload. */
export function verifyAuthorizationSignature(
    authorization: DefenseAuthorization,
    signature: string,
    format: SignatureFormat,
): boolean {
    try {
        if (format === 'eip712') {
            const typed = defenseAuthorizationTypedData(authorization);
            const types = typed.types as unknown as Record<string, ethers.TypedDataField[]>;
            const recovered = ethers.verifyTypedData(typed.domain, types, typed.message, signature);
            return normalizeAccount(recovered) === authorization.defenderOwner;
        }
        return verifySolanaSignature(
            authorization.defenderOwner,
            signature,
            defenseAuthorizationSolanaMessage(authorization),
        );
    } catch {
        return false;
    }
}

/** Maps the wire shape onto the protocol type. */
export function toProtocolAuthorization(wire: DefenseAuthorizationWire): DefenseAuthorization {
    return {
        domain: { chainId: wire.chainId as ChainId, deploymentId: wire.deploymentId },
        defenderOwner: wire.defenderOwner,
        scope: wire.allPets ? { kind: 'allPets' } : { kind: 'pets', petIds: wire.petIds.map((id) => BigInt(id)) },
        rulesetHash: wire.rulesetHash as `0x${string}`,
        minLevel: wire.minLevel,
        maxLevel: wire.maxLevel,
        maxBattlesPerDay: wire.maxBattlesPerDay,
        notBefore: wire.notBefore,
        expiresAt: wire.expiresAt,
        revocationNonce: wire.revocationNonce,
    };
}

/** Rebuilds the protocol object from a stored row, so coverage runs on the published rule. */
function fromRow(row: {
    chainId: string;
    deploymentId: string;
    defenderOwner: string;
    allPets: boolean;
    petIds: unknown;
    rulesetHash: string;
    minLevel: number;
    maxLevel: number;
    maxBattlesPerDay: number;
    notBefore: bigint;
    expiresAt: bigint;
    revocationNonce: number;
}): DefenseAuthorization {
    const petIds = Array.isArray(row.petIds) ? (row.petIds as string[]) : [];
    return {
        domain: { chainId: row.chainId as ChainId, deploymentId: row.deploymentId },
        defenderOwner: row.defenderOwner,
        scope: row.allPets ? { kind: 'allPets' } : { kind: 'pets', petIds: petIds.map((id) => BigInt(id)) },
        rulesetHash: row.rulesetHash as `0x${string}`,
        minLevel: row.minLevel,
        maxLevel: row.maxLevel,
        maxBattlesPerDay: row.maxBattlesPerDay,
        notBefore: Number(row.notBefore),
        expiresAt: Number(row.expiresAt),
        revocationNonce: row.revocationNonce,
    };
}

async function highestRevocationNonce(authorization: DefenseAuthorization): Promise<number | null> {
    const row = await prisma.defenseAuthorization.findFirst({
        where: {
            chainId: authorization.domain.chainId,
            deploymentId: authorization.domain.deploymentId,
            defenderOwner: authorization.defenderOwner,
        },
        orderBy: { revocationNonce: 'desc' },
        select: { revocationNonce: true },
    });
    return row?.revocationNonce ?? null;
}

function reject(reason: AuthorizationRejection, detail: string): SubmitAuthorizationResult {
    return { ok: false, reason, detail };
}
