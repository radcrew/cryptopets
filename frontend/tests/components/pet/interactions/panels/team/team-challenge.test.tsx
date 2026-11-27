import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// AuthActionButton reaches into the auth session; a plain button is enough here.
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

// Names for the defenders a result reveals. Only pet 70 is known, so 71 shows its fallback.
vi.mock('@shared/core', async () => ({
    ...(await vi.importActual<object>('@shared/core')),
    useChainCapabilities: () => ({ activeKind: 'evm', isConnected: true }),
    usePetNames: () => new Map([['70', 'Fang']]),
}));

const setTactic = vi.fn();
const placePet = vi.fn();
const reset = vi.fn();
const pet = (id: string) => ({
    id,
    chain: 'evm',
    name: `Mine ${id}`,
    level: 10,
    dna: 1n,
    rarity: 1,
    readyAt: 0,
    speciesId: 0,
});
// What the opponent list serves: never the defending pets.
const OPPONENT = {
    planHash: '0xplan',
    defenderOwner: '0x1234567890abcdef1234567890abcdef12345678',
    minLevel: 1,
    maxLevel: 30,
    expiresAt: 0,
    ready: true,
};

const basePanel = () => ({
    phase: 'build-squad',
    opponents: [OPPONENT],
    opponentsLoading: false,
    opponentsFetching: false,
    refreshOpponents: vi.fn(),
    opponent: OPPONENT as typeof OPPONENT | null,
    chooseOpponent: vi.fn(),
    chooseRandomOpponent: vi.fn(),
    pets: [pet('1'), pet('2')],
    petsLoading: false,
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
    squadLevel: 10 as number | null,
    levelInBand: true,
    squadReady: true,
    canStart: false,
    start: vi.fn(),
    reset,
    cancel: vi.fn(),
    error: null,
    battleId: null as string | null,
    battleState: null as string | null,
    failureReason: null,
    result: null as unknown,
    signedIn: true,
    moving: null as string | null,
    selectPet: vi.fn(),
    placeMoving: vi.fn(),
    inFlight: false,
    inBattle: false,
    sceneOpen: false,
    hideScene: vi.fn(),
    showScene: vi.fn(),
});
let panel = basePanel();

vi.mock('@hooks/team/useTeamBattlePanel', async () => ({
    ...(await vi.importActual<object>('@hooks/team/useTeamBattlePanel')),
    useTeamBattlePanel: () => panel,
}));

import TeamChallenge from '@components/pet/interactions/panels/team/team-challenge';

beforeEach(() => {
    vi.clearAllMocks();
    panel = basePanel();
});

