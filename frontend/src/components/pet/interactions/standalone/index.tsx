import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useChainCapabilities, usePetList } from '@shared/core';
import type { InteractionAction } from '@constants/interactionRoutes';
import { DASHBOARD_HOME, STANDALONE_INTERACTION_HEADERS } from '@constants/interactionRoutes';
import { Tones } from '@constants/tones';
import Icon from '@components/ui/icon';
import NeonButton from '@components/ui/neon-button';
import GateScene from '@components/game/gate-scene';
import { useParty } from '@contexts/party';
import DashboardPanel from '@components/common/dashboard-panel';
import StateCard from '@components/pet/interactions/state-card';
import '@components/pet/interactions/interactions.css';

export type InteractionStandaloneProps = {
    action: InteractionAction;
    minPets: number;
    /**
     * Draw the page while the pet list is still loading, instead of a full-page spinner. The
     * list is read from the chain through a public RPC and can take seconds, so a page whose
     * panels show their own loading state opens at once and fills in its pickers when it lands.
     */
    showWhileLoading?: boolean;
    children: React.ReactNode;
};

const InteractionStandalone: React.FC<InteractionStandaloneProps> = ({
    action,
    minPets,
    showWhileLoading = false,
    children,
}) => {
    const navigate = useNavigate();
    const { isConnected } = useChainCapabilities();
    const { pets, isLoading } = usePetList();
    const { openSummon } = useParty();
    const header = STANDALONE_INTERACTION_HEADERS[action];
    const goBack = () => navigate(DASHBOARD_HOME);

    // Per-view class drives the background wash + accent color (see interactions.css).
    const viewClass = `interaction-standalone interaction-standalone--${action}`;

    const title = (
        <>
            <Icon as={header.Icon} tone={Tones.Violet} />
            {header.label}
        </>
    );

    if (!isConnected) {
        return (
            <StateCard containerClassName={viewClass} title={title} back={goBack}>
                <GateScene
                    kind="wallet"
                    title="Connect your wallet"
                    text="Connect your wallet to interact with your pets."
                    hint="Use the Connect Wallet key at the top of the screen."
                />
            </StateCard>
        );
    }

    const loading = isLoading && pets.length === 0;

    if (loading && !showWhileLoading) {
        return (
            <DashboardPanel
                className={`pet-interactions ${viewClass}`}
                title={title}
                back={goBack}
            >
                <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p>Loading your pets...</p>
                </div>
            </DashboardPanel>
        );
    }

    // Only once loading is over: an empty list mid-load is not "no pets".
    if (!loading && pets.length === 0) {
        return (
            <StateCard containerClassName={viewClass} title={title} back={goBack}>
                <GateScene kind="egg" title="No pets yet" text="You don't have any pets yet. Summon one to begin.">
                    <NeonButton tone="amber" onClick={openSummon}>
                        Summon a pet
                    </NeonButton>
                </GateScene>
            </StateCard>
        );
    }

    if (!loading && minPets > 1 && pets.length < minPets) {
        return (
            <StateCard containerClassName={viewClass} title={title} sub={header.sub} back={goBack}>
                <GateScene
                    kind="egg"
                    title="Two pets needed"
                    text="You need at least two pets to breed or battle. Summon another, then come back."
                >
                    <NeonButton tone="amber" onClick={openSummon}>
                        Summon a pet
                    </NeonButton>
                </GateScene>
            </StateCard>
        );
    }

    return (
        <StateCard containerClassName={viewClass} title={title} sub={header.sub} back={goBack}>
            {children}
        </StateCard>
    );
};

export default InteractionStandalone;
