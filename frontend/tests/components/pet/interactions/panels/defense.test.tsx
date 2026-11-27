// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const consent = {
    grant: vi.fn(async () => '0xhash' as string | null),
    revoke: vi.fn(async () => true),
    isPending: false,
    error: null as Error | null,
};
const authorizations = { status: { kind: 'none' } as { kind: string }, refresh: vi.fn() };

vi.mock('@shared/core', () => ({
    getRarityColor: () => '#7dd6ff',
    useBattleSession: () => ({ supported: false }),
    useChainCapabilities: () => ({ isConnected: true }),
    useDefenseAuthorization: () => consent,
    useDefenseAuthorizations: () => authorizations,
    usePetList: () => ({
        pets: [
            { id: '1', name: 'Rex', level: 3, rarity: 2 },
            { id: '2', name: 'Blaze', level: 5, rarity: 3 },
        ],
        isLoading: false,
    }),
}));
vi.mock('@hooks/useNotifyError', () => ({ useNotifyError: () => vi.fn() }));
vi.mock('@components/pet/pet-art', () => ({ default: () => <span>art</span> }));

import DefensePanel from '@components/pet/interactions/panels/defense';

beforeEach(() => {
    vi.clearAllMocks();
    authorizations.status = { kind: 'none' };
});

describe('DefensePanel, the guard post', () => {
    it('says whether the gate is open, closed, or out of date', () => {
        const { rerender } = render(<DefensePanel />);
        expect(screen.getByRole('status')).toHaveTextContent('The gate is closed');

        authorizations.status = { kind: 'active' };
        rerender(<DefensePanel />);
        expect(screen.getByRole('status')).toHaveTextContent('The gate is open');

        authorizations.status = { kind: 'stale' };
        rerender(<DefensePanel />);
        expect(screen.getByRole('status')).toHaveTextContent('Allow challenges again to restore it.');
    });

    it('allows every pet at once by default', async () => {
        render(<DefensePanel />);
        expect(screen.getByRole('radio', { name: /All my pets/ })).toHaveAttribute('aria-checked', 'true');
        await userEvent.click(screen.getByRole('button', { name: 'Allow Challenges' }));
        expect(consent.grant).toHaveBeenCalledWith({ allPets: true });
        expect(await screen.findByText('Every pet you own can now be challenged.')).toBeInTheDocument();
    });

    it('allows only the pets tapped in, and nothing until one is', async () => {
        render(<DefensePanel />);
        await userEvent.click(screen.getByRole('radio', { name: /Chosen pets/ }));
        const allow = screen.getByRole('button', { name: 'Allow Challenges' });
        expect(allow).toBeDisabled();

        const rex = screen.getByRole('button', { name: /Rex/ });
        await userEvent.click(rex);
        expect(rex).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(allow);
        expect(consent.grant).toHaveBeenCalledWith({ petIds: ['1'] });
    });
});
