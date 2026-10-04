/**
 * Attract mode: what the cabinet shows when nobody is playing
 * (docs/DESIGN.md section 4, "Game flow").
 *
 * The demo is **the real simulation**, driven through the replay mechanism in
 * `src/engine/replay.ts` — the same one the golden tests use. Nothing here
 * animates a ship: {@link DEMO_SCRIPT} is an input log, `createReplaySource`
 * hands it out one frame per step, and `stepWorld` decides what happens. So the
 * demo cannot drift from the game; if movement, the shot cap or a collision
 * changes, the attract screen changes with it, and a demo that looks wrong is a
 * bug in the game rather than a bug in the demo.
 *
 * The log is hand-authored rather than recorded for the same reason: a recorded
 * log is a file that must be regenerated whenever enemy behaviour changes, and
 * Milestone 2 changes it repeatedly. A written script stays legible, stays in
 * one place, and plays back through exactly the same code path.
 */

import type { Rules } from '../content/schema.js';
import type { StageSource } from '../content/stages.js';
import { type Action, frameOf } from '../engine/input.js';
import { STEP_HZ } from '../engine/loop.js';
import {
  createReplaySource,
  type FrameRun,
  type Replay,
  REPLAY_VERSION,
} from '../engine/replay.js';
import { LOGICAL_WIDTH } from '../render/canvas.js';
import { drawText } from '../render/text.js';
import type { SimEvent } from '../sim/events.js';
import { createWorld, stepWorld, type World } from '../sim/world.js';
import { drawHighScoreTable, type HighScoreEntry } from './highscores.js';
import { CARD_TOP, drawCentredPanel } from './panel.js';

/** Seed the demo world runs on. Fixed, so the attract loop is reproducible. */
export const DEMO_SEED = 'star-swarm-attract';

/** One entry of the script: hold these actions for this many steps. */
function hold(steps: number, ...actions: readonly Action[]): FrameRun {
  return [frameOf(...actions), steps];
}

/**
 * The demo pilot, as an input log.
 *
 * Written the way the game is actually played: the fire button goes down and
 * mostly stays down (the original has no edge detection, so there is no reason
 * to let go), and the ship sweeps. The gaps without fire exist so a viewer sees
 * the ship move rather than a wall of bullets.
 *
 * No run is longer than about 130 steps, because the fighter crosses the whole
 * playfield in 138 at its 1.5 px/frame cadence: a longer hold parks it against a
 * wall, where it is neither shooting anything nor interesting to watch.
 */
export const DEMO_SCRIPT: readonly FrameRun[] = Object.freeze([
  hold(45),
  hold(110, 'right', 'fire'),
  hold(40, 'fire'),
  hold(125, 'left', 'fire'),
  hold(30, 'fire'),
  hold(95, 'right', 'fire'),
  hold(60, 'left', 'fire'),
  hold(45, 'fire'),
  hold(70, 'right'),
  hold(100, 'right', 'fire'),
  hold(130, 'left', 'fire'),
  hold(50, 'fire'),
  hold(60, 'right', 'fire'),
  hold(120, 'left', 'fire'),
  hold(40, 'fire'),
  hold(115, 'right', 'fire'),
  hold(90, 'left', 'fire'),
  hold(35, 'fire'),
  hold(120, 'left', 'fire'),
  hold(90, 'right', 'fire'),
  hold(30, 'fire'),
]);

/** Build the demo's {@link Replay}. A normal replay in every respect. */
export function createAttractReplay(seed: string = DEMO_SEED): Replay {
  return {
    version: REPLAY_VERSION,
    seed,
    stepHz: STEP_HZ,
    steps: DEMO_SCRIPT.reduce((total, [, count]) => total + count, 0),
    runs: DEMO_SCRIPT,
  };
}

export interface AttractDemo {
  /** The world on screen. Replaced when the demo loops, so read it every frame. */
  readonly world: World;
  /** Steps into the current pass of the log. */
  readonly step: number;
  /** How many times the demo has started over. */
  readonly loops: number;
  /** Advance one simulation step, looping at the end of the log. */
  advance: () => readonly SimEvent[];
  /** Start the demo again from the top. Returns the new world's opening events. */
  restart: () => readonly SimEvent[];
}

export interface AttractDemoOptions {
  readonly rules: Rules;
  /** What plays as each stage. The demo flies the real stage, not a special one. */
  readonly stages?: StageSource;
  readonly seed?: string;
  /** Overridable so a test can play a shorter log. Defaults to {@link DEMO_SCRIPT}. */
  readonly replay?: Replay;
}

/**
 * The demo loop.
 *
 * Restarts when the log runs out or when the demo pilot gets itself killed, so
 * the cabinet never sits on a dead ship.
 */
export function createAttractDemo(options: AttractDemoOptions): AttractDemo {
  const { rules, seed = DEMO_SEED } = options;
  const replay = options.replay ?? createAttractReplay(seed);
  // `exactOptionalPropertyTypes` again: an absent stage source and an explicit
  // `undefined` are different values to `createWorld`.
  const stageOption = options.stages === undefined ? {} : { stages: options.stages };

  const newWorld = (): World => createWorld({ seed, rules, ...stageOption });

  let loops = 0;
  let source = createReplaySource(replay);
  let world = newWorld();

  const restart = (): readonly SimEvent[] => {
    loops += 1;
    source = createReplaySource(replay);
    world = newWorld();
    return world.events;
  };

  return {
    get world(): World {
      return world;
    },
    get step(): number {
      return source.step;
    },
    get loops(): number {
      return loops;
    },

    advance(): readonly SimEvent[] {
      if (source.done || world.status === 'game-over') return restart();
      return stepWorld(world, source.sample());
    },

    restart,
  };
}

