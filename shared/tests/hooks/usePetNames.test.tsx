// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('../../src/contexts/ApiClientContext', () => ({
    useApiClient: () => ({ defaults: { baseURL: 'http://api' }, get: vi.fn(), post }),
}));

import { usePetNames } from '../../src/hooks/pets/usePetNames';

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {children}
    </QueryClientProvider>
);

describe('usePetNames', () => {
    it('looks up each pet by id and maps the ids it found to their names', async () => {
        post.mockImplementation(async (_url: string, body: { variables: { id: string } }) => ({
            data: { data: { pet: body.variables.id === '9' ? null : { id: body.variables.id, name: `Rex ${body.variables.id}`, level: 3 } } },
        }));
        const { result } = renderHook(() => usePetNames('evm', ['7', '8', '9']), { wrapper });

        await waitFor(() => expect(result.current.size).toBe(2));
        expect(result.current.get('7')).toBe('Rex 7');
        expect(result.current.get('8')).toBe('Rex 8');
        // An unknown pet is absent, so the caller falls back to its own label.
        expect(result.current.has('9')).toBe(false);
        expect(post).toHaveBeenCalledWith('/graphql', expect.objectContaining({ variables: { chain: 'evm', id: '7' } }));
    });

    it('asks for nothing without a chain', () => {
        post.mockClear();
        const { result } = renderHook(() => usePetNames(null, ['7']), { wrapper });
        expect(result.current.size).toBe(0);
        expect(post).not.toHaveBeenCalled();
    });
});
