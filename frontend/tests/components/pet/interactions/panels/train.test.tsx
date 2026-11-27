// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mocks = vi.hoisted(() => ({
    notifyError: vi.fn(),
    navigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@constants/interactionRoutes', () => ({ DASHBOARD_HOME: '/dashboard' }));
vi.mock('@hooks/useNotifyError', () => ({ useNotifyError: () => mocks.notifyError }));
vi.mock('@hooks/useTxErrorToast', () => ({ useTxErrorToast: vi.fn() }));
vi.mock('@components/ui/icon', () => ({
    default: () => null,
    CheckIcon: () => null,
}));
vi.mock('@constants/tones', () => ({ Tones: { Emerald: 'emerald' } }));
vi.mock('@components/common/transaction-status', () => ({ default: () => null }));
const train = {
    mutate: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
    lifecycle: { phase: 'idle' },
};
let capturedOnSuccess: (() => void) | undefined;
const petList = {
    pets: [{ id: '1', name: 'Rex', level: 3 }],
    refetch: vi.fn(),
};

vi.mock('@shared/core', () => ({
    useChainCapabilities: () => ({ isConnected: true }),
    getPetAvatar: () => '🐉',
    // No art service in these tests: PetArt renders the emoji alone.
    petArtUrl: () => null,
    getPetClass: () => 'Warrior',
    getRarityColor: () => '#7dd6ff',
    getXpNumbers: () => ({ xpCurrent: 10, xpMax: 100 }),
    getXpPercent: () => 10,
    getReadyPetsUnified: (pets: { id: string; level: number }[]) => pets.map((p) => ({ id: p.id, pet: p })),
    usePetList: () => petList,
    useFees: () => ({
        trainFee: 1000000000000000n,
        symbol: 'ETH',
        formatAmount: (v: bigint) => `${v} ETH`,
        formatAmountOnly: (v: bigint) => String(v),
    }),
    useTrainPet: (opts: { onSuccess?: () => void }) => {
        capturedOnSuccess = opts?.onSuccess;
        return train;
    },
}));

import TrainPanel from '@components/pet/interactions/panels/train';

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(train, { isPending: false, error: null });
    petList.pets = [{ id: '1', name: 'Rex', level: 3 }];
    capturedOnSuccess = undefined;
});

/**
 * Picks a pet from `PetPicker`: every pet is a visible tile, so this is one click rather
 * than opening a menu first.
 */
async function choosePet(name: string) {
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));
}

describe('TrainPanel', () => {
    it('renders the pet selector', async () => {
        render(<TrainPanel />);
        expect(screen.getByRole('radio', { name: /Rex/ })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Lv 3/ })).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('disables the Train button when no pet is selected', () => {
        render(<TrainPanel />);
        expect(screen.getByRole('button', { name: 'Train' })).toBeDisabled();
    });

    it('calls mutate with the selected pet', async () => {
        render(<TrainPanel />);
        await choosePet('Rex');
        await userEvent.click(screen.getByRole('button', { name: /Train/ }));
        expect(train.mutate).toHaveBeenCalledWith({ petId: '1' });
    });

    it('shows success message after training', () => {
        render(<TrainPanel />);
        act(() => { capturedOnSuccess?.(); });
        expect(screen.getByText('Pet trained successfully!')).toBeInTheDocument();
        expect(petList.refetch).toHaveBeenCalled();
    });

    it('celebrates the trained pet, and waits for the refreshed list before claiming any XP', async () => {
        render(<TrainPanel />);
        await choosePet('Rex');
        act(() => { capturedOnSuccess?.(); });

        const card = screen.getByRole('dialog', { name: 'Trained!' });
        expect(card).toHaveTextContent('Rex worked hard and earned XP');
        expect(card).toHaveTextContent('Counting the XP…');
    });

    it('shows Training... label while pending', () => {
        train.isPending = true;
        render(<TrainPanel />);
        expect(screen.getByRole('button', { name: 'Training...' })).toBeInTheDocument();
    });

    it('shows the train cost when a pet is selected and fee is available', async () => {
        render(<TrainPanel />);
        await choosePet('Rex');
        expect(screen.getByText(/Cost:/)).toBeInTheDocument();
    });
});