/**
 * How long each attract card holds, in simulation steps. Six seconds each, so a
 * full cycle is the twelve the original's attract sequence roughly runs.
 */
export const CARD_STEPS = 6 * STEP_HZ;

export type AttractCard = 'title' | 'scores';

/** Which card is showing. Pure, and driven by step count rather than a clock. */
export function attractCard(steps: number, cardSteps: number = CARD_STEPS): AttractCard {
  const index = Math.floor(Math.max(0, steps) / Math.max(1, cardSteps)) % 2;
  return index === 0 ? 'title' : 'scores';
}

/** Blink period of the "push start" prompt, in steps. */
export const PROMPT_BLINK_STEPS = 30;

const TITLE_COLOUR = '#ffd400';
const TITLE_SHADOW = '#ff2b2b';
const PROMPT_COLOUR = '#ffffff';
const HINT_COLOUR = '#7d8aa8';

/**
 * Card geometry, in logical pixels.
 *
 * Both cards sit in the clear band between the formation and the fighter
 * (`src/ui/panel.ts`), because the demo behind them is a real game and the
 * formation is genuinely in the way.
 */
const CARD_WIDTH = 200;
/** Five hint rows at a 12-pixel pitch, plus the title and air at both ends. */
const TITLE_CARD_HEIGHT = 88;
const SCORES_CARD_WIDTH = 176;
const SCORES_CARD_HEIGHT = 70;
/** Row the "push start" prompt sits on, clear of the card and of the ship. */
const PROMPT_Y = 226;

export interface AttractOptions {
  /** Steps spent in attract mode, for the card cycle and the blink. */
  readonly steps: number;
  readonly highScores: readonly HighScoreEntry[];
  /** False when the table is session-only, so the screen can say so. */
  readonly persistent?: boolean;
  readonly cardSteps?: number;
}

/**
 * Draw the attract overlay over the running demo.
 *
 * The demo itself is drawn by the normal scene and HUD path — this is only the
 * cabinet's furniture on top of it.
 */
export function drawAttract(ctx: CanvasRenderingContext2D, options: AttractOptions): void {
  const { steps, highScores, persistent = true, cardSteps = CARD_STEPS } = options;
  const centre = LOGICAL_WIDTH / 2;

  if (attractCard(steps, cardSteps) === 'title') {
    drawCentredPanel(ctx, centre, CARD_TOP, CARD_WIDTH, TITLE_CARD_HEIGHT);
    // A one-pixel offset copy under the title: the cheapest arcade shadow, and
    // it keeps the letters legible whatever is behind them.
    drawText(ctx, 'STAR SWARM', centre + 1, CARD_TOP + 13, {
      colour: TITLE_SHADOW,
      align: 'center',
    });
    drawText(ctx, 'STAR SWARM', centre, CARD_TOP + 12, { colour: TITLE_COLOUR, align: 'center' });
    drawText(ctx, 'ENTER  START', centre, CARD_TOP + 30, { colour: HINT_COLOUR, align: 'center' });
    drawText(ctx, 'ARROWS  MOVE', centre, CARD_TOP + 42, { colour: HINT_COLOUR, align: 'center' });
    drawText(ctx, 'SPACE  FIRE', centre, CARD_TOP + 54, { colour: HINT_COLOUR, align: 'center' });
    // The fourth row is the one a cabinet has no key for. A control nobody can
    // find is half-shipped, and the pause card can only name itself once you
    // have already pressed the key that raises it.
    drawText(ctx, 'P  PAUSE   X  EXIT', centre, CARD_TOP + 66, {
      colour: HINT_COLOUR,
      align: 'center',
    });
    // The settings screen is where autoplay, difficulty and the rest live, and
    // nothing on this card said how to reach it — a feature that was asked for and
    // then could not be found. `M` opens it as well; one key is enough to name.
    drawText(ctx, 'ESC  SETTINGS', centre, CARD_TOP + 78, {
      colour: HINT_COLOUR,
      align: 'center',
    });
  } else {
    drawCentredPanel(ctx, centre, CARD_TOP, SCORES_CARD_WIDTH, SCORES_CARD_HEIGHT);
    drawHighScoreTable(ctx, highScores, { x: centre, y: CARD_TOP + 8 });
    if (!persistent) {
      // Worth saying out loud: the browser refused to keep the table, so this
      // one dies with the tab.
      drawText(ctx, 'THIS SESSION ONLY', centre, CARD_TOP + SCORES_CARD_HEIGHT + 4, {
        colour: HINT_COLOUR,
        align: 'center',
      });
    }
  }

  if (Math.floor(steps / PROMPT_BLINK_STEPS) % 2 === 0) {
    drawText(ctx, 'PUSH START', centre, PROMPT_Y, { colour: PROMPT_COLOUR, align: 'center' });
  }
}
