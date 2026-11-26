import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useChainCapabilities, usePetList } from '@shared/core';
import type { InteractionAction } from '@constants/interactionRoutes';
import { DASHBOARD_HOME, STANDALONE_INTERACTION_HEADERS } from '@constants/interactionRoutes';
import { Tones } from '@constants/tones';
import Icon, { BattleIcon } from '@components/ui/icon';
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
    const header = STANDALONE_INTERACTION_HEADERS[action];
    const goBack = () => navigate(DASHBOARD_HOME);

    // Per-view class drives the background wash + accent color (see interactions.css).
    const viewClass = `interaction-standalone interaction-standalone--${action}`;

    if (!isConnected) {
        return (
            <StateCard
                containerClassName={`${viewClass} wallet-disconnected`}
                title={
                    <>
                        <Icon as={BattleIcon} tone={Tones.Violet} />
                        Pet Interactions
                    </>
                }
                description="Connect your wallet to interact with your pets"
                back={goBack}
            />
        );
    }

    const loading = isLoading && pets.length === 0;

    if (loading && !showWhileLoading) {
        return (
            <DashboardPanel
                className={`pet-interactions ${viewClass}`}
                title={
                    <>
                        <Icon as={header.Icon} tone={Tones.Violet} />
                        {header.label}
                    </>
                }
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
            <StateCard
                containerClassName={viewClass}
                title={
                    <>
                        <Icon as={header.Icon} tone={Tones.Violet} />
                        {header.label}
                    </>
                }
                description="You don't have any pets yet."
                helpText="Go to the dashboard and create your first pet."
                back={goBack}
            />
        );
    }

    if (!loading && minPets > 1 && pets.length < minPets) {
        return (
            <StateCard
                containerClassName={viewClass}
                title={
                    <>
                        <Icon as={header.Icon} tone={Tones.Violet} />
                        {header.label}
                    </>
                }
                sub={header.sub}
                description="You need at least two pets to breed or battle."
                helpText="Create another pet from the dashboard, then come back here."
                back={goBack}
            />
        );
    }

    return (
        <StateCard
            containerClassName={viewClass}
            title={
                <>
                    <Icon as={header.Icon} tone={Tones.Violet} />
                    {header.label}
                </>
            }
            sub={header.sub}
            back={goBack}
        >
            {children}
        </StateCard>
    );
};

export default InteractionStandalone;
