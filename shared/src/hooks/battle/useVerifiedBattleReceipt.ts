import {
    anyReceiptFromWire,
    assertAnyBattleReceipt,
    isTeamBattleReceipt,
    loadRulesetBundle,
    simulate,
    type AnyBattleReceipt,
    type BattleReceipt,
    type Hex,
    type Ruleset,
    type SimOutcome,
    type WireBattleReceipt,
    type WireTeamBattleReceipt,
} from '@cryptopets/protocol';
import {
    checkBeaconSignature,
    checkCombatReplay,
    checkOperatorSignature,
    checkProgression,
    checkSeedDerivation,
    type CheckResult,
} from '@cryptopets/verifier/checks';
import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../contexts/ApiClientContext';

/**
 * Verifies a signed battle receipt in the browser, then replays the fight from it (§H, §J).
 *
 * The order is the point. Everything animated here comes from *this client's own*
 * simulation of the receipt's inputs, not from a log the backend handed over — so what the
 * player watches is what the receipt commits to, or nothing is shown at all. The served
 * combat-log endpoint is deliberately not fetched for this: the log is regenerable from the
 * snapshot, the seed, and the ruleset, and regenerating it removes a trust dependency
 * instead of adding a round trip.
 *
 * The checks are imported from `@cryptopets/verifier`, the same code the standalone CLI
 * runs, rather than reimplemented against the same spec. A browser that verified receipts
 * its own way would eventually disagree with the public verifier, and §H's whole argument
 * is that it cannot.
 *
 * What is checked, all of it locally:
 *
 * - **operator signature** — the receipt hashes to what it claims and that hash was signed
 *   by a key in the published list.
 * - **drand beacon** — the BLS signature verifies against the pinned quicknet key. This is
 *   what makes commit-before-reveal mean anything; every cheaper check passes equally well
 *   for randomness the operator invented.
 * - **seed derivation** — the seed follows from the receipt's own inputs, so a favourable
 *   one cannot be stapled onto a genuine beacon.
 * - **combat replay** — re-running the fight reproduces the winner, rounds, winner HP, and
 *   the combat-log hash.
 * - **progression** — the XP and level change recomputes.
 *
 * Hash-chain continuity across a *run* of receipts is not checked here: a client holding one
 * receipt has nothing to link it against. That is the standalone verifier's job over the
 * public corpus, and pretending to do it from a single receipt would be theatre.
 */

export interface VerifiedBattleReceipt {
    receipt: BattleReceipt;
    checks: CheckResult[];
    /** True only when every check passed. Anything else means do not animate. */
    verified: boolean;
    /** This client's own replay. The animation source, and only present when verified. */
    outcome: SimOutcome | null;
}

interface SignedArtifactResponse {
    hash: string;
    signature: string;
    signingKeyId: string;
    payload: WireBattleReceipt | WireTeamBattleReceipt;
}

interface SigningKeysResponse {
    keys: { keyId: string; address: string; notBefore?: number; notAfter?: number | null }[];
}

interface RulesetResponse {
    rulesetHash: string;
    bundle: unknown;
}

export function verifiedReceiptQueryKey(battleId: string | null | undefined) {
    return ['battle', 'verified-receipt', battleId] as const;
}

export function useVerifiedBattleReceipt(battleId: string | null | undefined) {
    const apiClient = useApiClient();

    return useQuery({
        queryKey: verifiedReceiptQueryKey(battleId),
        enabled: Boolean(battleId),
        // A signed receipt is immutable once issued, so re-verifying it on a refocus would
        // burn a BLS verification to reach the same answer.
        staleTime: Infinity,
        queryFn: async (): Promise<VerifiedBattleReceipt> => {
            const { receipt, ruleset, checks, verified } = await fetchAndCheckReceipt(apiClient, battleId as string);
            if (isTeamBattleReceipt(receipt)) {
                throw new Error(`battle ${battleId} is a team battle, not a duel`);
            }
            return { receipt, checks, verified, outcome: verified ? replay(receipt, ruleset) : null };
        },
    });
}

/** A receipt of either kind, the bundle it names, and every check run on it. */
export interface CheckedReceipt {
    receipt: AnyBattleReceipt;
    ruleset: Ruleset;
    checks: CheckResult[];
    /** True only when every check passed. */
    verified: boolean;
}

/**
 * Fetches a signed receipt, duel or team, and runs every check above on it.
 *
 * The one place this client checks a receipt. The duel result screen and the Ledger Stones
 * page both come through here, so the two can never tell a player different things about
 * the same battle.
 */
export async function fetchAndCheckReceipt(
    apiClient: ReturnType<typeof useApiClient>,
    battleId: string,
): Promise<CheckedReceipt> {
    const [{ data: artifact }, { data: keys }] = await Promise.all([
        apiClient.get<SignedArtifactResponse>(`/api/battle/${battleId}/receipt`),
        apiClient.get<SigningKeysResponse>('/api/battle/signing-keys'),
    ]);

    const receipt = assertAnyBattleReceipt(anyReceiptFromWire(artifact.payload));
    const envelope = {
        receiptHash: artifact.hash,
        signature: artifact.signature,
        signingKeyId: artifact.signingKeyId,
        payload: artifact.payload,
    };

    const ruleset = await fetchRuleset(apiClient, receipt.rulesetHash);

    const checks = [
        checkOperatorSignature(envelope, receipt, keys.keys),
        checkBeaconSignature(receipt),
        checkSeedDerivation(receipt),
        checkCombatReplay(receipt, ruleset),
        checkProgression(receipt, ruleset),
    ];
    return { receipt, ruleset, checks, verified: checks.every((check) => check.ok) };
}

/**
 * Fetches the bundle the receipt names and confirms it is that bundle.
 *
 * `loadRulesetBundle` recomputes the hash and throws on a mismatch, so the rules replayed
 * against are the ones the receipt committed to, whatever the endpoint chose to serve.
 */
async function fetchRuleset(
    apiClient: ReturnType<typeof useApiClient>,
    rulesetHash: Hex,
): Promise<Ruleset> {
    const { data } = await apiClient.get<RulesetResponse>(`/api/battle/rulesets/${rulesetHash}`);
    return loadRulesetBundle(JSON.stringify(data.bundle), rulesetHash);
}

/**
 * Re-runs the fight the receipt describes.
 *
 * Identical inputs to `checkCombatReplay`, which has already confirmed this reproduces the
 * receipt's result and combat-log hash — so this is the verified fight, not a second opinion
 * about it.
 */
function replay(receipt: BattleReceipt, ruleset: Ruleset): SimOutcome {
    const { attacker, defender } = receipt.snapshot;
    return simulate(
        attacker.dna,
        attacker.rarity,
        attacker.level,
        attacker.skill,
        defender.dna,
        defender.rarity,
        defender.level,
        defender.skill,
        BigInt(receipt.seed),
        ruleset.skillConfig,
    );
}
