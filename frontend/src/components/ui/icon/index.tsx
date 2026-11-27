import React from 'react';
import {
    GiBiceps,
    GiCrossedSwords,
    GiCrystalShine,
    GiDna1,
    GiDragonHead,
    GiEggPod,
    GiFairyWand,
    GiLinkedRings,
    GiPaperPlane,
    GiPawPrint,
    GiQuillInk,
    GiSandsOfTime,
    GiShield,
    GiSparkles,
    GiMuscleUp,
    GiSpellBook,
    GiTrophy,
    GiUpgrade,
} from 'react-icons/gi';
import {
    IoCheckmarkSharp,
    IoClose,
    IoCopy,
    IoPauseSharp,
    IoPin,
    IoPinOutline,
    IoRefresh,
    IoVolumeHigh,
    IoVolumeMute,
    IoWarning,
} from 'react-icons/io5';
import clsx from 'clsx';
import { type Tone } from '@constants/tones';
import styles from './index.module.css';

export type IconTone = Exclude<Tone, 'azure'>;
export type IconGlow = 'none' | 'soft' | 'strong';
export type IconSize = number | string;

export type IconProps = {
    as: React.ComponentType<{
        size?: number | string;
        className?: string;
        'aria-hidden'?: boolean;
    }>;
    size?: IconSize;
    tone?: IconTone;
    glow?: IconGlow;
    /** Drop the trailing inline gap (icon sits flush against following content). */
    noGap?: boolean;
    className?: string;
    title?: string;
};

const TONE_CLASS: Record<IconTone, string> = {
    cyan: styles.cyan,
    violet: styles.violet,
    magenta: styles.magenta,
    emerald: styles.emerald,
    amber: styles.amber,
    inherit: '',
};

const GLOW_CLASS: Record<IconGlow, string> = {
    none: '',
    soft: styles.soft,
    strong: styles.strong,
};

const Icon: React.FC<IconProps> = ({
    as: Component,
    size = '1em',
    tone = 'inherit',
    glow = 'soft',
    noGap = false,
    className,
    title,
}) => {
    const cls = clsx(styles.icon, TONE_CLASS[tone], GLOW_CLASS[glow], noGap && styles.noGap, className);
    return (
        <span
            className={cls}
            role={title ? 'img' : undefined}
            aria-label={title}
            aria-hidden={!title}
        >
            <Component size={size} aria-hidden />
        </span>
    );
};

export default Icon;

export {
    GiBiceps as TrainIcon,
    GiCrossedSwords as BattleIcon,
    GiCrystalShine as CrystalIcon,
    GiDna1 as DnaIcon,
    GiDragonHead as DragonIcon,
    GiEggPod as EggIcon,
    GiFairyWand as MagicIcon,
    GiLinkedRings as MarriageIcon,
    GiPaperPlane as SendIcon,
    GiPawPrint as PawIcon,
    GiQuillInk as QuillIcon,
    GiSandsOfTime as HourglassIcon,
    GiShield as ShieldIcon,
    GiSparkles as SparklesIcon,
    GiMuscleUp as MuscleIcon,
    GiSpellBook as SpellbookIcon,
    GiTrophy as TrophyIcon,
    GiUpgrade as LevelUpIcon,
    IoCheckmarkSharp as CheckIcon,
    IoClose as CloseIcon,
    IoCopy as CopyIcon,
    IoPauseSharp as PauseIcon,
    IoPin as PinFilledIcon,
    IoPinOutline as PinIcon,
    IoRefresh as RefreshIcon,
    IoVolumeHigh as SoundOnIcon,
    IoVolumeMute as SoundOffIcon,
    IoWarning as WarningIcon,
};
