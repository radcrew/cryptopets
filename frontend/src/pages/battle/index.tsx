import React, { useState } from 'react';
import InteractionStandalone from '@components/pet/interactions/standalone';
import BattlePanel from '@components/pet/interactions/panels/battle';
import DefensePanel from '@components/pet/interactions/panels/defense';
import { TabSwitch } from '@components/ui';
import ArenaModes from '@components/game/arena-modes';

/**
 * Top-level `/battle` page: picking a fight, and the standing consent that lets others pick
 * one with you.
 *
 * Two tabs rather than two routes. Defence is not a separate activity — a `DefenseAuthorization`
 * is what makes your pet answerable to the matchmaker, so it belongs beside the screen where
 * fights are arranged. On its own route it was also unreachable: `/defense` had a page and a
 * route but no sidebar entry and no link from anywhere, so nothing in the app led to it.
 *
 * Team battles are the exception, at `/team-battle`: a different activity with its own squad
 * building and defence team, reached from the arena's mode switch.
 */

const TABS = [
    { id: 'battle', label: 'Find a fight' },
    { id: 'defense', label: 'Defence' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const BattlePage: React.FC = () => {
    const [tab, setTab] = useState<TabId>('battle');

    return (
        <InteractionStandalone action="battle" minPets={1} showWhileLoading>
            <ArenaModes />
            <TabSwitch<TabId> options={TABS} value={tab} onChange={setTab} label="Battle arena" tone="magenta" />

            {/* Unmounted rather than hidden. The battle panel owns a multi-step state machine
                and a live room socket; leaving it mounted behind the defence tab would keep
                that running for a screen nobody is looking at. */}
            {tab === 'battle' && <BattlePanel />}
            {tab === 'defense' && <DefensePanel isStandaloneView={false} />}
        </InteractionStandalone>
    );
};

export default BattlePage;
