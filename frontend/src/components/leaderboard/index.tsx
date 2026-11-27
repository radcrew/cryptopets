import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import {
    getRarityColor,
    sameAccount,
    shortAddress,
    useChainCapabilities,
    useLeaderboard,
    usePlayerLeaderboard,
} from '@shared/core';

import DashboardPanel from '@components/common/dashboard-panel';
import SessionGate from '@components/common/session-gate';
import PetArt from '@components/pet/pet-art';
import Icon, { TrophyIcon } from '@components/ui/icon';
import TabSwitch from '@components/ui/tab-switch';
import { DASHBOARD_HOME } from '@constants/interactionRoutes';
import { Tones } from '@constants/tones';
import SeasonLeagues from './season-leagues';
import styles from './index.module.css';

/** Which ranking is showing. Pets is the default: it is the one with a pet in it. */
type Board = 'pets' | 'players';

const BOARD_TABS = [
    { id: 'pets', label: 'Pets' },
    { id: 'players', label: 'Players' },
] as const satisfies readonly { id: Board; label: string }[];

/** Win rate as a percentage, or null when the row has no battles to divide by. */
function winRate(wins: number, losses: number): number | null {
    const fought = wins + losses;
    return fought === 0 ? null : Math.round((wins / fought) * 100);
}

/** Metal for each of the top three, and nothing below. Drives `--medal` on the card. */
const MEDALS = ['gold', 'silver', 'bronze'] as const;

/** How many places get a card rather than a row. */
const PODIUM_PLACES = MEDALS.length;

/** What one row shows, whichever board produced it. */
type Standing = {
    key: string;
    rank: number;
    avatar: ReactNode;
    title: string;
    sub: string;
    /** Tints the podium card behind the pet; null on the player board. */
    accent: string | null;
    winCount: number;
    lossCount: number;
    isYou: boolean;
};

/**
 * A place on the podium: the top three, at the size their result earns.
 *
 * The pet art is the hero here rather than a 20px avatar in a table cell. It is the most
 * distinctive thing the product owns and the leaderboard is where being looked at is the
 * whole point — everywhere else it is an identifier, here it is a trophy.
 *
 * The wash behind it is the pet's own rarity colour, so a card says something about the
 * pet and not only about its position.
 */
const PodiumCard: React.FC<{ standing: Standing; place: number }> = ({ standing, place }) => {
    const rate = winRate(standing.winCount, standing.lossCount);
    return (
        <article
            className={clsx(
                styles.podiumCard,
                styles[MEDALS[place] as 'gold' | 'silver' | 'bronze'],
                place === 0 && styles.isLeader,
                standing.isYou && styles.isYou,
            )}
            style={standing.accent ? ({ '--accent': standing.accent } as React.CSSProperties) : undefined}
        >
            <span className={styles.podiumRank}>{standing.rank}</span>
            <span className={styles.podiumArt} aria-hidden>
                {standing.avatar}
            </span>
            <h3 className={styles.podiumName}>{standing.title}</h3>
            <p className={styles.podiumSub}>{standing.sub}</p>
            <p className={styles.podiumRecord}>
                <span className={styles.wins}>{standing.winCount}W</span>
                <span className={styles.dash} aria-hidden>
                    ·
                </span>
                <span className={styles.losses}>{standing.lossCount}L</span>
            </p>
            <p className={styles.podiumRate}>{rate == null ? 'no record' : `${rate}% win rate`}</p>
        </article>
    );
};

/**
 * One line of the ledger, below the podium.
 *
 * The rank leads at display size because the rank is what the reader came for; the row
 * text is deliberately quieter than it. The win rate is drawn as a bar under the row
 * rather than printed as a fifth column — a column of percentages has to be read one at a
 * time, where a column of bars shows the shape of the board at a glance.
 */
const Row: React.FC<{ standing: Standing }> = ({ standing }) => {
    const rate = winRate(standing.winCount, standing.lossCount);
    return (
        <li className={clsx(styles.row, standing.isYou && styles.isYou)}>
            <span className={styles.rank}>{standing.rank}</span>
            <span className={styles.avatar} aria-hidden>
                {standing.avatar}
            </span>
            <span className={styles.name}>
                {standing.title}
                <span className={styles.sub}>{standing.sub}</span>
            </span>
            <span className={styles.record}>
                <span className={styles.wins}>{standing.winCount}W</span>
                <span className={styles.losses}>{standing.lossCount}L</span>
            </span>
            <span className={styles.rate}>{rate == null ? '—' : `${rate}%`}</span>
            {/* Presentational: the same number is written beside it for anyone who cannot
                see the bar. */}
            <span className={styles.meter} aria-hidden>
                <span className={styles.meterFill} style={{ width: `${rate ?? 0}%` }} />
            </span>
        </li>
    );
};

