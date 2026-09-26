import { describe, expect, it } from 'vitest';

import { EMPTY_FRAME, frameOf, type InputFrame } from '../../src/engine/input.js';
import { launchEnemyBullet } from '../../src/sim/shots.js';
import { createAttractDemo } from '../../src/ui/attract.js';
import { createGameFlow, DEFAULT_TIMINGS, type GameFlow } from '../../src/ui/flow.js';
import {
  createHighScoreBoard,
  createMemoryStorage,
  type HighScoreEntry,
} from '../../src/ui/highscores.js';
import { classicRules, classicStages, classicStagesWith, quickRunRules } from '../helpers/rules.js';

const START = frameOf('start');
const FIRE = frameOf('fire');
const LEFT = frameOf('left');
const RIGHT = frameOf('right');

/**
 * A flow over the real Classic stage, with the rules bent so a run scores in a
 * few dozen steps (`quickRunRules`), and a table that starts empty so any score
 * qualifies. The attract demo runs on the shipped rules: it is the thing on
 * screen, not the thing under test.
 */
function testFlow(
  options: { readonly capacity?: number; readonly defaults?: readonly HighScoreEntry[] } = {},
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
