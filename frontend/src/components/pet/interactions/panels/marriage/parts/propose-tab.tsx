import React, { useMemo, useState } from 'react';
import { type OpponentPet, type Pet, type PetChain } from '@shared/core';
import { AuthActionButton } from '@components/common';
import PetStage from '@components/game/pet-stage';
import PetPicker from '@components/ui/pet-picker';
import PetSearchDropdown from '@components/ui/pet-search-dropdown';
import OutgoingProposalRow from './outgoing-proposal-row';
import styles from '../index.module.css';
import altar from '../altar.module.css';

export type ProposeTabProps = {
    chainPets: Pet[];
    chain: PetChain | null;
    walletAddress: string | null;
    busy: boolean;
    isProposing: boolean;
    /** Every pet on this chain, for resolving a proposal's counterpart to its art. */
    petById: Map<string, OpponentPet>;
    /** Resolves true on success so the form can reset itself. */
    onPropose: (petIdA: string, petIdB: string) => Promise<boolean>;
    onCancelProposal: (petId: string) => void;
};

/** Compose a new proposal at the altar, and review proposals already sent. */
const ProposeTab: React.FC<ProposeTabProps> = ({
    chainPets,
    chain,
    walletAddress,
    busy,
    isProposing,
    petById,
    onPropose,
    onCancelProposal,
}) => {
    const [myPet, setMyPet] = useState('');
    const petOptions = useMemo(() => chainPets.map((p) => ({ id: p.id, pet: p })), [chainPets]);
    const [partnerId, setPartnerId] = useState('');
    const myPetObj = chainPets.find((p) => p.id === myPet) ?? null;
    // The partner may be anyone's pet: the chain roster is where its art comes from.
    const partnerPet = (partnerId && petById.get(partnerId)) || null;

    const handlePropose = async () => {
        const ok = await onPropose(myPet, partnerId);
        if (ok) {
            setMyPet('');
            setPartnerId('');
        }
    };

    return (
        <div className={styles.tabPanel}>
            {/* The altar: your pet on one side, the partner's on the other, the proposal between. */}
            <div className={altar.scene}>
                <PetStage pet={myPetObj} tone="magenta" emptyHint="Choose your pet below." />
                <div className={altar.arch}>
                    <span className={altar.heart} aria-hidden>
                        💗
                    </span>
                    <AuthActionButton
                        className={styles.proposeButton}
                        tone="magenta"
                        disabled={busy || !myPet || !partnerId}
                        onClick={() => void handlePropose()}
                    >
                        {isProposing ? 'Proposing...' : '💍 Send Proposal'}
                    </AuthActionButton>
                </div>
                <div className={altar.side}>
                    <PetStage
                        pet={partnerPet}
                        tone="magenta"
                        emptyHint={partnerId ? `Pet #${partnerId}` : "Find your partner's pet."}
                    />
                    <label className={altar.search} htmlFor="propose-partner-pet">
                        <span>Partner&apos;s pet</span>
                        <PetSearchDropdown
                            id="propose-partner-pet"
                            chain={chain}
                            value={partnerId}
                            onChange={setPartnerId}
                            placeholder="Search by name or ID…"
                            disabled={busy}
                            excludeIds={myPet ? [myPet] : []}
                        />
                    </label>
                </div>
            </div>

            <div className={altar.tray}>
                <span className={altar.trayLabel}>Your pets</span>
                <PetPicker
                    pets={petOptions}
                    value={myPet}
                    onChange={setMyPet}
                    disabled={busy}
                    label="Your pet"
                    emptyHint="You have no pets on this chain yet."
                    layout="strip"
                />
            </div>

            {chainPets.length > 0 && (
                <div className={styles.sentSection}>
                    <span className={styles.sentLabel}>Sent proposals</span>
                    <ul className={styles.proposalsList}>
                        {chainPets.map((p) => (
                            <OutgoingProposalRow
                                key={p.id}
                                pet={p}
                                walletAddress={walletAddress}
                                petById={petById}
                                busy={busy}
                                onCancel={onCancelProposal}
                            />
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default ProposeTab;
