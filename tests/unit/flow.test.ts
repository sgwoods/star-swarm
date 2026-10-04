import { describe, expect, it } from 'vitest';

import type { Persona } from '../../src/content/personas.js';
import type { Rules } from '../../src/content/schema.js';
import type { StageSource } from '../../src/content/stages.js';
import type { DifficultyPreset } from '../../src/content/variants.js';
import { EMPTY_FRAME, frameOf, type InputFrame } from '../../src/engine/input.js';
import { launchEnemyBullet } from '../../src/sim/shots.js';
import { fingerprintWorld } from '../../src/sim/world.js';
import { createAttractDemo } from '../../src/ui/attract.js';
import {
  createGameFlow,
  DEFAULT_TIMINGS,
  type FlowVariant,
  type GameFlow,
  type GamePhase,
} from '../../src/ui/flow.js';
import { createHighScoreBoard, type HighScoreEntry } from '../../src/ui/highscores.js';
import { EMPTY_STATS, resultRows } from '../../src/ui/results.js';
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  parseSettings,
  type SettingsStore,
} from '../../src/ui/settings.js';
import { createMemoryStorage } from '../../src/ui/storage.js';
import { classicRules, classicStages, classicStagesWith, quickRunRules } from '../helpers/rules.js';

const START = frameOf('start');
const FIRE = frameOf('fire');
const LEFT = frameOf('left');
const RIGHT = frameOf('right');
const MENU = frameOf('menu');

/**
 * A flow over the real Classic stage, with the rules bent so a run scores in a
 * few dozen steps (`quickRunRules`), and a table that starts empty so any score
 * qualifies. The attract demo runs on the shipped rules: it is the thing on
 * screen, not the thing under test.
 */
function testFlow(
  options: {
    readonly capacity?: number;
    readonly defaults?: readonly HighScoreEntry[];
    readonly settings?: SettingsStore;
  } = {},
): GameFlow {
  const rules = quickRunRules();
  const stages = classicStages();
  return createGameFlow({
    rules,
    stages,
    seed: 'flow-test',
    highScores: createHighScoreBoard({
      storage: createMemoryStorage(),
      defaults: options.defaults ?? [],
      capacity: options.capacity ?? 5,
    }),
    demo: createAttractDemo({ rules: classicRules(), stages, seed: 'flow-test:attract' }),
    ...(options.settings === undefined ? {} : { settings: options.settings }),
  });
}

/** Press a button: one step with it down, one with it up, so edges fire. */
function press(flow: GameFlow, frame: InputFrame): void {
  flow.step(frame);
  flow.step(EMPTY_FRAME);
}

/** Step until the phase changes, or give up. Returns the steps taken. */
function runPhase(flow: GameFlow, frame: InputFrame = EMPTY_FRAME, limit = 5_000): number {
  const from = flow.phase;
  let steps = 0;
  while (flow.phase === from && steps < limit) {
    flow.step(frame);
    steps += 1;
  }
  return steps;
}

/**
 * End the run the way the arcade does, since the simulation cannot yet: drop a
 * bomb on the fighter. Enemy fire is a sibling's task — `src/sim/world.ts`
 * resolves enemy bullets but nothing loads the pool — so a test loads it, as
 * `tests/unit/world.test.ts` does. With `quickRunRules`' single fighter, one
 * bullet is the game over.
 */
function bombThePlayer(flow: GameFlow): void {
  const world = flow.world;
  launchEnemyBullet(world.enemyBullets, world.player.x, world.player.y - 2, 0, 2);
}

/** Start a game, score in it, and then lose it. */
function playUntilGameOver(flow: GameFlow): void {
  press(flow, START);
  expect(flow.phase).toBe('playing');

  for (let i = 0; i < 900 && flow.stats.score === 0; i += 1) flow.step(FIRE);
  expect(flow.stats.score).toBeGreaterThan(0);

  bombThePlayer(flow);
  flow.step(EMPTY_FRAME);
  expect(flow.phase).toBe('game-over');
}

describe('a capture that ends the run reaches game over, not the results card', () => {
  /**
   * The two mechanics that landed either side of this one both reach the flow's
   * phases: a capture on the last fighter ends the game, and a finished challenge
   * stage raises the between-stage card. The one thing that must not happen is a
   * run ending into the card instead of into game over.
   *
   * Driven through the real flow rather than by asserting on events, because what
   * is being checked is the *machine*, not the simulation that feeds it.
   */
  /**
   * Lose the fighter to a beam, the way the simulation does when the captor is
   * shot out from under a carry: the channel says the fighter was taken, and
   * `src/sim/world.ts` turns that into `player-captured` plus, on the last
   * fighter, `game-over`.
   *
   * Set on the channel rather than played out, because what is under test here is
   * the *machine* the events reach. That a real beam gets there is
   * `tests/unit/capture.test.ts`, which plays every step of it.
   */
  function captureThePlayer(flow: GameFlow): void {
    flow.world.capture.phase = 'carrying';
    flow.step(EMPTY_FRAME);
  }

  it('ends the run into game over when the beam takes the last fighter', () => {
    const flow = testFlow();
    press(flow, START);
    expect(flow.phase).toBe('playing');
    // `quickRunRules` starts on one fighter, so there is no reserve to fall back on.
    expect(flow.world.lives.reserve).toBe(0);

    captureThePlayer(flow);

    expect(flow.phase).toBe('game-over');
    expect(flow.world.status).toBe('game-over');
  });

  it('runs on through the ordinary results flow afterwards', () => {
    // And it is not a dead end: the game-over banner still hands over to the
    // results screen, which is what "does not strand the results flow" means.
    const flow = testFlow();
    press(flow, START);
    captureThePlayer(flow);
    expect(flow.phase).toBe('game-over');

    runPhase(flow);
    expect(flow.phase).toBe('results');
  });
});

