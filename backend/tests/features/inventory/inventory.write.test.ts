import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = { mintTo: vi.fn(), burnFrom: vi.fn() };
const chain = { getItemCoreClient: vi.fn(() => client as { mintTo: unknown; burnFrom: unknown } | null) };

// The error class stays real: `claimEntitlement` branches on `instanceof`, and a stub
// class would let the release path be exercised by an error the production code would
// have treated as unconfirmed.
vi.mock('@features/inventory/inventory.chain', async () => ({
    ...(await vi.importActual<typeof import('@features/inventory/inventory.chain')>(
        '@features/inventory/inventory.chain',
    )),
    getItemCoreClient: () => chain.getItemCoreClient(),
}));

const repo = { findBalance: vi.fn(), findDefinitionByType: vi.fn() };
vi.mock('@repositories/inventory.repository', () => ({
    findBalance: (c: string, o: string, t: string) => repo.findBalance(c, o, t),
    findDefinitionByType: (t: string) => repo.findDefinitionByType(t),
}));

vi.mock('@repositories/battleProgress.overlay', () => ({
    servedChainIdForFamily: vi.fn(() => 'eip155:31337'),
}));

vi.mock('@features/battle/ledger', () => ({
    servedDeploymentId: vi.fn(() => 'local'),
}));

vi.mock('@config/env', () => ({
    env: { inventory: { adminWallets: new Set(['0xadmin']) } },
}));

vi.mock('@config/prisma', () => ({
    prisma: {
        petRoster: { findUnique: vi.fn() },
        petBattleProgress: { findUnique: vi.fn(), upsert: vi.fn() },
        petBattleLock: { findUnique: vi.fn() },
        itemEntitlement: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    },
}));

import { UnconfirmedTxError } from '@features/inventory/inventory.chain';
import { claimEntitlement, grantItem, isAdmin, useItem } from '@features/inventory/inventory.write';
import { prisma } from '@config/prisma';

const OWNER = '0xaaa0000000000000000000000000000000000001';

const POTION = { itemType: '100', category: 'consumable', effect: { kind: 'grant_xp', amount: 50 } };
const DRAUGHT = { itemType: '110', category: 'consumable', effect: { kind: 'clear_battle_cooldown' } };
const BLADE = { itemType: '1', category: 'equipment', effect: { kind: 'stat_bonus', hp: 0, atk: 4, def: 0, int: 0, mdef: 0 } };

/** A held item, an owned pet, and no prior progression row. */
function happyPath(definition: unknown) {
    repo.findDefinitionByType.mockResolvedValue(definition);
    repo.findBalance.mockResolvedValue({ itemType: '100', quantity: 2n });
    vi.mocked(prisma.petRoster.findUnique).mockResolvedValue({
        owner: OWNER, level: 4, winCount: 1, lossCount: 0,
    } as never);
    vi.mocked(prisma.petBattleProgress.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.petBattleProgress.upsert).mockImplementation((async (args: {
        create?: Record<string, unknown>;
        update?: Record<string, unknown>;
    }) => ({ level: 4, xp: 0, readyAt: 0n, ...args.create, ...args.update })) as never);
    client.burnFrom.mockResolvedValue('0xburn');
}

