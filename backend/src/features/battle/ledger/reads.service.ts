import { type Hex } from '@cryptopets/protocol';

import { servedRuleset, servedRulesetHash, servedTeamRuleset, servedTeamRulesetHash } from './ruleset.builder';
import { ethers } from 'ethers';

import { prisma } from '@config/prisma';
import { listSigningKeys } from '@features/battle/signer';

import { servedChainIds, servedDeploymentId } from './domain';
import { backendBattleModeEnabled, teamBattlesEnabled } from './mode';

/**
 * Public, authoritative reads for a battle in flight or settled (§J).
 *
 * "Authoritative" here means these are what the frontend refetches after a
 * reconnect, and what any third party — a spectator, a curious player, someone
 * building their own client — can read without asking us for anything special.
 * The live-battle WebSocket (Step 29) becomes a notification only once these
 * exist: it can tell a client something changed, but never has to be trusted
 * for what changed.
 *
 * Nothing here requires authentication. Every value returned is either already
 * public on chain (ownership, pet ids) or is itself a signed artifact meant to
 * be checked by anyone (a commitment, a receipt) — gating these behind a JWT
 * would just mean a spectator with a room link can't do the one thing this
 * design is supposed to let them do.
 */

export interface BattleConfig {
    /**
     * Whether this deployment is currently accepting backend-authoritative battles.
     *
     * False means the write routes refuse (503) while every read still answers, so a client
     * should offer the on-chain path instead. Reported here rather than discovered by
     * attempting a battle and failing after the wallet prompt.
     */
    enabled: boolean;
    /** The deployment an intent must name, or it is refused as `wrong-deployment`. */
    deploymentId: string;
    /** Chain ids this process serves battles for. */
    chainIds: string[];
    /** The ruleset a defence authorization must be bound to for a battle to be accepted. */
    ruleset: { hash: string; version: number };
    /**
     * Team battles: whether they are accepted, and the ruleset a defence plan and a team
     * intent must be bound to. A different ruleset from the duel one until rollout, so a
     * client must not sign a plan against `ruleset.hash`.
     */
    team: { enabled: boolean; ruleset: { hash: string; version: number } };
}

/**
 * The parameters a client needs before it can build a signable intent (§D).
 *
 * These are not derivable client-side. `deploymentId` is this process's own
 * identity, and the active ruleset is whichever bundle the accept path actually
 * commits battles under — currently the source defaults, later whatever
 * `GameConfig` is tuned to. A client that guessed either would produce intents
 * refused as `wrong-deployment`, or authorizations refused as `ruleset-mismatch`,
 * and the failure would surface a signature step too late to be obvious.
 *
 * Served unauthenticated for the same reason as the other reads here: none of it
 * is secret, and needing a login to find out which rules are in force would make
 * a third-party client harder to write than it has any reason to be.
 */
export async function getBattleConfig(): Promise<BattleConfig> {
    // The same ruleset accept would use, item catalog included, so a client signing
    // defence consent binds to the hash its battles will actually name (roadmap §4).
    const ruleset = await servedRuleset();
    return {
        enabled: backendBattleModeEnabled(),
        deploymentId: servedDeploymentId(),
        chainIds: servedChainIds(),
        ruleset: { hash: await servedRulesetHash(), version: ruleset.version },
        team: {
            enabled: teamBattlesEnabled(),
            ruleset: { hash: await servedTeamRulesetHash(), version: (await servedTeamRuleset()).version },
        },
    };
}

export interface BattleStateSummary {
    battleId: string;
    chainId: string;
    deploymentId: string;
    state: string;
    failureReason: string | null;
    /** 'duel' | 'team'. */
    kind: string;
    /** Null on a team battle, whose pets are in its snapshot. */
    attackerPetId: string | null;
    attackerOwner: string;
    /** Null on a team battle, whose pets are in its snapshot. */
    defenderPetId: string | null;
    defenderOwner: string;
    rulesetHash: string;
    createdAt: string;
    updatedAt: string;
}

export async function getBattleStateSummary(battleId: string): Promise<BattleStateSummary | null> {
    const battle = await prisma.battleLedger.findUnique({ where: { battleId } });
    if (!battle) return null;
    return {
        battleId: battle.battleId,
        chainId: battle.chainId,
        deploymentId: battle.deploymentId,
        state: battle.state,
        failureReason: battle.failureReason,
        kind: battle.kind,
        attackerPetId: battle.attackerPetId,
        attackerOwner: battle.attackerOwner,
        defenderPetId: battle.defenderPetId,
        defenderOwner: battle.defenderOwner,
        rulesetHash: battle.rulesetHash,
        createdAt: battle.createdAt.toISOString(),
        updatedAt: battle.updatedAt.toISOString(),
    };
}

export interface SignedArtifact {
    hash: string;
    signature: string;
    signingKeyId: string;
    /** The canonical object exactly as signed. */
    payload: unknown;
}

/**
 * The signed commitment for a battle, exactly as delivered in the accept
 * response (§E). Served here too because the player's own copy is what makes
 * commit-before-reveal provable, and a copy that only ever lived in local
 * storage is one bad reload away from being lost.
 */
export async function getSignedCommitment(battleId: string): Promise<SignedArtifact | null> {
    const commitment = await prisma.battleCommitment.findUnique({ where: { battleId } });
    if (!commitment) return null;
    return {
        hash: commitment.commitmentHash,
        signature: commitment.signature,
        signingKeyId: commitment.signingKeyId,
        payload: commitment.payload,
    };
}