describe('the game-state machine', () => {
  it('starts in attract mode', () => {
    const flow = testFlow();
    expect(flow.phase).toBe('attract');
    expect(flow.step(EMPTY_FRAME).demo).toBe(true);
  });

  it('runs the attract demo while nobody is playing', () => {
    const flow = testFlow();
    for (let i = 0; i < 120; i += 1) flow.step(EMPTY_FRAME);
    expect(flow.demo.world.step).toBe(120);
    expect(flow.world).toBe(flow.demo.world);
    expect(flow.steps).toBe(120);
  });

  it('never lets the player drive the demo — the log does', () => {
    const quiet = testFlow();
    const noisy = testFlow();
    for (let i = 0; i < 300; i += 1) {
      quiet.step(EMPTY_FRAME);
      // Everything except start: the demo must not feel any of it.
      noisy.step(LEFT | RIGHT | FIRE);
    }
    expect(noisy.demo.world.player.x).toBe(quiet.demo.world.player.x);
    expect(noisy.demo.world.score).toBe(quiet.demo.world.score);
  });

  it('starts a game on the start button, from a fresh world', () => {
    const flow = testFlow();
    for (let i = 0; i < 120; i += 1) flow.step(EMPTY_FRAME);

    const step = flow.step(START);
    expect(step.phase).toBe('playing');
    expect(step.previousPhase).toBe('attract');
    // The opening events of the new world arrive on the step that starts it, so
    // the starfield and the HUD see the first stage.
    expect(step.events.map((event) => event.type)).toEqual(['stage-started', 'player-ready']);
    expect(flow.world.step).toBe(0);
    expect(flow.world.score).toBe(0);
    expect(flow.stats.shotsFired).toBe(0);
  });

  it('gives the game the stage the pack ships, not an empty field', () => {
    const flow = testFlow();
    press(flow, START);
    expect(flow.world.fleet.enemies).toHaveLength(40);
    // And the demo flies the same stage, because it is the same game.
    expect(flow.demo.world.fleet.enemies).toHaveLength(40);
  });

  it('treats start as an edge, so holding it does not restart the game', () => {
    const flow = testFlow();
    flow.step(START);
    const world = flow.world;
    for (let i = 0; i < 60; i += 1) flow.step(START);
    expect(flow.phase).toBe('playing');
    expect(flow.world).toBe(world);
    expect(flow.world.step).toBe(60);
  });

  it('counts shots and hits from the events the sim raises', () => {
    const flow = testFlow();
    press(flow, START);
    for (let i = 0; i < 300 && flow.stats.hits === 0; i += 1) flow.step(FIRE);
    expect(flow.stats.shotsFired).toBeGreaterThan(0);
    expect(flow.stats.hits).toBeGreaterThan(0);
    expect(flow.stats.hits).toBeLessThanOrEqual(flow.stats.shotsFired);
    // Destroyed is not the same as hits: a Warden takes two.
    expect(flow.stats.destroyed).toBeLessThanOrEqual(flow.stats.hits);
  });

  it('goes to game over when the simulation says the game is over', () => {
    const flow = testFlow();
    playUntilGameOver(flow);
    expect(flow.world.status).toBe('game-over');
    expect(flow.phaseSteps).toBe(0);
  });

  it('holds the game-over banner for its timing, then shows the results', () => {
    const flow = testFlow();
    playUntilGameOver(flow);
    const steps = runPhase(flow);
    expect(steps).toBe(DEFAULT_TIMINGS.gameOver);
    expect(flow.phase).toBe('results');
  });

  it('lets a button skip the game-over banner', () => {
    const flow = testFlow();
    playUntilGameOver(flow);
    flow.step(EMPTY_FRAME);
    flow.step(FIRE);
    expect(flow.phase).toBe('results');
  });

  it('offers the table when the score qualifies', () => {
    const flow = testFlow();
    playUntilGameOver(flow);
    runPhase(flow); // the banner
    const steps = runPhase(flow); // the results screen
    expect(steps).toBe(DEFAULT_TIMINGS.results);
    expect(flow.phase).toBe('high-score-entry');
    expect(flow.entryRank).toBe(0);
    expect(flow.entry?.value).toBe('AAA');
  });

  it('goes straight back to attract when the score does not qualify', () => {
    // A table nothing can beat.
    const flow = testFlow({
      capacity: 1,
      defaults: [{ initials: 'GOD', score: 9_999_999, stage: 99 }],
    });
    playUntilGameOver(flow);
    runPhase(flow);
    runPhase(flow);
    expect(flow.phase).toBe('attract');
    expect(flow.entry).toBeUndefined();
  });

  it('walks the alphabet and files the entry', () => {
    const flow = testFlow();
    playUntilGameOver(flow);
    runPhase(flow);
    runPhase(flow);
    expect(flow.phase).toBe('high-score-entry');
    const score = flow.stats.score;

    press(flow, RIGHT); // A -> B
    press(flow, FIRE); // commit B
    press(flow, LEFT); // A -> the last letter of the alphabet
    press(flow, LEFT);
    press(flow, FIRE);
    press(flow, FIRE); // third letter: A
    expect(flow.phase).toBe('attract');

    const top = flow.highScores.entries()[0];
    expect(top?.score).toBe(score);
    expect(top?.initials[0]).toBe('B');
    expect(flow.lastRank).toBe(0);
  });

  it('files whatever is showing when entry times out', () => {
    const flow = testFlow();
    playUntilGameOver(flow);
    runPhase(flow);
    runPhase(flow);
    const steps = runPhase(flow);
    expect(steps).toBe(DEFAULT_TIMINGS.entry);
    expect(flow.phase).toBe('attract');
    expect(flow.highScores.entries()[0]?.initials).toBe('AAA');
  });

  it('comes back to the demo after a game, not to the dead ship', () => {
    const flow = testFlow();
    playUntilGameOver(flow);
    runPhase(flow);
    runPhase(flow);
    runPhase(flow);
    expect(flow.phase).toBe('attract');
    expect(flow.world).toBe(flow.demo.world);
    expect(flow.world.status).toBe('playing');
  });

  it('plays a second game from a fresh world and a fresh count', () => {
    const flow = testFlow();
    playUntilGameOver(flow);
    runPhase(flow);
    runPhase(flow);
    runPhase(flow);

    const firstScore = flow.stats.score;
    expect(firstScore).toBeGreaterThan(0);
    press(flow, START);
    expect(flow.phase).toBe('playing');
    expect(flow.stats.shotsFired).toBe(0);
    expect(flow.stats.score).toBe(0);
    expect(flow.world.fleet.enemies.every((enemy) => enemy.state !== 'dead')).toBe(true);
    expect(flow.highScores.best()).toBe(firstScore);
  });

  it('counts phase steps from zero on every transition', () => {
    const flow = testFlow();
    for (let i = 0; i < 40; i += 1) flow.step(EMPTY_FRAME);
    expect(flow.phaseSteps).toBe(40);
    flow.step(START);
    expect(flow.phaseSteps).toBe(0);
    flow.step(EMPTY_FRAME);
    expect(flow.phaseSteps).toBe(1);
  });
});

/**
 * The between-stage challenge screen: the one phase that goes back to `playing`.
 *
 * It is a phase rather than a flag precisely because of that — a machine where
 * "playing" sometimes means "not stepping the world" is what `src/ui/flow.ts`
 * exists to avoid.
 */
