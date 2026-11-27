import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';

import { usePetChoice } from '@hooks/usePetChoice';

/** A panel in miniature: the chosen pet, a key to choose one, and a sheet's way in. */
const Panel = ({ eligible }: { eligible: string[] }) => {
    const [selected, choose] = usePetChoice(eligible);
    const navigate = useNavigate();
    return (
        <>
            <p>{`chosen: ${selected || 'none'}`}</p>
            <button type="button" onClick={() => choose('1')}>
                choose 1
            </button>
            <button type="button" onClick={() => navigate('/train', { state: { petId: '2' } })}>
                sheet hands over 2
            </button>
        </>
    );
};

const renderPanel = (state: { petId?: string } | null, eligible = ['1', '2']) =>
    render(
        <MemoryRouter initialEntries={[{ pathname: '/train', state }]}>
            <Panel eligible={eligible} />
        </MemoryRouter>,
    );

describe('usePetChoice', () => {
    it('starts with the pet the page was opened for', () => {
        renderPanel({ petId: '2' });
        expect(screen.getByText('chosen: 2')).toBeInTheDocument();
    });

    it('ignores a handed-over pet the panel cannot act on', () => {
        renderPanel({ petId: '9' });
        expect(screen.getByText('chosen: none')).toBeInTheDocument();
    });

    it('lets the player choose another, until a sheet hands over a pet again', async () => {
        renderPanel(null);
        await userEvent.click(screen.getByRole('button', { name: 'choose 1' }));
        expect(screen.getByText('chosen: 1')).toBeInTheDocument();

        // The same page, a new navigation: the new pet wins over the old choice.
        await userEvent.click(screen.getByRole('button', { name: 'sheet hands over 2' }));
        expect(screen.getByText('chosen: 2')).toBeInTheDocument();
    });
});
