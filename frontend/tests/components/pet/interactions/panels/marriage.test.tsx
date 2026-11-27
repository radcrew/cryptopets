// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    notifyError: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: () => ({ data: undefined, isLoading: false, error: null }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@constants/interactionRoutes', () => ({ DASHBOARD_HOME: '/dashboard' }));
vi.mock('@hooks/useNotifyError', () => ({ useNotifyError: () => mocks.notifyError }));
vi.mock('@components/ui/icon', () => ({ default: () => null, CheckIcon: () => null }));
vi.mock('@constants/tones', () => ({ Tones: { Emerald: 'emerald' } }));
// PetSearchDropdown uses useSearchPets (not tested here) — stub it as a plain text input.
vi.mock('@components/ui/pet-search-dropdown', () => ({
    default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder ?? 'Search'}
        />
    ),
}));

const capabilities = { kind: 'evm' as string, activeKind: 'evm' as string | null, walletAddress: '0xwallet' as string | null };
const marriage = {
    propose: { mutateAsync: vi.fn(), isPending: false },
    accept: { mutateAsync: vi.fn(), isPending: false },
    cancel: { mutateAsync: vi.fn(), isPending: false },
    divorce: { mutateAsync: vi.fn(), isPending: false },
};
const petList = {
    pets: [{ id: '1', name: 'Rex', chain: 'evm' }, { id: '2', name: 'Blaze', chain: 'evm' }] as { id: string; name: string; chain: string }[],
    refetch: vi.fn(),
};
/** The chain roster behind `useAllPets`: every pet on chain, counterparts included. */
let rosterPets: { id: string; name: string; chain: string; dna?: bigint }[] = [];

const marriageInfo = { isMarried: false, hasProposal: false, spouseId: undefined as string | undefined, proposer: undefined as string | undefined, proposalPetIdB: undefined as string | undefined, proposalExpiry: undefined as bigint | undefined };
let incomingProposals: { proposerPetId: string; proposerPetName: string; proposerOwner: string; targetPetId: string; expiry: number }[] = [];

vi.mock('@shared/core', () => ({
    formatExpiry: (expirySec: number) => {
        const diff = expirySec - Math.floor(Date.now() / 1000);
        if (diff <= 0) return 'Expired';
        if (diff < 3600) return `${Math.ceil(diff / 60)}m`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
        return `${Math.floor(diff / 86400)}d`;
    },
    useAuth: () => ({ isAuthenticated: true, isSigning: false, isVerifying: false, isNonceLoading: false, signAndLogin: vi.fn() }),
    useChainCapabilities: () => capabilities,
    usePetList: () => petList,
    useAllPets: () => ({ pets: rosterPets }),
    useIncomingProposals: () => ({ proposals: incomingProposals, isLoading: false }),
    useMarriage: () => marriage,
    useMarriageInfo: () => marriageInfo,
    useApiClient: () => ({ defaults: { baseURL: '' }, post: vi.fn() }),
    useSpousePet: () => ({ name: undefined, level: undefined }),
    useSearchPets: () => ({ results: [], isLoading: false, error: null, refetch: vi.fn() }),
    getPetAvatar: () => '🐉',
    getPetClass: () => 'Warrior',
    getRarityColor: () => '#ff7bcb',
    // No art service in these tests: PetArt renders the emoji alone.
    petArtUrl: () => null,
}));

import MarriagePanel from '@components/pet/interactions/panels/marriage';

/** Picks one of the player's pets from the tray of portraits under the altar. */
async function choosePet(name: string) {
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));
}

beforeEach(() => {
    vi.clearAllMocks();
    capabilities.kind = 'evm';
    capabilities.activeKind = 'evm';
    capabilities.walletAddress = '0xwallet';
    Object.assign(marriage.propose, { isPending: false });
    Object.assign(marriage.accept, { isPending: false });
    Object.assign(marriage.cancel, { isPending: false });
    Object.assign(marriage.divorce, { isPending: false });
    petList.pets = [{ id: '1', name: 'Rex', chain: 'evm' }, { id: '2', name: 'Blaze', chain: 'evm' }];
    Object.assign(marriageInfo, { isMarried: false, hasProposal: false, spouseId: undefined, proposer: undefined, proposalPetIdB: undefined, proposalExpiry: undefined });
    incomingProposals = [];
    rosterPets = [
        ...petList.pets,
        { id: '3', name: 'Tiger', chain: 'evm', dna: 3n },
    ];
});