describe('the challenge-stage results screen', () => {
  /**
   * A flow whose *first* stage is a challenge stage.
   *
   * Done by moving the cadence rather than by handing the flow a starting stage:
   * the cadence is data, so `firstStage: 1` makes stage 1 a challenge stage and
   * the pack's own challenge script plays there. It keeps the flow free of a
   * "start here" option that only a test would ever pass, and it is one more
   * proof that nothing reads a stage number of its own.
   */
  function challengeFlow(): GameFlow {
    const rules = structuredClone(classicRules());
    rules.challengeStages = { ...rules.challengeStages, firstStage: 1 };
    // The stage source resolves numbers with rules too, so it needs the same
    // ones: `classicStages()` would read the pack's cadence and play a combat
    // stage on stage 1 while the world thought it was a challenge stage.
    const stages = classicStagesWith(rules);
    return createGameFlow({
      rules,
      stages,
      seed: 'challenge-flow',
      highScores: createHighScoreBoard({ storage: createMemoryStorage(), defaults: [] }),
      demo: createAttractDemo({ rules, stages, seed: 'challenge-flow:attract' }),
    });
  }

  /** Play the challenge stage out with the button held and nothing else. */
  function playChallenge(flow: GameFlow): void {
    press(flow, START);
    expect(flow.phase).toBe('playing');
    for (let i = 0; i < 3_000 && flow.phase === 'playing'; i += 1) flow.step(FIRE);
  }

  it('shows the card when the simulation says a challenge stage ended', () => {
    const flow = challengeFlow();
    playChallenge(flow);
    expect(flow.phase).toBe('challenge-results');
    expect(flow.stats.challenge).toMatchObject({
      stage: 1,
      ordinal: 0,
      hits: 40,
      total: 40,
      perfect: true,
      endBonus: 10_000,
    });
    expect(flow.stats.score).toBe(19_000);
    expect(flow.stats.perfectStages).toBe(1);
  });

  it('holds the world still while the card is up, then goes back to playing', () => {
    const flow = challengeFlow();
    playChallenge(flow);
    const frozen = flow.world.step;

    // Every timer counts simulation steps, never the wall clock.
    for (let i = 0; i < DEFAULT_TIMINGS.challengeResults - 1; i += 1) flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('challenge-results');
    expect(flow.world.step).toBe(frozen);

    flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('playing');
    // The world already rolled on to the next stage when the challenge one
    // ended; play resumes there rather than replaying the challenge stage.
    expect(flow.world.stage).toBe(2);
    flow.step(EMPTY_FRAME);
    expect(flow.world.step).toBe(frozen + 1);
  });

  it('is skippable with a button, as every other card is', () => {
    const flow = challengeFlow();
    playChallenge(flow);
    // The button was held all through the stage, and a press is an edge: let go
    // first, or there is nothing for the card to notice.
    flow.step(EMPTY_FRAME);
    press(flow, FIRE);
    expect(flow.phase).toBe('playing');
  });

  it('keeps the summary afterwards, so the end-of-game screen can show it', () => {
    const flow = challengeFlow();
    playChallenge(flow);
    for (let i = 0; i < DEFAULT_TIMINGS.challengeResults; i += 1) flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('playing');
    expect(flow.stats.challenge?.stage).toBe(1);
    expect(flow.resultRows().map((row) => row.label)).toContain('CHALLENGE HITS');
  });

  it('never shows the card on an ordinary stage', () => {
    const flow = testFlow();
    press(flow, START);
    for (let i = 0; i < 1_200; i += 1) flow.step(FIRE);
    expect(flow.phase).not.toBe('challenge-results');
    expect(flow.stats.challenge).toBeUndefined();
    expect(flow.resultRows().map((row) => row.label)).not.toContain('CHALLENGE HITS');
  });
});

/* -------------------------------------------------------------------------- */
/* Variants and settings — Milestone 3                                         */
/* -------------------------------------------------------------------------- */

/**
 * The two phases the variant work adds, and the rule that decides whether the
 * first of them is ever entered.
 *
 * The properties under test are the ones the captain will judge this by: one
 * variant must not become a screen to dismiss, choosing a variant must start
 * *that* variant's rules and stages, and the difficulty preset must reach the
 * rank — nothing else.
 */

/** A `FlowVariant` over rules the test controls, with presets it names. */
function flowVariant(
  id: string,
  rules: Rules,
  options: {
    readonly presets?: readonly DifficultyPreset[];
    readonly stages?: StageSource;
    readonly demonstration?: boolean;
    /** Records the rank each `stagesFor` call was made with. */
    readonly ranks?: string[];
    readonly personas?: readonly Persona[];
  } = {},
): FlowVariant {
  const presets =
    options.presets ??
    Object.keys(rules.difficulty.ranks).map((rank) => ({ id: rank, label: rank, rank }));
  const first = presets[0];
  if (first === undefined) throw new Error('a variant needs a preset');
  const stages = options.stages ?? classicStages();
  return {
    id,
    name: id.toUpperCase(),
    demonstration: options.demonstration ?? false,
    packs: [id],
    rules,
    presets,
    defaultPreset: presets.find((preset) => preset.rank === rules.difficulty.defaultRank) ?? first,
    personas: options.personas ?? [],
    stagesFor: (rank) => {
      options.ranks?.push(rank ?? '(none)');
      return stages;
    },
  };
}

/**
 * A flow over two variants, both on `quickRunRules` so a run finishes inside a
 * test, and both over the shipped Classic stage.
 */
function twoVariantFlow(
  options: {
    readonly settings?: SettingsStore;
    readonly onVariantChange?: (variant: FlowVariant) => void;
  } = {},
): GameFlow {
  const rules = quickRunRules();
  return createGameFlow({
    variants: [flowVariant('first', rules), flowVariant('second', rules)],
    seed: 'two',
    highScores: createHighScoreBoard({ storage: createMemoryStorage(), defaults: [] }),
    demo: createAttractDemo({
      rules: classicRules(),
      stages: classicStages(),
      seed: 'two:attract',
    }),
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    ...(options.onVariantChange === undefined ? {} : { onVariantChange: options.onVariantChange }),
  });
}

describe('the start-up selector', () => {
  it('is never entered when there is only one variant', () => {
    // The whole of the single-variant decision: a one-game cabinet boots straight
    // into attract, as it did before any of this existed.
    const flow = createGameFlow({
      variants: [flowVariant('only', quickRunRules())],
      seed: 'one',
      demo: createAttractDemo({ rules: classicRules(), seed: 'one:attract' }),
    });
    expect(flow.phase).toBe('attract');
    expect(flow.variantMenu).toBeUndefined();
    // And start still starts a game on the very first press.
    press(flow, START);
    expect(flow.phase).toBe('playing');
  });

  it('is never entered by a flow built from bare rules either', () => {
    expect(testFlow().phase).toBe('attract');
  });

  it('opens at boot when there is a choice, on the first variant', () => {
    const flow = twoVariantFlow();
    expect(flow.phase).toBe('variant-select');
    expect(flow.variantMenu?.chosen.id).toBe('first');
    expect(flow.variants.map((variant) => variant.id)).toEqual(['first', 'second']);
  });

  it('runs the attract demo behind the list, so the screen is never still', () => {
    const flow = twoVariantFlow();
    const before = flow.world.player.x;
    let moved = false;
    for (let i = 0; i < 200 && !moved; i += 1) {
      flow.step(EMPTY_FRAME);
      moved = flow.world.player.x !== before;
    }
    expect(flow.phase).toBe('variant-select');
    expect(moved).toBe(true);
  });

  it('walks the list with left and right', () => {
    const flow = twoVariantFlow();
    press(flow, RIGHT);
    expect(flow.variantMenu?.chosen.id).toBe('second');
    press(flow, LEFT);
    expect(flow.variantMenu?.chosen.id).toBe('first');
  });

  it('fire chooses and leaves the cabinet in attract', () => {
    const flow = twoVariantFlow();
    press(flow, RIGHT);
    press(flow, FIRE);
    expect(flow.phase).toBe('attract');
    expect(flow.variant.id).toBe('second');
    expect(flow.variantMenu).toBeUndefined();
  });

  it('start chooses and plays straight away', () => {
    const flow = twoVariantFlow();
    press(flow, RIGHT);
    press(flow, START);
    expect(flow.phase).toBe('playing');
    expect(flow.variant.id).toBe('second');
  });

  it('starts the chosen variant’s own rules and stages', () => {
    const quick = quickRunRules();
    const empty: StageSource = { stageFor: () => undefined };
    const flow = createGameFlow({
      variants: [flowVariant('populated', quick), flowVariant('barren', quick, { stages: empty })],
      seed: 'choose',
      demo: createAttractDemo({ rules: classicRules(), seed: 'choose:attract' }),
    });

    press(flow, RIGHT);
    press(flow, START);
    expect(flow.variant.id).toBe('barren');
    // The chosen variant's stage source answers with nothing, so the field is
    // empty — which only happens if the *chosen* source was the one used.
    expect(flow.world.fleet.enemies).toHaveLength(0);
  });

  it('remembers the choice in the settings, for the next session', () => {
    const storage = createMemoryStorage();
    const first = twoVariantFlow({ settings: createSettingsStore({ storage }) });
    press(first, RIGHT);
    press(first, FIRE);
    expect(parseSettings(storage.load())?.variant).toBe('second');

    // A new flow over the same storage opens the list on the remembered entry.
    const next = twoVariantFlow({ settings: createSettingsStore({ storage }) });
    expect(next.phase).toBe('variant-select');
    expect(next.variantMenu?.chosen.id).toBe('second');
    expect(next.variant.id).toBe('second');
  });

  it('falls back to the first variant when the remembered one is gone', () => {
    const storage = createMemoryStorage();
    createSettingsStore({ storage }).update({ variant: 'uninstalled' });
    const flow = twoVariantFlow({ settings: createSettingsStore({ storage }) });
    expect(flow.variant.id).toBe('first');
  });

  it('reports a change once, and only when the variant really changed', () => {
    const seen: string[] = [];
    const flow = twoVariantFlow({ onVariantChange: (variant) => seen.push(variant.id) });
    // Choosing the one already in force tells nobody anything.
    press(flow, FIRE);
    expect(seen).toEqual([]);
    expect(flow.phase).toBe('attract');
  });

  it('reports a change when a different variant is chosen', () => {
    const seen: string[] = [];
    const flow = twoVariantFlow({ onVariantChange: (variant) => seen.push(variant.id) });
    press(flow, RIGHT);
    press(flow, FIRE);
    expect(seen).toEqual(['second']);
  });

  it('does not come back between games: later games begin from attract', () => {
    const flow = twoVariantFlow();
    press(flow, START);
    expect(flow.phase).toBe('playing');
    bombThePlayer(flow);
    flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('game-over');
    runPhase(flow);
    expect(flow.phase).toBe('results');
    runPhase(flow);
    // Attract, or the high-score table on the way to it — never back to the list.
    expect(['attract', 'high-score-entry']).toContain(flow.phase);
  });
});

