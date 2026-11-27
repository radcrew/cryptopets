import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const pet = (id: string, name: string, level: number, over: Record<string, unknown> = {}) => ({
    id,
    chain: 'evm',
    name,
    level,
    rarity: 3,
    dna: 1234n,
    winCount: 4,
    lossCount: 1,
    readyAt: 0,
    speciesId: 1,
    ...over,
});
const petList = { pets: [pet('1', 'Yasu', 2), pet('2', 'Sparring', 5)], isLoading: false, error: null, refetch: vi.fn() };
const resting = { onCooldown: false, battleOnCooldown: false, breedOnCooldown: false, trainOnCooldown: false, battleLabel: '', breedLabel: '', trainLabel: '', battleReady: true };

vi.mock('@shared/core', () => ({
    SLOT_NAMES: { 0: 'weapon', 1: 'armor', 2: 'trinket' },
    getGeneration: () => 1,
    getLifePercent: () => 80,
    getPetClass: () => 'Nature Beast',
    getPetProperties: () => ({ attack: 51, intelligence: 54, defense: 67, life: 96 }),
    getPetSkill: () => ({ name: 'Cunning', description: 'Strikes first' }),
    getRarityColor: () => '#ffd700',
    getRarityName: () => 'Rare',
    getXpNumbers: () => ({ xpCurrent: 40, xpMax: 200 }),
    getXpPercent: () => 20,
    useChainCapabilities: () => ({ isConnected: true, activeKind: 'evm' }),
    usePetList: () => petList,
    usePetCooldowns: () => ({ statusFor: () => resting }),
    usePetEquipmentForPets: () => ({
        byPet: new Map([['2', [{ slot: 0, item: { itemType: '3', name: 'Sunder Maul' } }]]]),
    }),
}));
// Art, item art and the two wallet dialogs are covered by their own suites.
vi.mock('@components/pet/pet-art', () => ({ default: () => <span>art</span> }));
vi.mock('@components/item/item-art', () => ({ default: () => <span>item art</span> }));
vi.mock('@components/pet/creation/create-pet-modal', () => ({
    default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>summoning circle</div> : null),
}));
vi.mock('@components/pet/transfer/send-pet-modal', () => ({
    default: ({ pet: sent }: { pet: { name: string } }) => <div>sending {sent.name}</div>,
}));

import { PartyProvider, useParty } from '@contexts/party';

/** Two keys standing in for the dock and the Shore, and where the sheet's keys led. */
const Harness = () => {
    const { openParty, openPet } = useParty();
    const location = useLocation();
    const state = location.state as { petId?: string } | null;
    return (
        <>
            <button type="button" onClick={openParty}>
                open party
            </button>
            <button type="button" onClick={() => openPet('2')}>
                open Sparring
            </button>
            <p>{`at ${location.pathname}${state?.petId ? ` with ${state.petId}` : ''}`}</p>
        </>
    );
};

const renderParty = (path = '/main') =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <PartyProvider>
                <Routes>
                    <Route path="*" element={<Harness />} />
                </Routes>
            </PartyProvider>
        </MemoryRouter>,
    );

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(resting, { onCooldown: false, battleOnCooldown: false, battleLabel: '' });
});

describe('The party', () => {
    it('lists every pet, highest level first, and goes to a sheet and back', async () => {
        renderParty();
        await userEvent.click(screen.getByRole('button', { name: 'open party' }));
        const party = screen.getByRole('dialog', { name: 'Your party' });
        expect(party).toHaveTextContent('2 pets · 8 wins');
        const names = within(party).getAllByRole('button', { name: /level/ }).map((b) => b.getAttribute('aria-label'));
        expect(names).toEqual(['Sparring, level 5', 'Yasu, level 2']);

        await userEvent.click(within(party).getByRole('button', { name: 'Sparring, level 5' }));
        expect(screen.getByRole('dialog', { name: "Sparring's sheet" })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Back to your party' }));
        expect(screen.getByRole('dialog', { name: 'Your party' })).toBeInTheDocument();
    });

    it('summons a new pet from the party', async () => {
        renderParty();
        await userEvent.click(screen.getByRole('button', { name: 'open party' }));
        await userEvent.click(screen.getByRole('button', { name: 'Summon' }));
        expect(screen.getByText('summoning circle')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Your party' })).toBeNull();
    });
});

describe("A pet's sheet", () => {
    it('shows the same numbers the collection card did, and the gear it wears', async () => {
        resting.onCooldown = true;
        resting.battleOnCooldown = true;
        resting.battleLabel = '5m';
        renderParty();
        await userEvent.click(screen.getByRole('button', { name: 'open Sparring' }));

        const sheet = screen.getByRole('dialog', { name: "Sparring's sheet" });
        for (const text of ['Lv 5', 'Rare', 'Cunning', 'Nature Beast · Gen 1', '40 / 200', '4W', '1L', '80% win rate', '67', 'Sunder Maul', 'Battle in 5m']) {
            expect(sheet).toHaveTextContent(text);
        }
    });

    it('opens each action page with the pet already chosen, and closes on arrival', async () => {
        renderParty();
        await userEvent.click(screen.getByRole('button', { name: 'open Sparring' }));
        await userEvent.click(screen.getByRole('button', { name: /Train/ }));

        expect(screen.getByText('at /train with 2')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    // Opened from the dock over the Training Ground itself, the path does not change, so the
    // sheet cannot wait for a route change to close.
    it('closes when its action leads to the page it was opened over', async () => {
        renderParty('/train');
        await userEvent.click(screen.getByRole('button', { name: 'open Sparring' }));
        await userEvent.click(screen.getByRole('button', { name: /Train/ }));

        expect(screen.getByText('at /train with 2')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('sends the pet from the sheet', async () => {
        renderParty();
        await userEvent.click(screen.getByRole('button', { name: 'open Sparring' }));
        await userEvent.click(screen.getByRole('button', { name: 'Send Sparring' }));
        expect(screen.getByText('sending Sparring')).toBeInTheDocument();
    });

    it('opens the story preview over the sheet; Escape closes the preview first, then the sheet', async () => {
        renderParty();
        await userEvent.click(screen.getByRole('button', { name: 'open Sparring' }));
        await userEvent.click(screen.getByRole('button', { name: "Sparring's story, coming soon" }));
        expect(screen.getByRole('dialog', { name: "Sparring's story" })).toBeInTheDocument();

        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: "Sparring's story" })).toBeNull();
        expect(screen.getByRole('dialog', { name: "Sparring's sheet" })).toBeInTheDocument();

        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
