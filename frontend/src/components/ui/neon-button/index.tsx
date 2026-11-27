import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import { type Tone } from '@constants/tones';

import './index.css';

/** `ghost` is the quiet key for a secondary action such as Cancel: the same key, in slate. */
export type NeonButtonTone = Extract<Tone, 'emerald' | 'azure' | 'amber' | 'cyan' | 'violet' | 'magenta'> | 'ghost';
export type NeonButtonSize = 'md' | 'sm' | 'xs';

export type NeonButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: NeonButtonTone;
    size?: NeonButtonSize;
    fullWidth?: boolean;
};

const NeonButton = ({
    tone = 'azure',
    size = 'md',
    fullWidth = false,
    className,
    type = 'button',
    children,
    ...rest
}: NeonButtonProps) => {
    const classString = clsx(
        'neon-btn',
        `tone-${tone}`,
        `size-${size}`,
        fullWidth && 'full-width',
        className,
    );

    return (
        <button type={type} className={classString} {...rest}>
            <span className="label">{children}</span>
        </button>
    );
};

export default NeonButton;
