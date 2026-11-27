import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const useChainCapabilities = vi.fn();
const useChatThreads = vi.fn();
const useChatMessages = vi.fn();

const useAuth = vi.fn();

vi.mock('@shared/core', async () => {
    // sameAccount/shortAddress stay real: the EVM-folds/base58-doesn't rule is what several
    // of these assertions are about. Imported from their own module rather than the barrel,
    // which would pull in wagmi and the rest of what this factory exists to replace.
    const address = await import('../../../shared/src/utils/common/address');
    return {
        ...address,
        useAuth: () => useAuth(),
        useChainCapabilities: () => useChainCapabilities(),
        useChatThreads: () => useChatThreads(),
        useChatMessages: (opts: unknown) => useChatMessages(opts),
        // A short stand-in for the real list; the picker only maps over whatever it is given.
        CHAT_REACTIONS: ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🐾'],
        getPetAvatar: () => '🐉',
        // No art service in these tests: PetArt renders the emoji alone.
        petArtUrl: () => null,
    };
});

// `config.ts` registers the storage adapter with @shared/core at module scope, which the
// mock above does not provide. Only the socket URL is needed here, so stub the module
// rather than reconstructing the app's bootstrap.
vi.mock('../../src/config', () => ({
    API_URL: 'http://test',
    BATTLE_ROOM_WS_URL: 'ws://test/ws/battle-room',
    CHAT_WS_URL: 'ws://test/ws/chat',
}));

import Chat from '@components/chat';
import { CHAT_REACTIONS } from '@shared/core';

const ME = '0xAAAAbbbbCCCCddddEEEEffff0000111122223333';
const THEM = '0x2222222222222222222222222222222222222222';

const thread = (over: Record<string, unknown> = {}) => ({
    threadId: 't1',
    counterpart: THEM,
    pets: [
        {
            petId: '1',
            petName: 'Mine',
            petDna: '1',
            spousePetId: '2',
            spouseName: 'Theirs',
            spouseDna: '2',
        },
    ],
    chain: 'evm',
    ...over,
});

const message = (over: Record<string, unknown> = {}) => ({
    id: 1,
    sender: THEM,
    text: 'hello there',
    createdAt: new Date(0).toISOString(),
    ...over,
});

const send = vi.fn();

const markRead = vi.fn();
const react = vi.fn();
const loadOlder = vi.fn();
const messagesResult = (over: Record<string, unknown> = {}) => ({
    readUpTo: 0,
    markRead,
    react,
    hasOlder: false,
    isLoadingOlder: false,
    loadOlder,
    messages: [],
    isLoading: false,
    error: null,
    isLive: true,
    online: [],
    send,
    isSending: false,
    sendError: null,
    ...over,
});

const renderChat = () =>
    render(
        <MemoryRouter initialEntries={['/messages']}>
            <Chat />
        </MemoryRouter>,
    );

beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ isAuthenticated: true, signAndLogin: vi.fn() });
    send.mockResolvedValue(undefined);
    useChainCapabilities.mockReturnValue({ isConnected: true, walletAddress: ME });
    useChatThreads.mockReturnValue({ threads: [], isLoading: false, error: null });
    useChatMessages.mockReturnValue(messagesResult());
});

