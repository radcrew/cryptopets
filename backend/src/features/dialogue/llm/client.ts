import { generateObject, streamObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '@config/env';
import type { Persona } from './persona';
import {
    SYSTEM_PROMPT,
    TAUNT_SYSTEM_PROMPT,
    JSON_FORMAT_INSTRUCTION,
    TAUNT_JSON_FORMAT_INSTRUCTION,
    buildUserMessage,
    buildTauntUserMessage,
} from './prompt';
import { ResponseSchema, TurnSchema, MAX_TURNS, TAUNT_TURNS } from '../dialogue.schema';
import type { DialogueTurn, GenerateDialogueInput } from '../dialogue.types';

/** True when an HF token is configured (generation can run). */
export function isHuggingFaceConfigured(): boolean {
    return Boolean(env.hf.apiToken);
}

function hfModel() {
    // .chat() targets /v1/chat/completions — HF router uses chat completions, not the Responses API
    return createOpenAI({ apiKey: env.hf.apiToken ?? '', baseURL: env.hf.baseUrl }).chat(env.hf.model);
}

async function generate(system: string, user: string): Promise<DialogueTurn[]> {
    // output: 'no-schema' makes the OpenAI provider send response_format
    // { type: 'json_object' } — JSON mode without a grammar. The HF router rejects
    // the json_schema grammar, but json_object still constrains the decoder to emit
    // syntactically valid JSON, so we get back a parseable object every time. We
    // validate the shape ourselves with ResponseSchema.
    const { object } = await generateObject({
        model: hfModel(),
        output: 'no-schema',
        maxOutputTokens: env.hf.maxOutputTokens,
        temperature: 0.8,
        maxRetries: 1,
        system,
        prompt: user,
    });
    const result = ResponseSchema.parse(object);
    // Clamp over-produced turns instead of failing the parse. The settled path
    // caps here; the taunt path trims further to TAUNT_TURNS in its caller.
    return result.turns.slice(0, MAX_TURNS) as DialogueTurn[];
}

export async function requestDialogue(
    input: GenerateDialogueInput,
    attacker: Persona,
    defender: Persona,
    rivalry?: string,
    banter?: string,
    intensity?: string,
): Promise<DialogueTurn[]> {
    if (!isHuggingFaceConfigured()) {
        throw new Error('HF inference is not configured (HF_API_TOKEN unset)');
    }
    return generate(
        `${SYSTEM_PROMPT}\n\n${JSON_FORMAT_INSTRUCTION}`,
        buildUserMessage(input, attacker, defender, rivalry, banter, intensity),
    );
}

/** Pull the (possibly partial) turns array out of a streamed JSON object. */
function readTurns(object: unknown): unknown[] {
    const turns = (object as { turns?: unknown })?.turns;
    return Array.isArray(turns) ? turns : [];
}

/**
 * Normalize raw model turns into displayable taunts: validate each turn, drop
 * any result-phase line (never leak the outcome into pre-fight banter), then cap
 * to a tight back-and-forth. Skips turns that don't yet parse (still streaming).
 */
function finalizeTaunts(rawTurns: unknown[]): DialogueTurn[] {
    const parsed: DialogueTurn[] = [];
    for (const turn of rawTurns) {
        const result = TurnSchema.safeParse(turn);
        if (result.success) parsed.push(result.data as DialogueTurn);
    }
    return parsed.filter((t) => t.phase !== 'result').slice(0, TAUNT_TURNS);
}

/**
 * Generate pre-fight taunts as a stream: yields the cumulative, normalized taunt
 * list each time a new turn finalizes, so the client can reveal lines as they
 * generate. Returns the complete list when the stream ends.
 *
 * A turn is "final" once a later one has started (the model is mid-text on the
 * last array element), so during the loop we normalize everything but the tail;
 * the closing validated object fills in that last turn.
 */
export async function* streamTaunts(
    attackerName: string,
    defenderName: string,
    attacker: Persona,
    defender: Persona,
    rivalry?: string,
    banter?: string,
): AsyncGenerator<DialogueTurn[], DialogueTurn[]> {
    const result = streamObject({
        model: hfModel(),
        output: 'no-schema',
        maxOutputTokens: env.hf.maxOutputTokens,
        temperature: 0.8,
        maxRetries: 1,
        system: `${TAUNT_SYSTEM_PROMPT}\n\n${TAUNT_JSON_FORMAT_INSTRUCTION}`,
        prompt: buildTauntUserMessage(attackerName, defenderName, attacker, defender, rivalry, banter),
    });

    let emitted = 0;
    for await (const partial of result.partialObjectStream) {
        const raw = readTurns(partial);
        // The last element may still be streaming its text — only settle the rest.
        const settled = finalizeTaunts(raw.slice(0, Math.max(0, raw.length - 1)));
        if (settled.length > emitted) {
            emitted = settled.length;
            yield settled;
        }
    }

    return finalizeTaunts(ResponseSchema.parse(await result.object).turns);
}
