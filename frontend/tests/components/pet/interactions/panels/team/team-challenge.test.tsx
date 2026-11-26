import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setTactic = vi.fn();
const placePet = vi.fn();
const pet = (id: string) => ({ id, chain: 'evm', name: `Mine ${id}`, level: 10, dna: 1n, rarity: 1, readyAt: 0 });
const rival = (petId: string, col: number, row: number) => ({
    petId, col, row, tactic: 'hunter', name: `Rival ${petId}`, level: 12, rarity: 2, dna: '1', speciesId: 0, readyAt: 0,
});

vi.mock('@hooks/team/useTeamBattlePanel', async () => ({
    ...(await vi.importActual<object>('@hooks/team/useTeamBattlePanel')),
    useTeamBattlePanel: () => ({
        phase: 'build-squad',
        opponents: [],
        opponentsLoading: false,
        opponent: {
            planHash: '0xplan', defenderOwner: '0xdef', minLevel: 1, maxLevel: 30, expiresAt: 0, ready: true,
            roster: [rival('7', 2, 1), rival('8', 1, 0)],
        },
        chooseOpponent: vi.fn(),
        pets: [pet('1'), pet('2')],
        squad: [
            { petId: '1', col: 2, row: 1, tactic: 'focus' },
            { petId: '2', col: 2, row: 0, tactic: 'focus' },
        ],
        addPet: vi.fn(),
        removePet: vi.fn(),
        placePet,
        setTactic,
        // Slot 1 acts first, so the pet in slot 0 acts second.
        turnOrder: [1, 0],
        squadReady: true,
        canStart: false,
        start: vi.fn(),
        reset: vi.fn(),
        error: null,
        battleState: null,
        failureReason: null,
        result: null,
    }),
}));

import TeamChallenge from '@components/pet/interactions/panels/team/team-challenge';

beforeEach(() => vi.clearAllMocks());

describe('TeamChallenge pet details', () => {
    it("shows a rival pet's details read-only, with its signed tactic", async () => {
        const user = userEvent.setup();
        render(<TeamChallenge />);
        await user.click(screen.getByRole('button', { name: 'Rival 7, front column, middle row' }));

        const details = screen.getByRole('complementary', { name: 'Pet details' });
        expect(details).toHaveTextContent('Rival pet');
        expect(details).toHaveTextContent('Hunter: an enemy its element beats');
        expect(within(details).queryByRole('combobox')).toBeNull();
    });

    it('shows your pet with its turn order and tactic, and taps select rather than swap', async () => {
        const user = userEvent.setup();
        render(<TeamChallenge />);
        await user.click(screen.getByRole('button', { name: 'Mine 1, front column, middle row' }));

        const details = screen.getByRole('complementary', { name: 'Pet details' });
        expect(details).toHaveTextContent('Acts 2nd in your squad');
        await user.selectOptions(within(details).getByRole('combobox'), 'bodyguard');
        expect(setTactic).toHaveBeenCalledWith('1', 'bodyguard');

        // Tapping another of your pets selects it; it does not swap the two.
        await user.click(screen.getByRole('button', { name: 'Mine 2, front column, top row' }));
        expect(placePet).not.toHaveBeenCalled();
        expect(details).toHaveTextContent('Mine 2');

        await user.click(screen.getByRole('button', { name: 'Move here: back column, bottom row' }));
        expect(placePet).toHaveBeenCalledWith('2', 0, 2);
    });
});
