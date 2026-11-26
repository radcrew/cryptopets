import type { Response } from 'express';

import type { AuthenticatedRequest } from '@middleware/auth';

import { STATUS_BY_REASON as DUEL_STATUS } from './intent.controller';
import type { SignatureFormat } from './intent.service';
import { submitTeamBattleIntent, type TeamBattleIntentWire, type TeamIntentRejection } from './teamIntent.service';

/** The duel's statuses for the shared reasons, so one refusal means one status on both paths. */
export const STATUS_BY_REASON: Record<TeamIntentRejection, number> = {
    'malformed-intent': DUEL_STATUS['malformed-intent'],
    'wrong-deployment': DUEL_STATUS['wrong-deployment'],
    'intent-expired': DUEL_STATUS['intent-expired'],
    'wallet-mismatch': DUEL_STATUS['wallet-mismatch'],
    'wrong-signature-format': DUEL_STATUS['wrong-signature-format'],
    'bad-signature': DUEL_STATUS['bad-signature'],
    'session-not-authorized': DUEL_STATUS['session-not-authorized'],
    'unknown-pet': DUEL_STATUS['unknown-pet'],
    'not-pet-owner': DUEL_STATUS['not-pet-owner'],
    'same-owner': DUEL_STATUS['same-owner'],
    'nonce-already-used': DUEL_STATUS['nonce-already-used'],
    'duplicate-intent': DUEL_STATUS['duplicate-intent'],
    'unknown-plan': 404,
    // 410: the plan existed and the defender withdrew it; asking again will not help.
    'plan-revoked': 410,
};

interface SubmitTeamIntentBody {
    intent?: TeamBattleIntentWire;
    signature?: string;
    signatureFormat?: SignatureFormat;
    /** The delegated key that signed, when one did (§D). Absent means the wallet signed. */
    sessionKey?: string;
}

export async function postTeamBattleIntent(req: AuthenticatedRequest, res: Response): Promise<void> {
    const wallet = req.user?.address;
    if (!wallet) {
        res.status(401).json({ error: 'authentication required' });
        return;
    }
    const body = req.body as SubmitTeamIntentBody;
    if (!body?.intent || typeof body.signature !== 'string' || !body.signatureFormat) {
        res.status(422).json({ error: 'intent, signature, and signatureFormat are required' });
        return;
    }
    const result = await submitTeamBattleIntent({
        intent: body.intent,
        signature: body.signature,
        signatureFormat: body.signatureFormat,
        ...(typeof body.sessionKey === 'string' ? { sessionKey: body.sessionKey } : {}),
        authenticatedWallet: wallet,
        nowSeconds: Math.floor(Date.now() / 1000),
    });
    if (!result.ok) {
        res.status(STATUS_BY_REASON[result.reason]).json({ error: result.reason, detail: result.detail });
        return;
    }
    res.status(201).json({ intentHash: result.intentHash });
}
