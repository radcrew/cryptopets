import {
    assertDefensePlan,
    chainFamily,
    type ChainId,
    type DefensePlan,
    defensePlanTypedData,
    hashDefensePlan,
    normalizeAccount,
    type Tactic,
} from '@cryptopets/protocol';
import { ethers } from 'ethers';

import { prisma } from '@config/prisma';
import { getPetById } from '@repositories/roster.repository';

import { CONSENT_REFUSALS } from './constants';
import { epochDay } from './consent.service';
import { assertServedDomain, servedDeploymentId } from './domain';
import type { SignatureFormat } from './intent.service';

/**
 * Team-battle defence plans (docs/battle-protocol.md §F; docs/plan-team-battles-3v3.md, D2).
 *
 * The team counterpart of standing defence consent (`consent.service.ts`), and it follows the
 * same rules for the same reasons: signed once and in advance so a defender need not be online,
 * bounded by a level band, a daily cap and a validity window, and bound to a ruleset hash so a
 * rules change invalidates it rather than reinterpreting it.
 *
 * Two differences. A plan names exactly the three pets that defend, with the home tile and
 * tactic each fights with, so it is checked against the roster when saved rather than first when someone
 * challenges it. And a defender has one live plan: saving a new one revokes the earlier ones in
 * the same transaction, because an attacker challenges "this defender", and two live plans would
 * leave which roster they meet up to whichever row a query happened to return first.
 */

/** Wire shape of a plan, as a client sends it. */
export interface DefensePlanWire {
    chainId: string;
    deploymentId: string;
    defenderOwner: string;
    roster: { petId: string; col: number; row: number; tactic: Tactic }[];
    rulesetHash: string;
    minLevel: number;
    maxLevel: number;
    maxBattlesPerDay: number;
    notBefore: number;
    expiresAt: number;
    revocationNonce: number;
}

export interface SubmitPlanRequest {
    plan: DefensePlanWire;
    signature: string;
    signatureFormat: SignatureFormat;
    /** Wallet from the verified JWT. Must be the defender. */
    authenticatedWallet: string;
    /** The ruleset team battles are being accepted under. A plan signed for any other is dead. */
    servedRulesetHash: string;
    nowSeconds: number;
}

export type PlanRejection =
    | 'malformed-plan'
    | 'wrong-deployment'
    | 'wallet-mismatch'
    | 'wrong-signature-format'
    | 'bad-signature'
    | 'already-expired'
    /**
     * Its own code, not the acceptance path's `ruleset-mismatch`: a client turns a code into
     * text without knowing which endpoint answered, and the two mean different things.
     */
    | 'plan-ruleset-mismatch'
    | 'unknown-pet'
    | 'not-pet-owner'
    | 'stale-revocation-nonce'
    | 'duplicate-plan';

export type SubmitPlanResult = { ok: true; planHash: string; replaced: number } | { ok: false; reason: PlanRejection; detail: string };

