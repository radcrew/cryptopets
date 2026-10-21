import { beforeEach, describe, expect, it, vi } from 'vitest';

const battle = vi.hoisted(() => ({ enabled: true }));
vi.mock('@config/env', () => ({ env: { battle } }));
vi.mock('@features/battle/signer', () => ({
    configureSigner: vi.fn(),
    loadPersistedSigningKeys: vi.fn(),
    signerBackendError: vi.fn(),
}));

import { configureSigner, loadPersistedSigningKeys, signerBackendError } from '@features/battle/signer';
import { ensureBattleRuntime, resetBattleRuntimeForTests, RETRY_DELAY_MS } from '../../src/serverless/runtime';

beforeEach(() => {
    vi.clearAllMocks();
    resetBattleRuntimeForTests();
    battle.enabled = true;
    // clearAllMocks keeps implementations, so a test that makes configureSigner reject
    // would otherwise leak into the next one.
    vi.mocked(configureSigner).mockResolvedValue(undefined);
    vi.mocked(signerBackendError).mockReturnValue(null);
});

describe('ensureBattleRuntime', () => {
    it('configures the signer and loads persisted keys once per instance', async () => {
        await Promise.all([ensureBattleRuntime(), ensureBattleRuntime()]);
        await ensureBattleRuntime(Date.now() + RETRY_DELAY_MS * 10);
        expect(configureSigner).toHaveBeenCalledTimes(1);
        expect(loadPersistedSigningKeys).toHaveBeenCalledTimes(1);
    });

    it('does nothing when battle mode is off', async () => {
        battle.enabled = false;
        await ensureBattleRuntime();
        expect(configureSigner).not.toHaveBeenCalled();
    });

    it('never rejects, so reads are still served when signing is broken', async () => {
        vi.mocked(configureSigner).mockRejectedValue(new Error('KMS unreachable'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(ensureBattleRuntime()).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('KMS unreachable'));
        error.mockRestore();
    });
});

describe('a failed setup', () => {
    const error = () => vi.spyOn(console, 'error').mockImplementation(() => {});

    it('is retried once the retry delay has passed', async () => {
        const quiet = error();
        // configureSigner records its failure instead of throwing.
        vi.mocked(signerBackendError).mockReturnValueOnce('kms: timeout').mockReturnValue(null);
        await ensureBattleRuntime();
        expect(configureSigner).toHaveBeenCalledTimes(1);

        await ensureBattleRuntime(Date.now() + RETRY_DELAY_MS);
        expect(configureSigner).toHaveBeenCalledTimes(2);

        // Recovered: no further attempts.
        await ensureBattleRuntime(Date.now() + RETRY_DELAY_MS * 10);
        expect(configureSigner).toHaveBeenCalledTimes(2);
        quiet.mockRestore();
    });

    it('is not retried on every request before the delay has passed', async () => {
        const quiet = error();
        vi.mocked(signerBackendError).mockReturnValue('kms: wrong key id');
        await ensureBattleRuntime();
        await ensureBattleRuntime(Date.now() + RETRY_DELAY_MS / 2);
        await ensureBattleRuntime(Date.now() + RETRY_DELAY_MS / 2);
        expect(configureSigner).toHaveBeenCalledTimes(1);
        quiet.mockRestore();
    });

    it('is retried after a thrown error too', async () => {
        const quiet = error();
        vi.mocked(configureSigner).mockRejectedValueOnce(new Error('KMS unreachable'));
        await ensureBattleRuntime();
        await ensureBattleRuntime(Date.now() + RETRY_DELAY_MS);
        expect(configureSigner).toHaveBeenCalledTimes(2);
        quiet.mockRestore();
    });
});
