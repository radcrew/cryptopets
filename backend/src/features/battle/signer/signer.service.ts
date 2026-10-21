import {
    assertBattleCommitment,
    assertBattleReceipt,
    type ChainId,
    chainFamily,
    hashBattleCommitment,
    hashBattleReceipt,
    type Hex,
    toBytes,
} from '@cryptopets/protocol';

import { env } from '@config/env';

import { createKmsSigner } from './signer.kms';
import { createLocalSigner } from './signer.local';
import { loadSigningKeys, persistSigningKey, retireInactiveKeys } from './signer.registry';
import {
    type EngineAttestation,
    type SignerAuditEntry,
    type SignerBackend,
    SignerRefusedError,
    type SigningKeyDescriptor,
    type SignRequest,
    type SignResult,
} from './signer.types';

/**
 * The signing service (§G).
 *
 * The digest is always recomputed here from the typed object. That is the load-bearing design
 * choice: a caller cannot ask for a signature over bytes of its own choosing, so a compromised
 * worker can at most get a signature over a *well-formed* commitment or receipt, which the
 * rest of the system can then check. It cannot obtain a signature over anything else at all.
 */

/**
 * One backend per reward domain (§G: "separate keys for EVM and Solana reward domains").
 *
 * Keyed by chain family rather than by chain id: the domain §G means is the settlement
 * environment, so every EVM chain a deployment serves shares one key and Solana has its
 * own. Threat T4 is what this bounds — a stolen key that signs both families compromises
 * both, and the receipts of one are no evidence about the other.
 */
type SignerDomain = 'evm' | 'solana';

const backends = new Map<SignerDomain, SignerBackend>();
let backendError: string | null = null;
const rotatedKeys: SigningKeyDescriptor[] = [];
const auditLog: SignerAuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 1000;

/**
 * Selects a backend from configuration.
 *
 * Refuses to use the in-process key in production. A key sitting in an environment variable on
 * an API host is the thing §G's KMS requirement exists to prevent, and making that a startup
 * failure rather than a warning is the difference between a blocked deploy and a quiet
 * downgrade nobody notices until the incident.
 */
export async function configureSigner(nowSeconds: number): Promise<void> {
    backends.clear();
    backendError = null;

    const domains = servedDomains();
    if (domains.length === 0) {
        backendError = 'no chains configured, so there is no domain to sign for';
        return;
    }

    // Only one domain to sign for means there is nothing to keep separate, so the shared
    // configuration is used as-is. With two, each must be named explicitly — see
    // `keyConfigFor`, which refuses rather than letting them collapse onto one key.
    const shared = domains.length === 1;

    for (const domain of domains) {
        try {
            backends.set(domain, await createDomainSigner(domain, shared, nowSeconds));
        } catch (error) {
            // One domain failing leaves the others unconfigured too: a partially-signing
            // deployment would accept battles on one chain and silently stall them on the
            // other, which is harder to notice than not starting.
            backends.clear();
            backendError = `${domain}: ${(error as Error).message}`;
            return;
        }
    }
}

/** The chain families this deployment serves, deduplicated. */
function servedDomains(): SignerDomain[] {
    const families = new Set<SignerDomain>();
    for (const chainId of env.battle.chainIds) {
        families.add(chainFamily(chainId as ChainId));
    }
    return [...families];
}

/**
 * Resolves one domain's key configuration.
 *
 * Refuses to fall back to the shared values when more than one domain is served, which is
 * the whole point of §G's separation: a fallback there would silently hand both chains the
 * same key, and the deployment would look correctly configured while having exactly the
 * blast radius T4 describes.
 */
function keyConfigFor(
    domain: SignerDomain,
    shared: boolean,
): { keyId: string; privateKey: string | undefined; kmsKeyId: string | undefined } {
    const specific = env.battleSigner.domains[domain];
    if (shared) {
        return {
            keyId: specific.keyId ?? env.battleSigner.keyId,
            privateKey: specific.privateKey ?? env.battleSigner.privateKey,
            kmsKeyId: specific.kmsKeyId ?? env.battleSigner.kmsKeyId,
        };
    }

    if (!specific.keyId) {
        throw new Error(
            `this deployment serves more than one chain family, so ${domain} needs its own signing key ` +
                `(set BATTLE_SIGNER_${domain.toUpperCase()}_KEY_ID). §G requires separate keys per reward ` +
                'domain: one key across both means a compromise of either is a compromise of both.',
        );
    }
    return { keyId: specific.keyId, privateKey: specific.privateKey, kmsKeyId: specific.kmsKeyId };
}

