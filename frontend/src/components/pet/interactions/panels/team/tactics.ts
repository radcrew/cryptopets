import type { Tactic } from '@shared/core';

/** The four tactics, as the squad and plan editors offer them. */
export const TACTIC_OPTIONS: readonly { id: Tactic; label: string }[] = [
    { id: 'focus', label: 'Focus: the weakest enemy' },
    { id: 'breaker', label: 'Breaker: the highest INT' },
    { id: 'hunter', label: 'Hunter: an enemy its element beats' },
    { id: 'bodyguard', label: 'Bodyguard: whoever hurt a teammate' },
];