beforeEach(() => {
    vi.clearAllMocks();
    chain.getItemCoreClient.mockReturnValue(client);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useItem', () => {
    it('burns the item and credits the XP', async () => {
        happyPath(POTION);

        const result = await useItem('evm', OWNER, '7', '100');

        expect(client.burnFrom).toHaveBeenCalledWith(OWNER, '100', 1);
        expect(result).toMatchObject({ burnTxHash: '0xburn', xp: 50, leveledUp: false });
    });

    // The threshold curve and level cap come from the combat engine, so a potion moves a
    // pet exactly the way a fight would. Level 4 crosses at 400 XP.
    it('levels a pet up on the same curve a battle uses', async () => {
        happyPath({ ...POTION, effect: { kind: 'grant_xp', amount: 400 } });

        const result = await useItem('evm', OWNER, '7', '100');

        expect(result).toMatchObject({ level: 5, xp: 0, leveledUp: true });
    });

    // A battle writes level and XP when it signs, from what it froze at acceptance, so a potion
    // drunk mid-battle would be overwritten. Refused before the burn, so the item is kept.
    it('refuses a pet that is in a battle, without burning the item', async () => {
        happyPath(POTION);
        vi.mocked(prisma.petBattleLock.findUnique).mockResolvedValueOnce({ battleId: 'btl_1' } as never);

        expect(await useItem('evm', OWNER, '7', '100')).toBe('pet-in-battle');
        expect(client.burnFrom).not.toHaveBeenCalled();
        expect(prisma.petBattleProgress.upsert).not.toHaveBeenCalled();
    });

    it('clears the backend battle cooldown', async () => {
        happyPath(DRAUGHT);

        const result = await useItem('evm', OWNER, '7', '110');

        expect(result).toMatchObject({ readyAt: 0, leveledUp: false });
        expect(vi.mocked(prisma.petBattleProgress.upsert).mock.calls[0]![0]).toMatchObject({
            update: { readyAt: 0n },
        });
    });

    // Seeded from on-chain level the way a first battle seeds it, so a level-40 pet that
    // has never fought does not restart its progression at level 1.
    it('seeds a missing progression row from the pet’s on-chain level', async () => {
        happyPath(POTION);

        await useItem('evm', OWNER, '7', '100');

        expect(vi.mocked(prisma.petBattleProgress.upsert).mock.calls[0]![0]).toMatchObject({
            create: expect.objectContaining({ level: 4 }),
        });
    });

    it('refuses equipment, which is worn rather than used', async () => {
        happyPath(BLADE);
        expect(await useItem('evm', OWNER, '7', '1')).toBe('not-consumable');
        expect(client.burnFrom).not.toHaveBeenCalled();
    });

    it('refuses an item the caller does not hold', async () => {
        happyPath(POTION);
        repo.findBalance.mockResolvedValue({ itemType: '100', quantity: 0n });
        expect(await useItem('evm', OWNER, '7', '100')).toBe('not-held');
        expect(client.burnFrom).not.toHaveBeenCalled();
    });

    it('refuses a pet the caller does not own', async () => {
        happyPath(POTION);
        vi.mocked(prisma.petRoster.findUnique).mockResolvedValue({
            owner: '0xsomeoneelse', level: 4, winCount: 0, lossCount: 0,
        } as never);
        expect(await useItem('evm', OWNER, '7', '100')).toBe('not-pet-owner');
        expect(client.burnFrom).not.toHaveBeenCalled();
    });

    it('refuses when item writes are not configured, rather than half-applying', async () => {
        chain.getItemCoreClient.mockReturnValue(null);
        expect(await useItem('evm', OWNER, '7', '100')).toBe('writes-disabled');
    });

    // Burn-then-apply is the safer failure direction: the player loses an item and gains
    // nothing, rather than keeping both the item and the effect, which repeats.
    it('checks ownership and holding before burning anything', async () => {
        happyPath(POTION);
        repo.findDefinitionByType.mockResolvedValue(null);

        expect(await useItem('evm', OWNER, '7', '999')).toBe('unknown-item');
        expect(client.burnFrom).not.toHaveBeenCalled();
    });

    it('logs the burned item when applying the effect fails, so it can be made right', async () => {
        happyPath(POTION);
        vi.mocked(prisma.petBattleProgress.upsert).mockRejectedValue(new Error('db down') as never);

        await expect(useItem('evm', OWNER, '7', '100')).rejects.toThrow('db down');
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('is owed this effect'), expect.anything());
    });
});

