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
  ExtraLifeAward,
  FighterMode,
  HitWindow,
  PackManifest,
  ProvenanceEntry,
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

/* -------------------------------------------------------------------------- */
/* Extra lives                                                                  */
/* -------------------------------------------------------------------------- */

/** No thresholds at all — the last setting of most cabinets' tables. */
export const NO_EXTRA_LIFE_AWARD: ExtraLifeAward = Object.freeze({ mode: 'none' });

/**
 * The award in force for a cabinet started on `startingLives` fighters.
 *
 * **The thresholds depend on the starting-life count, not on the setting
 * alone.** A cabinet set to its second option awards one set of scores when it
 * starts you with three fighters and a different set when it starts you with
 * five, so resolving the setting against the options that apply to the count in
 * play is the whole point of this function: reading `extraLives.award`
 * regardless hands a five-fighter cabinet the wrong bonuses, silently, for a
 * whole game. Rules with no `setting` say the award is the award.
 */
export function resolveExtraLifeAward(rules: Rules, startingLives?: number): ExtraLifeAward {
  const { award, setting, options } = rules.extraLives;
  if (setting === undefined) return award;
  const lives = startingLives ?? rules.lives.default;
  const applicable = options.filter((option) => option.startingLives.includes(lives));
  if (applicable.length === 0) return award;
  // An out-of-range setting awards nothing rather than guessing at one.
  return applicable[setting]?.award ?? NO_EXTRA_LIFE_AWARD;
}

/**
 * How many extra lives a score of `score` has earned in total under `award`.
 *
 * Counting totals rather than watching for crossings is deliberate: a single
 * step can cross two thresholds at once, and a crossing test that fires once
 * per step would swallow the second award.
 */
export function extraLivesEarnedAt(
  award: ExtraLifeAward,
  score: number,
  stopAfterScore?: number,
): number {
  if (award.mode === 'none') return 0;
  // Awards stop once the score passes the ceiling, so cap before counting.
  const capped = Math.min(score, stopAfterScore ?? Number.POSITIVE_INFINITY);
  if (capped < award.first) return 0;
  if (award.second === undefined || capped < award.second) return 1;
  if (award.repeat === undefined) return 2;
  return 2 + Math.floor((capped - award.second) / award.repeat);
}

/** Awards earned by moving from `scoreBefore` to `scoreAfter`. */
export function extraLivesEarnedBetween(
  award: ExtraLifeAward,
  scoreBefore: number,
  scoreAfter: number,
  stopAfterScore?: number,
): number {
  return Math.max(
    0,
    extraLivesEarnedAt(award, scoreAfter, stopAfterScore) -
      extraLivesEarnedAt(award, scoreBefore, stopAfterScore),
  );
}

/**
 * Whether the player has earned an extra life by crossing `score`, given the
 * score before the award, under the award the rules resolve to.
 */
export function extraLivesEarned(
  rules: Rules,
  scoreBefore: number,
  scoreAfter: number,
  startingLives?: number,
): number {
  return extraLivesEarnedBetween(
    resolveExtraLifeAward(rules, startingLives),
    scoreBefore,
    scoreAfter,
    rules.extraLives.stopAfterScore,
  );
}

/* -------------------------------------------------------------------------- */
/* The player, and what it fires                                                */
/* -------------------------------------------------------------------------- */

/** The right-hand travel limit for a fighter in this mode. */
export function maxXFor(rules: Rules, mode: FighterMode): number {
  const { maxX, dualMaxX } = rules.player;
  return mode === 'dual' ? (dualMaxX ?? maxX) : maxX;
}

/** The hit windows a shot fired by a fighter in this mode carries. */
export function shotWindowsFor(rules: Rules, mode: FighterMode): readonly HitWindow[] {
  return rules.player.shot.windows[mode];
}

/**
 * The mean of the movement cadence — the one number a "player speed" figure
 * states. Derived rather than stored, so it cannot drift from the pattern the
 * simulation actually steps.
 */
export function averageStepDistance(rules: Rules): number {
  const pattern = rules.player.stepPattern;
  return pattern.reduce((total, step) => total + step, 0) / pattern.length;
}

/* -------------------------------------------------------------------------- */
/* The starfield                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The backdrop speed byte for a stage, from the rules' formula.
 *
 * The result is a hardware register shadow rather than a pixel rate; turning it
 * into something visible belongs to the renderer, which is why the simulation
 * can emit it without knowing anything is drawn.
 */
export function starfieldSpeedByte(rules: Rules, stage: number): number {
  const speed = rules.starfield?.speed;
  if (speed === undefined) return 0;
  const clamped = Math.min(Math.max(Math.trunc(stage), 0), speed.plateauStage);
  return speed.base + ((clamped * speed.stageMultiplier) & speed.mask);
}

/** Lowest and highest bytes {@link starfieldSpeedByte} can produce. */
export function starfieldSpeedRange(rules: Rules): { readonly min: number; readonly max: number } {
  const speed = rules.starfield?.speed;
  if (speed === undefined) return { min: 0, max: 0 };
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  // The mask makes the formula non-monotonic in general, so the range is taken
  // by walking the stages that can reach it rather than by reading the ends.
  for (let stage = 0; stage <= speed.plateauStage; stage += 1) {
    const byte = starfieldSpeedByte(rules, stage);
    if (byte < min) min = byte;
    if (byte > max) max = byte;
  }
  return { min, max };
}

/* -------------------------------------------------------------------------- */
/* Provenance                                                                   */
/* -------------------------------------------------------------------------- */

/** A dotted field path, with `[n]` for array indices. */
const FIELD_PATH = /^[^.[\]]+(?:\.[^.[\]]+|\[\d+\])*$/;
const FIELD_PATH_TOKEN = /([^.[\]]+)|\[(\d+)\]/g;

/** `player.shot.windows.dual[1]` → `['player','shot','windows','dual',1]`. */
export function parseFieldPath(path: string): readonly (string | number)[] | undefined {
  if (!FIELD_PATH.test(path)) return undefined;
  const keys: (string | number)[] = [];
  for (const [, name, index] of path.matchAll(FIELD_PATH_TOKEN)) {
    keys.push(name ?? Number(index));
  }
  return keys;
}

/** Whether `path` names something that exists inside `root`. */
export function fieldPathExists(root: unknown, path: string): boolean {
  const keys = parseFieldPath(path);
  if (keys === undefined) return false;
  let current: unknown = root;
  for (const key of keys) {
    if (current === null || current === undefined) return false;
    if (typeof key === 'number') {
      if (!Array.isArray(current) || key >= current.length) return false;
      current = current[key];
      continue;
    }
    if (typeof current !== 'object') return false;
    if (!Object.hasOwn(current, key)) return false;
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

/** How far one value may be trusted, or `undefined` when it is unmarked. */
export function provenanceOf(rules: Rules, path: string): ProvenanceEntry | undefined {
  return rules.provenance[path];
}

/**
 * Provenance keys that name nothing in the rules.
 *
 * The loader rejects these, which is what stops a marking outliving the value
 * it describes — the failure mode that would quietly turn a verified number
 * into an unmarked one during a rename.
 */
export function unknownProvenancePaths(rules: Rules): readonly string[] {
  return Object.keys(rules.provenance).filter((path) => !fieldPathExists(rules, path));
}
