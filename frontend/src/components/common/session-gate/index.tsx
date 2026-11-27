import React, { type ReactNode } from 'react';
import { useAuth, useChainCapabilities } from '@shared/core';

import AuthActionButton from '@components/common/auth-action-button';
import GateScene from '@components/game/gate-scene';
import StateCard from '@components/pet/interactions/state-card';
import type { NeonButtonTone } from '@components/ui/neon-button';
import styles from './index.module.css';

export type SessionGateProps = {
    /** Panel heading, shown in every state so the screen keeps its identity. */
    title: ReactNode;
    /** Shown when no wallet is connected. */
    connectPrompt: string;
    /** Shown when a wallet is connected but the session is not signed in. */
    signInPrompt: string;
    /** Accent for the sign-in button, matching the screen. */
    tone?: NeonButtonTone;
    back: () => void;
    children: ReactNode;
};

/**
 * Gates a screen that cannot render without an authenticated session, and asks for
 * whichever step is actually missing.
 *
 * These are two different states and were previously treated as one. A connected wallet
 * is not a session: `/graphql` and `/api/chat` are JWT-gated, so a player who has
 * connected but not signed the login message gets 401s. Screens that only checked
 * `isConnected` rendered anyway and surfaced that as a raw error, or worse as an empty
 * state — "No conversations yet" and "No battles on record yet" are both *wrong* when
 * the real answer is "we have not asked who you are yet", and neither tells the player
 * what to do about it.
 *
 * Signing in is one click, so each state is a closed gate with its key (`GateScene`) and
 * one line on what the key does. The sign-in key is the same `AuthActionButton` the
 * battle, breed and marriage panels already use, so it reads the same wherever a player
 * meets it.
 */
const SessionGate: React.FC<SessionGateProps> = ({
    title,
    connectPrompt,
    signInPrompt,
    tone = 'cyan',
    back,
    children,
}) => {
    const { isConnected } = useChainCapabilities();
    const { isAuthenticated } = useAuth();

    if (!isConnected) {
        return (
            <StateCard containerClassName={styles.fill} title={title} back={back}>
                <GateScene
                    kind="wallet"
                    title="Connect your wallet"
                    text={connectPrompt}
                    hint="Use the Connect Wallet key at the top of the screen."
                />
            </StateCard>
        );
    }

    if (!isAuthenticated) {
        return (
            <StateCard containerClassName={styles.fill} title={title} back={back}>
                <GateScene
                    kind="lock"
                    title="Sign in to play"
                    text={signInPrompt}
                    hint="Signing in proves this wallet is yours. It is a free signature, not a transaction."
                >
                    <AuthActionButton tone={tone}>Sign in</AuthActionButton>
                </GateScene>
            </StateCard>
        );
    }

    return <>{children}</>;
};

export default SessionGate;