describe('MarriagePanel', () => {
    it('prompts to connect when no chain is active', () => {
        capabilities.kind = 'none';
        render(<MarriagePanel />);
        expect(screen.getByText('Connect a wallet to use marriage.')).toBeInTheDocument();
    });

    it('renders the altar: a tray of your pets, the partner search and the proposal key', async () => {
        render(<MarriagePanel />);
        expect(screen.getByPlaceholderText('Search by name or ID…')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Send Proposal/ })).toBeInTheDocument();

        // Each pet is shown, not just named: the art is how a player recognises which
        // one they are marrying.
        expect(screen.getByRole('radio', { name: /Rex/ })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Blaze/ })).toBeInTheDocument();

        // The chosen pet takes its place at the altar.
        await choosePet('Rex');
        expect(screen.getAllByText('Rex').length).toBeGreaterThan(1);
    });

    it('disables Send Proposal when no pet or partner is selected', () => {
        render(<MarriagePanel />);
        expect(screen.getByRole('button', { name: /Send Proposal/ })).toBeDisabled();
    });

    it('calls propose.mutateAsync and shows success when proposal is submitted', async () => {
        marriage.propose.mutateAsync.mockResolvedValue(undefined);
        render(<MarriagePanel />);
        await choosePet('Rex');
        await userEvent.type(screen.getByPlaceholderText('Search by name or ID…'), '5');
        await userEvent.click(screen.getByRole('button', { name: /Send Proposal/ }));
        expect(marriage.propose.mutateAsync).toHaveBeenCalledWith({ petIdA: '1', petIdB: '5' });
        expect(await screen.findByText('Proposal sent!')).toBeInTheDocument();
    });

    it('calls notifyError when mutateAsync throws', async () => {
        marriage.propose.mutateAsync.mockRejectedValue(new Error('revert'));
        render(<MarriagePanel />);
        await choosePet('Rex');
        await userEvent.type(screen.getByPlaceholderText('Search by name or ID…'), '5');
        await userEvent.click(screen.getByRole('button', { name: /Send Proposal/ }));
        await vi.waitFor(() => expect(mocks.notifyError).toHaveBeenCalled());
        expect(mocks.notifyError).toHaveBeenCalledWith('Marriage action failed', expect.any(Error), 'marriage');
    });

    // The proposal rows identify pets the reader may not own, so the art comes from the
    // chain roster rather than from the proposal itself.
    it('shows both pets in an incoming proposal, art included', async () => {
        incomingProposals = [{
            proposerPetId: '3',
            proposerPetName: 'Tiger',
            proposerOwner: '0xother',
            targetPetId: '1',
            expiry: Math.floor(Date.now() / 1000) + 3600,
        }];
        const { container } = render(<MarriagePanel />);
        await userEvent.click(screen.getByRole('button', { name: /💒 Accept/ }));

        expect(screen.getByText(/Tiger/)).toBeInTheDocument();
        expect(screen.getByText(/your Rex/)).toBeInTheDocument();
        // One frame per side, both resolved through the roster.
        expect(container.querySelectorAll('.proposalArt')).toHaveLength(2);
    });

    it('leaves out the art for a counterpart the roster has not resolved', async () => {
        incomingProposals = [{
            proposerPetId: '99',
            proposerPetName: 'Ghost',
            proposerOwner: '0xother',
            targetPetId: '1',
            expiry: Math.floor(Date.now() / 1000) + 3600,
        }];
        const { container } = render(<MarriagePanel />);
        await userEvent.click(screen.getByRole('button', { name: /💒 Accept/ }));

        // Still named and numbered — the row degrades to what it rendered before.
        expect(screen.getByText(/Ghost/)).toBeInTheDocument();
        expect(screen.getByText('#99')).toBeInTheDocument();
        expect(container.querySelectorAll('.proposalArt')).toHaveLength(1);
    });

    it('shows Divorce button for each married pet', () => {
        Object.assign(marriageInfo, { isMarried: true, spouseId: '9' });
        render(<MarriagePanel />);
        expect(screen.getAllByRole('button', { name: 'Divorce' })).toHaveLength(2);
    });

    it('shows Cancel button for own outgoing proposals', () => {
        Object.assign(marriageInfo, { hasProposal: true, proposer: '0xwallet', proposalPetIdB: '7' });
        render(<MarriagePanel />);
        expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(2);
    });

    it('shows Proposing... label while propose is pending', () => {
        marriage.propose.isPending = true;
        render(<MarriagePanel />);
        expect(screen.getByRole('button', { name: 'Proposing...' })).toBeInTheDocument();
    });

    it('shows incoming proposals in the Accept tab and allows acceptance', async () => {
        marriage.accept.mutateAsync.mockResolvedValue(undefined);
        incomingProposals = [{
            proposerPetId: '3',
            proposerPetName: 'Tiger',
            proposerOwner: '0xother',
            targetPetId: '1',
            expiry: Math.floor(Date.now() / 1000) + 3600,
        }];
        render(<MarriagePanel />);
        // Switch to Accept tab (the tab button has emoji prefix)
        await userEvent.click(screen.getByRole('button', { name: /💒 Accept/ }));
        // Click Accept on the proposal row
        await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
        // Confirm dialog appears
        expect(screen.getByText(/Accept Proposal/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));
        expect(marriage.accept.mutateAsync).toHaveBeenCalledWith({ petIdA: '3', petIdB: '1' });
        expect(await screen.findByText('Marriage accepted!')).toBeInTheDocument();
    });
});