/**
 * Page numbers to render, with `null` standing for a gap.
 *
 * The ends and the current page's neighbours, so the strip stays a fixed width however
 * long the board grows: page 1 and the last page are always reachable in one press, which
 * is what people actually jump to.
 */
function pageSlots(page: number, lastPage: number): (number | null)[] {
    if (lastPage <= 6) return Array.from({ length: lastPage + 1 }, (_, index) => index);

    const wanted = [0, lastPage, page - 1, page, page + 1];
    const shown = [...new Set(wanted)].filter((n) => n >= 0 && n <= lastPage).sort((a, b) => a - b);

    return shown.flatMap((n, index) => {
        const previous = shown[index - 1];
        if (previous === undefined || n - previous === 1) return [n];
        // A gap of exactly one is written out rather than elided: an ellipsis costs the
        // same space as the single number it would hide.
        return n - previous === 2 ? [n - 1, n] : [null, n];
    });
}

/**
 * The range summary and page controls.
 *
 * The summary shows even on a single page. Hiding the whole thing when everything fits —
 * which is what this did — leaves a reader unable to tell a short board from a truncated
 * one, and makes the feature look absent right up until the day it matters.
 */
const Pager: React.FC<{
    page: number;
    lastPage: number;
    pageSize: number;
    total: number;
    onGo: (page: number) => void;
}> = ({ page, lastPage, pageSize, total, onGo }) => {
    const first = page * pageSize + 1;
    const last = Math.min(total, (page + 1) * pageSize);

    return (
        <div className={styles.pager}>
            <span className={styles.pageLabel}>
                {first}–{last} of {total}
            </span>

            {lastPage > 0 && (
                <nav className={styles.pageNav} aria-label="Leaderboard pages">
                    <button type="button" onClick={() => onGo(page - 1)} disabled={page === 0}>
                        ←
                    </button>
                    {pageSlots(page, lastPage).map((slot, index) =>
                        slot === null ? (
                            <span key={`gap-${index}`} className={styles.pageGap} aria-hidden>
                                …
                            </span>
                        ) : (
                            <button
                                key={slot}
                                type="button"
                                className={slot === page ? styles.isCurrent : undefined}
                                aria-current={slot === page ? 'page' : undefined}
                                aria-label={`Page ${slot + 1}`}
                                onClick={() => onGo(slot)}
                            >
                                {slot + 1}
                            </button>
                        ),
                    )}
                    <button
                        type="button"
                        onClick={() => onGo(page + 1)}
                        disabled={page >= lastPage}
                    >
                        →
                    </button>
                </nav>
            )}
        </div>
    );
};

/**
 * Leaderboard view: pets ranked by battle record, and their owners ranked by the same
 * record summed.
 *
 * A read-only page rather than an interaction panel — nothing here selects a pet or
 * signs anything, so it composes `DashboardPanel` directly instead of going through
 * `InteractionStandalone`.
 *
 * Ranking is entirely the backend's. It ranks over the merged record
 * (`pet_battle_progress` above the frozen `pet_roster` counters) inside the query that
 * orders the rows, so this renders the page it is given and never re-sorts: a
 * client-side sort could only reorder rows the server already picked, which would
 * quietly disagree with `rank`.
 */
