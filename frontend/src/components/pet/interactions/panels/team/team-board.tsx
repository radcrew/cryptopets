import React from 'react';

import styles from './index.module.css';

const COL_NAMES = ['back', 'middle', 'front'] as const;
const ROW_NAMES = ['top', 'middle', 'bottom'] as const;

export interface ZoneMember {
    petId: string;
    col: number;
    row: number;
    label: string;
    sub?: string;
}

export interface ZoneGridProps {
    members: ZoneMember[];
    /** 0 draws the zone facing right (front on the right), 1 mirrored, as the two sides face. */
    side: 0 | 1;
    selectedPetId?: string | null;
    /** Omit for a read-only zone. */
    onTileClick?: (col: number, row: number) => void;
    /** A pet dragged onto a tile. */
    onDropPet?: (petId: string, col: number, row: number) => void;
    label: string;
}

/**
 * One side's 3×3 zone. Interactive when given handlers: click a tile to move the selected pet
 * there, or drop a dragged pet on it. Every tile is a button with a spoken position, so
 * placement works from a keyboard as well as by drag.
 */
export const ZoneGrid: React.FC<ZoneGridProps> = ({ members, side, selectedPetId, onTileClick, onDropPet, label }) => {
    const columns = side === 0 ? [0, 1, 2] : [2, 1, 0];
    return (
        <div className={styles.zone} role="group" aria-label={label}>
            {[0, 1, 2].map((row) =>
                columns.map((col) => {
                    const member = members.find((m) => m.col === col && m.row === row);
                    const className = [
                        styles.tile,
                        member && styles.occupied,
                        member && side === 1 && styles.rival,
                        member && member.petId === selectedPetId && styles.selected,
                    ]
                        .filter(Boolean)
                        .join(' ');
                    const position = `${COL_NAMES[col]} column, ${ROW_NAMES[row]} row`;
                    const content = member ? (
                        <>
                            <span className={styles.tokenName}>{member.label}</span>
                            {member.sub && <span>{member.sub}</span>}
                        </>
                    ) : null;
                    if (!onTileClick) {
                        return (
                            <div key={`${col}-${row}`} className={className} aria-label={member ? `${member.label}, ${position}` : `Empty, ${position}`}>
                                {content}
                            </div>
                        );
                    }
                    return (
                        <button
                            key={`${col}-${row}`}
                            type="button"
                            className={className}
                            aria-label={member ? `${member.label}, ${position}` : `Place here: ${position}`}
                            draggable={Boolean(member)}
                            onDragStart={(e) => member && e.dataTransfer.setData('text/plain', member.petId)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                const petId = e.dataTransfer.getData('text/plain');
                                if (petId) onDropPet?.(petId, col, row);
                            }}
                            onClick={() => onTileClick(col, row)}
                        >
                            {content}
                        </button>
                    );
                }),
            )}
        </div>
    );
};

export interface BoardFighter {
    side: 0 | 1;
    slot: number;
    x: number;
    row: number;
    name: string;
    hp: number;
    startHp: number;
}

export interface BattleBoardProps {
    fighters: BoardFighter[];
    actor?: { side: 0 | 1; slot: number } | null;
    victim?: { side: 0 | 1; slot: number } | null;
}

/**
 * The 6×3 battle map, read-only: the attackers' zone on the left (front at the centre line),
 * the defenders' on the right. Columns are board columns, 0 to 5.
 */
export const BattleBoard: React.FC<BattleBoardProps> = ({ fighters, actor, victim }) => (
    <div className={styles.board} role="img" aria-label="Battle map">
        {[0, 1, 2].map((row) =>
            [0, 1, 2, -1, 3, 4, 5].map((x) => {
                if (x === -1) return <div key={`d-${row}`} className={styles.divider} />;
                const f = fighters.find((p) => p.x === x && p.row === row);
                if (!f) return <div key={`${x}-${row}`} className={styles.tile} />;
                const is = (who?: { side: 0 | 1; slot: number } | null) => who?.side === f.side && who.slot === f.slot;
                const className = [
                    styles.tile,
                    styles.occupied,
                    f.side === 1 && styles.rival,
                    f.hp <= 0 && styles.knockedOut,
                    is(actor) && styles.actor,
                    is(victim) && styles.victim,
                ]
                    .filter(Boolean)
                    .join(' ');
                const pct = f.startHp > 0 ? Math.max(0, Math.round((f.hp / f.startHp) * 100)) : 0;
                return (
                    <div key={`${x}-${row}`} className={className} title={`${f.name}: ${f.hp}/${f.startHp} HP`}>
                        <span className={styles.tokenName}>{f.name}</span>
                        <span>{f.hp > 0 ? `${f.hp} HP` : 'Out'}</span>
                        <div className={styles.hpTrack}>
                            <div className={styles.hpFill} style={{ width: `${pct}%` }} />
                        </div>
                    </div>
                );
            }),
        )}
    </div>
);
