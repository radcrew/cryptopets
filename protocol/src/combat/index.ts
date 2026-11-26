export type { Attrs } from './dna';
export { applyBonus, type AttrBonus, bonusFromEquipment, NO_BONUS, sumBonuses } from './equipment';
export { digitPair, elementMod, extract, toUint16 } from './dna';
export { roundSeed, strikeRoll } from './rng';
export {
    DEFAULT_SKILL_CONFIG,
    NO_SKILL,
    SKILL_BLOODLUST,
    SKILL_CUNNING,
    SKILL_FURY,
    SKILL_REBIRTH,
    SKILL_SAGE,
    SKILL_SHELL,
    SKILL_SWIFT,
    SKILL_TANK,
    type SkillConfig,
} from './skills';
export type { StrikeOutcome } from './strike';
export { addHeal, strike } from './strike';
export { MAX_ROUNDS, simulate, type SimOutcome, type SimResult, type StrikeLogEntry } from './sim';
export {
    DEFAULT_TEAM_CONFIG,
    MAX_TEAM_SIZE,
    type Range,
    type Side,
    simulateTeam,
    type Tactic,
    type TeamConfig,
    type TeamFighter,
    type TeamOutcome,
    type TeamResult,
    type TeamStrikeLogEntry,
    type Temperament,
    type TurnOrder,
} from './team';
export { drawDefenders, ROSTER_SIZE, SQUAD_SIZE } from './teamDraw';
export {
    applyDecayShift,
    applyXp,
    BASE_XP_LOSS,
    BASE_XP_WIN,
    calcXp,
    DEFAULT_MAX_LEVEL,
    type LevelState,
    type LevelStateUpdate,
    MAX_DECAY_SHIFT,
    MAX_SAME_OPPONENT_STREAK,
    type OpponentHistory,
    type OpponentHistoryUpdate,
    recordBattleOpponent,
    XP_PER_LEVEL_MULTIPLIER,
} from './xp';
export {
    encodeSimOutcome,
    decodeSimOutcome,
    type SimOutcomeWire,
    type StrikeLogEntryWire,
} from './wire';
