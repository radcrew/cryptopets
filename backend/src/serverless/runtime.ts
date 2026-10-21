import { env } from '@config/env';
import { configureSigner, loadPersistedSigningKeys, signerBackendError } from '@features/battle/signer';

/**
 * The one-time setup `server.ts` does at boot, for a host with no boot.
 *
 * A serverless instance starts on its first request and never runs the `listen` callback,
 * so the battle signer would stay unconfigured and every battle would fail at signing.
 * This runs the same steps once per instance, on the first request, and every request
 * waits for it. It never throws: reads must keep being served when signing is broken,
 * exactly as on a long-running server.
 */
let ready: Promise<void> | undefined;

export function ensureBattleRuntime(): Promise<void> {
    ready ??= setUp();
    return ready;
}

async function setUp(): Promise<void> {
    if (!env.battle.enabled) return;
    try {
        await configureSigner(Math.floor(Date.now() / 1000));
        const failure = signerBackendError();
        if (failure) {
            console.error(`[battle-signer] NOT CONFIGURED: ${failure}`);
        }
        await loadPersistedSigningKeys();
    } catch (error) {
        console.error(`[battle-signer] serverless setup failed: ${(error as Error).message}`);
    }
}

/** For tests: forget the cached setup so the next call runs it again. */
export function resetBattleRuntimeForTests(): void {
    ready = undefined;
}
