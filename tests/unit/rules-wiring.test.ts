import { describe, expect, it } from 'vitest';

import { loadPack, packSourceFromRecord } from '../../src/content/loader.js';
import {
  maxXFor,
  shotWindowsFor,
  starfieldSpeedByte,
  starfieldSpeedRange,
} from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { frameOf } from '../../src/engine/input.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../src/render/canvas.js';
import { armDives, maxDiversNow } from '../../src/sim/dive.js';
import { shotsInFlight } from '../../src/sim/shots.js';
import { createWorld, stepWorld } from '../../src/sim/world.js';
import { classicRules, classicStages, minimalRules } from '../helpers/rules.js';

/**
 * The join between `src/content/` and `src/sim/`.
 *
 * The simulation has no rules of its own: it is handed a value the content
 * loader produced from a pack, and every policy number it steps comes from
 * there. These tests are what keeps that true — the first group proves the
 * values arrive, the second proves a pack that changes one changes what the
 * simulation does, and the third proves a pack that omits one does not load at
 * all rather than silently falling back to something.
 */
const rules = classicRules();
const FIRE = frameOf('fire');

/** Load a rules document the way a pack would, and report what came back. */
function loadRules(document: Record<string, unknown>) {
  return loadPack(
    packSourceFromRecord('probe', 'test:probe', {
      'pack.json': { id: 'probe', name: 'Probe' },
      'rules.json': document,
    }),
  );
}

describe('the simulation takes its values from the loaded pack', () => {
  it('sizes both shot pools from the rules rather than from a constant', () => {
    const world = createWorld({ seed: 'pools', rules });
    expect(world.shots).toHaveLength(rules.player.maxShots);
    expect(world.enemyBullets).toHaveLength(rules.enemies.maxBullets);
  });

  it('starts the fighter on the row and the reserve the rules state', () => {
    const world = createWorld({ seed: 'start', rules });
    expect(world.player.y).toBe(rules.player.y);
    expect(world.lives.reserve).toBe(rules.lives.default - 1);
  });

  it('starts on the stage the rules state, and reports the rules’ speed byte', () => {
    const world = createWorld({ seed: 'stage', rules });
    expect(world.stage).toBe(rules.stages.firstStage);
    expect(world.events[0]).toMatchObject({
      type: 'stage-started',
      starfieldSpeed: starfieldSpeedByte(rules, rules.stages.firstStage),
    });
  });

  it('carries the pack’s own object on the world, not a copy of one', () => {
    expect(createWorld({ seed: 'identity', rules }).rules).toBe(rules);
  });

  it('matches the display size without importing it', () => {
    // src/sim/ may not reach into src/render/, so the playfield is a rule and
    // the canvas is a constant. This is the test that stops them drifting.
    expect(rules.playfield.width).toBe(LOGICAL_WIDTH);
    expect(rules.playfield.height).toBe(LOGICAL_HEIGHT);
  });
});

describe('a pack that overrides a rule changes what the simulation does', () => {
  /** The Classic rules with one field replaced. */
  function withPlayer(patch: Partial<Rules['player']>): Rules {
    return { ...rules, player: { ...rules.player, ...patch } };
  }

  it('fires as many shots at once as the pack allows', () => {
    const oneShot = createWorld({ seed: 'cap', rules: withPlayer({ maxShots: 1 }) });
    const twoShots = createWorld({ seed: 'cap', rules });
    for (let i = 0; i < 3; i += 1) {
      stepWorld(oneShot, FIRE);
      stepWorld(twoShots, FIRE);
    }
    expect(shotsInFlight(oneShot.shots)).toBe(1);
    expect(shotsInFlight(twoShots.shots)).toBe(2);
  });

  it('moves the fighter at the cadence the pack states', () => {
    const constant = createWorld({ seed: 'cadence', rules: withPlayer({ stepPattern: [1] }) });
    const classic = createWorld({ seed: 'cadence', rules });
    const start = classic.player.x;
    const right = frameOf('right');
    for (let i = 0; i < 4; i += 1) {
      stepWorld(constant, right);
      stepWorld(classic, right);
    }
    // A one-step pattern is a constant speed: four frames, four pixels, against
    // the arcade cadence's 1 + 2 + 1 + 2.
    expect(constant.player.x - start).toBe(4);
    expect(classic.player.x - start).toBe(6);
  });

  it('holds the fighter off the field for as long as the pack says', () => {
    const quick = withPlayer({ respawnFrames: 1 });
    const world = createWorld({ seed: 'respawn', rules: quick });
    world.player.alive = false;
    world.player.respawnTimer = quick.player.respawnFrames;
    stepWorld(world, 0);
    expect(world.player.alive).toBe(true);
  });

  it('scrolls the backdrop on the pack’s formula, or not at all', () => {
    const { starfield: _dropped, ...withoutStarfield } = rules;
    const none: Rules = withoutStarfield;
    expect(starfieldSpeedByte(none, 9)).toBe(0);
    expect(createWorld({ seed: 'starless', rules: none }).events[0]).toMatchObject({
      starfieldSpeed: 0,
    });

    const speed = rules.starfield?.speed;
    expect(speed).toBeDefined();
    if (speed === undefined) return;
    const raised: Rules = { ...rules, starfield: { speed: { ...speed, base: 0x80 } } };
    expect(starfieldSpeedByte(raised, 1)).toBe(starfieldSpeedByte(rules, 1) + 0x40);
  });
});

