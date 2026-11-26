import type { Response } from 'express';

import type { AuthenticatedRequest } from '@middleware/auth';

import { servedTeamRulesetHash } from './ruleset.builder';
import { listTeamOpponents } from './teamReads.service';

/**
 * Defence plans the caller can challenge. Authenticated only so the caller's own plan can be
 * left out; the plans themselves are what defenders publish to be challenged.
 */
export async function getTeamOpponents(req: AuthenticatedRequest, res: Response): Promise<void> {
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
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const rulesetHash = await servedTeamRulesetHash();
    const opponents = await listTeamOpponents({
        chainId,
        caller: wallet,
        servedRulesetHash: rulesetHash,
        nowSeconds: Math.floor(Date.now() / 1000),
        ...(limit !== undefined && Number.isFinite(limit) && { limit }),
    });
    res.status(200).json({ rulesetHash, opponents });
}
