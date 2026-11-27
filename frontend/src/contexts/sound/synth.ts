/**
 * Game sound effects, synthesised with the Web Audio API so the app ships no audio files.
 *
 * The AudioContext is created on the first `play`, which always follows a click: browsers
 * refuse to start audio before the page has had a user gesture, and creating the context
 * early only produces a suspended one and a console warning.
 */
export type SoundName = 'tap' | 'success' | 'error' | 'heartbeat' | 'hit' | 'crit' | 'magic' | 'victory' | 'defeat';

type Tone = {
    kind?: 'tone';
    freq: number;
    /** Seconds. */
    dur: number;
    type: OscillatorType;
    vol: number;
    /** Frequency to glide to by the end of the note. */
    slide?: number;
    /** Seconds after the sound starts. */
    delay?: number;
};

/** A burst of filtered white noise: the impact part of a hit. */
type Noise = { kind: 'noise'; dur: number; vol: number; band: number; delay?: number };

type Note = Tone | Noise;

const arpeggio = (freqs: number[], step: number, dur = 0.22, vol = 0.14): Note[] =>
    freqs.map((freq, i) => ({ freq, dur, type: 'triangle', vol, delay: i * step }));

const SOUNDS: Record<SoundName, Note[]> = {
    tap: [{ freq: 720, dur: 0.07, type: 'triangle', vol: 0.12 }],
    success: arpeggio([523, 659, 784, 1047], 0.07),
    error: [
        { freq: 220, dur: 0.18, type: 'square', vol: 0.07, slide: 150 },
        { freq: 165, dur: 0.24, type: 'square', vol: 0.07, slide: 110, delay: 0.12 },
    ],
    heartbeat: [
        { freq: 62, dur: 0.2, type: 'sine', vol: 0.5, slide: 42 },
        { freq: 84, dur: 0.14, type: 'sine', vol: 0.35, slide: 50, delay: 0.17 },
    ],
    hit: [
        { kind: 'noise', dur: 0.13, vol: 0.35, band: 900 },
        { freq: 150, dur: 0.1, type: 'square', vol: 0.08, slide: 70 },
    ],
    crit: [
        { kind: 'noise', dur: 0.18, vol: 0.45, band: 2400 },
        { freq: 1320, dur: 0.2, type: 'sawtooth', vol: 0.08, slide: 1980 },
        { freq: 880, dur: 0.3, type: 'triangle', vol: 0.14, slide: 1760, delay: 0.05 },
    ],
    magic: [{ freq: 380, dur: 0.38, type: 'sine', vol: 0.14, slide: 1300 }],
    victory: arpeggio([523, 659, 784, 1047, 1319], 0.1, 0.3, 0.16),
    defeat: arpeggio([392, 330, 262], 0.16, 0.34, 0.13),
};

export type Synth = { play: (name: SoundName) => void };

type AudioContextCtor = typeof AudioContext;
type Audio = { ctx: AudioContext; out: GainNode };

const playTone = ({ ctx, out }: Audio, n: Tone) => {
    const t = ctx.currentTime + (n.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = n.type;
    osc.frequency.setValueAtTime(n.freq, t);
    if (n.slide) osc.frequency.exponentialRampToValueAtTime(n.slide, t + n.dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(n.vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + n.dur + 0.05);
};

const playNoise = ({ ctx, out }: Audio, n: Noise) => {
    const t = ctx.currentTime + (n.delay ?? 0);
    const length = Math.max(1, Math.floor(ctx.sampleRate * n.dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Fades out across the buffer, so the burst has a natural tail rather than a click.
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = n.band;
    gain.gain.value = n.vol;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(t);
};

export const createSynth = (): Synth => {
    let audio: Audio | null = null;

    const ready = (): Audio | null => {
        if (audio) {
            if (audio.ctx.state === 'suspended') void audio.ctx.resume();
            return audio;
        }
        const Ctor: AudioContextCtor | undefined =
            globalThis.AudioContext ??
            (globalThis as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
        if (!Ctor) return null;
        try {
            const ctx = new Ctor();
            const out = ctx.createGain();
            out.gain.value = 0.5;
            out.connect(ctx.destination);
            audio = { ctx, out };
            return audio;
        } catch {
            return null;
        }
    };

    return {
        play: (name) => {
            const a = ready();
            if (!a) return;
            for (const n of SOUNDS[name]) {
                if (n.kind === 'noise') playNoise(a, n);
                else playTone(a, n);
            }
        },
    };
};
