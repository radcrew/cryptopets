import React, { useState } from 'react';
import NeonButton from '@components/ui/neon-button';
import {
    useChainCapabilities,
    useDefenseAuthorization,
    useBattleSession,
    useDefenseAuthorizations,
    usePetList,
} from '@shared/core';
import { useNotifyError } from '@hooks/useNotifyError';
import Icon, { CheckIcon } from '@components/ui/icon';
import { Tones } from '@constants/tones';
import styles from './index.module.css';

export type DefensePanelProps = {
    isStandaloneView?: boolean;
};

/**
 * Standing defence consent (§D).
 *
 * Without a grant here a pet cannot be challenged at all — the backend refuses every
 * battle whose defender has no covering authorization. It is signed once rather than
 * per battle so opponents do not have to be online, and it is bound to the current
 * ruleset, so a balance patch invalidates it and asks again.
 */
const DefensePanel: React.FC<DefensePanelProps> = ({ isStandaloneView = true }) => {
    const { isConnected } = useChainCapabilities();
    const { pets, isLoading: petsLoading } = usePetList();
    const notifyError = useNotifyError();
    const { grant, revoke, isPending, error } = useDefenseAuthorization();
    // What the panel could not say before: whether consent exists, and whether it still
    // applies. A rules change invalidates every grant by design, and being challenged is
    // passive, so without this a defender's pets go quiet and nothing here admits it.
    const { status, refresh } = useDefenseAuthorizations();
    // Delegated battle signing (§D). Lives here because this is already the screen about
    // what the wallet has authorized, and the two grants are easier to tell apart side by
    // side than scattered across the app.
    const session = useBattleSession();

    const [allPets, setAllPets] = useState(true);
    const [selected, setSelected] = useState<string[]>([]);
    const [success, setSuccess] = useState<string | null>(null);

    const toggle = (id: string) =>
        setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

    const handleGrant = async () => {
        if (!isConnected) {
            notifyError('Please connect your wallet first', undefined, 'defense-validation');
            return;
        }
        setSuccess(null);
        const hash = await grant(allPets ? { allPets: true } : { petIds: selected });
        if (hash) {
            // Both writes re-read: the status banner is the only thing that says whether the
            // grant took, so leaving it on a cached answer would contradict the success line
            // directly underneath it.
            refresh();
            setSuccess(
                allPets
                    ? 'Every pet you own can now be challenged.'
                    : `${selected.length} pet${selected.length === 1 ? '' : 's'} can now be challenged.`,
            );
        }
    };

    const handleRevoke = async () => {
        setSuccess(null);
        if (await revoke()) {
            refresh();
            setSuccess('Consent withdrawn. Your pets can no longer be challenged.');
        }
    };

    const nothingChosen = !allPets && selected.length === 0;

    return (
        <>
            <div className="interface">
                {!isStandaloneView && (
                    <>
                        <h4>🛡️ Allow Challenges</h4>
                        <p>Let other players battle your pets while you are away.</p>
                    </>
                )}

                {/* Above the controls, because it changes what the buttons mean. Signing
                    again when a grant went stale is a repair, not a duplicate, and a player
                    who cannot see the difference reads the same button two ways. */}
                {status.kind === 'stale' && (
                    <p className={styles.stale} role="status">
                        The battle rules changed since you allowed challenges, so your consent
                        no longer covers anything and your pets cannot be challenged. Allow
                        challenges again to restore it.
                    </p>
                )}
                {status.kind === 'active' && (
                    <p className={styles.active} role="status">
                        Your pets can be challenged under the current rules.
                    </p>
                )}
                {status.kind === 'none' && (
                    <p className={styles.inactive} role="status">
                        You have not allowed challenges, so nobody can battle your pets.
                    </p>
                )}

                {/* Delegated battle signing (§D). Separate from consent above, and the two
                    are easy to confuse: that one lets *others* challenge you, this one
                    lets you start battles without a wallet prompt each time. */}
                {session.supported && (
                    <div className={styles.session}>
                        <span className={styles.sessionLabel}>
                            {session.key
                                ? 'Battles are signed for this tab, so no wallet prompt each time.'
                                : 'Approve a battle session to stop confirming every fight in your wallet.'}
                        </span>
                        <NeonButton
                            tone={session.key ? 'magenta' : 'cyan'}
                            size="sm"
                            disabled={session.isPending || !isConnected}
                            onClick={() => {
                                setSuccess(null);
                                if (session.key) {
                                    void session.revoke();
                                    return;
                                }
                                void session.approve().then((key) => {
                                    if (key) setSuccess('Battle session approved for the next 24 hours.');
                                });
                            }}
                        >
                            {session.isPending ? 'Signing…' : session.key ? 'End session' : 'Approve session'}
                        </NeonButton>
                    </div>
                )}
                {session.error && <p className={styles.error}>{session.error.message}</p>}

                <div className="picker">
                    <div className="field">
                        <label htmlFor="defense-all">
                            <input
                                id="defense-all"
                                type="checkbox"
                                checked={allPets}
                                onChange={(e) => setAllPets(e.target.checked)}
                            />
                            {' '}All my pets, including ones I get later
                        </label>
                    </div>

                    {!allPets && (
                        <div className={styles.petList}>
                            {pets.map((pet) => (
                                <label key={pet.id} className={styles.petRow}>
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(pet.id)}
                                        onChange={() => toggle(pet.id)}
                                    />
                                    {' '}{pet.name} (Level {pet.level})
                                </label>
                            ))}
                            {pets.length === 0 && (
                                <p className={styles.empty}>
                                    {petsLoading ? 'Loading your pets…' : 'No pets to authorize yet.'}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <p className={styles.terms}>
                    Valid 30 days, up to 50 battles per day. You can withdraw at any time, and a
                    rules change ends it automatically.
                </p>

                <div className="action-controls">
                    <NeonButton
                        tone="emerald"
                        onClick={handleGrant}
                        disabled={isPending || nothingChosen || !isConnected}
                    >
                        {isPending ? 'Signing...' : 'Allow Challenges'}
                    </NeonButton>
                    <NeonButton tone="magenta" onClick={handleRevoke} disabled={isPending || !isConnected}>
                        Withdraw
                    </NeonButton>
                </div>

                {error && <p className={styles.error}>{error.message}</p>}
            </div>

            {success && (
                <div className="success-message">
                    <Icon as={CheckIcon} tone={Tones.Emerald} />
                    {success}
                </div>
            )}
        </>
    );
};

export default DefensePanel;
