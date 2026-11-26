import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpponentPet, Pet, ReadyPet } from '@shared/core';

// AuthActionButton reaches into auth/session context — stub to a plain button.
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
/**
 * A partial mock, not a full one: this file deliberately uses the real cosmetic helpers so
 * the CombatantCard renders its true output. Only the two hooks that need React context are
 * replaced, since providing an API client and an auth session here would be a lot of setup
 * for a card that is not about either.
 */
vi.mock('@shared/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@shared/core')>()),
    useChainCapabilities: () => ({ activeKind: 'evm', isConnected: true }),
    usePetEquipmentForPets: () => ({ byPet: new Map(), isLoading: false, error: null, refetch: () => {} }),
}));
// Siblings that reach into PetsConfig/wagmi/Anchor — stub them out.
vi.mock('@components/pet/interactions/panels/battle/parts/pending-battle-notice', () => ({
    default: () => null,
}));
vi.mock('@components/pet/interactions/panels/battle/parts/open-to-challenges-toggle', () => ({
    default: () => null,
}));

import BattleSetup, {
    type BattleSetupProps,
} from '@components/pet/interactions/panels/battle/parts/battle-setup';
import { opponentKey } from '@shared/core';

// Pets carry a real DNA + rarity so the shared DNA-derived helpers (stats, avatar,
// class, rarity) render the CombatantCard without stubbing @shared/core.
const readyPet = (id: string, name: string): ReadyPet =>
    ({ id, pet: { id, name, level: 3, dna: 1n, rarity: 0 } as unknown as Pet }) as ReadyPet;
const opp = (id: string): OpponentPet =>
    ({ id, owner: '0xF00d', name: `Foe ${id}`, level: 5, dna: 2n, rarity: 1 }) as unknown as OpponentPet;

const baseProps = (over: Partial<BattleSetupProps> = {}): BattleSetupProps => ({
    isStandaloneView: true,
    subtitle: 'Pick a fight',
    selectedFighter: null,
    opponent: undefined,
    randomMatchDisabled: false,
    onRandomMatch: vi.fn(),
    readyPets: [readyPet('1', 'Alpha')],
    petsLoading: false,
    selectedPet1: '',
    onSelectFighter: vi.fn(),
    sortedOpponents: [opp('o1')],
    selectedOpponentKey: '',
    onSelectOpponent: vi.fn(),
    opponentsLoading: false,
    onRefreshOpponents: vi.fn(),
    onBattle: vi.fn(),
    battleDisabled: false,
    battleButtonLabel: 'Battle!',
    onCancel: vi.fn(),
    winEstimate: { isLoading: false, winProbability: null, samples: null },
    ...over,
});

