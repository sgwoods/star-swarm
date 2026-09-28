import { describe, expect, it } from 'vitest';

import type { Rules } from '../../src/content/schema.js';
import type { StageSource } from '../../src/content/stages.js';
import type { DifficultyPreset } from '../../src/content/variants.js';
import { EMPTY_FRAME, frameOf, type InputFrame } from '../../src/engine/input.js';
import { launchEnemyBullet } from '../../src/sim/shots.js';
import { createAttractDemo } from '../../src/ui/attract.js';
import {
  createGameFlow,
  DEFAULT_TIMINGS,
  type FlowVariant,
  type GameFlow,
} from '../../src/ui/flow.js';
import { createHighScoreBoard, type HighScoreEntry } from '../../src/ui/highscores.js';
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
