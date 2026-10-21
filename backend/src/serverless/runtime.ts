import { env } from '@config/env';
import { configureSigner, loadPersistedSigningKeys, signerBackendError } from '@features/battle/signer';

/**
 * The one-time setup `server.ts` does at boot, for a host with no boot.
 *
 * A serverless instance starts on its first request and never runs the `listen` callback,
 * so the battle signer would stay unconfigured and every battle would fail at signing.
 * This runs the same steps on the first request, and every request waits for it. It never
 * throws: reads must keep being served when signing is broken, exactly as on a
 * long-running server.
 *
 * A failed setup is retried, at most once per `RETRY_DELAY_MS`. A serverless instance can
 * live for a long time, so caching a failure would leave a short KMS outage at cold start
 * failing every battle on that instance until it is replaced. The delay keeps a signer
 * that is broken for good, such as one with a wrong key id, from calling KMS on every
 * request.
 */
export const RETRY_DELAY_MS = 30_000;

let ready: Promise<boolean> | undefined;
let failedAt: number | undefined;

export async function ensureBattleRuntime(now: number = Date.now()): Promise<void> {
    if (ready && failedAt !== undefined && now - failedAt >= RETRY_DELAY_MS) {
        ready = undefined;
        failedAt = undefined;
    }
    ready ??= setUp().then((ok) => {
        if (!ok) failedAt = Date.now();
        return ok;
    });
    await ready;
}

/** True when the signer is configured and the persisted keys are loaded. */
async function setUp(): Promise<boolean> {
    if (!env.battle.enabled) return true;
    try {
        await configureSigner(Math.floor(Date.now() / 1000));
        const failure = signerBackendError();
        if (failure) {
            console.error(`[battle-signer] NOT CONFIGURED: ${failure}`);
        }
        // Safe after a failure too: with no active key it publishes the stored keys without
        // retiring any, so receipts already issued stay verifiable.
        await loadPersistedSigningKeys();
        return failure === null;
    } catch (error) {
        console.error(`[battle-signer] serverless setup failed: ${(error as Error).message}`);
        return false;
    }
}

/** For tests: forget the cached setup so the next call runs it again. */
export function resetBattleRuntimeForTests(): void {
    ready = undefined;
    failedAt = undefined;
}
