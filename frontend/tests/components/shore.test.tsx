import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// Mocked rather than provider-wrapped, like the sidebar test: these tests are about the
// scene's doors and pets, not about wallets or queries.
const useChainCapabilities = vi.fn(() => ({ isConnected: true }));
const usePetList = vi.fn(() => ({ pets: [] as unknown[] }));
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
    usePetList.mockReturnValue({ pets: [] });
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

    it('opens a pet card on tap, and its Battle button preselects that pet in the arena', async () => {
        usePetList.mockReturnValue({ pets: [pet('7', 'Sparring'), pet('9', 'Yasu')] });
        renderShore();

        await userEvent.click(screen.getByRole('button', { name: 'Sparring, level 2' }));
        expect(screen.getByRole('group', { name: 'Sparring details' })).toHaveTextContent('Lv 2');

        await userEvent.click(screen.getByRole('button', { name: 'Battle' }));
        expect(screen.getByText('at /battle with 7')).toBeInTheDocument();
    });

    it("opens a pet's companion preview from Talk, labelled as coming soon", async () => {
        usePetList.mockReturnValue({ pets: [pet('7', 'Sparring')] });
        renderShore();

        await userEvent.click(screen.getByRole('button', { name: 'Sparring, level 2' }));
        await userEvent.click(screen.getByRole('button', { name: 'Talk with Sparring, coming soon' }));
        const panel = screen.getByRole('dialog', { name: 'Talk with Sparring' });
        // The rules travel with the preview, not only in the roadmap.
        expect(panel).toHaveTextContent('your wallet signs every action, and personality never changes a fight');
        expect(screen.getByText('Approve and sign').closest('[inert]')).not.toBeNull();

        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('caps the walkers so the beach never turns into a crowd', () => {
        usePetList.mockReturnValue({ pets: Array.from({ length: 12 }, (_, i) => pet(String(i), `Pet ${i}`)) });
        renderShore();
        expect(screen.getAllByRole('button', { name: /, level 2$/ })).toHaveLength(8);
    });

    it('invites a signed-out visitor in instead of showing pets', () => {
        useChainCapabilities.mockReturnValue({ isConnected: false });
        usePetList.mockReturnValue({ pets: [pet('7', 'Sparring')] });
        renderShore();
        expect(screen.queryByRole('button', { name: /, level 2$/ })).toBeNull();
        expect(screen.getByText(/your pets will come out to play/)).toBeInTheDocument();
    });
});
