import { describe, expect, it } from 'vitest';

import { starfieldSpeedByte } from '../../src/content/rules.js';
import { EMPTY_FRAME, frameOf } from '../../src/engine/input.js';
import type { Enemy } from '../../src/sim/enemies.js';
import { eventsOfType, type SimEvent } from '../../src/sim/events.js';
import { launchEnemyBullet } from '../../src/sim/shots.js';
import { createWorld, fingerprintWorld, stepWorld, type World } from '../../src/sim/world.js';
import { classicRules, classicStages } from '../helpers/rules.js';

const rules = classicRules();
const stages = classicStages();

const FIRE = frameOf('fire');

/**
 * One enemy, standing still exactly where the test puts it.
 *
 * `returning` is the state to use for that, and not by accident: it is the one
 * targetable state whose position comes from a flight rather than from the
 * formation, so an enemy in it with no flight registered stays exactly where it
 * was put. It also scores the *formation* value while visibly moving, which is
 * the arcade rule (`docs/reference/arcade-reference.md` section 9).
 */
function enemyAt(overrides: Partial<Enemy> = {}): Enemy {
  return {
    id: 0,
    alienId: 'drone',
    role: 'drone',
    sprite: 'drone',
    hitSprites: [],
    home: 20,
    inCaptiveSlot: false,
    phase: 0,
    launchFrame: 0,
    path: 'entry-side-file',
    mirror: false,
    homes: true,
    trailing: false,
    wave: 0,
    hp: 1,
    scoreBase: 50,
    movingMultiplier: 2,
    hitPadding: { x: 0, y: 0 },
    divePaths: [],
    diveWeight: 0,
    returnsFromDive: true,
    fire: undefined,
    state: 'returning',
    x: 0,
    y: 0,
    heading: 0,
    hitsRemaining: 1,
    pathFrame: 0,
    bombTimer: 0,
    bombsLeft: 0,
    ...overrides,
  };
}

/** A world whose fleet is exactly the given enemies. */
function worldWith(enemies: Enemy[], seed = 'world-test'): World {
  const world = createWorld({ seed, rules, stages });
  world.fleet.enemies.splice(0, world.fleet.enemies.length, ...enemies);
  world.fleet.entryComplete = true;
  return world;
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

describe('player shots against the fleet', () => {
  it('destroys an enemy the shot flies into, and scores it', () => {
    const world = worldWith([enemyAt({ x: 0, y: 120, alienId: 'wing', scoreBase: 80 })]);
    world.player.x = 0;

    const events = runUntil(world, FIRE, (w) => w.score > 0);
    const destroyed = eventsOfType(events, 'target-destroyed');
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]?.score).toBe(80);
    expect(destroyed[0]?.alienId).toBe('wing');
    expect(world.score).toBe(80);
  });

  it('misses an enemy outside the window, however long it flies', () => {
    // Δx = +6 is one past the single fighter's verified [−5, +5].
    const world = worldWith([enemyAt({ x: 6, y: 120 })]);
    world.player.x = 0;
    for (let i = 0; i < 300; i += 1) stepWorld(world, FIRE);
    expect(world.fleet.enemies[0]?.state).toBe('returning');
    expect(world.score).toBe(0);
  });

  it('takes two hits to destroy a warden, and scores only the second', () => {
    const world = worldWith([
      enemyAt({ alienId: 'warden', x: 0, y: 120, hp: 2, hitsRemaining: 2, scoreBase: 150 }),
    ]);
    world.player.x = 0;

    const events = runUntil(world, FIRE, (w) => w.score > 0);
    expect(eventsOfType(events, 'target-hit')).toHaveLength(1);
    expect(eventsOfType(events, 'target-destroyed')).toHaveLength(1);
    expect(world.score).toBe(150);
  });

  it('spends one shot on one enemy, not on everything in its path', () => {
    const world = worldWith([enemyAt({ id: 0, x: 0, y: 120 }), enemyAt({ id: 1, x: 0, y: 121 })]);
    world.player.x = 0;
    runUntil(world, FIRE, (w) => w.fleet.enemies.some((e) => e.state === 'dead'));
    expect(world.fleet.enemies.filter((e) => e.state !== 'dead')).toHaveLength(1);
  });

  it("widens the window by the enemy's own padding, not by a constant", () => {
    // Δx = +8 misses the verified [−5, +5] outright; an alien padded by 3 px a
    // side is hit anyway, and the padding comes from the alien's own data.
    const narrow = worldWith([enemyAt({ x: 8, y: 120 })]);
    narrow.player.x = 0;
    for (let i = 0; i < 200; i += 1) stepWorld(narrow, FIRE);
    expect(narrow.score).toBe(0);

    const padded = worldWith([enemyAt({ x: 8, y: 120, hitPadding: { x: 3, y: 0 } })]);
    padded.player.x = 0;
    runUntil(padded, FIRE, (w) => w.score > 0);
    expect(padded.score).toBe(50);
  });

  it('cannot hit an enemy that has not launched yet', () => {
    // Due far in the future, so it stays in standby for the whole run.
    const world = worldWith([
      enemyAt({ x: 0, y: 120, state: 'standby', launchFrame: Number.MAX_SAFE_INTEGER }),
    ]);
    world.player.x = 0;
    for (let i = 0; i < 200; i += 1) stepWorld(world, FIRE);
    expect(world.score).toBe(0);
    expect(world.fleet.enemies[0]?.state).toBe('standby');
  });

  it('doubles the value of an enemy shot on its way in', () => {
    // S3 from the scout report: a drone shot during the entry wave is 100.
    const world = worldWith([enemyAt({ x: 0, y: 120, state: 'entering' })]);
    world.player.x = 0;
    runUntil(world, FIRE, (w) => w.score > 0);
    expect(world.score).toBe(100);
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
    const world = worldWith([enemyAt({ x: 0, y: 120, scoreBase: 1_000 })]);
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
      enemyAt({ id: 0, x: 0, y: 120, scoreBase: 1_000 }),
      enemyAt({ id: 1, x: 0, y: 100, scoreBase: 1_000 }),
    ]);
    world.player.x = 0;
    world.score = 19_500;

    const events = runUntil(world, FIRE, (w) => w.score >= 21_500);
    expect(eventsOfType(events, 'extra-life')).toHaveLength(1);
  });
});