describe('the attack takes its numbers from the loaded pack too', () => {
  /** The Classic rules with the enemy block patched. */
  function withEnemies(patch: Partial<Rules['enemies']>): Rules {
    return { ...rules, enemies: { ...rules.enemies, ...patch } };
  }

  /**
   * Frames from arming the dives to the first one, or `-1`.
   *
   * The *interval* rather than a count, because once the launcher is faster than
   * the divers turn over it is the row's diver limit that binds and a count would
   * measure that instead.
   */
  function framesToFirstDive(patched: Rules, steps = 1_200): number {
    const world = createWorld({
      seed: 'wiring',
      rules: { ...patched, lives: { ...patched.lives, default: 400 } },
      stages: classicStages(),
    });
    for (const enemy of world.fleet.enemies) enemy.state = 'home';
    world.fleet.entryComplete = true;
    if (world.formation !== undefined) world.formation.motion = 'breathe';
    armDives(world.dive);
    for (let i = 0; i < steps; i += 1) {
      if (stepWorld(world, 0).some((event) => event.type === 'enemy-dived')) return i;
    }
    return -1;
  }

  it('launches dives at the cadence the pack’s launch cost sets', () => {
    // The row's counters are the ramp; this is the pack-wide number that decodes
    // them. Quadrupling it has to quadruple the gap before the first dive on every
    // stage together — which is what makes it a rule rather than a difficulty knob
    // hidden in the engine.
    const dive = rules.enemies.dive;
    const slow = withEnemies({ dive: { ...dive, launchCost: dive.launchCost * 4 } });
    const shipped = framesToFirstDive(rules);
    expect(shipped).toBeGreaterThan(0);
    // Within one round robin of four times as long: the launcher only runs on one
    // frame in four, so the exact frame is that grid rather than the arithmetic.
    const phases = rules.enemies.updatePhases;
    expect(framesToFirstDive(slow)).toBeGreaterThanOrEqual(shipped * 4 - phases);
    expect(framesToFirstDive(slow)).toBeLessThanOrEqual(shipped * 4 + phases);
  });

  it('applies the row’s raised diver limit after the pack’s own delay', () => {
    const dive = rules.enemies.dive;
    const immediate = withEnemies({ dive: { ...dive, bumpAfterFrames: 0 } });
    const world = createWorld({
      seed: 'bump',
      rules: immediate,
      stages: classicStages(),
      stage: 20,
    });
    // Stage 20's row is 4 rising to 6, and with no delay the 6 is in force at once.
    expect(maxDiversNow(world.dive, immediate)).toBe(6);
    expect(maxDiversNow(world.dive, rules)).toBe(4);
  });

  it('sizes the bomb pool from the pack, so a smaller cap really is smaller', () => {
    const tight = withEnemies({ maxBullets: 3 });
    expect(createWorld({ seed: 'bullets', rules: tight }).enemyBullets).toHaveLength(3);
  });
});

describe('a rules file that omits a required value does not load', () => {
  it('names the missing field', () => {
    const { playfield: _dropped, ...withoutPlayfield } = minimalRules();
    const result = loadRules(withoutPlayfield);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ file: 'rules.json', field: 'playfield' }),
    );
  });

  it('names a missing field nested inside the player', () => {
    const document = minimalRules();
    const player = { ...(document['player'] as Record<string, unknown>) };
    delete player['hitWindow'];
    const result = loadRules({ ...document, player });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ file: 'rules.json', field: 'player.hitWindow' }),
    );
  });

  it('accepts the minimum, so the failures above are about the missing field', () => {
    expect(loadRules(minimalRules()).ok).toBe(true);
  });
});

describe('the starfield speed byte', () => {
  it('is the verified ROM formula the pack states', () => {
    for (let stage = 0; stage < 40; stage += 1) {
      const expected = 0x40 + ((Math.min(stage, 16) * 4) & 0x70);
      expect(starfieldSpeedByte(rules, stage)).toBe(expected);
    }
  });

  it('steps every four stages through five values', () => {
    expect([1, 2, 3].map((stage) => starfieldSpeedByte(rules, stage))).toEqual([0x40, 0x40, 0x40]);
    expect(starfieldSpeedByte(rules, 4)).toBe(0x50);
    expect(starfieldSpeedByte(rules, 8)).toBe(0x60);
    expect(starfieldSpeedByte(rules, 12)).toBe(0x70);
    expect(starfieldSpeedByte(rules, 16)).toBe(0x80);
  });

  it('plateaus from stage 16 rather than climbing forever', () => {
    const { max } = starfieldSpeedRange(rules);
    for (const stage of [16, 17, 40, 255]) {
      expect(starfieldSpeedByte(rules, stage)).toBe(max);
    }
  });

  it('never leaves the five-value range', () => {
    const { min, max } = starfieldSpeedRange(rules);
    expect([min, max]).toEqual([0x40, 0x80]);
    for (let stage = 0; stage < 300; stage += 1) {
      const byte = starfieldSpeedByte(rules, stage);
      expect(byte).toBeGreaterThanOrEqual(min);
      expect(byte).toBeLessThanOrEqual(max);
      expect((byte - min) % 0x10).toBe(0);
    }
  });
});

describe('mode-dependent rules', () => {
  it('picks the travel limit for the mode', () => {
    expect(maxXFor(rules, 'single')).toBe(rules.player.maxX);
    expect(maxXFor(rules, 'dual')).toBe(rules.player.dualMaxX);
  });

  it('picks the shot windows for the mode', () => {
    expect(shotWindowsFor(rules, 'single')).toHaveLength(1);
    expect(shotWindowsFor(rules, 'dual')).toHaveLength(2);
  });
});
