/**
 * Attract mode: what the cabinet shows when nobody is playing
 * (docs/DESIGN.md section 4, "Game flow").
 *
 * The demo is **the real simulation**. Nothing here animates a ship: every step
 * is one input frame handed to `stepWorld`, and `stepWorld` decides what happens.
 * So the demo cannot drift from the game; if movement, the shot cap or a
 * collision changes, the attract screen changes with it, and a demo that looks
 * wrong is a bug in the game rather than a bug in the demo.
 *
 * **Who produces that frame is the variant's to say, and it is usually a
 * persona.** A variant that declares autoplay personas is demonstrated by them,
 * one after another: the pilot in `./autoplay.ts`, handed a projection of the
 * demo world exactly as it is in a watched game. A variant that declares none is
 * demonstrated by {@link DEMO_SCRIPT}, a hand-authored input log played through
 * `src/engine/replay.ts` — the mechanism the golden tests use.
 *
 * The script came first, and was hand-authored rather than recorded so that it
 * would not need regenerating whenever enemy behaviour changed. It never did —
 * but only because it never looked. A blind log plays the same sweeps whatever
 * the fleet does, so when behaviour moves underneath it, it goes on "working"
 * while getting worse to watch, and nothing fails. A pilot reads the screen and
 * cannot go stale that way, and the pilots are already trusted further than the
 * script ever was: `npm run validate-packs` flies them to prove a pack can be
 * cleared. What the script had over them was legibility in one place, and a
 * persona has that too — it is eight numbers in the variant's own document.
 *
 * The script stays for the case nothing else can fill. Swarm Remix declares no
 * persona, and a flow built from bare rules has no document to declare one in,
 * and there is nothing honest to fly either with: a made-up default persona is
 * exactly what `src/content/personas.ts` refuses to derive. It is not a leg of
 * the persona cycle, though. Between two personas it would be a fifth player with
 * no name to put on the screen.
 *
 * **The cycle turns on a finished run.** Each persona plays one game from the
 * start, and the next takes over on the step after its game over, so a persona
 * holds the screen for as long as it stays alive — measured on the Classic demo
 * seed, between half a minute and a minute each. {@link DEMO_TURN_STEPS} is a
 * ceiling rather than a budget, and no shipped persona reaches it: it is there so
 * a persona that never dies cannot keep the others off the screen.
 *
 * **Still reproducible.** Every leg starts the same world from the same seed —
 * the same fleet, flown by somebody else — and each pilot draws from a seed of its
 * own that the cycle never advances, so a leg plays identically every time it
 * comes round and the whole cycle repeats exactly. What is given up is the
 * script's fixed length: how long a leg lasts is found out by playing it, and a
 * change to the pilot changes the demo, which is the point.
 */

import type { Persona } from '../content/personas.js';
import type { Rules } from '../content/schema.js';
import type { StageSource } from '../content/stages.js';
import { type Action, frameOf, type InputFrame } from '../engine/input.js';
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
import { createAutopilot, viewOfWorld } from './autoplay.js';
import { drawHighScoreTable, type HighScoreEntry } from './highscores.js';
import { fireKeyFor, KEY, keyLine } from './keys.js';
import { CARD_TOP, drawCentredPanel } from './panel.js';
import { type ControlScheme, DEFAULT_SETTINGS } from './settings.js';

/** Seed the demo world runs on. Fixed, so the attract loop is reproducible. */
export const DEMO_SEED = 'star-swarm-attract';

/**
 * The longest one persona may hold the screen, in simulation steps.
 *
 * Three minutes, which is three times the longest leg measured on the shipped
 * content: a ceiling for a persona that does not die, never the ordinary way a
 * turn ends.
 */
export const DEMO_TURN_STEPS = 3 * 60 * STEP_HZ;

/** One entry of the script: hold these actions for this many steps. */
function hold(steps: number, ...actions: readonly Action[]): FrameRun {
  return [frameOf(...actions), steps];
}

/**
 * The demo pilot of a variant with no personas, as an input log.
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

/** Build the script's {@link Replay}. A normal replay in every respect. */
export function createAttractReplay(seed: string = DEMO_SEED): Replay {
  return {
    version: REPLAY_VERSION,
    seed,
    stepHz: STEP_HZ,
    steps: DEMO_SCRIPT.reduce((total, [, count]) => total + count, 0),
    runs: DEMO_SCRIPT,
  };
}

