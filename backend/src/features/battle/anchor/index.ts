import { createPublicClient, createWalletClient, http, type Address, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { env } from '@config/env';
import { buildNextBatch } from '@features/battle/batcher';

import { anchorNextBatch, type AnchorContext } from './anchor.service';

export { anchorNextBatch, type AnchorContext, type AnchorOutcome } from './anchor.service';
export { BATTLE_BATCH_REGISTRY_ABI, PUBLISH_BATCH_GAS_LIMIT, ZERO_ROOT } from './abi';

/**
 * The batch-and-anchor loop (§I).
 *
 * Batching and anchoring run on one timer, in that order, because they are the two halves
 * of the same job: aggregate what is publishable, then anchor what is aggregated. Both are
 * idempotent and both no-op when there is nothing to do, so the interval only controls
 * latency, never correctness.
 *
 * Off unless configured, like the settle keepers. A deployment that has not decided its
 * batch cadence or funded an anchoring wallet should batch nothing rather than anchor on
 * defaults nobody chose.
 */

export interface BatchAnchorHandle {
    stop(): void;
}

let handle: BatchAnchorHandle | undefined;

export function startBatchAnchor(): void {
    const context = createAnchorContext();
    if (!context) return;

    const timer = setInterval(() => void runOnce(context), env.battle.anchorIntervalMs);
    timer.unref();
    handle = { stop: () => clearInterval(timer) };
    console.log(`[battle-anchor] batching and anchoring every ${env.battle.anchorIntervalMs}ms to ${context.registryAddress}`);
}

/**
 * The clients and scope one anchoring pass needs, or null when anchoring is off. Shared by
 * the timer above and by the scheduled job a serverless deployment runs instead.
 */
export function createAnchorContext(): AnchorContext | null {
    if (!env.battle.enabled) {
        return null;
    }
    const { anchorRpcUrl, anchorPrivateKey, anchorRegistryAddress, anchorChainId } = env.battle;
    if (!anchorRpcUrl || !anchorPrivateKey || !anchorRegistryAddress || !anchorChainId) {
        console.log(
            '[battle-anchor] BATTLE_ANCHOR_* not fully set; batches will still be built but never anchored ' +
                '(receipts stay signed and public either way)',
        );
        return null;
    }

    const chain = { id: anchorChainId, name: `chain-${anchorChainId}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [anchorRpcUrl] } } } as const satisfies Chain;
    const publicClient = createPublicClient({ chain, transport: http(anchorRpcUrl) });
    const walletClient = createWalletClient({
        account: privateKeyToAccount(anchorPrivateKey),
        chain,
        transport: http(anchorRpcUrl),
    });

    return {
        publicClient,
        walletClient,
        registryAddress: anchorRegistryAddress as Address,
        // The registry is per-deployment, so one scope per process. A deployment serving
        // several protocol chain ids anchors each one against its own registry.
        chainId: env.battle.chainIds[0] ?? '',
        deploymentId: env.battle.deploymentId,
    };
}

export function stopBatchAnchor(): void {
    handle?.stop();
    handle = undefined;
}

/** One pass: build whatever is batchable, then anchor whatever is unanchored. */
export async function runOnce(context: AnchorContext): Promise<void> {
    try {
        const built = await buildNextBatch({ chainId: context.chainId, deploymentId: context.deploymentId });
        if (built.status === 'batched') {
            console.log(`[battle-anchor] built batch ${built.batchNumber} over ${built.receiptCount} receipts`);
        }
    } catch (error) {
        console.error(`[battle-anchor] batching failed: ${(error as Error).message.split('\n')[0]}`);
    }

    try {
        const anchored = await anchorNextBatch(context);
        if (anchored.status === 'anchored') {
            console.log(`[battle-anchor] anchored batch ${anchored.batchNumber} in ${anchored.txHash}`);
        } else if (anchored.status === 'out-of-sync' || anchored.status === 'failed') {
            // Loud: an unanchored backlog past the inclusion SLO is operator failure (§I).
            console.error(`[battle-anchor] ${anchored.status}: ${anchored.detail}`);
        }
    } catch (error) {
        console.error(`[battle-anchor] anchoring failed: ${(error as Error).message.split('\n')[0]}`);
    }
}
