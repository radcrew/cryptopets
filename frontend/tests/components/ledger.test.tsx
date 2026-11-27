import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const session = { isConnected: true, walletAddress: '0xme' as string | null };
const reading = { data: undefined as unknown, isLoading: false, error: null as Error | null };
const useLedgerStone = vi.fn((battleId: string | null) => (battleId ? reading : { data: undefined, isLoading: false, error: null }));

const stone = (over: Record<string, unknown> = {}) => ({
    battleId: 'btl_1',
    sequence: 1284,
    createdAt: 1_893_456_000,
    kind: 'duel',
    chain: 'evm',
    won: true,
    rounds: 7,
    round: 9000,
    mine: [{ petId: '1', dna: '1234567890123456', rarity: 3, level: 8 }],
    theirs: [{ petId: '42', dna: '6543210987654321', rarity: 2, level: 6 }],
    ...over,
});
const stones = { data: [stone(), stone({ battleId: 'btl_0', sequence: 1283, won: false, kind: 'team' })], isLoading: false, error: null };

vi.mock('@shared/core', () => ({
    getRarityColor: () => '#ffd700',
    useAuth: () => ({ isAuthenticated: false }),
    useChainCapabilities: () => session,
    useLedgerStone: (battleId: string | null) => useLedgerStone(battleId),
    useLedgerStones: () => stones,
    usePetList: () => ({ pets: [{ id: '1', name: 'Rex' }] }),
    useSpousePet: () => ({}),
}));
// The art is not what these cases are about, and it reads an image service.
vi.mock('@components/pet/pet-art', () => ({ default: () => <span>art</span> }));

import LedgerStones from '@components/ledger';

const renderPage = () =>
    render(
        <MemoryRouter>
            <LedgerStones />
        </MemoryRouter>,
    );

beforeEach(() => {
    session.isConnected = true;
    Object.assign(reading, { data: undefined, isLoading: false, error: null });
    useLedgerStone.mockClear();
});

describe('LedgerStones', () => {
    it('asks for a wallet before there is a ledger to read', () => {
        session.isConnected = false;
        renderPage();
        expect(screen.getByText('Connect your wallet to read the stones of your battles.')).toBeInTheDocument();
    });

    it('shows each battle as a stone, naming your pet and the rival it does not know yet by id', () => {
        renderPage();
        expect(screen.getByRole('button', { name: 'Read stone #1,284: Rex vs Pet #42, won' })).toHaveTextContent('Duel');
        expect(screen.getByRole('button', { name: 'Read stone #1,283: Your squad vs Their squad, lost' })).toHaveTextContent(
            'Team 3v3',
        );
    });

    it('checks a stone when it is opened, then carves what the checked receipt says', async () => {
        const { rerender } = renderPage();
        reading.isLoading = true;
        await userEvent.click(screen.getByRole('button', { name: /Read stone #1,284/ }));
        expect(useLedgerStone).toHaveBeenLastCalledWith('btl_1');
        expect(screen.getByRole('status')).toHaveTextContent('Checking stone #1,284…');

        Object.assign(reading, {
            isLoading: false,
            data: {
                receipt: { battleId: 'btl_1', sequence: 1284, beacon: { round: 9000 }, result: { rounds: 7 } },
                checks: [{ check: 'combat-replay', ok: true }],
                verified: true,
            },
        });
        rerender(
            <MemoryRouter>
                <LedgerStones />
            </MemoryRouter>,
        );
        const tablet = screen.getByRole('dialog', { name: 'Ledger Stone #1284' });
        expect(tablet).toHaveTextContent('Duel · won in 7 rounds · Pulse beat #9,000');
        expect(tablet).toHaveTextContent('The fight replays blow for blow');
    });
});
