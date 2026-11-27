import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    explainItem,
    ITEM_CATEGORIES,
    getRarityColor,
    getRarityName,
    useChainCapabilities,
    useInventory,
    usePendingItems,
    usePetEquipmentForPets,
    useSpendItem,
    usePetList,
    type InventoryEntry,
    type ItemDefinition,
    type PendingItem,
} from '@shared/core';

import DashboardPanel from '@components/common/dashboard-panel';
import SessionGate from '@components/common/session-gate';
import ItemArt, { hasItemArt } from '@components/item/item-art';
import Celebration from '@components/game/celebration';
import EquipPanel from '@components/pet/interactions/panels/equip';
import PetSelect from '@components/ui/pet-select';
import Icon, { MuscleIcon, RefreshIcon } from '@components/ui/icon';
import InfoTooltip from '@components/ui/info-tooltip';
import NeonButton from '@components/ui/neon-button';
import TabSwitch from '@components/ui/tab-switch';
import ItemDetailModal from './item-detail-modal';
import { DASHBOARD_HOME } from '@constants/interactionRoutes';
import { Tones } from '@constants/tones';
import styles from './index.module.css';

/**
 * The bag (roadmap §4).
 *
 * Grouped by category rather than shown as one flat grid, because the categories are not
 * a taxonomy imposed on the items — they are what a player can *do* with one. A consumable
 * has a button, a piece of equipment goes on a pet somewhere else, and a collectible does
 * nothing at all. Sorting those together would make the screen's only question ("what can
 * I use?") the hardest one to answer.
 *
 * Rarity colour comes from `getRarityColor`, the same function the pet cards use, so the
 * five tiers mean one thing across the app rather than two.
 */

/** The selected pet's name, for the action button's accessible label. Falls back to the id
 *  rather than going silent, since the label's whole job is saying which pet. */
function petName(pets: { id: unknown; name: string }[], petId: string): string {
    return pets.find((pet) => String(pet.id) === petId)?.name ?? `pet ${petId}`;
}

/**
 * Display order: what you can act on first, what merely accumulates last.
 *
 * Derived from the shared vocabulary rather than restated, so a category added to
 * `ITEM_CATEGORIES` cannot pass backend validation, be stored, be returned by the API, and
 * then silently fail to render here because this list never heard about it.
 */
const INVENTORY_TABS = [
    { id: 'bag', label: 'Bag' },
    { id: 'equipment', label: 'Equipment' },
] as const;

const CATEGORY_RANK: Record<string, number> = {
    consumable: 0,
    equipment: 1,
    collectible: 2,
    material: 3,
};
const CATEGORY_ORDER = [...ITEM_CATEGORIES].sort(
    (a, b) => (CATEGORY_RANK[a] ?? Number.MAX_SAFE_INTEGER) - (CATEGORY_RANK[b] ?? Number.MAX_SAFE_INTEGER),
);

const CATEGORY_LABELS: Record<string, string> = {
    consumable: 'Consumables',
    equipment: 'Equipment',
    collectible: 'Collectibles',
    material: 'Materials',
};

/**
 * One inventory slot: art, with the four things worth knowing in its corners.
 *
 *   top-left      rarity           bottom-left   how many
 *   top-right     what it does     bottom-right  what you can do with it
 *
 * The whole slot opens the detail modal, but it is deliberately NOT a button. Two of those
 * corners are themselves controls, and a button inside a button is invalid and loses keyboard
 * behaviour. Instead a transparent button is stretched across the slot and the corner
 * controls are layered above it — siblings, not descendants, so each is reachable on its own
 * and the large easy target survives for everything else.
 */
const ItemTile: React.FC<{
    item: ItemDefinition;
    quantity: string;
    action?: React.ReactNode;
    onOpen: () => void;
}> = ({ item, quantity, action, onOpen }) => (
    <div
        className={styles.tile}
        style={{ '--rarity': getRarityColor(item.rarity) } as React.CSSProperties}
    >
        <div className={styles.slot}>
            <ItemArt item={item} />

            {/* Beneath the corner controls, above everything else: a click anywhere on the
                art opens the detail modal, and the two real buttons sit on top of it. */}
            <button
                type="button"
                className={styles.open}
                onClick={onOpen}
                aria-label={`${item.name}, ${quantity} held — open details`}
            />

            <span className={styles.badge}>{getRarityName(item.rarity)}</span>
            <span className={styles.count}>×{quantity}</span>

            <span className={styles.help}>
                <InfoTooltip subject={item.name}>
                    <p>{explainItem(item)}</p>
                </InfoTooltip>
            </span>

            {action ? <span className={styles.slotAction}>{action}</span> : null}
        </div>

        <span className={styles.tileTitle}>{item.name}</span>
    </div>
);

