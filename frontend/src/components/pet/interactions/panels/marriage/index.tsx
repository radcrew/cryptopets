import React from 'react';
import clsx from 'clsx';
import Icon, { CheckIcon } from '@components/ui/icon';
import { Tones } from '@constants/tones';
import MarriageTabBar from './parts/marriage-tab-bar';
import ProposeTab from './parts/propose-tab';
import AcceptTab from './parts/accept-tab';
import ActiveMarriages from './parts/active-marriages';
import AcceptConfirmDialog from './parts/accept-confirm-dialog';
import { useMarriagePanel } from '@hooks/marriage/useMarriagePanel';
import type { MarriagePanelProps } from './types';
import styles from './index.module.css';

const MarriagePanel: React.FC<MarriagePanelProps> = ({ isStandaloneView = true }) => {
    const {
        isDisconnected,
        tab,
        onTabChange,
        proposalCount,
        proposeTab,
        acceptTab,
        activeMarriages,
        pendingAccept,
        onCancelAccept,
        onConfirmAccept,
        busy,
        isAccepting,
        targetPetName,
        success,
    } = useMarriagePanel();

    if (isDisconnected) {
        return <p>Connect a wallet to use marriage.</p>;
    }

    return (
        <>
            <div className={clsx('interface', styles.root)}>
                {!isStandaloneView && (
                    <>
                        <h4>💍 Marriage</h4>
                        <p>Marry two pets to unlock cross-owner breeding.</p>
                    </>
                )}

                <MarriageTabBar tab={tab} onChange={onTabChange} proposalCount={proposalCount} />

                {tab === 'propose' && <ProposeTab {...proposeTab} />}

                {tab === 'accept' && <AcceptTab {...acceptTab} />}

                {activeMarriages.chainPets.length > 0 && <ActiveMarriages {...activeMarriages} />}
            </div>

            {pendingAccept && (
                <AcceptConfirmDialog
                    pending={pendingAccept}
                    targetPetName={targetPetName}
                    busy={busy}
                    isAccepting={isAccepting}
                    onCancel={onCancelAccept}
                    onConfirm={onConfirmAccept}
                />
            )}

            {success && (
                <div className="success-message">
                    <Icon as={CheckIcon} tone={Tones.Emerald} />
                    {success}
                </div>
            )}
        </>
    );
};

export default MarriagePanel;
