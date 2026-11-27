import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const useChainCapabilities = vi.fn();
const useInventory = vi.fn();
const usePendingItems = vi.fn();
const usePetList = vi.fn();
const useSpendItem = vi.fn();
const useAuth = vi.fn();
const navigate = vi.fn();
const itemArtUrl = vi.fn<(itemType: string) => string | null>(() => null);
const usePetEquipmentForPets = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => navigate };
});

// The equipment tab hosts the real EquipPanel, which pulls in its own half of @shared/core.
// Stubbed so these cases stay about the bag; the panel has its own suite in
// tests/components/pet/interactions/panels/equip.test.tsx.
vi.mock('@components/pet/interactions/panels/equip', () => ({
    default: () => <div data-testid="equip-panel" />,
}));

vi.mock('@shared/core', () => ({
    useAuth: () => useAuth(),
    useChainCapabilities: () => useChainCapabilities(),
    useInventory: (opts: unknown) => useInventory(opts),
    usePendingItems: (chain: unknown) => usePendingItems(chain),
    usePetList: () => usePetList(),
    usePetEquipmentForPets: () => usePetEquipmentForPets(),
    useSpendItem: () => useSpendItem(),
    // The real ones: the five rarity tiers and the effect wording are shared with the pet
    // cards on purpose, so a test that stubbed them would stop checking that.
    getRarityColor: (r: number) => ['#8B4513', '#C0C0C0', '#FFD700', '#FF69B4', '#8A2BE2'][r - 1] ?? '#8B4513',
    getRarityName: (r: number) =>
        ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'][r - 1] ?? 'Unknown',
    SLOT_NAMES: { 0: 'weapon', 1: 'armor', 2: 'trinket' },
    // The real list: the bag derives its display order from it, so stubbing a different set
    // would stop this suite checking that a new category actually renders.
    ITEM_CATEGORIES: ['consumable', 'equipment', 'collectible', 'material'],
    // Null by default: no image service, so ItemArt renders nothing and most cases stay
    // about grouping and labelling. The art has its own suite in components/item.
    itemArtUrl: (itemType: string) => itemArtUrl(itemType),
    itemFallbackArtUrl: () => null,
    // Reached through <PetSelect>, which renders a <PetArt> per option. Null and an emoji
    // keep the picker rendering without pulling the pet-art pipeline into these cases.
    petArtUrl: () => null,
    getPetAvatar: () => '🐾',
    // The real shapes: the abbreviations on the chips and the wording behind the "?" are
    // shared with mobile on purpose, so stubbing them would stop checking that.
    itemStats: (effect: { kind: string; amount?: number; atk?: number } | null) => {
        if (!effect) return [];
        if (effect.kind === 'grant_xp') return [{ label: 'XP', value: effect.amount }];
        if (effect.kind === 'stat_bonus') return [{ label: 'ATK', value: effect.atk }];
        return [];
    },
    explainItem: (item: { name: string }) => `What ${item.name} does, at length.`,
}));

import Inventory from '@components/inventory';

const POTION = {
    itemType: '100',
    key: 'xp_potion_i',
    category: 'consumable',
    slot: null,
    rarity: 1,
    effect: { kind: 'grant_xp', amount: 50 },
    name: 'Lesser Tonic',
    description: 'Tastes of copper.',
};

const BLADE = {
    itemType: '1',
    key: 'iron_fang',
    category: 'equipment',
    slot: 0,
    rarity: 3,
    effect: { kind: 'stat_bonus', atk: 4 },
    name: 'Iron Fang',
    description: 'A blunt starter blade.',
};

const SHARD = {
    ...POTION,
    itemType: '300',
    key: 'ember_shard',
    category: 'material',
    effect: null,
    name: 'Ember Shard',
};

const spend = vi.fn();

function renderBag() {
    return render(
        <MemoryRouter initialEntries={['/inventory']}>
            <Inventory />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    // Both leak across tests otherwise: stubEnv persists until unstubbed, and clearAllMocks
    // clears call history but not an implementation set with mockReturnValue.
    vi.unstubAllEnvs();
    itemArtUrl.mockReturnValue(null);
    useAuth.mockReturnValue({ isAuthenticated: true, isConnected: true });
    useChainCapabilities.mockReturnValue({ activeKind: 'evm', isConnected: true, chainLabel: 'EVM' });
    useInventory.mockReturnValue({ entries: [], isLoading: false, error: null, refetch: vi.fn() });
    usePendingItems.mockReturnValue({ pending: [], claim: vi.fn(), claimingId: null, claimError: null });
    usePetList.mockReturnValue({ pets: [{ id: '7', name: 'Rex' }] });
    usePetEquipmentForPets.mockReturnValue({ byPet: new Map(), isLoading: false, error: null, refetch: vi.fn() });
    useSpendItem.mockReturnValue({ spend, isPending: false, error: null, reset: vi.fn() });
    spend.mockResolvedValue({ burnTxHash: '0xburn', level: 5, xp: 0, readyAt: 0, leveledUp: false });
});

