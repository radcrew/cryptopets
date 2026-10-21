import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@features/battle/ledger/corpus.service', () => ({
    listReceiptsByPet: vi.fn(),
    listReceiptsByWallet: vi.fn(),
    listReceiptsBySequence: vi.fn(),
}));

import {
    listReceiptsByPet,
    listReceiptsBySequence,
    listReceiptsByWallet,
} from '../../../../src/features/battle/ledger/corpus.service';
import {
    getReceiptsByPet,
    getReceiptsBySequence,
    getReceiptsByWallet,
} from '../../../../src/features/battle/ledger/corpus.controller';

function mockRes() {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res as unknown as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getReceiptsByPet', () => {
    it('reads chainId and petId from the route and forwards query pagination', async () => {
        vi.mocked(listReceiptsByPet).mockResolvedValue({ receipts: [], nextCursor: null });
        const res = mockRes();
        await getReceiptsByPet(
            { params: { chainId: 'eip155:84532', petId: '7' }, query: { cursor: '0xabc', limit: '25' } } as never,
            res as never,
        );
        expect(listReceiptsByPet).toHaveBeenCalledWith('eip155:84532', '7', '0xabc', 25);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes undefined limit through rather than NaN when none is given', async () => {
        vi.mocked(listReceiptsByPet).mockResolvedValue({ receipts: [], nextCursor: null });
        await getReceiptsByPet({ params: { chainId: 'eip155:84532', petId: '7' }, query: {} } as never, mockRes() as never);
        expect(listReceiptsByPet).toHaveBeenCalledWith('eip155:84532', '7', undefined, undefined);
    });
});

describe('getReceiptsByWallet', () => {
    it('reads the wallet from the route param', async () => {
        vi.mocked(listReceiptsByWallet).mockResolvedValue({ receipts: [], nextCursor: null });
        const res = mockRes();
        await getReceiptsByWallet({ params: { wallet: '0xabc' }, query: {} } as never, res as never);
        expect(listReceiptsByWallet).toHaveBeenCalledWith('0xabc', undefined, undefined);
        expect(res.status).toHaveBeenCalledWith(200);
    });
});

describe('getReceiptsBySequence', () => {
    it('requires signingKeyId', async () => {
        const res = mockRes();
        await getReceiptsBySequence({ query: {} } as never, res as never);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(listReceiptsBySequence).not.toHaveBeenCalled();
    });

    it('rejects a repeated signingKeyId, which arrives as an array', async () => {
        const res = mockRes();
        await getReceiptsBySequence({ query: { signingKeyId: ['a', 'b'] } } as never, res as never);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(listReceiptsBySequence).not.toHaveBeenCalled();
    });

    it.each(['abc', '-1', '1.5', ''])('rejects after=%j instead of throwing in BigInt', async (after) => {
        const res = mockRes();
        await getReceiptsBySequence({ query: { signingKeyId: 'battle-signer-2026-07', after } } as never, res as never);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(listReceiptsBySequence).not.toHaveBeenCalled();
    });

    it('forwards signingKeyId, after, and limit', async () => {
        vi.mocked(listReceiptsBySequence).mockResolvedValue({ receipts: [], nextAfter: null });
        const res = mockRes();
        await getReceiptsBySequence(
            { query: { signingKeyId: 'battle-signer-2026-07', after: '10', limit: '50' } } as never,
            res as never,
        );
        expect(listReceiptsBySequence).toHaveBeenCalledWith('battle-signer-2026-07', '10', 50);
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
