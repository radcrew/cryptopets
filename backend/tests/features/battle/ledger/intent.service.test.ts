import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ethers } from 'ethers';

import { battleIntentSolanaMessage, battleIntentTypedData, hashBattleIntent } from '@cryptopets/protocol';

vi.mock('@config/prisma', () => ({
    prisma: {
        battleIntent: { create: vi.fn() },
        sessionDelegation: { findMany: vi.fn() },
    },
}));

vi.mock('@config/env', () => ({
    env: {
        battle: { deploymentId: 'base-sepolia-live', chainIds: ['eip155:84532', 'solana:devnet'] },
    },
}));

vi.mock('@repositories/roster.repository', () => ({
    getPetById: vi.fn(),
}));

import { prisma } from '@config/prisma';
import { submitBattleIntent, toProtocolIntent, verifyIntentSignature } from '@features/battle/ledger';
import { getPetById } from '@repositories/roster.repository';

/**
 * A deterministic EVM wallet, so signatures in these tests are real ones rather than
 * stubs: the point of this module is signature verification, and mocking it away would
 * leave the only interesting behaviour untested.
 */
const wallet = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const ATTACKER = wallet.address.toLowerCase();
const DEFENDER = '0x2222222222222222222222222222222222222222';

const NOW = 1893456000;

const wire = {
    chainId: 'eip155:84532',
    deploymentId: 'base-sepolia-live',
    attackerOwner: ATTACKER,
    attackerPetId: '1',
    defenderOwner: DEFENDER,
    defenderPetId: '2',
    challengeId: null,
    clientNonce: '01hq8z0000000000000000',
    rulesetHash: `0x${'ab'.repeat(32)}`,
    expiresAt: NOW + 300,
};

async function signWire(overrides: Partial<typeof wire> = {}): Promise<string> {
    const typed = battleIntentTypedData(toProtocolIntent({ ...wire, ...overrides }));
    return wallet.signTypedData(typed.domain, typed.types as never, typed.message);
}

async function submit(overrides: Partial<typeof wire> = {}, extras: Partial<Parameters<typeof submitBattleIntent>[0]> = {}) {
    const intent = { ...wire, ...overrides };
    return submitBattleIntent({
        intent,
        signature: extras.signature ?? (await signWire(overrides)),
        signatureFormat: extras.signatureFormat ?? 'eip712',
        // Only when a case supplies one: an absent `sessionKey` is what selects the
        // wallet-signed path, so passing `undefined` explicitly would not be the same test.
        ...(extras.sessionKey ? { sessionKey: extras.sessionKey } : {}),
        authenticatedWallet: extras.authenticatedWallet ?? ATTACKER,
        nowSeconds: extras.nowSeconds ?? NOW,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPetById).mockImplementation((async (_chain: string, petId: string) => ({
        petId,
        owner: petId === '1' ? ATTACKER : DEFENDER,
    })) as never);
    vi.mocked(prisma.battleIntent.create).mockResolvedValue({} as never);
});

describe('accepting a valid intent', () => {
    it('records it and returns the intent hash', async () => {
        const result = await submit();

        expect(result).toEqual({ ok: true, intentHash: hashBattleIntent(toProtocolIntent(wire)) });
        const data = vi.mocked(prisma.battleIntent.create).mock.calls[0]![0].data as Record<string, unknown>;
        expect(data).toMatchObject({
            chainId: 'eip155:84532',
            deploymentId: 'base-sepolia-live',
            attackerOwner: ATTACKER,
            attackerPetId: '1',
            defenderPetId: '2',
            clientNonce: '01hq8z0000000000000000',
            signatureFormat: 'eip712',
        });
        // Kept so a third party can be shown the attacker really asked for this battle.
        expect(typeof data.signature).toBe('string');
        expect(data.expiresAt).toBe(BigInt(wire.expiresAt));
    });

    it('accepts a checksummed authenticated wallet', async () => {
        const result = await submit({}, { authenticatedWallet: wallet.address });
        expect(result.ok).toBe(true);
    });
});

