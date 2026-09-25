import { describe, expect, it } from 'vitest';

import { starfieldSpeedByte } from '../../src/content/rules.js';
import { EMPTY_FRAME, frameOf } from '../../src/engine/input.js';
import { eventsOfType, type SimEvent } from '../../src/sim/events.js';
import { launchEnemyBullet } from '../../src/sim/shots.js';
import type { Target } from '../../src/sim/targets.js';
import { createWorld, stepWorld, type World } from '../../src/sim/world.js';
import { classicRules } from '../helpers/rules.js';

const rules = classicRules();

const FIRE = frameOf('fire');

/** A world with the stand-in formation replaced by exactly the given targets. */
function worldWith(targets: Target[], seed = 'world-test'): World {
  const world = createWorld({ seed, rules });
  world.targets = targets;
  return world;
}

function target(overrides: Partial<Target> = {}): Target {
  return {
    id: 0,
    role: 'drone',
    x: 0,
    y: 0,
    hitsRemaining: 1,
    alive: true,
    score: 50,
    hitPadding: { x: 0, y: 0 },
    fireIntervalSteps: 0,
    fireTimer: 0,
    ...overrides,
  };
}

/** Step until `predicate` holds, collecting every event; fails if it never does. */
function runUntil(
  world: World,
  frame: number,
  predicate: (world: World) => boolean,
  limit = 600,
): SimEvent[] {
  const collected: SimEvent[] = [];
  for (let i = 0; i < limit; i += 1) {
    collected.push(...stepWorld(world, frame));
    if (predicate(world)) return collected;
  }
  throw new Error(`Condition not reached within ${String(limit)} steps`);
}

describe('player shots against targets', () => {
  it('destroys a target the shot flies into, and scores it', () => {
    const world = worldWith([target({ x: 0, y: 120, score: 80 })]);
    world.player.x = 0;

    // Clearing the stand-in formation rolls on to a fresh one, so wait on the
    // score rather than on the target list.
    const events = runUntil(world, FIRE, (w) => w.score > 0);
    const destroyed = eventsOfType(events, 'target-destroyed');
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]?.score).toBe(80);
    expect(world.score).toBe(80);
  });

  it('misses a target outside the window, however long it flies', () => {
    // Δx = +6 is one past the single fighter's verified [−5, +5].
    const world = worldWith([target({ x: 6, y: 120 })]);
    world.player.x = 0;
    for (let i = 0; i < 300; i += 1) stepWorld(world, FIRE);
    expect(world.targets[0]?.alive).toBe(true);
    expect(world.score).toBe(0);
  });

  it('takes two hits to destroy a warden, and scores only the second', () => {
    const world = worldWith([
      target({ role: 'warden', x: 0, y: 120, hitsRemaining: 2, score: 150 }),
    ]);
    world.player.x = 0;

    const events = runUntil(world, FIRE, (w) => w.score > 0);
    expect(eventsOfType(events, 'target-hit')).toHaveLength(1);
    expect(eventsOfType(events, 'target-destroyed')).toHaveLength(1);
    expect(world.score).toBe(150);
  });

  it('spends one shot on one target, not on everything in its path', () => {
    const world = worldWith([target({ id: 0, x: 0, y: 120 }), target({ id: 1, x: 0, y: 121 })]);
    world.player.x = 0;
    runUntil(world, FIRE, (w) => w.targets.some((t) => !t.alive));
    expect(world.targets.filter((t) => t.alive)).toHaveLength(1);
  });

  it("widens the window by the target's own padding, not by a constant", () => {
    // Δx = +8 misses the verified [−5, +5] outright; a target padded by 3 px a
    // side is hit anyway, and the padding comes from the target's data.
    const narrow = worldWith([target({ x: 8, y: 120 })]);
    narrow.player.x = 0;
    for (let i = 0; i < 200; i += 1) stepWorld(narrow, FIRE);
    expect(narrow.score).toBe(0);

    const padded = worldWith([target({ x: 8, y: 120, hitPadding: { x: 3, y: 0 } })]);
    padded.player.x = 0;
    runUntil(padded, FIRE, (w) => w.score > 0);
    expect(padded.score).toBe(50);
  });
});

