import type { Response } from 'express';

import type { AuthenticatedRequest } from '@middleware/auth';

import { type DefensePlanWire, getLiveDefensePlan, type PlanRejection, revokeDefensePlans, submitDefensePlan } from './defensePlan.service';
import type { SignatureFormat } from './intent.service';
import { servedTeamRulesetHash } from './ruleset.builder';

export const STATUS_BY_REASON: Record<PlanRejection, number> = {
    'malformed-plan': 422,
    'wrong-deployment': 422,
    'wallet-mismatch': 403,
    'wrong-signature-format': 422,
    'bad-signature': 401,
    'already-expired': 422,
    // 409: the plan is well formed but conflicts with what is served; re-sign and resubmit.
    'plan-ruleset-mismatch': 409,
    'unknown-pet': 404,
    'not-pet-owner': 403,
    'stale-revocation-nonce': 409,
    'duplicate-plan': 409,
};

interface SubmitBody {
    plan?: DefensePlanWire;
    signature?: string;
    signatureFormat?: SignatureFormat;
}

/** Saves a signed defence plan, replacing the wallet's earlier one. */
export async function postDefensePlan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const wallet = req.user?.address;
    if (!wallet) {
        res.status(401).json({ error: 'authentication required' });
        return;
    }
    const body = req.body as SubmitBody;
    if (!body?.plan || typeof body.signature !== 'string' || !body.signatureFormat) {
        res.status(422).json({ error: 'plan, signature, and signatureFormat are required' });
        return;
    }
    const result = await submitDefensePlan({
        plan: body.plan,
        signature: body.signature,
        signatureFormat: body.signatureFormat,
        authenticatedWallet: wallet,
        servedRulesetHash: await servedTeamRulesetHash(),
        nowSeconds: Math.floor(Date.now() / 1000),
    });
    if (!result.ok) {
        res.status(STATUS_BY_REASON[result.reason]).json({ error: result.reason, detail: result.detail });
        return;
    }
    res.status(201).json({ planHash: result.planHash, replaced: result.replaced });
}

/** Withdraws the wallet's plan on one chain. Ungated, like consent revocation. */
export async function deleteDefensePlans(req: AuthenticatedRequest, res: Response): Promise<void> {
    const wallet = req.user?.address;
    if (!wallet) {
        res.status(401).json({ error: 'authentication required' });
        return;
    }
    const chainId = typeof req.query.chainId === 'string' ? req.query.chainId : undefined;
    if (!chainId) {
        res.status(422).json({ error: 'chainId is required' });
        return;
    }
    const { revoked } = await revokeDefensePlans(chainId, wallet, new Date());
    res.status(200).json({ revoked });
}

/**
 * The wallet's own live plan, with the team ruleset it would need to match. Always the
 * authenticated wallet, never a queried one, as with consent.
 */
export async function getDefensePlan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const wallet = req.user?.address;
    if (!wallet) {
        res.status(401).json({ error: 'authentication required' });
        return;
    }
    const chainId = typeof req.query.chainId === 'string' ? req.query.chainId : undefined;
    if (!chainId) {
        res.status(422).json({ error: 'chainId is required' });
        return;
    }
    const rulesetHash = await servedTeamRulesetHash();
    const plan = await getLiveDefensePlan(chainId, wallet, rulesetHash);
    res.status(200).json({ rulesetHash, plan });
}