describe('signature verification', () => {
    it('rejects a signature from another wallet', async () => {
        const other = new ethers.Wallet('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');
        const typed = battleIntentTypedData(toProtocolIntent(wire));
        const signature = await other.signTypedData(typed.domain, typed.types as never, typed.message);

        const result = await submit({}, { signature });

        expect(result).toMatchObject({ ok: false, reason: 'bad-signature' });
        expect(prisma.battleIntent.create).not.toHaveBeenCalled();
    });

    it('rejects a signature over different fields', async () => {
        // The payload verified is rebuilt from the fields the client claims, so a signature
        // over a cheaper battle does not carry over to an expensive one.
        const signature = await signWire({ defenderPetId: '99' });
        const result = await submit({}, { signature });
        expect(result).toMatchObject({ ok: false, reason: 'bad-signature' });
    });

    it('rejects a malformed signature without throwing', async () => {
        const result = await submit({}, { signature: '0xnotasignature' });
        expect(result).toMatchObject({ ok: false, reason: 'bad-signature' });
    });

    it('requires the format that matches the chain', async () => {
        const result = await submit({}, { signatureFormat: 'solana-message' });
        expect(result).toMatchObject({ ok: false, reason: 'wrong-signature-format' });
    });

    it('verifies a real EIP-712 signature through the protocol payload', async () => {
        const intent = toProtocolIntent(wire);
        const signature = await signWire();
        expect(verifyIntentSignature(intent, signature, 'eip712')).toBe(true);
    });

    it('builds a Solana payload for Solana intents', async () => {
        // Not signed here (no keypair), but the payload must be the labelled message rather
        // than typed data, or a Solana wallet would be asked to sign the wrong thing.
        const solanaIntent = toProtocolIntent({
            ...wire,
            chainId: 'solana:devnet',
            attackerOwner: 'DRiP2Pn2K6fuMLKQmt5rZWyHiUZ6aK3TzhBd8ZUqzTqL',
            defenderOwner: 'GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp',
        });
        expect(battleIntentSolanaMessage(solanaIntent)).toContain('CryptoPets Battle Intent v1');
        expect(verifyIntentSignature(solanaIntent, 'not-a-signature', 'solana-message')).toBe(false);
    });
});

describe('the JWT never authorizes another wallet', () => {
    it('rejects a caller submitting for someone else', async () => {
        // §D: the token identifies the caller, the signature authorizes the battle. A
        // compromised API must not be able to spend another wallet pet cooldown.
        const result = await submit({}, { authenticatedWallet: DEFENDER });
        expect(result).toMatchObject({ ok: false, reason: 'wallet-mismatch' });
        expect(prisma.battleIntent.create).not.toHaveBeenCalled();
    });
});

describe('domain binding', () => {
    it('rejects an intent for another deployment', async () => {
        // A staging signature replayed against production lands here.
        const result = await submit({ deploymentId: 'base-sepolia-staging' });
        expect(result).toMatchObject({ ok: false, reason: 'wrong-deployment' });
    });

    it('rejects a chain this deployment does not serve', async () => {
        const result = await submit({ chainId: 'eip155:11155111' });
        expect(result).toMatchObject({ ok: false, reason: 'wrong-deployment' });
    });
});

describe('expiry', () => {
    it('rejects an expired intent', async () => {
        const result = await submit({}, { nowSeconds: wire.expiresAt });
        expect(result).toMatchObject({ ok: false, reason: 'intent-expired' });
    });

    it('accepts one that expires a second from now', async () => {
        const result = await submit({}, { nowSeconds: wire.expiresAt - 1 });
        expect(result.ok).toBe(true);
    });
});

