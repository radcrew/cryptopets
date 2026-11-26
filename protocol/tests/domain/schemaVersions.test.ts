import { describe, expect, it } from 'vitest';

import {
    assertSupportedSchemaVersion,
    currentSchemaVersion,
    SCHEMA_VERSIONS,
    type SchemaKind,
} from '../../src/domain/schemaVersions';

const KINDS = Object.keys(SCHEMA_VERSIONS) as SchemaKind[];

describe('schema versions', () => {
    it('are positive integers', () => {
        for (const kind of KINDS) {
            expect(Number.isSafeInteger(SCHEMA_VERSIONS[kind])).toBe(true);
            expect(SCHEMA_VERSIONS[kind]).toBeGreaterThan(0);
        }
    });

    it('cover every object this protocol hashes', () => {
        // A kind missing from the registry cannot be version-checked at all, and a
        // hashed object with no version is one that can never be migrated.
        expect(KINDS).toEqual([
            'intent',
            'defenseAuthorization',
            'defensePlan',
            // Hashed and versioned like the rest, though uniquely among these it reaches no
            // receipt: it authorizes who may sign an intent, which public replay never
            // checks. Registered anyway, because "hashed" is the bar here — an object with
            // no version is one that can never be migrated.
            'sessionDelegation',
            'snapshot',
            'ruleset',
            'commitment',
            'receipt',
            'combatLog',
            'merkleLeaf',
            'merkleRewardLeaf',
        ]);
    });

    it('report the version this build writes', () => {
        for (const kind of KINDS) {
            assertSupportedSchemaVersion(kind, currentSchemaVersion(kind));
        }
    });
});

describe('assertSupportedSchemaVersion', () => {
    it('rejects a future version rather than guessing at its layout', () => {
        expect(() => assertSupportedSchemaVersion('receipt', 3)).toThrow(/unsupported receipt schema version 3/);
    });

    it.each([0, -1, 1.5])('rejects %s as a version', (version) => {
        expect(() => assertSupportedSchemaVersion('receipt', version)).toThrow(/must be a positive integer/);
    });

    it('rejects an unknown kind', () => {
        expect(() => assertSupportedSchemaVersion('battleRoom' as SchemaKind, 1)).toThrow(
            /unknown protocol object kind/,
        );
    });
});
