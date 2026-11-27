import { describe, expect, it } from 'vitest';

import { MESSAGES } from '@shared/core';

import { STATUS_BY_REASON as ACCEPT_STATUS } from '@features/battle/ledger/accept.controller';
import { STATUS_BY_REASON as PLAN_STATUS } from '@features/battle/ledger/defensePlan.controller';
import { STATUS_BY_REASON as INTENT_STATUS } from '@features/battle/ledger/intent.controller';
import { STATUS_BY_REASON as TEAM_INTENT_STATUS } from '@features/battle/ledger/teamIntent.controller';

/**
 * Every refusal these two controllers can return has player-facing text.
 *
 * The status maps are `Record<AcceptRejection, number>` and `Record<IntentRejection,
 * number>`, so TypeScript already forces them to list every reason — which is why neither
 * has ever had a gap. Their keys are therefore the authoritative runtime list, and this
 * binds the message map to it.
 *
 * `MESSAGES` is a `Record<string, string>` and cannot be checked the same way: the reasons
 * are backend types and `@shared/core` must not import from `backend`. That looseness is
 * exactly what let nine reasons ship without text, falling back to `Battle refused:
 * item-catalog-stale` on screen.
 *
 * The fallback in `toBattleRejection` means a missing entry degrades rather than
 * disappears, so this is a quality check, not a crash guard. It is worth having anyway:
 * the degraded text is the internal slug, and a player who reads one cannot act on it.
 */
describe('every battle rejection has something to show the player', () => {
    // Team challenges and defence plans too: the same client turns their codes into text.
    const reasons = [
        ...Object.keys(INTENT_STATUS),
        ...Object.keys(ACCEPT_STATUS),
        ...Object.keys(TEAM_INTENT_STATUS),
        ...Object.keys(PLAN_STATUS),
    ];

    it.each(reasons)('%s', (reason) => {
        expect(MESSAGES[reason]).toBeTruthy();
    });

    // The collision that motivated this. `expired` means two different things depending on
    // which endpoint answered, and the client maps a code to text with no idea which one
    // did. The intent side was renamed to `intent-expired` so a single map can be right:
    // if this ever fails, the two meanings have been merged back onto one code and one of
    // the two messages is now a lie.
    it('keeps the request expiring and the defender consent expiring apart', () => {
        expect(INTENT_STATUS).toHaveProperty('intent-expired');
        expect(INTENT_STATUS).not.toHaveProperty('expired');

        // `expired` survives only as the CoverageFailure it comes from in `@cryptopets/protocol`.
        expect(ACCEPT_STATUS).toHaveProperty('expired');
        expect(ACCEPT_STATUS).toHaveProperty('intent-expired');

        expect(MESSAGES['expired']).toContain('opponent');
        expect(MESSAGES['intent-expired']).toContain('battle request');
    });
});
