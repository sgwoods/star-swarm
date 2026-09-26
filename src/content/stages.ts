/**
 * Resolving a stage number into the content that plays it.
 *
 * `src/sim/` is handed a resolved `Rules` value rather than a pack, for the
 * reasons `AGENTS.md` gives; the same has to be true of stages. So this module
 * turns "stage 4, rank A" into a {@link StageContent} — the stage document, the
 * formation it uses, and the aliens and paths its waves name — and the simulation
 * receives that value without ever knowing a pack, a registry or a file exists.
 *
 * It is the only place that walks from a stage *number* to a stage *document*,
 * which is `resolveStageId` in `./rules.js` plus the lookups. Nothing here reads
 * the filesystem, so the sim, the browser bundle and the validator all share it.
 */

import { resolveStageId } from './rules.js';
import type { Alien, Formation, MovementPath, PackManifest, Rules, Stage } from './schema.js';

/** Everything the simulation needs to run one stage, already resolved. */
export interface StageContent {
  /** The stage document that plays. */
  readonly stage: Stage;
  /** The formation its slots address, resolved from the manifest. */
  readonly formation: Formation;
  /** Every alien this stage can put on the field, keyed by id. */
  readonly aliens: ReadonlyMap<string, Alien>;
  /** Every path this stage's waves and aliens name, keyed by id. */
  readonly paths: ReadonlyMap<string, MovementPath>;
}

/**
 * What the simulation is handed in place of a pack: "give me stage *n*".
 *
 * An interface rather than a map because the stage sequence plateaus — stage 30
 * is a lookup, not an entry — and rather than a closure over the sim's own state
 * because a stage's content must not depend on anything the sim has done.
 */
export interface StageSource {
  /** The content playing as stage `stage` (1-based), or `undefined` if none. */
  stageFor(stage: number): StageContent | undefined;
}

/**
 * The content a stage source reads. Both `ContentRegistry` and `LoadedPack`
 * satisfy it, so a source can be built from one pack or from a layered set.
 */
export interface StageLookup {
  readonly manifest: PackManifest;
  readonly rules: Rules | undefined;
  readonly stages: ReadonlyMap<string, Stage>;
  readonly formations: ReadonlyMap<string, Formation>;
  readonly aliens: ReadonlyMap<string, Alien>;
  readonly paths: ReadonlyMap<string, MovementPath>;
}

export interface StageSourceOptions {
  /** Which difficulty rank's sequence to follow. Defaults to the rules' own. */
  readonly rank?: string;
}

/** A source that has no stages at all — a world with nothing in it. */
export const EMPTY_STAGE_SOURCE: StageSource = Object.freeze({
  stageFor: (): StageContent | undefined => undefined,
});

/**
 * Resolve one stage document into the content the simulation needs.
 *
 * Exported so a test can hand the sim a stage it wrote itself without inventing
 * a pack around it.
 */
export function resolveStageContent(
  lookup: Pick<StageLookup, 'formations' | 'aliens' | 'paths'>,
  stage: Stage,
): StageContent | undefined {
  const formation = lookup.formations.get(stage.formation);
  if (formation === undefined) return undefined;
  return { stage, formation, aliens: lookup.aliens, paths: lookup.paths };
}

/**
 * Build a stage source over a loaded pack or registry.
 *
 * **Temporary bridge:** a stage number that resolves to nothing — which is every
 * challenge stage until the challenge-stage task fills `stageSequence.challenge`
 * — falls back to the normal sequence, so the game keeps playing rather than
 * meeting an empty screen. Remove the fallback once the challenge stages exist;
 * the `stageFor` contract is already "undefined when the pack has none", and the
 * simulation handles that by sitting still rather than by looping.
 */
export function createStageSource(
  lookup: StageLookup,
  options: StageSourceOptions = {},
): StageSource {
  const { manifest, rules } = lookup;

  return {
    stageFor(stage: number): StageContent | undefined {
      if (rules === undefined) return undefined;
      const id = resolveStageId(manifest, rules, stage, options.rank);
      const document =
        (id === undefined ? undefined : lookup.stages.get(id)) ?? fallbackStage(lookup, stage);
      if (document === undefined) return undefined;
      return resolveStageContent(lookup, document);
    },
  };
}

/** @see createStageSource — the challenge-stage bridge, and nothing else. */
function fallbackStage(lookup: StageLookup, stage: number): Stage | undefined {
  const { manifest, rules } = lookup;
  if (rules === undefined) return undefined;
  const rows = manifest.stageSequence.normal.rows;
  if (rows.length === 0) return undefined;
  // Index by the stage number so successive stages still differ; the sequence's
  // own plateau is handled by `resolveStageId`, which this path has bypassed.
  return lookup.stages.get(rows[(stage - 1) % rows.length] ?? '');
}
