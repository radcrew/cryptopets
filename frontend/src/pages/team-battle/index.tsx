import React from 'react';
import { useNavigate } from 'react-router-dom';
import InteractionStandalone from '@components/pet/interactions/standalone';
import TeamPanel from '@components/pet/interactions/panels/team';
import NeonButton from '@components/ui/neon-button';
import { BATTLE_PATH } from '@constants/interactionRoutes';
import { useBattleConfig } from '@shared/core';

/**
 * Top-level `/team-battle` page: challenging another player's team of three, and setting up
 * your own (docs/plan-team-battles-3v3.md).
 *
 * Its own route rather than a tab of `/battle`, because it is its own activity: a squad to
 * build and place, and a defence team to keep, neither of which a duel has. The sidebar entry
 * appears only while the backend accepts team battles; this page says so itself when reached
 * by address while they are switched off.
 */
const TeamBattlePage: React.FC = () => {
    const navigate = useNavigate();
    const { data: config, isLoading } = useBattleConfig();

    return (
        <InteractionStandalone action="teambattle" minPets={1} showWhileLoading>
            {config?.team?.enabled ? (
                <TeamPanel />
            ) : isLoading ? (
                <p className="pending-hint">Loading team battles…</p>
            ) : (
                <div className="interface">
                    <p>Team battles are not open on this server yet.</p>
                    <NeonButton tone="magenta" onClick={() => navigate(BATTLE_PATH)}>
                        Go to the Battle Arena
                    </NeonButton>
                </div>
            )}
        </InteractionStandalone>
    );
};

export default TeamBattlePage;
