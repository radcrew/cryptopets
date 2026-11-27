import { assertTeamBattleReceipt, teamReceiptFromWire, type TeamBattleReceipt, type WireTeamBattleReceipt } from '@cryptopets/protocol';
import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../contexts/ApiClientContext';
import {
    buildTeamPlayback,
    summarizeTeamBattle,
    type TeamBattleSummary,
    type TeamCombatLogWire,
    type TeamPlayback,
} from '../../utils/team/teamPlayback';

export interface TeamBattleResult {
    receipt: TeamBattleReceipt;
    playback: TeamPlayback;
    summary: TeamBattleSummary;
}

/**
 * A finished team battle, ready to play back: the signed receipt and its combat log, read from
 * the public battle endpoints once the battle is signed.
 *
 * Checked before it is shown. The receipt must pass the protocol's own validation (its seed
 * follows from its inputs), and the log must hash to the receipt's `combatLogHash`;
 * `buildTeamPlayback` throws otherwise, and the error is what this returns. A screen that
 * animated an unchecked log could show a fight nobody signed. It does not check the operator's
 * signature or replay the fight: that is the standalone verifier's job (§H).
 */
export function useTeamBattleResult(battleId: string | null | undefined, signed: boolean) {
    const apiClient = useApiClient();
    return useQuery({
        queryKey: ['battle', 'team-result', battleId] as const,
        enabled: Boolean(battleId) && signed,
        staleTime: Infinity,
        queryFn: async (): Promise<TeamBattleResult> => {
            const [{ data: stored }, { data: combatLog }] = await Promise.all([
                apiClient.get<{ payload: WireTeamBattleReceipt }>(`/api/battle/${battleId}/receipt`),
                apiClient.get<{ log: TeamCombatLogWire }>(`/api/battle/${battleId}/combat-log`),
            ]);
            const receipt = assertTeamBattleReceipt(teamReceiptFromWire(stored.payload));
            const playback = buildTeamPlayback(receipt, combatLog.log);
            return { receipt, playback, summary: summarizeTeamBattle(playback, receipt.result.attackerWon) };
        },
    });
}