describe('TeamChallenge showdown', () => {
    it('lays out your squad with its order and tactics, and the rival team only as unknown', () => {
        render(<TeamChallenge />);

        const mine = screen.getByRole('list', { name: 'Your squad' });
        expect(within(mine).getByRole('combobox', { name: 'Tactic for Mine 1' })).toHaveValue('focus');
        // Mine 1 is slot 0, second in the squad's order.
        expect(within(mine).getByRole('button', { name: 'Select Mine 1' }).closest('li')).toHaveTextContent(
            '2nd',
        );
        expect(within(mine).getAllByText('Empty slot')).toHaveLength(1);

        const order = screen.getByRole('list', { name: "Your squad's turn order" });
        // Checked by label rather than by whole text: each entry also holds the pet's art, which is an
        // image where the art service is configured and an emoji where it is not, as in CI.
        const entries = within(order).getAllByRole('listitem');
        expect(entries).toHaveLength(2);
        expect(entries[0]).toHaveTextContent('1st: Mine 2');
        expect(entries[1]).toHaveTextContent('2nd: Mine 1');

        // The defenders: three unknown rows and an unknown zone, with no pet or tactic anywhere.
        const theirs = screen.getByRole('list', { name: 'Rival team' });
        expect(within(theirs).getAllByText('Hidden until the battle')).toHaveLength(3);
        expect(screen.getByRole('img', { name: 'Rival zone, hidden until the battle' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Lv 1–30/ })).toBeInTheDocument();
    });

    it('reports taps to the hook: selecting a pet, moving the picked-up one, and setting a tactic', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<TeamChallenge />);
        await user.click(screen.getByRole('button', { name: 'Select Mine 1' }));
        expect(panel.selectPet).toHaveBeenCalledWith('1');
        // Nothing picked up: an empty tile is not a target, and tapping a pet never swaps.
        expect(screen.queryByRole('button', { name: /Move here/ })).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Mine 2, front column, top row' }));
        expect(panel.selectPet).toHaveBeenCalledWith('2');
        expect(placePet).not.toHaveBeenCalled();
        await user.selectOptions(screen.getByRole('combobox', { name: 'Tactic for Mine 1' }), 'bodyguard');
        expect(setTactic).toHaveBeenCalledWith('1', 'bodyguard');
        unmount();

        panel = { ...basePanel(), moving: '2' };
        render(<TeamChallenge />);
        await user.click(screen.getByRole('button', { name: 'Move here: back column, bottom row' }));
        expect(panel.placeMoving).toHaveBeenCalledWith(0, 2);
    });

    it('asks a signed-out player to sign in, rather than saying no teams are open', () => {
        panel = { ...basePanel(), signedIn: false, opponent: null, opponents: [] };
        render(<TeamChallenge />);
        expect(screen.getAllByText('Sign in to see teams').length).toBeGreaterThan(0);
        expect(screen.queryByText(/No teams are open/)).toBeNull();
    });

    it('locks the squad and the rival while a battle is under way', () => {
        panel = { ...basePanel(), phase: 'running', battleId: 'b1', inFlight: true, inBattle: true, sceneOpen: false };
        render(<TeamChallenge />);
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        for (const team of within(screen.getByRole('radiogroup', { name: 'Choose a team to challenge' })).getAllByRole('radio')) {
            expect(team).toBeDisabled();
        }
        expect(screen.getByRole('button', { name: /Random/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Mine 1, level 10' })).toBeDisabled();
        // Read-only lineup and zone: no tactic picker, no tile to move to, no pet to pick up.
        expect(screen.queryByRole('combobox', { name: 'Tactic for Mine 1' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Select Mine 1' })).toBeNull();
        expect(screen.getByText('Your team battle is under way.')).toBeInTheDocument();
    });

    it('says why the battle cannot start', () => {
        panel = {
            ...basePanel(),
            squad: [...basePanel().squad, { petId: '3', col: 1, row: 1, tactic: 'focus' }],
            squadLevel: 40,
            levelInBand: false,
        };
        render(<TeamChallenge />);
        expect(
            screen.getByText(/takes challengers from level 1 to 30, and your squad counts as level 40/),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Start Team Battle/ })).toBeDisabled();
    });

    it('shows an empty arena and a loading note before there is anything to show', () => {
        panel = {
            ...basePanel(),
            opponent: null,
            opponents: [],
            opponentsLoading: true,
            pets: [],
            petsLoading: true,
            squad: [],
            turnOrder: [],
            squadLevel: null,
        };
        render(<TeamChallenge />);
        expect(screen.getAllByText('Finding teams…').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Loading your pets…').length).toBeGreaterThan(0);
    });
});

describe('TeamChallenge battle scene', () => {
    it('opens full screen with the defenders still hidden, takes focus, and puts away on Back or Escape', async () => {
        const user = userEvent.setup();
        const running = { phase: 'running', battleId: 'b1', battleState: 'committed', inFlight: true, inBattle: true };
        panel = { ...basePanel(), ...running, sceneOpen: true };
        const { unmount } = render(<TeamChallenge />);

        const scene = screen.getByRole('dialog', { name: 'Team battle' });
        expect(scene).toHaveTextContent('Waiting for the randomness round');
        expect(within(scene).getByRole('img', { name: 'Battle map' })).toBeInTheDocument();
        expect(within(scene).getByText('Hidden')).toBeInTheDocument();
        expect(scene).toHaveFocus();

        await user.click(within(scene).getByRole('button', { name: '← Back' }));
        expect(panel.hideScene).toHaveBeenCalledTimes(1);
        scene.focus();
        await user.keyboard('{Escape}');
        expect(panel.hideScene).toHaveBeenCalledTimes(2);
        unmount();

        // Put away: a banner brings it back.
        panel = { ...basePanel(), ...running, sceneOpen: false };
        render(<TeamChallenge />);
        expect(screen.queryByRole('dialog')).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Watch it' }));
        expect(panel.showScene).toHaveBeenCalled();
    });

    it('says a put-away battle has finished, once it has', () => {
        panel = { ...basePanel(), phase: 'result', battleId: 'b1', inBattle: true, sceneOpen: false };
        render(<TeamChallenge />);
        expect(screen.getByText(/Your team battle has finished/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'See the result' })).toBeInTheDocument();
    });

    it('names the defenders the verified result reveals', async () => {
        const user = userEvent.setup();
        const fighter = (side: 0 | 1, slot: number, petId: string) => ({
            side, slot, petId, owner: '0x', dna: '1', level: 10, rarity: 1, skill: 99, tactic: 'focus',
            col: 2, row: slot, x: side === 0 ? 2 : 3, startHp: 100,
        });
        const result = {
            receipt: { progression: [0, 1, 2, 3, 4, 5].map(() => ({ xpAwarded: 10 })) },
            playback: {
                fighters: [
                    [fighter(0, 0, '1'), fighter(0, 1, '2'), fighter(0, 2, '3')],
                    [fighter(1, 0, '70'), fighter(1, 1, '71'), fighter(1, 2, '72')],
                ],
                frames: [],
            },
            summary: { attackerWon: false, rounds: 3, damage: [[0, 0, 0], [0, 0, 0]], knockouts: [[0, 0, 0], [0, 0, 0]], mvp: null },
        };
        panel = { ...basePanel(), phase: 'result', battleId: 'b1', battleState: 'signed', result, inBattle: true, sceneOpen: true };
        render(<TeamChallenge />);

        expect(screen.getByRole('heading', { name: 'DEFEATED' })).toBeInTheDocument();
        expect(screen.getByText('Fang')).toBeInTheDocument();
        expect(screen.getByText('Pet 71')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /New Challenge/ }));
        expect(reset).toHaveBeenCalled();
    });

    it('offers the way back after a failed battle', async () => {
        const user = userEvent.setup();
        panel = {
            ...basePanel(),
            phase: 'failed',
            battleId: 'b1',
            battleState: 'expired',
            failureReason: 'the defender plan expired',
            inBattle: true,
            sceneOpen: true,
        } as never;
        render(<TeamChallenge />);
        expect(screen.getByRole('dialog')).toHaveTextContent('This battle did not finish: the defender plan expired.');
        await user.click(screen.getByRole('button', { name: 'Back to the arena' }));
        expect(reset).toHaveBeenCalledTimes(1);
        // Escape after a failure means the same: back to the arena.
        screen.getByRole('dialog').focus();
        await user.keyboard('{Escape}');
        expect(reset).toHaveBeenCalledTimes(2);
    });
});
