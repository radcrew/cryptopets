import { useEffect } from 'react';
import type { ReactNode } from 'react';
import Modal from 'react-modal';

import './index.css';
import RoundKey from '@components/ui/round-key';

type NeonModalProps = {
    isOpen: boolean;
    onRequestClose: () => void;
    title: ReactNode;
    children: ReactNode;
    headerActions?: ReactNode;
    className?: string;
    contentClassName?: string;
};

const NeonModal = ({
    isOpen,
    onRequestClose,
    title,
    children,
    headerActions,
    className,
    contentClassName,
}: NeonModalProps) => {
    useEffect(() => {
        Modal.setAppElement('#root');
    }, []);

    const dialogClassName = ['dialog', className].filter(Boolean).join(' ');
    const bodyClassName = ['body', contentClassName].filter(Boolean).join(' ');

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onRequestClose}
            className={dialogClassName}
            overlayClassName="neon-modal"
            shouldCloseOnOverlayClick
            shouldCloseOnEsc
        >
            <div className="header">
                <h3 className="title">{title}</h3>
                <div className="controls">
                    {headerActions}
                    <RoundKey icon="close" onClick={onRequestClose} aria-label="Close modal" />
                </div>
            </div>
            <div className={bodyClassName}>{children}</div>
        </Modal>
    );
};

export default NeonModal;
