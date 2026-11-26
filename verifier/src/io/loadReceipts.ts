import type { WireBattleReceipt, WireTeamBattleReceipt } from '@cryptopets/protocol';

import { readJsonFrom } from './source';
import type { SignedReceiptEnvelope } from './types';
import { firstString, isRecord, requireString } from './util';

/**
 * Loads one or more signed receipts from a local file path or an `http(s)` URL.
 *
 * Accepts every shape the backend actually serves (`backend/API.md`): a single receipt
 * (`GET /api/battle/:battleId/receipt`, `{ hash, signature, signingKeyId, payload }`), a
 * corpus page (`GET /api/receipts/...`, `{ receipts: [...], nextCursor }`), or a bare
 * array of receipt entries — including one saved to a local file by hand.
 */
export async function loadReceipts(source: string): Promise<SignedReceiptEnvelope[]> {
    const json = await readJsonFrom(source);
    return normalizeReceipts(json);
}

function normalizeReceipts(json: unknown): SignedReceiptEnvelope[] {
    if (Array.isArray(json)) {
        return json.map(normalizeOne);
    }
    if (isRecord(json) && Array.isArray(json.receipts)) {
        return json.receipts.map(normalizeOne);
    }
    if (isRecord(json)) {
        return [normalizeOne(json)];
    }
    throw new Error('receipt source did not contain a receipt, a receipt array, or a corpus page');
}

function normalizeOne(value: unknown): SignedReceiptEnvelope {
    if (!isRecord(value)) {
        throw new Error('a receipt entry must be an object');
    }
    // The single-receipt endpoint spells this field `hash`; the corpus routes spell it
    // `receiptHash`. Both are accepted rather than picking one and forcing callers to
    // reshape whichever endpoint they used.
    const receiptHash = firstString(value, ['receiptHash', 'hash']);
    const signature = requireString(value, 'signature');
    const signingKeyId = requireString(value, 'signingKeyId');
    if (!('payload' in value)) {
        throw new Error(`receipt ${receiptHash} is missing its payload`);
    }
    return {
        receiptHash,
        signature,
        signingKeyId,
        payload: value.payload as WireBattleReceipt | WireTeamBattleReceipt,
    };
}