describe('claimEntitlement', () => {
    const ROW = { id: 'e1', owner: OWNER, itemType: '100', quantity: 2, claimedAt: null };

    it('claims the row, then mints, then records the hash', async () => {
        vi.mocked(prisma.itemEntitlement.findUnique).mockResolvedValue(ROW as never);
        vi.mocked(prisma.itemEntitlement.updateMany).mockResolvedValue({ count: 1 } as never);
        client.mintTo.mockResolvedValue('0xmint');

        const result = await claimEntitlement(OWNER, 'e1');

        expect(client.mintTo).toHaveBeenCalledWith(OWNER, '100', 2);
        expect(result).toEqual({ mintTxHash: '0xmint', itemType: '100', quantity: 2 });
        expect(prisma.itemEntitlement.update).toHaveBeenCalledWith({
            where: { id: 'e1' }, data: { txHash: '0xmint' },
        });
    });

    // Both callers pass the read; only one updates a row, and the loser stops before
    // sending anything, so a double call mints at most once.
    it('mints once when two claims race', async () => {
        vi.mocked(prisma.itemEntitlement.findUnique).mockResolvedValue(ROW as never);
        vi.mocked(prisma.itemEntitlement.updateMany).mockResolvedValue({ count: 0 } as never);

        expect(await claimEntitlement(OWNER, 'e1')).toBe('already-claimed');
        expect(client.mintTo).not.toHaveBeenCalled();
    });

    // Released rather than left claimed, so a failed mint is retryable. Safe only because
    // this failure moved nothing: a simulate revert, a send that never left, or a receipt
    // that came back reverted.
    it('releases the claim when the mint definitely did not land', async () => {
        vi.mocked(prisma.itemEntitlement.findUnique).mockResolvedValue(ROW as never);
        vi.mocked(prisma.itemEntitlement.updateMany).mockResolvedValue({ count: 1 } as never);
        client.mintTo.mockRejectedValue(new Error('rpc down'));

        await expect(claimEntitlement(OWNER, 'e1')).rejects.toThrow('rpc down');
        expect(vi.mocked(prisma.itemEntitlement.updateMany).mock.calls.at(-1)![0]).toMatchObject({
            where: { id: 'e1', txHash: null }, data: { claimedAt: null },
        });
    });

    /**
     * The failure the release must not treat like the others: broadcast, outcome unknown.
     *
     * A receipt read that times out does not mean the mint failed, it means nobody knows.
     * The transaction is very likely mined, so releasing the claim would let a retry send a
     * second mint and pay the entitlement twice.
     */
    it('keeps the claim when the mint was broadcast but could not be confirmed', async () => {
        const hash = `0x${'ab'.repeat(32)}` as const;
        vi.mocked(prisma.itemEntitlement.findUnique).mockResolvedValue(ROW as never);
        vi.mocked(prisma.itemEntitlement.updateMany).mockResolvedValue({ count: 1 } as never);
        client.mintTo.mockRejectedValue(new UnconfirmedTxError(hash, 'receipt unreadable'));

        await expect(claimEntitlement(OWNER, 'e1')).rejects.toThrow(UnconfirmedTxError);

        // Never released: the only updateMany is the claim itself, taken before the mint.
        const released = vi
            .mocked(prisma.itemEntitlement.updateMany)
            .mock.calls.filter((call) => (call[0] as { data?: { claimedAt?: unknown } }).data?.claimedAt === null);
        expect(released).toHaveLength(0);

        // The hash is recorded, so the row names the transaction to reconcile against and
        // the `txHash: null` guard on the release path keeps meaning what it says.
        expect(prisma.itemEntitlement.update).toHaveBeenCalledWith({
            where: { id: 'e1' },
            data: { txHash: hash },
        });
    });

    // 404, not 403: someone else's entitlement is indistinguishable from a missing one, so
    // an id cannot be probed by watching the answer change.
    it('reports another wallet’s entitlement as missing', async () => {
        vi.mocked(prisma.itemEntitlement.findUnique).mockResolvedValue({ ...ROW, owner: '0xother' } as never);
        expect(await claimEntitlement(OWNER, 'e1')).toBe('unknown-entitlement');
    });

    it('refuses an entitlement already claimed', async () => {
        vi.mocked(prisma.itemEntitlement.findUnique).mockResolvedValue({ ...ROW, claimedAt: new Date() } as never);
        expect(await claimEntitlement(OWNER, 'e1')).toBe('already-claimed');
    });
});

describe('grantItem', () => {
    it('refuses a caller not on the allowlist', async () => {
        expect(await grantItem(OWNER, 'evm', OWNER, '100', 1)).toBe('not-admin');
        expect(prisma.itemEntitlement.create).not.toHaveBeenCalled();
    });

    it('creates an entitlement rather than minting directly', async () => {
        repo.findDefinitionByType.mockResolvedValue(POTION);
        vi.mocked(prisma.itemEntitlement.create).mockResolvedValue({ id: 'e9' } as never);

        const result = await grantItem('0xadmin', 'evm', OWNER, '100', 3);

        expect(result).toMatchObject({ entitlementId: 'e9', owner: OWNER, quantity: 3 });
        expect(client.mintTo).not.toHaveBeenCalled();
        expect(vi.mocked(prisma.itemEntitlement.create).mock.calls[0]![0]).toMatchObject({
            data: expect.objectContaining({ source: 'admin_grant' }),
        });
    });

    it('refuses an item that is not in the catalog', async () => {
        repo.findDefinitionByType.mockResolvedValue(null);
        expect(await grantItem('0xadmin', 'evm', OWNER, '999', 1)).toBe('unknown-item');
    });
});

describe('isAdmin', () => {
    // Empty by default, so the route is closed until someone is named rather than open
    // until someone is excluded.
    it('accepts only wallets on the allowlist', () => {
        expect(isAdmin('0xadmin')).toBe(true);
        expect(isAdmin(OWNER)).toBe(false);
    });
});
