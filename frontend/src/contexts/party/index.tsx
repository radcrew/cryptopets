import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import PartyDrawer from '@components/party/party-drawer';
import PetSheet from '@components/party/pet-sheet';
import CreatePetModal from '@components/pet/creation/create-pet-modal';

type PartyContextValue = {
    /** Opens the party: every pet, and the key to summon another. */
    openParty: () => void;
    /** Opens one pet's character sheet. */
    openPet: (petId: string) => void;
    /** Opens the summoning dialog, which mints a new pet. */
    openSummon: () => void;
};

/** Outside the provider (tests, previews) the keys do nothing rather than throw. */
const NOTHING: PartyContextValue = { openParty: () => {}, openPet: () => {}, openSummon: () => {} };

const PartyContext = createContext<PartyContextValue>(NOTHING);

type View = { kind: 'party' } | { kind: 'pet'; petId: string; fromParty: boolean } | null;

/**
 * The player's pets, reachable from anywhere in the game: the dock's Pets key opens the
 * party, a pet on the Shore opens its sheet, and both lead to summoning a new one.
 *
 * This replaced the `/pets` collection page. Pets are met where they live, on the Shore and
 * in the party, so every page can open them without a trip to a list.
 */
export const PartyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { pathname } = useLocation();
    const [view, setView] = useState<View>(null);
    const [summoning, setSummoning] = useState(false);

    // A sheet's actions are ways somewhere: arriving closes it.
    useEffect(() => setView(null), [pathname]);

    const value = useMemo<PartyContextValue>(
        () => ({
            openParty: () => setView({ kind: 'party' }),
            openPet: (petId) => setView({ kind: 'pet', petId, fromParty: false }),
            openSummon: () => setSummoning(true),
        }),
        [],
    );

    return (
        <PartyContext.Provider value={value}>
            {children}
            {view?.kind === 'party' && (
                <PartyDrawer
                    onPick={(petId) => setView({ kind: 'pet', petId, fromParty: true })}
                    onSummon={() => {
                        setView(null);
                        setSummoning(true);
                    }}
                    onClose={() => setView(null)}
                />
            )}
            {view?.kind === 'pet' && (
                <PetSheet
                    key={view.petId}
                    petId={view.petId}
                    onClose={() => setView(null)}
                    onBack={view.fromParty ? () => setView({ kind: 'party' }) : undefined}
                />
            )}
            <CreatePetModal isOpen={summoning} onClose={() => setSummoning(false)} />
        </PartyContext.Provider>
    );
};

export const useParty = (): PartyContextValue => useContext(PartyContext);
