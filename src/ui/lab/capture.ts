/**
 * The capture page: a replay, rendered one simulation step at a time
 * (`docs/ROADMAP.md`, "Capturing gameplay video", phase 1).
 *
 * `npm run capture` (`scripts/capture.ts`) opens `capture.html` in a headless
 * browser and drives this module through `window.starSwarmCapture`. Nothing here
 * runs on a clock: the command asks for a step, the page takes exactly that many
 * simulation steps through the real `createLoop`, and — only when asked to —
 * draws the last one onto the real 224x288 backbuffer and hands it back as a PNG.
 * Fast-forward is stepping with the drawing switched off, so reaching step 2,600
 * costs processor time rather than forty-three seconds of play.
 *
 * The run itself — the world, and the starfield, `drawScene`, the pack's one-shot
 * effects and the HUD that draw it — is `./game-run.ts`, the same one the record
 * page (`./record.ts`) plays a person through. That is why a log recorded there
 * renders here frame for frame.
 *
 * **Dev build only**, exactly as `/lab` is: `capture.html` is not one of the
 * build's inputs and nothing on the game's graph imports this directory —
 * `tests/unit/lab-dev-only.test.ts` checks both. The game never records.
 */

import type { Rules } from '../../content/schema.js';
import { createLoop, STEP_MS } from '../../engine/loop.js';
import { createReplaySource, type Replay } from '../../engine/replay.js';
import { createDisplay } from '../../render/canvas.js';
import { fingerprintWorld } from '../../sim/world.js';
import { createGameRun } from './game-run.js';

/** What the command hands the page: one run, fully described. */
export interface CaptureRequest {
  readonly replay: Replay;
  /** The rules the run was recorded under — a golden's cabinet, not always the pack's. */
  readonly rules: Rules;
  /** The pack directories to layer, in order, for stages and art. */
  readonly packs: readonly string[];
  /** The stage the run starts on. Omitted means the rules' own `firstStage`. */
  readonly stage?: number;
}

export interface CaptureSession {
  /** Simulation steps taken so far. */
  readonly step: number;
  /**
   * Take steps until `step` have been taken, drawing nothing. Returns the step
   * reached, which is `step` unless it was already behind.
   */
  skipTo: (step: number) => number;
  /** Take steps until `step` have been taken, then draw and return the frame as a PNG data URL. */
  frameAt: (step: number) => string;
  /**
   * The world's fingerprint at the replay's last recorded step, once the run has
   * passed it — the same `fingerprintWorld` the golden test compares, so a
   * capture can say it played the golden rather than something near it.
   */
  readonly fingerprint: string | undefined;
}

declare global {
  interface Window {
    starSwarmCapture?: { open: (request: CaptureRequest) => CaptureSession };
  }
}

function open(request: CaptureRequest): CaptureSession {
  const { replay, rules, packs, stage } = request;
  const run = createGameRun({
    seed: replay.seed,
    rules,
    packs,
    ...(stage !== undefined && { stage }),
  });
  const { world } = run;
  const input = createReplaySource(replay);

  const container = document.getElementById('capture');
  if (container === null) throw new Error('capture.html is missing its container');
  const display = createDisplay({ container, maxScale: 1 });
  const { ctx, backbuffer } = display;

  let draw = false;
  let fingerprint: string | undefined;

  const loop = createLoop({
    update() {
      run.step(input.sample());
      if (world.step === replay.steps) fingerprint = fingerprintWorld(world);
    },
    render() {
      if (draw) run.draw(ctx);
    },
    requestFrame: () => 0,
    cancelFrame: () => {},
  });

  function skipTo(target: number): number {
    // One `advance` of exactly one step's time is exactly one update and one
    // render: the loop's own accumulator, never the wall clock.
    while (world.step < target) loop.advance(STEP_MS);
    return world.step;
  }

  return {
    get step(): number {
      return world.step;
    },
    skipTo,
    frameAt(target: number): string {
      if (target <= world.step) {
        throw new RangeError(`step ${String(target)} has already been taken`);
      }
      skipTo(target - 1);
      draw = true;
      loop.advance(STEP_MS);
      draw = false;
      return backbuffer.toDataURL('image/png');
    },
    get fingerprint(): string | undefined {
      return fingerprint;
    },
  };
}

window.starSwarmCapture = { open };
