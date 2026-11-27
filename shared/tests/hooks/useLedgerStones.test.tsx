// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../src/contexts/ApiClientContext', () => ({ useApiClient: () => ({ get, post: vi.fn() }) }));

import { summarizeLedgerStone, useLedgerStones } from '../../src/hooks/battle/useLedgerStones';

const ME = '0xAbC0000000000000000000000000000000000001';
const THEM = '0xdef0000000000000000000000000000000000002';

const pet = (petId: string, owner: string, level = 5) => ({ petId, owner, dna: '1234567890123456', rarity: 3, level });

const duel = (attackerOwner: string, defenderOwner: string, attackerWon: boolean) => ({
    battleId: 'btl_duel',
    sequence: '41',
    createdAt: 1_893_456_000,
    payload: {
        domain: { chainId: 'eip155:84532', deploymentId: 'base-sepolia-live' },
        snapshot: { attacker: pet('1', attackerOwner), defender: pet('2', defenderOwner, 7) },
        beacon: { round: 9000 },
        result: { attackerWon, rounds: 6, winnerHpRemaining: 10 },
    },
});

beforeEach(() => get.mockReset());

describe('summarizeLedgerStone', () => {
    it('tells a duel from the attacker side, matching the wallet whatever its casing', () => {
        const stone = summarizeLedgerStone(duel(ME.toLowerCase(), THEM, true), ME);
        expect(stone).toMatchObject({
            battleId: 'btl_duel',
            sequence: 41,
            kind: 'duel',
            chain: 'evm',
            won: true,
            rounds: 6,
            round: 9000,
            mine: [{ petId: '1' }],
            theirs: [{ petId: '2', level: 7 }],
        });
    });

    it('tells a duel from the defender side, where the attacker winning is a loss', () => {
        const stone = summarizeLedgerStone(duel(THEM, ME, true), ME);
        expect(stone).toMatchObject({ won: false, mine: [{ petId: '2' }], theirs: [{ petId: '1' }] });
    });

    it('reads a team battle: three a side, from the defence roster when defending', () => {
        const squad = (owner: string, ids: string[]) => ids.map((id) => ({ col: 0, row: 0, tactic: 0, pet: pet(id, owner) }));
        const stone = summarizeLedgerStone(
            {
                battleId: 'btl_team',
                sequence: '42',
                createdAt: 1_893_456_100,
                payload: {
                    schemaVersion: 2,
                    domain: { chainId: 'solana:devnet', deploymentId: 'devnet' },
                    snapshot: { attackers: squad(THEM, ['1', '2', '3']), roster: squad(ME, ['7', '8', '9']) },
                    beacon: { round: 9001 },
                    result: { attackerWon: false, rounds: 11, winnerHpRemaining: 4 },
                },
            },
            ME,
        );
        expect(stone).toMatchObject({ kind: 'team', chain: 'solana', won: true });
        expect(stone?.mine.map((p) => p.petId)).toEqual(['7', '8', '9']);
    });

    it('leaves out a row it cannot read, rather than breaking the list', () => {
        expect(summarizeLedgerStone({ battleId: 'x', sequence: '1', createdAt: 0, payload: {} }, ME)).toBeNull();
    });
});

describe('useLedgerStones', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            {children}
        </QueryClientProvider>
    );

    it('asks the public corpus for the newest battles first', async () => {
        get.mockResolvedValue({ data: { receipts: [duel(ME, THEM, false)], nextCursor: null } });
        const { result } = renderHook(() => useLedgerStones(ME, 12), { wrapper });

        await waitFor(() => expect(result.current.data).toHaveLength(1));
        expect(get).toHaveBeenCalledWith(`/api/receipts/by-wallet/${ME}`, { params: { order: 'desc', limit: 12 } });
        expect(result.current.data?.[0]).toMatchObject({ won: false });
    });

    it('asks for nothing without a wallet', () => {
        renderHook(() => useLedgerStones(null), { wrapper });
        expect(get).not.toHaveBeenCalled();
    });
});
