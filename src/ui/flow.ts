/**
 * The game-state machine (docs/DESIGN.md section 4, "Game flow").
 *
 * One explicit machine rather than flags spread through the loop. There are eight
 * phases and every transition is named here:
 *
 * ```
 *   variant-select ──chosen──▶ attract ──start──▶ playing ──sim: game-over──▶ game-over
 *   (only with a choice)          │  ▲              │  ▲                          │ timer or button
 *                                 │  │              │  │ timer or button          ▼
 *                        menu ──▶ settings          └──┴── challenge-results   results
 *                                    ▲                     sim: challenge-ended   │
 *                                    └── start/menu ──▶ attract ◀── no ◀── qualifies?
 *                                                          ▲                │ yes
 *                                                          └─ submitted ◀── high-score-entry
 * ```
 *
 * `challenge-results` is the original's between-stage screen, and it is the one
 * phase that goes *back* to `playing`: the stage is over and the next one is
 * already on the field, so the world simply stops being stepped while the card
 * is up. That is also why it is a phase rather than a flag — a machine where
 * "playing" sometimes means "not stepping the world" is the thing this file
 * exists to avoid.
 *
 * The two phases Milestone 3 adds are here for the same reason and no other:
 *
 * - **`variant-select`** lists the games this build offers and starts the chosen
 *   one. It is entered at boot **only when there is more than one**; with exactly
 *   one variant the flow starts in `attract` and this phase is never entered at
 *   all, so a single-game cabinet has no screen to dismiss. Every later game in
 *   the session begins from attract, as a cabinet does; the way back to the list
 *   is the settings screen's `GAME` row.
 * - **`settings`** is the player-settings menu of section 6 layer 3. A flag
 *   saying "attract, but not responding to start" is exactly the shape this file
 *   refuses, so it is a phase: it takes input exclusively and the world behind it
 *   is not stepped.
 *
 * Three properties this file exists to keep:
 *
 * - **The flow subscribes; it never drives the simulation.** It samples input,
 *   hands one frame per step to `stepWorld`, and reads the events that come
 *   back. It writes nothing into a world, and `src/sim/` does not know it exists.
 * - **Time is measured in simulation steps, never the wall clock.** Every timer
 *   here counts steps, so a screen looks the same at the same step on any
 *   machine, and a test can run a phase out by calling `step` in a loop.
 * - **A variant is chosen here and applied everywhere.** The flow holds the
 *   active variant, derives every world from it, and reports a change through
 *   {@link FlowOptions.onVariantChange} so that whoever owns the sprite sheet and
 *   the audio can rebuild them. It does not touch either itself: this layer
 *   subscribes, and a flow that reached for a canvas would be the same mistake as
 *   a sim that did.
 */

import type { Rules } from '../content/schema.js';
import type { StageSource } from '../content/stages.js';
import type { DifficultyPreset } from '../content/variants.js';
import { rankFor } from '../content/variants.js';
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
import {
  createSettingsMenu,
  createVariantMenu,
  type SettingsMenu,
  type VariantMenu,
} from './menus.js';
import { countEvents, EMPTY_STATS, type ResultRow, resultRows, type RunStats } from './results.js';
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from './settings.js';

export type GamePhase =
  | 'variant-select'
  | 'attract'
  | 'settings'
  | 'playing'
  | 'challenge-results'
  | 'game-over'
  | 'results'
  | 'high-score-entry';

/**
 * One game this build can run, as the front end sees it.
 *
 * A structural subset of `ResolvedVariant` from `src/content/variants.ts`, so a
 * resolved variant can be handed straight in and this layer still never learns
 * that a pack, a registry or a file exists.
 */
export interface FlowVariant {
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly demonstration: boolean;
  /** The pack ids it layers, in order. Shown, read-only, in the settings menu. */
  readonly packs: readonly string[];
  readonly rules: Rules;
  readonly presets: readonly DifficultyPreset[];
  readonly defaultPreset: DifficultyPreset;
  /**
   * What plays as each stage at a rank. The rank is a parameter because rank
   * reaches stage resolution as well as the difficulty tables (section 6), so a
   * difficulty preset that only reached `createWorld` would apply half of it.
   */
  stagesFor: (rank?: string) => StageSource;
}

