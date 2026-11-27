import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useChainCapabilities, useCreatePet, useFees } from '@shared/core';
import { Tones } from '@constants/tones';
import Icon, { CheckIcon, PawIcon } from '@components/ui/icon';
import NeonButton from '@components/ui/neon-button';
import NeonModal from '@components/ui/neon-modal';
import TransactionStatus from '@components/common/transaction-status';
import { useNotifyError } from '@hooks/useNotifyError';
import { useTxErrorToast } from '@hooks/useTxErrorToast';
import MintedPetArt from './parts/minted-pet-art';
import styles from './index.module.css';

interface CreatePetModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const CreatePetModal: React.FC<CreatePetModalProps> = ({ isOpen, onClose }) => {
    const { isConnected, kind } = useChainCapabilities();
    const queryClient = useQueryClient();
    const notifyError = useNotifyError();

    // Mint cost escalates per wallet: EVM baseMintFee×(1+count), Solana baseMintFee<<min(count,7).
    const fees = useFees();
    const mintCost = fees.nextMintFee != null ? fees.formatAmount(fees.nextMintFee) : null;

    const [petName, setPetName] = useState('');
    const [success, setSuccess] = useState<string | null>(null);

    // Settlement is lifecycle-driven (EVM: receipt confirmed; Solana: resolve).
    //
    // The dialog deliberately stays open. The pet's art is generated on first
    // request, so closing here would drop the player back to a gallery card that
    // shows an emoji for the next several seconds — they would never see what
    // they minted. This is the one place worth waiting.
    const handleCreateComplete = () => {
        setSuccess(`Pet "${petName.trim()}" created successfully!`);
        // Bust the entire contract-read cache so the gallery picks up the new pet
        // immediately — avoids stale reads when the wallet's chain differs from
        // the contract's chain (useReadContracts overwrites chainId with the wallet's).
        void queryClient.invalidateQueries({ queryKey: ['readContract'] });
        void queryClient.invalidateQueries({ queryKey: ['readContracts'] });
    };

    const {
        mutate,
        isPending,
        isAwaitingFulfillment,
        isSettling,
        mintedPetId,
        error: hookError,
        reset,
        lifecycle,
    } = useCreatePet({
        onSuccess: handleCreateComplete,
    });

    useTxErrorToast(hookError);

    const isInProgress = isPending || isAwaitingFulfillment || isSettling;
    // EVM: both nextMintFee (via mintCost) AND entropyFee must be loaded before sending.
    // Solana: no entropy fee, mintCost alone is sufficient.
    const isEvm = fees.symbol === 'ETH';
    const feesLoading = mintCost == null || (isEvm && fees.entropyFee == null);

    const buttonLabel = isPending
        ? 'Submitting...'
        : isAwaitingFulfillment
        ? 'Awaiting randomness...'
        : isSettling
        ? 'Settling mint...'
        : feesLoading
        ? 'Loading fees...'
        : `Create Pet (${mintCost})`;

    const handleCreatePet = async () => {
        if (!isConnected) {
            notifyError('Please connect your wallet first', undefined, 'create-pet-validation');
            return;
        }

        const trimmed = petName.trim();
        if (!trimmed) {
            notifyError('Please enter a pet name', undefined, 'create-pet-validation');
            return;
        }

        setSuccess(null);

        try {
            await mutate({ name: trimmed });
        } catch (err) {
            console.error('[create-pet]', err);
        }
    };

    const handleClose = () => {
        // The guard protects a mint that is still in flight, whose fee is already
        // spent. Once one has settled there is nothing left to protect, and any
        // in-progress flag still set at that point traps the dialog instead —
        // neither Done nor the close button does anything. Settled wins.
        if (!success && isInProgress) return;
        setPetName('');
        setSuccess(null);
        reset();
        onClose();
    };

    return (
        <NeonModal
            isOpen={isOpen}
            onRequestClose={handleClose}
            title={
                <>
                    <Icon as={PawIcon} tone={Tones.Cyan} />
                    Summon a Pet
                </>
            }
            contentClassName={styles.createPetBody}
        >
            <p>
                Name your new pet and summon it. Each pet you summon costs a little more than the
                last; breeding is the other way to grow your party.
            </p>

            <div className={styles.form}>
                {/* `?` until the mint settles, and it is not a placeholder for
                    missing data: commit-reveal fixes the DNA at the entropy
                    reveal, so until then nobody — not even the contract — knows
                    what this pet looks like. */}
                <MintedPetArt petId={mintedPetId ?? null} chain={kind === 'solana' ? 'solana' : 'evm'} />

                <div className={styles.field}>
                    <label htmlFor="petName">Pet Name</label>
                    <input
                        id="petName"
                        type="text"
                        value={petName}
                        onChange={(e) => setPetName(e.target.value)}
                        placeholder="Enter pet name..."
                        maxLength={20}
                        disabled={isInProgress || Boolean(success)}
                    />
                </div>

                {!success && mintCost && <p className="mint-cost">Mint cost: {mintCost}</p>}

                {success ? (
                    <NeonButton tone="cyan" onClick={handleClose}>
                        Done
                    </NeonButton>
                ) : (
                    /* Creating a pet is fully on-chain (Switchboard VRF + program) and
                       needs no backend session — gate on wallet connection only, not SIWS auth. */
                    <NeonButton
                        tone="cyan"
                        onClick={handleCreatePet}
                        disabled={isInProgress || feesLoading || !petName.trim() || !isConnected}
                    >
                        {buttonLabel}
                    </NeonButton>
                )}

                {isAwaitingFulfillment && (
                    <p className="pending-hint">
                        Hang tight — your pet will appear once randomness is revealed.
                    </p>
                )}
            </div>

            {success && (
                <div className="success-message">
                    <Icon as={CheckIcon} tone={Tones.Emerald} />
                    {success}
                </div>
            )}

            <TransactionStatus lifecycle={lifecycle} />
        </NeonModal>
    );
};

export default CreatePetModal;
