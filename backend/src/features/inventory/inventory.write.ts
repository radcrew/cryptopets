import { applyXp, normalizeAccount } from '@cryptopets/protocol';

import { env } from '@config/env';
import { prisma } from '@config/prisma';
import { servedChainIdForFamily } from '@repositories/battleProgress.overlay';
import { findBalance, findDefinitionByType } from '@repositories/inventory.repository';
import { servedDeploymentId } from '@features/battle/ledger';

import { asItemEffect } from './catalog';
import { getItemCoreClient, UnconfirmedTxError } from './inventory.chain';

/**
 * Inventory writes (roadmap §4): spend a consumable, claim an earned item, grant one.
 *
 * Equipping is not here, and not by omission. `ItemCore.equip` requires `msg.sender` to be
 * the pet's owner, so the player's own wallet sends it; that is what makes an equip a
 * statement by the owner rather than by this server, and it is why gear in a battle
 * snapshot is checkable against chain state by someone who does not trust us.
 *
 * Every failure below is a named result rather than an exception, so the controller maps
 * one list of outcomes to status codes instead of pattern-matching error strings.
 */

export type WriteFailure =
    | 'writes-disabled'
    | 'unknown-item'
    | 'not-consumable'
    | 'not-held'
    | 'not-pet-owner'
    | 'unknown-pet'
    | 'unsupported-chain'
    | 'no-progress-row'
    | 'unknown-entitlement'
    | 'already-claimed'
    | 'not-admin'
    | 'pet-in-battle';

export interface UseItemResult {
    burnTxHash: string;
    level: number;
    xp: number;
    readyAt: number;
    leveledUp: boolean;
}

/**
 * Spends one consumable on one of the caller's pets.
 *
 * Ordering is burn-then-apply, and the direction matters. If the burn lands and the apply
 * fails, the player has lost an item and gained nothing, which is bad. If the apply landed
 * first and the burn failed, the player would keep the item *and* the effect, which is a
 * repeatable exploit rather than a bad afternoon. The burn is also what ItemCore's own
 * doc comment calls the record that the effect was spent, so a spend with no burn is a
 * spend with no record.
 *
 * The failed-apply case is logged loudly with everything needed to make it right by hand.
 * Making it automatic means an outbox, which is worth building when the volume justifies
 * it and is not worth pretending to have now.
 */
export async function useItem(
    chain: string,
    caller: string,
    petId: string,
    itemType: string,
): Promise<UseItemResult | WriteFailure> {
    const client = getItemCoreClient();
    if (!client) {
        return 'writes-disabled';
    }

    const owner = normalizeAccount(caller);
    const definition = await findDefinitionByType(itemType);
    if (!definition) {
        return 'unknown-item';
    }
    const effect = asItemEffect(definition.effect);
    if (definition.category !== 'consumable' || !effect || effect.kind === 'stat_bonus') {
        return 'not-consumable';
    }

    // Checked before the burn as a courtesy, not as the guard. ItemCore reverts on an
    // insufficient balance regardless, which is the check that actually holds under two
    // concurrent requests for the same last potion.
    const balance = await findBalance(chain, owner, itemType);
    if (!balance || balance.quantity <= 0n) {
        return 'not-held';
    }

    const pet = await prisma.petRoster.findUnique({
        where: { chain_petId: { chain, petId } },
        select: { owner: true, level: true, winCount: true, lossCount: true },
    });
    if (!pet) {
        return 'unknown-pet';
    }
    if (normalizeAccount(pet.owner) !== owner) {
        return 'not-pet-owner';
    }

    const chainId = servedChainIdForFamily(chain as never);
    if (!chainId) {
        return 'unsupported-chain';
    }

    // A battle writes the pet's level and XP when it signs, from what was frozen at acceptance,
    // so an XP grant landing mid-battle would be overwritten and the item wasted. Refused before
    // the burn, so the item is kept.
    const lock = await prisma.petBattleLock.findUnique({ where: { chainId_petId: { chainId, petId } }, select: { battleId: true } });
    if (lock) {
        return 'pet-in-battle';
    }

    const burnTxHash = await client.burnFrom(owner, itemType, 1);

    try {
        const progress = await applyEffect(chainId, petId, effect, pet);
        return { burnTxHash, ...progress };
    } catch (error) {
        console.error(
            `[inventory] burned item ${itemType} from ${owner} (tx ${burnTxHash}) but failed to apply its effect to pet ${petId}; the player is owed this effect`,
            error,
        );
        throw error;
    }
}

type EffectTarget = { level: number; winCount: number; lossCount: number };

async function applyEffect(
    chainId: string,
    petId: string,
    effect: Exclude<ReturnType<typeof asItemEffect>, null> & { kind: 'grant_xp' | 'clear_battle_cooldown' },
    pet: EffectTarget,
): Promise<{ level: number; xp: number; readyAt: number; leveledUp: boolean }> {
    const deploymentId = servedDeploymentId();
    const key = { chainId_deploymentId_petId: { chainId, deploymentId, petId } };

    // Seeded from on-chain level the same way a pet's first battle seeds it, so a
    // level-40 pet that has never fought does not start its progression at level 1.
    const existing = await prisma.petBattleProgress.findUnique({ where: key });
    const current = existing ?? {
        level: pet.level,
        xp: 0,
        winCount: pet.winCount,
        lossCount: pet.lossCount,
        readyAt: 0n,
    };

    if (effect.kind === 'clear_battle_cooldown') {
        const row = await prisma.petBattleProgress.upsert({
            where: key,
            create: { chainId, deploymentId, petId, ...withoutReadyAt(current), readyAt: 0n },
            update: { readyAt: 0n },
        });
        return { level: row.level, xp: row.xp, readyAt: Number(row.readyAt), leveledUp: false };
    }

    // Level cap and threshold curve come from the combat engine rather than being
    // restated here: an XP grant has to move a pet exactly the way a battle would, or a
    // potion and a fight would disagree about what level 12 means.
    const next = applyXp({ level: current.level, xp: current.xp }, effect.amount);
    const row = await prisma.petBattleProgress.upsert({
        where: key,
        create: { chainId, deploymentId, petId, ...withoutReadyAt(current), level: next.level, xp: next.xp, readyAt: current.readyAt },
        update: { level: next.level, xp: next.xp },
    });
    return { level: row.level, xp: row.xp, readyAt: Number(row.readyAt), leveledUp: next.leveledUp };
}

