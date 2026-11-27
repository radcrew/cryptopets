import React from 'react';
import clsx from 'clsx';
import { IoChevronBack, IoClose } from 'react-icons/io5';

import styles from './index.module.css';

const GLYPHS = { close: IoClose, back: IoChevronBack } as const;

export type RoundKeyProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> & {
    /** Close a dialog, or step back a screen. */
    icon: keyof typeof GLYPHS;
    /** The words a screen reader says, since the key itself shows only the icon. */
    'aria-label': string;
    /** `md` for screens and dialogs, `sm` inside small things like a notice. */
    size?: 'md' | 'sm';
    ref?: React.Ref<HTMLButtonElement>;
};

/**
 * The one round key every dialog closes with and every screen steps back with.
 *
 * Draws its icon rather than a text glyph: "×" and "‹" sit at a different height in every
 * font, so each hand-made key used to nudge its glyph with padding until it looked centred
 * in one font and not the next. The ring takes `--key-ring` (any colour) when a dialog wants
 * its own, such as a pet sheet in the pet's rarity.
 */
const RoundKey: React.FC<RoundKeyProps> = ({ icon, size = 'md', className, ref, ...rest }) => {
    const Glyph = GLYPHS[icon];
    return (
        <button ref={ref} type="button" className={clsx(styles.key, styles[size], className)} {...rest}>
            <Glyph aria-hidden className={styles.glyph} />
        </button>
    );
};

export default RoundKey;
