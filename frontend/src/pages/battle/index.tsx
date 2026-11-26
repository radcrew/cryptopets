import React, { useState } from 'react';
import InteractionStandalone from '@components/pet/interactions/standalone';
import BattlePanel from '@components/pet/interactions/panels/battle';
import DefensePanel from '@components/pet/interactions/panels/defense';
import TeamPanel from '@components/pet/interactions/panels/team';
import { TabSwitch } from '@components/ui';
import { useBattleConfig } from '@shared/core';

/**
 * Top-level `/battle` page: picking a fight, and the standing consent that lets others pick
 * one with you.
 *
 * Two tabs rather than two routes. Defence is not a separate activity — a `DefenseAuthorization`
 * is what makes your pet answerable to the matchmaker, so it belongs beside the screen where
 * fights are arranged. On its own route it was also unreachable: `/defense` had a page and a
 * route but no sidebar entry and no link from anywhere, so nothing in the app led to it.
 */

const DUEL_TABS = [
    { id: 'battle', label: 'Find a fight' },
    { id: 'defense', label: 'Defence' },
] as const;

// Shown only while the backend accepts team battles, so a switched-off feature has no door.
const TEAM_TAB = { id: 'team', label: 'Team battles' } as const;

type TabId = (typeof DUEL_TABS)[number]['id'] | typeof TEAM_TAB.id;

const BattlePage: React.FC = () => {
    const [tab, setTab] = useState<TabId>('battle');
    const { data: config } = useBattleConfig();
    const teamEnabled = Boolean(config?.team?.enabled);
    const tabs = teamEnabled ? [...DUEL_TABS, TEAM_TAB] : DUEL_TABS;

    return (
        <InteractionStandalone action="battle" minPets={1}>
            <TabSwitch<TabId> options={tabs} value={tab} onChange={setTab} label="Battle arena" tone="magenta" />

            {/* Unmounted rather than hidden. The battle panel owns a multi-step state machine
                and a live room socket; leaving it mounted behind the defence tab would keep
                that running for a screen nobody is looking at. */}
            {tab === 'battle' && <BattlePanel />}
            {tab === 'defense' && <DefensePanel isStandaloneView={false} />}
            {tab === 'team' && teamEnabled && <TeamPanel />}
        </InteractionStandalone>
    );
};

export default BattlePage;