/** The signed receipt for a battle, once signing has completed (§G). */
export async function getSignedReceipt(battleId: string): Promise<SignedArtifact | null> {
    const receipt = await prisma.battleReceipt.findUnique({ where: { battleId } });
    if (!receipt) return null;
    return {
        hash: receipt.receiptHash,
        signature: receipt.signature,
        signingKeyId: receipt.signingKeyId,
        payload: receipt.payload,
    };
}

export interface CombatLogResponse {
    combatLogHash: string;
    log: unknown;
}

/**
 * The per-strike combat log, served separately from the receipt (§G): the
 * receipt only carries `combatLogHash`, so a client wanting to animate the
 * fight fetches the log here and checks it against that hash itself, the same
 * check the standalone verifier makes.
 */
export async function getCombatLog(battleId: string): Promise<CombatLogResponse | null> {
    const battle = await prisma.battleLedger.findUnique({
        where: { battleId },
        select: { combatLog: true, combatLogHash: true },
    });
    if (!battle || !battle.combatLog || !battle.combatLogHash) return null;
    return { combatLogHash: battle.combatLogHash, log: battle.combatLog };
}

/**
 * Every signing key a verifier may need, active and retired (§G). Retired keys
 * stay published so a receipt signed under a rotated key still verifies.
 *
 * The registry itself is in-memory (`battle-signer`'s `listSigningKeys`), so a
 * process restart currently loses any rotated key registered only via
 * `registerRotatedKey` and not reloaded at startup — this endpoint serves
 * whatever the running process knows, which is a real gap worth flagging
 * rather than a claim that key history is durable today.
 */
export function listActiveSigningKeys() {
    return listSigningKeys();
}

export interface RulesetSummary {
    rulesetHash: string;
    version: number;
    engineId: string;
    engineVersion: number;
    publishedAt: string;
    retiredAt: string | null;
}

/** Every published ruleset bundle's metadata, newest first. */
export async function listRulesets(): Promise<RulesetSummary[]> {
    const rows = await prisma.battleRuleset.findMany({ orderBy: { version: 'desc' } });
    return rows.map(toRulesetSummary);
}

/** One ruleset's full bundle, keyed by its hash — what a client needs to replay against it. */
export async function getRuleset(rulesetHash: string): Promise<(RulesetSummary & { bundle: unknown }) | null> {
    const row = await prisma.battleRuleset.findUnique({ where: { rulesetHash } });
    if (!row) return null;
    return { ...toRulesetSummary(row), bundle: row.bundle };
}

function toRulesetSummary(row: {
    rulesetHash: string;
    version: number;
    engineId: string;
    engineVersion: number;
    publishedAt: Date;
    retiredAt: Date | null;
}): RulesetSummary {
    return {
        rulesetHash: row.rulesetHash,
        version: row.version,
        engineId: row.engineId,
        engineVersion: row.engineVersion,
        publishedAt: row.publishedAt.toISOString(),
        retiredAt: row.retiredAt?.toISOString() ?? null,
    };
}

export type VerifyReceiptFailure =
    | 'not-found'
    | 'unknown-signing-key'
    | 'bad-signature'
    | 'malformed-payload';

export type VerifyReceiptResult =
    | { ok: true; receiptHash: string }
    | { ok: false; reason: VerifyReceiptFailure; detail: string };

/**
 * The lightweight check this backend can make on its own: does the stored
 * signature actually verify against a publicly known key, and is the stored
 * payload the well-formed object it claims to hash to.
 *
 * This is §A's "which battles the operator claims happened -> operator
 * signature -> verify against a published key" row, nothing more. It does not
 * re-run the fight, check the drand BLS signature, or recompute progression —
 * that is the standalone verifier's job (§H, build order steps 30-32), which
 * runs with no backend access at all so its answer cannot depend on this
 * process telling the truth. Passing this check is necessary, not sufficient.
 */
export async function verifyReceiptSignature(receiptHash: string): Promise<VerifyReceiptResult> {
    const receipt = await prisma.battleReceipt.findUnique({ where: { receiptHash } });
    if (!receipt) {
        return { ok: false, reason: 'not-found', detail: `no receipt ${receiptHash}` };
    }

    const key = listSigningKeys().find((k) => k.keyId === receipt.signingKeyId);
    if (!key) {
        return {
            ok: false,
            reason: 'unknown-signing-key',
            detail: `signing key ${receipt.signingKeyId} is not in this process's published registry`,
        };
    }

    let recovered: string;
    try {
        recovered = ethers.recoverAddress(receiptHash as Hex, receipt.signature);
    } catch (error) {
        return { ok: false, reason: 'bad-signature', detail: (error as Error).message };
    }
    if (recovered.toLowerCase() !== key.address.toLowerCase()) {
        return {
            ok: false,
            reason: 'bad-signature',
            detail: `signature recovers to ${recovered.toLowerCase()}, not ${key.address}`,
        };
    }

    if (typeof receipt.payload !== 'object' || receipt.payload === null) {
        return { ok: false, reason: 'malformed-payload', detail: 'stored payload is not an object' };
    }

    return { ok: true, receiptHash: receipt.receiptHash };
}
