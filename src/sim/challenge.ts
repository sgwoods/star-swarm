/**
 * Challenge stages (`docs/DESIGN.md` section 4, "Challenge stages").
 *
 * Forty enemies in five groups of eight fly scripted patterns and never shoot.
 * Nothing settles into formation, so nothing sways or breathes — the formation
 * code already knows that from `rules.formation.animatedStageKinds` — and an
 * enemy whose script runs out simply leaves, which is `departed` in
 * `./enemies.js`.
 *
 * What this file is for is the **scoring**, which is the part most easily got
 * wrong, and which `docs/reference/arcade-reference.md` section 8 now settles in
 * full. Three awards, three different rules:
 *
 * 1. **On impact.** Every hit scores immediately, at a value that belongs to the
 *    challenge stage rather than to the enemy — 100 on the first challenge
 *    stage, 160 on the second through eighth, and 100 again on the ninth. The
 *    original reaches that by overwriting every enemy's score group at each
 *    challenge stage's start from an eight-entry table whose index has **no
 *    clamp**, so the value cycles. No floating score is shown for these hits;
 *    the counter simply moves. It replaces whatever the alien is worth
 *    elsewhere, which is why {@link ChallengeStage.impactAward} is read here and
 *    `enemyScore` is not.
 * 2. **Per group of eight cleared**, at a value that steps with the
 *    challenge-stage ordinal and **is** clamped — so the ninth challenge stage
 *    pays 100 a hit *and* the maximum 3,000 a group. Two tables over one stage
 *    counter, with different periods and different clamps: that is the trap, and
 *    it is why both come from {@link challengeImpactAward} and
 *    {@link challengeGroupBonus} rather than from one index computed here.
 * 3. **Once at the end of the stage**: `perHit × hits`, or a flat perfect bonus
 *    that **replaces** it. Adding the two instead is a 4,000-point error on
 *    every perfect stage.
 *
 * The three together are what make a perfect first challenge stage pay 19,000:
 * 40 × 100 on impact, 5 × 1,000 in group bonuses, and 10,000 for the perfect.
 *
 * No constants: every number arrives in the `Rules` value, and the cadence that
 * decides a stage is a challenge stage at all is `isChallengeStage` — the rules
 * layer's, never a stage number written down here.
 */

import {
  challengeEndBonus,
  challengeGroupBonus,
  challengeImpactAward,
  isChallengeStage,
  challengeOrdinal,
} from '../content/rules.js';
import type { Rules } from '../content/schema.js';
import type { StageContent } from '../content/stages.js';

/** The running state of one challenge stage. A plain value, so it serialises. */
export interface ChallengeStage {
  readonly stage: number;
  /** Zero-based challenge-stage index — what both award tables are keyed by. */
  readonly ordinal: number;
  /** Points per hit on this stage, already the doubled value. */
  readonly impactAward: number;
  /** Points for clearing a whole group of eight on this stage. */
  readonly groupBonus: number;
  /** Enemies the stage puts on the field. 40 in the arcade. */
  readonly total: number;
  /** How many enemies each group of eight holds, by entry wave. */
  readonly groupSize: readonly number[];
  /** How many of each group have been destroyed. */
  readonly groupHits: number[];
  /** Enemies destroyed: the "NUMBER OF HITS" the results screen shows. */
  hits: number;
  /** Points awarded at the moment of impact so far. */
  impactScore: number;
  /** Group bonuses awarded so far. */
  groupBonusPaid: number;
  /** Set once the end-of-stage award has been paid, so it is paid exactly once. */
  ended: boolean;
}

/**
 * The challenge state for stage `n`, or `undefined` when it is not one.
 *
 * **The cadence decides, and it is data**: one at `challengeStages.firstStage`
 * and then every `everyStages`, which for Classic is stage 3 and every fourth
 * after it. Nothing here tests a stage number.
 */
export function createChallengeStage(
  rules: Rules,
  stage: number,
  content: StageContent | undefined,
): ChallengeStage | undefined {
  if (!isChallengeStage(rules, stage)) return undefined;
  const groupSize = (content?.stage.waves ?? []).map((wave) => wave.slots.length);
  return {
    stage,
    ordinal: challengeOrdinal(rules, stage),
    impactAward: challengeImpactAward(rules, stage) ?? 0,
    groupBonus: challengeGroupBonus(rules, stage),
    total: groupSize.reduce((sum, size) => sum + size, 0),
    groupSize,
    groupHits: groupSize.map(() => 0),
    hits: 0,
    impactScore: 0,
    groupBonusPaid: 0,
    ended: false,
  };
}

/** What one destroyed challenge-stage enemy paid. */
export interface ChallengeHit {
  /** The impact award. */
  readonly impact: number;
  /**
   * The group bonus, if that hit was the eighth of its group; `0` otherwise.
   * A group with an enemy that flew away can never be cleared, so it never pays.
   */
  readonly groupBonus: number;
  /** Which group of eight it belonged to, for the event. */
  readonly group: number;
}

/**
 * Account for one destroyed enemy and return what it is worth.
 *
 * Mutates the state and reports the money rather than adding it: the world owns
 * the score and the events, and a function that did both would put presentation
 * ordering inside the accounting.
 */
export function recordChallengeHit(state: ChallengeStage, wave: number): ChallengeHit {
  state.hits += 1;
  state.impactScore += state.impactAward;

  const size = state.groupSize[wave] ?? 0;
  const hits = (state.groupHits[wave] ?? 0) + 1;
  state.groupHits[wave] = hits;
  // The group of eight pays on the hit that empties it, during the stage, which
  // is the only challenge-stage award the original shows a score tile for.
  const cleared = size > 0 && hits === size;
  if (cleared) state.groupBonusPaid += state.groupBonus;

  return { impact: state.impactAward, groupBonus: cleared ? state.groupBonus : 0, group: wave };
}

/** The end-of-stage award, and whether the stage was perfect. */
export interface ChallengeEnd {
  readonly hits: number;
  readonly total: number;
  readonly perfect: boolean;
  readonly endBonus: number;
  readonly impactScore: number;
  readonly groupBonus: number;
}

/**
 * Close the stage and work out the end-of-stage award.
 *
 * Idempotent: a second call reports a `0` award, because the branch is paid once
 * and a challenge stage that ends twice would pay 10,000 twice.
 */
export function endChallengeStage(state: ChallengeStage, rules: Rules): ChallengeEnd {
  const paid = state.ended;
  state.ended = true;
  const perfect = state.total > 0 && state.hits >= state.total;
  return {
    hits: state.hits,
    total: state.total,
    perfect,
    endBonus: paid ? 0 : challengeEndBonus(rules, state.hits, state.total),
    impactScore: state.impactScore,
    groupBonus: state.groupBonusPaid,
  };
}
