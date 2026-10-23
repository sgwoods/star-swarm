/**
 * Recording a live run: `docs/ROADMAP.md`, "Capturing gameplay video", phase 2.
 *
 * A run is a seed and the frame the world saw at each step, so recording one is
 * putting `recordInput` — the wrapper the goldens are recorded with — between the
 * keyboard and the world. This module is that and the few decisions around it
 * that the record page (`./record.ts`) makes once per step: whether a run has
 * started, whether it is held, and when it is over. It touches no DOM, so the
 * Node tests drive it with a real world.
 *
 * The rules are the ones `src/ui/flow.ts` keeps, so that what the world sees on
 * this page is what it would see in the game:
 *
 * - **`start` begins a run, and the world never sees that frame.** The flow
 *   starts a game on the step `start` is pressed and steps the world first on the
 *   next one. Each run takes the next game index, and **its seed is derived from
 *   it** — `<root>:game-<n>`, the shape `startGame` gives a game's seed — so the
 *   log that comes out needs nothing beside it to be played again.
 * - **`pause` holds the world, and a held world records nothing.** The frame that
 *   carried the press was an ordinary frame and is in the log; every frame until
 *   the press that lets go is not, because the world never saw it.
 * - **`exit` ends the run.** As in the game, the frame carrying it is stepped and
 *   the run stops after it; from a pause it stops without another step.
 * - **The world's own `game-over` ends it too**, on the step that raised it.
 *
 * A run that ends is **sealed**: the log is finished with `fingerprintWorld` of
 * the world it drove, which is what lets `npm run capture` say it played the run
 * rather than something near it.
 */

import { EMPTY_FRAME, type InputFrame, wasPressed } from '../../engine/input.js';
import { recordInput, type Recorder, type Replay } from '../../engine/replay.js';
import type { SimEvent } from '../../sim/events.js';

/**
 * Where a finished run is sent: a route that exists only on the dev server
 * `npm run record` starts (`scripts/record.ts`). A plain `npm run dev` does not
 * have it, and the page says so rather than pretending the run was kept.
 */
export const RECORD_SINK = '/__star-swarm/record';

/**
 * The game a log plays: the shipped Classic pack on its own rules. It is the one
 * `npm run capture` renders a `.replay.json` on (`resolveReplay` in
 * `scripts/capture.ts`), so it is the one game the record page plays — a run on
 * anything else would be a log nothing renders back.
 */
export const LOG_PACKS: readonly string[] = ['classic'];

/** The session root the record page derives each run's seed from. */
export const RECORD_SEED_ROOT = 'record';

/** A run's seed: the session root and the game's index, as `startGame` derives one. */
export function runSeed(root: string, game: number): string {
  return `${root}:game-${String(game)}`;
}

/** What one finished run is, and what the page sends to {@link RECORD_SINK}. */
export interface RecordedRun {
  /** The log, sealed with the world's final fingerprint. */
  readonly replay: Replay;
  /**
   * The stage it started on, when that was not the rules' own first — the one
   * thing besides the log `npm run capture` has to be told (`--stage`).
   */
  readonly stage?: number;
}

/** What `npm run record` answers a {@link RecordedRun} with. */
export type RecordReceipt =
  | { readonly ok: true; readonly path: string; readonly capture: string }
  | { readonly ok: false; readonly error: string };

/** One run's world, as the page plays it. */
export interface RunPlayer {
  /** What the world raised before its first step. */
  readonly opening: readonly SimEvent[];
  /** Step the world once on `frame` and return what it raised. */
  readonly step: (frame: InputFrame) => readonly SimEvent[];
  /** `fingerprintWorld` of the world as it stands. */
  readonly fingerprint: () => string;
}

export type RecordingState = 'ready' | 'playing' | 'paused' | 'ended';

export interface RecordingOptions {
  /** Build the world for a run on `seed`. Called once per run, on its `start`. */
  readonly begin: (seed: string) => RunPlayer;
  /** The stage every run starts on, when it is not the rules' own first. */
  readonly stage?: number;
  readonly root?: string;
}

/** What one call to {@link Recording.step} did. */
export interface RecordingStep {
  readonly state: RecordingState;
  /** What the world raised this step: its opening events on a start, else its step's. */
  readonly events: readonly SimEvent[];
  /** The run that ended this step, sealed. */
  readonly ended?: RecordedRun;
}

export interface Recording {
  readonly state: RecordingState;
  /** Runs started so far; the current one's index. */
  readonly game: number;
  /** The current or most recent run's seed. */
  readonly seed: string | undefined;
  /** Steps the current or most recent run's world has been given. */
  readonly steps: number;
  /** The most recent run to end. */
  readonly last: RecordedRun | undefined;
  /** One host step: the keyboard's frame for it, sampled once. */
  step: (frame: InputFrame) => RecordingStep;
}

export function createRecording(options: RecordingOptions): Recording {
  const { begin, stage, root = RECORD_SEED_ROOT } = options;

  let state: RecordingState = 'ready';
  let game = 0;
  let seed: string | undefined;
  let player: RunPlayer | undefined;
  let recorder: Recorder | undefined;
  let last: RecordedRun | undefined;
  let previous: InputFrame = EMPTY_FRAME;
  /**
   * The frame this step hands the world. The keyboard is sampled every step,
   * held or not, because `start` and `pause` have to be read; so the recorder
   * wraps *this* rather than the keyboard, and is sampled exactly when the world
   * is stepped — which is what makes the log the world's frames and no others.
   */
  let current: InputFrame = EMPTY_FRAME;
  const handed = { sample: (): InputFrame => current };

  const seal = (): RecordedRun => {
    if (player === undefined || recorder === undefined) throw new Error('no run to seal');
    const run: RecordedRun = {
      replay: recorder.finish(player.fingerprint()),
      ...(stage !== undefined && { stage }),
    };
    last = run;
    state = 'ended';
    return run;
  };

  return {
    get state(): RecordingState {
      return state;
    },
    get game(): number {
      return game;
    },
    get seed(): string | undefined {
      return seed;
    },
    get steps(): number {
      return recorder?.steps ?? 0;
    },
    get last(): RecordedRun | undefined {
      return last;
    },
    step(frame: InputFrame): RecordingStep {
      const was = previous;
      previous = frame;
      const pressed = (action: 'start' | 'pause' | 'exit'): boolean =>
        wasPressed(was, frame, action);

      switch (state) {
        case 'ready':
        case 'ended': {
          if (!pressed('start')) return { state, events: [] };
          game += 1;
          seed = runSeed(root, game);
          player = begin(seed);
          recorder = recordInput(handed, seed);
          state = 'playing';
          return { state, events: player.opening };
        }
        case 'playing': {
          if (player === undefined || recorder === undefined) throw new Error('playing no run');
          current = frame;
          const events = player.step(recorder.source.sample());
          if (events.some((event) => event.type === 'game-over') || pressed('exit')) {
            return { state: 'ended', events, ended: seal() };
          }
          if (pressed('pause')) state = 'paused';
          return { state, events };
        }
        case 'paused': {
          if (pressed('exit')) return { state: 'ended', events: [], ended: seal() };
          if (pressed('pause')) state = 'playing';
          return { state, events: [] };
        }
      }
    },
  };
}
