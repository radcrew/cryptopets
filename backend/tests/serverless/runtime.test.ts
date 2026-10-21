import { beforeEach, describe, expect, it, vi } from 'vitest';

const battle = vi.hoisted(() => ({ enabled: true }));
vi.mock('@config/env', () => ({ env: { battle } }));
vi.mock('@features/battle/signer', () => ({
    configureSigner: vi.fn(),
    loadPersistedSigningKeys: vi.fn(),
    signerBackendError: vi.fn(),
}));

import { configureSigner, loadPersistedSigningKeys } from '@features/battle/signer';
import { ensureBattleRuntime, resetBattleRuntimeForTests } from '../../src/serverless/runtime';

beforeEach(() => {
    vi.clearAllMocks();
    resetBattleRuntimeForTests();
    battle.enabled = true;
});

describe('ensureBattleRuntime', () => {
    it('configures the signer and loads persisted keys once per instance', async () => {
        await Promise.all([ensureBattleRuntime(), ensureBattleRuntime()]);
        await ensureBattleRuntime();
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
