/**
 * The game-state machine (docs/DESIGN.md section 4, "Game flow").
 *
 * One explicit machine rather than flags spread through the loop. There are five
 * phases and every transition is named here:
 *
 * ```
 *   attract ──start──▶ playing ──sim: game-over──▶ game-over
 *      ▲                                              │ timer or button
 *      │                                              ▼
 *      ├────────────────── no ◀── qualifies? ◀───── results
 *      │                            │ yes
 *      └──── submitted ◀──── high-score-entry ◀──────┘
 * ```
 *
 * Two properties this file exists to keep:
 *
 * - **The flow subscribes; it never drives the simulation.** It samples input,
 *   hands one frame per step to `stepWorld`, and reads the events that come
 *   back. It writes nothing into a world, and `src/sim/` does not know it exists.
 * - **Time is measured in simulation steps, never the wall clock.** Every timer
 *   here counts steps, so a screen looks the same at the same step on any
 *   machine, and a test can run a phase out by calling `step` in a loop.
 *
 * Seams for work that lands after this (named in the PR body):
 *
 * - **Challenge-stage results.** {@link FlowOptions.resultRowsFor} replaces the
 *   rows the results screen shows, so challenge totals are appended there rather
 *   than by editing the screen. {@link RunStats} is where new counters go.
 * - **Stage badges.** `src/ui/hud.ts` already draws them from the stage number;
 *   the flow passes the live world's stage through unchanged.
 * - **Extra lives.** The sim raises `extra-life`; {@link RunStats.extraLives}
 *   counts them, so the rule can change without touching a screen.
 */

import type { Rules } from '../content/schema.js';
import type { StageSource } from '../content/stages.js';
import { type InputFrame, wasPressed } from '../engine/input.js';
import { STEP_HZ } from '../engine/loop.js';
import type { SimEvent } from '../sim/events.js';
import { createWorld, stepWorld, type World } from '../sim/world.js';
import { type AttractDemo, createAttractDemo } from './attract.js';
import {
  createHighScoreBoard,
  createInitialsEntry,
  type HighScoreBoard,
  type InitialsEntry,
} from './highscores.js';
import { countEvents, EMPTY_STATS, type ResultRow, resultRows, type RunStats } from './results.js';

export type GamePhase = 'attract' | 'playing' | 'game-over' | 'results' | 'high-score-entry';

/** How long each waiting phase holds, in simulation steps. Ours, not arcade values. */
export interface FlowTimings {
  /** The GAME OVER banner before the results screen. */
  readonly gameOver: number;
  /** The results screen before the table or attract mode. */
  readonly results: number;
  /** Entry times out and submits whatever has been chosen, as a cabinet does. */
  readonly entry: number;
}

export const DEFAULT_TIMINGS: FlowTimings = Object.freeze({
  gameOver: 3 * STEP_HZ,
  results: 7 * STEP_HZ,
  entry: 30 * STEP_HZ,
});

export interface FlowOptions {
  /** The loaded pack's rules. Handed to every world the flow creates. */
  readonly rules: Rules;
  /**
   * What plays as each stage, from `createStageSource` in `src/content/`. Handed
   * to every world the flow creates, the attract demo's included — the demo is
   * the real game, so it flies the real stage. Omitted means a world with no
   * enemies, which is what a test of the front end on its own wants.
   */
  readonly stages?: StageSource;
  /** Seed root. Each game seeds from it and its index, so a session is reproducible. */
  readonly seed?: string;
  readonly highScores?: HighScoreBoard;
  readonly timings?: Partial<FlowTimings>;
  /** Overridable so a test can run a short demo log. */
  readonly demo?: AttractDemo;
  /** Seam: challenge-stage results append their rows here. */
  readonly resultRowsFor?: (stats: RunStats) => readonly ResultRow[];
}

/** What one call to {@link GameFlow.step} did. */
export interface FlowStep {
  readonly phase: GamePhase;
  /** The phase before this step, so a subscriber can react to a transition. */
  readonly previousPhase: GamePhase;
  /** Events from whichever world advanced — the demo's in attract, the player's in play. */
  readonly events: readonly SimEvent[];
  /** True while the world on screen is the attract demo and not a player's game. */
  readonly demo: boolean;
}

export interface GameFlow {
  readonly phase: GamePhase;
  /** The world on screen: the demo's in attract, otherwise the run just played. */
  readonly world: World;
  /** Totals for the current or most recent run. */
  readonly stats: RunStats;
  /** Steps since the flow was created. Monotonic across games. */
  readonly steps: number;
  /** Steps spent in the current phase. Drives every blink and timeout. */
  readonly phaseSteps: number;
  readonly highScores: HighScoreBoard;
  /** Present only during `high-score-entry`. */
  readonly entry: InitialsEntry | undefined;
  /** The rank being entered, present only during `high-score-entry`. */
  readonly entryRank: number | undefined;
  /** Rank taken by the most recent submission, for highlighting a row. */
  readonly lastRank: number | undefined;
  readonly demo: AttractDemo;
  /** Rows the results screen shows for the run just played. */
  resultRows: () => readonly ResultRow[];
  /** Advance exactly one simulation step with one input frame. */
  step: (frame: InputFrame) => FlowStep;
}