describe('the stage', () => {
  it('reports the verified starfield speed byte when a stage starts', () => {
    const world = createWorld({ seed: 'stage', stage: 1, rules, stages });
    const started = eventsOfType(world.events, 'stage-started');
    expect(started[0]?.starfieldSpeed).toBe(starfieldSpeedByte(rules, 1));
    expect(started[0]?.starfieldSpeed).toBe(0x40);
  });

  it('puts the pack’s stage on the field, with its formation', () => {
    const world = createWorld({ seed: 'stage', rules, stages });
    expect(world.content?.stage.id).toBe('stage-1');
    expect(world.fleet.enemies).toHaveLength(40);
    expect(world.formation?.columnsAtRest).toHaveLength(10);
  });

  it('rolls on to the next stage when the fleet is cleared', () => {
    const world = worldWith([enemyAt({ x: 0, y: 120 })]);
    world.player.x = 0;
    const events = runUntil(world, FIRE, (w) => w.stage > 1);

    expect(eventsOfType(events, 'stage-cleared')[0]?.stage).toBe(1);
    const started = eventsOfType(events, 'stage-started');
    expect(started[0]?.stage).toBe(2);
    // A fresh fleet, back in standby, for the new stage.
    expect(world.fleet.enemies).toHaveLength(40);
    expect(world.fleet.enemies.every((enemy) => enemy.state === 'standby')).toBe(true);
  });

  it('sits still on a stage the pack has no content for', () => {
    const world = createWorld({ seed: 'empty', rules });
    for (let i = 0; i < 120; i += 1) stepWorld(world, FIRE);
    expect(world.fleet.enemies).toHaveLength(0);
    expect(world.formation).toBeUndefined();
    // No content is a halt, not a stage counter running away every frame.
    expect(world.stage).toBe(1);
  });
});

describe('the entry, end to end', () => {
  it('launches five waves of eight and settles the formation exactly once', () => {
    const world = createWorld({ seed: 'entry', rules, stages });
    const events: SimEvent[] = [];
    // Whether every enemy is in its slot is only true *on* the settle frame:
    // diving begins from it, so a later snapshot finds enemies already peeling
    // off. Capturing it here is what keeps this a test of the entry.
    let statesAtSettle: string[] = [];
    for (let i = 0; i < 1_400; i += 1) {
      const step = stepWorld(world, EMPTY_FRAME);
      if (eventsOfType(step, 'formation-settled').length > 0) {
        statesAtSettle = world.fleet.enemies.map((enemy) => enemy.state);
      }
      events.push(...step);
    }

    const launched = eventsOfType(events, 'enemy-launched');
    expect(launched).toHaveLength(40);
    expect(new Set(launched.map((event) => event.wave))).toEqual(new Set([0, 1, 2, 3, 4]));
    for (const wave of [0, 1, 2, 3, 4]) {
      expect(launched.filter((event) => event.wave === wave)).toHaveLength(8);
    }

    const settled = eventsOfType(events, 'formation-settled');
    expect(settled).toHaveLength(1);
    expect(settled[0]?.enemies).toBe(40);
    expect(world.formation?.swayOffset).toBe(0);
    expect(world.formation?.motion).toBe('breathe');
    expect(statesAtSettle).toEqual(Array.from({ length: 40 }, () => 'home'));
  });

  it('never leaves an enemy off the playfield once it is flying', () => {
    const world = createWorld({ seed: 'bounds', rules, stages });
    const margin = 24;
    for (let i = 0; i < 1_400; i += 1) {
      stepWorld(world, EMPTY_FRAME);
      for (const enemy of world.fleet.enemies) {
        if (enemy.state === 'standby' || enemy.state === 'dead') continue;
        expect(enemy.x).toBeGreaterThanOrEqual(-margin);
        expect(enemy.x).toBeLessThanOrEqual(rules.playfield.width + margin);
        expect(enemy.y).toBeGreaterThanOrEqual(-margin);
        expect(enemy.y).toBeLessThanOrEqual(rules.playfield.height + margin);
      }
    }
  });
});

