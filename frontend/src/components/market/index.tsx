import React from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { getRarityColor, getRarityName, useChainCapabilities } from '@shared/core';

import DashboardPanel from '@components/common/dashboard-panel';
import ComingSoon from '@components/game/coming-soon';
import ItemArt from '@components/item/item-art';
import { DASHBOARD_HOME } from '@constants/interactionRoutes';
import styles from './index.module.css';

type Listing = {
    name: string;
    rarity: number;
    /** What it is: a pet's level and skill, or an item's kind. */
    sub: string;
    price: number;
    seller: string;
} & ({ pet: string } | { itemType: string });

/** Sample stalls. The items are real catalog entries, so their art is the real art. */
const LISTINGS: readonly Listing[] = [
    { pet: '🐉', name: 'Emberwing', rarity: 4, sub: 'Lv 9 · Fury', price: 0.04, seller: 'Juno' },
    { itemType: '3', name: 'Sunder Maul', rarity: 5, sub: 'Equipment · weapon', price: 0.06, seller: 'Kestrel' },
    { pet: '🦊', name: 'Quickpaw', rarity: 2, sub: 'Lv 4 · Swift', price: 0.008, seller: 'Mira' },
    { itemType: '101', name: 'Greater Tonic', rarity: 3, sub: 'Consumable · ×3', price: 0.012, seller: 'Oren' },
    { pet: '🐢', name: 'Mossback', rarity: 3, sub: 'Lv 6 · Shell', price: 0.018, seller: 'Pip' },
    { itemType: '21', name: 'Focus Sigil', rarity: 4, sub: 'Equipment · charm', price: 0.025, seller: 'Juno' },
];

const STEPS = [
    ['List', 'Put a pet or an item up at your price.'],
    ['Buy', 'Another trainer takes it.'],
    ['Settle', 'The trade settles on chain, and it changes hands.'],
] as const;

/**
 * The Night Market, a planned mode (roadmap §7): pets and items listed by trainers, bought
 * by others, every trade settled on chain.
 *
 * A preview only. The listings, sellers and prices are sample content inside a Coming soon
 * frame; nothing here reads a listing or moves an asset. Prices show in the active chain's
 * coin, so the sample does not read as a different network's market.
 */
const Market: React.FC = () => {
    const navigate = useNavigate();
    const { activeKind } = useChainCapabilities();
    const coin = activeKind === 'solana' ? 'SOL' : 'ETH';

    return (
        <DashboardPanel
            title="Night Market"
            description="Trade pets and gear with other trainers."
            back={() => navigate(DASHBOARD_HOME)}
        >
            <ComingSoon note="List your pets and items at your own price, and buy from other trainers. Every trade settles on chain.">
                <div className={styles.layout}>
                    <div className={styles.main}>
                        <div className={styles.toolbar}>
                            <span className={styles.tabs}>
                                <button type="button" className={clsx(styles.tab, styles.tabOn)}>
                                    All
                                </button>
                                <button type="button" className={styles.tab}>
                                    Pets
                                </button>
                                <button type="button" className={styles.tab}>
                                    Items
                                </button>
                            </span>
                            <span className={styles.sort}>Newest first ▾</span>
                        </div>

                        <ul className={styles.grid}>
                            {LISTINGS.map((listing) => (
                                <li
                                    key={listing.name}
                                    className={styles.listing}
                                    style={{ '--rc': getRarityColor(listing.rarity) } as React.CSSProperties}
                                >
                                    <span className={styles.art}>
                                        {'pet' in listing ? (
                                            <span className={styles.petArt}>{listing.pet}</span>
                                        ) : (
                                            <ItemArt item={{ itemType: listing.itemType, name: listing.name }} />
                                        )}
                                        <span className={styles.rarity}>{getRarityName(listing.rarity)}</span>
                                    </span>
                                    <b className={styles.name}>{listing.name}</b>
                                    <small className={styles.sub}>{listing.sub}</small>
                                    <span className={styles.seller}>Sold by {listing.seller}</span>
                                    <span className={styles.buyRow}>
                                        <span className={styles.price}>
                                            {listing.price} {coin}
                                        </span>
                                        <button type="button" className={styles.buy}>
                                            Buy
                                        </button>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <aside className={styles.side}>
                        <div className={styles.card}>
                            <h3 className={styles.heading}>Your stall</h3>
                            <p className={styles.muted}>Nothing listed yet.</p>
                            <button type="button" className={styles.list}>
                                List a pet or item
                            </button>
                        </div>
                        <div className={styles.card}>
                            <h3 className={styles.heading}>How trading works</h3>
                            <ol className={styles.steps}>
                                {STEPS.map(([title, text], i) => (
                                    <li key={title}>
                                        <span className={styles.step}>{i + 1}</span>
                                        <span>
                                            <b>{title}</b> {text}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </aside>
                </div>
            </ComingSoon>
        </DashboardPanel>
    );
};

export default Market;