describe('BattleSetup (fighter-vs-rival showdown)', () => {
    it('shows the heading + subtitle only in the embedded (non-standalone) view', () => {
        const { rerender } = render(<BattleSetup {...baseProps()} />);
        expect(screen.queryByText('Pick a fight')).not.toBeInTheDocument();
        expect(screen.queryByText('Battle Pets')).not.toBeInTheDocument();

        rerender(<BattleSetup {...baseProps({ isStandaloneView: false })} />);
        expect(screen.getByText('Pick a fight')).toBeInTheDocument();
        expect(screen.getByText('Battle Pets')).toBeInTheDocument();
    });

    it('labels the fighter, rival and VS columns', () => {
        render(<BattleSetup {...baseProps()} />);
        expect(screen.getByText('Your Fighter')).toBeInTheDocument();
        expect(screen.getByText('On-Chain Rival')).toBeInTheDocument();
        expect(screen.getByText('VS')).toBeInTheDocument();
    });

    it('lists ready fighters in the fighter select and reports a selection', async () => {
        const onSelectFighter = vi.fn();
        render(
            <BattleSetup
                {...baseProps({
                    readyPets: [readyPet('1', 'Alpha'), readyPet('2', 'Beta')],
                    onSelectFighter,
                })}
            />,
        );

        // PetSelect is a button plus a portalled listbox, not a native <select>: the
        // options exist only once it is open, so `selectOptions` does not apply.
        await userEvent.click(screen.getByRole('combobox', { name: 'Choose your fighter' }));
        expect(await screen.findByRole('option', { name: /Alpha/ })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /Beta/ })).toBeInTheDocument();
        // The level rides beside the name rather than being folded into one string.
        expect(screen.getAllByText('Lv 3')).toHaveLength(2);

        await userEvent.click(screen.getByRole('option', { name: /Beta/ }));
        expect(onSelectFighter).toHaveBeenCalledWith('2');
    });

    it('prompts for a fighter when none are ready', () => {
        render(<BattleSetup {...baseProps({ readyPets: [] })} />);
        // Appears both as the control's placeholder and the empty card label.
        expect(screen.getAllByText('No ready fighters').length).toBeGreaterThan(0);
        expect(screen.getByRole('combobox', { name: 'Choose your fighter' })).toBeDisabled();
    });

    it('says the pets are loading rather than that there are none, while they load', () => {
        render(<BattleSetup {...baseProps({ readyPets: [], petsLoading: true })} />);
        expect(screen.getAllByText('Loading your pets…').length).toBeGreaterThan(0);
        expect(screen.queryByText('No ready fighters')).toBeNull();
    });

    it('renders the selected fighter and opponent cards', () => {
        render(
            <BattleSetup
                {...baseProps({
                    selectedFighter: readyPet('1', 'Alpha').pet,
                    opponent: opp('o1'),
                })}
            />,
        );
        expect(screen.getByText('Alpha')).toBeInTheDocument();
        expect(screen.getByText('Foe o1')).toBeInTheDocument();
    });

    it('wires the Random and Refresh opponent controls', async () => {
        const onRandomMatch = vi.fn();
        const onRefreshOpponents = vi.fn();
        const { rerender } = render(
            <BattleSetup {...baseProps({ onRandomMatch, onRefreshOpponents })} />,
        );

        await userEvent.click(screen.getByRole('button', { name: /Random/ }));
        expect(onRandomMatch).toHaveBeenCalledOnce();

        await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        expect(onRefreshOpponents).toHaveBeenCalledOnce();

        rerender(<BattleSetup {...baseProps({ opponentsLoading: true })} />);
        expect(screen.getByRole('button', { name: '…' })).toBeDisabled();
    });

    it('reports the chosen opponent by its composite key', async () => {
        const onSelectOpponent = vi.fn();
        render(<BattleSetup {...baseProps({ onSelectOpponent })} />);

        await userEvent.click(screen.getByRole('combobox', { name: 'Select an opponent' }));
        await userEvent.click(await screen.findByRole('option', { name: /Foe o1/ }));
        expect(onSelectOpponent).toHaveBeenCalledWith(opponentKey('0xF00d', 'o1'));
    });

    it('disables the opponent control when the roster is empty', () => {
        render(<BattleSetup {...baseProps({ sortedOpponents: [] })} />);
        expect(screen.getByRole('combobox', { name: 'Select an opponent' })).toBeDisabled();
    });

    it('shows finding / empty states for the opponent roster', () => {
        const { rerender } = render(
            <BattleSetup {...baseProps({ opponentsLoading: true, sortedOpponents: [] })} />,
        );
        expect(screen.getAllByText('Finding challengers…').length).toBeGreaterThan(0);

        rerender(<BattleSetup {...baseProps({ sortedOpponents: [] })} />);
        expect(screen.getAllByText('No opponents available').length).toBeGreaterThan(0);
    });

    it('renders the win rate from the estimate', () => {
        const { rerender } = render(<BattleSetup {...baseProps()} />);
        expect(screen.getByText('—')).toBeInTheDocument();

        rerender(
            <BattleSetup
                {...baseProps({
                    winEstimate: { isLoading: false, winProbability: 0.5, samples: 10 },
                })}
            />,
        );
        expect(screen.getByText('50%')).toBeInTheDocument();

        rerender(
            <BattleSetup
                {...baseProps({ winEstimate: { isLoading: true, winProbability: null, samples: null } })}
            />,
        );
        expect(screen.getByText('…')).toBeInTheDocument();
    });

    it('wires the battle and cancel controls', async () => {
        const onBattle = vi.fn();
        const onCancel = vi.fn();
        render(<BattleSetup {...baseProps({ onBattle, onCancel })} />);

        await userEvent.click(screen.getByRole('button', { name: /Battle!/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onBattle).toHaveBeenCalledOnce();
        expect(onCancel).toHaveBeenCalledOnce();
    });
});
