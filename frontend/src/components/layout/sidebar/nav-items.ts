import { type IconTone } from '@components/ui/icon';
import {
    BATTLE_PATH,
    BREED_PATH,
    DASHBOARD_HOME,
    INVENTORY_PATH,
    LEADERBOARD_PATH,
    LEVELUP_PATH,
    MESSAGES_PATH,
    MARRIAGE_PATH,
    RENAME_PATH,
    TEAM_BATTLE_PATH,
    TRAIN_PATH,
} from '@constants/interactionRoutes';
import galleryIcon from '@assets/nav-icons/gallery.svg';
import battleIcon from '@assets/nav-icons/battle.svg';
import teamBattleIcon from '@assets/nav-icons/team-battle.svg';
import breedIcon from '@assets/nav-icons/breed.svg';
import levelupIcon from '@assets/nav-icons/levelup.svg';
import trainIcon from '@assets/nav-icons/train.svg';
import itemsIcon from '@assets/nav-icons/items.svg';
import marriageIcon from '@assets/nav-icons/marriage.svg';
import renameIcon from '@assets/nav-icons/rename.svg';
import messagesIcon from '@assets/nav-icons/messages.svg';
import leaderboardIcon from '@assets/nav-icons/leaderboard.svg';

export type NavItem = {
    id: string;
    label: string;
    /** URL of the Claude-Design-generated nav icon (colored SVG, viewBox 48×48). */
    iconSrc: string;
    /** Drives the active border-left / glow accent (see sidebar/index.css). */
    tone: IconTone;
    /** Route this item navigates to. Omitted for deferred (not-yet-built) items. */
    path?: string;
    /**
     * Renders the item disabled with a "Soon" tag.
     *
     * Nothing sets it today — Shard Forge was the last one and has been removed, and
     * Inventory now has a real route. Kept because the roadmap has more features queued
     * behind it (crates, marketplace, quests) and the sidebar already knows how to draw one.
     */
    deferred?: boolean;
    /** Shown only while the backend accepts team battles, so a switched-off feature has no door. */
    requiresTeamBattles?: boolean;
};

/**
 * Left-nav actions, ordered to match the redesign mock. Icons are the
 * Claude-Design-generated SVGs (`src/assets/nav-icons/`). Every item is wired to a real
 * route; see `deferred` above for the disabled state, which nothing currently uses.
 */
export const NAV_ITEMS: readonly NavItem[] = [
    { id: 'gallery', label: 'Gallery', iconSrc: galleryIcon, tone: 'cyan', path: DASHBOARD_HOME },
    { id: 'battle', label: 'Battle Arena', iconSrc: battleIcon, tone: 'magenta', path: BATTLE_PATH },
    {
        id: 'team-battle',
        label: 'Team Battle',
        iconSrc: teamBattleIcon,
        tone: 'violet',
        path: TEAM_BATTLE_PATH,
        requiresTeamBattles: true,
    },
    { id: 'breed', label: 'Breeding Lab', iconSrc: breedIcon, tone: 'amber', path: BREED_PATH },
    { id: 'levelup', label: 'Level Up', iconSrc: levelupIcon, tone: 'violet', path: LEVELUP_PATH },
    { id: 'train', label: 'Training Ground', iconSrc: trainIcon, tone: 'cyan', path: TRAIN_PATH },
    { id: 'items', label: 'Inventory', iconSrc: itemsIcon, tone: 'amber', path: INVENTORY_PATH },
    { id: 'marriage', label: 'Marriage', iconSrc: marriageIcon, tone: 'magenta', path: MARRIAGE_PATH },
    { id: 'rename', label: 'Rename Pet', iconSrc: renameIcon, tone: 'cyan', path: RENAME_PATH },
    {
        id: 'messages',
        label: 'Messages',
        iconSrc: messagesIcon,
        tone: 'magenta',
        path: MESSAGES_PATH,
    },
    {
        id: 'leaderboard',
        label: 'Leaderboard',
        iconSrc: leaderboardIcon,
        tone: 'amber',
        path: LEADERBOARD_PATH,
    },
];
