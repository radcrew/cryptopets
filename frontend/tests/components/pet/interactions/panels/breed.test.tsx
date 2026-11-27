import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
// The pet a page was opened for, as a pet's sheet on the Shore hands it over.
const location = { state: null as { petId?: string } | null };
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => location }));
vi.mock('@constants/interactionRoutes', () => ({ DASHBOARD_HOME: '/dashboard' }));
vi.mock('@hooks/usePetErrorToast', () => ({ usePetErrorToast: vi.fn() }));
vi.mock('@components/common', () => ({
    AuthActionButton: ({
        onClick,
        disabled,
        children,
    }: {
        onClick: () => void;
        disabled?: boolean;
        children: ReactNode;
    }) => (
        <button onClick={onClick} disabled={disabled}>
            {children}
        </button>
    ),
}));

const breed = {
    mutate: vi.fn(),
    clearErrors: vi.fn(),
    reset: vi.fn(),
    error: null,
    isPending: false,
    isAwaitingFulfillment: false,
    hash: undefined as string | undefined,
    lifecycle: { phase: 'idle' },
};
let capturedOnSuccess: ((arg: { name: string }) => void) | undefined;

const DEFAULT_PETS = [
    { id: '1', name: 'Alpha', level: 2 },
    { id: '2', name: 'Beta', level: 5 },
];
const petList = {
    pets: [...DEFAULT_PETS] as Array<{
        id: string;
        name: string;
        level: number;
        spouseId?: number;
    }>,
    refetch: vi.fn(),
};
const capabilities = { randomness: { provider: 'vrf' }, kind: 'solana' };

vi.mock('@shared/core', () => ({
    // DNA-derived helpers stubbed so the parent/DNA cards render without real DNA.
    getPetAvatar: () => '🐉',
    // No art service in these tests: PetArt renders the emoji alone.
    petArtUrl: () => null,
    getPetClass: () => 'Warrior',
    getPetProperties: () => ({ life: 70, attack: 50, defense: 40, intelligence: 60 }),
    getRarityColor: () => '#8aa0ff',
    getRarityName: () => 'Rare',
    getRarityName: () => 'Common',
    getGeneration: () => 1,
    getLifePercent: () => 80,
    getXpNumbers: () => ({ xpCurrent: 10, xpMax: 100 }),
    getXpPercent: () => 10,
    getReadyPetsUnified: (pets: { id: string; level: number }[]) =>
        pets.map((p) => ({ id: p.id, pet: p })),
    useChainCapabilities: () => capabilities,
    usePetList: () => petList,
    useFees: () => ({
        studFee: undefined as bigint | undefined,
        symbol: null as 'ETH' | 'SOL' | null,
        formatAmount: (v: bigint) => `${v}`,
        formatAmountOnly: (v: bigint) => String(v),
    }),
    useApiClient: () => ({ defaults: { baseURL: '' }, post: vi.fn() }),
    useSpousePet: () => ({ name: undefined, level: undefined }),
    useMarriageInfo: (pet?: { spouseId?: number }) =>
        pet?.spouseId
            ? {
                  isMarried: true,
                  spouseId: BigInt(pet.spouseId),
                  isLoading: false,
                  hasProposal: false,
                  refetch: vi.fn(),
              }
            : {
                  isMarried: false,
                  spouseId: undefined,
                  isLoading: false,
                  hasProposal: false,
                  refetch: vi.fn(),
              },
    usePendingBreed: () => ({ isPending: false }),
    useBreedRelationCheck: () => ({ areRelated: false }),
    useBreedPets: (opts: { onSuccess?: (arg: { name: string }) => void }) => {
        capturedOnSuccess = opts?.onSuccess;
        return breed;
    },
}));