describe('Chat', () => {
    it('asks for a wallet before showing conversations', () => {
        useChainCapabilities.mockReturnValue({ isConnected: false, walletAddress: null });

        renderChat();

        expect(screen.getByRole('heading', { name: 'Connect your wallet' })).toBeInTheDocument();
    });

    // The normal state for most players, and it must not read as a failed load.
    // A connected wallet is not a session: the API is JWT-gated, so rendering the panel
    // here produced 401s surfaced as a raw error, or an empty state claiming there were
    // no conversations when the truth was that nobody had signed in.
    it('offers sign-in when the wallet is connected but the session is not', () => {
        useAuth.mockReturnValue({ isAuthenticated: false, signAndLogin: vi.fn() });

        renderChat();

        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
        expect(screen.queryByText(/Marry one of your pets/i)).toBeNull();
    });

    it('starts the sign-in flow when the button is pressed', async () => {
        const signAndLogin = vi.fn();
        useAuth.mockReturnValue({ isAuthenticated: false, signAndLogin });

        renderChat();
        await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

        expect(signAndLogin).toHaveBeenCalled();
    });

    it('explains how to get a thread when there are none', () => {
        renderChat();

        expect(screen.getByText(/Marry one of your pets/i)).toBeInTheDocument();
    });

    it('shows the counterpart and the marriage behind each thread', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });

        renderChat();

        expect(screen.getAllByText(/0x2222…2222/).length).toBeGreaterThan(0);
        expect(screen.getAllByText('Mine ♥ Theirs').length).toBeGreaterThan(0);
    });

    it('shows one pet face per run of messages, not one per message', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(
            messagesResult({
                messages: [
                    message(),
                    message({ id: 2, text: 'still me' }),
                    message({ id: 3, sender: ME.toLowerCase(), text: 'hi back' }),
                ],
            }),
        );

        renderChat();

        const theirs = screen.getByText('hello there').closest('li') as HTMLElement;
        const theirsLast = screen.getByText('still me').closest('li') as HTMLElement;
        const mine = screen.getByText('hi back').closest('li') as HTMLElement;

        // Case differs between the wallet and the stored sender, so the sides must not
        // be decided by an exact string match.
        expect(mine.className).not.toEqual(theirs.className);

        // The face lands on the last message of a run; the earlier ones hold the column
        // with a spacer so the bubbles stay aligned.
        expect(theirs.querySelector('.messageFace')).toBeNull();
        expect(theirs.querySelector('.messageFaceGap')).not.toBeNull();
        expect(theirsLast.querySelector('.messageFace')).not.toBeNull();
        expect(mine.querySelector('.messageFace')).not.toBeNull();
        // Each side shows its own pet.
        expect(theirsLast.querySelector('.messageFace')).toHaveAttribute('title', 'Theirs');
        expect(mine.querySelector('.messageFace')).toHaveAttribute('title', 'Mine');
    });

    it('ticks once for sent and twice once the counterpart has read it', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(
            messagesResult({
                messages: [
                    message({ id: 4, sender: ME.toLowerCase(), text: 'seen one' }),
                    message({ id: 5, sender: ME.toLowerCase(), text: 'unseen one' }),
                    message({ id: 6, text: 'theirs' }),
                ],
                readUpTo: 4,
            }),
        );

        renderChat();

        const seen = screen.getByText('seen one').closest('li') as HTMLElement;
        const unseen = screen.getByText('unseen one').closest('li') as HTMLElement;
        const theirs = screen.getByText('theirs').closest('li') as HTMLElement;

        expect(within(seen).getByRole('img', { name: 'Seen' })).toHaveTextContent('✓✓');
        expect(within(unseen).getByRole('img', { name: 'Sent' })).toHaveTextContent('✓');
        // In the bubble's bottom-right corner, beside the time rather than loose in the
        // row: the two are one piece of metadata about the message.
        expect(seen.querySelector('.bubble .messageMeta .receipt')).not.toBeNull();
        expect(seen.querySelector(':scope > .receipt')).toBeNull();
        // The time keeps its place there for both sides.
        expect(theirs.querySelector('.bubble .messageMeta .messageTime')).not.toBeNull();
        // Their own messages carry no receipt: only your reading is news to anyone.
        expect(theirs.querySelector('.receipt')).toBeNull();
    });

    it('marks the newest incoming message read, and never its own', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(
            messagesResult({ messages: [message({ id: 7, text: 'from them' })] }),
        );

        const { unmount } = renderChat();
        expect(markRead).toHaveBeenCalledWith(7);

        unmount();
        markRead.mockClear();
        useChatMessages.mockReturnValue(
            messagesResult({
                messages: [message({ id: 8, sender: ME.toLowerCase(), text: 'from me' })],
            }),
        );
        renderChat();
        expect(markRead).not.toHaveBeenCalled();
    });

    it('shows each reaction with its count, and marks your own', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(
            messagesResult({
                messages: [
                    message({
                        id: 3,
                        text: 'reacted to',
                        reactions: [
                            { emoji: '👍', count: 2, mine: true },
                            { emoji: '😂', count: 1, mine: false },
                        ],
                    }),
                ],
            }),
        );

        renderChat();

        // Pressed, because tapping it again is what removes it.
        expect(screen.getByRole('button', { name: '👍 2' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '😂 1' })).toHaveAttribute(
            'aria-pressed',
            'false',
        );
        // A count of one is what a lone emoji already says.
        expect(screen.getByRole('button', { name: '👍 2' })).toHaveTextContent('2');
        expect(screen.getByRole('button', { name: '😂 1' })).not.toHaveTextContent('1');
    });

    it('taps an existing reaction to toggle it off', async () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(
            messagesResult({
                messages: [
                    message({ id: 3, reactions: [{ emoji: '👍', count: 1, mine: true }] }),
                ],
            }),
        );

        renderChat();
        await userEvent.click(screen.getByRole('button', { name: '👍 1' }));

        // Same call as adding: the server decides which the tap meant.
        expect(react).toHaveBeenCalledWith(3, '👍');
    });

    it('picks a new reaction from the fixed set', async () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(messagesResult({ messages: [message({ id: 3 })] }));

        renderChat();
        // Nothing is offered until the picker is opened.
        expect(screen.queryByRole('button', { name: '😮' })).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'Add a reaction' }));
        await userEvent.click(screen.getByRole('button', { name: '😮' }));

        expect(react).toHaveBeenCalledWith(3, '😮');
        // The picker closes behind the choice.
        expect(screen.queryByRole('button', { name: '😮' })).toBeNull();
    });

    it('offers the quick six first and the whole set once expanded', async () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(messagesResult({ messages: [message({ id: 3 })] }));

        renderChat();
        await userEvent.click(screen.getByRole('button', { name: 'Add a reaction' }));

        const picker = () => screen.getByRole('group', { name: 'Reactions' });
        // Six emoji plus the control that reveals the rest.
        expect(within(picker()).getAllByRole('button')).toHaveLength(7);
        expect(screen.queryByRole('button', { name: '🐾' })).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'More reactions' }));

        // Every emoji the API accepts, and the chevron is gone with nothing left to open.
        expect(within(picker()).getAllByRole('button')).toHaveLength(CHAT_REACTIONS.length);
        expect(screen.getByRole('button', { name: '🐾' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'More reactions' })).toBeNull();
    });

    it('closes the picker on a click outside it, and reopens collapsed', async () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(messagesResult({ messages: [message({ id: 3 })] }));

        renderChat();
        await userEvent.click(screen.getByRole('button', { name: 'Add a reaction' }));
        await userEvent.click(screen.getByRole('button', { name: 'More reactions' }));
        expect(screen.getByRole('button', { name: '🐾' })).toBeInTheDocument();

        await userEvent.click(document.body);
        expect(screen.queryByRole('group', { name: 'Reactions' })).toBeNull();

        // Expansion does not persist: reopening starts at the quick row again.
        await userEvent.click(screen.getByRole('button', { name: 'Add a reaction' }));
        expect(screen.queryByRole('button', { name: '🐾' })).toBeNull();
        expect(screen.getByRole('button', { name: 'More reactions' })).toBeInTheDocument();
    });

    it('closes the picker on Escape', async () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(messagesResult({ messages: [message({ id: 3 })] }));

        renderChat();
        await userEvent.click(screen.getByRole('button', { name: 'Add a reaction' }));
        await userEvent.keyboard('{Escape}');

        expect(screen.queryByRole('group', { name: 'Reactions' })).toBeNull();
    });

    it('closes the picker when the control is pressed again', async () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(messagesResult({ messages: [message({ id: 3 })] }));

        renderChat();
        const add = screen.getByRole('button', { name: 'Add a reaction' });
        await userEvent.click(add);
        expect(screen.getByRole('group', { name: 'Reactions' })).toBeInTheDocument();

        await userEvent.click(add);
        expect(screen.queryByRole('group', { name: 'Reactions' })).toBeNull();
    });

    // Telegram-style: a heading only where the day turns over, so a long thread reads as
    // days rather than as one undated run.
    it('marks each new day once, relative for the recent ones', () => {
        const at = (daysAgo: number, hour: number) => {
            const d = new Date();
            d.setDate(d.getDate() - daysAgo);
            d.setHours(hour, 0, 0, 0);
            return d.toISOString();
        };
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(
            messagesResult({
                messages: [
                    message({ id: 1, text: 'old one', createdAt: at(1, 9) }),
                    message({ id: 2, text: 'old two', createdAt: at(1, 18) }),
                    message({ id: 3, text: 'new one', createdAt: at(0, 9) }),
                ],
            }),
        );

        renderChat();

        const marks = screen.getAllByRole('separator');
        expect(marks.map((mark) => mark.textContent)).toEqual(['Yesterday', 'Today']);
    });

    it('fetches older history when the reader nears the top', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(
            messagesResult({ messages: [message()], hasOlder: true }),
        );

        const { container } = renderChat();
        const list = container.querySelector('.messages') as HTMLElement;

        // Far from the top: nothing to do yet.
        Object.defineProperty(list, 'scrollTop', { value: 900, writable: true });
        fireEvent.scroll(list);
        expect(loadOlder).not.toHaveBeenCalled();

        Object.defineProperty(list, 'scrollTop', { value: 10, writable: true });
        fireEvent.scroll(list);
        expect(loadOlder).toHaveBeenCalled();
    });

    it('does not fetch again while a page is already in flight', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(
            messagesResult({ messages: [message()], hasOlder: true, isLoadingOlder: true }),
        );

        const { container } = renderChat();
        const list = container.querySelector('.messages') as HTMLElement;
        Object.defineProperty(list, 'scrollTop', { value: 0, writable: true });
        fireEvent.scroll(list);

        expect(loadOlder).not.toHaveBeenCalled();
        expect(screen.getByText('Loading earlier messages…')).toBeInTheDocument();
    });

    it('sends the trimmed draft and clears the box', async () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });

        renderChat();
        const box = screen.getByLabelText('Message');
        await userEvent.type(box, '  hello  ');
        await userEvent.click(screen.getByRole('button', { name: 'Send' }));

        expect(send).toHaveBeenCalledWith('hello');
        expect(box).toHaveValue('');
    });

    it('sends on Enter and breaks the line on Shift+Enter', async () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });

        renderChat();
        const box = screen.getByLabelText('Message');
        await userEvent.type(box, 'first{Shift>}{Enter}{/Shift}second');
        expect(box).toHaveValue('first\nsecond');
        expect(send).not.toHaveBeenCalled();

        await userEvent.type(box, '{Enter}');
        expect(send).toHaveBeenCalledWith('first\nsecond');
    });

    // The Enter that closes an IME candidate window picks a character; sending there
    // would fire the message off mid-word for anyone typing Japanese, Korean or Chinese.
    it('does not send on the Enter that commits an IME composition', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });

        renderChat();
        const box = screen.getByLabelText('Message');
        fireEvent.change(box, { target: { value: 'こんにちは' } });
        fireEvent.keyDown(box, { key: 'Enter', isComposing: true });

        expect(send).not.toHaveBeenCalled();
    });

    // A refused send must leave the text where the player can see it, not swallow it.
    it('keeps the draft when sending fails', async () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        send.mockRejectedValue(new Error('marriage ended'));

        renderChat();
        const box = screen.getByLabelText('Message');
        await userEvent.type(box, 'still here');
        await userEvent.click(screen.getByRole('button', { name: 'Send' }));

        expect(box).toHaveValue('still here');
    });

    it('will not send an empty draft', async () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });

        renderChat();
        await userEvent.type(screen.getByLabelText('Message'), '   ');

        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
        expect(send).not.toHaveBeenCalled();
    });

    it('shows the counterpart as online when they are connected', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        // Deliberately a different case from the stored address: presence is matched on
        // accounts, not strings.
        useChatMessages.mockReturnValue(
            messagesResult({ online: [THEM.toUpperCase().replace('0X', '0x')] }),
        );

        renderChat();

        expect(screen.getByLabelText('Online')).toBeInTheDocument();
    });

    it('shows the counterpart as offline when only you are connected', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(messagesResult({ online: [ME] }));

        renderChat();

        expect(screen.getByLabelText('Offline')).toBeInTheDocument();
    });

    // A dropped channel cannot report presence. Showing grey would be indistinguishable
    // from "they left", so the dot must not claim anything while the socket is down.
    it('does not claim the counterpart is online while the channel is down', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(messagesResult({ isLive: false, online: [ME, THEM] }));

        renderChat();

        expect(screen.getByLabelText('Offline')).toBeInTheDocument();
    });

    it('says when the live channel is down without blocking sending', () => {
        useChatThreads.mockReturnValue({ threads: [thread()], isLoading: false, error: null });
        useChatMessages.mockReturnValue(messagesResult({ isLive: false }));

        renderChat();

        expect(screen.getByText('reconnecting')).toBeInTheDocument();
        expect(screen.getByLabelText('Message')).toBeEnabled();
    });

    it('switches conversations when another thread is picked', async () => {
        useChatThreads.mockReturnValue({
            threads: [thread(), thread({ threadId: 't2', counterpart: '0x3333333333333333333333333333333333333333' })],
            isLoading: false,
            error: null,
        });

        renderChat();
        const list = screen.getByRole('list');
        await userEvent.click(within(list).getByText(/0x3333…3333/));

        expect(useChatMessages).toHaveBeenLastCalledWith(
            expect.objectContaining({ threadId: 't2' }),
        );
    });

    it('surfaces a thread-list failure', () => {
        useChatThreads.mockReturnValue({
            threads: [],
            isLoading: false,
            error: new Error('backend unreachable'),
        });

        renderChat();

        expect(screen.getByText('backend unreachable')).toBeInTheDocument();
    });
});
