import type { WireBattleReceipt, WireTeamBattleReceipt } from '@cryptopets/protocol';

/**
 * One signed receipt, exactly as the backend's read/corpus endpoints serve it
 * (`backend/API.md`'s `SignedArtifact` / `ReceiptSummary` shapes): the operator's ECDSA
 * signature and the signing key it claims, alongside the receipt payload itself.
 *
 * The signature and `receiptHash` live outside `BattleReceipt` on purpose — the protocol
 * package defines what a receipt *is*, not how an operator's signature over one is
 * transported, so that stays a wire-layer concern here rather than a protocol-schema one.
 */
export interface SignedReceiptEnvelope {
    receiptHash: string;
    signature: string;
    signingKeyId: string;
    /** A duel receipt, or a team battle receipt (schema version 2). */
    payload: WireBattleReceipt | WireTeamBattleReceipt;
}

/**
 * One entry the verifier is willing to trust as having produced a given signature, as
 * published by `GET /api/battle/signing-keys` (§G) — or supplied by hand for fully
 * offline verification. `notBefore`/`notAfter` are optional because a hand-written key
 * file may simply omit a validity window; when present, `checkOperatorSignature` holds
 * the receipt's own `createdAt` to it.
 */
export interface TrustedSigningKey {
    keyId: string;
    /** EVM address form; compared case-insensitively. */
    address: string;
    notBefore?: number;
    notAfter?: number | null;
}
