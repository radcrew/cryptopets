import React, { useState } from 'react';
import clsx from 'clsx';
import NeonButton from '@components/ui/neon-button';
import PetArt from '@components/pet/pet-art';
import {
    getRarityColor,
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
            <div className={clsx('interface', styles.post)}>
                {!isStandaloneView && (
                    <>
                        <h4>🛡️ Allow Challenges</h4>
                        <p>Let other players battle your pets while you are away.</p>
                    </>
                )}

                {/* The gate's sign, above the controls because it changes what they mean.
                    Signing again when a grant went stale is a repair, not a duplicate, and a
                    player who cannot see the difference reads the same key two ways. */}
                {status.kind !== 'unknown' && (
                    <div className={clsx(styles.gate, styles[status.kind])} role="status">
                        <span className={styles.shield} aria-hidden>
                            {status.kind === 'active' ? '🛡️' : status.kind === 'stale' ? '⚠️' : '🔒'}
                        </span>
                        <span className={styles.gateText}>
                            <b>
                                {status.kind === 'active'
                                    ? 'The gate is open'
                                    : status.kind === 'stale'
                                      ? 'The rules changed'
                                      : 'The gate is closed'}
                            </b>
                            <small>
                                {status.kind === 'active'
                                    ? 'Your pets can be challenged under the current rules.'
                                    : status.kind === 'stale'
                                      ? 'The battle rules changed since you allowed challenges, so your consent no longer covers anything and your pets cannot be challenged. Allow challenges again to restore it.'
                                      : 'You have not allowed challenges, so nobody can battle your pets.'}
                            </small>
                        </span>
                    </div>
                )}

                {/* Who may be challenged: every pet, or the ones tapped below. */}
                <div className={styles.choice} role="radiogroup" aria-label="Which pets can be challenged">
                    <button
                        type="button"
                        role="radio"
                        aria-checked={allPets}
                        className={clsx(styles.choiceKey, allPets && styles.choiceOn)}
                        onClick={() => setAllPets(true)}
                    >
                        <b>All my pets</b>
                        <small>Including ones I get later</small>
                    </button>
                    <button
                        type="button"
                        role="radio"
                        aria-checked={!allPets}
                        className={clsx(styles.choiceKey, !allPets && styles.choiceOn)}
                        onClick={() => setAllPets(false)}
                    >
                        <b>Chosen pets</b>
                        <small>Only the ones I tap below</small>
                    </button>
                </div>

                {!allPets && (
                    <ul className={styles.guards} aria-label="Pets that can be challenged">
                        {pets.map((pet) => {
                            const on = selected.includes(pet.id);
                            return (
                                <li key={pet.id}>
                                    <button
                                        type="button"
                                        className={clsx(styles.guard, on && styles.guardOn)}
                                        style={{ '--rc': getRarityColor(pet.rarity) } as React.CSSProperties}
                                        aria-pressed={on}
                                        onClick={() => toggle(pet.id)}
                                    >
                                        <span className={styles.guardFace}>
                                            <PetArt pet={pet} fill />
                                            {on && (
                                                <span className={styles.guardTick} aria-hidden>
                                                    ✓
                                                </span>
                                            )}
                                        </span>
                                        <span className={styles.guardName}>{pet.name}</span>
                                        <small>Level {pet.level}</small>
                                    </button>
                                </li>
                            );
                        })}
                        {pets.length === 0 && (
                            <li className={styles.empty}>{petsLoading ? 'Loading your pets…' : 'No pets to authorize yet.'}</li>
                        )}
                    </ul>
                )}

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

                {/* Delegated battle signing (§D). Separate from consent above, and the two
                    are easy to confuse: that one lets *others* challenge you, this one
                    lets you start battles without a wallet prompt each time. */}
                {session.supported && (
                    <div className={styles.session}>
                        <span className={styles.sessionIcon} aria-hidden>
                            🗝️
                        </span>
                        <span className={styles.sessionLabel}>
                            <b>Battle session</b>
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
