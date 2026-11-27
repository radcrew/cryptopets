import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ethers } from 'ethers';

vi.mock('@config/prisma', () => ({
    prisma: {
        battleLedger: { findUnique: vi.fn() },
        battleCommitment: { findUnique: vi.fn() },
        battleReceipt: { findUnique: vi.fn() },
        battleRuleset: { findMany: vi.fn(), findUnique: vi.fn() },
    },
}));

vi.mock('@features/battle/signer', () => ({
    listSigningKeys: vi.fn(),
}));

import { prisma } from '@config/prisma';
import {
    getBattleStateSummary,
    getCombatLog,
    getRuleset,
    getSignedCommitment,
    getSignedReceipt,
    listActiveSigningKeys,
    listRulesets,
    verifyReceiptSignature,
} from '@features/battle/ledger';
import { listSigningKeys } from '@features/battle/signer';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getBattleStateSummary', () => {
    it('returns null for an unknown battle', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue(null);
        expect(await getBattleStateSummary('missing')).toBeNull();
    });

    it('projects the ledger row without the internal-only fields', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({
            battleId: 'btl_1',
            chainId: 'eip155:84532',
            deploymentId: 'base-sepolia-live',
            state: 'signed',
            failureReason: null,
            kind: 'duel',
            attackerPetId: '1',
            attackerOwner: '0xabc',
            defenderPetId: '2',
            defenderOwner: '0xdef',
            drawn: null,
            rulesetHash: `0x${'11'.repeat(32)}`,
            seed: '0xsecret-ish-but-not-really',
            createdAt: new Date('2026-07-26T00:00:00.000Z'),
            updatedAt: new Date('2026-07-26T00:05:00.000Z'),
        } as never);

        const summary = await getBattleStateSummary('btl_1');

        expect(summary).toEqual({
            battleId: 'btl_1',
            chainId: 'eip155:84532',
            deploymentId: 'base-sepolia-live',
            state: 'signed',
            failureReason: null,
            kind: 'duel',
            attackerPetId: '1',
            attackerOwner: '0xabc',
            defenderPetId: '2',
            defenderOwner: '0xdef',
            rulesetHash: `0x${'11'.repeat(32)}`,
            createdAt: '2026-07-26T00:00:00.000Z',
            updatedAt: '2026-07-26T00:05:00.000Z',
        });
        expect(summary).not.toHaveProperty('seed');
    });
});

describe('getSignedCommitment', () => {
    it('returns null when no commitment exists yet', async () => {
        vi.mocked(prisma.battleCommitment.findUnique).mockResolvedValue(null);
        expect(await getSignedCommitment('btl_1')).toBeNull();
    });

    it('returns the commitment exactly as delivered at accept time', async () => {
        // The player's own copy is the evidence for commit-before-reveal; this endpoint has to
        // serve the identical payload or a re-fetch after a lost localStorage entry is useless.
        vi.mocked(prisma.battleCommitment.findUnique).mockResolvedValue({
            commitmentHash: `0x${'22'.repeat(32)}`,
            signature: '0xsig',
            signingKeyId: 'battle-signer-2026-07',
            payload: { battleId: 'btl_1' },
        } as never);

        expect(await getSignedCommitment('btl_1')).toEqual({
            hash: `0x${'22'.repeat(32)}`,
            signature: '0xsig',
            signingKeyId: 'battle-signer-2026-07',
            payload: { battleId: 'btl_1' },
        });
    });
});

describe('getSignedReceipt', () => {
    it('returns null before signing completes', async () => {
        vi.mocked(prisma.battleReceipt.findUnique).mockResolvedValue(null);
        expect(await getSignedReceipt('btl_1')).toBeNull();
    });

    it('returns the signed receipt', async () => {
        vi.mocked(prisma.battleReceipt.findUnique).mockResolvedValue({
            receiptHash: `0x${'33'.repeat(32)}`,
            signature: '0xsig',
            signingKeyId: 'battle-signer-2026-07',
            payload: { battleId: 'btl_1' },
        } as never);
        expect(await getSignedReceipt('btl_1')).toMatchObject({ hash: `0x${'33'.repeat(32)}` });
    });
});

describe('getCombatLog', () => {
    it('returns null before the fight has been computed', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({
            combatLog: null,
            combatLogHash: null,
        } as never);
        expect(await getCombatLog('btl_1')).toBeNull();
    });

    it('serves the log alongside its hash, so a client checks it the same way the verifier does', async () => {
        vi.mocked(prisma.battleLedger.findUnique).mockResolvedValue({
            combatLog: [{ round: 0 }],
            combatLogHash: `0x${'44'.repeat(32)}`,
        } as never);
        expect(await getCombatLog('btl_1')).toEqual({
            combatLogHash: `0x${'44'.repeat(32)}`,
            log: [{ round: 0 }],
        });
    });
});

describe('listActiveSigningKeys', () => {
    it('delegates to the signer registry', () => {
        vi.mocked(listSigningKeys).mockReturnValue([{ keyId: 'a' } as never]);
        expect(listActiveSigningKeys()).toEqual([{ keyId: 'a' }]);
    });
});

