import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const session = { activeKind: 'evm' as string | null };
vi.mock('@shared/core', () => ({
    getRarityColor: () => '#ffd700',
    getRarityName: () => 'Rare',
    useChainCapabilities: () => session,
}));
// The art reads an image service; these cases are about the preview's frame and wording.
vi.mock('@components/item/item-art', () => ({ default: () => <span>art</span> }));

import Market from '@components/market';

const renderMarket = () =>
    render(
        <MemoryRouter>
            <Market />
        </MemoryRouter>,
    );

describe('Market', () => {
    it('is a labelled preview whose listings cannot be bought', () => {
        renderMarket();
        expect(screen.getByRole('region', { name: /^Coming soon: List your pets and items/ })).toHaveTextContent('Coming soon');
        // Inside an inert container: browsers make it unclickable and skip it for the keyboard and
        // screen readers. jsdom does not implement inert, so the attribute is what is checked.
        expect(screen.getAllByText('Buy')[0]!.closest('[inert]')).not.toBeNull();
    });

    it('prices the sample in the active chain\'s coin', () => {
        session.activeKind = 'solana';
        renderMarket();
        expect(screen.getByText('0.04 SOL')).toBeInTheDocument();
        session.activeKind = 'evm';
    });
});
