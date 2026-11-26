import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ethers } from 'ethers';

import { defensePlanTypedData, hashDefensePlan } from '@cryptopets/protocol';

vi.mock('@config/prisma', () => ({
    prisma: {
        defensePlan: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
        defensePlanUsage: { updateMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
        $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    },
}));

vi.mock('@config/env', () => ({
    env: { battle: { deploymentId: 'base-sepolia-live', chainIds: ['eip155:84532', 'solana:devnet'] } },
}));

vi.mock('@repositories/roster.repository', () => ({ getPetById: vi.fn() }));

import { prisma } from '@config/prisma';
import {
    consumePlanDailyBudget,
    type DefensePlanWire,
    getLiveDefensePlan,
    revokeDefensePlans,
    submitDefensePlan,
    toProtocolPlan,
} from '@features/battle/ledger';
import { getPetById } from '@repositories/roster.repository';

/** A throwaway deterministic wallet, so the signatures checked here are real ones. */
const wallet = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const DEFENDER = wallet.address.toLowerCase();
const STRANGER = '0x9999999999999999999999999999999999999999';
const RULESET = `0x${'cd'.repeat(32)}`;
const NOW = 1893456000;

const wire: DefensePlanWire = {
    chainId: 'eip155:84532',
    deploymentId: 'base-sepolia-live',
    defenderOwner: DEFENDER,
    roster: [
        { petId: '21', col: 2, row: 1, tactic: 'focus' },
        { petId: '22', col: 2, row: 0, tactic: 'bodyguard' },
        { petId: '23', col: 1, row: 1, tactic: 'breaker' },
    ],
    rulesetHash: RULESET,
    minLevel: 1,
    maxLevel: 30,
    maxBattlesPerDay: 10,
    notBefore: NOW - 3600,
    expiresAt: NOW + 86400,
    revocationNonce: 0,
};

async function sign(plan: DefensePlanWire, signer: ethers.Wallet = wallet): Promise<string> {
    const typed = defensePlanTypedData(toProtocolPlan(plan));
    return signer.signTypedData(typed.domain, typed.types as never, typed.message);
}

async function submit(overrides: Partial<DefensePlanWire> = {}, extras: { signature?: string; wallet?: string; served?: string } = {}) {
    const plan = { ...wire, ...overrides };
    return submitDefensePlan({
        plan,
        signature: extras.signature ?? (await sign(plan)),
        signatureFormat: 'eip712',
        authenticatedWallet: extras.wallet ?? DEFENDER,
        servedRulesetHash: extras.served ?? RULESET,
        nowSeconds: NOW,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPetById).mockImplementation((async (_chain: string, petId: string) => ({ petId, owner: DEFENDER })) as never);
    vi.mocked(prisma.defensePlan.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.defensePlan.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.defensePlan.create).mockResolvedValue({} as never);
});

describe('saving a plan', () => {
    it('stores a signed plan and revokes the earlier one in the same transaction', async () => {
        const result = await submit();
        expect(result).toEqual({ ok: true, planHash: hashDefensePlan(toProtocolPlan(wire)), replaced: 1 });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.defensePlan.updateMany).toHaveBeenCalledWith({
            where: { chainId: 'eip155:84532', deploymentId: 'base-sepolia-live', defenderOwner: DEFENDER, revokedAt: null },
            data: { revokedAt: new Date(NOW * 1000) },
        });
        const stored = vi.mocked(prisma.defensePlan.create).mock.calls[0]?.[0] as { data: { roster: unknown } };
        expect(stored.data.roster).toEqual(wire.roster);
    });

    it.each([
        ['two pets', { roster: wire.roster.slice(0, 2) }, 'malformed-plan'],
        ['another deployment', { deploymentId: 'base-mainnet-live' }, 'wrong-deployment'],
        ['an expired plan', { expiresAt: NOW }, 'already-expired'],
    ] as const)('refuses %s', async (_name, overrides, reason) => {
        // A dummy signature: these are refused before any signature is checked, and a malformed
        // plan cannot even be turned into typed data to sign.
        expect(await submit(overrides as Partial<DefensePlanWire>, { signature: '0x00' })).toMatchObject({ ok: false, reason });
        expect(prisma.defensePlan.create).not.toHaveBeenCalled();
    });

    it('refuses a plan for rules team battles are not served under, so it cannot replace a live one', async () => {
        expect(await submit({}, { served: `0x${'ab'.repeat(32)}` })).toMatchObject({ ok: false, reason: 'plan-ruleset-mismatch' });
        expect(prisma.defensePlan.updateMany).not.toHaveBeenCalled();
    });

    it('refuses another wallet saving it, and a signature that is not the defender', async () => {
        expect(await submit({}, { wallet: STRANGER })).toMatchObject({ ok: false, reason: 'wallet-mismatch' });
        const other = ethers.Wallet.createRandom();
        expect(await submit({}, { signature: await sign(wire, other as unknown as ethers.Wallet) })).toMatchObject({ ok: false, reason: 'bad-signature' });
    });

    it('refuses a Solana plan until Solana team battles exist', async () => {
        const result = await submitDefensePlan({
            plan: { ...wire, chainId: 'solana:devnet' },
            signature: 'x',
            signatureFormat: 'solana-message',
            authenticatedWallet: DEFENDER,
            servedRulesetHash: RULESET,
            nowSeconds: NOW,
        });
        expect(result).toMatchObject({ ok: false, reason: 'wrong-signature-format' });
    });

    it('refuses a roster pet the defender does not own, or that is not indexed', async () => {
        vi.mocked(getPetById).mockImplementation((async (_chain: string, petId: string) =>
            petId === '22' ? { petId, owner: STRANGER } : { petId, owner: DEFENDER }) as never);
        expect(await submit()).toMatchObject({ ok: false, reason: 'not-pet-owner' });

        vi.mocked(getPetById).mockImplementation((async (_chain: string, petId: string) => (petId === '23' ? null : { petId, owner: DEFENDER })) as never);
        expect(await submit()).toMatchObject({ ok: false, reason: 'unknown-pet' });
    });

    it('refuses a revocation nonce below the owner current one, so a revoked plan cannot return', async () => {
        vi.mocked(prisma.defensePlan.findFirst).mockResolvedValue({ revocationNonce: 3 } as never);
        expect(await submit({ revocationNonce: 2 })).toMatchObject({ ok: false, reason: 'stale-revocation-nonce' });
    });

    it('reports a plan saved twice as a duplicate', async () => {
        vi.mocked(prisma.defensePlan.create).mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
        expect(await submit()).toMatchObject({ ok: false, reason: 'duplicate-plan' });
    });
});