async function createDomainSigner(
    domain: SignerDomain,
    shared: boolean,
    nowSeconds: number,
): Promise<SignerBackend> {
    const { kmsProvider, kmsRegion } = env.battleSigner;
    const { keyId, privateKey, kmsKeyId } = keyConfigFor(domain, shared);

    if (kmsProvider) {
        return createKmsSigner({
            provider: kmsProvider,
            keyId,
            // The KMS's own identifier, kept separate from the `keyId` receipts carry: that
            // one is ours and stays stable across a re-import or a move between accounts,
            // while this is an ARN that does not.
            kmsKeyId: kmsKeyId ?? keyId,
            region: kmsRegion,
            notBefore: nowSeconds,
        });
    }

    if (!privateKey) {
        throw new Error('no signing backend configured (set BATTLE_SIGNER_KMS_PROVIDER, or a dev key locally)');
    }
    if (env.isProduction) {
        throw new Error(
            'refusing to use BATTLE_SIGNER_PRIVATE_KEY in production; the signing key must live in a KMS (§G)',
        );
    }
    return createLocalSigner({ keyId, privateKey, notBefore: nowSeconds });
}

/**
 * Registers a key that is no longer signing but must stay published for verification.
 *
 * Writes through to storage as well as memory. The in-memory copy keeps `listSigningKeys`
 * synchronous, which matters because it runs on every receipt verification; the persisted
 * copy is what survives a restart.
 *
 * Persistence is best-effort here so a database blip cannot fail a rotation half-way — but
 * an unpersisted key is a real gap, so it is logged loudly rather than swallowed. Rerunning
 * `registerRotatedKey` is idempotent and is the fix.
 */
export function registerRotatedKey(key: SigningKeyDescriptor): void {
    if (!rotatedKeys.some((existing) => existing.keyId === key.keyId)) {
        rotatedKeys.push(key);
    }
    void persistSigningKey(key).catch((error: unknown) => {
        console.error(
            `[battle-signer] failed to persist rotated key ${key.keyId}: ${(error as Error).message}. ` +
                'It is published by this process but will not survive a restart; re-register it once the database is reachable.',
        );
    });
}

/**
 * Reloads every key this deployment has ever used from storage.
 *
 * Called at startup, after `configureSigner`, so a restart republishes the keys that signed
 * historical receipts instead of quietly forgetting them. Without this the registry was only
 * ever as old as the process, and a rotated key disappeared on the next deploy — making its
 * receipts unverifiable rather than invalid, which is the failure §H exists to prevent.
 */
export async function loadPersistedSigningKeys(): Promise<void> {
    const active = [...backends.values()].map((entry) => entry.key);
    for (const key of active) {
        // Recorded on every boot, so every key currently signing is in the registry even if
        // it is never explicitly rotated out later.
        await persistSigningKey(key);
    }

    const activeIds = new Set(active.map((key) => key.keyId));
    // Before reading them back, close the window on anything that has stopped signing (§G).
    // A rotation is only observable here — the process that stops using a key is the one
    // that never mentions it again — so a boot with a new key configured is exactly when
    // the old one's validity should end. Left to itself it would stay published as "valid
    // indefinitely" and keep vouching for receipts dated long after it was retired.
    //
    // Skipped when nothing is active, which means `configureSigner` failed rather than that
    // every key was rotated out. Every stored key would then look inactive, including the
    // one this deployment really signs with, and closing its window would make every
    // receipt it signs after the signer recovers fail verification.
    if (activeIds.size > 0) {
        await retireInactiveKeys(activeIds);
    }

    const stored = await loadSigningKeys(activeIds);
    rotatedKeys.length = 0;
    for (const key of stored) {
        if (!activeIds.has(key.keyId)) {
            rotatedKeys.push(key);
            continue;
        }
        // Adopt the persisted `notBefore` for the active key. `configureSigner` stamps it
        // with the current time, because a brand new key really does become valid now — but
        // on every restart after the first that is a *later* time than the key actually
        // started signing, and `persistSigningKey` deliberately never overwrites the stored
        // one. Publishing the in-memory value instead would move the key's validity window
        // forward on each boot, and every receipt signed before that restart would fail the
        // operator-signature check for anyone verifying against the published list: not
        // invalid, unverifiable, which is exactly what §H exists to prevent.
        for (const [domain, entry] of backends) {
            if (entry.key.keyId === key.keyId && key.notBefore < entry.key.notBefore) {
                backends.set(domain, { ...entry, key: { ...entry.key, notBefore: key.notBefore } });
            }
        }
    }
}

/**
 * The key currently signing for one domain, or null when that domain is unconfigured.
 *
 * Takes a chain id rather than defaulting to "the" key, because there is no longer one:
 * asking without saying which domain would have to guess, and a receipt signed under the
 * wrong domain's key is one no verifier can attribute correctly.
 */
export function activeSigningKey(chainId: string): SigningKeyDescriptor | null {
    return backends.get(chainFamily(chainId as ChainId))?.key ?? null;
}

/**
 * Every key a verifier may need, active and retired.
 *
 * Retired keys are never dropped: a receipt signed under a rotated key must still verify, and
 * removing the key would make that receipt unverifiable rather than invalid, which is a
 * different and worse thing (§H item 4).
 */