/**
 * The order the personas take their turns in: the variant's default first, then
 * on through the list in menu order, wrapping round.
 *
 * A default that names nobody on the list starts the list from the top, which is
 * what `defaultPersonaOf` already makes of one (`src/content/personas.ts`).
 */
export function demoRota(
  personas: readonly Persona[],
  first: Persona | undefined,
): readonly Persona[] {
  const start = first === undefined ? -1 : personas.findIndex((persona) => persona.id === first.id);
  if (start <= 0) return personas;
  return [...personas.slice(start), ...personas.slice(0, start)];
}

export interface AttractDemo {
  /** The world on screen. Replaced when the demo loops, so read it every frame. */
  readonly world: World;
  /** Steps into the current leg. */
  readonly step: number;
  /** How many times the demo has started over. */
  readonly loops: number;
  /** The persona flying this leg, or `undefined` while the script is. */
  readonly persona: Persona | undefined;
  /** Advance one simulation step, starting the next leg when this one is over. */
  advance: () => readonly SimEvent[];
  /** Start the next leg from the top. Returns the new world's opening events. */
  restart: () => readonly SimEvent[];
}

export interface AttractDemoOptions {
  readonly rules: Rules;
  /** What plays as each stage. The demo flies the real stage, not a special one. */
  readonly stages?: StageSource;
  /** The difficulty rank, so the demo world runs at the one its stages were resolved at. */
  readonly rank?: string;
  readonly seed?: string;
  /** Who demonstrates the game, in menu order. Empty or absent is the script. */
  readonly personas?: readonly Persona[];
  /** Who flies first: the variant's `defaultPersona`. Absent is the first listed. */
  readonly first?: Persona | undefined;
  /** Overridable so a test can reach the ceiling. Defaults to {@link DEMO_TURN_STEPS}. */
  readonly turnSteps?: number;
  /** Overridable so a test can play a shorter log. Defaults to {@link DEMO_SCRIPT}. */
  readonly replay?: Replay;
}

/** What produces the demo's input for one leg: a persona's pilot, or the script. */
interface DemoDriver {
  readonly persona: Persona | undefined;
  /** True when this leg has run out of input — the log's end, or the ceiling. */
  readonly done: boolean;
  sample: (world: World) => InputFrame;
}

/**
 * The demo loop.
 *
 * A leg ends when its pilot's game is over, when the script runs out or when a
 * persona reaches the ceiling, and the next one starts on the following step, so
 * the cabinet never sits on a dead ship.
 */
