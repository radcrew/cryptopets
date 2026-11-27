import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const useChainCapabilities = vi.fn();
const useEquipItem = vi.fn();
const useInventory = vi.fn();
const usePetEquipment = vi.fn();
const usePetList = vi.fn();

vi.mock('@shared/core', () => ({
    useChainCapabilities: () => useChainCapabilities(),
    useEquipItem: (opts: unknown) => useEquipItem(opts),
    useInventory: (opts: unknown) => useInventory(opts),
    usePetEquipment: (opts: unknown) => usePetEquipment(opts),
    usePetList: () => usePetList(),
    getPetClass: () => 'Ember',
    getRarityColor: () => '#FFD700',
    // The real slot indices: the panel draws one row per slot and the mapping to
    // weapon/armor/trinket is what ItemCore enforces.
    SLOT: { weapon: 0, armor: 1, trinket: 2 },
    describeItemEffect: (effect: { atk?: number } | null) => (effect ? `+${effect.atk} ATK` : null),
    getPetAvatar: () => '🐾',
    petArtUrl: () => null,
}));

vi.mock('@hooks/useNotifyError', () => ({ useNotifyError: () => vi.fn() }));
vi.mock('@hooks/useTxErrorToast', () => ({ useTxErrorToast: vi.fn() }));

import EquipPanel from '@components/pet/interactions/panels/equip';

const BLADE = {
    itemType: '1',
    key: 'iron_fang',
    category: 'equipment',
    slot: 0,
    rarity: 3,
    effect: { atk: 4 },
    name: 'Iron Fang',
    description: '',
};

const PLATE = { ...BLADE, itemType: '11', key: 'scale_mail', slot: 1, name: 'Scale Mail' };
const POTION = { ...BLADE, itemType: '100', category: 'consumable', slot: null, name: 'Lesser Tonic' };

const idle = { phase: 'idle' as const, error: null, reset: vi.fn() };
const equip = vi.fn();
const unequip = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    useChainCapabilities.mockReturnValue({ activeKind: 'evm', isConnected: true });
    usePetList.mockReturnValue({ pets: [{ id: '7', name: 'Rex', dna: '1234567890123456', level: 10 }] });
    useInventory.mockReturnValue({ entries: [], isLoading: false, error: null, refetch: vi.fn() });
    usePetEquipment.mockReturnValue({ equipped: [], bySlot: new Map(), isLoading: false, error: null, refetch: vi.fn() });
    useEquipItem.mockReturnValue({
        canEquip: true,
        equip,
        unequip,
        equipLifecycle: idle,
        unequipLifecycle: idle,
        isPending: false,
    });
});

/** Renders the panel with Rex chosen from the tray of portraits, which the slot rows require. */
async function renderWithPet() {
    render(<EquipPanel />);
    await userEvent.click(screen.getByRole('radio', { name: /Rex/ }));
}

describe('slots', () => {
    // All three are drawn whether filled or not: an empty slot is information, and showing
    // only what is worn would make a bare pet look like a pet with no slots.
    it('draws every slot even when the pet wears nothing', async () => {
        await renderWithPet();

        for (const label of ['Weapon', 'Armor', 'Trinket']) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
    });

    // Options come from the bag already on screen, filtered by the slot the item declares,
    // rather than a second query the client could answer itself.
    it('offers only the items that fit each slot', async () => {
        useInventory.mockReturnValue({
            entries: [
                { item: BLADE, quantity: '1' },
                { item: PLATE, quantity: '1' },
                { item: POTION, quantity: '5' },
            ],
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        await renderWithPet();

        expect(within(screen.getByLabelText('Weapon to equip')).queryByText(/Iron Fang/)).toBeTruthy();
        expect(within(screen.getByLabelText('Weapon to equip')).queryByText(/Scale Mail/)).toBeFalsy();
        // A consumable is not equipment and belongs in no slot at all.
        expect(within(screen.getByLabelText('Armor to equip')).queryByText(/Lesser Tonic/)).toBeFalsy();
    });

    it('says so when a slot has nothing to put in it', async () => {
        await renderWithPet();
        expect(screen.getAllByText('Nothing for this slot').length).toBeGreaterThan(0);
    });

    it('equips the chosen item into its slot', async () => {
        useInventory.mockReturnValue({
            entries: [{ item: BLADE, quantity: '1' }],
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        await renderWithPet();
        // Scoped to the weapon row: all three slots carry an Equip button, and the point of
        // this case is that the item lands in the slot it was chosen for.
        const weaponRow = within(screen.getByLabelText('Weapon to equip').closest('li')!);
        await userEvent.selectOptions(screen.getByLabelText('Weapon to equip'), '1');
        await userEvent.click(weaponRow.getByRole('button', { name: 'Equip' }));

        expect(equip).toHaveBeenCalledWith(0, '1');
    });

    it('shows what is worn and offers to take it off', async () => {
        usePetEquipment.mockReturnValue({
            equipped: [{ slot: 0, item: BLADE }],
            bySlot: new Map([[0, { slot: 0, item: BLADE }]]),
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        });

        await renderWithPet();

        expect(screen.getByText('Iron Fang')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Unequip' }));
        expect(unequip).toHaveBeenCalledWith(0);
    });
});

describe('when the chain cannot equip', () => {
    // A sentence rather than a dead control: on Solana there is no item contract, and on
    // EVM the address may simply be unset.
    it('explains instead of offering a button that reverts', async () => {
        useEquipItem.mockReturnValue({
            canEquip: false,
            equip,
            unequip,
            equipLifecycle: idle,
            unequipLifecycle: idle,
            isPending: false,
        });

        await renderWithPet();

        expect(screen.getByText(/not available on this deployment/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Equip' })).not.toBeInTheDocument();
    });
});

describe('while a transaction is in flight', () => {
    // The rows come from the indexed projection, so a confirmed transaction shows up once
    // the indexer has seen it. Saying so beats a screen that looks broken for a few seconds.
    it('names the indexing lag rather than hiding it', async () => {
        useEquipItem.mockReturnValue({
            canEquip: true,
            equip,
            unequip,
            equipLifecycle: idle,
            unequipLifecycle: idle,
            isPending: true,
        });

        await renderWithPet();

        expect(screen.getByText(/Waiting for the change to be indexed/i)).toBeInTheDocument();
    });
});
