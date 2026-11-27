import { useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * A panel's pet choice, starting with the pet the page was opened for.
 *
 * A pet's sheet on the Shore opens a page with `navigate(path, { state: { petId } })`, so a
 * player who taps Train on a pet arrives with that pet chosen. The handed-over pet only counts
 * once it is in `eligibleIds`, the panel's own list of pets it can act on: a pet on cooldown
 * arrives unchosen, rather than chosen and bound to fail. Any explicit choice, including
 * clearing it after a success, replaces the handed-over one for good.
 */
export const usePetChoice = (eligibleIds: readonly string[]): [string, (petId: string) => void] => {
    const location = useLocation();
    const [handedOver] = useState(() => (location.state as { petId?: string } | null)?.petId ?? '');
    const [chosen, setChosen] = useState<string | null>(null);
    const selected = chosen ?? (handedOver && eligibleIds.includes(handedOver) ? handedOver : '');
    return [selected, setChosen];
};
