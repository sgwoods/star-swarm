/**
 * One stage of one game, run by the real simulation so `/lab` can step it.
 *
 * The stage preview draws a `World`, and this is where that world comes from:
 * `createWorld` with the game's own rules, rank, starting fighters and stage
 * source, stepped by `stepWorld` with the controls untouched — exactly the run
 * the `stage-entry` golden records, which is how `tests/sim/lab-stages.test.ts`
 * holds the two to each other. Nothing here schedules a wave, places a slot or
 * flies a path: the fleet the simulation builds is the schedule, and the events it
 * raises are the timeline. A preview that worked those out for itself would be a
 * second answer that could disagree with the game.
 *
 * **Steppable both ways because the simulation is deterministic.** Forward is
 * another `stepWorld`; backward is the same world built again and stepped to the
 * earlier frame, which lands on the same state bit for bit. A stage's whole
 * timeline is a few thousand steps, so rebuilding costs milliseconds.
 *
 * DOM-free, so the Node tests drive this module directly.
 */

import {
  challengeOrdinal,
  isChallengeStage,
  normalStageOrdinal,
  resolveStageId,
  resolveStageSequence,
} from '../../content/rules.js';
import type { Stage } from '../../content/schema.js';
import { resolveStageContent, type StageSource } from '../../content/stages.js';
import type { ResolvedVariant } from '../../content/variants.js';
import type { SimEvent } from '../../sim/events.js';
import { createWorld, stepWorld, type World } from '../../sim/world.js';

/** The seed a preview runs on unless told otherwise. Entry choreography ignores it. */
export const LAB_SEED = 'lab';

/**
 * Frames the timeline runs past the frame the formation settles: long enough to
 * see the first dives leave, which settling is what arms.
 */
export const SETTLED_TAIL = 240;

/** A stage that never settles or clears stops here: 90 seconds at 60 Hz. */
export const MAX_FRAMES = 5_400;

/** What a game the lab is previewing has to offer for this. */
export type StageGame = Pick<ResolvedVariant, 'registry' | 'rules' | 'lives' | 'stagesFor'>;

/** Which stage numbers each stage document plays as, at one rank. */
export interface StagePlays {
  /** Stage id → the stage numbers it plays as, ascending, over one full cycle. */
  readonly numbers: ReadonlyMap<string, readonly number[]>;
  /** The last stage number examined: past it, both halves of the sequence repeat. */
  readonly horizon: number;
}

/**
 * Which stage numbers every stage document plays as at `rank`, read from the
 * game's own sequence through `resolveStageId` — the lookup `createStageSource`
 * makes — until both halves have run through their rows and once round their
 * plateau, after which nothing new can appear.
 */
export function stagePlays(
  game: Pick<StageGame, 'registry' | 'rules'>,
  rank: string | undefined,
): StagePlays {
  const { registry, rules } = game;
  const sequence = resolveStageSequence(registry.manifest, rules, rank);
  const normalSpan = sequence.normal.rows.length + sequence.normal.repeatLast;
  const challengeSpan = sequence.challenge.rows.length + sequence.challenge.repeatLast;
  const numbers = new Map<string, number[]>();
  let stage = 0;
  for (;;) {
    stage += 1;
    const normalDone = normalStageOrdinal(rules, stage) >= normalSpan;
    const challengeDone =
      !rules.challengeStages.enabled || challengeOrdinal(rules, stage) >= challengeSpan;
    if ((normalDone && challengeDone) || stage > MAX_STAGE_SCAN) break;
    const id = resolveStageId(registry.manifest, rules, stage, rank);
    if (id === undefined) continue;
    const list = numbers.get(id) ?? [];
    list.push(stage);
    numbers.set(id, list);
  }
  return { numbers, horizon: stage - 1 };
}

/** A sequence long enough to need more than this is not a sequence anyone wrote. */
const MAX_STAGE_SCAN = 1_000;

/** One enemy's place in the entry, as the simulation built the fleet. */
export interface Launch {
  readonly id: number;
  readonly alienId: string;
  readonly wave: number;
  /** Frames after the stage began at which it is due to launch. */
  readonly due: number;
  /** The frame it actually launched, which the round robin may put a little later. */
  readonly launched: number | undefined;
  readonly path: string;
  readonly mirror: boolean;
  readonly trailing: boolean;
  /** The formation slot it flies to, or `undefined` for a flyer that never homes. */
  readonly home: number | undefined;
}

/** One entry wave: what the document says, and what the run did with it. */
export interface WaveSummary {
  readonly index: number;
  /** The document's `at`. */
  readonly at: number;
  readonly spacing: number;
  /** Alien id → how many the wave sends, in first-seen order. */
  readonly aliens: ReadonlyMap<string, number>;
  /** The first and last launch frames the run recorded, if any launched. */
  readonly firstLaunch: number | undefined;
  readonly lastLaunch: number | undefined;
}

/** An event, and the frame whose step raised it. */
export interface TimedEvent {
  readonly frame: number;
  readonly event: SimEvent;
}

/** Why the timeline stops where it does. */
export type StageEnd = 'settled' | 'cleared' | 'game-over' | 'limit';

export interface StageRunOptions {
  readonly stageId: string;
  /** The difficulty rank. Omitted means the rules' own default. */
  readonly rank?: string;
  readonly seed?: string;
}

