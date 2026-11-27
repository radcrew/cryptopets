import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@constants/interactionRoutes', () => ({ DASHBOARD_HOME: '/dashboard' }));

const notifyError = vi.fn();
vi.mock('@hooks/useNotifyError', () => ({ useNotifyError: () => notifyError }));
vi.mock('@hooks/useTxErrorToast', () => ({ useTxErrorToast: vi.fn() }));

const levelUpPet = {
    mutate: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    error: null,
    reset: vi.fn(),
    lifecycle: { phase: 'idle' },
};
let capturedOnSuccess: (() => void) | undefined;

const petList = {
    pets: [
        { id: '1', name: 'Alpha', level: 2 },
        { id: '2', name: 'Beta', level: 5 },
    ],
    refetch: vi.fn(),
};
const capabilities = { levelUpFee: null as { amount: number; symbol: string } | null, isConnected: true };

vi.mock('@shared/core', () => ({
    getPetAvatar: () => '🐉',
    // No art service in these tests: PetArt renders the emoji alone.
    petArtUrl: () => null,
    getPetClass: () => 'Warrior',
    getRarityColor: () => '#7dd6ff',
    getXpNumbers: () => ({ xpCurrent: 10, xpMax: 100 }),
    getXpPercent: () => 10,
    getReadyPetsUnified: (pets: { id: string; level: number }[]) => pets.map((p) => ({ id: p.id, pet: p })),
    useChainCapabilities: () => capabilities,
    useFees: () => ({
        levelUpFee: undefined as bigint | undefined,
        symbol: null as 'ETH' | 'SOL' | null,
        formatAmount: (v: bigint) => `${v}`,
        formatAmountOnly: (v: bigint) => String(v),
    }),
    usePetList: () => petList,
    useLevelUpPet: (opts: { onSuccess?: () => void }) => {
        capturedOnSuccess = opts?.onSuccess;
        return levelUpPet;
    },
    useSyncMetadata: () => ({ sync: vi.fn(), isPending: false, error: null }),
}));

import LevelUpPanel from '@components/pet/interactions/panels/level-up';

beforeEach(() => {
    vi.clearAllMocks();
    capabilities.levelUpFee = null;
    levelUpPet.isPending = false;
});


/**
 * Picks a pet from `PetPicker`: every pet is a visible tile, so this is one click on the
 * tile rather than opening anything.
 */
async function choosePet(name: string) {
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));
}

describe('LevelUpPanel', () => {
    it('shows every ready pet as a tile, with no menu to open', () => {
        render(<LevelUpPanel />);

        expect(screen.getByRole('radio', { name: /Alpha/ })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Beta/ })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Lv 2/ })).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('marks only the chosen pet as selected', async () => {
        render(<LevelUpPanel />);
        await choosePet('Beta');

        expect(screen.getByRole('radio', { name: /Beta/ })).toBeChecked();
        expect(screen.getByRole('radio', { name: /Alpha/ })).not.toBeChecked();
    });

    it('labels the button with the fee when one is configured', () => {
        capabilities.levelUpFee = { amount: 5, symbol: 'SOL' };
        render(<LevelUpPanel />);
        expect(screen.getByRole('button', { name: 'Level Up (from 5 SOL)' })).toBeInTheDocument();
    });

    it('falls back to a plain label with no fee', () => {
        render(<LevelUpPanel />);
        expect(screen.getByRole('button', { name: 'Level Up' })).toBeInTheDocument();
    });

    it('keeps the submit disabled until a pet is selected', async () => {
        render(<LevelUpPanel />);
        const submit = screen.getByRole('button', { name: 'Level Up' });
        expect(submit).toBeDisabled();

        await choosePet('Beta');
        expect(submit).toBeEnabled();
    });

    it('submits the level-up mutation for the chosen pet', async () => {
        render(<LevelUpPanel />);
        await choosePet('Beta');
        await userEvent.click(screen.getByRole('button', { name: 'Level Up' }));

        expect(levelUpPet.reset).toHaveBeenCalled();
        expect(levelUpPet.mutate).toHaveBeenCalledWith({ petId: '2' });
    });

    it('shows success once settled', () => {
        render(<LevelUpPanel />);

        act(() => {
            capturedOnSuccess?.();
        });

        expect(screen.getByText('Pet leveled up successfully!')).toBeInTheDocument();
        expect(petList.refetch).toHaveBeenCalled();
    });

    it('celebrates the pet that leveled, exactly one level up, until dismissed', async () => {
        render(<LevelUpPanel />);
        await choosePet('Beta');

        act(() => {
            capturedOnSuccess?.();
        });

        expect(screen.getByRole('dialog', { name: 'Level up!' })).toHaveTextContent('Beta reached level 6');
        await userEvent.click(screen.getByRole('button', { name: 'Nice!' }));
        expect(screen.queryByRole('dialog', { name: 'Level up!' })).toBeNull();
    });
});
