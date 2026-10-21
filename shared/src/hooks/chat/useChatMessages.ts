import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../contexts/ApiClientContext';
import { useAuth } from '../../contexts/AuthContext';
import { useChatThreadSocket, type ChatThreadNotification } from './useChatThreadSocket';

/** One emoji on a message, with how many used it and whether you are one of them. */
export interface ChatMessageReaction {
    emoji: string;
    count: number;
    mine: boolean;
}

export interface ChatMessage {
    id: number;
    /** Author's wallet address. Compare against your own to decide which side to render. */
    sender: string;
    text: string;
    createdAt: string;
    /** Absent on a message stored before reactions existed; treat as none. */
    reactions?: ChatMessageReaction[];
}

export interface UseChatMessagesOptions {
    threadId: string | null;
    /**
     * `/ws/chat` endpoint. While it is not connected, including when it is undefined or the
     * host cannot hold WebSockets (a serverless backend), the thread polls instead.
     */
    socketUrl?: string;
}

/** A page as the server returns it: the messages, plus how far the other side has read. */
interface ChatPage {
    messages: ChatMessage[];
    readUpTo: number;
}

/**
 * Messages per request. Sent explicitly rather than left to the server's default, because
 * a short page is how this knows it has reached the start of the thread.
 */
const PAGE_SIZE = 50;

/**
 * How often a thread re-reads while the socket is down. Well inside the chat read limit
 * (120 a minute per wallet) even with several pages loaded, and fast enough that a
 * conversation still reads as live.
 */
const CHAT_POLL_INTERVAL_MS = 5_000;

export interface UseChatMessagesResult {
    messages: ChatMessage[];
    /**
     * Newest message id the counterpart has read; 0 if none.
     *
     * One number for the whole thread rather than a flag per message: read state is a
     * watermark, so `message.id <= readUpTo` answers it for every message at once.
     */
    readUpTo: number;
    /** Moves the caller's own watermark, so the sender's receipt fills in. */
    markRead: (messageId: number) => void;
    /**
     * Taps a reaction on a message: adds it, replaces the one you had, or removes it if
     * it is the one you already had. The server decides which, since only it knows the
     * current state without a race.
     */
    react: (messageId: number, emoji: string) => void;
    isLoading: boolean;
    error: Error | null;
    /** True while the notification channel is connected; false means reads are on demand only. */
    isLive: boolean;
    /** Wallet addresses currently connected to this thread, including your own. */
    online: string[];
    send: (text: string) => Promise<void>;
    isSending: boolean;
    sendError: Error | null;
    /** Whether there is older history left to fetch. */
    hasOlder: boolean;
    /** True while a page of older history is in flight. */
    isLoadingOlder: boolean;
    /** Fetches the page before the oldest message held. Safe to call repeatedly. */
    loadOlder: () => void;
}

export const chatMessagesQueryKey = (baseURL: string, threadId: string | null) => [
    'chatMessages',
    baseURL,
    threadId,
];

/**
 * One thread's messages, kept current by the notification channel.
 *
 * The socket never delivers content — it says the thread changed, and this re-reads. That
 * is why a dropped connection degrades to "not live" rather than "wrong": the read is
 * always the source, and a reconnect triggers one because anything sent while the socket
 * was down was never announced.
 *
 * Sending invalidates rather than appending optimistically. A message the server refused
 * (the marriage ended between opening the thread and hitting send) must not sit in the
 * transcript looking delivered — and unlike a like button, the whole point of a message
 * is that the other person actually received it.
 */
