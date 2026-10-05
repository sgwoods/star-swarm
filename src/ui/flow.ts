/**
 * The game-state machine (docs/DESIGN.md section 4, "Game flow").
 *
 * One explicit machine rather than flags spread through the loop. There are twelve
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
 *
 *   settings ──L/R on PACKS──▶ packs ──keep or cancel──▶ settings
 *   settings ──L/R on STAGES─▶ stages ─keep or cancel──▶ settings
 *
 *   playing ──pause──▶ paused ──pause──▶ playing
 *      │                  │  ▲
 *      └──── exit ────────┴──┴── exit-confirm ──exit chosen──▶ attract (the run is gone)
 * ```
 *
 * `challenge-results` is the original's between-stage screen, and it is the one
 * phase that goes *back* to `playing`: the stage is over and the next one is
 * already on the field, so the world simply stops being stepped while the card
 * is up. That is also why it is a phase rather than a flag — a machine where
 * "playing" sometimes means "not stepping the world" is the thing this file
 * exists to avoid.
 *
 * The two phases the variant work added are here for the same reason and no other:
 *
 * - **`variant-select`** lists the games this build offers and lands on the
 *   chosen one's attract screen. It is entered at boot **only when there is more than one**; with exactly
 *   one variant the flow starts in `attract` and this phase is never entered at
 *   all, so a single-game cabinet has no screen to dismiss. Every later game in
 *   the session begins from attract, as a cabinet does; the way back to the list
 *   is the settings screen's `GAME` row.
 * - **`settings`** is the player-settings menu of section 6 layer 3. A flag
 *   saying "attract, but not responding to start" is exactly the shape this file
 *   refuses, so it is a phase: it takes input exclusively and the world behind it
 *   is not stepped.
 * - **`packs`** and **`stages`** are the two cards that settings screen opens —
 *   the pack manager and the stage-sequence editor (`./packs.ts`) — and they are
 *   phases for the same reason: "settings, but showing another card" is a flag.
 *   Each edits a draft and returns to `settings` either way, keeping the draft or
 *   throwing it away; the settings cursor is where it was.
 *
 * The two after them are the pause and the way out, and they are phases for the
 * third time for the same reason — a boolean `paused` beside `phase` is "playing,
 * but not stepping the world", which is the shape above:
 *
 * - **`paused`** is the game held. Pausing is a flow concern and nothing else:
 *   `src/sim/` has no notion of being paused, it is simply not stepped, and the
 *   frame that carried the press was stepped before the phase changed. So the
 *   simulation sees exactly the frames it would have seen had nobody paused —
 *   the resume frame is the flow's, the way the start frame in attract is — and a
 *   resumed run continues bit for bit. `tests/unit/flow.test.ts` asserts that
 *   against an unpaused run of the same frames.
 * - **`exit-confirm`** asks before a run in progress is thrown away, and it is
 *   entered **through** the pause: `exit` stops the game on the frame it is
 *   pressed and the card comes up over a world that is no longer moving, so the
 *   question is never answered under fire. Cancelling lands in `paused`, which is
 *   where an ordinary pause lands, so resuming is one path and not two. Choosing
 *   to leave discards the run — the score does not reach the high-score table —
 *   which is why the card says the score out loud and says when it would have
 *   taken a place. Nothing here is silent, and nothing here is one keypress.
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
 *
 * And one that the pack manager added: **the variant in force is the chosen
 * variant as the player composed it.** The selector and the `GAME` row choose a
 * *base* — a variant as its document declares it — and the player's stored pack
 * list and stage order for that base are composed over it
 * ({@link FlowCommon.composer}). A stored choice that no longer composes — a pack
 * this build does not install, a stage the list no longer holds — is set aside,
 * not repaired: the base plays, the settings rows say so, and the stored choice
 * stays in the document for the day it loads again.
 */