/** How long each waiting phase holds, in simulation steps. Ours, not arcade values. */
export interface FlowTimings {
  /** The GAME OVER banner before the results screen. */
  readonly gameOver: number;
  /** The results screen before the table or attract mode. */
  readonly results: number;
  /** The between-stage card after a challenge stage, before play resumes. */
  readonly challengeResults: number;
  /** Entry times out and submits whatever has been chosen, as a cabinet does. */
  readonly entry: number;
}

export const DEFAULT_TIMINGS: FlowTimings = Object.freeze({
  gameOver: 3 * STEP_HZ,
  results: 7 * STEP_HZ,
  challengeResults: 5 * STEP_HZ,
  entry: 30 * STEP_HZ,
});

interface FlowCommon {
  /** Seed root. Each game seeds from it and its index, so a session is reproducible. */
  readonly seed?: string;
  readonly highScores?: HighScoreBoard;
  /**
   * The player's settings. Omitted means the defaults, unpersisted — which is
   * what a test of the machine on its own wants.
   */
  readonly settings?: SettingsStore;
  readonly timings?: Partial<FlowTimings>;
  /**
   * Overridable so a test can run a short demo log. When given it is used for
   * every variant; otherwise the demo is rebuilt from whichever variant is active,
   * because the demo is the real game and has to be *this* game.
   */
  readonly demo?: AttractDemo;
  /** Replaces the rows the end-of-game results screen shows. */
  readonly resultRowsFor?: (stats: RunStats) => readonly ResultRow[];
  /**
   * Fighters a game starts with, from the cabinet settings. Passed to every
   * world the flow creates, because it selects the extra-life thresholds as well
   * as the reserve count. Omitted means the rules' own default.
   */
  readonly lives?: number;
  /**
   * Called when the active variant changes, with the one now in force.
   *
   * The flow rebuilds the rules, the stages and the attract demo itself. Whatever
   * else a variant decides — the sprite sheet, the palette, the event-to-sound
   * map — belongs to whoever owns those, and this is how they hear about it.
   */
  readonly onVariantChange?: (variant: FlowVariant) => void;
}

/**
 * Either one game, stated as its rules, or a list to choose from.
 *
 * A union rather than two optional fields so that stating both is a compile error
 * rather than a silent precedence rule. The `rules` form is one unnamed variant —
 * that is exactly what it always was — and the selector is never entered for it.
 */
type FlowGame =
  | { readonly rules: Rules; readonly stages?: StageSource; readonly variants?: never }
  | {
      readonly variants: readonly FlowVariant[];
      readonly rules?: never;
      readonly stages?: never;
    };

export type FlowOptions = FlowCommon & FlowGame;

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
  /** Every game this build offers, in selector order. */
  readonly variants: readonly FlowVariant[];
  /** The game in force. Every world the flow creates comes from it. */
  readonly variant: FlowVariant;
  /** The difficulty rank the next game will run at — the preset, resolved. */
  readonly rank: string;
  /** The player's settings, as they stand. */
  readonly settings: Settings;
  /** The start-up list, present only during `variant-select`. */
  readonly variantMenu: VariantMenu<FlowVariant> | undefined;
  /** The settings rows, present only during `settings`. */
  readonly settingsMenu: SettingsMenu | undefined;
  /** Rows the results screen shows for the run just played. */
  resultRows: () => readonly ResultRow[];
  /** Advance exactly one simulation step with one input frame. */
  step: (frame: InputFrame) => FlowStep;
}

/**
 * The one variant of a flow built from bare rules.
 *
 * Its presets are derived from the ranks the rules declare, so the difficulty
 * setting means the same thing whether a variant document named the presets or
 * not. It has no name, because nothing shows one: the selector is not entered.
 */
