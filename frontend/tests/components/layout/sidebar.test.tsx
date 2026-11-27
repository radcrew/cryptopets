import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// The rank footer reads the session and the leaderboard, so the sidebar now needs both.
// Mocked rather than provider-wrapped: these tests are about the rail's own behaviour,
// and wagmi/query providers would make every one of them a wallet test.
const useChainCapabilities = vi.fn(() => ({ activeKind: 'evm' as string | null }));
const usePlayerRank = vi.fn(
    () =>
        ({ rank: null, isLoading: false }) as {
            rank: { rank: number; winCount: number } | null;
            isLoading: boolean;
        },
);
const useBattleConfig = vi.fn(() => ({ data: { team: { enabled: false } } }));

vi.mock('@shared/core', () => ({
    useChainCapabilities: () => useChainCapabilities(),
    usePlayerRank: (chain: string | null) => usePlayerRank(chain),
    useBattleConfig: () => useBattleConfig(),
}));

import Sidebar from '@components/layout/sidebar';

const renderSidebar = () =>
    render(
        <MemoryRouter initialEntries={['/']}>
            <Sidebar />
        </MemoryRouter>,
    );

const pinButton = () => screen.getByRole('button', { name: 'Keep sidebar open' });

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useChainCapabilities.mockReturnValue({ activeKind: 'evm' });
    usePlayerRank.mockReturnValue({ rank: null, isLoading: false });
    useBattleConfig.mockReturnValue({ data: { team: { enabled: false } } });
});

describe('Sidebar team battle entry', () => {
    it('is hidden while the backend does not accept team battles, and shown once it does', () => {
        const { unmount } = renderSidebar();
        expect(screen.queryByRole('button', { name: /Team Battle/ })).toBeNull();
        unmount();

        useBattleConfig.mockReturnValue({ data: { team: { enabled: true } } });
        renderSidebar();
        expect(screen.getByRole('button', { name: /Team Battle/ })).toBeInTheDocument();
    });
});

describe('Sidebar pin', () => {
    it('starts unpinned, so the rail still collapses by default', () => {
        renderSidebar();
        expect(pinButton()).toHaveAttribute('aria-pressed', 'false');
    });

    it('toggles pinned state on click', async () => {
        renderSidebar();

        await userEvent.click(pinButton());
        expect(pinButton()).toHaveAttribute('aria-pressed', 'true');

        await userEvent.click(pinButton());
        expect(pinButton()).toHaveAttribute('aria-pressed', 'false');
    });

    // A pin that forgets on reload is a pin that does not work: the whole point
    // is not having to re-state the preference.
    it('remembers the pin across a remount', async () => {
        const { unmount } = renderSidebar();
        await userEvent.click(pinButton());
        unmount();

        renderSidebar();
        expect(pinButton()).toHaveAttribute('aria-pressed', 'true');
    });

    it('does not navigate when the pin is clicked', async () => {
        // The pin sits beside the brand button rather than inside it; nesting
        // them would make pinning also jump to the gallery.
        renderSidebar();

        await userEvent.click(pinButton());

        expect(pinButton()).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Crypto Pets home' })).toBeInTheDocument();
    });
});

describe('Sidebar rank footer', () => {
    it('shows the player standing once it loads', () => {
        usePlayerRank.mockReturnValue({ rank: { rank: 4, winCount: 8 }, isLoading: false });

        renderSidebar();

        expect(screen.getByText('RANK #4 GLOBAL')).toBeInTheDocument();
        expect(screen.getByText('8 Total Wins')).toBeInTheDocument();
    });

    it('singularizes a lone win', () => {
        usePlayerRank.mockReturnValue({ rank: { rank: 9, winCount: 1 }, isLoading: false });

        renderSidebar();

        expect(screen.getByText('1 Total Win')).toBeInTheDocument();
    });

    // Unranked is a real state, not a zero: this used to read "RANK #3 GLOBAL / 649
    // Total Wins" for everyone, including a player who had never fought.
    it('says unranked when no pet has fought', () => {
        renderSidebar();

        expect(screen.getByText('UNRANKED')).toBeInTheDocument();
        expect(screen.getByText(/Win a battle to enter the board/i)).toBeInTheDocument();
    });

    it('renders no footer while the rank is still loading', () => {
        usePlayerRank.mockReturnValue({ rank: null, isLoading: true });

        renderSidebar();

        expect(screen.queryByText('UNRANKED')).toBeNull();
        expect(screen.queryByText(/RANK #/)).toBeNull();
    });
});