import type { Persona } from '../content/personas.js';
import { personaOf } from '../content/personas.js';
import { combatStageNumber } from '../content/rules.js';
import type { Rules } from '../content/schema.js';
import type { StageSource } from '../content/stages.js';
import type { DifficultyPreset, VariantChoice } from '../content/variants.js';
import { rankFor } from '../content/variants.js';
import {
  type Action,
  ACTION_BIT,
  EMPTY_FRAME,
  type InputFrame,
  isDown,
  wasPressed,
} from '../engine/input.js';
import { STEP_HZ } from '../engine/loop.js';
import type { SimEvent } from '../sim/events.js';
import { createWorld, stepWorld, type World } from '../sim/world.js';
import { type AttractDemo, createAttractDemo } from './attract.js';
import { createAutopilot, type Pilot, viewOfWorld } from './autoplay.js';
import {
  createHighScoreBoard,
  createInitialsEntry,
  type HighScoreBoard,
  type InitialsEntry,
} from './highscores.js';
import {
  createSettingsMenu,
  createVariantMenu,
  type EditorCard,
  type SettingsMenu,
  type VariantMenu,
} from './menus.js';
import { cardPress } from './keys.js';
import {
  createPackEditor,
  createStageEditor,
  type PackComposer,
  type PackEditor,
  type StageEditor,
  type Verdict,
} from './packs.js';
import { createExitConfirm, type ExitConfirm } from './pause.js';
import { countEvents, EMPTY_STATS, type ResultRow, resultRows, type RunStats } from './results.js';
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from './settings.js';

