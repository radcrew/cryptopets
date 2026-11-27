import type { ComponentType } from 'react';
import {
    BattleIcon,
    EggIcon,
    LevelUpIcon,
    MarriageIcon,
    QuillIcon,
    ShieldIcon,
    TrainIcon,
} from '@components/ui/icon';

/** Internal action id (`interactions/:action`; `rename` segment → changename). */
export type InteractionAction =
    | 'breed'
    | 'battle'
    | 'levelup'
    | 'train'
    | 'marriage'
    | 'changename'
    | 'defense'
    | 'equip'
    | 'teambattle';

export type StandaloneInteractionHeader = {
    Icon: ComponentType<{ size?: number | string }>;
    label: string;
    /** Optional subtitle under the panel title; omit to hide it. */
    sub?: string;
};

/** Standalone page titles for `/breed` … `/rename` (dashboard hub uses its own header). */
export const STANDALONE_INTERACTION_HEADERS: Record<
    InteractionAction,
    StandaloneInteractionHeader
> = {
    breed: { Icon: EggIcon, label: 'Breeding Lab' },
    battle: { Icon: BattleIcon, label: 'Battle Arena' },
    levelup: { Icon: LevelUpIcon, label: 'Level Up', sub: 'Pay a small fee to level up your pet' },
    train: {
        Icon: TrainIcon,
        label: 'Training Ground',
        sub: 'Pay a level-scaled fee for an XP boost',
    },
    marriage: {
        Icon: MarriageIcon,
        label: 'Marriage',
        sub: 'Marry two pets to unlock cross-owner breeding',
    },
    changename: { Icon: QuillIcon, label: 'Rename Pet', sub: "Change your pet's name" },
    defense: {
        Icon: ShieldIcon,
        label: 'Allow Challenges',
        sub: 'Let others battle your pets while you are away',
    },
    equip: {
        Icon: ShieldIcon,
        label: 'Equipment',
        sub: 'Fit your pet with gear it carries into battle',
    },
    teambattle: { Icon: BattleIcon, label: 'Team Battle' },
};

/** Home: the Shore, the scene every feature is a door from. */
export const DASHBOARD_HOME = '/main';

/** The player's pet collection (the gallery). */
export const PETS_PATH = '/pets';

/** A preview of the planned Tower mode. */
export const TOWER_PATH = '/tower';

/** Top-level interaction routes (e.g. /breed) — interaction UI only. */
export const BREED_PATH = '/breed';
export const BATTLE_PATH = '/battle';
/** Three-on-three team battles (docs/plan-team-battles-3v3.md). */
export const TEAM_BATTLE_PATH = '/team-battle';
export const LEVELUP_PATH = '/levelup';
export const TRAIN_PATH = '/train';
export const MARRIAGE_PATH = '/marriage';
export const RENAME_PATH = '/rename';

/** Read-only view, not an interaction — no pet selection, nothing to sign. */
export const LEADERBOARD_PATH = '/leaderboard';

/** Standalone inventory screen (roadmap §4). */
export const INVENTORY_PATH = '/inventory';

/** Private chat with married-pet counterparts. Also not an interaction. */
export const MESSAGES_PATH = '/messages';
