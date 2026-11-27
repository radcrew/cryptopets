import React from 'react';

import PetArt from '@components/pet/pet-art';

import type { ArtPet } from './art';
import styles from './index.module.css';

const COL_NAMES = ['back', 'middle', 'front'] as const;
const ROW_NAMES = ['top', 'middle', 'bottom'] as const;

/** A tile's place in its own zone, as words: 'front column, top row'. */
export const positionLabel = (col: number, row: number) => `${COL_NAMES[col]} column, ${ROW_NAMES[row]} row`;

export interface ZoneMember {
    petId: string;
    col: number;
    row: number;
    art: ArtPet;
    label: string;
    sub?: string;
}

export interface ZoneGridProps {
    members: ZoneMember[];
    /** 0 draws the zone facing right (front on the right), 1 mirrored, as the two sides face. */
    side: 0 | 1;
    selectedPetId?: string | null;
    /** Tapping a pet, which selects it to show its details. Omit for a zone nobody selects in. */
    onPetClick?: (petId: string) => void;
    /** Tapping an empty tile. Pass it only while a move is possible: it moves the selected pet. */
    onEmptyClick?: (col: number, row: number) => void;
    /** A pet dragged onto a tile. Dropped onto another pet, the two swap. */
    onDropPet?: (petId: string, col: number, row: number) => void;
    label: string;
    /** Draws every tile as unknown, for a defender's zone the attacker may not see. */
    concealed?: boolean;
}

/**
 * One side's 3×3 zone. Tapping a pet selects it, and tapping an empty tile then moves it there;
 * dragging works on top, and is the way to swap two pets. Tapping a pet never moves anything,
 * so selecting a pet to read its details cannot rearrange the zone by accident. Every
 * interactive tile is a button with a spoken position, so all of it works from a keyboard.
 */
export const ZoneGrid: React.FC<ZoneGridProps> = ({ members, side, selectedPetId, onPetClick, onEmptyClick, onDropPet, label, concealed = false }) => {
    const columns = side === 0 ? [0, 1, 2] : [2, 1, 0];
    if (concealed) {
        return (
            <div className={styles.zone} role="img" aria-label={label}>
                {Array.from({ length: 9 }, (_, i) => (
                    <div key={i} className={[styles.tile, styles.concealed].join(' ')} aria-hidden>
                        <span className={styles.unknownMark}>?</span>
                    </div>
                ))}
            </div>
        );
    }
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
                    const position = positionLabel(col, row);
                    const content = member ? (
                        <>
                            <span className={styles.tokenArt} aria-hidden>
                                <PetArt pet={member.art} />
                            </span>
                            <span className={styles.tokenName}>{member.label}</span>
                            {member.sub && <span className={styles.tokenSub}>{member.sub}</span>}
                        </>
                    ) : null;
                    const onClick = member
                        ? onPetClick && (() => onPetClick(member.petId))
                        : onEmptyClick && (() => onEmptyClick(col, row));
                    const drag = onDropPet
                        ? {
                              draggable: Boolean(member),
                              onDragStart: (e: React.DragEvent<HTMLElement>) => member && e.dataTransfer.setData('text/plain', member.petId),
                              onDragOver: (e: React.DragEvent<HTMLElement>) => e.preventDefault(),
                              onDrop: (e: React.DragEvent<HTMLElement>) => {
                                  e.preventDefault();
                                  const petId = e.dataTransfer.getData('text/plain');
                                  if (petId) onDropPet(petId, col, row);
                              },
                          }
                        : {};
                    if (!onClick) {
                        return (
                            <div key={`${col}-${row}`} className={className} aria-label={member ? `${member.label}, ${position}` : `Empty, ${position}`} {...drag}>
                                {content}
                            </div>
                        );
                    }
                    return (
                        <button
                            key={`${col}-${row}`}
                            type="button"
                            className={className}
                            aria-label={member ? `${member.label}, ${position}` : `Move here: ${position}`}
                            aria-pressed={member ? member.petId === selectedPetId : undefined}
                            onClick={onClick}
                            {...drag}
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
    art: ArtPet;
    name: string;
    hp: number;
    startHp: number;
    /** Shown in place of the HP readout, for a fighter whose HP is not known yet. */
    note?: string;
}

export interface BattleBoardProps {
    fighters: BoardFighter[];
    actor?: { side: 0 | 1; slot: number } | null;
    victim?: { side: 0 | 1; slot: number } | null;
    /** A side whose half is drawn as unknown, for defenders not yet revealed. */
    concealedSide?: 0 | 1;
    /** Drawn inside the victim's tile, such as the strike's damage pop. */
    victimPop?: React.ReactNode;
}

/**
 * The 6×3 battle map, read-only: the attackers' zone on the left (front at the centre line),
 * the defenders' on the right. Columns are board columns, 0 to 5.
 */
export const BattleBoard: React.FC<BattleBoardProps> = ({ fighters, actor, victim, concealedSide, victimPop }) => (
    <div className={styles.board} role="img" aria-label="Battle map">
        {[0, 1, 2].map((row) =>
            [0, 1, 2, -1, 3, 4, 5].map((x) => {
                if (x === -1) return <div key={`d-${row}`} className={styles.divider} />;
                if (concealedSide !== undefined && (x < 3 ? 0 : 1) === concealedSide) {
                    return (
                        <div key={`${x}-${row}`} className={[styles.tile, styles.concealed].join(' ')} aria-hidden>
                            <span className={styles.unknownMark}>?</span>
                        </div>
                    );
                }
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
                    <div key={`${x}-${row}`} className={className} title={f.note ? f.name : `${f.name}: ${f.hp}/${f.startHp} HP`}>
                        <span className={styles.tokenArt}>
                            <PetArt pet={f.art} />
                        </span>
                        <span className={styles.tokenName}>{f.name}</span>
                        <span className={styles.tokenSub}>{f.note ?? (f.hp > 0 ? `${f.hp} HP` : 'Out')}</span>
                        <div className={styles.hpTrack}>
                            <div className={styles.hpFill} style={{ width: `${pct}%` }} />
                        </div>
                        {is(victim) && victimPop}
                    </div>
                );
            }),
        )}
    </div>
);
