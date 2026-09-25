/**
 * Lives and extra lives (docs/DESIGN.md section 4, "Player").
 *
 * The interesting part is that **the extra-life thresholds depend on how many
 * fighters the cabinet starts you with.** There are two tables of eight DIP
 * settings, not one: setting 1 — the factory default — means 20,000 / 70,000 /
 * every 70,000 on a 2-, 3- or 4-ship cabinet and 30,000 / 120,000 / every
 * 120,000 on a 5-ship one. Keying the award off the setting alone hands a 5-ship
 * cabinet the wrong bonuses, silently, for the whole game.
 *
 * Both tables collapse to the same triple — first threshold, second threshold,
 * repeat interval, any of which may be absent — which is the shape this module
 * consumes. `src/content/`'s rules layer landed on the same shape independently
 * (`rules.extraLives.award`, with `extraLivesEarned` counting totals rather than
 * watching for crossings, exactly as {@link bonusesEarnedAt} does), so the
 * follow-up that rewires the sim to it is a substitution, not a rewrite.
 */

import {
  BONUS_CEILING,
  BONUS_TABLE_SHIPS_2_TO_4,
  BONUS_TABLE_SHIPS_5,
  type BonusThresholds,
  type LivesRules,
} from './rules.js';

/** No thresholds at all — DIP setting 7 in both tables. */
export const NO_BONUS: BonusThresholds = Object.freeze({
  first: null,
  second: null,
  repeat: null,
});

/**
 * The threshold triple for a cabinet, from its starting-ship count and its DIP
 * setting. Out-of-range settings fall back to "none" rather than guessing.
 */
export function bonusThresholdsFor(startingShips: number, setting: number): BonusThresholds {
  const table = startingShips >= 5 ? BONUS_TABLE_SHIPS_5 : BONUS_TABLE_SHIPS_2_TO_4;
  return table[setting] ?? NO_BONUS;
}

/** The triple these rules resolve to. */
export function bonusThresholdsOf(rules: LivesRules): BonusThresholds {
  return bonusThresholdsFor(rules.startingShips, rules.bonusSetting);
}

/**
 * How many extra lives a score of `score` has earned in total.
 *
 * Counting totals rather than watching for crossings is deliberate: a single
 * step can cross two thresholds at once (a 1,600-point boss on 19,000 points
 * with a 20,000 first threshold is not far-fetched), and a crossing test that
 * fires once per step would swallow the second award.
 */
export function bonusesEarnedAt(
  score: number,
  thresholds: BonusThresholds,
  ceiling: number = BONUS_CEILING,
): number {
  const { first, second, repeat } = thresholds;
  if (first === null) return 0;

  // Awards stop once the score passes the ceiling, so cap before counting.
  const effective = Math.min(score, ceiling);
  if (effective < first) return 0;
  if (second === null || effective < second) return 1;

  if (repeat === null || repeat <= 0) return 2;
  return 2 + Math.floor((effective - second) / repeat);
}

/** Extra lives awarded by moving from `previousScore` to `score`. */
export function bonusesAwarded(
  previousScore: number,
  score: number,
  thresholds: BonusThresholds,
  ceiling: number = BONUS_CEILING,
): number {
  return Math.max(
    0,
    bonusesEarnedAt(score, thresholds, ceiling) -
      bonusesEarnedAt(previousScore, thresholds, ceiling),
  );
}

/** Lives, as the simulation carries them. */
export interface LivesState {
  /** Fighters left in reserve — what the HUD draws along the bottom row. */
  reserve: number;
  /** Extra lives handed out so far, so the award is never paid twice. */
  bonusesAwarded: number;
}

export function createLives(rules: LivesRules): LivesState {
  // The starting count includes the fighter on the field, so the reserve is one
  // fewer: a 3-ship cabinet shows two reserve fighters at the first "READY".
  return { reserve: Math.max(0, rules.startingShips - 1), bonusesAwarded: 0 };
}
