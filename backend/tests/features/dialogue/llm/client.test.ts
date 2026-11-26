import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@config/env', () => ({
    env: { hf: { apiToken: null, baseUrl: 'http://hf.test', model: 'test-model' }, indexerGrpc: { addr: '' } },
}));
vi.mock('ai', () => ({
    generateObject: vi.fn(),
    streamObject: vi.fn(),
}));
vi.mock('@ai-sdk/openai', () => ({
    createOpenAI: vi.fn(() => ({ chat: vi.fn(() => 'mock-model') })),
}));
vi.mock('../../src/features/dialogue/llm/prompt', () => ({
    SYSTEM_PROMPT: 'SYSTEM',
    TAUNT_SYSTEM_PROMPT: 'TAUNT_SYSTEM',
    JSON_FORMAT_INSTRUCTION: 'JSON_FMT',
    TAUNT_JSON_FORMAT_INSTRUCTION: 'TAUNT_JSON_FMT',
    buildUserMessage: vi.fn(() => 'user msg'),
    buildTauntUserMessage: vi.fn(() => 'taunt msg'),
}));
vi.mock('../../../../src/features/dialogue/dialogue.schema', () => ({
    ResponseSchema: { parse: vi.fn((x: unknown) => x) },
    TurnSchema: { safeParse: vi.fn((t: unknown) => ({ success: true, data: t })) },
    MAX_TURNS: 8,
    TAUNT_TURNS: 4,
}));

async function* makePartialStream(parts: unknown[]) { for (const p of parts) yield p; }

import { env } from '@config/env';
import { generateObject, streamObject } from 'ai';
import { isHuggingFaceConfigured, requestDialogue, streamTaunts } from '../../../../src/features/dialogue/llm/client';
import type { GenerateDialogueInput } from '../../../../src/features/dialogue/dialogue.types';

const input: GenerateDialogueInput = {
    chain: 'evm',
    battleId: 'b1',
    winner: 'attacker',
    attacker: { petId: 'p1', name: 'Rex', level: 5, rarity: 1, dna: '0x', winCount: 3, lossCount: 1 },
    defender: { petId: 'p2', name: 'Blaze', level: 4, rarity: 2, dna: '0x', winCount: 2, lossCount: 2 },
};

const attacker = { name: 'Rex', level: 5, rarity: 1, winCount: 3, lossCount: 0, recentOpponents: [] };
const defender = { name: 'Blaze', level: 4, rarity: 2, winCount: 2, lossCount: 0, recentOpponents: [] };

beforeEach(() => { vi.clearAllMocks(); });

describe('isHuggingFaceConfigured', () => {
    it('returns false when apiToken is null', () => {
        (env.hf as { apiToken: null }).apiToken = null;
        expect(isHuggingFaceConfigured()).toBe(false);
    });

    it('returns true when apiToken is set', () => {
        (env.hf as { apiToken: string }).apiToken = 'hf_tok';
        expect(isHuggingFaceConfigured()).toBe(true);
        (env.hf as { apiToken: null }).apiToken = null;
    });
});

describe('requestDialogue', () => {
    it('throws when HF is not configured', async () => {
        (env.hf as { apiToken: null }).apiToken = null;
        await expect(requestDialogue(input, attacker, defender)).rejects.toThrow('HF inference is not configured');
    });

    it('calls generateObject and returns parsed turns', async () => {
        (env.hf as { apiToken: string }).apiToken = 'hf_tok';
        const turns = [{ speaker: 'attacker', text: 'Hi', phase: 'taunt' }];
        vi.mocked(generateObject).mockResolvedValue({ object: { turns } } as never);

        const result = await requestDialogue(input, attacker, defender);
        expect(generateObject).toHaveBeenCalled();
        expect(result).toEqual(turns);
        (env.hf as { apiToken: null }).apiToken = null;
    });
});

describe('streamTaunts', () => {
    beforeEach(() => {
        (env.hf as { apiToken: string }).apiToken = 'hf_tok';
    });

    afterEach(() => {
        (env.hf as { apiToken: null }).apiToken = null;
    });

    it('yields batches of finalized turns as the stream progresses', async () => {
        const turn1 = { speaker: 'attacker', text: 'Go!', phase: 'taunt' };
        const turn2 = { speaker: 'defender', text: 'Nope', phase: 'taunt' };
        // Two partials: first has only turn1 (settled), second adds turn2 in flight.
        const partials = [{ turns: [turn1, { text: '' }] }, { turns: [turn1, turn2] }];
        const finalObject = Promise.resolve({ turns: [turn1, turn2] });

        vi.mocked(streamObject).mockReturnValue({
            partialObjectStream: makePartialStream(partials),
            object: finalObject,
        } as never);

        const results: unknown[] = [];
        const gen = streamTaunts('Rex', 'Blaze', attacker, defender);
        for await (const batch of gen) results.push(batch);

        expect(streamObject).toHaveBeenCalled();
        expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('returns the final normalized turn list', async () => {
        const turn = { speaker: 'attacker', text: 'Ready!', phase: 'taunt' };
        const finalObject = Promise.resolve({ turns: [turn] });

        vi.mocked(streamObject).mockReturnValue({
            partialObjectStream: makePartialStream([{ turns: [turn] }]),
            object: finalObject,
        } as never);

        const gen = streamTaunts('Rex', 'Blaze', attacker, defender);
        let returnVal: unknown;
        while (true) {
            const step = await gen.next();
            if (step.done) { returnVal = step.value; break; }
        }
        expect(Array.isArray(returnVal)).toBe(true);
    });

    it('filters out result-phase turns from the stream', async () => {
        const resultTurn = { speaker: 'attacker', text: 'I win', phase: 'result' };
        const tauntTurn = { speaker: 'defender', text: 'Fine', phase: 'taunt' };
        const finalObject = Promise.resolve({ turns: [resultTurn, tauntTurn] });

        vi.mocked(streamObject).mockReturnValue({
            partialObjectStream: makePartialStream([]),
            object: finalObject,
        } as never);

        const gen = streamTaunts('Rex', 'Blaze', attacker, defender);
        let returnVal: unknown[] = [];
        while (true) {
            const step = await gen.next();
            if (step.done) { returnVal = step.value as unknown[]; break; }
        }
        expect(returnVal.every((t: unknown) => (t as { phase: string }).phase !== 'result')).toBe(true);
    });

    it('throws a failed request instead of waiting on an object that never settles', async () => {
        const failure = new Error('model_not_found');
        // Mirrors the SDK on a rejected request: the error goes to onError, the partial
        // stream ends quietly, and `object` stays pending.
        vi.mocked(streamObject).mockImplementation(((options: { onError?: (event: { error: unknown }) => void }) => ({
            partialObjectStream: (async function* () {
                options.onError?.({ error: failure });
                yield* [];
            })(),
            object: new Promise(() => {}),
        })) as never);

        const gen = streamTaunts('Rex', 'Blaze', attacker, defender);
        await expect(gen.next()).rejects.toBe(failure);
    });
});
