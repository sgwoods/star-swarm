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
 * What is drawn is what `src/main.ts` draws during play, in the same order and
 * from the same modules: the starfield (advanced once per step, as a 60 Hz
 * display advances it), `drawScene`, the pack's one-shot effects, and the HUD.
 * Three things are left out on purpose, because they belong to the front end
 * rather than to the run: the build stamp (a property of the checkout, not the
 * replay), the flow's cards (a replay is a world, not a session), and a stored
 * high-score table (the HUD's high score is the run's own score).
 *
 * **Dev build only**, exactly as `/lab` is: `capture.html` is not one of the
 * build's inputs and nothing on the game's graph imports this directory —
 * `tests/unit/lab-dev-only.test.ts` checks both. The game never records.
 */

import { bundledPackSource } from '../../content/bundle.js';
import { createRegistry, loadPack, type LoadedPack } from '../../content/index.js';
import type { Rules } from '../../content/schema.js';
import { createStageSource } from '../../content/stages.js';
import { createLoop, STEP_MS } from '../../engine/loop.js';
import { createReplaySource, type Replay } from '../../engine/replay.js';
import { createRng } from '../../engine/rng.js';
import { createDisplay, LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../render/canvas.js';
import { createEffects } from '../../render/effects.js';
import { drawScene } from '../../render/scene.js';
import { createSpriteSheet } from '../../render/sprites.js';
import { createStarfield } from '../../render/starfield.js';
import { createWorld, fingerprintWorld, stepWorld } from '../../sim/world.js';
import { drawHud } from '../hud.js';

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

function loadPacks(names: readonly string[]): LoadedPack[] {
  return names.map((name) => {
    const source = bundledPackSource(name);
    if (source === undefined) throw new Error(`no pack named "${name}" under packs/`);
    const result = loadPack(source);
    if (!result.ok)
      throw new Error(`pack "${name}" does not load: ${JSON.stringify(result.errors)}`);
    return result.pack;
  });
}

function open(request: CaptureRequest): CaptureSession {
  const { replay, rules, stage } = request;
  const registry = createRegistry(loadPacks(request.packs));
  const world = createWorld({
    seed: replay.seed,
    rules,
    stages: createStageSource(registry),
    ...(stage !== undefined && { stage }),
  });
  const input = createReplaySource(replay);

  const container = document.getElementById('capture');
  if (container === null) throw new Error('capture.html is missing its container');
  const display = createDisplay({ container, maxScale: 1 });
  const { ctx, backbuffer } = display;

  // The same derivations `applyVariant` in `src/main.ts` makes, once.
  const sheet = createSpriteSheet({
    sprites: registry.sprites.values(),
    palette: registry.manifest.palette,
  });
  const effects = createEffects({
    bindings: registry.manifest.effects,
    sprites: registry.sprites,
  });
  const starfield = createStarfield(createRng(`${String(replay.seed)}:stars`));

  let draw = false;
  let fingerprint: string | undefined;

  const loop = createLoop({
    update() {
      effects.advance();
      const events = stepWorld(world, input.sample());
      starfield.handle(events);
      effects.handle(events);
      if (world.step === replay.steps) fingerprint = fingerprintWorld(world);
    },
    render() {
      // Advanced on every step whether or not it is drawn, so a clip that starts
      // at step 2,600 shows the field a player at 60 Hz would have seen there.
      starfield.advance();
      if (!draw) return;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      starfield.draw(ctx);
      drawScene(ctx, world, { sheet });
      effects.draw(ctx, sheet);
      drawHud(ctx, {
        score: world.score,
        highScore: world.score,
        lives: world.lives.reserve,
        stage: world.stage,
        badges: registry.manifest.stageBadges,
        sheet,
      });
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
