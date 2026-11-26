import React, { useState } from 'react';

import { TabSwitch } from '@components/ui';

import TeamChallenge from './team-challenge';
import TeamPlan from './team-plan';

const TABS = [
    { id: 'challenge', label: 'Challenge a team' },
    { id: 'plan', label: 'Your team' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Three-on-three team battles (docs/plan-team-battles-3v3.md): challenging another player's
 * team, and setting up your own. The challenge side owns a state machine and a battle
 * subscription, so it is unmounted rather than hidden when the other tab is open.
 */
const TeamPanel: React.FC = () => {
    const [tab, setTab] = useState<TabId>('challenge');
    return (
        <>
            <TabSwitch options={TABS} value={tab} onChange={setTab} label="Team battles" tone="violet" />
            {tab === 'challenge' ? <TeamChallenge /> : <TeamPlan />}
        </>
    );
};

export default TeamPanel;