/**
 * Build the machine.
 *
 * It starts in attract, as a cabinet does with the coin door shut: nothing is
 * playing until `start` is pressed.
 */
export function createGameFlow(options: FlowOptions): GameFlow {
  const { rules } = options;
  /**
   * Spread rather than passed straight through: `exactOptionalPropertyTypes` is
   * on, so `stages: undefined` is not the same as leaving it out.
   */
  const stageOption = options.stages === undefined ? {} : { stages: options.stages };
  const { seed = 'star-swarm', resultRowsFor = resultRows } = options;
  const timings: FlowTimings = { ...DEFAULT_TIMINGS, ...options.timings };
  const highScores = options.highScores ?? createHighScoreBoard();
  const demo =
    options.demo ?? createAttractDemo({ rules, seed: `${seed}:attract`, ...stageOption });

  let phase: GamePhase = 'attract';
  let steps = 0;
  let phaseSteps = 0;
  let games = 0;
  let stats: RunStats = EMPTY_STATS;
  let game: World | undefined;
  let entry: InitialsEntry | undefined;
  let entryRank: number | undefined;
  let lastRank: number | undefined;
  let previous: InputFrame = 0;

  const enter = (next: GamePhase): void => {
    phase = next;
    phaseSteps = 0;
  };

  /** Start a game. Its opening events are this step's events. */
  const startGame = (): readonly SimEvent[] => {
    games += 1;
    const world = createWorld({ seed: `${seed}:game-${String(games)}`, rules, ...stageOption });
    game = world;
    stats = { ...EMPTY_STATS, stage: world.stage };
    lastRank = undefined;
    enter('playing');
    return world.events;
  };

  /** Leave the results screen: the table if the score earned a place, else attract. */
  const afterResults = (): void => {
    const rank = highScores.rankFor(stats.score);
    if (rank === undefined) {
      enter('attract');
      return;
    }
    entryRank = rank;
    entry = createInitialsEntry();
    enter('high-score-entry');
  };

  /** Commit the initials and go back to attract. */
  const submitEntry = (): void => {
    const value = entry?.value ?? '';
    lastRank = highScores.submit(value, stats.score, stats.stage);
    entry = undefined;
    entryRank = undefined;
    enter('attract');
  };

  /** Any button: what skips a screen a player has finished reading. */
  const pressedAny = (frame: InputFrame): boolean =>
    wasPressed(previous, frame, 'start') || wasPressed(previous, frame, 'fire');

  return {
    get phase(): GamePhase {
      return phase;
    },
    get world(): World {
      // In attract the demo is what is on screen; the finished run stays on
      // screen behind the game-over, results and entry cards.
      if (phase === 'attract') return demo.world;
      return game ?? demo.world;
    },
    get stats(): RunStats {
      return stats;
    },
    get steps(): number {
      return steps;
    },
    get phaseSteps(): number {
      return phaseSteps;
    },
    highScores,
    get entry(): InitialsEntry | undefined {
      return entry;
    },
    get entryRank(): number | undefined {
      return entryRank;
    },
    get lastRank(): number | undefined {
      return lastRank;
    },
    demo,

    resultRows: () => resultRowsFor(stats),

    step(frame: InputFrame): FlowStep {
      const previousPhase = phase;
      let events: readonly SimEvent[] = [];

      switch (phase) {
        case 'attract': {
          // The demo world takes its input from the log, never from the player;
          // the only thing the player's frame can do here is start a game.
          if (wasPressed(previous, frame, 'start')) {
            events = startGame();
          } else {
            events = demo.advance();
          }
          break;
        }

        case 'playing': {
          const world = game;
          if (world === undefined) {
            enter('attract');
            break;
          }
          events = stepWorld(world, frame);
          stats = countEvents(stats, events);
          if (events.some((event) => event.type === 'game-over')) enter('game-over');
          break;
        }

        case 'game-over': {
          if (phaseSteps + 1 >= timings.gameOver || pressedAny(frame)) enter('results');
          break;
        }

        case 'results': {
          if (phaseSteps + 1 >= timings.results || pressedAny(frame)) afterResults();
          break;
        }

        case 'high-score-entry': {
          const live = entry;
          if (live === undefined) {
            enter('attract');
            break;
          }
          if (wasPressed(previous, frame, 'left')) live.previous();
          if (wasPressed(previous, frame, 'right')) live.next();
          if (wasPressed(previous, frame, 'fire')) live.commit();
          if (wasPressed(previous, frame, 'start')) {
            // Start ends entry early, with whatever letters are showing.
            while (!live.done) live.commit();
          }
          if (live.done || phaseSteps + 1 >= timings.entry) submitEntry();
          break;
        }
      }

      previous = frame;
      steps += 1;
      // A phase that changed this step starts its own count at zero; one that
      // did not gets the step it just spent.
      if (phase === previousPhase) phaseSteps += 1;

      return {
        phase,
        previousPhase,
        events,
        demo: phase === 'attract',
      };
    },
  };
}
