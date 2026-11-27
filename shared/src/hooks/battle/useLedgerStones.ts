import { normalizeAccount, type WireBattleReceipt, type WireTeamBattleReceipt } from '@cryptopets/protocol';
import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../contexts/ApiClientContext';
import type { PetChain } from '../../types/pet';
import { fetchAndCheckReceipt } from './useVerifiedBattleReceipt';

/** One pet as a receipt froze it, enough to draw it. Receipts carry no names. */
export interface LedgerStonePet {
    petId: string;
    dna: string;
    rarity: number;
    level: number;
}

/** One battle in a player's ledger, told from that player's side. */
export interface LedgerStoneSummary {
    battleId: string;
    /** The receipt's place in the operator's chain of receipts. */
    sequence: number;
    /** Unix seconds, from the receipt. */
    createdAt: number;
    kind: 'duel' | 'team';
    chain: PetChain;
    won: boolean;
    rounds: number;
    /** The drand round the fight was seeded from. */
    round: number;
    mine: LedgerStonePet[];
    theirs: LedgerStonePet[];
}

/** The fields of a corpus row this needs; the rest of `/api/receipts` is ignored. */
interface CorpusRow {
    battleId: string;
    sequence: string;
    createdAt: number;
    payload: unknown;
}

type WirePet = WireBattleReceipt['snapshot']['attacker'];

const toPet = (pet: WirePet): LedgerStonePet => ({
    petId: String(pet.petId),
    dna: String(pet.dna),
    rarity: pet.rarity,
    level: pet.level,
});

/**
 * A corpus row as one stone, from `wallet`'s side, or null when its payload cannot be read.
 *
 * Display only, and so not validated: opening the stone fetches the receipt again and checks
 * it in full. A row this cannot read is left out of the list rather than breaking it.
 */
export function summarizeLedgerStone(row: CorpusRow, wallet: string): LedgerStoneSummary | null {
    try {
        const payload = row.payload as WireBattleReceipt | WireTeamBattleReceipt;
        const [attackers, defenders] =
            payload.schemaVersion === 2
                ? [payload.snapshot.attackers.map((m) => m.pet), payload.snapshot.roster.map((m) => m.pet)]
                : [[payload.snapshot.attacker], [payload.snapshot.defender]];
        const attacking = normalizeAccount(attackers[0]!.owner) === normalizeAccount(wallet);
        return {
            battleId: row.battleId,
            sequence: Number(row.sequence),
            createdAt: row.createdAt,
            kind: payload.schemaVersion === 2 ? 'team' : 'duel',
            chain: payload.domain.chainId.startsWith('solana') ? 'solana' : 'evm',
            won: attacking === payload.result.attackerWon,
            rounds: payload.result.rounds,
            round: payload.beacon.round,
            mine: (attacking ? attackers : defenders).map(toPet),
            theirs: (attacking ? defenders : attackers).map(toPet),
        };
    } catch {
        return null;
    }
}

export function ledgerStonesQueryKey(wallet: string | null | undefined, limit: number) {
    return ['battle', 'ledger-stones', wallet, limit] as const;
}

/**
 * The wallet's most recent battles, newest first, as stones to read.
 *
 * From the public receipt corpus (`/api/receipts/by-wallet`), the same export anyone can
 * download, so a player's ledger is exactly what an outsider would see of them.
 */
export function useLedgerStones(wallet: string | null | undefined, limit = 24) {
    const apiClient = useApiClient();
    return useQuery({
        queryKey: ledgerStonesQueryKey(wallet, limit),
        enabled: Boolean(wallet),
        queryFn: async (): Promise<LedgerStoneSummary[]> => {
            const { data } = await apiClient.get<{ receipts: CorpusRow[] }>(
                `/api/receipts/by-wallet/${encodeURIComponent(wallet as string)}`,
                { params: { order: 'desc', limit } },
            );
            return data.receipts
                .map((row) => summarizeLedgerStone(row, wallet as string))
                .filter((stone): stone is LedgerStoneSummary => stone !== null);
        },
    });
}

/**
 * One stone's receipt, checked in this browser: duel or team, with the same checks the
 * duel result screen runs. Signed receipts never change, so it is checked once.
 */
export function useLedgerStone(battleId: string | null | undefined) {
    const apiClient = useApiClient();
    return useQuery({
        queryKey: ['battle', 'ledger-stone', battleId] as const,
        enabled: Boolean(battleId),
        staleTime: Infinity,
        queryFn: async () => {
            const { receipt, checks, verified } = await fetchAndCheckReceipt(apiClient, battleId as string);
            return { receipt, checks, verified };
        },
    });
}