export type GamePhase =
  | 'variant-select'
  | 'attract'
  | 'settings'
  | 'packs'
  | 'stages'
  | 'playing'
  | 'paused'
  | 'exit-confirm'
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
  /** The pack ids it layers, in order: the player's list when one is in force. */
  readonly packs: readonly string[];
  /** The combat stages' order when a player stated one, else `undefined`. */
  readonly stages?: readonly string[] | undefined;
  readonly rules: Rules;
  readonly presets: readonly DifficultyPreset[];
  readonly defaultPreset: DifficultyPreset;
  /**
   * The autoplay personas this game offers, in menu order. Empty means this game
   * cannot be watched playing itself, and the `AUTOPLAY` row is not drawn.
   */
  readonly personas: readonly Persona[];
  /** Which persona the row lands on first, if the document named one. */
  readonly defaultPersona?: Persona | undefined;
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
  /**
   * What composes a variant from the player's stored pack list and stage order,
   * and judges a draft on the pack manager's cards — `src/ui/compose.ts` over the
   * packs this build loaded.
   *
   * Omitted means there is nothing to compose with: every variant plays as its
   * document declares it, the `PACKS` row reads as it always did and the `STAGES`
   * row is not shown. That is what a test of the machine on its own wants.
   */
  readonly composer?: PackComposer<FlowVariant>;
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
  /** Every game this build offers, in selector order, each as its document declares it. */
  readonly variants: readonly FlowVariant[];
  /**
   * The game in force: the chosen variant, composed from the player's stored pack
   * list and stage order when they compose. Every world the flow creates comes
   * from it.
   */
  readonly variant: FlowVariant;
  /**
   * Why the stored pack list or stage order for the chosen variant is not what is
   * playing, or `undefined` when it is (or nothing is stored). The verdict the
   * pack manager would give it.
   */
  readonly setAside: Verdict | undefined;
  /** The difficulty rank the next game will run at — the preset, resolved. */
  readonly rank: string;
  /**
   * The persona now flying, or `undefined` when a human is.
   *
   * Resolved from the settings against the active variant on every read, so a
   * persona the current game does not offer reads as off rather than as stale.
   */
  readonly autoplay: Persona | undefined;
  /**
   * Who is flying the world on screen, when it is not a human: the demo's persona
   * while the demo is on screen, the autoplay persona otherwise. `undefined` for a
   * human, and for the script, which is nobody.
   */
  readonly flying: Persona | undefined;
  /** The player's settings, as they stand. */
  readonly settings: Settings;
  /** The start-up list, present only during `variant-select`. */
  readonly variantMenu: VariantMenu<FlowVariant> | undefined;
  /** The settings rows, present only during `settings`. */
  readonly settingsMenu: SettingsMenu | undefined;
  /** The pack manager's draft, present only during `packs`. */
  readonly packEditor: PackEditor | undefined;
  /** The stage-sequence editor's draft, present only during `stages`. */
  readonly stageEditor: StageEditor | undefined;
  /** The exit confirmation's cursor, present only during `exit-confirm`. */
  readonly exitConfirm: ExitConfirm | undefined;
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
    // Bare rules declare no personas: a persona is a variant document's, and a
    // flow built from rules alone has no document behind it.
    personas: [],
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

  const composer = options.composer;

  /** The player's stored pack list and stage order for one variant, as ids. */
  const choiceOf = (chosen: FlowVariant): VariantChoice => {
    const settings = settingsValue();
    return { packs: settings.packs[chosen.id], stages: settings.stages[chosen.id] };
  };

  /**
   * A variant as the player composed it, and why the stored choice is set aside
   * when it is. Nothing stored, or nothing to compose with, is the base itself.
   *
   * Strict on purpose, like `personaOf`: a stored list that will not compose
   * plays the base whole, not some part of the list that happens to load —
   * silently playing a mix nobody chose is worse than playing the game as shipped
   * and saying so.
   */
  const composeFor = (
    chosen: FlowVariant,
  ): { readonly variant: FlowVariant; readonly setAside: Verdict | undefined } => {
    const choice = choiceOf(chosen);
    if (composer === undefined || (choice.packs === undefined && choice.stages === undefined)) {
      return { variant: chosen, setAside: undefined };
    }
    const result = composer.compose(chosen.id, choice);
    return result.variant === undefined
      ? { variant: chosen, setAside: result.verdict }
      : { variant: result.variant, setAside: undefined };
  };

  // The remembered variant, if it is still installed. A settings document
  // outlives the build it was written against, so an id nobody offers any more
  // reads as "the first one" rather than as a failure.
  const remembered = variants.find((variant) => variant.id === settingsValue().variant);
  /** The variant chosen, as its document declares it: what the selector lists. */
  let base: FlowVariant = remembered ?? first;
  const composed = composeFor(base);
  /** The variant in force: {@link base} as the player composed it. */
  let variant: FlowVariant = composed.variant;
  let setAside: Verdict | undefined = composed.setAside;

  const rankOf = (): string => rankFor(variant, settingsValue().difficulty);

  /**
   * Spread rather than passed straight through: `exactOptionalPropertyTypes` is
   * on, so `stages: undefined` is not the same as leaving it out.
   */
  const stageOption = (): { readonly stages: StageSource } => ({
    stages: variant.stagesFor(rankOf()),
  });

  /**
   * The demo is the real game, so it has to be *this* game: the active variant's
   * rules, at the rank now in force, flown by that variant's own personas — its
   * `defaultPersona` first — or by the script when it declares none
   * (`./attract.ts`). Which personas exist is read from the variant and nowhere
   * else, so nothing here names one.
   */
  let demoRank: string | undefined;
  const buildDemo = (): AttractDemo => {
    demoRank = rankOf();
    return (
      options.demo ??
      createAttractDemo({
        rules: variant.rules,
        seed: `${seed}:attract`,
        rank: demoRank,
        personas: variant.personas,
        first: variant.defaultPersona,
        ...stageOption(),
      })
    );
  };

  let demo = buildDemo();

  /**
   * Rebuild the demo if the rank it was built on is no longer the one in force.
   *
   * Called when the settings screen closes rather than when the row changes: rank
   * reaches stage resolution, so a demo built on another rank can fly the wrong
   * entry sequence — but rebuilding on every press of a direction would restart
   * the attract world under the player while they are still choosing.
   */
  const refreshDemo = (): void => {
    if (rankOf() !== demoRank) demo = buildDemo();
  };

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
  /**
   * The previous frame **as the human produced it**, kept beside `previous`.
   *
   * `previous` is the frame the machine acted on, which under autoplay is the
   * pilot's. Telling "a human just pressed fire" from "the pilot is holding fire"
   * needs the other history, and conflating the two is how autoplay would be
   * impossible to stop.
   */
  let previousHuman: InputFrame = 0;
  let variantMenu: VariantMenu<FlowVariant> | undefined;
  let settingsMenu: SettingsMenu | undefined;
  let confirm: ExitConfirm | undefined;
  let packEditor: PackEditor | undefined;
  let stageEditor: StageEditor | undefined;
  /** Where the settings screen returns to. */
  let settingsFrom: GamePhase = 'attract';

  /* -- autoplay ----------------------------------------------------------- */

  /**
   * The persona now flying, resolved from the settings against the active
   * variant. `undefined` is a human at the controls, and an id this variant does
   * not offer resolves to `undefined` rather than to the first persona
   * (`personaOf`): watching the cabinet play itself as somebody else is worse
   * than not watching.
   */
  const personaNow = (): Persona | undefined => personaOf(variant, settingsValue().autoplay);

  /**
   * The pilot, and the persona it was built for.
   *
   * Rebuilt when the persona changes and when a game starts — the second so that
   * every game gets its own seeded stream, which is what makes "same seed, same
   * persona, same run" a property of a *game* rather than of a whole session.
   */
  let pilot: Pilot | undefined;
  let pilotPersona: string | undefined;

  const pilotFor = (persona: Persona | undefined): Pilot | undefined => {
    if (persona === undefined) {
      pilot = undefined;
      pilotPersona = undefined;
      return undefined;
    }
    if (pilot === undefined || pilotPersona !== persona.id) {
      pilot = createAutopilot({
        persona,
        // The pilot's own stream, never the world's: which way a persona dithers
        // must not change what the simulation computes.
        seed: `${seed}:autoplay:${persona.id}:${String(games)}`,
      });
      pilotPersona = persona.id;
    }
    return pilot;
  };

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
    if (next.id === base.id) return;
    base = next;
    writeSettings({ variant: next.id });
    const composition = composeFor(next);
    variant = composition.variant;
    setAside = composition.setAside;
    demo = buildDemo();
    options.onVariantChange?.(variant);
  };

  /**
   * Put the stored choice for the chosen variant back in force, after a card kept
   * one. The same consequences as {@link selectVariant} — a fresh demo, and
   * whoever owns the presentation told — because a pack list changes the sprites,
   * the sounds and the palette exactly as a different game does.
   */
  const recompose = (): void => {
    const composition = composeFor(base);
    setAside = composition.setAside;
    if (composition.variant === variant) return;
    variant = composition.variant;
    demo = buildDemo();
    options.onVariantChange?.(variant);
  };

  /** A per-variant record from the settings with one variant's list replaced, or removed. */
  const withList = (
    record: Readonly<Record<string, readonly string[]>>,
    list: readonly string[] | undefined,
  ): Readonly<Record<string, readonly string[]>> => {
    const next: Record<string, readonly string[]> = { ...record };
    if (list === undefined) delete next[base.id];
    else next[base.id] = list;
    return next;
  };

  /**
   * Open the pack manager or the stage-sequence editor over the chosen variant.
   *
   * Both start from what is **stored**, not from what is in force: when a stored
   * choice is set aside, the card is where the player sees it and mends it — a
   * missing pack is a row of its own on the pack card, and every verdict on the
   * stage card names what the stored pack list lacks.
   */
  const openEditor = (card: EditorCard): void => {
    if (composer === undefined) return;
    const { packs, stages } = choiceOf(base);
    const chosen = base;
    if (card === 'packs') {
      packEditor = createPackEditor({
        installed: composer.installed,
        start: packs ?? chosen.packs,
        own: chosen.packs,
        judge: (draft) => composer.judgePacks(chosen.id, draft, stages),
      });
      enter('packs');
      return;
    }
    // The challenge cadence is the rules', so the rules in force number the rows.
    const rules = variant.rules;
    stageEditor = createStageEditor({
      options: composer.stageOptions(chosen.id, packs),
      own: composer.ownStages(chosen.id, packs, rankOf()),
      stored: stages,
      numberOf: (position) => combatStageNumber(rules, position),
      judge: (draft) => composer.compose(chosen.id, { packs, stages: draft }).verdict,
    });
    enter('stages');
  };

  /** Start a game. Its opening events are this step's events. */
  const startGame = (): readonly SimEvent[] => {
    games += 1;
    // A fresh pilot per game, so its seed carries the game index and one run's
    // dithering cannot lean into the next.
    pilot = undefined;
    pilotPersona = undefined;
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

  /**
   * Has a human taken the controls?
   *
   * **The fighter's own controls, in the phase where the fighter is live** — and
   * `start` from attract, which unambiguously means "my game now". That is the whole
   * of it, and the narrowness is the point: every other phase is a *cursor's*, and a
   * press there addresses a card rather than a ship.
   *
   * Three near-misses, each of which was a real bug in a draft of this:
   *
   * - On the settings screen `fire` closes the card and the directions move and
   *   change a row, so a wider rule disarmed autoplay while somebody was choosing a
   *   persona with them.
   * - On the exit card `fire` commits a choice, so a wider rule threw the run away
   *   *and* stopped the watch session with one press.
   * - On the results and game-over cards any button skips ahead, so a watcher
   *   impatient with a seven-second screen lost their session for tapping it.
   *
   * `menu`, `pause` and `exit` never count anywhere. They hold or leave a run; they
   * do not fly a fighter, and pausing to look at what a persona has got itself into
   * is precisely what a watcher wants.
   */
  const humanTookOver = (human: InputFrame): boolean => {
    const pressed = (action: Action): boolean => wasPressed(previousHuman, human, action);
    if (phase === 'playing') return pressed('left') || pressed('right') || pressed('fire');
    if (phase === 'attract') return pressed('start');
    return false;
  };

  /**
   * The frame autoplay produces for this step, given the phase.
   *
   * Three cases, and the shape of them is the whole of what autoplay is allowed to
   * do:
   *
   * - **`playing`: the pilot's frame replaces the human's.** This is the only phase
   *   a persona drives. It is handed a *projection* of the world and never the world
   *   itself (`./autoplay.ts`), which is what makes "a persona sees only what a
   *   player sees" a fact about the types rather than a promise in a comment. The
   *   human's own bits are folded in, but by the time control reaches here a human
   *   pressing one of them has already disarmed autoplay.
   * - **`attract` and `high-score-entry`: a `start` is *added* to whatever the human
   *   is doing.** The pilot plays; it does not press buttons on screens, because a
   *   screen is a phase and phases are this file's. These two are the only screens
   *   that would otherwise leave a watcher staring at a still card — attract has no
   *   timer to move it on, and entry's is thirty seconds. `game-over`, `results` and
   *   `challenge-results` run their own timers out, because a watcher wants to read
   *   the score.
   * - **Everywhere else: the human's frame, untouched.** The menus in particular.
   *   Returning only the `menu` bit here was a real bug and a complete one: with
   *   autoplay armed, `fire` and the directions never reached the settings cursor, so
   *   the `AUTOPLAY` row could be opened and then not operated.
   */
  const autoplayFrame = (human: InputFrame, persona: Persona): InputFrame => {
    // A hand reaching for the menu button gets the step to itself. Without this the
    // `start` autoplay pushes in attract arrived on the same frame and won, because
    // the attract case reads `start` first — so the one button that stops a watch
    // session could not be pressed while one was running.
    if (isDown(human, 'menu')) return human;

    switch (phase) {
      case 'playing': {
        const world = game;
        if (world === undefined) return human;
        return (pilotFor(persona)?.sample(viewOfWorld(world)) ?? EMPTY_FRAME) | human;
      }
      case 'attract':
      case 'high-score-entry':
        // **A pulse, not a hold.** Every screen reads `wasPressed`, so a button held
        // down across a transition is a button the next screen never sees go down:
        // holding `start` started one game and then left the cabinet sitting in
        // attract for ever, because the step that submitted the high score carried
        // `start` into the step that was supposed to press it again.
        return (isDown(previous, 'start') ? EMPTY_FRAME : ACTION_BIT.start) | human;
      default:
        return human;
    }
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
      ...(composer === undefined
        ? {}
        : {
            open: openEditor,
            setAside: () => setAside?.headline,
          }),
    });
    enter('settings');
  };

  const openVariantSelect = (): void => {
    variantMenu = createVariantMenu({ variants, selected: variant.id });
    enter('variant-select');
  };

  /**
   * Stop the game and ask whether to leave it.
   *
   * Called from `playing` *after* the step for that frame has run and from
   * `paused`, which is the whole of the captain's ordering: the world is already
   * still by the time the card is on screen, so nothing can happen to the fighter
   * while the question is open.
   */
  const openExitConfirm = (): void => {
    confirm = createExitConfirm();
    enter('exit-confirm');
  };

  /**
   * Throw the run away and go home.
   *
   * **Home is attract**, in both cabinets. The selector is a boot-time screen —
   * with one variant installed it is never entered at all — so "the screen the
   * game came from" is not a thing that exists for every build; attract is, and it
   * is already where a finished game ends up. A player who wants the list takes
   * the settings screen's `GAME` row, exactly as they do between games.
   *
   * The run is **discarded**: the score does not reach the high-score table, and
   * the stats go back to empty so nothing downstream can show a run nobody
   * finished. Not silently, though — `drawExitConfirm` says the score and says
   * when it would have taken a place, which is the whole reason the confirmation
   * exists.
   */
  const abandonRun = (): void => {
    game = undefined;
    stats = EMPTY_STATS;
    lastRank = undefined;
    enter('attract');
  };

  /** Is the demo what is on screen? In attract, and on the menus and cards over it. */
  const onDemo = (): boolean =>
    phase === 'attract' ||
    phase === 'settings' ||
    phase === 'packs' ||
    phase === 'stages' ||
    phase === 'variant-select';

  if (phase === 'variant-select') openVariantSelect();

  return {
    get phase(): GamePhase {
      return phase;
    },
    get world(): World {
      // In attract — and on the two menu screens, which sit over it — the demo is
      // what is on screen; the finished run stays on screen behind the game-over,
      // results and entry cards.
      if (onDemo()) return demo.world;
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
    get setAside(): Verdict | undefined {
      return setAside;
    },
    get rank(): string {
      return rankOf();
    },
    get autoplay(): Persona | undefined {
      return personaNow();
    },
    get flying(): Persona | undefined {
      return onDemo() ? demo.persona : personaNow();
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
    get packEditor(): PackEditor | undefined {
      return phase === 'packs' ? packEditor : undefined;
    },
    get stageEditor(): StageEditor | undefined {
      return phase === 'stages' ? stageEditor : undefined;
    },
    get exitConfirm(): ExitConfirm | undefined {
      return phase === 'exit-confirm' ? confirm : undefined;
    },

    resultRows: () => resultRowsFor(stats),

    step(human: InputFrame): FlowStep {
      const previousPhase = phase;
      let events: readonly SimEvent[] = [];

      // A human taking the controls always wins, immediately and for good: the
      // setting is cleared, so nothing takes the stick back without being asked
      // again. A watcher who wants to keep watching uses the menu button.
      const persona = personaNow();
      if (persona !== undefined && humanTookOver(human)) {
        writeSettings({ autoplay: undefined });
        pilot = undefined;
        pilotPersona = undefined;
      }
      // The frame the machine acts on. Under autoplay it is the pilot's, and the
      // pilot is handed a *projection* of the world and never the world itself
      // (`./autoplay.ts`), which is what makes "a persona sees only what a player
      // sees" a fact about the types rather than a promise in a comment.
      // Re-read rather than reuse `persona`: the line above may just have cleared it.
      const flying = personaNow();
      const frame = flying === undefined ? human : autoplayFrame(human, flying);

      switch (phase) {
        case 'variant-select': {
          const menu = variantMenu;
          if (menu === undefined) {
            enter('attract');
            break;
          }
          // One column, so every direction walks it (`./keys.ts`).
          const press = cardPress(previous, frame);
          if (press.backward) menu.previous();
          if (press.forward) menu.next();
          // There is no card behind this one to go back to, so the menu button
          // does what it does on the attract screen: opens the settings.
          if (press.back) {
            openSettings('variant-select');
            break;
          }
          // Taking a game lands on *its* attract screen rather than in play. Start
          // and fire must mean one thing here, because they mean one thing on
          // every other card; and attract is where the chosen game's own demo,
          // high scores and keys are — the settings among them.
          if (press.accept) {
            selectVariant(menu.chosen);
            variantMenu = undefined;
            enter('attract');
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
          const press = cardPress(previous, frame);
          if (press.up) menu.previous();
          if (press.down) menu.next();
          if (press.left) menu.adjust(-1);
          else if (press.right) menu.adjust(1);
          // Left or right on `PACKS` or `STAGES` opened a card: it has the step.
          if (phase !== 'settings') {
            events = demo.advance();
            break;
          }
          // Every row applies as it changes, so done and back are the same exit.
          if (press.accept || press.back) {
            settingsMenu = undefined;
            refreshDemo();
            if (settingsFrom === 'variant-select') openVariantSelect();
            else enter('attract');
            break;
          }
          events = demo.advance();
          break;
        }

        case 'packs': {
          const editor = packEditor;
          if (editor === undefined) {
            enter('settings');
            break;
          }
          const press = cardPress(previous, frame);
          if (press.up) editor.previous();
          if (press.down) editor.next();
          if (press.left || press.right) editor.toggle();
          if (press.back) {
            // Cancelled: the draft goes, and nothing was written.
            packEditor = undefined;
            enter('settings');
            break;
          }
          if (press.accept) {
            const kept = editor.keep();
            // Refused: the card stays up and its verdict says why.
            if (kept.kept) {
              const settings = settingsValue();
              writeSettings({
                packs: withList(settings.packs, kept.packs),
                ...(kept.clearsStages ? { stages: withList(settings.stages, undefined) } : {}),
              });
              recompose();
              packEditor = undefined;
              enter('settings');
              break;
            }
          }
          events = demo.advance();
          break;
        }

        case 'stages': {
          const editor = stageEditor;
          if (editor === undefined) {
            enter('settings');
            break;
          }
          const press = cardPress(previous, frame);
          if (press.up) editor.previous();
          if (press.down) editor.next();
          if (press.left) editor.adjust(-1);
          else if (press.right) editor.adjust(1);
          if (press.back) {
            stageEditor = undefined;
            enter('settings');
            break;
          }
          if (press.accept) {
            const kept = editor.keep();
            if (kept.kept) {
              writeSettings({ stages: withList(settingsValue().stages, kept.stages) });
              recompose();
              stageEditor = undefined;
              enter('settings');
              break;
            }
          }
          events = demo.advance();
          break;
        }

        case 'attract': {
          // The demo world takes its input from its own pilot or the script, never
          // from the player; the only things the player's frame can do here are
          // start a game and open the settings screen.
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
          // The step comes first, and the pause is decided on what it produced.
          // That is what makes a pause cost the simulation nothing: the frame
          // carrying the press is an ordinary frame, so the world sees exactly
          // the frames it would have seen had nobody pressed anything, and the
          // resume frame is the flow's — the way the start frame in attract is.
          events = stepWorld(world, frame);
          stats = countEvents(stats, events);
          // Game over first: a challenge stage cannot end on the same step as a
          // game over, but if the two ever met, the run being over wins. Either
          // beats a pause asked for on the same frame, because there is no longer
          // a game to hold.
          if (events.some((event) => event.type === 'game-over')) {
            enter('game-over');
          } else if (events.some((event) => event.type === 'challenge-ended')) {
            enter('challenge-results');
          } else if (wasPressed(previous, frame, 'exit')) {
            openExitConfirm();
          } else if (wasPressed(previous, frame, 'pause')) {
            enter('paused');
          }
          break;
        }

        case 'paused': {
          // Nothing is stepped here — not the game, not the demo. That is the
          // whole of what pausing is, and it is why `src/sim/` never learns of it.
          if (wasPressed(previous, frame, 'exit')) {
            openExitConfirm();
            break;
          }
          if (wasPressed(previous, frame, 'pause')) enter('playing');
          break;
        }

        case 'exit-confirm': {
          const choice = confirm;
          if (choice === undefined) {
            enter('paused');
            break;
          }
          // One row of two words, so every direction walks it (`./keys.ts`).
          const press = cardPress(previous, frame);
          if (press.backward) choice.previous();
          if (press.forward) choice.next();
          // The key that opened the card also closes it, so holding or
          // double-tapping the exit key can never be the press that ends a run;
          // the service button is the way back it is on every other card.
          if (wasPressed(previous, frame, 'exit') || press.back) {
            confirm = undefined;
            enter('paused');
            break;
          }
          // Start commits as well as fire: Return is the key a player reaches
          // for on a yes-or-no card, and before it did anything here the card
          // swallowed it and sat there. It is safe for the reason above — neither
          // opens this card, so neither can be the same press held twice.
          if (press.accept) {
            const chosen = choice.choice;
            confirm = undefined;
            // Cancelling lands where an ordinary pause lands, so there is one
            // way to resume and not two.
            if (chosen === 'exit') abandonRun();
            else enter('paused');
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
          // One letter at a time, so every direction spins it (`./keys.ts`), and
          // start takes a letter exactly as fire does — the one thing it means on
          // every card. Back steps to the letter before, so a slip is mendable.
          const press = cardPress(previous, frame);
          if (press.backward) live.previous();
          if (press.forward) live.next();
          if (press.back) live.back();
          if (press.accept) live.commit();
          if (live.done || phaseSteps + 1 >= timings.entry) submitEntry();
          break;
        }
      }

      previous = frame;
      previousHuman = human;
      steps += 1;
      // A phase that changed this step starts its own count at zero; one that
      // did not gets the step it just spent.
      if (phase === previousPhase) phaseSteps += 1;

      return {
        phase,
        previousPhase,
        events,
        demo: onDemo(),
      };
    },
  };
}
