import * as grpc from '@grpc/grpc-js';
import { bonusFromEquipment, type PetSnapshot } from '@cryptopets/protocol';

import { env } from '@config/env';

import { createCircuitBreaker } from './circuitBreaker';
import { loadGameDataService } from './gameData';

/**
 * VerifyBattle client: the independent Go recomputation §F requires before a
 * receipt can be signed.
 *
 * Deliberately **fail-closed**, unlike this directory's other clients
 * (roster reads, EstimateWin), which fail open because a degraded read is an
 * acceptable UX cost. A degraded *verification* is not acceptable: skipping it
 * would mean signing on the TypeScript engine's word alone, exactly what the
 * independent check exists to prevent. So every failure here — no address
 * configured, breaker open, timeout, transport error — comes back as a
 * `{ ok: false }` the caller must treat as "verification did not happen,"
 * never as "verification passed." The breaker still exists, for the same
 * reason it exists on the read paths: skip calls to a process that is
 * clearly down rather than paying the deadline on every one, but skipping
 * here still resolves to a failure the caller retries, not a silent pass.
 */

const DEADLINE_MS = 2000;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30_000;

export interface VerifyPetInputsWire {
    petId: string;
    dna: string;
    rarity: number;
    level: number;
    skill: number;
    xp: number;
    lastOpponentId: string;
    streak: number;
    /**
     * The pet's resolved equipment total (roadmap §4), frozen at acceptance.
     *
     * Five scalars rather than a nested message, so a server that predates equipment reads
     * proto3 defaults of zero. That is exactly "ungeared", which means a geared battle sent
     * to an old verifier fails §F loudly rather than being checked against the wrong
     * inputs and passing.
     */
    bonusHp: number;
    bonusAtk: number;
    bonusDef: number;
    bonusInt: number;
    bonusMdef: number;
}

/** One frozen pet as the verify calls send it. Shared by the duel and team verify paths. */
export function verifyPetInputs(pet: PetSnapshot): VerifyPetInputsWire {
    // The resolved equipment total, so the independent recomputation runs on the same
    // inputs the canonical engine used (roadmap §4). Sending the frozen modifiers rather
    // than item ids is what lets the verifier hold no item catalog at all: what §F checks
    // is that the fight follows from the numbers the receipt publishes.
    const bonus = bonusFromEquipment(pet.equipment);
    return {
        petId: String(pet.petId),
        dna: String(pet.dna),
        rarity: pet.rarity,
        level: pet.level,
        skill: pet.skill,
        xp: pet.xp,
        lastOpponentId: String(pet.lastOpponentId),
        streak: pet.streak,
        bonusHp: bonus.hp,
        bonusAtk: bonus.atk,
        bonusDef: bonus.def,
        bonusInt: bonus.int,
        bonusMdef: bonus.mdef,
    };
}

export interface VerifySkillConfigWire {
    tankHpMult: number;
    shellDefMult: number;
    swiftCritBonus: number;
    cunningCritCap: number;
    furyDmgMult: number;
    furyHpThreshold: number;
    sageMdefMult: number;
    bloodlustBps: number;
}

export interface VerifyBattleParams {
    attacker: VerifyPetInputsWire;
    defender: VerifyPetInputsWire;
    /** 32-byte seed, 0x-hex. */
    seed: string;
    skillConfig: VerifySkillConfigWire;
    maxLevel: number;
}

export interface VerifyStrikeLogEntryWire {
    round: number;
    attacker: number;
    isMagic: boolean;
    crit: boolean;
    damage: string;
    heal: string;
    elementMult: number;
    furyTriggered: boolean;
    rebirthTriggered: boolean;
    hp1After: number;
    hp2After: number;
}

export interface VerifyPetProgressionWire {
    petId: string;
    won: boolean;
    decayShift: number;
    xpAwarded: number;
    lastOpponentId: string;
    streak: number;
    level: number;
    xp: number;
    leveledUp: boolean;
}

export interface VerifyBattleWire {
    firstWins: boolean;
    rounds: number;
    winnerHpRemaining: number;
    startHp1: number;
    startHp2: number;
    log: VerifyStrikeLogEntryWire[];
    attacker: VerifyPetProgressionWire;
    defender: VerifyPetProgressionWire;
}

/** Why verification did not happen. Every one of these is a failure, never a pass. */
export type VerifyFailure = { ok: false; reason: 'not-configured' | 'breaker-open' | 'transport-error'; detail: string };

export type VerifyBattleResult = { ok: true; response: VerifyBattleWire } | VerifyFailure;

/** One team-battle pet (docs/battle-protocol.md §F, "Team battles"). `rank` is 0 for attackers. */
export interface VerifyTeamPetWire {
    pet: VerifyPetInputsWire;
    col: number;
    row: number;
    tactic: 'focus' | 'breaker' | 'hunter' | 'bodyguard';
    rank: number;
}

/** Mirrors protocol's TeamConfig. `turnOrder` is 'int' until Attributes 2.0. */
export interface VerifyTeamConfigWire {
    turnOrder: 'int';
    comboStepPct: number;
    exposePct: number;
    auraPct: number;
    tailwindBps: number;
    longShotPct: number;
    temperamentPct: number;
}

