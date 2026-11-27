import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// jsdom has no Web Audio, so the synth is a spy: these tests are about which cue plays when.
const play = vi.fn();
vi.mock('@contexts/sound/synth', () => ({ createSynth: () => ({ play }) }));

const pulse = { round: 100, nextBeatAt: 0 };
vi.mock('@shared/core', () => ({ usePulseRound: () => pulse }));

import { SoundProvider } from '@contexts/sound';
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
