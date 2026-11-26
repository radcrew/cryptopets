import type { Response } from 'express';

import type { AuthenticatedRequest } from '@middleware/auth';

import {
    type BattleIntentWire,
    type IntentRejection,
    type SignatureFormat,
    submitBattleIntent,
} from './intent.service';

/**
 * POST handler for a signed battle intent.
 *
 * Returns 401 for a rejection that means "you are not who this intent says", 409 for a
 * nonce or intent already used, and 422 for everything else that is the client's fault. The
 * distinction is worth making: a client should retry none of these, but a wallet-mismatch is
 * a bug in the client while a used nonce usually means a duplicate submit.
 */
export const STATUS_BY_REASON: Record<IntentRejection, number> = {
    'malformed-intent': 422,
    'wrong-deployment': 422,
    'intent-expired': 422,
    'wallet-mismatch': 403,
    'wrong-signature-format': 422,
    'bad-signature': 401,
    // 401, like a bad signature: the signature was real but the key is not authorized to
    // act for this wallet. Its own reason rather than folded into `bad-signature`, because
    // it is the one a player can fix — the session lapsed or was revoked, and re-approving
    // is a single prompt. A client should re-delegate and retry rather than give up.
    'session-not-authorized': 401,
    'unknown-pet': 404,
    'not-pet-owner': 403,
    'self-battle': 422,
    'same-owner': 422,
    'nonce-already-used': 409,
    'duplicate-intent': 409,
};

interface SubmitIntentBody {
    intent?: BattleIntentWire;
    signature?: string;
    signatureFormat?: SignatureFormat;
    /** The delegated key that signed, when one did (§D). Absent means the wallet signed. */
    sessionKey?: string;
}

export async function postBattleIntent(req: AuthenticatedRequest, res: Response): Promise<void> {
    const wallet = req.user?.address;
    if (!wallet) {
        res.status(401).json({ error: 'authentication required' });
        return;
    }

    const body = req.body as SubmitIntentBody;
    if (!body?.intent || typeof body.signature !== 'string' || !body.signatureFormat) {
        res.status(422).json({ error: 'intent, signature, and signatureFormat are required' });
        return;
    }

    const result = await submitBattleIntent({
        intent: body.intent,
        signature: body.signature,
        signatureFormat: body.signatureFormat,
        ...(typeof body.sessionKey === 'string' ? { sessionKey: body.sessionKey } : {}),
        authenticatedWallet: wallet,
        // The clock enters here and nowhere deeper, so every layer below is testable
        // without faking time.
        nowSeconds: Math.floor(Date.now() / 1000),
    });

    if (!result.ok) {
        res.status(STATUS_BY_REASON[result.reason]).json({ error: result.reason, detail: result.detail });
        return;
    }

    res.status(201).json({ intentHash: result.intentHash });
}