describe('the simulation boundary', () => {
  it('runs with no browser attached at all', () => {
    // The Vitest projects use the Node environment, so this is not rhetorical:
    // any DOM or Canvas reference inside src/sim/ would fail to import here.
    expect(typeof globalThis.document).toBe('undefined');
    const world = createWorld({ seed: 'headless', rules, stages });
    for (let i = 0; i < 300; i += 1) stepWorld(world, FIRE);
    expect(world.step).toBe(300);
  });

  it('replaces its event list every step rather than accumulating', () => {
    const world = createWorld({ seed: 'events', rules, stages });
    stepWorld(world, EMPTY_FRAME);
    const first = world.events;
    stepWorld(world, EMPTY_FRAME);
    expect(world.events).not.toBe(first);
  });
});

describe('the fingerprint’s precision', () => {
  /**
   * `fingerprintWorld` quantises every number it serialises, which is what stops a
   * golden recorded on one machine failing on another over a last-bit difference in
   * `Math.sin`. That deliberately narrows what a golden detects, so both edges of
   * the new mesh are pinned here: a difference no machine could disagree about
   * meaningfully is absorbed, and a difference far below anything a player could
   * see is still caught. Without the second half nobody could tell later whether
   * the net still catches anything at all.
   */
  const nextUp = (value: number): number => {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    view.setBigUint64(0, view.getBigUint64(0) + 1n);
    return view.getFloat64(0);
  };

  /** A world with enemies in flight, so the fingerprint carries real positions. */
  function flying(): { world: World; enemy: Enemy } {
    const world = createWorld({ seed: 'fingerprint', rules, stages });
    for (let i = 0; i < 200; i += 1) stepWorld(world, EMPTY_FRAME);
    const enemy = world.fleet.enemies.find((candidate) => candidate.state !== 'standby');
    if (enemy === undefined) throw new Error('no enemy had launched after 200 steps');
    return { world, enemy };
  }

  // Sits on the quantiser's own grid, which is the middle of a rounding cell and
  // therefore the honest place to measure from: a value parked on a cell boundary
  // would straddle it, and that residual is named in `fingerprintWorld`'s comment
  // rather than papered over here.
  const ANCHOR = 123.456789;

  it('absorbs a one-ULP difference, which is the cross-machine noise floor', () => {
    const { world, enemy } = flying();
    enemy.x = ANCHOR;
    const before = fingerprintWorld(world);
    enemy.x = nextUp(ANCHOR);
    expect(enemy.x).not.toBe(ANCHOR);
    expect(fingerprintWorld(world)).toBe(before);
  });

  it('still catches a thousandth of a pixel, far below anything drawable', () => {
    const { world, enemy } = flying();
    enemy.x = ANCHOR;
    const before = fingerprintWorld(world);
    enemy.x = ANCHOR + 0.001;
    expect(fingerprintWorld(world)).not.toBe(before);
  });

  it('catches a millionth of a pixel too — the mesh is 1e-6, not a rounded pixel', () => {
    const { world, enemy } = flying();
    enemy.x = ANCHOR;
    const before = fingerprintWorld(world);
    enemy.x = ANCHOR + 0.000001;
    expect(fingerprintWorld(world)).not.toBe(before);
  });

  it('quantises every number in the structure, not only the ones a test pokes', () => {
    // The sibling claim to the three above, and the one they cannot make: those
    // nudge an enemy's `x`, so they prove the replacer reaches *that* number. This
    // one walks the whole serialised string, which is what says a float added to
    // the fingerprint later — the capture channel's carry and spin poses were
    // exactly that — cannot quietly reintroduce the cross-machine failure.
    const world = createWorld({ seed: 'fingerprint-structure', rules, stages });
    for (let i = 0; i < 1_400; i += 1) stepWorld(world, EMPTY_FRAME);

    // Only meaningful with real fractional values in flight to round.
    expect(world.fleet.enemies.some((enemy) => !Number.isInteger(enemy.x))).toBe(true);
    for (const [, decimals] of fingerprintWorld(world).matchAll(/-?\d+\.(\d+)/g)) {
      expect(decimals?.length).toBeLessThanOrEqual(6);
    }
  });

  it('leaves the RNG state exactly as it is, bit for bit', () => {
    // The generator's four uint32s are part of the on-disk contract, so they must
    // pass through the quantiser untouched — `2 ** 32 - 1` included.
    const { world } = flying();
    world.rng.setState([4294967295, 0, 2324523762, 1]);
    const printed: unknown = JSON.parse(fingerprintWorld(world));
    expect((printed as { rng: number[] }).rng).toEqual([4294967295, 0, 2324523762, 1]);
  });
});