vi.mock('@tanstack/react-query', () => ({
    useQuery: () => ({ data: undefined, isLoading: false, error: null }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@components/pet/interactions/panels/breed/parts/pending-breed-notice', () => ({
    default: () => null,
}));
vi.mock('@components/pet/interactions/panels/breed/parts/stud-fee-balance', () => ({
    default: () => null,
}));

import BreedPanel from '@components/pet/interactions/panels/breed';

beforeEach(() => {
    vi.clearAllMocks();
    capabilities.randomness.provider = 'vrf';
    Object.assign(breed, { isPending: false, isAwaitingFulfillment: false, hash: undefined });
    petList.pets = [...DEFAULT_PETS];
});

describe('BreedPanel — My Pets tab (cycle selectors)', () => {
    it('auto-selects the first two pets and breeds them with a trimmed name', async () => {
        render(<BreedPanel />);

        // Both parents are pre-filled: Alpha is chosen in the first roster, Beta in the second.
        const first = screen.getByRole('radiogroup', { name: 'Choose the first parent' });
        const second = screen.getByRole('radiogroup', { name: 'Choose the second parent' });
        expect(within(first).getByRole('radio', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true');
        expect(within(second).getByRole('radio', { name: /Beta/ })).toHaveAttribute('aria-checked', 'true');
        // Neither roster offers the pet the other parent already is.
        expect(within(first).queryByRole('radio', { name: /Beta/ })).toBeNull();

        await userEvent.type(screen.getByPlaceholderText('Name for the new pet…'), '  Gamma  ');
        await userEvent.click(screen.getByRole('button', { name: 'Breed Pets' }));

        expect(breed.clearErrors).toHaveBeenCalled();
        expect(breed.mutate).toHaveBeenCalledWith({
            parentId1: '1',
            parentId2: '2',
            name: 'Gamma',
        });
    });

    it('cycles a parent to a different pet with the Next control', async () => {
        petList.pets = [
            { id: '1', name: 'Alpha', level: 2 },
            { id: '2', name: 'Beta', level: 5 },
            { id: '3', name: 'Gamma', level: 4 },
        ];
        render(<BreedPanel />);

        // Parent A defaults to pet 1; cycling Next (pool excludes parent B) lands on pet 3.
        await userEvent.click(screen.getAllByRole('button', { name: /Next/ })[0]);
        await userEvent.type(screen.getByPlaceholderText('Name for the new pet…'), 'Delta');
        await userEvent.click(screen.getByRole('button', { name: 'Breed Pets' }));

        expect(breed.mutate).toHaveBeenCalledWith({
            parentId1: '3',
            parentId2: '2',
            name: 'Delta',
        });
    });

    it('shows success once the offspring is created', () => {
        render(<BreedPanel />);

        act(() => {
            capturedOnSuccess?.({ name: 'Junior' });
        });

        expect(screen.getByText('"Junior" created!')).toBeInTheDocument();
        expect(petList.refetch).toHaveBeenCalled();
    });

    it('hatches the offspring from an egg cracked in three taps', async () => {
        render(<BreedPanel />);
        act(() => {
            capturedOnSuccess?.({ name: 'Junior' });
        });

        for (let i = 0; i < 3; i++) {
            await userEvent.click(screen.getByRole('button', { name: /Tap the egg/ }));
        }
        // The child is not in the mocked list, so the reveal names it without art.
        expect(await screen.findByText('Meet Junior')).toBeInTheDocument();
    });

    it('shows the awaiting-fulfillment label and hint', () => {
        breed.isAwaitingFulfillment = true;
        render(<BreedPanel />);

        expect(screen.getByRole('button', { name: 'Creating…' })).toBeInTheDocument();
        expect(
            screen.getByText('Hang tight—your new pet will show up in a moment.'),
        ).toBeInTheDocument();
    });

    it('uses Switchboard VRF labels and shows a tx hash hint', () => {
        capabilities.randomness.provider = 'switchboard';
        breed.isPending = true;
        breed.hash = '0x1234567890';
        render(<BreedPanel />);

        expect(screen.getByRole('button', { name: 'Generating randomness…' })).toBeInTheDocument();
        expect(screen.getByText('Transaction: 0x123456…')).toBeInTheDocument();
    });
});

describe('BreedPanel — With Spouse tab', () => {
    it('shows the married pet and its partner id after switching tabs', async () => {
        petList.pets = [
            { id: '1', name: 'Alpha', level: 2, spouseId: 5 },
            { id: '2', name: 'Beta', level: 3 },
        ];
        render(<BreedPanel />);

        await userEvent.click(screen.getByRole('button', { name: /With Spouse/ }));

        // The cycle-select shows the auto-selected married pet, and the partner id resolves.
        expect(screen.getByText(/Alpha/)).toBeInTheDocument();
        expect(screen.getAllByText(/#5/).length).toBeGreaterThan(0);
    });

    it('warns when the selected pet is not married', () => {
        // A single unmarried pet auto-switches to the spouse tab and auto-selects it.
        petList.pets = [{ id: '1', name: 'Alpha', level: 2 }];
        render(<BreedPanel />);

        expect(screen.getByText('This pet is not married yet.')).toBeInTheDocument();
    });

    it('submits a cross-owner breed with the spouse as the second parent', async () => {
        petList.pets = [{ id: '1', name: 'Alpha', level: 2, spouseId: 9 }];
        render(<BreedPanel />);

        await userEvent.type(screen.getByPlaceholderText('Name for the new pet…'), 'Cub');
        await userEvent.click(screen.getByRole('button', { name: 'Breed with Spouse' }));

        expect(breed.mutate).toHaveBeenCalledWith({
            parentId1: '1',
            parentId2: '9',
            name: 'Cub',
            crossOwner: true,
        });
    });
});