const Leaderboard: React.FC = () => {
    const navigate = useNavigate();
    const { activeKind, walletAddress } = useChainCapabilities();
    const [board, setBoard] = useState<Board>('pets');
    const [page, setPage] = useState(0);
    const [term, setTerm] = useState('');

    // 300 ms, matching `useSearchPets`: a round trip per keystroke against a ranked query
    // is a lot of work to throw away, and the board is not a typeahead.
    const [search, setSearch] = useState('');
    useEffect(() => {
        const id = setTimeout(() => setSearch(term.trim()), 300);
        return () => clearTimeout(id);
    }, [term]);

    // A term that narrows the board also renumbers which page anything is on, so the
    // reader has to be put back at the first one or a search can land on an empty page.
    useEffect(() => setPage(0), [search]);

    const pets = useLeaderboard({ chain: activeKind, page, search, enabled: board === 'pets' });
    const players = usePlayerLeaderboard({
        chain: activeKind,
        page,
        search,
        enabled: board === 'players',
    });

    const active = board === 'pets' ? pets : players;
    const goBack = () => navigate(DASHBOARD_HOME);
    const heading = (
        <>
            <Icon as={TrophyIcon} tone={Tones.Amber} />
            Leaderboard
        </>
    );

    // `sameAccount` normalizes by address shape, so this needs no chain branch and cannot
    // merge two Solana pubkeys that differ only in case.
    const isYou = (owner: string) => sameAccount(owner, walletAddress ?? '');

    const showBoard = (next: Board) => {
        setBoard(next);
        // Only the page resets. Page 3 of the pet board says nothing about where a player
        // sits, and the two boards are different lengths. The search term carries over on
        // purpose now that both boards match a name *or* an address: looking a pet up and
        // then switching boards is how you find out who owns it.
        setPage(0);
    };

    const lastPage = Math.max(0, Math.ceil(active.total / active.pageSize) - 1);

    /** Both boards flattened to the same shape, so the podium and ledger take either. */
    const standings: Standing[] = useMemo(
        () =>
            board === 'pets'
                ? pets.entries.map((entry) => ({
                      key: entry.id,
                      rank: entry.rank,
                      avatar: (
                          <PetArt
                              pet={{
                                  id: entry.id,
                                  chain: entry.chain,
                                  assetKey: entry.asset || undefined,
                                  dna: BigInt(entry.dna),
                                  name: entry.name,
                              }}
                          />
                      ),
                      title: entry.name,
                      sub: `Lv ${entry.level}`,
                      accent: getRarityColor(entry.rarity),
                      winCount: entry.winCount,
                      lossCount: entry.lossCount,
                      isYou: isYou(entry.owner),
                  }))
                : players.entries.map((entry) => ({
                      key: entry.owner,
                      rank: entry.rank,
                      avatar: '👤',
                      title: shortAddress(entry.owner),
                      sub: `${entry.petCount} pet${entry.petCount === 1 ? '' : 's'}`,
                      accent: null,
                      winCount: entry.winCount,
                      lossCount: entry.lossCount,
                      isYou: isYou(entry.owner),
                  })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [board, pets.entries, players.entries, walletAddress],
    );

    // Decided by the rank itself, not by which page is showing: a medal belongs to third
    // place, so page 2 grows no podium and a search that turns up the leader still shows
    // it as the leader. Ranks are absolute for exactly this reason.
    const podium = standings.filter((standing) => standing.rank <= PODIUM_PLACES);
    const ledger = standings.filter((standing) => standing.rank > PODIUM_PLACES);

    return (
        <SessionGate
            title={heading}
            connectPrompt="Connect your wallet to see the rankings"
            signInPrompt="Sign in to see the rankings"
            tone="amber"
            back={goBack}
        >
            <DashboardPanel
                className={styles.page}
                title={heading}
                description="Ranked by wins, then by fewest losses"
                back={goBack}
            >
                <TabSwitch options={BOARD_TABS} value={board} onChange={showBoard} label="Leaderboard type" tone="amber" />

                <div className={styles.search}>
                    <input
                        type="search"
                        value={term}
                        onChange={(event) => setTerm(event.target.value)}
                        placeholder="Search by pet name or wallet address"
                        aria-label="Search by pet name or wallet address"
                    />
                </div>

                {active.error ? (
                    <p className={styles.error}>{active.error.message}</p>
                ) : active.isLoading ? (
                    <div className="loading-container">
                        <div className="loading-spinner" />
                    </div>
                ) : active.total === 0 ? (
                    <p className={styles.empty}>
                        {search
                            ? `Nothing on the board matches "${search}".`
                            : 'No battles on record yet. Win one and the board fills up.'}
                    </p>
                ) : (
                    <div className={styles.board}>
                        {podium.length > 0 && (
                            <section className={styles.podium} aria-label="Top three">
                                {podium.map((standing) => (
                                    <PodiumCard
                                        key={standing.key}
                                        standing={standing}
                                        place={standing.rank - 1}
                                    />
                                ))}
                            </section>
                        )}

                        <ol className={styles.list}>
                            {ledger.map((standing) => (
                                <Row key={standing.key} standing={standing} />
                            ))}
                        </ol>

                        <Pager
                            page={page}
                            lastPage={lastPage}
                            pageSize={active.pageSize}
                            total={active.total}
                            onGo={setPage}
                        />
                    </div>
                )}

                <SeasonLeagues />
            </DashboardPanel>
        </SessionGate>
    );
};

export default Leaderboard;
