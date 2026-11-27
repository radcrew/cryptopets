import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// Mocked rather than provider-wrapped, like the sidebar test: these tests are about the
// scene's doors and pets, not about wallets or queries.
const useChainCapabilities = vi.fn(() => ({ isConnected: true }));
const usePetList = vi.fn(() => ({ pets: [] as unknown[], isLoading: false }));
const useBattleConfig = vi.fn(() => ({ data: { team: { enabled: false } } }));

vi.mock('@shared/core', () => ({
    useChainCapabilities: () => useChainCapabilities(),
    usePetList: () => usePetList(),
    useBattleConfig: () => useBattleConfig(),
    usePulseRound: () => ({ round: 34_316_621, nextBeatAt: 0 }),
    getRarityColor: () => '#7dd6ff',
    getRarityName: () => 'Rare',
}));
vi.mock('@components/pet/pet-art', () => ({ default: () => <span>art</span> }));
const party = vi.hoisted(() => ({ openParty: vi.fn(), openPet: vi.fn(), openSummon: vi.fn() }));
vi.mock('@contexts/party', () => ({ useParty: () => party }));

import ShoreScene from '@components/shore';

const pet = (id: string, name: string) => ({ id, name, level: 2, rarity: 2, winCount: 3, lossCount: 1 });

/** Shows where a door led, and any pet the arena was asked to preselect. */
const Destination = () => {
    const location = useLocation();
    const state = location.state as { petId?: string } | null;
    return <p>{`at ${location.pathname}${state?.petId ? ` with ${state.petId}` : ''}`}</p>;
};

const renderShore = () =>
    render(
        <MemoryRouter initialEntries={['/main']}>
            <Routes>
                <Route path="/main" element={<ShoreScene />} />
                <Route path="*" element={<Destination />} />
            </Routes>
        </MemoryRouter>,
    );

beforeEach(() => {
    vi.clearAllMocks();
    useChainCapabilities.mockReturnValue({ isConnected: true });
    usePetList.mockReturnValue({ pets: [], isLoading: false });
    useBattleConfig.mockReturnValue({ data: { team: { enabled: false } } });
});

describe('ShoreScene', () => {
    it('shows the live Pulse round', () => {
        renderShore();
        expect(screen.getByRole('img', { name: 'The Pulse, drand round 34316621' })).toBeInTheDocument();
    });

    it('opens an existing page from each place', async () => {
        renderShore();
        await userEvent.click(screen.getByRole('button', { name: /^Nest:/ }));
        expect(screen.getByText('at /breed')).toBeInTheDocument();
    });

    it('only shows the team camp while the backend accepts team battles', () => {
        const { unmount } = renderShore();
        expect(screen.queryByRole('button', { name: /^Team 3v3:/ })).toBeNull();
        unmount();

        useBattleConfig.mockReturnValue({ data: { team: { enabled: true } } });
        renderShore();
        expect(screen.getByRole('button', { name: /^Team 3v3:/ })).toBeInTheDocument();
    });

    it("opens a pet's sheet on tap", async () => {
        usePetList.mockReturnValue({ pets: [pet('7', 'Sparring'), pet('9', 'Yasu')], isLoading: false });
        renderShore();

        await userEvent.click(screen.getByRole('button', { name: 'Sparring, level 2' }));
        expect(party.openPet).toHaveBeenCalledWith('7');
    });

    it('invites a summon when the player has no pets yet', async () => {
        renderShore();
        await userEvent.click(screen.getByRole('button', { name: 'Summon a pet' }));
        expect(party.openSummon).toHaveBeenCalled();
    });

    it('waits for the pets before calling the beach empty', () => {
        usePetList.mockReturnValue({ pets: [], isLoading: true });
        renderShore();
        expect(screen.queryByText(/The beach is empty/)).toBeNull();
    });

    it('caps the walkers so the beach never turns into a crowd', () => {
        usePetList.mockReturnValue({ pets: Array.from({ length: 12 }, (_, i) => pet(String(i), `Pet ${i}`)), isLoading: false });
        renderShore();
        expect(screen.getAllByRole('button', { name: /, level 2$/ })).toHaveLength(8);
    });

    it('invites a signed-out visitor in instead of showing pets', () => {
        useChainCapabilities.mockReturnValue({ isConnected: false });
        usePetList.mockReturnValue({ pets: [pet('7', 'Sparring')], isLoading: false });
        renderShore();
        expect(screen.queryByRole('button', { name: /, level 2$/ })).toBeNull();
        expect(screen.getByText(/your pets will come out to play/)).toBeInTheDocument();
    });
});
