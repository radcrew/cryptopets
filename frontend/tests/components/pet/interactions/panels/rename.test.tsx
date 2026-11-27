import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
// The pet a page was opened for, as a pet's sheet on the Shore hands it over.
const location = { state: null as { petId?: string } | null };
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => location }));
vi.mock('@constants/interactionRoutes', () => ({ DASHBOARD_HOME: '/dashboard' }));

const notifyError = vi.fn();
vi.mock('@hooks/useNotifyError', () => ({ useNotifyError: () => notifyError }));
vi.mock('@hooks/useTxErrorToast', () => ({ useTxErrorToast: vi.fn() }));

const renamePet = {
    mutate: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    error: null,
    reset: vi.fn(),
    lifecycle: { phase: 'idle' },
};
let capturedOnSuccess: (() => void) | undefined;

/** Unix seconds, well past any test run: marks a pet as still cooling down. */
const FAR_FUTURE = 4_000_000_000;

const defaultPets = () => [
    { id: '1', name: 'Alpha', level: 2 },
    { id: '2', name: 'Beta', level: 5 },
];
const petList = {
    pets: defaultPets() as { id: string; name: string; level: number; readyAt?: number }[],
    refetch: vi.fn(),
};
const capabilities = { renameMinLevel: 1, isConnected: true };

vi.mock('@shared/core', () => ({
    getPetAvatar: () => '🐉',
    // No art service in these tests: PetArt renders the emoji alone.
    petArtUrl: () => null,
    getPetClass: () => 'Warrior',
    getXpNumbers: () => ({ xpCurrent: 10, xpMax: 100 }),
    getXpPercent: () => 10,
    // Mirrors the real filter, which drops pets whose cooldown has not elapsed.
    getReadyPetsUnified: (pets: { id: string; level: number; readyAt?: number }[]) =>
        pets
            .filter((p) => (p.readyAt ?? 0) <= Date.now() / 1000)
            .map((p) => ({ id: p.id, pet: p })),
    useChainCapabilities: () => capabilities,
    usePetList: () => petList,
    useRenamePet: (opts: { onSuccess?: () => void }) => {
        capturedOnSuccess = opts?.onSuccess;
        return renamePet;
    },
}));

import RenamePanel from '@components/pet/interactions/panels/rename';

/**
 * Picks a pet from `PetSelect`: a trigger plus a portalled listbox, so the options exist
 * only once it is open and `selectOptions` does not apply.
 */
async function choosePet(name: string) {
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

beforeEach(() => {
    vi.clearAllMocks();
    capabilities.renameMinLevel = 1;
    renamePet.isPending = false;
    petList.pets = defaultPets();
});

describe('RenamePanel', () => {
    it('lists the ready pets as options', async () => {
        render(<RenamePanel />);
        await userEvent.click(screen.getByRole('combobox'));

        expect(await screen.findByRole('option', { name: /Alpha/ })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /Beta/ })).toBeInTheDocument();
        // The level rides beside the name rather than being folded into one string.
        expect(screen.getByRole('option', { name: /Lv 5/ })).toBeInTheDocument();
    });

    it('filters out pets below the rename minimum level', async () => {
        capabilities.renameMinLevel = 3;
        render(<RenamePanel />);
        await userEvent.click(screen.getByRole('combobox'));

        expect(screen.queryByRole('option', { name: /Alpha/ })).not.toBeInTheDocument();
        expect(await screen.findByRole('option', { name: /Beta/ })).toBeInTheDocument();
    });

    // The standalone page shows no subtitle, so without this the control is simply
    // empty and disabled with nothing saying why.
    it('says why the pet list is empty, per cause', () => {
        capabilities.renameMinLevel = 9;
        const { rerender } = render(<RenamePanel />);
        expect(
            screen.getByText('Renaming needs a level 9 pet. Level one up first.'),
        ).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toBeDisabled();

        capabilities.renameMinLevel = 1;
        petList.pets = [];
        rerender(<RenamePanel />);
        expect(screen.getByText('You have no pets yet.')).toBeInTheDocument();

        petList.pets = [{ id: '1', name: 'Alpha', level: 2, readyAt: FAR_FUTURE }];
        rerender(<RenamePanel />);
        expect(screen.getByText('Every pet is still on cooldown.')).toBeInTheDocument();
    });

    // The slot has to be occupied before a pet is chosen, or picking one grows the
    // panel and everything under it jumps.
    it('holds the pet slot with a placeholder before a pet is chosen', async () => {
        const { container } = render(<RenamePanel />);
        const slot = () => container.querySelector('.interaction-visual');
        expect(slot()).not.toBeNull();
        expect(within(slot() as HTMLElement).getByText('?')).toBeInTheDocument();

        await choosePet('Alpha');
        // Same slot, real pet in it: the name also shows on the dropdown trigger, so
        // this asks the slot specifically.
        expect(within(slot() as HTMLElement).queryByText('?')).toBeNull();
        expect(within(slot() as HTMLElement).getByText('Alpha')).toBeInTheDocument();
    });

    it('keeps the submit button disabled until a pet and name are provided', async () => {
        render(<RenamePanel />);
        const submit = screen.getByRole('button', { name: 'Change Name' });
        expect(submit).toBeDisabled();

        await choosePet('Alpha');
        await userEvent.type(screen.getByPlaceholderText('Enter new name...'), 'Gamma');

        expect(submit).toBeEnabled();
    });

    it('submits the rename mutation with the trimmed name', async () => {
        render(<RenamePanel />);

        await choosePet('Alpha');
        await userEvent.type(screen.getByPlaceholderText('Enter new name...'), '  Gamma  ');
        await userEvent.click(screen.getByRole('button', { name: 'Change Name' }));

        expect(renamePet.reset).toHaveBeenCalled();
        expect(renamePet.mutate).toHaveBeenCalledWith({ petId: '1', name: 'Gamma' });
    });

    it('shows a success message once the rename settles', async () => {
        render(<RenamePanel />);
        await choosePet('Alpha');
        await userEvent.type(screen.getByPlaceholderText('Enter new name...'), 'Gamma');

        act(() => {
            capturedOnSuccess?.();
        });

        expect(screen.getByText('Pet name changed to "Gamma"!')).toBeInTheDocument();
        expect(petList.refetch).toHaveBeenCalled();
    });
});