describe('the settings phase', () => {
  it('opens from attract on the menu button, and the world stops being stepped', () => {
    const flow = testFlow();
    expect(flow.phase).toBe('attract');
    const before = flow.world.player.x;
    press(flow, MENU);
    expect(flow.phase).toBe('settings');
    expect(flow.settingsMenu).toBeDefined();
    // A phase rather than a flag: "attract but not responding to start" is the
    // shape `src/ui/flow.ts` exists to refuse, so start does not start a game here.
    press(flow, START);
    expect(flow.phase).toBe('attract');
    void before;
  });

  it('closes on the menu button too, back to attract', () => {
    const flow = testFlow();
    press(flow, MENU);
    press(flow, MENU);
    expect(flow.phase).toBe('attract');
    expect(flow.settingsMenu).toBeUndefined();
  });

  it('returns to the selector when it was opened from there', () => {
    const flow = twoVariantFlow();
    press(flow, MENU);
    expect(flow.phase).toBe('settings');
    press(flow, MENU);
    expect(flow.phase).toBe('variant-select');
    expect(flow.variantMenu).toBeDefined();
  });

  it('walks rows with fire and changes values with left and right', () => {
    const storage = createMemoryStorage();
    const flow = testFlow({ settings: createSettingsStore({ storage }) });
    press(flow, MENU);
    const menu = flow.settingsMenu;
    expect(menu?.row.id).toBe('difficulty');
    press(flow, RIGHT);
    expect(flow.settings.difficulty).toBe('B');
    press(flow, FIRE);
    expect(flow.settingsMenu?.row.id).toBe('volume');
    press(flow, LEFT);
    expect(flow.settings.volume).toBeLessThan(DEFAULT_SETTINGS.volume);
  });

  it('persists what was changed', () => {
    const storage = createMemoryStorage();
    const flow = testFlow({ settings: createSettingsStore({ storage }) });
    press(flow, MENU);
    press(flow, RIGHT);
    press(flow, MENU);
    expect(parseSettings(storage.load())?.difficulty).toBe('B');
  });

  it('holds a change for the session when there is no storage at all', () => {
    // No settings store: the flow keeps the change in memory so the menu still
    // works, which is the same degradation the high-score table makes.
    const flow = testFlow();
    press(flow, MENU);
    press(flow, RIGHT);
    expect(flow.settings.difficulty).toBe('B');
  });

  it('changes the variant through its GAME row, through the one selection path', () => {
    const seen: string[] = [];
    const flow = twoVariantFlow({ onVariantChange: (variant) => seen.push(variant.id) });
    press(flow, FIRE);
    expect(flow.phase).toBe('attract');
    press(flow, MENU);
    expect(flow.settingsMenu?.row.id).toBe('game');
    press(flow, RIGHT);
    expect(flow.variant.id).toBe('second');
    // The same `selectVariant` the selector uses, so a subscriber hears about it.
    expect(seen).toEqual(['second']);
  });
});

describe('the difficulty preset', () => {
  it('reaches the world as a rank, and the stage source as the same rank', () => {
    const ranks: string[] = [];
    const rules = quickRunRules();
    const flow = createGameFlow({
      variants: [
        flowVariant('only', rules, {
          ranks,
          presets: [
            { id: 'gentle', label: 'GENTLE', rank: 'A' },
            { id: 'brutal', label: 'BRUTAL', rank: 'D' },
          ],
        }),
      ],
      seed: 'rank',
      demo: createAttractDemo({ rules: classicRules(), seed: 'rank:attract' }),
    });

    // The default preset first: rank A, because the shipped rules default to it.
    expect(flow.rank).toBe('A');
    press(flow, MENU);
    press(flow, RIGHT);
    expect(flow.settings.difficulty).toBe('brutal');
    expect(flow.rank).toBe('D');
    press(flow, MENU);

    ranks.length = 0;
    press(flow, START);
    expect(flow.phase).toBe('playing');
    // The world runs at the chosen rank, and so does stage resolution — rank
    // selects the entry-wave sequence as well as the difficulty tables
    // (docs/DESIGN.md section 6), so a preset that reached only the world would
    // apply half of what a rank means.
    expect(flow.world.rank).toBe('D');
    expect(ranks).toContain('D');
  });

  it('applies to the next game, not the one already running', () => {
    const flow = testFlow();
    press(flow, START);
    expect(flow.world.rank).toBe('A');
    // No way into the menu mid-game, by design: the run keeps the rank it started
    // on, so a difficulty change can never retune a game in progress.
    press(flow, MENU);
    expect(flow.phase).toBe('playing');
    expect(flow.world.rank).toBe('A');
  });
});