describe('the bag', () => {
    it('tells a player with nothing where items come from', () => {
        renderBag();
        expect(screen.getByText(/Items drop from battles/i)).toBeInTheDocument();
    });

    // The grouping is the design: the categories are what a player can *do* with a thing,
    // so they have to survive as headings rather than flattening into one grid.
    it('groups items under their category', () => {
        useInventory.mockReturnValue({
            entries: [
                { item: POTION, quantity: '3' },
                { item: BLADE, quantity: '1' },
                { item: SHARD, quantity: '9' },
            ],
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        renderBag();

        expect(screen.getByRole('heading', { name: 'Consumables' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Equipment' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Materials' })).toBeInTheDocument();
        // Nothing in the collectible bucket, so it is not drawn at all.
        expect(screen.queryByRole('heading', { name: 'Collectibles' })).not.toBeInTheDocument();
    });

    // The tile carries the picture, the name and the count and nothing else. The count stays
    // because "how many do I have" is what a bag is scanned for; putting it behind a click
    // would make the grid useless for its one job.
    it('shows each item as a named tile with its stack count', () => {
        useInventory.mockReturnValue({
            entries: [{ item: BLADE, quantity: '2' }],
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        renderBag();

        expect(screen.getByRole('button', { name: /^Iron Fang, 2 held/ })).toBeInTheDocument();
        expect(screen.getByText('Iron Fang')).toBeInTheDocument();
        // The four corners: rarity, count, an explanation and an action.
        expect(screen.getByText('Rare')).toBeInTheDocument();
        expect(screen.getByText('×2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^What does Iron Fang do/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Equip Iron Fang on a pet' })).toBeInTheDocument();
        // Everything else still belongs to the modal.
        expect(screen.queryByText('A blunt starter blade.')).not.toBeInTheDocument();
    });

    /**
     * The corner controls are siblings of the transparent "open" button, not children of it:
     * a button inside a button is invalid and loses keyboard behaviour. This is the assertion
     * that would fail if they were ever nested back together.
     */
    it('keeps the corner controls out of the open-details button', () => {
        useInventory.mockReturnValue({
            entries: [{ item: BLADE, quantity: '1' }],
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        renderBag();

        const open = screen.getByRole('button', { name: /^Iron Fang, 1 held/ });
        expect(open).toBeEmptyDOMElement();
        for (const name of [/^What does Iron Fang do/, /^Equip Iron Fang/]) {
            expect(open).not.toContainElement(screen.getByRole('button', { name }));
        }
    });

    // Rarity still comes from the same helper the pet cards use, so the five tiers mean one
    // thing across the app — it just reads in the modal now.
    it('opens a detail modal from a tile', async () => {
        useInventory.mockReturnValue({
            entries: [{ item: BLADE, quantity: '2' }],
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        renderBag();
        await userEvent.click(screen.getByRole('button', { name: /^Iron Fang, 2 held/ }));

        // Scoped to the dialog: rarity now reads on the tile badge as well, so an unscoped
        // query matches both and proves nothing about the modal.
        const dialog = within(screen.getByRole('dialog'));
        expect(dialog.getByText('Rare')).toBeInTheDocument();
        expect(dialog.getByText('×2 held')).toBeInTheDocument();
        expect(dialog.getByText('A blunt starter blade.')).toBeInTheDocument();
        expect(dialog.getByText('What Iron Fang does, at length.')).toBeInTheDocument();
    });

    it('only offers Use on a consumable', async () => {
        useInventory.mockReturnValue({
            entries: [
                { item: POTION, quantity: '1' },
                { item: BLADE, quantity: '1' },
                { item: SHARD, quantity: '1' },
            ],
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        renderBag();

        // Nothing actionable on the tiles themselves any more.
        expect(screen.queryByRole('button', { name: /Use on/ })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /^Lesser Tonic, 1 held/ }));
        expect(screen.getByRole('button', { name: /Use on Rex/ })).toBeInTheDocument();
    });

    it('offers nothing to do with a material', async () => {
        useInventory.mockReturnValue({
            entries: [{ item: SHARD, quantity: '1' }],
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        renderBag();
        await userEvent.click(screen.getByRole('button', { name: /^Ember Shard, 1 held/ }));

        expect(screen.queryByRole('button', { name: /Use on/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Equip/ })).not.toBeInTheDocument();
    });

    it('spends the consumable on the selected pet', async () => {
        useInventory.mockReturnValue({
            entries: [{ item: POTION, quantity: '1' }],
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        renderBag();
        await userEvent.click(screen.getByRole('button', { name: /^Lesser Tonic, 1 held/ }));
        await userEvent.click(screen.getByRole('button', { name: /Use on Rex/ }));

        expect(spend).toHaveBeenCalledWith({ chain: 'evm', petId: '7', itemType: '100' });
    });

    // Closing on click would hide a failure; staying open on success would show a count that
    // is already wrong.
    it('closes the modal once the burn settles', async () => {
        useInventory.mockReturnValue({
            entries: [{ item: POTION, quantity: '1' }],
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        renderBag();
        await userEvent.click(screen.getByRole('button', { name: /^Lesser Tonic, 1 held/ }));
        await userEvent.click(screen.getByRole('button', { name: /Use on Rex/ }));

        await waitFor(() => {
            expect(screen.queryByText('Tastes of copper.')).not.toBeInTheDocument();
        });
    });

    /**
     * Equipment lives here rather than on its own route: escrow takes an equipped item out of
     * the wallet, so it leaves the bag, and a player who equipped everything had no item left
     * to click through to `/equip`. Inventory is always in the sidebar, so this cannot happen.
     */
    it('switches to the equipment tab', async () => {
        renderBag();

        expect(screen.queryByTestId('equip-panel')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('tab', { name: 'Equipment' }));
        expect(screen.getByTestId('equip-panel')).toBeInTheDocument();
    });

    it('sends an item to the equipment tab instead of navigating away', async () => {
        useInventory.mockReturnValue({
            entries: [{ item: BLADE, quantity: '1' }],
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        renderBag();
        await userEvent.click(screen.getByRole('button', { name: 'Equip Iron Fang on a pet' }));

        expect(screen.getByTestId('equip-panel')).toBeInTheDocument();
        expect(navigate).not.toHaveBeenCalled();
    });

    /**
     * Equipping escrows the token into ItemCore, so it leaves the wallet and the bag — which
     * reads balances — stopped showing it at all. A player with one sword equipped it and
     * could not find it anywhere on this screen.
     */
    it('shows equipped items, marked with the pet wearing them', () => {
        usePetEquipmentForPets.mockReturnValue({
            byPet: new Map([['7', [{ slot: 0, item: BLADE }]]]),
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        renderBag();

        const heading = screen.getByRole('heading', { name: 'Equipped' });
        // Scoped: the pet picker names Rex too, so an unscoped query proves nothing about
        // the chip on the tile.
        const section = within(heading.closest('section')!);
        expect(section.getByText('Rex')).toBeInTheDocument();
        expect(section.getByRole('button', { name: /^Iron Fang, equipped on Rex/ })).toBeInTheDocument();
    });

    it('opens the equipment tab on the pet wearing the item', async () => {
        usePetEquipmentForPets.mockReturnValue({
            byPet: new Map([['7', [{ slot: 0, item: BLADE }]]]),
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        renderBag();
        await userEvent.click(screen.getByRole('button', { name: /^Iron Fang, equipped on Rex/ }));

        expect(screen.getByTestId('equip-panel')).toBeInTheDocument();
    });

    it('shows no Equipped section for a player wearing nothing', () => {
        renderBag();
        expect(screen.queryByRole('heading', { name: 'Equipped' })).not.toBeInTheDocument();
    });

    it('surfaces a read failure rather than rendering an empty bag', () => {
        useInventory.mockReturnValue({
            entries: [],
            isLoading: false,
            error: new Error('boom'),
            refetch: vi.fn(),
        });

        renderBag();

        expect(screen.getByRole('alert')).toHaveTextContent('boom');
    });
});

describe('items waiting to be claimed', () => {
    const pending = {
        entitlementId: 'e1',
        item: POTION,
        quantity: 2,
        source: 'battle_drop',
        sourceRef: 'btl_0001',
        createdAt: '2026-08-07T00:00:00.000Z',
    };

    // Their own strip above the bag, because they are not items yet: claiming is what mints
    // them, and until then there is nothing on chain to spend.
    it('shows them apart from the bag, with what paid them', () => {
        usePendingItems.mockReturnValue({ pending: [pending], claim: vi.fn(), claimingId: null, claimError: null });

        renderBag();

        const strip = screen.getByRole('region', { name: /Waiting to be claimed/i });
        expect(within(strip).getByText(/Lesser Tonic ×2/)).toBeInTheDocument();
        expect(within(strip).getByText('Battle drop')).toBeInTheDocument();
    });

    it('claims the entitlement it was asked about', async () => {
        // A promise, as the real claim returns: the screen waits on it to open the drop.
        const claim = vi.fn().mockResolvedValue(undefined);
        usePendingItems.mockReturnValue({ pending: [pending], claim, claimingId: null, claimError: null });

        renderBag();
        await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

        expect(claim).toHaveBeenCalledWith('e1');
    });

    it('opens the drop like a chest once the claim lands, and not when it fails', async () => {
        const claim = vi.fn().mockRejectedValueOnce(new Error('no gas')).mockResolvedValue(undefined);
        usePendingItems.mockReturnValue({ pending: [pending], claim, claimingId: null, claimError: null });

        renderBag();
        await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
        expect(screen.queryByRole('dialog', { name: 'Loot!' })).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Open the chest' }));
        expect(await screen.findByText(/Lesser Tonic ×2/, { selector: 'p' })).toBeInTheDocument();
    });

    // One claim at a time: each sends a transaction from the backend's wallet, and a player
    // hammering three buttons should not queue three mints.
    it('disables every claim while one is in flight', () => {
        usePendingItems.mockReturnValue({
            pending: [pending, { ...pending, entitlementId: 'e2' }],
            claim: vi.fn(),
            claimingId: 'e1',
            claimError: null,
        });

        renderBag();

        expect(screen.getByRole('button', { name: 'Claiming…' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Claim' })).toBeDisabled();
    });
});
