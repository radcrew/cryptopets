import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// jsdom has no Web Audio, so the synth is a spy: these tests are about which cue plays when.
const play = vi.fn();
vi.mock('@contexts/sound/synth', () => ({ createSynth: () => ({ play }) }));

const pulse = { round: 100, nextBeatAt: 0 };
vi.mock('@shared/core', () => ({ usePulseRound: () => pulse }));

import { SoundProvider } from '@contexts/sound';
import Celebration from '@components/game/celebration';
import ComingSoon from '@components/game/coming-soon';
import LedgerStone, { type LedgerRecord } from '@components/game/ledger-stone';
import PulseMoment from '@components/game/pulse-moment';
import ResultStamp from '@components/game/result-stamp';
import StrikePop, { type StrikeCue } from '@components/game/strike-pop';
import { strikeLabel } from '@components/game/strike-pop/label';

const withSound = (ui: React.ReactNode) => <SoundProvider>{ui}</SoundProvider>;

const cue = (over: Partial<StrikeCue> = {}): StrikeCue => ({
    id: 1,
    damage: '42',
    crit: false,
    magic: false,
    label: null,
    ...over,
});

beforeEach(() => {
    localStorage.clear();
    play.mockClear();
    pulse.round = 100;
});

describe('strikeLabel', () => {
    it('is silent for a plain hit', () => {
        expect(strikeLabel({ crit: false, elementMult: 100 })).toBeNull();
    });

    it('headlines the most dramatic flag when several apply', () => {
        expect(strikeLabel({ crit: true, elementMult: 115, guarded: true })).toBe('Critical');
        expect(strikeLabel({ crit: false, elementMult: 115, guarded: true })).toBe('Guarded');
        expect(strikeLabel({ crit: false, elementMult: 85, combo: 1 })).toBe('Combo ×2');
    });

    it('names the element matchup when nothing louder happened', () => {
        expect(strikeLabel({ crit: false, elementMult: 115 })).toBe('Element edge');
        expect(strikeLabel({ crit: false, elementMult: 85 })).toBe('Resisted');
    });
});

describe('StrikePop', () => {
    it('shows the damage and plays the cue that fits the strike', () => {
        render(withSound(<StrikePop cue={cue({ crit: true, label: 'Critical' })} />));
        expect(screen.getByText('42')).toBeInTheDocument();
        expect(play).toHaveBeenCalledWith('crit');
    });

    it('plays once per strike, not again when the scene re-renders', () => {
        const first = cue({ magic: true });
        const { rerender } = render(withSound(<StrikePop key={first.id} cue={first} />));
        rerender(withSound(<StrikePop key={first.id} cue={first} />));
        expect(play.mock.calls.filter(([name]) => name === 'magic')).toHaveLength(1);

        const next = cue({ id: 2 });
        rerender(withSound(<StrikePop key={next.id} cue={next} />));
        expect(play).toHaveBeenLastCalledWith('hit');
    });
});

describe('ResultStamp', () => {
    it('celebrates a win with its jingle and confetti', () => {
        const { container } = render(withSound(<ResultStamp won>VICTORY!</ResultStamp>));
        expect(screen.getByText('VICTORY!')).toBeInTheDocument();
        expect(play).toHaveBeenCalledWith('victory');
        expect(container.querySelectorAll('i').length).toBeGreaterThan(0);
    });

    it('marks a loss quietly, without confetti', () => {
        const { container } = render(withSound(<ResultStamp won={false}>DEFEATED</ResultStamp>));
        expect(play).toHaveBeenCalledWith('defeat');
        expect(container.querySelectorAll('i')).toHaveLength(0);
    });
});

