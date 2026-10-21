import type { Request, Response } from 'express';
import { createNonce } from '@utils';
import {
    issueToken,
    upsertUser,
    verifyWalletSignature,
} from './auth.service';
import { consumeNonce, storeNonce } from './nonce.store';
import type { AuthErrorResponse, AuthVerifyRequest, NonceResponse, VerifyResponse } from './auth.types';

export async function getNonce(_req: Request, res: Response<NonceResponse>): Promise<void> {
    const nonce = createNonce();
    await storeNonce(nonce);
    res.json({ nonce });
}

export async function verify(
    req: AuthVerifyRequest,
    res: Response<VerifyResponse | AuthErrorResponse>
): Promise<void> {
    try {
        const { address, signature, nonce } = req.body;

        if (!address || !signature || !nonce) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        // Single-use challenge: the nonce must have been issued by GET /nonce and
        // is burned on this attempt, so a captured signature cannot be replayed.
        if (!(await consumeNonce(nonce))) {
            res.status(401).json({ error: 'Invalid or expired nonce' });
            return;
        }

        const verified = verifyWalletSignature(address, signature, nonce);
        if (!verified.ok) {
            res.status(401).json({ error: verified.error });
            return;
        }

        const user = await upsertUser(verified.storageKey);
        const token = issueToken(verified.storageKey);

        res.json({
            success: true,
            token,
            user: {
                address: user.address,
                createdAt: user.createdAt,
                lastLogin: user.lastLogin,
            },
        });
    } catch {
        res.status(500).json({ error: 'Internal server error' });
    }
}
