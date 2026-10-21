import { beforeEach, describe, expect, it, vi } from 'vitest';

const battle = vi.hoisted(() => ({ enabled: true }));
vi.mock('@config/env', () => ({ env: { battle } }));
vi.mock('@features/battle/anchor', () => ({ createAnchorContext: vi.fn(), runOnce: vi.fn() }));
vi.mock('@features/battle/worker', () => ({ drainBattleWorker: vi.fn() }));

import { createAnchorContext, runOnce } from '@features/battle/anchor';
import { drainBattleWorker } from '@features/battle/worker';
import { CRON_PATHS, isAuthorizedCron, runCronJob } from '../../src/serverless/cron';

beforeEach(() => {
    vi.clearAllMocks();
    battle.enabled = true;
});

describe('isAuthorizedCron', () => {
    it('accepts the configured bearer secret', () => {
        expect(isAuthorizedCron('Bearer s3cret', 's3cret')).toBe(true);
    });

    it.each([undefined, '', 'Bearer wrong', 's3cret', 'Bearer s3cret '])('rejects %j', (header) => {
        expect(isAuthorizedCron(header, 's3cret')).toBe(false);
    });

    it('refuses everything when no secret is configured', () => {
        expect(isAuthorizedCron('Bearer ', undefined)).toBe(false);
        expect(isAuthorizedCron('Bearer anything', '')).toBe(false);
    });
});

describe('runCronJob', () => {
    it('drains the battle queue', async () => {
        vi.mocked(drainBattleWorker).mockResolvedValue({ processed: 3 });
        expect(await runCronJob(CRON_PATHS.battleWorker)).toEqual({ processed: 3 });
        expect(drainBattleWorker).toHaveBeenCalledWith(expect.any(String), { budgetMs: 50_000 });
    });

    it('skips the queue when battle mode is off', async () => {
        battle.enabled = false;
        expect(await runCronJob(CRON_PATHS.battleWorker)).toEqual({ skipped: 'battle mode off' });
        expect(drainBattleWorker).not.toHaveBeenCalled();
    });

    it('runs one anchoring pass when anchoring is configured', async () => {
        const context = { registryAddress: '0xabc' };
        vi.mocked(createAnchorContext).mockReturnValue(context as never);
        expect(await runCronJob(CRON_PATHS.battleAnchor)).toEqual({ ran: true });
        expect(runOnce).toHaveBeenCalledWith(context);
    });

    it('skips anchoring when it is not configured', async () => {
        vi.mocked(createAnchorContext).mockReturnValue(null);
        expect(await runCronJob(CRON_PATHS.battleAnchor)).toEqual({ skipped: 'anchoring not configured' });
        expect(runOnce).not.toHaveBeenCalled();
    });

    it('returns null for a path that is not a job', async () => {
        expect(await runCronJob('/api/cron/unknown')).toBeNull();
    });
});
