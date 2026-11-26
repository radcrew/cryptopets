import type { Tactic } from '@shared/core';

/** The four tactics: a full label for the pickers, and a short one for a zone tile. */
export const TACTIC_OPTIONS: readonly { id: Tactic; label: string; short: string }[] = [
    { id: 'focus', label: 'Focus: the weakest enemy', short: 'Focus' },
    { id: 'breaker', label: 'Breaker: the highest INT', short: 'Breaker' },
    { id: 'hunter', label: 'Hunter: an enemy its element beats', short: 'Hunter' },
    { id: 'bodyguard', label: 'Bodyguard: whoever hurt a teammate', short: 'Bodyguard' },
];

export const tacticShort = (tactic: Tactic) => TACTIC_OPTIONS.find((t) => t.id === tactic)?.short ?? tactic;
