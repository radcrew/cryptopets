import React, { type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';

import { ApiClientProvider, AuthProvider, PetsConfigProvider, queryClient } from '@shared/core';
import { wagmiConfig } from '@chains/ethereum/wagmi';
import { SolanaAnchorWallet } from '@chains/solana/anchor-wallet';
import { SolanaAuthSigner } from '@chains/solana/auth-signer';
import { SolanaWalletProvider } from '@chains/solana/provider';
import { solanaNetworkNameFromCluster } from '@constants/chains';
import { ToastProvider } from '@components/ui/toast';
import { DynamicProvider } from '@contexts/dynamic';
import { SoundProvider } from '@contexts/sound';
import { API_URL } from './config';
import { petsContractParams } from './petsContractParams';

const solanaNetwork = solanaNetworkNameFromCluster(import.meta.env.VITE_SOLANA_CLUSTER);

/** Wraps the rest of the tree; outermost provider first. */
type Wrapper = (children: ReactNode) => ReactNode;

/**
 * App-wide providers as a flat, ordered list (outermost first) instead of a deep
 * JSX pyramid, so the nesting order is reviewable in one place. SolanaAuthSigner
 * is a non-wrapping sibling that must live inside SolanaWalletProvider, so it
 * renders alongside the children there.
 */
const providers: Wrapper[] = [
    (c) => <WagmiProvider config={wagmiConfig}>{c}</WagmiProvider>,
    (c) => <QueryClientProvider client={queryClient}>{c}</QueryClientProvider>,
    (c) => <DynamicProvider>{c}</DynamicProvider>,
    (c) => (
        <SolanaWalletProvider network={solanaNetwork}>
            <SolanaAuthSigner />
            {c}
        </SolanaWalletProvider>
    ),
    (c) => <SolanaAnchorWallet>{c}</SolanaAnchorWallet>,
    (c) => <ApiClientProvider baseURL={API_URL}>{c}</ApiClientProvider>,
    (c) => <AuthProvider>{c}</AuthProvider>,
    (c) => <PetsConfigProvider evm={petsContractParams}>{c}</PetsConfigProvider>,
    (c) => <SoundProvider>{c}</SoundProvider>,
    (c) => <ToastProvider>{c}</ToastProvider>,
    (c) => <BrowserRouter>{c}</BrowserRouter>,
];

export const AppProviders: React.FC<{ children: ReactNode }> = ({ children }) =>
    providers.reduceRight<ReactNode>((acc, wrap) => wrap(acc), children);