describe('ownership', () => {
    it('rejects an attacker pet the roster does not have', async () => {
        vi.mocked(getPetById).mockResolvedValue(null as never);
        const result = await submit();
        expect(result).toMatchObject({ ok: false, reason: 'unknown-pet' });
    });

    it('rejects a pet sold between signing and submitting', async () => {
        // Ownership comes from indexed chain state, not from the signature (threat T10).
        vi.mocked(getPetById).mockImplementation((async (_chain: string, petId: string) => ({
            petId,
            owner: petId === '1' ? '0x9999999999999999999999999999999999999999' : DEFENDER,
        })) as never);
        const result = await submit();
        expect(result).toMatchObject({ ok: false, reason: 'not-pet-owner' });
    });

    it('rejects a defender whose recorded owner has changed', async () => {
        vi.mocked(getPetById).mockImplementation((async (_chain: string, petId: string) => ({
            petId,
            owner: petId === '1' ? ATTACKER : '0x8888888888888888888888888888888888888888',
        })) as never);
        const result = await submit();
        expect(result).toMatchObject({ ok: false, reason: 'not-pet-owner' });
    });

    it('does not query the roster for a request that fails earlier', async () => {
        // Cheap checks first, so spraying malformed intents does not buy free queries.
        await submit({ deploymentId: 'nope' });
        expect(getPetById).not.toHaveBeenCalled();
    });
});

describe('structural rejections', () => {
    it('rejects a malformed intent', async () => {
        // No real signature: a nonce this short cannot even be turned into a signing
        // payload, which is the point. Validation runs before signature verification.
        const result = await submit({ clientNonce: 'short' }, { signature: '0x00' });
        expect(result).toMatchObject({ ok: false, reason: 'malformed-intent' });
    });

    it('rejects a pet fighting itself', async () => {
        const result = await submit({ defenderPetId: '1', defenderOwner: ATTACKER });
        expect(result).toMatchObject({ ok: false, reason: 'self-battle' });
    });

    it('rejects two different pets of the same owner', async () => {
        // Both pets really are the attacker's, so every later check would pass: only the
        // owner comparison stands between this intent and a battle a player fights with
        // themselves for XP and drops (D7 in docs/plan-team-battles-3v3.md).
        vi.mocked(getPetById).mockImplementation((async (_chain: string, petId: string) => ({
            petId,
            owner: ATTACKER,
        })) as never);
        const result = await submit({ defenderOwner: ATTACKER });
        expect(result).toMatchObject({ ok: false, reason: 'same-owner' });
        expect(getPetById).not.toHaveBeenCalled();
    });
});

describe('nonce consumption', () => {
    it('reports a reused nonce as its own reason', async () => {
        // Worth distinguishing: a repeated nonce is a replay attempt (threat T7), while a
        // repeated intent hash is usually a client retrying a request it never saw answered.
        vi.mocked(prisma.battleIntent.create).mockRejectedValue(
            Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['client_nonce'] } }),
        );
        const result = await submit();
        expect(result).toMatchObject({ ok: false, reason: 'nonce-already-used' });
    });

    it('reports a duplicate intent hash separately', async () => {
        vi.mocked(prisma.battleIntent.create).mockRejectedValue(
            Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['intent_hash'] } }),
        );
        const result = await submit();
        expect(result).toMatchObject({ ok: false, reason: 'duplicate-intent' });
    });

    it('never upserts over an existing row', async () => {
        // Quietly merging would let a second, different payload inherit the first acceptance.
        await submit();
        const call = vi.mocked(prisma.battleIntent.create).mock.calls[0]![0] as Record<string, unknown>;
        expect(call).not.toHaveProperty('update');
    });

    it('rethrows an unexpected database error rather than hiding it as a rejection', async () => {
        vi.mocked(prisma.battleIntent.create).mockRejectedValue(new Error('connection reset'));
        await expect(submit()).rejects.toThrow(/connection reset/);
    });
});


/**
 * Delegated battle-intent signing (§D).
 *
 * The wallet approves a client-held key once; that key then signs intents, so the prompt
 * stops being per battle. The property §D exists to protect is unchanged, and these cases
 * are what hold it: the key is only ever accepted for the owner who delegated to it, and
 * only while that delegation is live. A JWT still authorizes nothing.
 */
