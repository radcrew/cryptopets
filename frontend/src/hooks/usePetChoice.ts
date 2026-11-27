import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * A panel's pet choice, starting with the pet the page was opened for.
 *
 * A pet's sheet opens a page with `navigate(path, { state: { petId } })`, so a player who
 * taps Train on a pet arrives with that pet chosen. The handed-over pet only counts once it
 * is in `eligibleIds`, the panel's own list of pets it can act on: a pet on cooldown arrives
 * unchosen, rather than chosen and bound to fail.
 *
 * An explicit choice, including clearing it after a success, replaces the handed-over pet,
 * but only until the next navigation. A sheet opened over the page it leads to navigates to
 * the same path with a new pet, and that has to land too, so a choice is remembered against
 * the navigation (`location.key`) it was made in.
 */
export const usePetChoice = (eligibleIds: readonly string[]): [string, (petId: string) => void] => {
    const location = useLocation();
    const handedOver = (location.state as { petId?: string } | null)?.petId ?? '';
    const [choice, setChoice] = useState<{ key: string | undefined; petId: string } | null>(null);
    const chosen = choice && choice.key === location.key ? choice.petId : null;
    const selected = chosen ?? (handedOver && eligibleIds.includes(handedOver) ? handedOver : '');
    const choose = useCallback((petId: string) => setChoice({ key: location.key, petId }), [location.key]);
    return [selected, choose];
};
