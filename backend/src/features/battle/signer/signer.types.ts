import type { AnyBattleReceipt, BattleCommitment, Hex } from '@cryptopets/protocol';

/**
 * The signer's shape, and the reason it is shaped this way (§G).
 *
 * The signing key is the one credential in this design that can produce a lie nobody can
 * detect from the outside. So the signer is built to be narrow rather than convenient:
 *
 * - **It never accepts a digest.** Callers pass a typed commitment or receipt, and the signer
 *   re-encodes and hashes it itself. A signer that accepts arbitrary 32 bytes is a signing
 *   oracle, and a stolen credential for one is worth as much as the key itself.
 * - **It signs exactly two kinds of object.** There is no generic state-mutation path, so
 *   there is nothing to widen later without noticing.
 * - **Receipts require attestations.** The engine and the independent verifier must both have
 *   agreed before a result becomes signed history.
 * - **Every request is logged with its digest and key id**, so a KMS audit log can be
 *   reconciled against what the pipeline believes it asked for. Unmatched digests are how a
 *   key compromise is spotted at all.
 */

/** The only two objects this signer will sign. */
export type SignableKind = 'commitment' | 'receipt';

/** One implementation's claim that it computed a result. */
export interface EngineAttestation {
    /** Who computed it, e.g. `typescript-engine` or `go-verifier`. */
    attester: string;
    /** Digest of the receipt the attester agrees with. */
    receiptHash: Hex;
    /** When the attestation was produced, unix seconds. */
    attestedAt: number;
}

/** A key the signer can use, as published for verification. */
export interface SigningKeyDescriptor {
    keyId: string;
    /** Only secp256k1 for now: it keeps on-chain verification of a receipt possible later. */
    algorithm: 'secp256k1';
    /** Uncompressed public key, 0x-hex. */
    publicKey: Hex;
    /** EVM address form, convenient for on-chain checks. */
    address: Hex;
    /** Unix seconds this key became valid. */
    notBefore: number;
    /** Unix seconds it stopped being used, or null while active. */
    notAfter: number | null;
    /**
     * `rotated` and `compromised` keys stay published: historical receipts still verify
     * against them, and removing one would make its receipts unverifiable rather than invalid.
     */
    status: 'active' | 'rotated' | 'compromised';
}

/** What a backend must provide. Deliberately just "sign this digest with this key". */
export interface SignerBackend {
    readonly key: SigningKeyDescriptor;
    /** Signs a 32-byte digest. Returns a 0x-hex signature. */
    sign(digest: Uint8Array): Promise<Hex>;
}

/** A signing request, as the pipeline makes it. */
export type SignRequest =
    | { kind: 'commitment'; commitment: BattleCommitment }
    /** A duel's receipt or a team battle's: the digest is the one its own kind defines. */
    | { kind: 'receipt'; receipt: AnyBattleReceipt; attestations: readonly EngineAttestation[] };

export interface SignResult {
    kind: SignableKind;
    /** What was signed, recomputed by the signer rather than supplied. */
    digest: Hex;
    signature: Hex;
    keyId: string;
}

/** Why a signing request was refused. */
export type SignRefusal =
    | 'signer-not-configured'
    | 'invalid-payload'
    | 'missing-attestation'
    | 'attestation-mismatch'
    | 'stale-attestation';

export class SignerRefusedError extends Error {
    constructor(
        readonly reason: SignRefusal,
        detail: string,
    ) {
        super(`signer refused (${reason}): ${detail}`);
        this.name = 'SignerRefusedError';
    }
}

/** One line of the signer's own audit trail. */
export interface SignerAuditEntry {
    at: number;
    kind: SignableKind | 'refused';
    keyId: string | null;
    digest: Hex | null;
    outcome: 'signed' | 'refused';
    detail?: string;
}
