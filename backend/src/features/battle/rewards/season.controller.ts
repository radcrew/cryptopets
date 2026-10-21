import type { Request, Response } from 'express';

import { prisma } from '@config/prisma';

import { getClaimProof } from './season.service';

/**
 * Public reads for reward seasons (§I).
 *
 * Unauthenticated, like every other read on this path. A claim proof is worthless to anyone
 * but the wallet named inside it — the leaf binds the beneficiary, so handing one out lets
 * a stranger pay the gas to deliver someone's reward, not take it. Requiring a login would
 * only stop people from checking our arithmetic.
 */

export async function getSeasonClaim(req: Request, res: Response): Promise<void> {
    const seasonId = Number(req.params.seasonId);
    if (!Number.isSafeInteger(seasonId) || seasonId < 0) {
        res.status(422).json({ error: 'invalid-season-id' });
        return;
    }

    const proof = await getClaimProof(seasonId, req.params.wallet as string);
    if (!proof) {
        // One status for two cases on purpose: whether the season is unknown or the wallet
        // simply earned nothing, the answer to "what can I claim" is the same, and
        // distinguishing them would leak which wallets participated to anyone enumerating.
        res.status(404).json({ error: 'no-entitlement', detail: 'no claimable entitlement for this wallet and season' });
        return;
    }
    res.status(200).json(proof);
}

/** Season metadata, so a client can see the range and rates a season was computed from. */
export async function getSeason(req: Request, res: Response): Promise<void> {
    const seasonId = Number(req.params.seasonId);
    if (!Number.isSafeInteger(seasonId) || seasonId < 0) {
        res.status(422).json({ error: 'invalid-season-id' });
        return;
    }
    const season = await prisma.rewardSeason.findUnique({
        where: { seasonId },
        select: {
            seasonId: true,
            chainId: true,
            deploymentId: true,
            firstSequence: true,
            lastSequence: true,
            distributor: true,
            evmChainId: true,
            token: true,
            merkleRoot: true,
            totalAmount: true,
            params: true,
            openedTxHash: true,
            openedAt: true,
        },
    });
    if (!season) {
        res.status(404).json({ error: 'season-not-found' });
        return;
    }

    res.status(200).json({
        ...season,
        // Sequence bounds are the reproducibility contract: they say exactly which slice of
        // the public corpus to replay to arrive at this root.
        firstSequence: season.firstSequence.toString(),
        lastSequence: season.lastSequence.toString(),
    });
}
