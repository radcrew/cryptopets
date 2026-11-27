import React, { useState } from 'react';
import { itemArtUrl as buildItemArtUrl, itemFallbackArtUrl, type ItemDefinition } from '@shared/core';

import styles from './item-art.module.css';

/**
 * An item's art, degrading in two steps rather than one.
 *
 * Unlike a pet — which falls straight back to its emoji avatar — an item has a real
 * intermediate: the service draws a deterministic SVG from the catalog entry alone, needing
 * no model, no store and no credentials. So the painted PNG is tried first, and anything that
 * stops it arriving (an item nobody has warmed yet, a generation that outran its deadline, a
 * deployment with no Cloudflare keys) falls through to art that is merely plainer instead of
 * to a hole in the layout.
 *
 * Only when the service itself is unreachable does this render nothing, which is the
 * "art is optional" state the whole image service is built around: unset
 * `VITE_IMAGE_SERVICE_URL` and the app keeps working, minus pictures.
 *
 * No retry timer, deliberately. `PetArt` needs one because its only fallback is an emoji and
 * a cold pet's art lands seconds later; here the second attempt is a different URL that is
 * always ready, so there is nothing to wait for.
 */

/** The route shape lives in `@shared/core` so mobile can address items identically; only the
 *  environment read is web-specific. Read inside the function rather than at module scope so
 *  a test can stub the variable without re-importing the module. */
const artUrl = (itemType: string): string | null =>
    buildItemArtUrl(itemType, import.meta.env.VITE_IMAGE_SERVICE_URL);

const fallbackUrl = (itemType: string): string | null =>
    itemFallbackArtUrl(itemType, import.meta.env.VITE_IMAGE_SERVICE_URL);

/**
 * Whether this component will render a tile for `itemType`.
 *
 * Module-private on purpose. It was briefly exported so the bag could decide whether a tile
 * existed before hanging a corner control on it; the tile now renders its corners as siblings
 * of the art unconditionally, so nothing outside needs to ask. An exported predicate with no
 * caller is worse than dead code — the next reader builds against a seam nobody validated.
 */
export const hasItemArt = (itemType: string): boolean => artUrl(itemType) !== null;

type ItemArtProps = {
    item: Pick<ItemDefinition, 'itemType' | 'name'>;
    /** Rendered at tile size in the bag; larger where an item is the subject. */
    size?: 'tile' | 'feature';
};

const ItemArt: React.FC<ItemArtProps> = ({ item, size = 'tile' }) => {
    const [stage, setStage] = useState<'painted' | 'drawn' | 'none'>('painted');
    const [loaded, setLoaded] = useState(false);

    // No service configured: there is no tile to draw and nothing is coming, so the card is
    // left exactly as it was before art existed. This is the one case that renders nothing,
    // and it is the case `hasItemArt` reports.
    if (!hasItemArt(item.itemType)) return null;

    const src = stage === 'painted' ? artUrl(item.itemType) : stage === 'drawn' ? fallbackUrl(item.itemType) : null;

    return (
        <div className={size === 'feature' ? styles.frameFeature : styles.frame}>
            {/* Holds the box before the image lands, so a bag of items does not reflow as
                each one arrives — and stays as the tile's face if both sources fail, which
                keeps the frame (and anything overlaid on it) rather than collapsing. */}
            {loaded ? null : <span className={styles.placeholder} aria-hidden />}
            {src ? (
                <img
                    // Remounts on the fallback: reusing the element with a new src is fine,
                    // but the load/error state has to reset with it.
                    key={stage}
                    src={src}
                    alt={item.name}
                    // A bag mounts every card at once and a cold item's first request
                    // triggers a generation, so only items on screen ask for art.
                    loading="lazy"
                    decoding="async"
                    className={styles.img}
                    style={{ opacity: loaded ? 1 : 0 }}
                    onLoad={() => setLoaded(true)}
                    onError={() => {
                        setLoaded(false);
                        setStage((current) => (current === 'painted' ? 'drawn' : 'none'));
                    }}
                />
            ) : null}
        </div>
    );
};

export default ItemArt;
