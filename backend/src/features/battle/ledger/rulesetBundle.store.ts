import { type Hex, loadRulesetBundle, type Ruleset } from '@cryptopets/protocol';

import { prisma } from '@config/prisma';

/**
 * Published ruleset bundles, remembered by hash for the life of the process.
 *
 * A bundle is content-addressed and never changes or disappears once published (§H item 2), and
 * an entry is only stored after `loadRulesetBundle` has checked it against its hash, so nothing
 * here can go stale. Every battle step used to re-read and re-hash its bundle from the database,
 * and every acceptance re-checked that it was published: one round trip each, which against a
 * distant database is a noticeable part of a battle's wait.
 */
const loaded = new Map<string, Ruleset>();
const published = new Set<string>();

/** The bundle a battle names, checked against its hash. `purpose` finishes the error message. */
export async function loadPublishedRuleset(rulesetHash: string, purpose: string): Promise<Ruleset> {
    const key = rulesetHash.toLowerCase();
    const cached = loaded.get(key);
    if (cached) return cached;

    const row = await prisma.battleRuleset.findUnique({ where: { rulesetHash } });
    if (!row) {
        throw new Error(`no published ruleset bundle for ${rulesetHash}; cannot ${purpose}`);
    }
    const ruleset = loadRulesetBundle(JSON.stringify(row.bundle), rulesetHash as Hex);
    loaded.set(key, ruleset);
    published.add(key);
    return ruleset;
}

/** Whether this process has already seen the bundle for `rulesetHash` published. */
export function isKnownPublished(rulesetHash: string): boolean {
    return published.has(rulesetHash.toLowerCase());
}

/** Records that the bundle for `rulesetHash` is published. */
export function markPublished(rulesetHash: string): void {
    published.add(rulesetHash.toLowerCase());
}

/** Forgets everything. For tests, which reuse one hash with different mocked rows. */
export function clearPublishedRulesetCache(): void {
    loaded.clear();
    published.clear();
}
