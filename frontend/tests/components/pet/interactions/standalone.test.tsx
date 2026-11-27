// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const capabilities = { isConnected: false, kind: 'evm' };
const petList = { pets: [] as { id: string }[], isLoading: false };

vi.mock('@shared/core', () => ({
    useChainCapabilities: () => capabilities,
    usePetList: () => petList,
}));
vi.mock('@constants/interactionRoutes', () => ({
    STANDALONE_INTERACTION_HEADERS: {
        breed: { Icon: () => null, label: 'Breeding Lab', sub: 'Breed two pets' },
        battle: { Icon: () => null, label: 'Battle Arena', sub: 'Pick two pets' },
    },
}));
vi.mock('@components/ui/icon', () => ({
    default: () => null,
    BattleIcon: () => null,
}));
vi.mock('@components/common/dashboard-panel', () => ({
    default: ({ children, title }: { children: React.ReactNode; title: React.ReactNode }) => (
        <div data-testid="dashboard-panel">{title}{children}</div>
    ),
}));
vi.mock('@components/pet/interactions/state-card', () => ({
    default: ({ description, children }: { description?: string; children?: React.ReactNode }) => (
        <div data-testid="state-card">{description}{children}</div>
    ),
}));
vi.mock('@constants/tones', () => ({ Tones: { Violet: 'violet' } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
const party = vi.hoisted(() => ({ openParty: vi.fn(), openPet: vi.fn(), openSummon: vi.fn() }));
vi.mock('@contexts/party', () => ({ useParty: () => party }));

import InteractionStandalone from '@components/pet/interactions/standalone';

beforeEach(() => {
    vi.clearAllMocks();
    capabilities.isConnected = false;
    petList.pets = [];
    petList.isLoading = false;
});

describe('InteractionStandalone', () => {
    it('shows wallet-disconnected state when not connected', () => {
        render(
            <InteractionStandalone action="breed" minPets={1}>
                <span>content</span>
            </InteractionStandalone>,
        );
        const card = screen.getByTestId('state-card');
        expect(card).toHaveTextContent('Connect your wallet');
    });

    it('shows loading spinner when connected but pets are loading', () => {
        capabilities.isConnected = true;
        petList.isLoading = true;
        render(
            <InteractionStandalone action="breed" minPets={1}>
                <span>content</span>
            </InteractionStandalone>,
        );
        expect(screen.getByText('Loading your pets...')).toBeInTheDocument();
    });

    it('shows no-pets state when connected and pets list is empty', () => {
        capabilities.isConnected = true;
        render(
            <InteractionStandalone action="breed" minPets={1}>
                <span>content</span>
            </InteractionStandalone>,
        );
        expect(screen.getByTestId('state-card')).toHaveTextContent("don't have any pets");
    });

    it('offers to summon a pet rather than sending the player to look for where', async () => {
        capabilities.isConnected = true;
        render(
            <InteractionStandalone action="breed" minPets={1}>
                <span>content</span>
            </InteractionStandalone>,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Summon a pet' }));
        expect(party.openSummon).toHaveBeenCalled();
    });

    it('shows not-enough-pets state when minPets > 1 and only one pet exists', () => {
        capabilities.isConnected = true;
        petList.pets = [{ id: '1' }];
        render(
            <InteractionStandalone action="battle" minPets={2}>
                <span>content</span>
            </InteractionStandalone>,
        );
        expect(screen.getByTestId('state-card')).toHaveTextContent('at least two pets');
    });

    it('renders children when connected and enough pets exist', () => {
        capabilities.isConnected = true;
        petList.pets = [{ id: '1' }, { id: '2' }];
        render(
            <InteractionStandalone action="battle" minPets={2}>
                <span>my content</span>
            </InteractionStandalone>,
        );
        expect(screen.getByText('my content')).toBeInTheDocument();
    });
});