export const useChatMessages = ({
    threadId,
    socketUrl,
}: UseChatMessagesOptions): UseChatMessagesResult => {
    const apiClient = useApiClient();
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const baseURL = apiClient.defaults.baseURL ?? '';
    const queryKey = chatMessagesQueryKey(baseURL, threadId);

    // Rebuilds the key inside rather than closing over the outer array, whose identity
    // changes every render — that is what previously needed an exhaustive-deps
    // suppression, and a suppression here would be permanent: this callback is wired to
    // the socket, the reconnect path and mutation success.
    const refresh = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: chatMessagesQueryKey(baseURL, threadId) });
    }, [queryClient, baseURL, threadId]);

    // A frame naming a message already in the cache is the echo of our own send, which
    // `onSuccess` has already applied — re-reading fifty messages to learn nothing.
    const onNotification = useCallback(
        (message: ChatThreadNotification) => {
            // A receipt or a reaction always names a message this client already holds —
            // that is the point of both — so the echo check below would swallow them.
            if (message.type === 'thread-read' || message.type === 'thread-reacted') {
                refresh();
                return;
            }
            const cached = queryClient.getQueryData<{ pages: ChatPage[] }>(
                chatMessagesQueryKey(baseURL, threadId),
            );
            const held = cached?.pages.some((page) =>
                page.messages.some((entry) => entry.id === message.messageId),
            );
            if (held) return;
            refresh();
        },
        [queryClient, baseURL, threadId, refresh],
    );

    // Above the query, because whether it is connected decides whether the query polls.
    const { connected, online } = useChatThreadSocket({
        url: socketUrl,
        threadId,
        onNotification,
        onReconnect: refresh,
    });

    /**
     * Paged backwards from the newest message, a page at a time.
     *
     * `pages[0]` is the newest page and each one after it is older, which is the reverse
     * of reading order — the transcript flattens them back the other way below.
     *
     * An infinite query rather than a page held in component state: a notification has to
     * refresh *every* page on screen, not just the newest. A reaction or a read receipt
     * can land on a message loaded ten pages ago, and history frozen in state would show
     * it stale until reload. The cost is that a re-read fetches each loaded page; a thread
     * here is one pair of players, so that is a handful of small requests.
     */
    const query = useInfiniteQuery({
        queryKey,
        enabled: isAuthenticated && threadId != null,
        initialPageParam: undefined as number | undefined,
        queryFn: async ({ pageParam }): Promise<ChatPage> => {
            const { data } = await apiClient.get<Partial<ChatPage>>(
                `/api/chat/threads/${threadId}/messages`,
                { params: { limit: PAGE_SIZE, ...(pageParam ? { before: pageParam } : {}) } },
            );
            return { messages: data.messages ?? [], readUpTo: data.readUpTo ?? 0 };
        },
        // The oldest id held, to page back from. A page shorter than asked for is the
        // start of the thread, and returning undefined is what stops the loop.
        getNextPageParam: (lastPage) =>
            lastPage.messages.length < PAGE_SIZE ? undefined : lastPage.messages[0]?.id,
        // The socket only says "something changed"; without it, nothing would. Polling
        // stops the moment it connects, and React Query pauses it in a background tab.
        refetchInterval: connected ? false : CHAT_POLL_INTERVAL_MS,
    });

    /** Oldest first across every loaded page, which is the order the transcript reads in. */
    const messages = useMemo(
        () => [...(query.data?.pages ?? [])].reverse().flatMap((page) => page.messages),
        [query.data],
    );

    const mutation = useMutation({
        mutationFn: async (text: string) => {
            const { data } = await apiClient.post<{ message: ChatMessage }>(
                `/api/chat/threads/${threadId}/messages`,
                { text },
            );
            return data.message;
        },
        // Appends the row the server just confirmed rather than invalidating. This is not
        // an optimistic update — the message exists — so the objection to optimism (a
        // refused send must not look delivered) does not apply, and it saves a full page
        // re-read per message sent.
        // Lands on the newest page, which is `pages[0]`: that is the one holding the end
        // of the thread, and appending anywhere else would file the message into history.
        onSuccess: (message) => {
            queryClient.setQueryData<{ pages: ChatPage[]; pageParams: unknown[] }>(
                chatMessagesQueryKey(baseURL, threadId),
                (previous) => {
                    if (!previous) return previous;
                    const [newest, ...rest] = previous.pages;
                    if (!newest || newest.messages.some((entry) => entry.id === message.id)) {
                        return previous;
                    }
                    return {
                        ...previous,
                        pages: [{ ...newest, messages: [...newest.messages, message] }, ...rest],
                    };
                },
            );
        },
    });

    /**
     * Moves this caller's watermark. Fire-and-forget: a receipt that fails to record is
     * a tick that stays single until the next read, which is the right way for this to
     * degrade — nothing about the conversation depends on it.
     */
    const markRead = useCallback(
        (messageId: number) => {
            if (!threadId || messageId <= 0) return;
            void apiClient
                .post(`/api/chat/threads/${threadId}/read`, { messageId })
                .catch(() => undefined);
        },
        [apiClient, threadId],
    );

    const send = useCallback(
        async (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || !threadId) return;
            await mutation.mutateAsync(trimmed);
        },
        [mutation, threadId],
    );

    /**
     * Taps a reaction. Re-reads rather than updating the cache: the server decides whether
     * the tap added, replaced or removed, and guessing here would flicker the wrong chip
     * whenever the two disagreed.
     */
    const react = useCallback(
        (messageId: number, emoji: string) => {
            if (!threadId) return;
            void apiClient
                .post(`/api/chat/threads/${threadId}/messages/${messageId}/reaction`, { emoji })
                .then(refresh)
                .catch(() => undefined);
        },
        [apiClient, threadId, refresh],
    );

    const loadOlder = useCallback(() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    }, [query]);

    return {
        messages,
        // From the newest page: the watermark is one number for the thread, and older
        // pages carry a copy of the same answer.
        readUpTo: query.data?.pages[0]?.readUpTo ?? 0,
        markRead,
        react,
        isLoading: query.isLoading,
        error: query.error as Error | null,
        isLive: connected,
        online,
        send,
        isSending: mutation.isPending,
        sendError: mutation.error as Error | null,
        hasOlder: query.hasNextPage,
        isLoadingOlder: query.isFetchingNextPage,
        loadOlder,
    };
};
