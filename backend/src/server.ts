import './register-path-aliases';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import app from './app';
import {
    configureSigner,
    listSigningKeys,
    loadPersistedSigningKeys,
    signerBackendError,
} from '@features/battle/signer';
import { startSettleKeeper, stopSettleKeeper } from '@features/settle-keeper';
import { type BattleWorkerHandle, startBattleWorker } from '@features/battle/worker';
import { startBatchAnchor, stopBatchAnchor } from '@features/battle/anchor';
import { startWsChannels, stopWsChannels } from '@ws/channel';

let battleWorker: BattleWorkerHandle | undefined;

// Bind 0.0.0.0 so Render's internal health check can reach the process
// (listen(port) alone is not always reachable on their network scan).
// The callback is async because `configureSigner` now is: a KMS backend fetches its public
// key before it can describe the key it signs with. Express ignores the returned promise,
// so anything that must not be silently swallowed is handled inside.
const server = app.listen(env.port, '0.0.0.0', async () => {
    const { port } = env;
    console.log(`🚀 Backend server running on 0.0.0.0:${port}`);
    console.log(`📊 Health check: http://localhost:${port}/api/health`);
    console.log(`🔐 Auth endpoints: http://localhost:${port}/api/auth`);
    console.log(`🛡️  Protected endpoints: http://localhost:${port}/api/protected`);
    console.log(`⚔️  GraphQL endpoint: http://localhost:${port}/graphql`);

    // Every notification-only channel (battle rooms §J, chat §2) behind one upgrade
    // listener. They cannot each attach their own: Node would call all of them per
    // upgrade and every connection would be handled twice — see @ws/channel.
    startWsChannels(server);
    // Settles GameLogic battle/breed/mint requests once entropy reveals. No-op unless
    // KEEPER_ENABLED is set.
    startSettleKeeper();

    // Backend-authoritative battles (docs/battle-protocol.md §L Phase 3).
    // Selects the signing backend (refuses an in-process key in production; see
    // @features/battle/signer) and starts the outbox worker that carries accepted battles
    // through to a signed receipt.
    //
    // Both are gated on the mode, so a deployment running only the on-chain path needs no
    // signing key at all. The read routes and the public corpus stay served either way —
    // receipts already issued must remain checkable after the mode is switched off.
    if (env.battle.enabled) {
        // Awaited: a KMS backend has to fetch its public key before it can say which key it
        // signs with, so a misconfigured key fails at boot rather than on the first battle.
        await configureSigner(Math.floor(Date.now() / 1000));
        // Said out loud, because `configureSigner` records its failure and returns rather
        // than throwing: reads must keep being served either way. The cost of that choice is
        // that a deployment which cannot sign anything used to boot completely silently, and
        // only admit it once a player had fought a battle and lost the receipt at the last
        // step. The reason was in memory the whole time and nothing ever printed it.
        const signerFailure = signerBackendError();
        if (signerFailure) {
            console.error(
                `[battle-signer] NOT CONFIGURED: ${signerFailure}
` +
                    '[battle-signer] battles will be accepted and then fail at signing. ' +
                    'Run `pnpm --filter backend exec tsx scripts/diagnose-signer.ts` to see what resolved.',
            );
        } else {
            const keys = listSigningKeys()
                .map((key) => `${key.keyId} (${key.address})`)
                .join(', ');
            console.log(`[battle-signer] ready for ${env.battle.chainIds.join(', ')}: ${keys}`);
        }
        // Republishes every key this deployment has ever signed under. Without it the
        // registry is only as old as the process, and a rotated key vanishes on the next
        // deploy — making its receipts unverifiable rather than invalid (§H item 4).
        void loadPersistedSigningKeys().catch((error: unknown) =>
            console.error(`[battle-signer] could not load persisted signing keys: ${(error as Error).message}`),
        );
        // §F is a hard precondition, not a nice-to-have: the backend will not sign a receipt
        // the independent Go port has not confirmed, so an unset address does not degrade
        // verification, it stalls every battle at `computed` until it forfeits. Silence here
        // cost two rounds of diagnosis, because a stalled battle and an unreachable verifier
        // look identical from the client, which only says it is waiting.
        if (env.indexerGrpc.addr) {
            console.log(`[battle-verify] independent verifier at ${env.indexerGrpc.addr}`);
        } else {
            console.error(
                '[battle-verify] INDEXER_GRPC_ADDR is not set. Independent verification cannot run, ' +
                    'so every battle will stall after `computed` and then forfeit. ' +
                    'Check it with `pnpm --filter backend exec tsx scripts/diagnose-verifier.ts`.',
            );
        }
        battleWorker = startBattleWorker(`backend-${process.pid}`);
        // Aggregates published receipts into Merkle batches and anchors the roots (§I).
        // No-ops unless BATTLE_ANCHOR_* is configured; batches are still built either way.
        startBatchAnchor();
    } else {
        console.log('[battle] BATTLE_BACKEND_MODE_ENABLED not set; backend battle writes disabled (reads stay served)');
    }
});

/** Force-exit deadline: don't let a stuck connection block the orchestrator forever. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;

/**
 * Graceful shutdown: stop the indexer timers, stop accepting connections and
 * drain in-flight requests, then release the DB pool. The orchestrator's
 * SIGTERM (deploy, scale-down) exits cleanly instead of killing mid-upsert.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down...`);

    const forceExit = setTimeout(() => {
        console.error('[server] shutdown timed out, exiting forcefully');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref(); // don't let the failsafe itself keep the process alive

    stopSettleKeeper();
    battleWorker?.stop();
    stopBatchAnchor();
    stopWsChannels();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();

    console.log('[server] shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));

/**
 * Last safety net for a rejection nothing caught. Without a listener, Node 24 exits the
 * process, so one missed `await` takes the server down for every player. Route handlers
 * are covered by `asyncRoute`; this catches whatever slips past it, and logs it so the
 * missing handler can be found and fixed.
 */
process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled promise rejection:', reason);
});
