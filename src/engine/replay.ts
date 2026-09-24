/**
 * Input recording and playback (docs/DESIGN.md pillar 4, section 11).
 *
 * A run is fully described by a seed plus the {@link InputFrame} sampled at each
 * simulation step. Replay one against the other and you get the same run back —
 * which is how golden replay tests prove behaviour like capture → rescue → dual
 * fighter without a human watching.
 *
 * Frames are stored run-length encoded. Input barely changes between steps (a
 * held direction is the same mask 60 times a second), so a minute of play is a
 * few dozen runs rather than 3,600 numbers.
 */

import { EMPTY_FRAME, type InputFrame, type InputSource } from './input.js';
import { STEP_HZ } from './loop.js';

/** Bumped whenever the on-disk shape changes, so old logs fail loudly. */
export const REPLAY_VERSION = 1;

/** `[frame, repeatCount]`. */
export type FrameRun = readonly [InputFrame, number];

export interface Replay {
  readonly version: number;
  /** Seed handed to `createRng`; a replay is meaningless without it. */
  readonly seed: number | string;
  /** Simulation rate the log was recorded at, checked on playback. */
  readonly stepHz: number;
  /** Total simulation steps recorded. */
  readonly steps: number;
  readonly runs: readonly FrameRun[];
  /**
   * Optional fingerprint of the final simulation state. A replay that ends
   * somewhere else is a regression, and this is what makes the test fail.
   */
  readonly finalState?: string;
}

export interface Recorder {
  /** The wrapped source: sample it exactly as you would the original. */
  readonly source: InputSource;
  /** Steps recorded so far. */
  readonly steps: number;
  /** Seal the recording. `finalState` is an optional state fingerprint. */
  finish: (finalState?: string) => Replay;
}

/**
 * Wrap an input source so every frame it hands out is also recorded.
 *
 * The wrapper sits between the loop and the real source, so recording cannot
 * drift from what the simulation actually saw.
 */
export function recordInput(
  source: InputSource,
  seed: number | string,
  stepHz: number = STEP_HZ,
): Recorder {
  const runs: [InputFrame, number][] = [];
  let steps = 0;

  return {
    source: {
      sample(): InputFrame {
        const frame = source.sample();
        const last = runs[runs.length - 1];
        if (last !== undefined && last[0] === frame) {
          last[1] += 1;
        } else {
          runs.push([frame, 1]);
        }
        steps += 1;
        return frame;
      },
    },

    get steps(): number {
      return steps;
    },

    finish(finalState?: string): Replay {
      return {
        version: REPLAY_VERSION,
        seed,
        stepHz,
        steps,
        runs: runs.map(([frame, count]) => [frame, count] as FrameRun),
        ...(finalState === undefined ? {} : { finalState }),
      };
    },
  };
}

export interface ReplaySource extends InputSource {
  /** Steps played back so far. */
  readonly step: number;
  /** True once every recorded step has been handed out. */
  readonly done: boolean;
  /** Rewind to the first recorded step. */
  reset: () => void;
}

export interface ReplaySourceOptions {
  /**
   * What to do when the simulation asks for a step past the end of the log.
   * `'empty'` (the default) hands out {@link EMPTY_FRAME}, which is right for
   * "play the recording, then leave the ship alone". `'throw'` is right for a
   * test that expects the log to cover the whole run.
   */
  onOverrun?: 'empty' | 'throw';
}

/**
 * Turn a replay into an input source. Drop it in where the keyboard would go.
 */
export function createReplaySource(
  replay: Replay,
  options: ReplaySourceOptions = {},
): ReplaySource {
  assertReplayCompatible(replay);
  const { onOverrun = 'empty' } = options;

  let runIndex = 0;
  let withinRun = 0;
  let step = 0;

  return {
    sample(): InputFrame {
      const run = replay.runs[runIndex];
      if (run === undefined) {
        if (onOverrun === 'throw') {
          throw new RangeError(
            `Replay exhausted after ${String(replay.steps)} steps; step ${String(step)} was requested`,
          );
        }
        return EMPTY_FRAME;
      }

      const [frame, count] = run;
      withinRun += 1;
      if (withinRun >= count) {
        runIndex += 1;
        withinRun = 0;
      }
      step += 1;
      return frame;
    },

    get step(): number {
      return step;
    },

    get done(): boolean {
      return step >= replay.steps;
    },

    reset(): void {
      runIndex = 0;
      withinRun = 0;
      step = 0;
    },
  };
}

/** Expand a replay to one frame per step. Handy in assertions; not for hot paths. */
export function replayFrames(replay: Replay): InputFrame[] {
  const frames: InputFrame[] = [];
  for (const [frame, count] of replay.runs) {
    for (let i = 0; i < count; i += 1) frames.push(frame);
  }
  return frames;
}

/** Throw unless this build can play the replay back faithfully. */
export function assertReplayCompatible(replay: Replay, stepHz: number = STEP_HZ): void {
  if (replay.version !== REPLAY_VERSION) {
    throw new Error(
      `Replay version ${String(replay.version)} is not supported (expected ${String(REPLAY_VERSION)})`,
    );
  }
  if (replay.stepHz !== stepHz) {
    throw new Error(
      `Replay was recorded at ${String(replay.stepHz)} Hz but this build steps at ${String(stepHz)} Hz`,
    );
  }
  const total = replay.runs.reduce((sum, [, count]) => sum + count, 0);
  if (total !== replay.steps) {
    throw new Error(
      `Replay is corrupt: runs cover ${String(total)} steps but steps says ${String(replay.steps)}`,
    );
  }
}

/** Serialise for `tests/sim/` golden files. */
export function serializeReplay(replay: Replay): string {
  return JSON.stringify(replay);
}

/** Parse and validate a serialised replay. */
export function parseReplay(json: string): Replay {
  const parsed = JSON.parse(json) as Replay;
  assertReplayCompatible(parsed);
  return parsed;
}