/** Records a signed plan, replacing the owner's earlier ones. */
export async function submitDefensePlan(request: SubmitPlanRequest): Promise<SubmitPlanResult> {
    let plan: DefensePlan;
    try {
        plan = assertDefensePlan(toProtocolPlan(request.plan));
    } catch (error) {
        return reject('malformed-plan', (error as Error).message);
    }

    try {
        assertServedDomain(plan.domain);
    } catch (error) {
        return reject('wrong-deployment', (error as Error).message);
    }

    if (normalizeAccount(request.authenticatedWallet) !== plan.defenderOwner) {
        return reject('wallet-mismatch', `authenticated wallet ${request.authenticatedWallet} is not the defender ${plan.defenderOwner}`);
    }
    if (request.nowSeconds >= plan.expiresAt) {
        return reject('already-expired', `plan expired at ${plan.expiresAt}, now ${request.nowSeconds}`);
    }
    if (plan.rulesetHash.toLowerCase() !== request.servedRulesetHash.toLowerCase()) {
        // Refused rather than stored stale: saving revokes the defender's current plan, so a
        // plan for other rules would replace a working plan with one that covers nothing.
        return reject('plan-ruleset-mismatch', `plan is for ruleset ${plan.rulesetHash}; team battles are served under ${request.servedRulesetHash}`);
    }

    // EIP-712 only: Base ships first (D6), and the protocol has no Solana plan message yet.
    if (chainFamily(plan.domain.chainId) !== 'evm' || request.signatureFormat !== 'eip712') {
        return reject('wrong-signature-format', `team battles take EIP-712 signed plans on EVM chains; got ${request.signatureFormat} on ${plan.domain.chainId}`);
    }
    if (!verifyPlanSignature(plan, request.signature)) {
        return reject('bad-signature', 'signature does not recover to the defender owner');
    }

    // Ownership from indexed chain state, as for an intent. Acceptance checks again at snapshot
    // time; this is so a defender learns about a pet they no longer own when saving, not when
    // a challenger's battle is refused.
    const family = chainFamily(plan.domain.chainId);
    const pets = await Promise.all(plan.roster.map((entry) => getPetById(family, entry.petId.toString())));
    for (const [i, pet] of pets.entries()) {
        const petId = plan.roster[i]?.petId;
        if (!pet) return reject('unknown-pet', `roster pet ${petId} is not in the roster index`);
        if (normalizeAccount(pet.owner) !== plan.defenderOwner) {
            return reject('not-pet-owner', `pet ${petId} belongs to ${pet.owner}, not ${plan.defenderOwner}`);
        }
    }

    const highest = await prisma.defensePlan.findFirst({
        where: { chainId: plan.domain.chainId, deploymentId: plan.domain.deploymentId, defenderOwner: plan.defenderOwner },
        orderBy: { revocationNonce: 'desc' },
        select: { revocationNonce: true },
    });
    if (highest && plan.revocationNonce < highest.revocationNonce) {
        return reject('stale-revocation-nonce', `revocationNonce ${plan.revocationNonce} is below this owner current ${highest.revocationNonce}`);
    }

    const planHash = hashDefensePlan(plan);
    try {
        const [replaced] = await prisma.$transaction([
            prisma.defensePlan.updateMany({
                where: { chainId: plan.domain.chainId, deploymentId: plan.domain.deploymentId, defenderOwner: plan.defenderOwner, revokedAt: null },
                data: { revokedAt: new Date(request.nowSeconds * 1000) },
            }),
            prisma.defensePlan.create({
                data: {
                    planHash,
                    chainId: plan.domain.chainId,
                    deploymentId: plan.domain.deploymentId,
                    defenderOwner: plan.defenderOwner,
                    roster: plan.roster.map((e) => ({ petId: e.petId.toString(), col: e.col, row: e.row, tactic: e.tactic })),
                    rulesetHash: plan.rulesetHash,
                    minLevel: plan.minLevel,
                    maxLevel: plan.maxLevel,
                    maxBattlesPerDay: plan.maxBattlesPerDay,
                    notBefore: BigInt(plan.notBefore),
                    expiresAt: BigInt(plan.expiresAt),
                    revocationNonce: plan.revocationNonce,
                    signature: request.signature,
                    signatureFormat: request.signatureFormat,
                },
            }),
        ]);
        return { ok: true, planHash, replaced: replaced.count };
    } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
            return reject('duplicate-plan', `plan ${planHash} already exists`);
        }
        throw error;
    }
}

/**
 * Revokes the wallet's live plans, immediately. JWT only, like consent revocation: an
 * unauthorized revocation can only cause fewer battles, and withdrawing must keep working for
 * a player who has lost their signing device. Marked, not deleted: receipts name plan hashes.
 */
export async function revokeDefensePlans(chainId: string, defenderOwner: string, revokedAt: Date): Promise<{ revoked: number }> {
    const { count } = await prisma.defensePlan.updateMany({
        where: { chainId, deploymentId: servedDeploymentId(), defenderOwner: normalizeAccount(defenderOwner), revokedAt: null },
        data: { revokedAt },
    });
    return { revoked: count };
}

