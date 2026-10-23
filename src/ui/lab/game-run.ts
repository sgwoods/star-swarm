/**
 * One run of the game — a world and everything that draws it — built the one way
 * both clip pages build it (`docs/ROADMAP.md`, "Capturing gameplay video").
 *
 * The capture page (`./capture.ts`) plays a log through one of these; the record
 * page (`./record.ts`) plays a person through one. Sharing it is what makes "a log
 * the record page wrote is a log the capture page can render" a fact about the
 * code rather than a promise: the world, the sprite sheet, the effects, the
 * starfield and the order they are advanced in are the same objects built by the
 * same function, so a frame drawn after step _N_ of a recording is the frame the
 * capture page draws after step _N_ of its log.
 *
 * What is built is what `applyVariant` and the loop in `src/main.ts` build for a
 * game: the world, the sheet and the pack's effects, and a starfield on its own
 * generator. Two things are fixed rather than left to the host, because a clip
 * has to be the same clip on any machine:
 *
 * - **The starfield advances once per simulation step.** `src/main.ts` advances it
 *   once per host frame, which on a 60 Hz display is the same thing; on a faster
 *   one it is not, and a recording that depended on the display would not render
 *   back the same.
 * - **The world's opening events reach the subscribers**, as `startGame` in
 *   `src/ui/flow.ts` hands them to `src/main.ts`. The first is `stage-started`, and
 *   it carries the stage's starfield speed, so a run that starts on stage 20 is
 *   drawn at stage 20's scroll rate from its first frame.
 *
 * **Dev build only**, like everything in this directory.
 */

import { bundledPackSource } from '../../content/bundle.js';
import {
  type ContentRegistry,
  createRegistry,
  loadPack,
  type LoadedPack,
} from '../../content/index.js';
import type { Rules } from '../../content/schema.js';
import { createStageSource } from '../../content/stages.js';
import type { InputFrame } from '../../engine/input.js';
import { createRng } from '../../engine/rng.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../render/canvas.js';
import { createEffects } from '../../render/effects.js';
import { drawScene } from '../../render/scene.js';
import { createSpriteSheet } from '../../render/sprites.js';
import { createStarfield } from '../../render/starfield.js';
import type { SimEvent } from '../../sim/events.js';
import { createWorld, stepWorld, type World } from '../../sim/world.js';
import { drawHud } from '../hud.js';

/** Which run: a seed, the rules it plays under, the packs it draws from, and where it starts. */
export interface RunSpec {
  readonly seed: number | string;
  /** The rules — a golden's cabinet is not always the pack's own. */
  readonly rules: Rules;
  /** The pack directories to layer, in order, for stages and art. */
  readonly packs: readonly string[];
  /** The stage the run starts on. Omitted means the rules' own `firstStage`. */
  readonly stage?: number;
}

export interface GameRun {
  readonly world: World;
  readonly registry: ContentRegistry;
  /** What `createWorld` raised before any step, already handed to the effects and the starfield. */
  readonly opening: readonly SimEvent[];
  /** Take one simulation step on `frame`, and return the events it raised. */
  step: (frame: InputFrame) => readonly SimEvent[];
  /** Draw the world as it now stands onto the 224x288 backbuffer behind `ctx`. */
  draw: (ctx: CanvasRenderingContext2D) => void;
}

/** The named packs, from the bundle, through the real loader. */
export function loadPacks(names: readonly string[]): LoadedPack[] {
  return names.map((name) => {
    const source = bundledPackSource(name);
    if (source === undefined) throw new Error(`no pack named "${name}" under packs/`);
    const result = loadPack(source);
    if (!result.ok)
      throw new Error(`pack "${name}" does not load: ${JSON.stringify(result.errors)}`);
    return result.pack;
  });
}

export function createGameRun(spec: RunSpec): GameRun {
  const { rules, stage } = spec;
  const registry = createRegistry(loadPacks(spec.packs));
  const world = createWorld({
    seed: spec.seed,
    rules,
    stages: createStageSource(registry),
    ...(stage !== undefined && { stage }),
  });

  // The same derivations `applyVariant` in `src/main.ts` makes, once.
  const sheet = createSpriteSheet({
    sprites: registry.sprites.values(),
    palette: registry.manifest.palette,
  });
  const effects = createEffects({
    bindings: registry.manifest.effects,
    sprites: registry.sprites,
  });
  const starfield = createStarfield(createRng(`${String(spec.seed)}:stars`));

  // Copied, because the world reuses its event list from the first step on.
  const opening = [...world.events];
  starfield.handle(opening);
  effects.handle(opening);

  return {
    world,
    registry,
    opening,
    step(frame: InputFrame): readonly SimEvent[] {
      // The order `src/main.ts` keeps: the effects advance before the step, so an
      // explosion raised on it is drawn at its first frame; the subscribers hear
      // the step; and the backdrop moves once, as a 60 Hz display moves it.
      effects.advance();
      const events = stepWorld(world, frame);
      starfield.handle(events);
      effects.handle(events);
      starfield.advance();
      return events;
    },
    draw(ctx: CanvasRenderingContext2D): void {
      // The game's own render pass less the front end: no build stamp (a property
      // of the checkout, not the run), no flow cards (a run is a world, not a
      // session), and no stored high-score table (the run's own score is its best).
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
  };
}
