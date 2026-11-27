import React from 'react';
import NeonButton from '@components/ui/neon-button';
import NeonModal from '@components/ui/neon-modal';
import type { PendingAccept } from '../types';
import styles from '../index.module.css';

export type AcceptConfirmDialogProps = {
    pending: PendingAccept;
    targetPetName: (id: string) => string;
    busy: boolean;
    isAccepting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
};

/** Modal confirming acceptance of an incoming proposal. */
const AcceptConfirmDialog: React.FC<AcceptConfirmDialogProps> = ({
    pending,
    targetPetName,
    busy,
    isAccepting,
    onCancel,
    onConfirm,
}) => (
    <NeonModal
        isOpen
        onRequestClose={onCancel}
        title="💒 Accept Proposal?"
        contentClassName="marriage-confirm-body"
    >
        <p className={styles.confirmBody}>
            <strong>{pending.proposal.proposerPetName}</strong> (#{pending.proposal.proposerPetId})
            will marry your <strong>{targetPetName(pending.myPetId)}</strong> (#{pending.myPetId}).
        </p>
        <div className={styles.confirmActions}>
            <NeonButton tone="ghost" size="sm" onClick={onCancel} disabled={busy}>
                Cancel
            </NeonButton>
            <NeonButton tone="emerald" size="sm" onClick={onConfirm} disabled={busy}>
                {isAccepting ? 'Accepting...' : '💒 Confirm'}
            </NeonButton>
        </div>
    </NeonModal>
);

export default AcceptConfirmDialog;
