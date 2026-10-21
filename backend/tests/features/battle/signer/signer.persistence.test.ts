import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
    isProduction: false,
    // The signer builds one backend per served chain family (§G), so the chain list is now
    // part of what configures it. One EVM chain here: a single-domain deployment, which is
    // what every deployment is today.
    battle: { chainIds: ['eip155:84532'] as string[] },
    battleSigner: {
        keyId: 'battle-signer-test',
        privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as string | undefined,
        kmsProvider: undefined as string | undefined,
        kmsKeyId: undefined as string | undefined,
        kmsRegion: undefined as string | undefined,
        requiredAttesters: ['typescript-engine'] as string[],
        domains: {
            evm: {} as { keyId?: string; privateKey?: string; kmsKeyId?: string },
            solana: {} as { keyId?: string; privateKey?: string; kmsKeyId?: string },
        },
    },
}));

vi.mock('@config/env', () => ({ env: envMock }));
vi.mock('@config/prisma', () => ({
    prisma: {
        battleSigningKey: { upsert: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
        // Read by `retireInactiveKeys`, which dates a rotated key from its last receipt.
        battleReceipt: { findFirst: vi.fn() },
    },
}));

import { prisma } from '@config/prisma';
import {
    activeSigningKey,
    configureSigner,
    listSigningKeys,
    loadPersistedSigningKeys,
    resetSigner,
} from '@features/battle/signer';

/** When this deployment first started signing — well before any of the restarts below. */
const FIRST_BOOT = 1_700_000_000;
const MUCH_LATER = FIRST_BOOT + 90_000;

function storedRow(overrides: Record<string, unknown> = {}) {
    return {
        keyId: 'battle-signer-test',
        algorithm: 'secp256k1',
        publicKey: `0x04${'11'.repeat(64)}`,
        address: `0x${'ab'.repeat(20)}`,
        notBefore: BigInt(FIRST_BOOT),
        notAfter: null,
        compromised: false,
        ...overrides,
    };
}

/**
 * `battleSigningKey.findMany` now serves two different queries.
 *
 * `retireInactiveKeys` asks for keys that have stopped signing; `loadSigningKeys` asks for
 * all of them. An argument-blind mock would answer both with the same rows and hand the
 * retirement pass the *active* key, which it would then close the window on — a failure
 * invented entirely by the mock. Dispatching on the query keeps each answer honest.
 */
function mockStoredKeys(rows: unknown[]): void {
    vi.mocked(prisma.battleSigningKey.findMany).mockImplementation((async (args: {
        where?: { notAfter?: unknown };
    }) => (args?.where?.notAfter === null ? [] : rows)) as never);
}

beforeEach(() => {
    vi.clearAllMocks();
    resetSigner();
    vi.mocked(prisma.battleSigningKey.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.battleSigningKey.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.battleReceipt.findFirst).mockResolvedValue(null as never);
    mockStoredKeys([]);
});

describe('a restart must not move the active key validity window forward', () => {
    it('adopts the persisted notBefore instead of this process start time', async () => {
        // Second boot: configureSigner stamps "now", but the key really became valid at
        // FIRST_BOOT and every receipt signed since then was signed under it.
        await configureSigner(MUCH_LATER);
        expect(activeSigningKey('eip155:84532')?.notBefore).toBe(MUCH_LATER);

        mockStoredKeys([storedRow()]);
        await loadPersistedSigningKeys();

        expect(activeSigningKey('eip155:84532')?.notBefore).toBe(FIRST_BOOT);
    });

    it('keeps a receipt signed before the restart inside the published window', async () => {
        const signedAt = FIRST_BOOT + 500; // long before this boot

        await configureSigner(MUCH_LATER);
        mockStoredKeys([storedRow()]);
        await loadPersistedSigningKeys();

        const published = listSigningKeys().find((k) => k.keyId === 'battle-signer-test')!;
        // The check a verifier runs: was the key valid when the receipt was created?
        expect(signedAt).toBeGreaterThanOrEqual(published.notBefore);
    });

    it('leaves a genuinely new key at its own start time', async () => {
        // Nothing stored yet, so "now" is the truth rather than an artefact of restarting.
        await configureSigner(MUCH_LATER);
        mockStoredKeys([]);
        await loadPersistedSigningKeys();

        expect(activeSigningKey('eip155:84532')?.notBefore).toBe(MUCH_LATER);
    });

    it('never moves the window earlier than the stored row claims', async () => {
        // A stored row from *after* this boot would be nonsense; prefer the earlier value
        // rather than trusting whichever number happens to be larger.
        await configureSigner(FIRST_BOOT);
        mockStoredKeys([storedRow({ notBefore: BigInt(MUCH_LATER) })]);
        await loadPersistedSigningKeys();

        expect(activeSigningKey('eip155:84532')?.notBefore).toBe(FIRST_BOOT);
    });

    it('still records the active key on boot, so it is never missing from the registry', async () => {
        await configureSigner(MUCH_LATER);
        mockStoredKeys([storedRow()]);
        await loadPersistedSigningKeys();

        expect(vi.mocked(prisma.battleSigningKey.upsert)).toHaveBeenCalledTimes(1);
    });
});

describe('a signer that failed to configure', () => {
    it('does not retire the key the deployment really signs with', async () => {
        // configureSigner failed (a KMS hiccup at startup), so nothing is active. Every
        // stored key would look "inactive", including the real one, and closing its window
        // would make every receipt it signs after recovery fail verification.
        vi.mocked(prisma.battleSigningKey.findMany).mockResolvedValue([storedRow()] as never);

        await loadPersistedSigningKeys();

        expect(vi.mocked(prisma.battleSigningKey.updateMany)).not.toHaveBeenCalled();
    });

    it('still publishes the stored keys, so issued receipts stay verifiable', async () => {
        vi.mocked(prisma.battleSigningKey.findMany).mockResolvedValue([storedRow()] as never);

        await loadPersistedSigningKeys();

        expect(listSigningKeys().map((k) => k.keyId)).toContain('battle-signer-test');
    });
});
