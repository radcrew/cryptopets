/**
 * The one word that pops above a strike's damage number, or null for a plain hit.
 *
 * Takes the flags both combat logs share (duel `StrikeLogEntry`, team `TeamStrikeLogEntry`),
 * each optional because a duel has no guards or combos. When several apply, the most
 * dramatic wins: a critical hit is the headline even when it was also super effective.
 */
export type StrikeFlags = {
    crit: boolean;
    elementMult: number;
    furyTriggered?: boolean;
    rebirthTriggered?: boolean;
    secondChance?: boolean;
    guarded?: boolean;
    exposed?: boolean;
    combo?: number;
    longShot?: boolean;
};

export const strikeLabel = (s: StrikeFlags): string | null => {
    if (s.crit) return 'Critical';
    if (s.guarded) return 'Guarded';
    if (s.exposed) return 'Exposed';
    if (s.rebirthTriggered) return 'Rebirth';
    if (s.secondChance) return 'Second chance';
    if (s.furyTriggered) return 'Fury';
    if (s.combo && s.combo > 0) return `Combo ×${s.combo + 1}`;
    if (s.longShot) return 'Long shot';
    if (s.elementMult === 115) return 'Element edge';
    if (s.elementMult === 85) return 'Resisted';
    return null;
};
