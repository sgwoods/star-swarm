import { describe, expect, it } from 'vitest';

import { assertReplayCompatible, replayFrames } from '../../src/engine/replay.js';
import { STEP_HZ } from '../../src/engine/loop.js';
import {
  attractCard,
  CARD_STEPS,
  createAttractDemo,
  createAttractReplay,
  DEMO_SCRIPT,
} from '../../src/ui/attract.js';
import { launchEnemyBullet } from '../../src/sim/shots.js';
import { classicRules, classicStages, quickRunRules } from '../helpers/rules.js';

describe('the demo input log', () => {
  it('is a replay this build can play back', () => {
    const replay = createAttractReplay();
    expect(() => {
      assertReplayCompatible(replay);
    }).not.toThrow();
    expect(replay.stepHz).toBe(STEP_HZ);
    expect(replay.steps).toBe(replayFrames(replay).length);
  });

  it('runs long enough to be worth watching', () => {
    // Twenty seconds or more: shorter and the loop restarts before a passer-by
    // has seen the ship do anything.
    expect(createAttractReplay().steps).toBeGreaterThanOrEqual(20 * STEP_HZ);
    expect(DEMO_SCRIPT.every(([, count]) => count > 0)).toBe(true);
  });
});

describe('the attract demo', () => {
  it('runs the real simulation, one step per advance', () => {
    const demo = createAttractDemo({ rules: classicRules(), stages: classicStages() });
    for (let i = 0; i < 300; i += 1) demo.advance();
    expect(demo.world.step).toBe(300);
    expect(demo.step).toBe(300);
  });

  it('plays the ship rather than animating it: the log moves it and fires', () => {
    const demo = createAttractDemo({ rules: classicRules(), stages: classicStages() });
    const startX = demo.world.player.x;
    let shots = 0;
    for (let i = 0; i < 300; i += 1) {
      shots += demo.advance().filter((event) => event.type === 'shot-fired').length;
    }
    expect(demo.world.player.x).not.toBe(startX);
    expect(shots).toBeGreaterThan(0);
  });

  it('loops back to the top when the log runs out', () => {
    const replay = { ...createAttractReplay(), steps: 30, runs: [[0, 30] as const] };
    const demo = createAttractDemo({ rules: classicRules(), stages: classicStages(), replay });
    for (let i = 0; i < 30; i += 1) demo.advance();
    expect(demo.loops).toBe(0);
    expect(demo.world.step).toBe(30);

    demo.advance();
    expect(demo.loops).toBe(1);
    expect(demo.world.step).toBe(0);
  });

  it('starts over rather than sitting on a dead ship', () => {
    // Nothing in the simulation shoots at the fighter yet — enemy fire is a
    // sibling's task — so the bomb comes from the test, exactly as it does in
    // `tests/unit/world.test.ts`. On `quickRunRules`' single fighter it ends the
    // demo's run, which is the case this is about.
    const demo = createAttractDemo({ rules: quickRunRules(), stages: classicStages() });
    for (let i = 0; i < 60; i += 1) demo.advance();

    const world = demo.world;
    launchEnemyBullet(world.enemyBullets, world.player.x, world.player.y - 2, 0, 2);
    demo.advance();
    expect(world.status).toBe('game-over');

    demo.advance();
    expect(demo.loops).toBe(1);
    expect(demo.world.status).toBe('playing');
    expect(demo.world.step).toBe(0);
  });

  it('is reproducible: the same seed replays to the same place', () => {
    const rules = classicRules();
    const a = createAttractDemo({ rules, stages: classicStages() });
    const b = createAttractDemo({ rules, stages: classicStages() });
    for (let i = 0; i < 600; i += 1) {
      a.advance();
      b.advance();
    }
    expect(a.world.player.x).toBe(b.world.player.x);
    expect(a.world.score).toBe(b.world.score);
  });
});

describe('the attract cards', () => {
  it('alternates title and high scores on a fixed period', () => {
    expect(attractCard(0)).toBe('title');
    expect(attractCard(CARD_STEPS - 1)).toBe('title');
    expect(attractCard(CARD_STEPS)).toBe('scores');
    expect(attractCard(2 * CARD_STEPS)).toBe('title');
  });

  it('never divides by zero, whatever it is handed', () => {
    expect(attractCard(-10)).toBe('title');
    expect(attractCard(5, 0)).toBe('scores');
  });
});