export interface StageRun {
  readonly stage: Stage;
  /** The stage number the document is run as. */
  readonly number: number;
  /**
   * Whether the game plays this document at this rank at all. When it does not,
   * the run is the document on its own, as the first stage number of its kind.
   */
  readonly inSequence: boolean;
  readonly rank: string | undefined;
  /** The last frame of the timeline. Frame 0 is the world before its first step. */
  readonly length: number;
  readonly end: StageEnd;
  /** The frame `formation-settled` was raised on, if it was. */
  readonly settledAt: number | undefined;
  readonly launches: readonly Launch[];
  readonly waves: readonly WaveSummary[];
  /** Every event the timeline raised, in order. */
  readonly events: readonly TimedEvent[];
  /** The world at the current frame. The same object until a seek goes backwards. */
  readonly world: World;
  readonly frame: number;
  /** Move to `frame`, clamped to the timeline, stepping or rebuilding as needed. */
  seek(frame: number): void;
}

/** The single-document source for a stage the game's sequence does not play. */
function documentSource(game: StageGame, stage: Stage, number: number): StageSource {
  return {
    stageFor: (n) => (n === number ? resolveStageContent(game.registry, stage) : undefined),
  };
}

/** The first stage number a document of this kind would play as. */
function firstNumberOfKind(game: StageGame, stage: Stage): number {
  const { challengeStages } = game.rules;
  if (stage.kind === 'challenge' && challengeStages.enabled) return challengeStages.firstStage;
  for (let n = 1; n <= MAX_STAGE_SCAN; n += 1) {
    if (!isChallengeStage(game.rules, n)) return n;
  }
  return 1;
}

/**
 * Run `stageId` of `game` once to the end of its timeline, recording what
 * happened, and hand back a run positioned at frame 0.
 *
 * Throws what `createWorld` throws for a stage whose fleet cannot be built — the
 * game would throw the same on reaching it.
 */
export function createStageRun(game: StageGame, options: StageRunOptions): StageRun {
  const stage = game.registry.stages.get(options.stageId);
  if (stage === undefined) throw new Error(`no stage "${options.stageId}" in this game`);
  const { rank } = options;
  const seed = options.seed ?? LAB_SEED;

  const played = stagePlays(game, rank).numbers.get(stage.id);
  const inSequence = played !== undefined && played.length > 0;
  const number = played?.[0] ?? firstNumberOfKind(game, stage);
  const stages = inSequence ? game.stagesFor(rank) : documentSource(game, stage, number);

  const build = (): World =>
    createWorld({
      seed,
      rules: game.rules,
      stages,
      stage: number,
      lives: game.lives,
      ...(rank === undefined ? {} : { rank }),
    });

  // The one pass that finds the timeline: step until the stage is over, or has
  // settled and shown its first dives, and keep everything it said.
  const firstPass = build();
  // Read before the first step: a transform can make an enemy another alien later.
  const planned = firstPass.fleet.enemies.map((enemy) => ({
    id: enemy.id,
    alienId: enemy.alienId,
    wave: enemy.wave,
    due: enemy.launchFrame,
    path: enemy.path,
    mirror: enemy.mirror,
    trailing: enemy.trailing,
    home: enemy.homes ? enemy.home : undefined,
  }));
  const events: TimedEvent[] = firstPass.events.map((event) => ({ frame: 0, event }));
  const launchedAt = new Map<number, number>();
  let settledAt: number | undefined;
  let length = 0;
  let end: StageEnd = 'limit';
  for (let frame = 1; frame <= MAX_FRAMES; frame += 1) {
    const raised = stepWorld(firstPass, 0);
    // The step that clears a stage also builds the next one, so the timeline
    // stops on the frame before: what is drawn is always this stage.
    if (firstPass.stage !== number) {
      events.push(...raised.map((event) => ({ frame, event })));
      end = 'cleared';
      length = frame - 1;
      break;
    }
    for (const event of raised) {
      events.push({ frame, event });
      if (event.type === 'enemy-launched') launchedAt.set(event.targetId, frame);
      if (event.type === 'formation-settled' && settledAt === undefined) settledAt = frame;
    }
    length = frame;
    if (firstPass.status === 'game-over') {
      end = 'game-over';
      break;
    }
    if (settledAt !== undefined && frame >= settledAt + SETTLED_TAIL) {
      end = 'settled';
      break;
    }
  }

  const launchList: Launch[] = planned.map((launch) => ({
    ...launch,
    launched: launchedAt.get(launch.id),
  }));

  const waves: WaveSummary[] = stage.waves.map((wave, index) => {
    const aliens = new Map<string, number>();
    for (const slot of wave.slots) aliens.set(slot.alien, (aliens.get(slot.alien) ?? 0) + 1);
    const frames = launchList
      .filter((launch) => launch.wave === index && launch.launched !== undefined)
      .map((launch) => launch.launched as number);
    return {
      index,
      at: wave.at,
      spacing: wave.spacing,
      aliens,
      firstLaunch: frames.length > 0 ? Math.min(...frames) : undefined,
      lastLaunch: frames.length > 0 ? Math.max(...frames) : undefined,
    };
  });

  let world = build();

  return {
    stage,
    number,
    inSequence,
    rank,
    length,
    end,
    settledAt,
    launches: launchList,
    waves,
    events,
    get world(): World {
      return world;
    },
    get frame(): number {
      return world.step;
    },
    seek(target: number): void {
      const frame = Math.max(0, Math.min(length, Math.round(target)));
      if (frame < world.step) world = build();
      while (world.step < frame) stepWorld(world, 0);
    },
  };
}