const Inventory: React.FC = () => {
    const navigate = useNavigate();
    const back = () => navigate(DASHBOARD_HOME);
    // `activeKind` is the PetChain value (null when disconnected); `kind` is the adapter's
    // own discriminator and is not what these queries take.
    const { activeKind: chain } = useChainCapabilities();

    const { entries, isLoading, error, refetch } = useInventory({ chain });
    const { pending, claim, claimingId, claimError } = usePendingItems(chain);
    /** The drop just claimed, opened like a chest. */
    const [loot, setLoot] = useState<PendingItem | null>(null);
    const { pets } = usePetList();
    const { spend, isPending: isSpending, error: spendError } = useSpendItem();

    /**
     * Which pet a consumable applies to.
     *
     * A single selection for the whole screen rather than one per card. Using an item is
     * "give this to that pet", and asking again on every card would make a one-click action
     * a two-step one every time.
     */
    const [petId, setPetId] = useState<string | null>(null);
    const selectedPet = petId ?? (pets[0] ? String(pets[0].id) : null);

    /**
     * Which half of the bag is showing, and — when it is the equipment half — which pet.
     *
     * Equipment lives here rather than on its own route. Escrow takes an equipped item out of
     * the wallet, so it leaves the bag, and with `/equip` reachable only from an item in the
     * bag a player who equipped everything had no way back to the screen that takes it off.
     * Hanging it off Inventory, which is always in the sidebar, removes that trap.
     *
     * One state rather than a tab plus a separate pet id: the pet only means anything while
     * the equipment half is showing, and as its own value it was never cleared — so a later
     * plain click on "Equipment" reopened on whichever pet the bag last sent here.
     */
    const [tab, setTab] = useState<{ name: 'bag' } | { name: 'equipment'; petId: string | null }>({
        name: 'bag',
    });

    /**
     * What the player's pets are wearing.
     *
     * The bag reads wallet balances, and equipping escrows the token into ItemCore — so an
     * equipped item is not in the wallet and simply vanished from this screen. A player with
     * one sword equipped it and could not find it anywhere. These rows put it back, marked
     * with the pet holding it.
     */
    const petIds = useMemo(() => pets.map((pet) => String(pet.id)), [pets]);
    const { byPet: equippedByPet } = usePetEquipmentForPets({ chain, petIds });

    const equippedEntries = useMemo(
        () =>
            pets.flatMap((pet) =>
                (equippedByPet.get(String(pet.id)) ?? []).map((entry) => ({
                    key: `${String(pet.id)}-${entry.slot}`,
                    petId: String(pet.id),
                    petName: pet.name,
                    item: entry.item,
                })),
            ),
        [pets, equippedByPet],
    );

    /** The item whose detail modal is open. Holds the entry, not just the id, so the modal
     *  keeps rendering its own quantity while a refetch is in flight. */
    const [selected, setSelected] = useState<InventoryEntry | null>(null);

    const grouped = useMemo(() => {
        const byCategory = new Map<string, typeof entries>();
        for (const entry of entries) {
            const bucket = byCategory.get(entry.item.category);
            if (bucket) {
                bucket.push(entry);
            } else {
                byCategory.set(entry.item.category, [entry]);
            }
        }
        return CATEGORY_ORDER.map((category) => ({
            category,
            label: CATEGORY_LABELS[category] ?? category,
            items: byCategory.get(category) ?? [],
        })).filter((group) => group.items.length > 0);
    }, [entries]);

    const failure = (error ?? spendError ?? claimError) as Error | null;

    /**
     * The compact action in a slot's bottom-right corner.
     *
     * Icon-only because the corner is ~26px, so the accessible name carries what the glyph
     * cannot — including *why* it is disabled, which is the one thing a greyed button with no
     * words can never explain. Same operation as the modal's button, just without the room
     * for a label.
     */
    const slotActionFor = (entry: InventoryEntry): React.ReactNode => {
        if (entry.item.category === 'consumable' && chain) {
            return (
                <button
                    type="button"
                    className={styles.slotButton}
                    disabled={isSpending || !selectedPet}
                    aria-label={
                        selectedPet
                            ? `Use ${entry.item.name} on ${petName(pets, selectedPet)}`
                            : `Use ${entry.item.name} — pick a pet first`
                    }
                    title={selectedPet ? `Use on ${petName(pets, selectedPet)}` : 'Pick a pet first'}
                    onClick={() => {
                        void spend({ chain, petId: selectedPet!, itemType: entry.item.itemType });
                    }}
                >
                    <Icon as={MuscleIcon} size="0.95em" noGap />
                </button>
            );
        }
        if (entry.item.category === 'equipment') {
            return (
                <button
                    type="button"
                    className={styles.slotButton}
                    aria-label={`Equip ${entry.item.name} on a pet`}
                    title="Equip on a pet"
                    onClick={() => setTab({ name: 'equipment', petId: null })}
                >
                    <Icon as={MuscleIcon} size="0.95em" noGap />
                </button>
            );
        }
        return null;
    };

    /**
     * What the modal offers for one item. Built here rather than in the modal because only
     * this component knows the chain and the selected pet — the modal's job is presenting an
     * item, not deciding what may be done to one.
     */
    const actionFor = (entry: InventoryEntry): React.ReactNode => {
        if (entry.item.category === 'consumable' && chain) {
            return (
                <NeonButton
                    tone="amber"
                    size="sm"
                    disabled={isSpending || !selectedPet}
                    onClick={() => {
                        // Closes only once the burn has settled: closing on click would hide
                        // the failure, and leaving it open on success would show a stale count.
                        void spend({ chain, petId: selectedPet!, itemType: entry.item.itemType })
                            .then(() => setSelected(null))
                            .catch(() => undefined);
                    }}
                >
                    <Icon as={MuscleIcon} size="1.05em" noGap />
                    {isSpending
                        ? ' Using…'
                        : selectedPet
                            ? ` Use on ${petName(pets, selectedPet)}`
                            : ' Pick a pet first'}
                </NeonButton>
            );
        }
        if (entry.item.category === 'equipment') {
            // Equipping is a wallet signature against one pet, so it belongs on the pet
            // rather than in the bag. A link, not a note: telling a player where to go
            // without taking them there is a dead end.
            return (
                <NeonButton
                    tone="amber"
                    size="sm"
                    onClick={() => {
                        setSelected(null);
                        setTab({ name: 'equipment', petId: null });
                    }}
                >
                    <Icon as={MuscleIcon} size="1.05em" noGap />
                    {' Equip on a pet'}
                </NeonButton>
            );
        }
        return null;
    };

    return (
        <SessionGate
            title="Inventory"
            connectPrompt="Connect your wallet to see what you are carrying."
            signInPrompt="Sign in to load your items."
            tone={Tones.Amber}
            back={back}
        >
            <DashboardPanel
                title="Inventory"
                description="Everything your wallet is carrying."
                back={back}
                className={styles.page}
                actions={
                    // The panel's own `.refresh` class, the same one the gallery uses, rather
                    // than a local copy: it is a global rule on `.dashboard-panel` and it
                    // already spins the icon while the button is disabled, so wiring
                    // `isLoading` gets the loading state for free.
                    <button
                        type="button"
                        className="refresh"
                        onClick={refetch}
                        disabled={isLoading}
                        aria-label={isLoading ? 'Refreshing items' : 'Refresh items'}
                        title="Refresh"
                    >
                        <Icon as={RefreshIcon} size="1em" noGap />
                    </button>
                }
            >
                {/* One scrolling region for the whole body. `.panel-body` clips, so without
                    this the bag is cut off at the panel's edge with no way to reach the rest. */}
                <TabSwitch
                    options={INVENTORY_TABS}
                    value={tab.name}
                    // Widening back to the union the state actually holds: selecting the
                    // equipment tab from here clears the pet, while the per-item shortcuts
                    // below open it with one already chosen.
                    onChange={(next) => setTab(next === 'equipment' ? { name: 'equipment', petId: null } : { name: 'bag' })}
                    label="Inventory"
                    tone="amber"
                />

                <div className={styles.scroll}>
                    {tab.name === 'equipment' ? (
                        // The same panel `/equip` used to host. Fitting gear is a wallet
                        // signature against one pet, which is a different shape from the rest
                        // of this screen, so it stays its own component rather than being
                        // dissolved into the grid.
                        <EquipPanel initialPetId={tab.petId} />
                    ) : (
                    <>
                    {failure ? (
                        <p className={styles.error} role="alert">
                            {failure.message}
                        </p>
                    ) : null}

                    {pending.length > 0 ? (
                        <section className={styles.pending} aria-labelledby="pending-heading">
                            <h2 id="pending-heading" className={styles.sectionTitle}>
                                Waiting to be claimed
                                {/* Where a player actually meets a drop, so it is where the
                                    honest version of how one is decided belongs. Both halves
                                    matter: nobody can re-roll a drop, and the odds are not
                                    checkable against a single battle. Saying only the first
                                    would be the marketing version. */}
                                <span className={styles.headingHelp}>
                                    <InfoTooltip subject="Battle drops">
                                        <p>
                                            A battle drop is decided by the same public randomness that
                                            decided the fight, fixed before the battle resolved. Nobody,
                                            including us, can re-roll one.
                                        </p>
                                        <p>
                                            The drop odds live in our open-source code rather than being
                                            published with each battle, so you can read them, but you
                                            cannot check them against one receipt on your own.
                                        </p>
                                    </InfoTooltip>
                                </span>
                            </h2>
                            {/* Its own strip above the bag, because these are not items yet:
                                claiming is what mints them, and until then there is nothing on
                                chain to spend. */}
                            <ul className={styles.pendingList}>
                                {pending.map((entry) => (
                                    <li key={entry.entitlementId} className={styles.pendingRow}>
                                        <span
                                            className={styles.pendingDot}
                                            style={{ background: getRarityColor(entry.item.rarity) }}
                                            aria-hidden
                                        />
                                        <span className={styles.pendingName}>
                                            {entry.item.name} ×{entry.quantity}
                                        </span>
                                        <span className={styles.pendingSource}>
                                            {entry.source === 'battle_drop' ? 'Battle drop' : 'Granted'}
                                        </span>
                                        <button
                                            type="button"
                                            className={styles.claim}
                                            // A failed claim is already reported through claimError,
                                            // so the rejection only has to be caught, not shown again.
                                            onClick={() =>
                                                claim(entry.entitlementId).then(
                                                    () => setLoot(entry),
                                                    () => undefined,
                                                )
                                            }
                                            disabled={claimingId != null}
                                        >
                                            {claimingId === entry.entitlementId ? 'Claiming…' : 'Claim'}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : null}

                    {isLoading ? (
                        <p className={styles.muted}>Loading your items…</p>
                    ) : grouped.length === 0 && equippedEntries.length === 0 ? (
                        <p className={styles.muted}>
                            Nothing yet. Items drop from battles, so fight something.
                        </p>
                    ) : (
                        <>
                            {equippedEntries.length > 0 ? (
                                <section aria-labelledby="group-equipped">
                                    <h2 id="group-equipped" className={styles.sectionTitle}>
                                        Equipped
                                    </h2>
                                    <div className={styles.grid}>
                                        {equippedEntries.map((entry) => (
                                            <div key={entry.key} className={styles.tile}>
                                                <div
                                                    className={styles.slot}
                                                    style={{ '--rarity': getRarityColor(entry.item.rarity) } as React.CSSProperties}
                                                >
                                                    <ItemArt item={entry.item} />
                                                    {/* One control, not a tile with corners: these are
                                                        not in the bag to be spent, and the only thing
                                                        to do with one is take it off. */}
                                                    <button
                                                        type="button"
                                                        className={styles.open}
                                                        aria-label={`${entry.item.name}, equipped on ${entry.petName} — manage equipment`}
                                                        onClick={() =>
                                                            setTab({ name: 'equipment', petId: entry.petId })
                                                        }
                                                    />
                                                    <span className={styles.badge}>
                                                        {getRarityName(entry.item.rarity)}
                                                    </span>
                                                    <span className={styles.wornBy}>{entry.petName}</span>
                                                </div>
                                                <span className={styles.tileTitle}>{entry.item.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            ) : null}

                            {pets.length > 0 ? (
                                <div className={styles.petPicker}>
                                    {/* A label element, not a wrapping <label>: PetSelect is a
                                        portalled listbox rather than a native <select>, so
                                        there is no form control for a wrapper to label. */}
                                    <label className={styles.petPickerLabel} htmlFor="inventory-pet">
                                        Use items on
                                    </label>
                                    <PetSelect
                                        id="inventory-pet"
                                        pets={pets.map((pet) => ({ id: String(pet.id), pet }))}
                                        value={selectedPet ?? ''}
                                        onChange={setPetId}
                                        placeholder="Select pet..."
                                    />
                                </div>
                            ) : null}

                            {grouped.map((group) => (
                                <section key={group.category} aria-labelledby={`group-${group.category}`}>
                                    <h2 id={`group-${group.category}`} className={styles.sectionTitle}>
                                        {group.label}
                                    </h2>
                                    <div className={styles.grid}>
                                        {group.items.map((entry) => (
                                            <ItemTile
                                                key={entry.item.itemType}
                                                item={entry.item}
                                                quantity={entry.quantity}
                                                action={slotActionFor(entry)}
                                                onOpen={() => setSelected(entry)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </>
                    )}
                    </>
                    )}
                </div>
            </DashboardPanel>

            {selected ? (
                <ItemDetailModal
                    isOpen
                    onClose={() => setSelected(null)}
                    item={selected.item}
                    quantity={selected.quantity}
                    action={actionFor(selected)}
                    error={spendError as Error | null}
                />
            ) : null}

            {loot && (
                <Celebration
                    intro="chest"
                    title="Loot!"
                    sub={`${loot.item.name} ×${loot.quantity} · ${getRarityName(loot.item.rarity)}`}
                    art={hasItemArt(loot.item.itemType) ? <ItemArt item={loot.item} size="feature" /> : undefined}
                    tone={getRarityColor(loot.item.rarity)}
                    sound="chest"
                    onClose={() => setLoot(null)}
                />
            )}
        </SessionGate>
    );
};

export default Inventory;
