// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
const socket = vi.hoisted(() => ({ connected: false }));

vi.mock('../../src/contexts/ApiClientContext', () => ({
    useApiClient: () => ({ get, post: vi.fn(), defaults: { baseURL: 'http://api' } }),
}));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../src/hooks/chat/useChatThreadSocket', () => ({
    useChatThreadSocket: () => ({ connected: socket.connected, online: [] }),
}));

import { useChatMessages } from '../../src/hooks/chat/useChatMessages';

function wrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockResolvedValue({ data: { messages: [], readUpTo: 0 } });
});

afterEach(() => vi.useRealTimers());

describe('useChatMessages without a live socket', () => {
    it('re-reads the thread on a timer, so a serverless backend still delivers messages', async () => {
        socket.connected = false;
        renderHook(() => useChatMessages({ threadId: 't1', socketUrl: 'ws://api/ws/chat' }), { wrapper });
        await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

        await vi.advanceTimersByTimeAsync(5_000);
        await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    });

    it('does not poll while the socket is connected', async () => {
        socket.connected = true;
        renderHook(() => useChatMessages({ threadId: 't1', socketUrl: 'ws://api/ws/chat' }), { wrapper });
        await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

        await vi.advanceTimersByTimeAsync(15_000);
        expect(get).toHaveBeenCalledTimes(1);
    });
});