describe('reading and revoking', () => {
    it('returns the live plan, flagged stale once the served rules move', async () => {
        vi.mocked(prisma.defensePlan.findFirst).mockResolvedValue({
            planHash: '0xplan',
            roster: wire.roster,
            minLevel: 1,
            maxLevel: 30,
            maxBattlesPerDay: 10,
            notBefore: BigInt(wire.notBefore),
            expiresAt: BigInt(wire.expiresAt),
            rulesetHash: RULESET,
            createdAt: new Date(0),
        } as never);
        expect(await getLiveDefensePlan('eip155:84532', DEFENDER, RULESET)).toMatchObject({ planHash: '0xplan', isStale: false });
        expect(await getLiveDefensePlan('eip155:84532', DEFENDER, `0x${'ab'.repeat(32)}`)).toMatchObject({ isStale: true });
    });

    it('returns null for a wallet with no live plan', async () => {
        expect(await getLiveDefensePlan('eip155:84532', DEFENDER, RULESET)).toBeNull();
    });

    it('revokes every live plan for the wallet', async () => {
        vi.mocked(prisma.defensePlan.updateMany).mockResolvedValue({ count: 1 } as never);
        expect(await revokeDefensePlans('eip155:84532', DEFENDER, new Date(0))).toEqual({ revoked: 1 });
    });
});

describe('the daily budget', () => {
    it('counts one team battle and refuses past the cap', async () => {
        vi.mocked(prisma.defensePlanUsage.updateMany).mockResolvedValue({ count: 0 } as never);
        vi.mocked(prisma.defensePlanUsage.create).mockResolvedValue({} as never);
        expect(await consumePlanDailyBudget('0xplan', 3, NOW)).toEqual({ ok: true, used: 1 });

        vi.mocked(prisma.defensePlanUsage.create).mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
        expect(await consumePlanDailyBudget('0xplan', 3, NOW)).toMatchObject({ ok: false });
    });
});
