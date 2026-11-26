import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const save = vi.fn();
const revoke = vi.fn();
vi.mock('@shared/core', async () => ({
    ...(await vi.importActual<object>('@shared/core')),
    usePetList: () => ({
        pets: ['1', '2', '3', '4', '5', '6'].map((id) => ({ id, name: `Pet ${id}`, level: 10, dna: 1n, rarity: 1, readyAt: 0 })),
    }),
    useDefensePlan: () => ({ plan: null, save, revoke, isPending: false, error: null }),
}));

import TeamPlan from '@components/pet/interactions/panels/team/team-plan';
import TeamPlayback from '@components/pet/interactions/panels/team/team-playback';

beforeEach(() => {
    vi.clearAllMocks();
    save.mockResolvedValue('0xplan');
});

describe('TeamPlan', () => {
    it('saves five pets with ranks in list order, after a reorder', async () => {
        const user = userEvent.setup();
        render(<TeamPlan />);
        const saveButton = screen.getByRole('button', { name: 'Save team' });
        expect(saveButton).toBeDisabled();

        for (let i = 0; i < 5; i++) {
            await user.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
        }
        await user.click(screen.getByRole('button', { name: 'Rank Pet 2 higher' }));
        await user.click(saveButton);

        const vars = saveCall();
        expect(vars.roster.map((e: { petId: string; rank: number }) => [e.petId, e.rank])).toEqual([
            ['2', 1],
            ['1', 2],
            ['3', 3],
            ['4', 4],
            ['5', 5],
        ]);
        expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
    });
});

function saveCall() {
    return save.mock.calls[0]![0] as { roster: { petId: string; rank: number }[] };
}

describe('TeamPlayback', () => {
    const fighter = (side: 0 | 1, slot: number) => ({
        side, slot, petId: `${side}${slot}`, owner: '0x', dna: '1', level: 10, rarity: 1, skill: 99, tactic: 'focus' as const,
        col: 2, row: slot, x: side === 0 ? 2 : 3, startHp: 100,
    });
    const strike = { round: 0, side: 0 as const, actor: 1, target: 0, victim: 0, isMagic: false, crit: false, damage: 100, elementMult: 100,
        combo: 0, longShot: false, furyTriggered: false, temperament: false, exposed: false, guarded: false, secondChance: false,
        knockedOut: true, heal: 0, healed: null, victimHpAfter: 0 };
    const result = {
        receipt: { progression: [{ xpAwarded: 40 }, { xpAwarded: 41 }, { xpAwarded: 42 }, { xpAwarded: 5 }, { xpAwarded: 6 }, { xpAwarded: 7 }] },
        playback: {
            fighters: [[fighter(0, 0), fighter(0, 1), fighter(0, 2)], [fighter(1, 0), fighter(1, 1), fighter(1, 2)]],
            frames: [{ strike, hp: [[100, 100, 100], [0, 100, 100]] }],
        },
        summary: { attackerWon: true, rounds: 1, damage: [[0, 100, 0], [0, 0, 0]], knockouts: [[0, 1, 0], [0, 0, 0]], mvp: { side: 0, slot: 1 } },
    } as never;
    const name = (side: 0 | 1, slot: number) => (side === 0 ? `Mine ${slot}` : `Theirs ${slot}`);

    it('shows the map, then the verified result with the MVP and each fighter XP', async () => {
        const user = userEvent.setup();
        const onDone = vi.fn();
        render(<TeamPlayback result={result} name={name} onDone={onDone} stepMs={60000} />);
        expect(screen.getByRole('img', { name: 'Battle map' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Skip to result' }));
        expect(screen.getByRole('heading', { name: /Victory in 1 round/ })).toBeInTheDocument();
        expect(screen.getByText(/Mine 1.*MVP/)).toBeInTheDocument();
        expect(screen.getByText('+41')).toBeInTheDocument();
        expect(screen.getByText(/Mine 1 hits Theirs 0 for 100\. Theirs 0 is knocked out\./)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'New challenge' }));
        expect(onDone).toHaveBeenCalled();
    });
});
