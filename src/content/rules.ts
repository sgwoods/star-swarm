/**
 * Reading the rules layer — `docs/DESIGN.md` section 6.
 *
 * These are the interpreters for the shapes `schema.ts` defines, and they are
 * the *only* place that decides what a stage number means. Three things they
 * exist to keep honest:
 *
 * - **Rank selects data sets, not a multiplier.** Every lookup here takes a rank
 *   id and reads that rank's own tables.
 * - **Each table plateaus on its own terms.** Nothing assumes one global end of
 *   ramp, because the arcade original's ramp and its stage sequence fold at
 *   different stages.
 * - **Challenge stages come from a cadence rule**, so normal and challenge
 *   stages advance along separate sequences.
 *
 * Nothing here simulates anything; that is Milestone 2's work.
 */

import type { PlateauTable } from './schema.js';
import { resolveRow } from './schema.js';
import type {
  DifficultyRank,
  DifficultyRow,
  PackManifest,
  Rules,
  StageSequence,
} from './schema.js';

/** Is stage `n` (1-based) a challenge stage under these rules? */
export function isChallengeStage(rules: Rules, stage: number): boolean {
  const { enabled, firstStage, everyStages } = rules.challengeStages;
  if (!enabled || stage < firstStage) return false;
  return (stage - firstStage) % everyStages === 0;
}

/**
 * How many challenge stages came before stage `n`, which is also the zero-based
 * index of stage `n` itself when it is one. Drives the challenge group bonus,
 * which steps with the challenge-stage ordinal rather than the stage number.
 */
export function challengeOrdinal(rules: Rules, stage: number): number {
  const { firstStage, everyStages } = rules.challengeStages;
  if (!rules.challengeStages.enabled || stage < firstStage) return 0;
  return Math.floor((stage - firstStage) / everyStages);
}

/** The zero-based index of stage `n` among the normal (non-challenge) stages. */
export function normalStageOrdinal(rules: Rules, stage: number): number {
  const { enabled, firstStage, everyStages } = rules.challengeStages;
  if (!enabled) return stage - 1;
  const before =
    stage - 1 >= firstStage ? Math.floor((stage - 1 - firstStage) / everyStages) + 1 : 0;
  return stage - 1 - before;
}

/** The rank's data set, or `undefined` if the rules do not declare that rank. */
export function resolveRank(rules: Rules, rank?: string): DifficultyRank | undefined {
  return rules.difficulty.ranks[rank ?? rules.difficulty.defaultRank];
}

/**
 * The difficulty row in force on stage `n`.
 *
 * The table is indexed by stage number − 1 and includes challenge-stage rows,
 * so the plateau lands on the same phase the arcade original does: with 26 rows
 * cycling their last four, stage 27 replays row 23 and stage 28 row 24.
 */
export function resolveDifficultyRow(
  rules: Rules,
  stage: number,
  rank?: string,
): DifficultyRow | undefined {
  const resolved = resolveRank(rules, rank);
  if (resolved === undefined) return undefined;
  return resolveRow(resolved.stageTable, stage - 1);
}

/** The launch rate for one role on one stage, or 0 when the row says nothing about it. */
export function resolveLaunchRate(
  rules: Rules,
  stage: number,
  role: string,
  rank?: string,
): number {
  return resolveDifficultyRow(rules, stage, rank)?.launchRates[role] ?? 0;
}

/**
 * The sequence in force for a rank: the pack's, with whichever half the rank
 * overrides swapped in.
 */
export function resolveStageSequence(
  manifest: PackManifest,
  rules: Rules,
  rank?: string,
): StageSequence {
  const override = resolveRank(rules, rank)?.stageSequence;
  return {
    normal: override?.normal ?? manifest.stageSequence.normal,
    challenge: override?.challenge ?? manifest.stageSequence.challenge,
  };
}

/** Which stage document plays as stage `n`, or `undefined` if the sequence is empty. */
export function resolveStageId(
  manifest: PackManifest,
  rules: Rules,
  stage: number,
  rank?: string,
): string | undefined {
  const sequence = resolveStageSequence(manifest, rules, rank);
  return isChallengeStage(rules, stage)
    ? resolveRow(sequence.challenge, challengeOrdinal(rules, stage))
    : resolveRow(sequence.normal, normalStageOrdinal(rules, stage));
}

/**
 * The transform group index for stage `n` — which entry of `transform.types`
 * is in play, and therefore which all-of-them bonus applies.
 */
export function transformGroupIndex(rules: Rules, stage: number): number | undefined {
  const transform = rules.transform;
  if (transform === undefined || !transform.enabled || stage < transform.fromStage)
    return undefined;
  return Math.floor((stage - transform.fromStage) / transform.stagesPerType);
}

/** The alien id a transform produces on stage `n`, cycling through `transform.types`. */
export function resolveTransformType(rules: Rules, stage: number): string | undefined {
  const index = transformGroupIndex(rules, stage);
  const types = rules.transform?.types;
  if (index === undefined || types === undefined || types.length === 0) return undefined;
  return types[index % types.length];
}

/** Convenience wrapper so callers do not have to import `resolveRow` as well. */
export function lookup<T>(table: PlateauTable<T> | undefined | null, index: number): T | undefined {
  if (table === undefined || table === null) return undefined;
  return resolveRow(table, index);
}

/**
 * Whether the player has earned an extra life by crossing `score`, given the
 * score before the award. Returns how many awards are due, which is normally 0
 * or 1 but can be more if a single hit jumps two thresholds.
 */
export function extraLivesEarned(rules: Rules, scoreBefore: number, scoreAfter: number): number {
  const { award, stopAfterScore } = rules.extraLives;
  if (award.mode === 'none') return 0;
  const ceiling = stopAfterScore ?? Number.POSITIVE_INFINITY;
  const reached = (score: number): number => {
    const capped = Math.min(score, ceiling);
    if (capped < award.first) return 0;
    if (award.second === undefined || capped < award.second) return 1;
    if (award.repeat === undefined) return 2;
    return 2 + Math.floor((capped - award.second) / award.repeat);
  };
  return Math.max(0, reached(scoreAfter) - reached(scoreBefore));
}