describe('Celebration', () => {
    it('plays its sound on the reveal, not while the chest is still shut', async () => {
        render(withSound(<Celebration intro="chest" title="Loot!" sub="Lesser Tonic ×2" sound="chest" onClose={() => {}} />));
        expect(play).not.toHaveBeenCalledWith('chest');

        await userEvent.click(screen.getByRole('button', { name: 'Open the chest' }));
        expect(await screen.findByText('Lesser Tonic ×2')).toBeInTheDocument();
        expect(play).toHaveBeenCalledWith('chest');
    });

    it('closes on Escape at any stage, so the egg never stands between a player and the page', async () => {
        const onClose = vi.fn();
        render(withSound(<Celebration intro="egg" title="It hatched!" sound="hatch" onClose={onClose} />));
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalled();
    });
});

describe('ComingSoon', () => {
    it('labels a preview and keeps its mock controls out of reach', () => {
        render(
            <ComingSoon note="Climb fifty floors.">
                <button type="button">Climb</button>
            </ComingSoon>,
        );
        expect(screen.getByRole('region', { name: 'Coming soon: Climb fifty floors.' })).toHaveTextContent('Coming soon');
        // Inside an inert container: browsers make it unclickable and skip it for the keyboard and
        // screen readers. jsdom does not implement inert, so the attribute is what is checked.
        expect(screen.getByText('Climb').closest('[inert]')).not.toBeNull();
    });
});

describe('LedgerStone', () => {
    const record = (checks: LedgerRecord['checks']): LedgerRecord => ({
        battleId: 'b_1',
        sequence: 12,
        round: 4242,
        rounds: 7,
        checks,
    });
    const passing = [
        { check: 'operator-signature', ok: true },
        { check: 'beacon-signature', ok: true },
        { check: 'combat-replay', ok: true },
    ];

    // Reduced motion lights every rune at once, so the reading needs no timers here.
    beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: true })));
    afterEach(() => vi.unstubAllGlobals());

    it('carves the receipt and lights every passed check when read', async () => {
        render(withSound(<LedgerStone record={record(passing)} caption="Rex vs Blaze · won in 7 rounds" />));
        await userEvent.click(screen.getByRole('button', { name: '📜 Ledger Stone' }));

        const stone = screen.getByRole('dialog', { name: 'Ledger Stone #12' });
        expect(stone).toHaveTextContent('drand round #4,242');
        expect(stone).not.toHaveTextContent('passed');

        await userEvent.click(screen.getByRole('button', { name: 'Read the stone' }));
        expect(screen.getByText('The stone holds true')).toBeInTheDocument();
        expect(screen.getAllByText(': passed')).toHaveLength(3);
        expect(play).toHaveBeenCalledWith('success');
        // One receipt cannot check its own link to the one before, so the stone says who does.
        expect(stone).toHaveTextContent('links to #11 before it is checked across the whole ledger');
    });

    it('shows why a check failed, and says the stone is cracked', async () => {
        const failing = [...passing, { check: 'progression', ok: false, detail: 'xp 40 should be 32' }];
        render(withSound(<LedgerStone record={record(failing)} caption="Rex vs Blaze" />));
        await userEvent.click(screen.getByRole('button', { name: '📜 Ledger Stone' }));
        await userEvent.click(screen.getByRole('button', { name: 'Read the stone' }));

        expect(screen.getByText('xp 40 should be 32')).toBeInTheDocument();
        expect(screen.getByText('The stone is cracked')).toBeInTheDocument();
        expect(play).toHaveBeenCalledWith('error');
    });

    it('closes on Escape', async () => {
        render(withSound(<LedgerStone record={record(passing)} caption="Rex vs Blaze" />));
        await userEvent.click(screen.getByRole('button', { name: '📜 Ledger Stone' }));
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('PulseMoment', () => {
    it('beats once per drand round', () => {
        const { rerender } = render(withSound(<PulseMoment />));
        expect(screen.getByText('The Pulse decides this fight')).toBeInTheDocument();

        rerender(withSound(<PulseMoment />));
        pulse.round = 101;
        rerender(withSound(<PulseMoment />));
        expect(play.mock.calls.filter(([name]) => name === 'heartbeat')).toHaveLength(2);
    });
});
