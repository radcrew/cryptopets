import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const useBattleConfig = vi.fn(() => ({ data: { team: { enabled: false } } }));
vi.mock('@shared/core', () => ({ useBattleConfig: () => useBattleConfig() }));

import Dock from '@components/layout/dock';

/** Prints where the dock led. */
const Where = () => <p>{`at ${useLocation().pathname}`}</p>;

const renderDock = (path = '/main') =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <Dock />
            <Routes>
                <Route path="*" element={<Where />} />
            </Routes>
        </MemoryRouter>,
    );

const openSheet = () => userEvent.click(screen.getByRole('button', { name: 'More' }));

beforeEach(() => {
    useBattleConfig.mockReturnValue({ data: { team: { enabled: false } } });
});

describe('Dock keys', () => {
    it('opens the page behind each key', async () => {
        renderDock();
        await userEvent.click(screen.getByRole('button', { name: 'Nest' }));
        expect(screen.getByText('at /breed')).toBeInTheDocument();
    });

    it('marks the key for the page you are on, battle included for team battles', () => {
        renderDock('/team-battle');
        expect(screen.getByRole('button', { name: 'Battle' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Pets' })).not.toHaveAttribute('aria-current');
    });
});

describe('Dock More sheet', () => {
    it('lists every page, the Shore first, so nothing lacks a door', async () => {
        renderDock();
        await openSheet();
        const sheet = screen.getByRole('dialog', { name: 'All places' });
        for (const name of ['The Shore', 'My Pets', 'Level Up', 'Training Ground', 'Marriage', 'Rename Pet', 'Messages', 'Leaderboard']) {
            expect(within(sheet).getByRole('button', { name })).toBeInTheDocument();
        }
    });

    it('has no team battle door while the backend does not accept them, and one once it does', async () => {
        const { unmount } = renderDock();
        await openSheet();
        expect(screen.queryByRole('button', { name: 'Team Battle' })).toBeNull();
        unmount();

        useBattleConfig.mockReturnValue({ data: { team: { enabled: true } } });
        renderDock();
        await openSheet();
        expect(screen.getByRole('button', { name: 'Team Battle' })).toBeInTheDocument();
    });

    it('tags a planned mode Soon but still opens its preview', async () => {
        renderDock();
        await openSheet();
        const tower = screen.getByRole('button', { name: /The Tower/ });
        expect(tower).toHaveTextContent('Soon');
        expect(tower).toBeEnabled();
        await userEvent.click(tower);
        expect(screen.getByText('at /tower')).toBeInTheDocument();
    });

    it('closes on arrival and on Escape', async () => {
        renderDock();
        await openSheet();
        await userEvent.click(screen.getByRole('button', { name: 'Messages' }));
        expect(screen.getByText('at /messages')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'All places' })).toBeNull();

        await openSheet();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'All places' })).toBeNull();
    });
});
