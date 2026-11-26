import { render, screen, within } from '@testing-library/react';
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

import TeamPetGrid from '@components/pet/interactions/panels/team/team-pet-grid';
import TeamPlan from '@components/pet/interactions/panels/team/team-plan';
import TeamBattleScene from '@components/pet/interactions/panels/team/team-battle-scene';

beforeEach(() => {
    vi.clearAllMocks();
    save.mockResolvedValue('0xplan');
});

describe('TeamPlan', () => {
    it('saves the three chosen pets in the order they were added', async () => {
        const user = userEvent.setup();
        render(<TeamPlan />);
        const saveButton = screen.getByRole('button', { name: 'Save team' });
        expect(saveButton).toBeDisabled();

        for (const id of ['1', '2', '3']) {
            await user.click(screen.getByRole('button', { name: `Pet ${id}, level 10` }));
        }
        // A full team takes no fourth pet until one is taken out.
        expect(screen.getByRole('button', { name: 'Pet 4, level 10' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Pet 1, level 10' }));
        await user.click(screen.getByRole('button', { name: 'Pet 4, level 10' }));
        await user.click(saveButton);

        expect(saveCall().roster.map((e) => e.petId)).toEqual(['2', '3', '4']);
        expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
    });

    it('shows the selected pet in the details panel, moves it to an empty tile, and saves the tactic set there', async () => {
        const user = userEvent.setup();
        render(<TeamPlan />);
        for (const id of ['1', '2', '3']) {
            await user.click(screen.getByRole('button', { name: `Pet ${id}, level 10` }));
        }
        const details = screen.getByRole('complementary', { name: 'Pet details' });
        expect(details).toHaveTextContent(/select a pet/i);

        await user.click(screen.getByRole('button', { name: 'Pet 1, front column, middle row' }));
        expect(details).toHaveTextContent('Pet 1');
        // DNA 1 at rarity 1 and level 10 has every stat gene at 0: HP is 100 + 6 * 10, ATK 10 + 2 * 10.
        expect(within(details).getByRole('list', { name: 'Base stats' })).toHaveTextContent('160HP30ATK');

        await user.click(screen.getByRole('button', { name: 'Move here: back column, top row' }));
        expect(screen.getByRole('button', { name: 'Pet 1, back column, top row' })).toBeInTheDocument();
        expect(details).toHaveTextContent('Back column, top row');

        await user.selectOptions(within(details).getByRole('combobox'), 'breaker');
        await user.click(screen.getByRole('button', { name: 'Save team' }));
        expect(saveCall().roster[0]).toMatchObject({ petId: '1', col: 0, row: 0, tactic: 'breaker' });
    });

    it('signs the challenge rules with the team, and refuses a level range the wrong way round', async () => {
        const user = userEvent.setup();
        render(<TeamPlan />);
        for (const id of ['1', '2', '3']) {
            await user.click(screen.getByRole('button', { name: `Pet ${id}, level 10` }));
        }
        const rules = screen.getByRole('region', { name: 'Challenge rules' });
        const lowest = within(rules).getByRole('spinbutton', { name: 'Lowest challenger level' });
        const highest = within(rules).getByRole('spinbutton', { name: 'Highest challenger level' });
        const saveButton = screen.getByRole('button', { name: 'Save team' });

        await user.clear(highest);
        await user.type(highest, '20');
        await user.clear(lowest);
        await user.type(lowest, '30');
        expect(within(rules).getByRole('alert')).toHaveTextContent('The lowest challenger level is above the highest.');
        expect(saveButton).toBeDisabled();

        await user.clear(lowest);
        await user.type(lowest, '10');
        const perDay = within(rules).getByRole('spinbutton', { name: 'Battles per day' });
        await user.clear(perDay);
        await user.type(perDay, '5');
        await user.selectOptions(within(rules).getByRole('combobox', { name: 'Valid for' }), '7');
        expect(within(rules).queryByRole('alert')).toBeNull();
        await user.click(saveButton);

        expect(saveCall()).toMatchObject({ minLevel: 10, maxLevel: 20, maxBattlesPerDay: 5, days: 7 });
    });

    it('checks the formation as pets are placed and moved', async () => {
        const user = userEvent.setup();
        render(<TeamPlan />);
        const check = screen.getByRole('region', { name: 'Formation check' });
        expect(check).toHaveTextContent(/add pets/i);

        for (const id of ['1', '2', '3']) {
            await user.click(screen.getByRole('button', { name: `Pet ${id}, level 10` }));
        }
        // Equal pets act in slot order, and all three start on the front column.
        expect(within(check).getByRole('list', { name: 'Turn order' })).toHaveTextContent('1st Pet 12nd Pet 23rd Pet 3');
        expect(check).toHaveTextContent('Pet 1, Pet 2 and Pet 3 share the front line');

        await user.click(screen.getByRole('button', { name: 'Pet 1, front column, middle row' }));
        await user.click(screen.getByRole('button', { name: 'Move here: back column, top row' }));
        expect(check).toHaveTextContent('Pet 2 and Pet 3 share the front line');
    });
});

describe('TeamPetGrid', () => {
    const pet = (id: string, readyAt = 0) => ({ id, name: `Pet ${id}`, level: 10, dna: 1n, rarity: 1, readyAt }) as never;

    it('takes a chosen pet out when it is tapped again, and numbers the chosen ones in order', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        render(<TeamPetGrid label="Your pets" pets={[pet('1'), pet('2')]} selected={['2', '1']} max={3} onToggle={onToggle} />);
        const first = screen.getByRole('button', { name: 'Pet 1, level 10' });
        expect(first).toHaveAttribute('aria-pressed', 'true');
        expect(first).toHaveTextContent('2');
        await user.click(first);
        expect(onToggle).toHaveBeenCalledWith('1');
    });

    it('shows resting pets but refuses them for a squad that fights now', () => {
        const resting = Math.floor(Date.now() / 1000) + 3600;
        render(<TeamPetGrid label="Your pets" pets={[pet('1'), pet('2', resting)]} selected={[]} max={3} blockResting onToggle={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Pet 1, level 10' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Pet 2, level 10, resting' })).toBeDisabled();
    });
});

function saveCall() {
    return save.mock.calls[0]![0] as { roster: { petId: string }[]; minLevel: number; maxLevel: number; maxBattlesPerDay: number; days: number };
}

describe('TeamBattleScene', () => {
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

    it('plays the fight on the map, then shows the verified result with the MVP and each fighter XP', async () => {
        const user = userEvent.setup();
        const onDone = vi.fn();
        render(
            <TeamBattleScene
                phase="result"
                status={null}
                lineup={[]}
                result={result}
                name={name}
                rivalLabel="Their team"
                onDone={onDone}
                stepMs={60000}
            />,
        );
        expect(screen.getByRole('img', { name: 'Battle map' })).toBeInTheDocument();
        expect(screen.getByText(/first blow/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Skip to result' }));
        expect(screen.getByRole('heading', { name: 'VICTORY!' })).toBeInTheDocument();
        expect(screen.getByText('Your squad won in 1 round.')).toBeInTheDocument();
        expect(screen.getByText(/Mine 1.*MVP/)).toBeInTheDocument();
        expect(screen.getByText('+41')).toBeInTheDocument();
        expect(screen.getByText('Round 1')).toBeInTheDocument();
        expect(screen.getByText('Mine 1 hits Theirs 0 for 100. Theirs 0 is knocked out.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /New Challenge/ }));
        expect(onDone).toHaveBeenCalled();
    });

    it('shows your squad lined up and the defenders hidden while the battle is not yet fought', () => {
        const art = { id: '1', chain: 'evm' as const, dna: 1n, name: 'Mine 0' };
        const lineup = [{ side: 0 as const, slot: 0, x: 2, row: 1, art, name: 'Mine 0', hp: 1, startHp: 1, note: 'Focus' }];
        render(
            <TeamBattleScene
                phase="running"
                status="Fighting…"
                lineup={lineup}
                result={null}
                name={name}
                rivalLabel="Their team"
                onDone={vi.fn()}
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent('Fighting…');
        expect(screen.getByText('Focus')).toBeInTheDocument();
        expect(screen.getByText('Full health')).toBeInTheDocument();
        expect(screen.getByText('Hidden')).toBeInTheDocument();
    });
});
