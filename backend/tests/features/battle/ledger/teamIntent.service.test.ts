import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ethers } from 'ethers';

import { hashTeamBattleIntent, teamBattleIntentTypedData } from '@cryptopets/protocol';

vi.mock('@config/prisma', () => ({
    prisma: {
        battleIntent: { create: vi.fn() },
        defensePlan: { findUnique: vi.fn() },
        sessionDelegation: { findMany: vi.fn() },
    },
}));

vi.mock('@config/env', () => ({
    env: { battle: { deploymentId: 'base-sepolia-live', chainIds: ['eip155:84532', 'solana:devnet'] } },
}));

vi.mock('@repositories/roster.repository', () => ({ getPetById: vi.fn() }));

import { prisma } from '@config/prisma';
import { submitTeamBattleIntent, type TeamBattleIntentWire, toProtocolTeamIntent } from '@features/battle/ledger';
import { getPetById } from '@repositories/roster.repository';

/** A throwaway deterministic wallet, so the signatures checked here are real ones. */
const wallet = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const ATTACKER = wallet.address.toLowerCase();
const DEFENDER = '0x2222222222222222222222222222222222222222';
const PLAN = `0x${'77'.repeat(32)}`;
const NOW = 1893456000;

const wire: TeamBattleIntentWire = {
    chainId: 'eip155:84532',
    deploymentId: 'base-sepolia-live',
    attackerOwner: ATTACKER,
    attackers: [
        { petId: '11', col: 2, row: 1, tactic: 'focus' },
        { petId: '12', col: 1, row: 1, tactic: 'breaker' },
        { petId: '13', col: 1, row: 2, tactic: 'hunter' },
    ],
    defenderOwner: DEFENDER,
    defensePlanHash: PLAN,
    challengeId: null,
    clientNonce: '01hq8z0000000000000000',
    rulesetHash: `0x${'cd'.repeat(32)}`,
    expiresAt: NOW + 300,
};

async function sign(intent: TeamBattleIntentWire, signer: ethers.Wallet = wallet): Promise<string> {
    const typed = teamBattleIntentTypedData(toProtocolTeamIntent(intent));
    return signer.signTypedData(typed.domain, typed.types as never, typed.message);
}

async function submit(overrides: Partial<TeamBattleIntentWire> = {}, extras: { signature?: string; wallet?: string; sessionKey?: string } = {}) {
    const intent = { ...wire, ...overrides };
    return submitTeamBattleIntent({
        intent,
        signature: extras.signature ?? (await sign(intent)),
        signatureFormat: 'eip712',
        ...(extras.sessionKey ? { sessionKey: extras.sessionKey } : {}),
        authenticatedWallet: extras.wallet ?? ATTACKER,
        nowSeconds: NOW,
    });
}

const LIVE_PLAN = { chainId: 'eip155:84532', deploymentId: 'base-sepolia-live', defenderOwner: DEFENDER, revokedAt: null };

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPetById).mockImplementation((async (_chain: string, petId: string) => ({ petId, owner: ATTACKER })) as never);
    vi.mocked(prisma.defensePlan.findUnique).mockResolvedValue(LIVE_PLAN as never);
    vi.mocked(prisma.battleIntent.create).mockResolvedValue({} as never);
});

describe('a valid team intent', () => {
    it('is recorded as a team intent, with its placements and plan and no duel pet columns', async () => {
        const result = await submit();
        expect(result).toEqual({ ok: true, intentHash: hashTeamBattleIntent(toProtocolTeamIntent(wire)) });
        const { data } = vi.mocked(prisma.battleIntent.create).mock.calls[0]?.[0] as { data: Record<string, unknown> };
        expect(data).toMatchObject({ kind: 'team', attackers: wire.attackers, defensePlanHash: PLAN });
        expect(data).not.toHaveProperty('attackerPetId');
        expect(data).not.toHaveProperty('defenderPetId');
    });
});