describe('enemy bullets against the player', () => {
  it('takes a life and clears the field', () => {
    const world = worldWith([]);
    launchEnemyBullet(world.enemyBullets, world.player.x, world.player.y - 2, 0, 2);

    const events = runUntil(world, EMPTY_FRAME, (w) => !w.player.alive, 20);
    const hits = eventsOfType(events, 'player-hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.livesRemaining).toBe(1);
    expect(world.lives.reserve).toBe(1);
  });

  it('brings the next fighter back at the centre', () => {
    const world = worldWith([]);
    launchEnemyBullet(world.enemyBullets, world.player.x, world.player.y - 2, 0, 2);
    runUntil(world, EMPTY_FRAME, (w) => !w.player.alive, 20);

    const events = runUntil(world, EMPTY_FRAME, (w) => w.player.alive, 200);
    expect(eventsOfType(events, 'player-ready')).toHaveLength(1);
    expect(world.player.x).toBe(createWorld({ seed: 'x', rules }).player.x);
  });

  it('ends the game when the last fighter is lost', () => {
    const world = worldWith([]);
    world.lives.reserve = 0;
    launchEnemyBullet(world.enemyBullets, world.player.x, world.player.y - 2, 0, 2);

    const events = runUntil(world, EMPTY_FRAME, (w) => w.status === 'game-over', 20);
    expect(eventsOfType(events, 'game-over')).toHaveLength(1);
    expect(world.status).toBe('game-over');
  });

  it('stops simulating once the game is over', () => {
    const world = worldWith([]);
    world.status = 'game-over';
    const before = world.player.x;
    for (let i = 0; i < 60; i += 1) stepWorld(world, frameOf('right', 'fire'));
    expect(world.player.x).toBe(before);
  });

  it("misses a bullet that is outside the fighter's window", () => {
    const world = worldWith([]);
    // Δx = +7 is one past the verified [−6, +6].
    launchEnemyBullet(world.enemyBullets, world.player.x + 7, world.player.y - 2, 0, 2);
    for (let i = 0; i < 30; i += 1) stepWorld(world, EMPTY_FRAME);
    expect(world.player.alive).toBe(true);
    expect(world.lives.reserve).toBe(2);
  });
});

describe('extra lives', () => {
  it('awards one when the score crosses the first threshold', () => {
    const world = worldWith([target({ x: 0, y: 120, score: 1_000 })]);
    world.player.x = 0;
    world.score = 19_500;

    const events = runUntil(world, FIRE, (w) => w.score >= 20_000);
    const awards = eventsOfType(events, 'extra-life');
    expect(awards).toHaveLength(1);
    expect(awards[0]?.lives).toBe(3);
    expect(world.lives.reserve).toBe(3);
    expect(world.lives.bonusesAwarded).toBe(1);
  });

  it('does not award the same threshold twice', () => {
    const world = worldWith([
      target({ id: 0, x: 0, y: 120, score: 1_000 }),
      target({ id: 1, x: 0, y: 100, score: 1_000 }),
    ]);
    world.player.x = 0;
    world.score = 19_500;

    const events = runUntil(world, FIRE, (w) => w.score >= 21_500);
    expect(eventsOfType(events, 'extra-life')).toHaveLength(1);
  });
});

describe('the stage', () => {
  it('reports the verified starfield speed byte when a stage starts', () => {
    const world = createWorld({ seed: 'stage', stage: 1, rules });
    const started = eventsOfType(world.events, 'stage-started');
    expect(started[0]?.starfieldSpeed).toBe(starfieldSpeedByte(rules, 1));
    expect(started[0]?.starfieldSpeed).toBe(0x40);
  });

  it('rolls on to the next stage when the formation is cleared', () => {
    const world = worldWith([target({ x: 0, y: 120 })]);
    world.player.x = 0;
    const events = runUntil(world, FIRE, (w) => w.stage > 1);

    expect(eventsOfType(events, 'stage-cleared')[0]?.stage).toBe(1);
    const started = eventsOfType(events, 'stage-started');
    expect(started[0]?.stage).toBe(2);
    expect(world.targets.length).toBeGreaterThan(0);
  });
});

describe('the simulation boundary', () => {
  it('runs with no browser attached at all', () => {
    // The Vitest projects use the Node environment, so this is not rhetorical:
    // any DOM or Canvas reference inside src/sim/ would fail to import here.
    expect(typeof globalThis.document).toBe('undefined');
    const world = createWorld({ seed: 'headless', rules });
    for (let i = 0; i < 300; i += 1) stepWorld(world, FIRE);
    expect(world.step).toBe(300);
  });

  it('replaces its event list every step rather than accumulating', () => {
    const world = createWorld({ seed: 'events', rules });
    stepWorld(world, EMPTY_FRAME);
    const first = world.events;
    stepWorld(world, EMPTY_FRAME);
    expect(world.events).not.toBe(first);
  });
});
