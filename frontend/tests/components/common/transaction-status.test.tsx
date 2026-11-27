import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { TxLifecycle } from '@shared/core';

import TransactionStatus from '@components/common/transaction-status';

const lc = (over: Partial<TxLifecycle> = {}): TxLifecycle =>
    ({ phase: 'idle', hash: undefined, ...over }) as unknown as TxLifecycle;

const HASH = '0x1234567890abcdef1234567890abcdef';

describe('TransactionStatus', () => {
    it('renders nothing while idle', () => {
        const { container } = render(<TransactionStatus lifecycle={lc()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows a confirming state with a spinner and truncated hash', () => {
        const { container } = render(
            <TransactionStatus lifecycle={lc({ phase: 'confirming', hash: HASH })} />,
        );

        expect(screen.getByText('Confirming transaction...')).toBeInTheDocument();
        expect(container.querySelector('.spinner')).toBeInTheDocument();
        expect(screen.getByText('0x12345678...90abcdef')).toBeInTheDocument();
    });

    it('latches a confirmed state on the confirming → success transition', () => {
        const { rerender } = render(
            <TransactionStatus lifecycle={lc({ phase: 'confirming', hash: HASH })} />,
        );

        rerender(<TransactionStatus lifecycle={lc({ phase: 'success' })} />);

        expect(screen.getByText('Transaction confirmed!')).toBeInTheDocument();
        // Latched hash survives the lifecycle no longer carrying it.
        expect(screen.getByText('0x12345678...90abcdef')).toBeInTheDocument();
    });

    it('does not show a confirmed state for a success with no prior confirming', () => {
        const { container } = render(<TransactionStatus lifecycle={lc({ phase: 'success' })} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('dismisses the confirming toast when close is clicked', () => {
        const { container } = render(
            <TransactionStatus lifecycle={lc({ phase: 'confirming', hash: HASH })} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(container).toBeEmptyDOMElement();
    });

    describe('auto-dismiss of the confirmed state', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it('clears the confirmed toast after the display timeout', () => {
            const { rerender, container } = render(
                <TransactionStatus lifecycle={lc({ phase: 'confirming', hash: HASH })} />,
            );
            rerender(<TransactionStatus lifecycle={lc({ phase: 'success' })} />);
            expect(screen.getByText('Transaction confirmed!')).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(2000);
            });

            expect(container).toBeEmptyDOMElement();
        });
    });
});