describe('rulesets', () => {
    it('lists published rulesets newest-version first', async () => {
        vi.mocked(prisma.battleRuleset.findMany).mockResolvedValue([
            {
                rulesetHash: `0x${'55'.repeat(32)}`,
                version: 1,
                engineId: 'cryptopets-combat-ts',
                engineVersion: 1,
                publishedAt: new Date('2026-07-01T00:00:00.000Z'),
                retiredAt: null,
            },
        ] as never);
        const rulesets = await listRulesets();
        expect(vi.mocked(prisma.battleRuleset.findMany).mock.calls[0]![0]).toMatchObject({
            orderBy: { version: 'desc' },
        });
        expect(rulesets[0]).toMatchObject({ version: 1, retiredAt: null });
    });

    it('returns null for an unpublished ruleset hash', async () => {
        vi.mocked(prisma.battleRuleset.findUnique).mockResolvedValue(null);
        expect(await getRuleset(`0x${'99'.repeat(32)}`)).toBeNull();
    });

    it('includes the full bundle for a known ruleset, so a client can replay against it', async () => {
        vi.mocked(prisma.battleRuleset.findUnique).mockResolvedValue({
            rulesetHash: `0x${'55'.repeat(32)}`,
            version: 1,
            engineId: 'cryptopets-combat-ts',
            engineVersion: 1,
            publishedAt: new Date('2026-07-01T00:00:00.000Z'),
            retiredAt: null,
            bundle: { skillConfig: {} },
        } as never);
        const ruleset = await getRuleset(`0x${'55'.repeat(32)}`);
        expect(ruleset?.bundle).toEqual({ skillConfig: {} });
    });
});

describe('verifyReceiptSignature', () => {
    const wallet = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
    const receiptHash = `0x${'66'.repeat(32)}` as const;

    it('reports not-found for an unknown receipt', async () => {
        vi.mocked(prisma.battleReceipt.findUnique).mockResolvedValue(null);
        expect(await verifyReceiptSignature(receiptHash)).toMatchObject({ ok: false, reason: 'not-found' });
    });

    it('reports unknown-signing-key when the key is not in the published registry', async () => {
        vi.mocked(prisma.battleReceipt.findUnique).mockResolvedValue({
            receiptHash,
            signingKeyId: 'some-other-key',
            signature: '0xsig',
            payload: {},
        } as never);
        vi.mocked(listSigningKeys).mockReturnValue([]);
        expect(await verifyReceiptSignature(receiptHash)).toMatchObject({ ok: false, reason: 'unknown-signing-key' });
    });

    it('verifies a real signature against the recorded key address', async () => {
        const signature = wallet.signingKey.sign(receiptHash).serialized;
        vi.mocked(prisma.battleReceipt.findUnique).mockResolvedValue({
            receiptHash,
            signingKeyId: 'battle-signer-test',
            signature,
            payload: { battleId: 'btl_1' },
        } as never);
        vi.mocked(listSigningKeys).mockReturnValue([
            { keyId: 'battle-signer-test', address: wallet.address.toLowerCase() } as never,
        ]);

        expect(await verifyReceiptSignature(receiptHash)).toEqual({ ok: true, receiptHash });
    });

    it('rejects a signature that does not recover to the claimed key', async () => {
        const other = new ethers.Wallet('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');
        const signature = other.signingKey.sign(receiptHash).serialized;
        vi.mocked(prisma.battleReceipt.findUnique).mockResolvedValue({
            receiptHash,
            signingKeyId: 'battle-signer-test',
            signature,
            payload: { battleId: 'btl_1' },
        } as never);
        vi.mocked(listSigningKeys).mockReturnValue([
            { keyId: 'battle-signer-test', address: wallet.address.toLowerCase() } as never,
        ]);

        expect(await verifyReceiptSignature(receiptHash)).toMatchObject({ ok: false, reason: 'bad-signature' });
    });

    it('rejects a malformed signature without throwing', async () => {
        vi.mocked(prisma.battleReceipt.findUnique).mockResolvedValue({
            receiptHash,
            signingKeyId: 'battle-signer-test',
            signature: '0xnotasignature',
            payload: {},
        } as never);
        vi.mocked(listSigningKeys).mockReturnValue([
            { keyId: 'battle-signer-test', address: wallet.address.toLowerCase() } as never,
        ]);
        expect(await verifyReceiptSignature(receiptHash)).toMatchObject({ ok: false, reason: 'bad-signature' });
    });

    it('rejects a non-object stored payload', async () => {
        const signature = wallet.signingKey.sign(receiptHash).serialized;
        vi.mocked(prisma.battleReceipt.findUnique).mockResolvedValue({
            receiptHash,
            signingKeyId: 'battle-signer-test',
            signature,
            payload: null,
        } as never);
        vi.mocked(listSigningKeys).mockReturnValue([
            { keyId: 'battle-signer-test', address: wallet.address.toLowerCase() } as never,
        ]);
        expect(await verifyReceiptSignature(receiptHash)).toMatchObject({ ok: false, reason: 'malformed-payload' });
    });

    it('does not itself replay the fight or check the drand signature', async () => {
        // This is the boundary that matters: passing this check is necessary, not sufficient.
        // The standalone verifier (no backend access) is what actually re-runs the battle.
        const signature = wallet.signingKey.sign(receiptHash).serialized;
        vi.mocked(prisma.battleReceipt.findUnique).mockResolvedValue({
            receiptHash,
            signingKeyId: 'battle-signer-test',
            signature,
            payload: { seed: 'anything-goes-here-this-check-does-not-look' },
        } as never);
        vi.mocked(listSigningKeys).mockReturnValue([
            { keyId: 'battle-signer-test', address: wallet.address.toLowerCase() } as never,
        ]);
        expect(await verifyReceiptSignature(receiptHash)).toMatchObject({ ok: true });
    });
});
