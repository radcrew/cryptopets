import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@config/prisma', () => ({
    prisma: { rewardSeason: { findUnique: vi.fn() } },
}));
vi.mock('@features/battle/rewards/season.service', () => ({
    getClaimProof: vi.fn(),
}));

import { prisma } from '../../../../src/config/prisma';
import { getSeason } from '../../../../src/features/battle/rewards/season.controller';

function mockRes() {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res as unknown as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getSeason', () => {
    it.each(['abc', '-1', '1.5'])('rejects seasonId=%j before querying', async (seasonId) => {
        const res = mockRes();
        await getSeason({ params: { seasonId } } as never, res as never);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(prisma.rewardSeason.findUnique).not.toHaveBeenCalled();
    });

    it('answers 404 for a valid id with no season', async () => {
        vi.mocked(prisma.rewardSeason.findUnique).mockResolvedValue(null);
        const res = mockRes();
        await getSeason({ params: { seasonId: '3' } } as never, res as never);
        expect(prisma.rewardSeason.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { seasonId: 3 } }));
        expect(res.status).toHaveBeenCalledWith(404);
    });
});