export function createAttractDemo(options: AttractDemoOptions): AttractDemo {
  const { rules, seed = DEMO_SEED, turnSteps = DEMO_TURN_STEPS } = options;
  const replay = options.replay ?? createAttractReplay(seed);
  const rota = demoRota(options.personas ?? [], options.first);
  // `exactOptionalPropertyTypes` again: an absent option and an explicit
  // `undefined` are different values to `createWorld`.
  const worldOptions = {
    ...(options.stages === undefined ? {} : { stages: options.stages }),
    ...(options.rank === undefined ? {} : { rank: options.rank }),
  };

  const newWorld = (): World => createWorld({ seed, rules, ...worldOptions });

  const driverFor = (leg: number): DemoDriver => {
    const persona = rota[leg % Math.max(1, rota.length)];
    if (persona === undefined) {
      const source = createReplaySource(replay);
      return {
        persona: undefined,
        get done(): boolean {
          return source.done;
        },
        sample: () => source.sample(),
      };
    }
    // The pilot's own stream, never the world's, and seeded by the persona alone:
    // a leg that came round again with a different seed would be a different run.
    const pilot = createAutopilot({ persona, seed: `${seed}:${persona.id}` });
    return {
      persona,
      get done(): boolean {
        return step >= turnSteps;
      },
      sample: (world) => pilot.sample(viewOfWorld(world)),
    };
  };

  let loops = 0;
  let step = 0;
  let driver = driverFor(0);
  let world = newWorld();

  const restart = (): readonly SimEvent[] => {
    loops += 1;
    step = 0;
    driver = driverFor(loops);
    world = newWorld();
    return world.events;
  };

  return {
    get world(): World {
      return world;
    },
    get step(): number {
      return step;
    },
    get loops(): number {
      return loops;
    },
    get persona(): Persona | undefined {
      return driver.persona;
    },

    advance(): readonly SimEvent[] {
      if (driver.done || world.status === 'game-over') return restart();
      step += 1;
      return stepWorld(world, driver.sample(world));
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
/** Where the first line of keys sits under the card's top, and the pitch after it. */
const KEYS_TOP = 30;
const KEYS_PITCH = 12;
const SCORES_CARD_WIDTH = 176;
const SCORES_CARD_HEIGHT = 70;
/** Row the start prompt sits on, clear of the card and of the ship. */
const PROMPT_Y = 226;

/**
 * The prompt that blinks under both cards: the one thing to do next, in the voice
 * every card's help is written in (`./keys.ts`). It is the only place this screen
 * says how to start, so the title card does not say it a second time.
 */
export const ATTRACT_PROMPT = keyLine([KEY.ok, 'START']);

/**
 * The title card's keys, in the order they are drawn: playing first, then holding
 * and leaving a game, then the settings — where difficulty and autoplay live, and
 * the line that answers "how do I watch it play itself" from the persona tag below.
 *
 * Written with `keyLine` like every card's help, so this screen and the cards a
 * player meets next name a key the same way. It is the one screen that names the
 * fire key, because it is the one that teaches the game; it names the key the
 * player's own control scheme binds.
 */
export function attractKeys(scheme: ControlScheme): readonly string[] {
  return [
    keyLine([KEY.values, 'MOVE'], [fireKeyFor(scheme), 'FIRE']),
    keyLine([KEY.pause, 'PAUSE'], [KEY.exit, 'EXIT']),
    keyLine([KEY.back, 'SETTINGS']),
  ];
}

/** The title card's height: the title, its keys, and air below them. */
export function titleCardHeight(scheme: ControlScheme): number {
  return KEYS_TOP + attractKeys(scheme).length * KEYS_PITCH + 4;
}

export interface AttractOptions {
  /** Steps spent in attract mode, for the card cycle and the blink. */
  readonly steps: number;
  readonly highScores: readonly HighScoreEntry[];
  /** False when the table is session-only, so the screen can say so. */
  readonly persistent?: boolean;
  readonly cardSteps?: number;
  /** The control scheme in force, so the card names the fire key it binds. */
  readonly controls?: ControlScheme;
}

/**
 * Draw the attract overlay over the running demo.
 *
 * The demo itself is drawn by the normal scene and HUD path — this is only the
 * cabinet's furniture on top of it.
 */
export function drawAttract(ctx: CanvasRenderingContext2D, options: AttractOptions): void {
  const {
    steps,
    highScores,
    persistent = true,
    cardSteps = CARD_STEPS,
    controls = DEFAULT_SETTINGS.controls,
  } = options;
  const centre = LOGICAL_WIDTH / 2;

  if (attractCard(steps, cardSteps) === 'title') {
    drawCentredPanel(ctx, centre, CARD_TOP, CARD_WIDTH, titleCardHeight(controls));
    // A one-pixel offset copy under the title: the cheapest arcade shadow, and
    // it keeps the letters legible whatever is behind them.
    drawText(ctx, 'STAR SWARM', centre + 1, CARD_TOP + 13, {
      colour: TITLE_SHADOW,
      align: 'center',
    });
    drawText(ctx, 'STAR SWARM', centre, CARD_TOP + 12, { colour: TITLE_COLOUR, align: 'center' });
    // Pause and exit are the keys a cabinet has none of, and the settings are where
    // autoplay, difficulty and the rest live: a control nobody can find is
    // half-shipped, and the pause card can only name itself once you have already
    // pressed the key that raises it. `M` opens the settings as well; one key is
    // enough to name.
    attractKeys(controls).forEach((line, index) => {
      drawText(ctx, line, centre, CARD_TOP + KEYS_TOP + index * KEYS_PITCH, {
        colour: HINT_COLOUR,
        align: 'center',
      });
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
    drawText(ctx, ATTRACT_PROMPT, centre, PROMPT_Y, { colour: PROMPT_COLOUR, align: 'center' });
  }
}