export function listSigningKeys(): SigningKeyDescriptor[] {
    // Every domain's active key, then everything retired. A verifier is handed the whole
    // set and matches on `signingKeyId`, so it never needs to know how they are partitioned.
    return [...[...backends.values()].map((entry) => entry.key), ...rotatedKeys];
}

/**
 * Why this deployment cannot sign, or null when it can.
 *
 * `configureSigner` records its failure and returns rather than throwing, so the process
 * still boots and keeps serving reads. The cost is that the reason lived only in here: a
 * caller that finds no active key could say "no active signing key" and nothing about why,
 * which is a misconfiguration reported as a mystery.
 */
export function signerBackendError(): string | null {
    return backendError;
}

/** The signer's own audit trail, newest last. Reconciled against the KMS log during an incident. */
export function signerAuditLog(): SignerAuditEntry[] {
    return [...auditLog];
}

/** Clears state. Tests only. */
export function resetSigner(): void {
    backends.clear();
    backendError = null;
    rotatedKeys.length = 0;
    auditLog.length = 0;
}

/**
 * Signs a commitment or a receipt.
 *
 * Receipts additionally require an attestation from every configured attester, all naming the
 * same receipt hash. That is §F's circuit breaker expressed as a precondition: if the engine
 * and the independent verifier have not both agreed, there is no way to obtain a signature,
 * so a mismatch cannot be signed past by mistake.
 */
export async function sign(request: SignRequest, nowSeconds: number): Promise<SignResult> {
    let digest: Hex;
    // Validated before the domain is read, so a malformed object is refused as malformed
    // rather than as an unknown domain — the first is the true description, and it is the
    // one an operator can act on.
    let chainId: string;
    try {
        if (request.kind === 'commitment') {
            const commitment = assertBattleCommitment(request.commitment);
            digest = hashBattleCommitment(commitment);
            chainId = commitment.domain.chainId;
        } else {
            const receipt = assertBattleReceipt(request.receipt);
            digest = hashBattleReceipt(receipt);
            chainId = receipt.domain.chainId;
        }
    } catch (error) {
        // An object that does not validate never reaches the key. The signer is the last place
        // that can still refuse a malformed receipt, and after it there is only history.
        return refuse('invalid-payload', (error as Error).message, nowSeconds);
    }

    // The key is chosen by the object's *own* domain, never by a caller argument. A caller
    // that could name the key would be able to sign an EVM receipt with the Solana key,
    // which is precisely the domain separation §G asks for, undone from the inside.
    const domain = chainFamily(chainId as ChainId);
    const backend = backends.get(domain);
    if (!backend) {
        return refuse(
            'signer-not-configured',
            backendError ?? `no signing key configured for the ${domain} domain`,
            nowSeconds,
        );
    }

    if (request.kind === 'receipt') {
        const problem = checkAttestations(request.attestations, digest, nowSeconds);
        if (problem) {
            return refuse(problem.reason, problem.detail, nowSeconds);
        }
    }

    const signature = await backend.sign(toBytes(digest));
    record({
        at: nowSeconds,
        kind: request.kind,
        keyId: backend.key.keyId,
        digest,
        outcome: 'signed',
    });
    return { kind: request.kind, digest, signature, keyId: backend.key.keyId };
}

/**
 * Checks that every required attester has vouched for exactly this receipt.
 *
 * Matching on the receipt hash rather than on a battle id matters: an attestation for an
 * earlier version of the same battle's receipt must not carry over, since the point of the
 * attestation is that a specific set of bytes was recomputed and agreed with.
 */
function checkAttestations(
    attestations: readonly EngineAttestation[],
    digest: Hex,
    nowSeconds: number,
): { reason: 'missing-attestation' | 'attestation-mismatch' | 'stale-attestation'; detail: string } | null {
    const required = env.battleSigner.requiredAttesters;
    for (const attester of required) {
        const match = attestations.find((a) => a.attester === attester);
        if (!match) {
            return {
                reason: 'missing-attestation',
                detail: `no attestation from ${attester} (required: ${required.join(', ')})`,
            };
        }
        if (match.receiptHash.toLowerCase() !== digest.toLowerCase()) {
            return {
                reason: 'attestation-mismatch',
                detail: `${attester} attested to ${match.receiptHash}, but this receipt hashes to ${digest}`,
            };
        }
        if (match.attestedAt > nowSeconds + 60) {
            return { reason: 'stale-attestation', detail: `${attester} attestation is dated in the future` };
        }
    }
    return null;
}

function refuse(
    reason: SignerRefusedError['reason'],
    detail: string,
    nowSeconds: number,
): never {
    record({ at: nowSeconds, kind: 'refused', keyId: null, digest: null, outcome: 'refused', detail });
    throw new SignerRefusedError(reason, detail);
}

function record(entry: SignerAuditEntry): void {
    auditLog.push(entry);
    if (auditLog.length > MAX_AUDIT_ENTRIES) {
        auditLog.shift();
    }
}
