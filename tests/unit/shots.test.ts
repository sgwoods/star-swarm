import { describe, expect, it } from 'vitest';

import { frameOf } from '../../src/engine/input.js';
import { eventsOfType } from '../../src/sim/events.js';
import { CLASSIC_RULES, shotWindowsFor } from '../../src/sim/rules.js';
import {
  bulletsInFlight,
  clearShots,
  createEnemyBullets,
  createShots,
  fireShot,
  freeSlot,
  launchEnemyBullet,
  shotsInFlight,
  stepEnemyBullets,
  stepShots,
} from '../../src/sim/shots.js';
import { createWorld, stepWorld } from '../../src/sim/world.js';

const shotRules = CLASSIC_RULES.shots;
const FIRE = frameOf('fire');

describe('the two-shot cap', () => {
  it('is two in total', () => {
    expect(shotRules.cap).toBe(2);
    expect(createShots(shotRules)).toHaveLength(2);
  });

  it('refuses a third shot', () => {
    const shots = createShots(shotRules);
    expect(fireShot(shots, 100, 240, 'single', shotRules)).not.toBeNull();
    expect(fireShot(shots, 100, 240, 'single', shotRules)).not.toBeNull();
    expect(fireShot(shots, 100, 240, 'single', shotRules)).toBeNull();
    expect(shotsInFlight(shots)).toBe(2);
  });

  it('is still two for a dual fighter — the cap is not per ship', () => {
    // The correction most likely to be implemented wrongly from memory: a dual
    // fighter is one rocket object drawn double-width, not two rockets.
    const shots = createShots(shotRules);
    expect(fireShot(shots, 100, 240, 'dual', shotRules)).not.toBeNull();
    expect(fireShot(shots, 100, 240, 'dual', shotRules)).not.toBeNull();
    expect(fireShot(shots, 100, 240, 'dual', shotRules)).toBeNull();
    expect(shotsInFlight(shots)).toBe(2);
  });

  it('fills slot 0 before slot 1, as the ROM does', () => {
    const shots = createShots(shotRules);
    expect(fireShot(shots, 0, 0, 'single', shotRules)?.slot).toBe(0);
    expect(fireShot(shots, 0, 0, 'single', shotRules)?.slot).toBe(1);
  });

  it('reuses a slot the moment it frees up', () => {
    const shots = createShots(shotRules);
    const first = fireShot(shots, 0, 0, 'single', shotRules);
    fireShot(shots, 0, 0, 'single', shotRules);
    expect(freeSlot(shots)).toBeNull();

    if (first !== null) first.active = false;
    expect(freeSlot(shots)?.slot).toBe(0);
    expect(fireShot(shots, 0, 0, 'single', shotRules)?.slot).toBe(0);
  });

  it('clears every slot at once', () => {
    const shots = createShots(shotRules);
    fireShot(shots, 0, 0, 'single', shotRules);
    fireShot(shots, 0, 0, 'single', shotRules);
    clearShots(shots);
    expect(shotsInFlight(shots)).toBe(0);
  });
});

describe('the hit windows a shot carries', () => {
  it('gives a single fighter one window', () => {
    const shot = fireShot(createShots(shotRules), 50, 200, 'single', shotRules);
    expect(shot?.windows).toEqual([{ dxMin: -5, dxMax: 5, dyMin: -6, dyMax: 6 }]);
  });

  it('gives a dual fighter two, 15 apart, with a dead gap between', () => {
    const shot = fireShot(createShots(shotRules), 50, 200, 'dual', shotRules);
    expect(shot?.windows).toHaveLength(2);
    const [near, far] = shot?.windows ?? [];
    expect(near?.dxMin).toBe(-6);
    expect(near?.dxMax).toBe(4);
    expect(far?.dxMin).toBe(9);
    expect(far?.dxMax).toBe(19);
    // The separation is the second ship's $0F offset.
    expect((far?.dxMin ?? 0) - (near?.dxMin ?? 0)).toBe(0x0f);
  });

  it('fixes the windows at the moment of firing', () => {
    const shots = createShots(shotRules);
    const shot = fireShot(shots, 0, 0, 'single', shotRules);
    expect(shot?.windows).toBe(shotWindowsFor(shotRules, 'single'));
  });
});

describe('shot flight', () => {
  it('climbs at the configured speed and retires off the top', () => {
    const shots = createShots(shotRules);
    fireShot(shots, 100, 240, 'single', shotRules);
    stepShots(shots, shotRules);
    expect(shots[0]?.y).toBe(240 - shotRules.speed);

    for (let i = 0; i < 100; i += 1) stepShots(shots, shotRules);
    expect(shotsInFlight(shots)).toBe(0);
  });
});

describe('auto-fire', () => {
  it('fires continuously while the button is held — there is no edge detection', () => {
    // Fire is held for the whole run; with a cap of 2 and a 288-row climb at
    // 4 px/step, the rhythm is set by the cap and the flight time alone.
    const world = createWorld({ seed: 'auto-fire', rules: CLASSIC_RULES });
    let fired = 0;
    for (let i = 0; i < 600; i += 1) {
      fired += eventsOfType(stepWorld(world, FIRE), 'shot-fired').length;
    }
    expect(fired).toBeGreaterThan(2);
    // Never more than the cap in flight, however hard the button is held.
    expect(shotsInFlight(world.shots)).toBeLessThanOrEqual(2);
  });
});

describe('the global enemy bullet cap', () => {
  it('is eight, and it is global rather than per enemy', () => {
    expect(CLASSIC_RULES.enemyBullets.cap).toBe(8);
    const bullets = createEnemyBullets(CLASSIC_RULES.enemyBullets);
    for (let i = 0; i < 8; i += 1) {
      expect(launchEnemyBullet(bullets, i * 10, 0, 0, 2)).not.toBeNull();
    }
    expect(launchEnemyBullet(bullets, 0, 0, 0, 2)).toBeNull();
    expect(bulletsInFlight(bullets)).toBe(8);
  });

  it('frees a slot when a bullet leaves the playfield', () => {
    const bullets = createEnemyBullets(CLASSIC_RULES.enemyBullets);
    launchEnemyBullet(bullets, 100, 0, 0, 2);
    for (let i = 0; i < 200; i += 1) stepEnemyBullets(bullets, 224, 288);
    expect(bulletsInFlight(bullets)).toBe(0);
  });

  it('carries a velocity fixed at launch, ready for aimed shots later', () => {
    const bullets = createEnemyBullets(CLASSIC_RULES.enemyBullets);
    launchEnemyBullet(bullets, 100, 50, -1, 2);
    stepEnemyBullets(bullets, 224, 288);
    expect(bullets[0]?.x).toBe(99);
    expect(bullets[0]?.y).toBe(52);
  });
});
