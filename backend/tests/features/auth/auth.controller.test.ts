import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('@utils', () => ({
    createNonce: vi.fn().mockReturnValue('test-nonce'),
    sanitizeName: vi.fn((s: string) => s),
    isEvmAddress: vi.fn(),
    positiveMod: vi.fn(),
    withFallback: vi.fn(),
}));
vi.mock('../../../src/features/auth/nonce.store', () => ({
    storeNonce: vi.fn(),
    consumeNonce: vi.fn().mockReturnValue(true),
}));
vi.mock('../../../src/features/auth/auth.service', () => ({
    verifyWalletSignature: vi.fn(),
    issueToken: vi.fn().mockReturnValue('jwt-token'),
    upsertUser: vi.fn(),
}));

import { getNonce, verify } from '../../../src/features/auth/auth.controller';
import { storeNonce, consumeNonce } from '../../../src/features/auth/nonce.store';
import { verifyWalletSignature, issueToken, upsertUser } from '../../../src/features/auth/auth.service';

function makeRes() {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    return res as unknown as Response;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consumeNonce).mockReturnValue(true);
});

describe('getNonce', () => {
    it('stores and returns a new nonce', async () => {
        const res = makeRes();
        await getNonce({} as Request, res);
        expect(storeNonce).toHaveBeenCalledWith('test-nonce');
        expect(res.json).toHaveBeenCalledWith({ nonce: 'test-nonce' });
    });
});

describe('verify', () => {
    const baseBody = { address: '0xabc', signature: '0xsig', nonce: 'test-nonce' };

    it('returns 400 when fields are missing', async () => {
        const res = makeRes();
        await verify({ body: {} } as Request, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 401 when nonce is invalid', async () => {
        vi.mocked(consumeNonce).mockReturnValue(false);
        const res = makeRes();
        await verify({ body: baseBody } as Request, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired nonce' });
    });

    it('returns 401 when signature verification fails', async () => {
        vi.mocked(verifyWalletSignature).mockReturnValue({ ok: false, error: 'bad sig' });
        const res = makeRes();
        await verify({ body: baseBody } as Request, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'bad sig' });
    });

    it('returns token and user on success', async () => {
        const now = new Date();
        vi.mocked(consumeNonce).mockReturnValue(true);
        vi.mocked(verifyWalletSignature).mockReturnValue({ ok: true, storageKey: '0xabc' });
        vi.mocked(upsertUser).mockResolvedValue({ address: '0xabc', createdAt: now, lastLogin: now } as never);
        const res = makeRes();
        await verify({ body: baseBody } as Request, res);
        expect(issueToken).toHaveBeenCalledWith('0xabc');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, token: 'jwt-token' }));
    });

    it('returns 500 when upsertUser throws', async () => {
        vi.mocked(consumeNonce).mockReturnValue(true);
        vi.mocked(verifyWalletSignature).mockReturnValue({ ok: true, storageKey: '0xabc' });
        vi.mocked(upsertUser).mockRejectedValue(new Error('db down'));
        const res = makeRes();
        await verify({ body: baseBody } as Request, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});
