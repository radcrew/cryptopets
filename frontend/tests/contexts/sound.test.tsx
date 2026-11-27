import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// jsdom has no Web Audio, so the synth is replaced by a spy: these tests are about when a
// sound is asked for, not what it sounds like.
const play = vi.fn();
vi.mock('@contexts/sound/synth', () => ({ createSynth: () => ({ play }) }));

import { SoundProvider, useSound } from '@contexts/sound';

const MuteSwitch = () => {
    const { muted, toggleMuted } = useSound();
    return (
        <button type="button" aria-pressed={!muted} onClick={toggleMuted}>
            Sound
        </button>
    );
};

const renderWithSound = () =>
    render(
        <SoundProvider>
            <MuteSwitch />
            <button type="button">Train</button>
            <button type="button" disabled>
                Breed
            </button>
        </SoundProvider>,
    );

beforeEach(() => {
    localStorage.clear();
    play.mockClear();
});

describe('SoundProvider', () => {
    it('is silent and muted outside the provider, so components still render in isolation', () => {
        render(<MuteSwitch />);
        expect(screen.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('taps when an enabled button is clicked', async () => {
        renderWithSound();
        await userEvent.click(screen.getByRole('button', { name: 'Train' }));
        expect(play).toHaveBeenCalledWith('tap');
    });

    it('stays quiet for a disabled button', async () => {
        renderWithSound();
        await userEvent.click(screen.getByRole('button', { name: 'Breed' }));
        expect(play).not.toHaveBeenCalled();
    });

    it('plays nothing once muted, and remembers the choice across a remount', async () => {
        const { unmount } = renderWithSound();
        await userEvent.click(screen.getByRole('button', { name: 'Sound' }));
        expect(screen.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'false');
        unmount();

        renderWithSound();
        play.mockClear();
        await userEvent.click(screen.getByRole('button', { name: 'Train' }));
        expect(screen.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'false');
        expect(play).not.toHaveBeenCalled();
    });
});