describe('delegated session signing', () => {
    const session = new ethers.Wallet('0x' + '11'.repeat(32));
    const SESSION_KEY = session.address.toLowerCase();

    async function signAsSession(overrides: Partial<typeof wire> = {}): Promise<string> {
        const typed = battleIntentTypedData(toProtocolIntent({ ...wire, ...overrides }));
        return session.signTypedData(typed.domain, typed.types as never, typed.message);
    }

    /** A stored delegation row, as `findSessionDelegation` reads it. */
    function delegationRow(overrides: Record<string, unknown> = {}) {
        return {
            delegationHash: `0x${'cd'.repeat(32)}`,
            chainId: 'eip155:84532',
            deploymentId: 'base-sepolia-live',
            owner: ATTACKER,
            sessionKey: SESSION_KEY,
            scope: 'battle-intent',
            notBefore: BigInt(NOW - 10),
            expiresAt: BigInt(NOW + 3600),
            revocationNonce: 0,
            ...overrides,
        };
    }

    it('accepts an intent signed by a delegated key', async () => {
        vi.mocked(prisma.sessionDelegation.findMany).mockResolvedValue([delegationRow()] as never);

        const result = await submit({}, { signature: await signAsSession(), sessionKey: SESSION_KEY } as never);

        expect(result).toEqual({ ok: true, intentHash: hashBattleIntent(toProtocolIntent(wire)) });
    });

    it('refuses a key with no delegation at all', async () => {
        vi.mocked(prisma.sessionDelegation.findMany).mockResolvedValue([] as never);

        expect(await submit({}, { signature: await signAsSession(), sessionKey: SESSION_KEY } as never)).toMatchObject({
            ok: false,
            reason: 'session-not-authorized',
        });
    });

    // The check that stops one player's session key acting for another wallet: the
    // delegation names its owner, and it is compared against the intent's attacker.
    it('refuses a delegation belonging to a different owner', async () => {
        vi.mocked(prisma.sessionDelegation.findMany).mockResolvedValue([
            delegationRow({ owner: DEFENDER }),
        ] as never);

        expect(await submit({}, { signature: await signAsSession(), sessionKey: SESSION_KEY } as never)).toMatchObject({
            ok: false,
            reason: 'session-not-authorized',
        });
    });

    it('refuses an expired delegation', async () => {
        vi.mocked(prisma.sessionDelegation.findMany).mockResolvedValue([
            delegationRow({ expiresAt: BigInt(NOW - 1) }),
        ] as never);

        expect(await submit({}, { signature: await signAsSession(), sessionKey: SESSION_KEY } as never)).toMatchObject({
            ok: false,
            reason: 'session-not-authorized',
        });
    });

    // Naming a key you did not sign with buys nothing: the signature is verified against
    // the named key before the delegation is even looked up.
    it('refuses a real delegation when the wallet signed instead of the key', async () => {
        vi.mocked(prisma.sessionDelegation.findMany).mockResolvedValue([delegationRow()] as never);

        expect(await submit({}, { sessionKey: SESSION_KEY } as never)).toMatchObject({
            ok: false,
            reason: 'bad-signature',
        });
    });

    // Revoked rows are excluded in the query, so revocation takes effect immediately.
    it('only considers unrevoked delegations', async () => {
        vi.mocked(prisma.sessionDelegation.findMany).mockResolvedValue([] as never);

        await submit({}, { signature: await signAsSession(), sessionKey: SESSION_KEY } as never);

        expect(vi.mocked(prisma.sessionDelegation.findMany).mock.calls[0]![0]!.where).toMatchObject({
            owner: ATTACKER,
            sessionKey: SESSION_KEY,
            revokedAt: null,
        });
    });

    it('still accepts a wallet-signed intent, so a client with no session just prompts', async () => {
        expect(await submit()).toMatchObject({ ok: true });
        expect(prisma.sessionDelegation.findMany).not.toHaveBeenCalled();
    });
});