export interface VerifyTeamBattleParams {
    /** Exactly three, in slot order. */
    attackers: VerifyTeamPetWire[];
    /** The defender's whole five-pet roster, so Go recomputes the draw rather than trusting it. */
    roster: VerifyTeamPetWire[];
    /** 32-byte seed, 0x-hex. */
    seed: string;
    skillConfig: VerifySkillConfigWire;
    teamConfig: VerifyTeamConfigWire;
    maxLevel: number;
}

/** One team strike, mirroring protocol's TeamStrikeLogEntry. The 64-bit fields arrive as
 *  strings (the proto loader's `longs: String`), as in the duel log. */
export interface VerifyTeamStrikeWire {
    round: number;
    side: number;
    actor: number;
    target: number;
    victim: number;
    isMagic: boolean;
    crit: boolean;
    damage: string;
    elementMult: number;
    combo: number;
    longShot: boolean;
    furyTriggered: boolean;
    temperament: boolean;
    exposed: boolean;
    guarded: boolean;
    secondChance: boolean;
    knockedOut: boolean;
    heal: string;
    /** Slot on the striker's side, or -1 when nothing was healed. */
    healed: number;
    victimHpAfter: number;
}

export interface VerifyTeamBattleWire {
    /** The defenders' roster indices, in roster order. */
    drawn: number[];
    attackerWins: boolean;
    rounds: number;
    winnerHpRemaining: number;
    attackerStartHp: number[];
    defenderStartHp: number[];
    log: VerifyTeamStrikeWire[];
    /** The six fighters, attackers then drawn defenders, each by slot. */
    progression: VerifyPetProgressionWire[];
}

export type VerifyTeamBattleResult = { ok: true; response: VerifyTeamBattleWire } | VerifyFailure;

type Callback<T> = (err: grpc.ServiceError | null, res: T) => void;

type VerifyClient = grpc.Client & {
    verifyBattle(request: Record<string, unknown>, options: grpc.CallOptions, callback: Callback<VerifyBattleWire>): void;
    verifyTeamBattle(
        request: Record<string, unknown>,
        options: grpc.CallOptions,
        callback: Callback<VerifyTeamBattleWire>,
    ): void;
};

let client: VerifyClient | null = null;
let breaker = createCircuitBreaker({
    threshold: BREAKER_THRESHOLD,
    cooldownMs: BREAKER_COOLDOWN_MS,
    label: '[verify-battle-grpc]',
});

function getClient(): VerifyClient | null {
    const { addr } = env.indexerGrpc;
    if (!addr) return null;
    if (!client) {
        const Service = loadGameDataService();
        client = new Service(addr, grpc.credentials.createInsecure()) as VerifyClient;
    }
    return client;
}

/** Resets the cached client and the circuit breaker. Tests only. */
export function resetVerifyBattleClient(): void {
    client = null;
    breaker = createCircuitBreaker({
        threshold: BREAKER_THRESHOLD,
        cooldownMs: BREAKER_COOLDOWN_MS,
        label: '[verify-battle-grpc]',
    });
}

export function callVerifyBattle(params: VerifyBattleParams): Promise<VerifyBattleResult> {
    return invoke<VerifyBattleWire>('verifyBattle', {
        attacker: params.attacker,
        defender: params.defender,
        seed: Buffer.from(params.seed.replace(/^0x/, ''), 'hex'),
        skillConfig: params.skillConfig,
        maxLevel: params.maxLevel,
    });
}

/**
 * VerifyTeamBattle: the Go recomputation of a team battle's draw, fight and six
 * progressions. Fail-closed for the same reason as `callVerifyBattle`, and on the same
 * client and breaker: both calls reach one Go process, so if it is down neither should be
 * attempted.
 */
export function callVerifyTeamBattle(params: VerifyTeamBattleParams): Promise<VerifyTeamBattleResult> {
    return invoke<VerifyTeamBattleWire>('verifyTeamBattle', {
        attackers: params.attackers,
        roster: params.roster,
        seed: Buffer.from(params.seed.replace(/^0x/, ''), 'hex'),
        skillConfig: params.skillConfig,
        teamConfig: params.teamConfig,
        maxLevel: params.maxLevel,
    });
}

/** The fail-closed call both verifications share. */
function invoke<T>(
    method: 'verifyBattle' | 'verifyTeamBattle',
    request: Record<string, unknown>,
): Promise<{ ok: true; response: T } | VerifyFailure> {
    if (!env.indexerGrpc.addr) {
        return Promise.resolve({
            ok: false,
            reason: 'not-configured',
            detail: 'INDEXER_GRPC_ADDR is not set; independent verification cannot run',
        });
    }
    if (!breaker.allows()) {
        return Promise.resolve({
            ok: false,
            reason: 'breaker-open',
            detail: 'indexer-go verify breaker is open after repeated failures',
        });
    }
    const verifyClient = getClient();
    if (!verifyClient) {
        return Promise.resolve({ ok: false, reason: 'not-configured', detail: 'no gRPC client available' });
    }

    return new Promise((resolve) => {
        const deadline = new Date(Date.now() + DEADLINE_MS);
        const call = verifyClient[method].bind(verifyClient) as (
            request: Record<string, unknown>,
            options: grpc.CallOptions,
            callback: Callback<T>,
        ) => void;
        call(
            request,
            { deadline },
            (err, res) => {
                if (err) {
                    breaker.recordFailure(err.message);
                    resolve({ ok: false, reason: 'transport-error', detail: err.message });
                    return;
                }
                breaker.recordSuccess();
                resolve({ ok: true, response: res });
            },
        );
    });
}
