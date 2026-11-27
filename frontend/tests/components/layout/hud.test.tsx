import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// The plate reads the session and the leaderboard. Mocked rather than provider-wrapped, as
// the old sidebar test did: these are tests of the HUD, not of wallets.
const useChainCapabilities = vi.fn(() => ({
    isConnected: true,
    activeKind: 'evm' as string | null,
    walletAddress: '0x86f8000000000000000000000000000000cef5' as string | null,
}));
const usePlayerRank = vi.fn(
    () =>
        ({ rank: null, isLoading: false }) as {
            rank: { rank: number; winCount: number } | null;
            isLoading: boolean;
        },
);

vi.mock('@shared/core', () => ({
    useChainCapabilities: () => useChainCapabilities(),
    usePlayerRank: (chain: string | null) => usePlayerRank(chain),
    shortAddress: (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`,
}));
vi.mock('@components/wallet/account-dropdown', () => ({ default: () => <div>wallet</div> }));
vi.mock('@contexts/sound/synth', () => ({ createSynth: () => ({ play: vi.fn() }) }));

import Hud from '@components/layout/hud';
import { SoundProvider } from '@contexts/sound';

const renderHud = () =>
    render(
        <MemoryRouter>
            <SoundProvider>
                <Hud />
            </SoundProvider>
        </MemoryRouter>,
    );

beforeEach(() => {
    localStorage.clear();
    useChainCapabilities.mockReturnValue({
        isConnected: true,
        activeKind: 'evm',
        walletAddress: '0x86f8000000000000000000000000000000cef5',
    });
    usePlayerRank.mockReturnValue({ rank: null, isLoading: false });
});

describe('Hud player plate', () => {
    it('shows the trainer and their standing once it loads', () => {
        usePlayerRank.mockReturnValue({ rank: { rank: 4, winCount: 8 }, isLoading: false });
        renderHud();
        expect(screen.getByText('Trainer 0x86f8…cef5')).toBeInTheDocument();
        expect(screen.getByText('Rank #4 · 8 wins')).toBeInTheDocument();
    });

    it('singularizes a lone win', () => {
        usePlayerRank.mockReturnValue({ rank: { rank: 9, winCount: 1 }, isLoading: false });
        renderHud();
        expect(screen.getByText('Rank #9 · 1 win')).toBeInTheDocument();
    });

    it('says unranked when no pet has fought', () => {
        renderHud();
        expect(screen.getByText(/Unranked/)).toBeInTheDocument();
    });

    it('draws no plate while the rank is loading, rather than a zero', () => {
        usePlayerRank.mockReturnValue({ rank: null, isLoading: true });
        renderHud();
        expect(screen.queryByText(/Unranked|Rank #/)).toBeNull();
    });

    it('draws no plate, streak or quests before a wallet connects', () => {
        useChainCapabilities.mockReturnValue({ isConnected: false, activeKind: null, walletAddress: null });
        renderHud();
        expect(screen.queryByText(/Trainer/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Daily quests' })).toBeNull();
        expect(screen.getByRole('link', { name: 'Crypto Pets home' })).toBeInTheDocument();
    });
});

describe('Hud controls', () => {
    it('opens the daily quests scroll and closes it on Escape', async () => {
        renderHud();
        await userEvent.click(screen.getByRole('button', { name: 'Daily quests' }));
        const panel = screen.getByRole('dialog', { name: 'Daily quests' });
        expect(panel).toHaveTextContent('Breed a new pet');
        // A preview: it says so, and its chest cannot be opened.
        expect(panel).toHaveTextContent('Coming soon');
        expect(screen.getByRole('button', { name: /Daily chest/ })).toBeDisabled();

        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Daily quests' })).toBeNull();
    });

    it('toggles the sound switch and keeps the wallet control', async () => {
        renderHud();
        const sound = screen.getByRole('button', { name: 'Sound effects' });
        expect(sound).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(sound);
        expect(sound).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByText('wallet')).toBeInTheDocument();
    });
});
