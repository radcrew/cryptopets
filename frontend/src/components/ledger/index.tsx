import React, { useState } from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import {
    getRarityColor,
    useAuth,
    useChainCapabilities,
    useLedgerStone,
    useLedgerStones,
    usePetList,
    useSpousePet,
    type LedgerStonePet,
    type LedgerStoneSummary,
    type PetChain,
} from '@shared/core';

import DashboardPanel from '@components/common/dashboard-panel';
import GateScene from '@components/game/gate-scene';
import { LedgerTablet } from '@components/game/ledger-stone';
import StateCard from '@components/pet/interactions/state-card';
import PetArt from '@components/pet/pet-art';
import { DASHBOARD_HOME } from '@constants/interactionRoutes';
import styles from './index.module.css';

/** The newest this many. The public corpus keeps every stone for anyone who wants the rest. */
const SHOWN = 24;

const TITLE = '📜 Ledger Stones';

const roundsText = (rounds: number) => `${rounds} ${rounds === 1 ? 'round' : 'rounds'}`;

/** A pet's round portrait, ringed in its rarity colour. Receipts carry no names. */
const Face: React.FC<{ pet: LedgerStonePet; chain: PetChain; name: string }> = ({ pet, chain, name }) => (
    <span className={styles.face} style={{ '--rc': getRarityColor(pet.rarity) } as React.CSSProperties}>
        <PetArt pet={{ id: pet.petId, chain, dna: BigInt(pet.dna), name }} />
    </span>
);

/**
 * One battle's stone in the grid. The whole card is the key that opens it.
 *
 * A duel names both pets: the player's own from their collection, the rival's from the
 * backend once signed in (the lookup is JWT-gated), and its id until then.
 */
const StoneCard: React.FC<{
    stone: LedgerStoneSummary;
    names: ReadonlyMap<string, string>;
    onOpen: () => void;
}> = ({ stone, names, onOpen }) => {
    const { isAuthenticated } = useAuth();
    const duel = stone.kind === 'duel';
    const rival = stone.theirs[0];
    // Despite its name, useSpousePet is the plain pet-by-id lookup, cached per pet.
    const { name: rivalLookup } = useSpousePet(stone.chain, rival?.petId ?? '', {
        skip: !duel || !isAuthenticated,
    });
    const mineName = duel ? (names.get(stone.mine[0]?.petId ?? '') ?? `Pet #${stone.mine[0]?.petId}`) : 'Your squad';
    const rivalName = duel ? (rivalLookup ?? `Pet #${rival?.petId}`) : 'Their squad';
    const caption = `${mineName} vs ${rivalName}`;
    const when = new Date(stone.createdAt * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

    return (
        <button
            type="button"
            className={clsx(styles.stone, stone.won ? styles.won : styles.lost, !duel && styles.team)}
            onClick={() => onOpen()}
            aria-label={`Read stone #${stone.sequence.toLocaleString()}: ${caption}, ${stone.won ? 'won' : 'lost'}`}
        >
            <span className={styles.number}>#{stone.sequence.toLocaleString()}</span>
            <span className={styles.badges}>
                <span className={styles.result}>{stone.won ? 'Won' : 'Lost'}</span>
                <span className={styles.kind}>{duel ? 'Duel' : 'Team 3v3'}</span>
            </span>
            <span className={styles.faces} aria-hidden>
                <span className={styles.side}>
                    {stone.mine.map((pet) => (
                        <Face key={pet.petId} pet={pet} chain={stone.chain} name={names.get(pet.petId) ?? ''} />
                    ))}
                </span>
                <span className={styles.vs}>vs</span>
                <span className={styles.side}>
                    {stone.theirs.map((pet) => (
                        <Face key={pet.petId} pet={pet} chain={stone.chain} name="" />
                    ))}
                </span>
            </span>
            <span className={styles.caption}>{caption}</span>
            <span className={styles.meta}>
                {when} · {roundsText(stone.rounds)}
            </span>
        </button>
    );
};

/**
 * The Ledger Stones: the player's recent battles, each a signed receipt they can check.
 *
 * The list comes from the public receipt corpus, the same export anyone can download, so it
 * needs a wallet but no sign-in. Opening a stone fetches its receipt again and runs the
 * browser's checks on it (`useLedgerStone`), for duels and team battles alike; the list's
 * own summary is for display only and is never what a rune reports.
 */
const LedgerStones: React.FC = () => {
    const navigate = useNavigate();
    const { isConnected, walletAddress } = useChainCapabilities();
    const { pets } = usePetList();
    const stones = useLedgerStones(isConnected ? walletAddress : null, SHOWN);
    const [openId, setOpenId] = useState<string | null>(null);
    const reading = useLedgerStone(openId);
    const back = () => navigate(DASHBOARD_HOME);

    if (!isConnected) {
        return (
            <StateCard title={TITLE} back={back}>
                <GateScene
                    kind="wallet"
                    title="Connect your wallet"
                    text="Connect your wallet to read the stones of your battles."
                    hint="Use the Connect Wallet key at the top of the screen."
                />
            </StateCard>
        );
    }

    const names = new Map(pets.map((pet) => [pet.id, pet.name]));
    const list = stones.data ?? [];
    const open = list.find((stone) => stone.battleId === openId);
    const checked = reading.data;

    return (
        <DashboardPanel
            title={TITLE}
            description="Every battle is carved into a stone: a signed receipt anyone can replay. Tap one and your browser checks it."
            back={back}
        >
            {stones.isLoading ? (
                <p className={styles.status}>Gathering your stones…</p>
            ) : stones.error ? (
                <p className={styles.status} role="alert">
                    Your stones could not be fetched. Try again in a moment.
                </p>
            ) : list.length === 0 ? (
                <p className={styles.status}>No stones yet. Every battle you fight, won or lost, is carved here.</p>
            ) : (
                <ul className={styles.grid}>
                    {list.map((stone) => (
                        <li key={stone.battleId}>
                            <StoneCard stone={stone} names={names} onOpen={() => setOpenId(stone.battleId)} />
                        </li>
                    ))}
                </ul>
            )}
            {list.length === SHOWN && (
                <p className={styles.more}>
                    Your newest {SHOWN} stones. The public receipt corpus holds every one.
                </p>
            )}

            {open && reading.isLoading && (
                <p className={styles.toast} role="status">
                    Checking stone #{open.sequence.toLocaleString()}…
                </p>
            )}
            {open && reading.error && (
                <p className={clsx(styles.toast, styles.toastError)} role="alert">
                    Stone #{open.sequence.toLocaleString()} could not be fetched.
                    <button type="button" onClick={() => setOpenId(null)}>
                        Close
                    </button>
                </p>
            )}
            {open && checked && (
                <LedgerTablet
                    // Everything carved here is read off the receipt that was just checked, not
                    // off the list's unchecked summary.
                    record={{
                        battleId: checked.receipt.battleId,
                        sequence: checked.receipt.sequence,
                        round: checked.receipt.beacon.round,
                        rounds: checked.receipt.result.rounds,
                        checks: checked.checks,
                    }}
                    caption={`${open.kind === 'duel' ? 'Duel' : 'Team 3v3'} · ${open.won ? 'won' : 'lost'} in ${roundsText(checked.receipt.result.rounds)}`}
                    onClose={() => setOpenId(null)}
                />
            )}
        </DashboardPanel>
    );
};

export default LedgerStones;
