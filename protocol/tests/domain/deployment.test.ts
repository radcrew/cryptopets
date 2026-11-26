import { describe, expect, it } from 'vitest';

import {
    assertProtocolDomain,
    assertSameDomain,
    type ProtocolDomain,
    sameDomain,
    writeHeader,
} from '../../src/domain/deployment';
import { bytesToHex } from '../../src/encoding/bytes';
import { DOMAIN_TAGS } from '../../src/encoding/domain';
import { CanonicalWriter } from '../../src/encoding/writer';

const LIVE: ProtocolDomain = { chainId: 'eip155:84532', deploymentId: 'base-sepolia-live' };
const STAGING: ProtocolDomain = { chainId: 'eip155:84532', deploymentId: 'base-sepolia-staging' };
const SOLANA: ProtocolDomain = { chainId: 'solana:devnet', deploymentId: 'base-sepolia-live' };

const digestFor = (domain: ProtocolDomain) => {
    const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.INTENT);
    writeHeader(writer, 'intent', domain);
    return writer.u64(1n).digestHex();
};

describe('replay separation', () => {
    it('gives staging and production different digests on the same chain', () => {
        // The §D requirement, stated as a test: same chain, same fields, different
        // contracts. Without deploymentId these two would be one signature.
        expect(digestFor(LIVE)).not.toBe(digestFor(STAGING));
    });

    it('gives the same deployment label on different chains different digests', () => {
        expect(digestFor(LIVE)).not.toBe(digestFor(SOLANA));
    });

    it('is stable for one domain', () => {
        expect(digestFor(LIVE)).toBe(digestFor({ ...LIVE }));
    });
});

describe('writeHeader', () => {
    it('writes schema version, then chain id, then deployment id', () => {
        const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.INTENT);
        // Version 1 explicitly: a duel's intent. The default is the highest version, which for
        // the intent is now the team layout.
        writeHeader(writer, 'intent', LIVE, 1);
        const hex = bytesToHex(writer.build());
        const tagPrefix = bytesToHex(CanonicalWriter.withDomain(DOMAIN_TAGS.INTENT).build());
        const body = hex.slice(tagPrefix.length);
        const expected = [
            '0001', // u16 schema version 1
            '0000000c', // 12-byte chain id
            Buffer.from('eip155:84532', 'utf8').toString('hex'),
            '00000011', // 17-byte deployment id
            Buffer.from('base-sepolia-live', 'utf8').toString('hex'),
        ].join('');
        expect(body).toBe(expected);
    });

    it('rejects an invalid domain before anything is written', () => {
        const writer = CanonicalWriter.withDomain(DOMAIN_TAGS.INTENT);
        expect(() => writeHeader(writer, 'intent', { ...LIVE, deploymentId: 'Base Sepolia' })).toThrow(
            /invalid deploymentId/,
        );
    });
});

describe('assertProtocolDomain', () => {
    it('accepts labels this repo would plausibly use', () => {
        for (const deploymentId of ['local-dev', 'base-sepolia-live', 'sepolia.v2', 'devnet1']) {
            expect(assertProtocolDomain({ ...LIVE, deploymentId }).deploymentId).toBe(deploymentId);
        }
    });

    it.each([
        ['', 'empty'],
        ['Base-Sepolia', 'uppercase would give one environment two spellings'],
        ['base sepolia', 'whitespace'],
        ['-leading-dash', 'must start alphanumeric'],
        ['base‐sepolia', 'unicode look-alike hyphen'],
        ['x'.repeat(65), 'too long'],
    ])('rejects %s (%s)', (deploymentId) => {
        expect(() => assertProtocolDomain({ ...LIVE, deploymentId })).toThrow(/invalid deploymentId/);
    });

    it('rejects an invalid chain id', () => {
        expect(() => assertProtocolDomain({ chainId: 'eip155:0' as never, deploymentId: 'local-dev' })).toThrow(
            /not a valid chain id/,
        );
    });
});

describe('sameDomain', () => {
    it('compares both halves', () => {
        expect(sameDomain(LIVE, { ...LIVE })).toBe(true);
        expect(sameDomain(LIVE, STAGING)).toBe(false);
        expect(sameDomain(LIVE, SOLANA)).toBe(false);
    });

    it('names both sides when it throws', () => {
        expect(() => assertSameDomain(LIVE, STAGING)).toThrow(
            'domain mismatch: expected eip155:84532/base-sepolia-live, got eip155:84532/base-sepolia-staging',
        );
    });
});