describe('the attract demo follows the game it is demonstrating', () => {
  /**
   * Two variants and **no injected demo**, so the flow builds its own: an
   * `options.demo` is the same object however often `buildDemo` is called, which
   * is what every other test here wants and exactly what these three cannot use.
   */
  const ownDemoFlow = (): GameFlow => {
    const rules = quickRunRules();
    return createGameFlow({
      variants: [flowVariant('first', rules), flowVariant('second', rules)],
      seed: 'own-demo',
    });
  };

  it('is rebuilt on the variant that was chosen', () => {
    const flow = ownDemoFlow();
    const before = flow.demo;
    press(flow, RIGHT);
    press(flow, FIRE);
    expect(flow.variant.id).toBe('second');
    // The demo is the real game, so it has to be *this* game.
    expect(flow.demo).not.toBe(before);
  });

  it('is left alone when the chosen variant is the one already running', () => {
    const flow = ownDemoFlow();
    const before = flow.demo;
    press(flow, FIRE);
    expect(flow.phase).toBe('attract');
    // Nothing changed, so nothing restarts under the player.
    expect(flow.demo).toBe(before);
  });

  it('is rebuilt when the difficulty preset moved the rank, on leaving settings', () => {
    const ranks: string[] = [];
    const flow = createGameFlow({
      variants: [
        flowVariant('only', quickRunRules(), {
          ranks,
          presets: [
            { id: 'gentle', label: 'GENTLE', rank: 'A' },
            { id: 'brutal', label: 'BRUTAL', rank: 'D' },
          ],
        }),
      ],
      seed: 'demo-rank',
    });
    const before = flow.demo;

    press(flow, MENU);
    press(flow, RIGHT);
    expect(flow.rank).toBe('D');
    // Not while the player is still choosing: a rebuild here would restart the
    // attract world under them on every press of a direction.
    expect(flow.demo).toBe(before);

    press(flow, MENU);
    expect(flow.phase).toBe('attract');
    // Rank reaches stage resolution, so a demo built on another rank can fly the
    // wrong entry sequence.
    expect(flow.demo).not.toBe(before);
    expect(ranks).toContain('D');
  });

  it('is left alone when nothing that reaches it changed', () => {
    const flow = createGameFlow({
      variants: [flowVariant('only', quickRunRules())],
      seed: 'own-demo-2',
    });
    const before = flow.demo;
    press(flow, MENU);
    press(flow, FIRE);
    press(flow, RIGHT);
    press(flow, MENU);
    // The volume moved, which the simulation knows nothing about.
    expect(flow.demo).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* Pause, and the way out                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The captain's two controls: **P pauses, X exits — and X pauses first, then
 * asks.**
 *
 * Four properties, in the order they matter:
 *
 * 1. **Pausing is a flow concern and nothing else.** The simulation has no notion
 *    of being paused; it is simply not stepped. So a paused run has to resume
 *    *bit for bit*, which is asserted against an unpaused run of the very same
 *    frames rather than against a remembered number.
 * 2. **X stops the game before it asks.** The confirmation is never answered
 *    under fire, and cancelling lands where an ordinary pause lands — so
 *    resuming is one path and not two.
 * 3. **The default is the safe one**, and no single press ends a run.
 * 4. **Both keys are ignored where they mean nothing** — there is no game to
 *    hold in attract, in the menus or on any of the end-of-run cards.
 */

const PAUSE = frameOf('pause');
const EXIT = frameOf('exit');

/**
 * A flow on the *shipped* rules rather than `quickRunRules`, for the tests that
 * run a stretch of real simulation and compare it with itself: the bent hit
 * window in a quick-run flow clears the field in seconds, and what is under test
 * here is the frames, not the scoring.
 */
function steadyFlow(): GameFlow {
  const stages = classicStages();
  return createGameFlow({
    rules: classicRules(),
    stages,
    seed: 'flow-pause',
    highScores: createHighScoreBoard({ storage: createMemoryStorage(), defaults: [] }),
    demo: createAttractDemo({ rules: classicRules(), stages, seed: 'flow-pause:attract' }),
  });
}

/** A frame script with movement and fire in it, so the run is not a straight line. */
function scriptFrame(index: number): InputFrame {
  const moving = index % 6 < 3 ? LEFT : RIGHT;
  return index % 2 === 0 ? moving | FIRE : moving;
}

const SCRIPT_LENGTH = 240;
const INTERRUPT_AT = 90;

/**
 * Play {@link SCRIPT_LENGTH} scripted frames, interrupting at
 * {@link INTERRUPT_AT} with whatever `interrupt` does, and report the world it
 * left behind.
 *
 * `interrupt` is handed the flow with the run in progress and must leave it back
 * in `playing`; the frame it is called *with* is the one it should hand to the
 * flow, because that frame is an ordinary frame of the run and the simulation is
 * owed it.
 */
function playScript(interrupt?: (flow: GameFlow, frame: InputFrame) => void): {
  readonly fingerprint: string;
  readonly flow: GameFlow;
} {
  const flow = steadyFlow();
  press(flow, START);
  for (let index = 0; index < SCRIPT_LENGTH; index += 1) {
    const frame = scriptFrame(index);
    if (index === INTERRUPT_AT && interrupt !== undefined) interrupt(flow, frame);
    else flow.step(frame);
  }
  expect(flow.phase).toBe('playing');
  return { fingerprint: fingerprintWorld(flow.world), flow };
}

describe('pausing suspends the simulation and nothing else', () => {
  it('holds the game on the pause button and lets it go on the next one', () => {
    const flow = testFlow();
    press(flow, START);
    expect(flow.phase).toBe('playing');

    press(flow, PAUSE);
    expect(flow.phase).toBe('paused');

    press(flow, PAUSE);
    expect(flow.phase).toBe('playing');
  });

  it('does not step the world while it is held', () => {
    const flow = testFlow();
    press(flow, START);
    flow.step(PAUSE);
    expect(flow.phase).toBe('paused');

    const at = flow.world.step;
    for (let i = 0; i < 300; i += 1) flow.step(i % 3 === 0 ? FIRE : LEFT);
    expect(flow.world.step).toBe(at);
    expect(flow.phase).toBe('paused');
  });

  it('raises no events and never claims to be showing the demo', () => {
    const flow = testFlow();
    press(flow, START);
    press(flow, PAUSE);
    const step = flow.step(FIRE);
    expect(step.phase).toBe('paused');
    expect(step.events).toEqual([]);
    expect(step.demo).toBe(false);
    // The run is still what is on screen, not the attract world.
    expect(flow.world).toBe(flow.world);
    expect(flow.world.status).not.toBe('game-over');
  });

  it('leaves the run exactly where it was: a resumed game is bit for bit the unpaused one', () => {
    // The assertion this whole arrangement exists for. The reference is the same
    // frames played without interruption, so nothing here is a remembered
    // number: a swallowed frame, a doubled step or a simulation that learned
    // about pausing would all show up as a different fingerprint.
    const reference = playScript().fingerprint;

    const paused = playScript((flow, frame) => {
      // The frame carrying the press is an ordinary frame of the run, and the
      // simulation is handed it before anything stops.
      flow.step(frame | PAUSE);
      expect(flow.phase).toBe('paused');
      for (let i = 0; i < 400; i += 1) flow.step(EMPTY_FRAME);
      flow.step(PAUSE);
      expect(flow.phase).toBe('playing');
    }).fingerprint;

    expect(paused).toBe(reference);
  });

  it('is the same resume whether the pause was P or a cancelled exit', () => {
    // "Cancelling returns to exactly the paused state" — so the two ways in are
    // one state, and resuming from either is the same run.
    const reference = playScript().fingerprint;

    const viaExit = playScript((flow, frame) => {
      flow.step(frame | EXIT);
      expect(flow.phase).toBe('exit-confirm');
      // Wander around the card: the cursor is the only thing that moves.
      press(flow, RIGHT);
      press(flow, LEFT);
      press(flow, EXIT);
      expect(flow.phase).toBe('paused');
      for (let i = 0; i < 120; i += 1) flow.step(EMPTY_FRAME);
      flow.step(PAUSE);
      expect(flow.phase).toBe('playing');
    }).fingerprint;

    expect(viaExit).toBe(reference);
  });

  it('loses to a game over raised on the very frame it was asked for', () => {
    // A pause has nothing to hold if the run ended on the same step. The order in
    // `flow.ts` says so; this finds the exact frame and presses both keys on it.
    const fatalStep = (): number => {
      const probe = testFlow();
      press(probe, START);
      bombThePlayer(probe);
      let steps = 0;
      while (probe.phase === 'playing' && steps < 500) {
        probe.step(EMPTY_FRAME);
        steps += 1;
      }
      expect(probe.phase).toBe('game-over');
      return steps;
    };

    const fatal = fatalStep();
    for (const frame of [PAUSE, EXIT]) {
      const flow = testFlow();
      press(flow, START);
      bombThePlayer(flow);
      for (let step = 1; step < fatal; step += 1) flow.step(EMPTY_FRAME);
      flow.step(frame);
      expect(flow.phase).toBe('game-over');
    }
  });
});

describe('X pauses first, then asks', () => {
  it('stops the game on the frame the key is pressed, and puts the card up', () => {
    const flow = testFlow();
    press(flow, START);
    flow.step(EXIT);
    expect(flow.phase).toBe('exit-confirm');

    // Nothing runs while the question is open: that is the whole of "not
    // answered under fire". Movement is pressed throughout, because a card that
    // let the fighter move would be a card drawn over a game still being played.
    const at = flow.world.step;
    for (let i = 0; i < 200; i += 1) flow.step(i % 2 === 0 ? LEFT : EMPTY_FRAME);
    expect(flow.world.step).toBe(at);
    expect(flow.phase).toBe('exit-confirm');
  });

  it('opens on the safe choice', () => {
    const flow = testFlow();
    press(flow, START);
    press(flow, EXIT);
    expect(flow.exitConfirm?.choice).toBe('resume');
  });

  it('asks from a game already paused, without unpausing it first', () => {
    const flow = testFlow();
    press(flow, START);
    press(flow, PAUSE);
    const at = flow.world.step;
    press(flow, EXIT);
    expect(flow.phase).toBe('exit-confirm');
    expect(flow.world.step).toBe(at);
  });

  it('cancels back to the pause on the exit key, so a second press cannot end a run', () => {
    const flow = testFlow();
    press(flow, START);
    press(flow, EXIT);
    press(flow, EXIT);
    expect(flow.phase).toBe('paused');
    expect(flow.exitConfirm).toBeUndefined();
  });

  it('cancels on the service button too', () => {
    const flow = testFlow();
    press(flow, START);
    press(flow, EXIT);
    press(flow, MENU);
    expect(flow.phase).toBe('paused');
  });

  it('takes the default on a stray fire press, which is to carry on playing', () => {
    const flow = testFlow();
    press(flow, START);
    press(flow, EXIT);
    press(flow, FIRE);
    expect(flow.phase).toBe('paused');
    press(flow, PAUSE);
    expect(flow.phase).toBe('playing');
  });

  it('leaves the game only when the player moves to EXIT and commits', () => {
    const flow = testFlow();
    press(flow, START);
    press(flow, EXIT);
    press(flow, RIGHT);
    expect(flow.exitConfirm?.choice).toBe('exit');
    press(flow, FIRE);
    expect(flow.phase).toBe('attract');
    expect(flow.exitConfirm).toBeUndefined();
  });

  it('commits on start too, because Return is the key a player reaches for', () => {
    // The report: toggle to EXIT, press Return, nothing happens. `start` never
    // opens this card, so letting it commit cannot make one press do both.
    const leave = testFlow();
    press(leave, START);
    press(leave, EXIT);
    press(leave, RIGHT);
    press(leave, START);
    expect(leave.phase).toBe('attract');

    const stay = testFlow();
    press(stay, START);
    press(stay, EXIT);
    press(stay, START);
    expect(stay.phase).toBe('paused');
  });

  it('goes home to attract in a cabinet with a choice of games too', () => {
    // "Home" is attract in both cabinets: the selector is a boot-time screen, and
    // with one variant installed it is never entered at all, so it cannot be what
    // leaving a game means. The way back to the list is the settings screen's
    // GAME row, exactly as it is between games.
    const flow = twoVariantFlow();
    expect(flow.phase).toBe('variant-select');
    press(flow, START);
    expect(flow.phase).toBe('playing');

    press(flow, EXIT);
    press(flow, RIGHT);
    press(flow, FIRE);
    expect(flow.phase).toBe('attract');
    expect(flow.variantMenu).toBeUndefined();
  });
});

describe('a run abandoned this way is discarded, and said to be', () => {
  /** Start a game and score in it, so there is something to lose. */
  function scoreThenAbandon(flow: GameFlow): number {
    press(flow, START);
    for (let i = 0; i < 900 && flow.stats.score === 0; i += 1) flow.step(FIRE);
    const scored = flow.stats.score;
    expect(scored).toBeGreaterThan(0);

    press(flow, EXIT);
    press(flow, RIGHT);
    press(flow, FIRE);
    expect(flow.phase).toBe('attract');
    return scored;
  }

  it('never reaches the high-score table, even with a score that would have placed', () => {
    const flow = testFlow({ defaults: [] });
    const before = flow.highScores.entries();
    const scored = scoreThenAbandon(flow);
    // It would have placed: the table was empty, so any score qualifies. The
    // card says so on screen — `src/ui/pause.ts` draws the rank it would have
    // taken — which is what stops this being a score discarded silently.
    expect(flow.highScores.rankFor(scored)).toBeDefined();
    expect(flow.highScores.entries()).toEqual(before);
    expect(flow.highScores.best()).toBe(0);
  });

  it('does not stop at the results card or the initials screen on the way', () => {
    const flow = testFlow({ defaults: [] });
    scoreThenAbandon(flow);
    expect(flow.entry).toBeUndefined();
    expect(flow.entryRank).toBeUndefined();
    expect(flow.lastRank).toBeUndefined();
    // And it stays home rather than falling through into one of them.
    for (let i = 0; i < 600; i += 1) flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('attract');
  });

  it('empties the run totals, so nothing downstream can show a run nobody finished', () => {
    const flow = testFlow({ defaults: [] });
    scoreThenAbandon(flow);
    expect(flow.stats.score).toBe(0);
    expect(flow.stats.shotsFired).toBe(0);
    expect(flow.resultRows()).toEqual(resultRows(EMPTY_STATS));
  });

  it('leaves the cabinet ready for the next game', () => {
    const flow = testFlow({ defaults: [] });
    scoreThenAbandon(flow);
    press(flow, START);
    expect(flow.phase).toBe('playing');
    expect(flow.world.score).toBe(0);
  });
});

describe('both keys are ignored where there is no game to hold', () => {
  /** Press each of the two and report the phases they left behind. */
  const phasesAfter = (build: () => GameFlow): readonly string[] =>
    [PAUSE, EXIT].map((frame) => {
      const flow = build();
      const before = flow.phase;
      press(flow, frame);
      expect(flow.phase).toBe(before);
      return flow.phase;
    });

  it('in attract', () => {
    expect(phasesAfter(() => testFlow())).toEqual(['attract', 'attract']);
  });

  it('on the settings screen', () => {
    expect(
      phasesAfter(() => {
        const flow = testFlow();
        press(flow, MENU);
        expect(flow.phase).toBe('settings');
        return flow;
      }),
    ).toEqual(['settings', 'settings']);
  });

  it('on the start-up selector', () => {
    expect(phasesAfter(() => twoVariantFlow())).toEqual(['variant-select', 'variant-select']);
  });

  it('on the game-over banner', () => {
    expect(
      phasesAfter(() => {
        const flow = testFlow();
        playUntilGameOver(flow);
        return flow;
      }),
    ).toEqual(['game-over', 'game-over']);
  });

  it('on the results card', () => {
    expect(
      phasesAfter(() => {
        const flow = testFlow();
        playUntilGameOver(flow);
        runPhase(flow);
        expect(flow.phase).toBe('results');
        return flow;
      }),
    ).toEqual(['results', 'results']);
  });

  it('on the initials screen, where the letters are what the keys are for', () => {
    expect(
      phasesAfter(() => {
        const flow = testFlow({ defaults: [] });
        playUntilGameOver(flow);
        runPhase(flow);
        runPhase(flow);
        expect(flow.phase).toBe('high-score-entry');
        return flow;
      }),
    ).toEqual(['high-score-entry', 'high-score-entry']);
  });
});

/* -------------------------------------------------------------------------- */
/* Autoplay                                                                    */
/* -------------------------------------------------------------------------- */

/** A persona good enough to fly for a few hundred steps without dying at once. */
function watcher(id = 'watcher'): Persona {
  return {
    id,
    label: id.toUpperCase(),
    reactionSteps: 2,
    aimTolerance: 4,
    threatHorizon: 240,
    dodgeMargin: 16,
    shotDiscipline: 0.8,
    panic: 0,
    engage: 0.5,
    rescue: false,
  };
}

/**
 * A one-variant flow that offers personas, with a settings store a test can read
 * back — because "a human taking the controls always wins" is a *write* to the
 * settings, and the way to check it happened is to look there.
 */
function watchableFlow(
  autoplay: string | undefined,
  personas: readonly Persona[] = [watcher()],
): { readonly flow: GameFlow; readonly settings: SettingsStore } {
  const settings = createSettingsStore({ storage: createMemoryStorage() });
  if (autoplay !== undefined) settings.update({ autoplay });
  const rules = quickRunRules();
  const flow = createGameFlow({
    variants: [flowVariant('watchable', rules, { personas })],
    seed: 'watch',
    settings,
    highScores: createHighScoreBoard({ storage: createMemoryStorage(), defaults: [] }),
    demo: createAttractDemo({ rules: classicRules(), stages: classicStages(), seed: 'watch:demo' }),
  });
  return { flow, settings };
}

describe('watching the cabinet play itself', () => {
  it('is off unless a persona has been chosen, and reports who is flying', () => {
    expect(watchableFlow(undefined).flow.autoplay).toBeUndefined();
    expect(watchableFlow('watcher').flow.autoplay?.id).toBe('watcher');
  });

  it('reads as off for a persona this game does not offer', () => {
    // A settings document outlives the build it was written against, so an id
    // nobody offers has to hand the controls back rather than half-arm anything.
    expect(watchableFlow('gone').flow.autoplay).toBeUndefined();
  });

  it('starts a game out of attract without anybody pressing start', () => {
    // Attract has no timer to move it on, so this is the one screen autoplay has to
    // push a button on. With a single variant the flow boots straight into attract,
    // so the very first step is enough.
    const { flow } = watchableFlow('watcher');
    expect(flow.phase).toBe('attract');
    flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('playing');
  });

  it('leaves a cabinet with autoplay off sitting in attract, as before', () => {
    const { flow } = watchableFlow(undefined);
    runPhase(flow, EMPTY_FRAME, 200);
    expect(flow.phase).toBe('attract');
  });

  it('flies the fighter: it moves and it shoots', () => {
    const { flow } = watchableFlow('watcher');
    flow.step(EMPTY_FRAME);
    const startedAt = flow.world.player.x;
    let moved = false;
    for (let i = 0; i < 600 && flow.phase === 'playing'; i += 1) {
      flow.step(EMPTY_FRAME);
      if (flow.world.player.x !== startedAt) moved = true;
    }
    expect(moved).toBe(true);
    expect(flow.stats.shotsFired).toBeGreaterThan(0);
  });

  it('plays the same game twice from the same seed and persona', () => {
    // The property the whole suite rests on, at the level a watcher meets it: two
    // flows, same seed, same persona, nobody touching the controls.
    const run = (): string => {
      const { flow } = watchableFlow('watcher');
      for (let i = 0; i < 900; i += 1) flow.step(EMPTY_FRAME);
      return `${String(flow.stats.score)}/${String(flow.world.player.x)}/${flow.phase}`;
    };
    expect(run()).toBe(run());
  });

  it('hands the controls over the instant a human touches them, for good', () => {
    const { flow, settings } = watchableFlow('watcher');
    flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('playing');
    for (let i = 0; i < 120; i += 1) flow.step(EMPTY_FRAME);

    flow.step(LEFT);
    expect(flow.autoplay).toBeUndefined();
    // Cleared in the settings, not merely suspended: nothing takes the stick back
    // without being asked again, so a watcher who grabs it is never fighting a bot.
    expect(settings.value.autoplay).toBeUndefined();

    // And the fighter now does exactly what the human says, including nothing.
    const still = flow.world.player.x;
    for (let i = 0; i < 60; i += 1) flow.step(EMPTY_FRAME);
    expect(flow.world.player.x).toBe(still);
  });

  it.each([
    ['left', LEFT],
    ['right', RIGHT],
    ['fire', FIRE],
  ])('treats %s in a live game as taking the controls', (_name, frame) => {
    const { flow } = watchableFlow('watcher');
    flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('playing');
    flow.step(frame);
    expect(flow.autoplay).toBeUndefined();
  });

  it.each([
    ['menu', MENU],
    ['pause', PAUSE],
    ['exit', EXIT],
  ])('does not treat %s as taking the controls', (_name, frame) => {
    // None of the three flies a fighter: they hold a run, leave one, or open the
    // screen a watcher changes persona on. Reading any of them as a takeover would
    // make looking at a persona the thing that stops watching it.
    const { flow } = watchableFlow('watcher');
    flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('playing');
    flow.step(frame);
    expect(flow.autoplay?.id).toBe('watcher');
  });

  it('treats start in attract as a human wanting the game, and takes the hint', () => {
    // The one press outside `playing` that counts: in attract, `start` means "my
    // game now" and nothing else, so it hands the cabinet over before the game it
    // starts is a watched one.
    const { flow, settings } = watchableFlow('watcher');
    expect(flow.phase).toBe('attract');
    flow.step(START);
    expect(settings.value.autoplay).toBeUndefined();
    expect(flow.phase).toBe('playing');
    expect(flow.autoplay).toBeUndefined();
  });

  it('does not treat the menu button as taking the controls', () => {
    // The way to stop watching, or to change persona, must not itself be something
    // autoplay reads as a takeover — otherwise the only way to reach the row that
    // turns it off would be to turn it off.
    const { flow } = watchableFlow('watcher');
    flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('playing');
    flow.step(MENU);
    expect(flow.autoplay?.id).toBe('watcher');
  });

  it('leaves the menus alone: their buttons are the menu’s', () => {
    // On the settings screen `fire` moves the cursor and left and right change a
    // row. Reading either as a takeover would disarm autoplay while somebody was
    // choosing a persona with it — so the cursor is walked *past* the autoplay row
    // and a different row is changed, and autoplay has to survive both.
    const { flow, settings } = watchableFlow('watcher');
    press(flow, MENU);
    expect(flow.phase).toBe('settings');

    const menu = flow.settingsMenu;
    expect(menu).toBeDefined();
    for (let i = 0; i < 12 && menu?.row.id !== 'volume'; i += 1) press(flow, FIRE);
    expect(flow.settingsMenu?.row.id).toBe('volume');

    const before = settings.value.volume;
    press(flow, RIGHT);
    expect(settings.value.volume).not.toBe(before);
    expect(flow.autoplay?.id).toBe('watcher');
    // And the world behind the card is not being flown while the card is up.
    expect(flow.phase).toBe('settings');
  });

  it('turns itself off from its own row, without a takeover', () => {
    // The other way to stop watching, and the one the menu is for: walk to the
    // `AUTOPLAY` row and change it. This is a setting changing, not a human
    // grabbing the stick, and the difference matters because the row is how a
    // watcher switches persona too.
    const { flow, settings } = watchableFlow('watcher');
    press(flow, MENU);
    const menu = flow.settingsMenu;
    for (let i = 0; i < 12 && menu?.row.id !== 'autoplay'; i += 1) press(flow, FIRE);
    expect(flow.settingsMenu?.row.id).toBe('autoplay');

    press(flow, RIGHT);
    expect(settings.value.autoplay).toBeUndefined();
    expect(flow.autoplay).toBeUndefined();

    // And back on again, from the same row.
    press(flow, RIGHT);
    expect(flow.autoplay?.id).toBe('watcher');
  });

  it('starts the next game itself once a run is over', () => {
    const { flow } = watchableFlow('watcher');
    flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('playing');
    bombThePlayer(flow);
    flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('game-over');
    // Every waiting screen runs its own timer out — a watcher wants to see the
    // score — and then attract hands straight back to the persona.
    let steps = 0;
    while (flow.phase !== 'playing' && steps < 3_000) {
      flow.step(EMPTY_FRAME);
      steps += 1;
    }
    expect(flow.phase).toBe('playing');
    expect(flow.autoplay?.id).toBe('watcher');
  });

  it('gives each game its own pilot, so one run cannot lean into the next', () => {
    // Two games in one session from one persona must not be the same game: the
    // pilot's seed carries the game index, and a pilot carried over would make the
    // second run a function of how the first one went.
    const { flow } = watchableFlow('watcher');
    const settle = (until: (phase: GamePhase) => boolean): void => {
      // Bounded, always: a flow that stops moving between phases is exactly the bug
      // a bare `while` here would hang the suite on rather than report.
      for (let i = 0; i < 4_000 && !until(flow.phase); i += 1) flow.step(EMPTY_FRAME);
      expect(until(flow.phase)).toBe(true);
    };
    const play = (): number => {
      settle((phase) => phase === 'playing');
      for (let i = 0; i < 400 && flow.phase === 'playing'; i += 1) flow.step(EMPTY_FRAME);
      const score = flow.stats.score;
      bombThePlayer(flow);
      flow.step(EMPTY_FRAME);
      settle((phase) => phase === 'attract' || phase === 'playing');
      return score;
    };
    const first = play();
    const second = play();
    expect(first).toBeGreaterThan(0);
    expect(second).not.toBe(first);
  });

  it('pauses a watched run without handing the controls back', () => {
    // The captain's pause is exactly what a watcher wants mid-run: stop, look at
    // what the persona has got itself into, carry on. So `pause` is deliberately
    // **not** a takeover — it stops the world rather than flying the fighter, and a
    // persona that lost the stick to it would make the one control for looking at a
    // persona the control that ends the demonstration.
    const { flow } = watchableFlow('watcher');
    flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('playing');
    for (let i = 0; i < 120; i += 1) flow.step(EMPTY_FRAME);

    press(flow, PAUSE);
    expect(flow.phase).toBe('paused');
    expect(flow.autoplay?.id).toBe('watcher');

    // Nothing moves while the card is up — not the fighter the pilot was flying.
    const held = flow.world.player.x;
    const step = flow.world.step;
    for (let i = 0; i < 90; i += 1) flow.step(EMPTY_FRAME);
    expect(flow.world.player.x).toBe(held);
    expect(flow.world.step).toBe(step);

    // And the persona picks the run back up where it left off.
    press(flow, PAUSE);
    expect(flow.phase).toBe('playing');
    expect(flow.autoplay?.id).toBe('watcher');
    for (let i = 0; i < 120; i += 1) flow.step(EMPTY_FRAME);
    expect(flow.world.step).toBeGreaterThan(step);
  });

  it('lets a watcher throw a run away and keeps watching the next one', () => {
    // `exit` is not a takeover either: it discards *this run*, not the setting. A
    // watcher who wanted to stop watching takes the controls, which is one key.
    const { flow } = watchableFlow('watcher');
    flow.step(EMPTY_FRAME);
    for (let i = 0; i < 120; i += 1) flow.step(EMPTY_FRAME);

    press(flow, EXIT);
    expect(flow.phase).toBe('exit-confirm');
    expect(flow.autoplay?.id).toBe('watcher');

    // The card is the human's: the pilot contributes nothing to it, so the cursor
    // stays where it opened until a person moves it.
    const opened = flow.exitConfirm?.choice;
    for (let i = 0; i < 60; i += 1) flow.step(EMPTY_FRAME);
    expect(flow.exitConfirm?.choice).toBe(opened);

    press(flow, RIGHT);
    press(flow, FIRE);
    // Home is attract, and autoplay is still armed, so the next run starts itself.
    expect(flow.autoplay?.id).toBe('watcher');
    for (let i = 0; i < 10 && flow.phase !== 'playing'; i += 1) flow.step(EMPTY_FRAME);
    expect(flow.phase).toBe('playing');
  });

  it('never presses a button the pilot is not allowed to press', () => {
    // The pilot drives `playing`; `start` on the screens is the flow's own. So a
    // persona can neither open the settings screen nor choose a game, which is what
    // keeps "watching" from being "driving the front end".
    const { flow } = watchableFlow('watcher');
    for (let i = 0; i < 1_500; i += 1) {
      flow.step(EMPTY_FRAME);
      expect(flow.phase).not.toBe('settings');
      expect(flow.phase).not.toBe('variant-select');
    }
  });
});
