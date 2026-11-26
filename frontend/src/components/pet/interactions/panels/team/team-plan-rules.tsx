import clsx from 'clsx';
import React from 'react';

import InfoTooltip from '@components/ui/info-tooltip';
import type { LiveDefensePlan } from '@shared/core';

import styles from './index.module.css';

/** The challenge rules a defence plan is signed with, beside its three pets. */
export interface PlanRules {
    minLevel: number;
    maxLevel: number;
    maxBattlesPerDay: number;
    days: number;
}

/** What a plan used before these could be set, so an untouched card saves the same plan. */
export const DEFAULT_PLAN_RULES: PlanRules = {
    minLevel: 1,
    maxLevel: 100,
    maxBattlesPerDay: 20,
    days: 30,
};

const MAX_LEVEL = 100;
const MAX_BATTLES_PER_DAY = 100;
export const VALIDITY_DAYS = [7, 30, 90] as const;

/** Why these rules cannot be signed, or null when they can. */
export function planRulesError(rules: PlanRules): string | null {
    const whole = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
    if (!whole(rules.minLevel, 1, MAX_LEVEL) || !whole(rules.maxLevel, 1, MAX_LEVEL)) {
        return `Challenger levels run from 1 to ${MAX_LEVEL}.`;
    }
    if (rules.minLevel > rules.maxLevel) return 'The lowest challenger level is above the highest.';
    if (!whole(rules.maxBattlesPerDay, 1, MAX_BATTLES_PER_DAY)) {
        return `Battles per day must be between 1 and ${MAX_BATTLES_PER_DAY}.`;
    }
    return null;
}

/** The saved plan's rules, for editing it rather than starting over. */
export function rulesFromPlan(plan: LiveDefensePlan): PlanRules {
    const days = Math.round((plan.expiresAt - plan.notBefore) / 86400);
    return {
        minLevel: plan.minLevel,
        maxLevel: plan.maxLevel,
        maxBattlesPerDay: plan.maxBattlesPerDay,
        days: (VALIDITY_DAYS as readonly number[]).includes(days) ? days : DEFAULT_PLAN_RULES.days,
    };
}

export interface TeamPlanRulesProps {
    rules: PlanRules;
    onChange: (rules: PlanRules) => void;
    plan: LiveDefensePlan | null;
    disabled?: boolean;
}

/**
 * Who can challenge a defence team and how often, with the saved plan's status. These are fields
 * of the signed plan (`defensePlan` v1), so a change takes effect only when the team is saved again.
 */
const TeamPlanRules: React.FC<TeamPlanRulesProps> = ({
    rules,
    onChange,
    plan,
    disabled = false,
}) => {
    const set = (patch: Partial<PlanRules>) => onChange({ ...rules, ...patch });
    const read = (value: string) => (value === '' ? Number.NaN : Number(value));
    const shown = (value: number) => (Number.isNaN(value) ? '' : value);
    const error = planRulesError(rules);
    const status = !plan
        ? { tone: styles.statusNone, text: 'No team saved' }
        : plan.isStale
        ? { tone: styles.statusStale, text: 'Out of date' }
        : {
              tone: styles.statusOpen,
              text: `Open until ${new Date(plan.expiresAt * 1000).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
              })}`,
          };

    return (
        <section className={styles.sideCard} aria-label="Challenge rules">
            <div className={styles.cardHead}>
                <h4 className={styles.columnHeading}>
                    Challenge rules
                    <InfoTooltip subject="Challenge rules">
                        Who can challenge this team, and how often. These rules are signed with the
                        team, so a change applies only when you save it. A challenging squad counts
                        as its highest-level pet.
                    </InfoTooltip>
                </h4>
                <span className={clsx(styles.planStatus, status.tone)}>{status.text}</span>
            </div>

            <div className={styles.ruleFields}>
                <div className={styles.ruleField}>
                    <span className={styles.fieldLabel}>Challenger level</span>
                    <span className={styles.rangeInputs}>
                        <input
                            type="number"
                            aria-label="Lowest challenger level"
                            className={clsx(styles.select, styles.numberInput)}
                            min={1}
                            max={MAX_LEVEL}
                            value={shown(rules.minLevel)}
                            disabled={disabled}
                            onChange={(e) => set({ minLevel: read(e.target.value) })}
                        />
                        <span>to</span>
                        <input
                            type="number"
                            aria-label="Highest challenger level"
                            className={clsx(styles.select, styles.numberInput)}
                            min={1}
                            max={MAX_LEVEL}
                            value={shown(rules.maxLevel)}
                            disabled={disabled}
                            onChange={(e) => set({ maxLevel: read(e.target.value) })}
                        />
                    </span>
                </div>
                <div className={styles.ruleField}>
                    <span className={styles.fieldLabel}>Battles per day</span>
                    <input
                        type="number"
                        aria-label="Battles per day"
                        className={clsx(styles.select, styles.numberInput)}
                        min={1}
                        max={MAX_BATTLES_PER_DAY}
                        value={shown(rules.maxBattlesPerDay)}
                        disabled={disabled}
                        onChange={(e) => set({ maxBattlesPerDay: read(e.target.value) })}
                    />
                </div>
                <div className={styles.ruleField}>
                    <span className={styles.fieldLabel}>Valid for</span>
                    <select
                        aria-label="Valid for"
                        className={clsx(styles.select, styles.daysSelect)}
                        value={rules.days}
                        disabled={disabled}
                        onChange={(e) => set({ days: Number(e.target.value) })}
                    >
                        {VALIDITY_DAYS.map((d) => (
                            <option key={d} value={d}>
                                {d} days
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <p className={styles.fieldHint}>
                Saving opens the team to challenges for the next {rules.days} days.
            </p>

            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}
        </section>
    );
};

export default TeamPlanRules;