/** The caller's live plan, as the read surface presents it. */
export interface DefensePlanSummary {
    planHash: string;
    roster: DefensePlanWire['roster'];
    minLevel: number;
    maxLevel: number;
    maxBattlesPerDay: number;
    notBefore: number;
    expiresAt: number;
    rulesetHash: string;
    /** Signed for rules no longer served, so it covers no battle; as \`isStale\` on consent. */
    isStale: boolean;
    createdAt: string;
}

/** The wallet's live plan, or null. One at most, since saving a plan revokes the earlier ones. */
export async function getLiveDefensePlan(chainId: string, defenderOwner: string, servedRulesetHash: string): Promise<DefensePlanSummary | null> {
    const row = await prisma.defensePlan.findFirst({
        where: { chainId, deploymentId: servedDeploymentId(), defenderOwner: normalizeAccount(defenderOwner), revokedAt: null },
        orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return {
        planHash: row.planHash,
        roster: row.roster as unknown as DefensePlanWire['roster'],
        minLevel: row.minLevel,
        maxLevel: row.maxLevel,
        maxBattlesPerDay: row.maxBattlesPerDay,
        notBefore: Number(row.notBefore),
        expiresAt: Number(row.expiresAt),
        rulesetHash: row.rulesetHash,
        isStale: row.rulesetHash.toLowerCase() !== servedRulesetHash.toLowerCase(),
        createdAt: row.createdAt.toISOString(),
    };
}

/**
 * Consumes one team battle from a plan's daily budget. The same guarded increment as
 * `consumeDailyBudget`: the cap lives in the WHERE clause, so two concurrent challenges cannot
 * both take the last battle.
 */
export async function consumePlanDailyBudget(
    planHash: string,
    maxBattlesPerDay: number,
    nowSeconds: number,
): Promise<{ ok: true; used: number } | { ok: false; reason: typeof CONSENT_REFUSALS.DAILY_CAP_REACHED }> {
    const dayBucket = epochDay(nowSeconds);
    const bump = async () =>
        prisma.defensePlanUsage.updateMany({
            where: { planHash, dayBucket, count: { lt: maxBattlesPerDay } },
            data: { count: { increment: 1 } },
        });

    let result = await bump();
    if (result.count === 0) {
        try {
            await prisma.defensePlanUsage.create({ data: { planHash, dayBucket, count: 1 } });
            return { ok: true, used: 1 };
        } catch (error) {
            if ((error as { code?: string }).code !== 'P2002') throw error;
            result = await bump();
        }
    }
    if (result.count === 0) {
        return { ok: false, reason: CONSENT_REFUSALS.DAILY_CAP_REACHED };
    }
    const row = await prisma.defensePlanUsage.findUnique({
        where: { planHash_dayBucket: { planHash, dayBucket } },
        select: { count: true },
    });
    return { ok: true, used: row?.count ?? 1 };
}

/** Verifies the defender's EIP-712 signature over the plan. */
export function verifyPlanSignature(plan: DefensePlan, signature: string): boolean {
    try {
        const typed = defensePlanTypedData(plan);
        const types = typed.types as unknown as Record<string, ethers.TypedDataField[]>;
        const recovered = ethers.verifyTypedData(typed.domain, types, typed.message, signature);
        return normalizeAccount(recovered) === plan.defenderOwner;
    } catch {
        return false;
    }
}

/** Maps the wire shape onto the protocol type. */
export function toProtocolPlan(wire: DefensePlanWire): DefensePlan {
    return {
        domain: { chainId: wire.chainId as ChainId, deploymentId: wire.deploymentId },
        defenderOwner: wire.defenderOwner,
        roster: (wire.roster ?? []).map((e) => ({ petId: BigInt(e.petId), col: e.col, row: e.row, tactic: e.tactic })),
        rulesetHash: wire.rulesetHash as `0x${string}`,
        minLevel: wire.minLevel,
        maxLevel: wire.maxLevel,
        maxBattlesPerDay: wire.maxBattlesPerDay,
        notBefore: wire.notBefore,
        expiresAt: wire.expiresAt,
        revocationNonce: wire.revocationNonce,
    };
}

function reject(reason: PlanRejection, detail: string): SubmitPlanResult {
    return { ok: false, reason, detail };
}