function withoutReadyAt(state: { level: number; xp: number; winCount: number; lossCount: number }) {
    return { level: state.level, xp: state.xp, winCount: state.winCount, lossCount: state.lossCount };
}

export interface ClaimResult {
    mintTxHash: string;
    itemType: string;
    quantity: number;
}

/**
 * Mints an entitlement the caller has earned.
 *
 * Claimed-then-minted would let a crash between the two lose the item; minted-then-claimed
 * risks minting twice if the mark fails. This takes the second and makes it safe by
 * conditioning the mark on the row still being unclaimed, so a double call mints at most
 * once: the loser's update matches no row and it stops before sending anything.
 */
export async function claimEntitlement(caller: string, entitlementId: string): Promise<ClaimResult | WriteFailure> {
    const client = getItemCoreClient();
    if (!client) {
        return 'writes-disabled';
    }

    const owner = normalizeAccount(caller);
    const entitlement = await prisma.itemEntitlement.findUnique({ where: { id: entitlementId } });
    // A row belonging to someone else reads as absent, so an id cannot be probed for
    // existence by whether the error changes.
    if (!entitlement || normalizeAccount(entitlement.owner) !== owner) {
        return 'unknown-entitlement';
    }
    if (entitlement.claimedAt) {
        return 'already-claimed';
    }

    // Claims the row first, conditioned on it still being unclaimed. Two concurrent calls
    // both pass the read above; only one updates a row here, and the other sees zero.
    const claimed = await prisma.itemEntitlement.updateMany({
        where: { id: entitlementId, claimedAt: null },
        data: { claimedAt: new Date() },
    });
    if (claimed.count === 0) {
        return 'already-claimed';
    }

    try {
        const mintTxHash = await client.mintTo(owner, entitlement.itemType, entitlement.quantity);
        await prisma.itemEntitlement.update({ where: { id: entitlementId }, data: { txHash: mintTxHash } });
        return { mintTxHash, itemType: entitlement.itemType, quantity: entitlement.quantity };
    } catch (error) {
        if (error instanceof UnconfirmedTxError) {
            // Broadcast, outcome unknown, so the claim stays claimed. Releasing here would
            // be the double-mint: the transaction is very likely mined, and a retry would
            // send a second one. The hash is recorded so the row names the transaction to
            // reconcile against, and so the `txHash: null` guard below keeps meaning what
            // it says. Costs at most one item stuck pending until someone looks.
            await prisma.itemEntitlement.update({ where: { id: entitlementId }, data: { txHash: error.hash } });
            console.error(
                `[inventory] entitlement ${entitlementId} broadcast mint ${error.hash} but could not confirm it; left claimed to avoid a double mint, reconcile by hand`,
                error.cause,
            );
            throw error;
        }
        // Released, so a failed mint is retryable rather than a permanently burned claim.
        // Safe only for the failures that definitely moved nothing: a simulate revert, a
        // send that never left, or a receipt that came back reverted. `UnconfirmedTxError`
        // is the one that does not qualify, and it returned above.
        await prisma.itemEntitlement.updateMany({
            where: { id: entitlementId, txHash: null },
            data: { claimedAt: null },
        });
        throw error;
    }
}

export interface GrantResult {
    entitlementId: string;
    owner: string;
    itemType: string;
    quantity: number;
}

/**
 * Creates an entitlement for any wallet. Admin only.
 *
 * Grants an entitlement rather than minting directly, so an admin grant and a battle drop
 * reach a player's bag by the same path and there is one place where a mint can go wrong.
 * It also means the recipient pays attention: an item appears when they claim it, not
 * silently.
 */
export async function grantItem(
    caller: string,
    chain: string,
    owner: string,
    itemType: string,
    quantity: number,
): Promise<GrantResult | WriteFailure> {
    if (!isAdmin(caller)) {
        return 'not-admin';
    }

    const definition = await findDefinitionByType(itemType);
    if (!definition) {
        return 'unknown-item';
    }

    const recipient = normalizeAccount(owner);
    // A fresh reference per grant, so repeated grants of the same item to the same wallet
    // are separate entitlements rather than one deduplicated by the unique key that keeps
    // battle drops idempotent.
    const sourceRef = `admin:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const created = await prisma.itemEntitlement.create({
        data: { chain, owner: recipient, itemType, quantity, source: 'admin_grant', sourceRef },
    });

    console.warn(`[inventory] ${caller} granted ${quantity}x item ${itemType} to ${recipient} (${created.id})`);
    return { entitlementId: created.id, owner: recipient, itemType, quantity };
}

/**
 * Whether a wallet may grant items.
 *
 * An allowlist that is empty by default, so the route is closed until someone is named
 * rather than open until someone is excluded.
 */
export function isAdmin(caller: string): boolean {
    return env.inventory.adminWallets.has(normalizeAccount(caller));
}