function variantOfRules(rules: Rules, stages: StageSource | undefined): FlowVariant {
  const presets: readonly DifficultyPreset[] = Object.keys(rules.difficulty.ranks).map((rank) => ({
    id: rank,
    label: rank,
    rank,
  }));
  const fallback: DifficultyPreset = {
    id: rules.difficulty.defaultRank,
    label: rules.difficulty.defaultRank,
    rank: rules.difficulty.defaultRank,
  };
  return {
    id: 'default',
    name: rules.name ?? rules.id,
    demonstration: false,
    packs: [],
    rules,
    presets: presets.length > 0 ? presets : [fallback],
    defaultPreset:
      presets.find((preset) => preset.rank === rules.difficulty.defaultRank) ??
      presets[0] ??
      fallback,
    stagesFor: () => stages ?? { stageFor: () => undefined },
  };
}

/**
 * Build the machine.
 *
 * It starts in attract, as a cabinet does with the coin door shut — unless this
 * build offers more than one game, in which case it starts by asking which.
 */
export function createGameFlow(options: FlowOptions): GameFlow {
  const { seed = 'star-swarm', resultRowsFor = resultRows } = options;
  const livesOption = options.lives === undefined ? {} : { lives: options.lives };
  const timings: FlowTimings = { ...DEFAULT_TIMINGS, ...options.timings };
  const highScores = options.highScores ?? createHighScoreBoard();

  const variants: readonly FlowVariant[] = options.variants ?? [
    variantOfRules(options.rules, options.stages),
  ];
  const first = variants[0];
  if (first === undefined) throw new Error('a flow needs at least one variant');

  const settingsStore = options.settings;
  const readSettings = (): Settings => settingsStore?.value ?? DEFAULT_SETTINGS;
  let overrides: Partial<Settings> = {};
  const settingsValue = (): Settings => ({ ...readSettings(), ...overrides });
  const writeSettings = (patch: Partial<Settings>): void => {
    if (settingsStore === undefined) overrides = { ...overrides, ...patch };
    else settingsStore.update(patch);
  };

  // The remembered variant, if it is still installed. A settings document
  // outlives the build it was written against, so an id nobody offers any more
  // reads as "the first one" rather than as a failure.
  const remembered = variants.find((variant) => variant.id === settingsValue().variant);
  let variant: FlowVariant = remembered ?? first;

  const rankOf = (): string => rankFor(variant, settingsValue().difficulty);

  /**
   * Spread rather than passed straight through: `exactOptionalPropertyTypes` is
   * on, so `stages: undefined` is not the same as leaving it out.
   */
  const stageOption = (): { readonly stages: StageSource } => ({
    stages: variant.stagesFor(rankOf()),
  });

  const buildDemo = (): AttractDemo =>
    options.demo ??
    createAttractDemo({
      rules: variant.rules,
      seed: `${seed}:attract`,
      ...stageOption(),
    });

  let demo = buildDemo();

  let phase: GamePhase = variants.length > 1 ? 'variant-select' : 'attract';
  let steps = 0;
  let phaseSteps = 0;
  let games = 0;
  let stats: RunStats = EMPTY_STATS;
  let game: World | undefined;
  let entry: InitialsEntry | undefined;
  let entryRank: number | undefined;
  let lastRank: number | undefined;
  let previous: InputFrame = 0;
  let variantMenu: VariantMenu<FlowVariant> | undefined;
  let settingsMenu: SettingsMenu | undefined;
  /** Where the settings screen returns to. */
  let settingsFrom: GamePhase = 'attract';

  const enter = (next: GamePhase): void => {
    phase = next;
    phaseSteps = 0;
  };

  /**
   * Put a variant in force: rebuild the demo, remember the choice, and tell
   * whoever owns the presentation. One function, because the selector and the
   * settings menu's `GAME` row must not be two ways of doing this.
   */
  const selectVariant = (next: FlowVariant): void => {
    const changed = next.id !== variant.id;
    variant = next;
    writeSettings({ variant: next.id });
    demo = buildDemo();
    if (changed) options.onVariantChange?.(next);
  };

  /** Start a game. Its opening events are this step's events. */
  const startGame = (): readonly SimEvent[] => {
    games += 1;
    const world = createWorld({
      seed: `${seed}:game-${String(games)}`,
      rules: variant.rules,
      rank: rankOf(),
      ...stageOption(),
      ...livesOption,
    });
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

  const openSettings = (from: GamePhase): void => {
    settingsFrom = from;
    settingsMenu = createSettingsMenu({
      read: settingsValue,
      write: (patch) => {
        // A `GAME` row change is a variant change, and has to go through the one
        // function that rebuilds everything hanging off it.
        const chosen =
          patch.variant === undefined
            ? undefined
            : variants.find((candidate) => candidate.id === patch.variant);
        if (chosen !== undefined) selectVariant(chosen);
        else writeSettings(patch);
      },
      variants,
      active: () => variant,
    });
    enter('settings');
  };

  const openVariantSelect = (): void => {
    variantMenu = createVariantMenu({ variants, selected: variant.id });
    enter('variant-select');
  };

  if (phase === 'variant-select') openVariantSelect();

  return {
    get phase(): GamePhase {
      return phase;
    },
    get world(): World {
      // In attract — and on the two menu screens, which sit over it — the demo is
      // what is on screen; the finished run stays on screen behind the game-over,
      // results and entry cards.
      if (phase === 'attract' || phase === 'settings' || phase === 'variant-select') {
        return demo.world;
      }
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
    get demo(): AttractDemo {
      return demo;
    },
    variants,
    get variant(): FlowVariant {
      return variant;
    },
    get rank(): string {
      return rankOf();
    },
    get settings(): Settings {
      return settingsValue();
    },
    get variantMenu(): VariantMenu<FlowVariant> | undefined {
      return phase === 'variant-select' ? variantMenu : undefined;
    },
    get settingsMenu(): SettingsMenu | undefined {
      return phase === 'settings' ? settingsMenu : undefined;
    },

    resultRows: () => resultRowsFor(stats),

    step(frame: InputFrame): FlowStep {
      const previousPhase = phase;
      let events: readonly SimEvent[] = [];

      switch (phase) {
        case 'variant-select': {
          const menu = variantMenu;
          if (menu === undefined) {
            enter('attract');
            break;
          }
          if (wasPressed(previous, frame, 'left')) menu.previous();
          if (wasPressed(previous, frame, 'right')) menu.next();
          if (wasPressed(previous, frame, 'menu')) {
            openSettings('variant-select');
            break;
          }
          // Fire chooses and leaves the cabinet in attract; start chooses and
          // plays, because a player who has already pressed start means it.
          const play = wasPressed(previous, frame, 'start');
          if (play || wasPressed(previous, frame, 'fire')) {
            selectVariant(menu.chosen);
            variantMenu = undefined;
            if (play) events = startGame();
            else enter('attract');
          } else {
            // The demo runs behind the list, so the screen is never still.
            events = demo.advance();
          }
          break;
        }

        case 'settings': {
          const menu = settingsMenu;
          if (menu === undefined) {
            enter('attract');
            break;
          }
          if (wasPressed(previous, frame, 'left')) menu.adjust(-1);
          if (wasPressed(previous, frame, 'right')) menu.adjust(1);
          if (wasPressed(previous, frame, 'fire')) menu.next();
          if (wasPressed(previous, frame, 'menu') || wasPressed(previous, frame, 'start')) {
            settingsMenu = undefined;
            if (settingsFrom === 'variant-select') openVariantSelect();
            else enter('attract');
            break;
          }
          events = demo.advance();
          break;
        }

        case 'attract': {
          // The demo world takes its input from the log, never from the player;
          // the only things the player's frame can do here are start a game and
          // open the settings screen.
          if (wasPressed(previous, frame, 'start')) {
            events = startGame();
          } else if (wasPressed(previous, frame, 'menu')) {
            openSettings('attract');
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
          // Game over first: a challenge stage cannot end on the same step as a
          // game over, but if the two ever met, the run being over wins.
          if (events.some((event) => event.type === 'game-over')) {
            enter('game-over');
          } else if (events.some((event) => event.type === 'challenge-ended')) {
            enter('challenge-results');
          }
          break;
        }

        case 'challenge-results': {
          // Back to play, on the stage the world already rolled on to.
          if (phaseSteps + 1 >= timings.challengeResults || pressedAny(frame)) enter('playing');
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
        demo: phase === 'attract' || phase === 'settings' || phase === 'variant-select',
      };
    },
  };
}
