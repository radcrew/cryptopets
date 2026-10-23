import type { Response } from 'express';

import type { AuthenticatedRequest } from '@middleware/auth';

import { acceptBattle, type AcceptRejection } from './accept.service';
import { BATTLE_REFUSALS, CONSENT_REFUSALS } from './constants';

/**
 * 409 for "someone already acted on this", 404/403/422 for the client's own fault, and 503 for
 * the dependencies this flow cannot proceed without (drand, the signer, a catalog that can
 * price the gear in play). A 503 is the honest answer for those: retrying shortly is the
 * correct client behaviour, and nothing about the request itself was wrong.
 *
 * A stale catalog is the odd one of the three, since retrying will not help until someone runs
 * the seeder. It is still a 503 rather than a 500: the deployment is misconfigured, not broken,
 * and a client that backs off and retries is behaving correctly either way.
 */
export const STATUS_BY_REASON: Record<AcceptRejection, number> = {
    [BATTLE_REFUSALS.INTENT_NOT_FOUND]: 404,
    [BATTLE_REFUSALS.INTENT_ALREADY_CONSUMED]: 409,
    [BATTLE_REFUSALS.INTENT_EXPIRED]: 422,
    [BATTLE_REFUSALS.ATTACKER_PET_MISSING]: 404,
    [BATTLE_REFUSALS.DEFENDER_PET_MISSING]: 404,
    [BATTLE_REFUSALS.ATTACKER_NOT_READY]: 409,
    [BATTLE_REFUSALS.DEFENDER_NOT_READY]: 409,
    // Coverage failures. `@cryptopets/protocol` owns these as its `CoverageFailure` type, and
    // it exports no constants for them, so they are spelled here as the protocol spells them.
    'not-yet-valid': 409,
    expired: 409,
    'pet-not-covered': 403,
    'attacker-level-below-band': 403,
    'attacker-level-above-band': 403,
    'ruleset-mismatch': 403,
    [CONSENT_REFUSALS.NO_AUTHORIZATION]: 403,
    [CONSENT_REFUSALS.REVOKED]: 403,
    [CONSENT_REFUSALS.DAILY_CAP_REACHED]: 429,
    [BATTLE_REFUSALS.PET_LOCKED]: 409,
    [BATTLE_REFUSALS.DRAND_UNAVAILABLE]: 503,
    [BATTLE_REFUSALS.SIGNER_UNAVAILABLE]: 503,
    [BATTLE_REFUSALS.ITEM_CATALOG_STALE]: 503,
    [BATTLE_REFUSALS.EQUIPMENT_CATALOG_MISMATCH]: 503,
};

interface AcceptBody {
    intentHash?: string;
    /** The shareable room this accept call is happening through, if any (§J). */
    roomId?: string;
}

/**
 * Accepts a previously-submitted intent: freezes the snapshot, commits to a future drand
 * round, signs the commitment, and returns it in this same response. The signed commitment in
 * the response body is the player's own evidence for commit-before-reveal (§E) — the client
 * must persist it, since this is the only place it is ever handed over synchronously.
 */
export async function postAcceptBattle(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user?.address) {
        res.status(401).json({ error: 'authentication required' });
        return;
    }
    const body = req.body as AcceptBody;
    if (typeof body?.intentHash !== 'string') {
        res.status(422).json({ error: 'intentHash is required' });
        return;
    }

    const result = await acceptBattle({
        intentHash: body.intentHash,
        ...(typeof body.roomId === 'string' ? { roomId: body.roomId } : {}),
        nowSeconds: Math.floor(Date.now() / 1000),
    });

    if (!result.ok) {
        res.status(STATUS_BY_REASON[result.reason]).json({ error: result.reason, detail: result.detail });
        return;
    }

    res.status(201).json({
        battleId: result.battle.battleId,
        commitmentHash: result.battle.commitmentHash,
        signature: result.battle.signature,
        signingKeyId: result.battle.signingKeyId,
        commitment: serializeCommitmentForWire(result.battle.commitment),
    });
}

function serializeCommitmentForWire(commitment: unknown): unknown {
    return JSON.parse(JSON.stringify(commitment, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)));
}
