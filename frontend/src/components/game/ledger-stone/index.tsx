import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { VerifiedBattleReceipt } from '@shared/core';

import NeonButton from '@components/ui/neon-button';
import { useSound } from '@contexts/sound';
import styles from './index.module.css';

/** One signed receipt, and the checks this browser ran on it. */
export type LedgerRecord = {
    battleId: string;
    /** The receipt's place in the operator's chain of receipts. */
    sequence: number;
    /** The drand round the fight was seeded from. */
    round: number;
    rounds: number;
    checks: VerifiedBattleReceipt['checks'];
};

/** The pause between runes, so each check reads as its own moment. */
const RUNE_MS = 380;
const GLYPHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

const prefersStill = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Every check the verifier can run, in a player's words. Any other is shown by its id. */
const RUNES: Record<string, { title: string; says: (record: LedgerRecord) => string }> = {
    'operator-signature': {
        title: 'Sealed by the keepers',
        says: () => "The operator's signature matches its published key",
    },
    'beacon-signature': {
        title: 'The Pulse beat is true',
        says: ({ round }) => `drand round #${round.toLocaleString()}, signed by drand's network`,
    },
    'seed-derivation': {
        title: 'The seed follows the beat',
        says: () => 'Rebuilt from the beat, the battle and the rules',
    },
    'combat-replay': {
        title: 'The fight replays blow for blow',
        says: ({ rounds }) => `${rounds} ${rounds === 1 ? 'round' : 'rounds'} replayed here, the same winner`,
    },
    progression: { title: 'XP follows the rules', says: () => 'Every point of XP matches the formula' },
    equipment: { title: 'Gear matches the catalog', says: () => 'No pet carried more than its gear allows' },
};

type LedgerStoneProps = {
    record: LedgerRecord;
    /** Who fought and how it ended, carved under the title. */
    caption: string;
    /** Styles the key that opens the stone, so it sits with the screen's other actions. */
    triggerClassName?: string;
};

/**
 * The Ledger Stone: a duel's receipt, and the checks run on it, carved as runes.
 *
 * It reports checks that have already run, in `useVerifiedBattleReceipt`, before the fight
 * was shown at all. Reading the stone lights their results one by one; it computes nothing.
 * The link to the receipt before this one is not a rune, because one receipt has nothing to
 * check that link against; the public verifier checks it across the whole ledger.
 */
const LedgerStone: React.FC<LedgerStoneProps> = ({ record, caption, triggerClassName }) => {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
                📜 Ledger Stone
            </button>
            {open && <LedgerTablet record={record} caption={caption} onClose={() => setOpen(false)} />}
        </>
    );
};

/** The stone itself, over the page. The Ledger Stones page opens it for any past battle. */
export const LedgerTablet: React.FC<{ record: LedgerRecord; caption: string; onClose: () => void }> = ({
    record,
    caption,
    onClose,
}) => {
    const { play } = useSound();
    const { checks, sequence, battleId } = record;
    const total = checks.length;
    const holds = checks.every((check) => check.ok);
    // How many runes are lit, or null before the stone has been read.
    const [lit, setLit] = useState<number | null>(null);
    const dialog = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        dialog.current?.querySelector<HTMLButtonElement>('[data-read]')?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        if (lit === null) return undefined;
        if (lit === total) {
            play(holds ? 'success' : 'error');
            return undefined;
        }
        if (lit > 0) play('rune');
        const timer = setTimeout(() => setLit(lit + 1), RUNE_MS);
        return () => clearTimeout(timer);
    }, [lit, total, holds, play]);

    const reading = lit !== null && lit < total;
    const read = lit === total;

    return createPortal(
        // The veil is the dialog, so the close key can sit in the screen's corner, clear of the
        // stone's arched top and its title.
        <div ref={dialog} className={styles.veil} role="dialog" aria-modal="true" aria-label={`Ledger Stone #${sequence}`}>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close the Ledger Stone">
                ×
            </button>
            <div className={styles.tablet}>
                <h2 className={styles.title}>Ledger Stone · #{sequence.toLocaleString()}</h2>
                <p className={styles.caption}>
                    {caption} · Pulse beat #{record.round.toLocaleString()}
                </p>

                <ol className={styles.runes}>
                    {checks.map((check, i) => {
                        const rune = RUNES[check.check];
                        const on = lit !== null && i < lit;
                        return (
                            <li
                                key={check.check}
                                className={clsx(styles.rune, on && styles.lit, on && !check.ok && styles.cracked)}
                            >
                                <span className={styles.glyph} aria-hidden>
                                    {on ? (check.ok ? '✓' : '✗') : (GLYPHS[i] ?? i + 1)}
                                </span>
                                <span>
                                    {rune?.title ?? check.check}
                                    {on && <span className={styles.srOnly}>{check.ok ? ': passed' : ': failed'}</span>}
                                    <small>
                                        {on && !check.ok
                                            ? (check.detail ?? 'This check failed')
                                            : (rune?.says(record) ?? 'A check from the public verifier')}
                                    </small>
                                </span>
                            </li>
                        );
                    })}
                </ol>

                <div className={styles.verdict} aria-live="polite">
                    {read && (
                        <span className={clsx(styles.stamp, !holds && styles.stampCracked)}>
                            {holds ? 'The stone holds true' : 'The stone is cracked'}
                        </span>
                    )}
                </div>

                <NeonButton
                    data-read
                    tone="violet"
                    // Not `disabled`: a disabled button drops keyboard focus to the page.
                    aria-disabled={reading}
                    onClick={() => {
                        if (!reading) setLit(prefersStill() ? total : 0);
                    }}
                >
                    {read ? 'Read it again' : 'Read the stone'}
                </NeonButton>

                <p className={styles.note}>
                    Every battle is carved into a Ledger Stone: a signed receipt anyone can replay. Your browser
                    ran these checks itself, with the same open-source code as the public verifier.
                    {sequence > 1 &&
                        ` How this stone links to #${(sequence - 1).toLocaleString()} before it is checked across the whole ledger by the public verifier.`}
                </p>
                <p className={styles.id}>
                    Battle <code>{battleId}</code>
                </p>
            </div>
        </div>,
        document.body,
    );
};

export default LedgerStone;
