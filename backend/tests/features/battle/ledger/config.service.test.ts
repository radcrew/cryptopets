import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashRuleset, SOURCE_DEFAULT_RULESET, TEAM_SOURCE_DEFAULT_RULESET } from '@cryptopets/protocol';

const battleEnv = vi.hoisted(() => ({
    enabled: true,
    teamEnabled: false,
    deploymentId: 'base-sepolia-live',
    chainIds: ['eip155:84532', 'solana:devnet'],
}));

// The catalog join has its own test; stubbed so this stays about what config serves.
vi.mock('../../../../src/features/battle/ledger/ruleset.builder', async () => {
    const { SOURCE_DEFAULT_RULESET, TEAM_SOURCE_DEFAULT_RULESET } = await vi.importActual<
        typeof import('@cryptopets/protocol')
    >('@cryptopets/protocol');
    const { hashRuleset } = await vi.importActual<typeof import('@cryptopets/protocol')>('@cryptopets/protocol');
    return {
        servedRuleset: vi.fn(async () => SOURCE_DEFAULT_RULESET),
        // Derived from the same object, so config cannot serve a hash for a ruleset it is
        // not also serving — which is what clients sign their consent against.
        servedRulesetHash: vi.fn(async () => hashRuleset(SOURCE_DEFAULT_RULESET)),
        servedTeamRuleset: vi.fn(async () => TEAM_SOURCE_DEFAULT_RULESET),
        servedTeamRulesetHash: vi.fn(async () => hashRuleset(TEAM_SOURCE_DEFAULT_RULESET)),
    };
});

vi.mock('@config/env', () => ({ env: { battle: battleEnv } }));
vi.mock('@config/prisma', () => ({
    prisma: {
        battleLedger: { findUnique: vi.fn() },
        battleCommitment: { findUnique: vi.fn() },
        battleReceipt: { findUnique: vi.fn() },
        battleRuleset: { findMany: vi.fn(), findUnique: vi.fn() },
    },
}));
vi.mock('@features/battle/signer', () => ({ listSigningKeys: vi.fn() }));

import { getBattleConfig } from '@features/battle/ledger';

beforeEach(() => {
    battleEnv.enabled = true;
    battleEnv.teamEnabled = false;
    battleEnv.deploymentId = 'base-sepolia-live';
    battleEnv.chainIds = ['eip155:84532', 'solana:devnet'];
});

describe('getBattleConfig', () => {
    it('serves the team ruleset apart from the duel one, and whether team battles are on', async () => {
        // A defence plan signed against the duel ruleset would be refused as ruleset-mismatch,
        // so a client has to be told which hash a plan binds to.
        const config = await getBattleConfig();
        expect(config.team).toEqual({
            enabled: false,
            ruleset: { hash: hashRuleset(TEAM_SOURCE_DEFAULT_RULESET), version: TEAM_SOURCE_DEFAULT_RULESET.version },
        });
        expect(config.team.ruleset.hash).not.toBe(config.ruleset.hash);

        battleEnv.teamEnabled = true;
        expect((await getBattleConfig()).team.enabled).toBe(true);
        // Both switches: team battles run on the backend pipeline.
        battleEnv.enabled = false;
        expect((await getBattleConfig()).team.enabled).toBe(false);
    });

    it('serves the deployment a client must name in an intent', async () => {
        // A client that guessed this would have its intent refused as `wrong-deployment`,
        // after the wallet prompt rather than before it.
        expect((await getBattleConfig()).deploymentId).toBe('base-sepolia-live');
    });

    it('serves every chain this process accepts intents for', async () => {
        expect((await getBattleConfig()).chainIds).toEqual(['eip155:84532', 'solana:devnet']);
    });

    it('serves the ruleset the accept path actually commits battles under', async () => {
        // Not "some published ruleset" — the one `acceptBattle` binds a battle to, since a
        // defence authorization bound to any other is refused as `ruleset-mismatch`.
        expect((await getBattleConfig()).ruleset).toEqual({
            hash: hashRuleset(SOURCE_DEFAULT_RULESET),
            version: SOURCE_DEFAULT_RULESET.version,
        });
    });

    it('reflects a reconfigured deployment rather than a cached first read', async () => {
        battleEnv.deploymentId = 'base-mainnet-live';
        battleEnv.chainIds = ['eip155:8453'];

        expect(await getBattleConfig()).toMatchObject({
            deploymentId: 'base-mainnet-live',
            chainIds: ['eip155:8453'],
        });
    });

    it('reports whether this deployment is accepting backend battles', async () => {
        // The frontend mode switch reads this. Discovering the answer by submitting an
        // intent and getting a 503 would mean finding out after the wallet prompt.
        expect((await getBattleConfig()).enabled).toBe(true);

        battleEnv.enabled = false;
        expect((await getBattleConfig()).enabled).toBe(false);
    });

    it('keeps serving the deployment and ruleset while the mode is off', async () => {
        // Reads stay open when writes are refused, so a client can still verify receipts
        // this deployment issued before the mode was switched off.
        battleEnv.enabled = false;
        expect(await getBattleConfig()).toMatchObject({ deploymentId: 'base-sepolia-live' });
    });

    it('rejects a chain id the protocol does not recognise', async () => {
        // Served config is what clients build signable objects from, so a malformed chain
        // id must fail here rather than become an unsignable intent.
        battleEnv.chainIds = ['not-a-chain-id'];
        // Rejects rather than throws: the read became async when the ruleset started
        // joining the item catalog, so a bad chain id surfaces as a rejected promise.
        await expect(getBattleConfig()).rejects.toThrow();
    });
});
