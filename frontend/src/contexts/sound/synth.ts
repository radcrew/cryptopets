/**
 * Game sound effects, synthesised with the Web Audio API so the app ships no audio files.
 *
 * The AudioContext is created on the first `play`, which always follows a click: browsers
 * refuse to start audio before the page has had a user gesture, and creating the context
 * early only produces a suspended one and a console warning.
 */
export type SoundName = 'tap' | 'success' | 'error';

type Note = {
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

const arpeggio = (freqs: number[], step: number): Note[] =>
    freqs.map((freq, i) => ({ freq, dur: 0.22, type: 'triangle', vol: 0.14, delay: i * step }));

const SOUNDS: Record<SoundName, Note[]> = {
    tap: [{ freq: 720, dur: 0.07, type: 'triangle', vol: 0.12 }],
    success: arpeggio([523, 659, 784, 1047], 0.07),
    error: [
        { freq: 220, dur: 0.18, type: 'square', vol: 0.07, slide: 150 },
        { freq: 165, dur: 0.24, type: 'square', vol: 0.07, slide: 110, delay: 0.12 },
    ],
};

export type Synth = { play: (name: SoundName) => void };

type AudioContextCtor = typeof AudioContext;

export const createSynth = (): Synth => {
    let ctx: AudioContext | null = null;
    let out: GainNode | null = null;

    const ready = (): { ctx: AudioContext; out: GainNode } | null => {
        if (ctx && out) {
            if (ctx.state === 'suspended') void ctx.resume();
            return { ctx, out };
        }
        const Ctor: AudioContextCtor | undefined =
            globalThis.AudioContext ??
            (globalThis as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
        if (!Ctor) return null;
        try {
            ctx = new Ctor();
            out = ctx.createGain();
            out.gain.value = 0.5;
            out.connect(ctx.destination);
            return { ctx, out };
        } catch {
            ctx = null;
            out = null;
            return null;
        }
    };

    const note = (audio: { ctx: AudioContext; out: GainNode }, n: Note) => {
        const t = audio.ctx.currentTime + (n.delay ?? 0);
        const osc = audio.ctx.createOscillator();
        const gain = audio.ctx.createGain();
        osc.type = n.type;
        osc.frequency.setValueAtTime(n.freq, t);
        if (n.slide) osc.frequency.exponentialRampToValueAtTime(n.slide, t + n.dur);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(n.vol, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
        osc.connect(gain);
        gain.connect(audio.out);
        osc.start(t);
        osc.stop(t + n.dur + 0.05);
    };

    return {
        play: (name) => {
            const audio = ready();
            if (audio) SOUNDS[name].forEach((n) => note(audio, n));
        },
    };
};