describe('refusals', () => {
    it.each([
        ['two attackers', { attackers: wire.attackers.slice(0, 2) }, 'malformed-intent'],
        ['another deployment', { deploymentId: 'base-mainnet-live' }, 'wrong-deployment'],
        ['an expired intent', { expiresAt: NOW }, 'intent-expired'],
    ] as const)('refuses %s', async (_name, overrides, reason) => {
        // A dummy signature: these are refused before any signature is checked.
        expect(await submit(overrides as Partial<TeamBattleIntentWire>, { signature: '0x00' })).toMatchObject({ ok: false, reason });
    });

    it('refuses a wallet challenging its own plan (D7)', async () => {
        expect(await submit({ defenderOwner: ATTACKER })).toMatchObject({ ok: false, reason: 'same-owner' });
    });

    it('refuses another wallet submitting it, and a signature that is not the attacker', async () => {
        expect(await submit({}, { wallet: DEFENDER })).toMatchObject({ ok: false, reason: 'wallet-mismatch' });
        const other = ethers.Wallet.createRandom() as unknown as ethers.Wallet;
        expect(await submit({}, { signature: await sign(wire, other) })).toMatchObject({ ok: false, reason: 'bad-signature' });
    });

    it('refuses an attacking pet the attacker does not own', async () => {
        vi.mocked(getPetById).mockImplementation((async (_chain: string, petId: string) =>
            petId === '13' ? { petId, owner: DEFENDER } : { petId, owner: ATTACKER }) as never);
        expect(await submit()).toMatchObject({ ok: false, reason: 'not-pet-owner' });
    });

    it('refuses a plan that does not exist, is not the defender, or was withdrawn', async () => {
        vi.mocked(prisma.defensePlan.findUnique).mockResolvedValue(null);
        expect(await submit()).toMatchObject({ ok: false, reason: 'unknown-plan' });

        vi.mocked(prisma.defensePlan.findUnique).mockResolvedValue({ ...LIVE_PLAN, defenderOwner: '0x3333333333333333333333333333333333333333' } as never);
        expect(await submit()).toMatchObject({ ok: false, reason: 'unknown-plan' });

        vi.mocked(prisma.defensePlan.findUnique).mockResolvedValue({ ...LIVE_PLAN, revokedAt: new Date(0) } as never);
        expect(await submit()).toMatchObject({ ok: false, reason: 'plan-revoked' });
        expect(prisma.battleIntent.create).not.toHaveBeenCalled();
    });

    it('reports a reused nonce as a replay, as for duels', async () => {
        vi.mocked(prisma.battleIntent.create).mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['client_nonce'] } }));
        expect(await submit()).toMatchObject({ ok: false, reason: 'nonce-already-used' });
    });
});

describe('delegated session signing', () => {
    const session = new ethers.Wallet('0x' + '11'.repeat(32));
    const SESSION_KEY = session.address.toLowerCase();
    const delegation = {
        delegationHash: `0x${'cd'.repeat(32)}`,
        chainId: 'eip155:84532',
        deploymentId: 'base-sepolia-live',
        owner: ATTACKER,
        sessionKey: SESSION_KEY,
        scope: 'battle-intent',
        notBefore: BigInt(NOW - 10),
        expiresAt: BigInt(NOW + 3600),
        revocationNonce: 0,
    };

    it('accepts a team intent signed by a key the attacker delegated to', async () => {
        vi.mocked(prisma.sessionDelegation.findMany).mockResolvedValue([delegation] as never);
        expect(await submit({}, { signature: await sign(wire, session), sessionKey: SESSION_KEY })).toMatchObject({ ok: true });
    });

    it('refuses the key once no delegation covers it', async () => {
        vi.mocked(prisma.sessionDelegation.findMany).mockResolvedValue([] as never);
        expect(await submit({}, { signature: await sign(wire, session), sessionKey: SESSION_KEY })).toMatchObject({
            ok: false,
            reason: 'session-not-authorized',
        });
    });
});
