import { describe, expect, it } from 'vitest';

import { createRng } from '../../src/engine/rng.js';
import {
  advanceStars,
  createStarfield,
  createStars,
  SPEED_TIERS,
  speedForByte,
  starIsLit,
} from '../../src/render/starfield.js';
import { starfieldSpeedByte } from '../../src/sim/rules.js';

describe('speed byte to scroll rate', () => {
  it('maps the five ROM bytes onto the five tiers', () => {
    expect([0x40, 0x50, 0x60, 0x70, 0x80].map(speedForByte)).toEqual([...SPEED_TIERS]);
  });

  it('gets faster with the stage, then plateaus with the ROM formula', () => {
    const byStage = [1, 4, 8, 12, 16, 30].map((stage) => speedForByte(starfieldSpeedByte(stage)));
    expect(byStage).toEqual([...SPEED_TIERS, SPEED_TIERS[4]]);
    // Monotonic up to the plateau, which is what "rises with stage number" means.
    for (let i = 1; i < 5; i += 1) {
      expect(byStage[i] ?? 0).toBeGreaterThan(byStage[i - 1] ?? 0);
    }
  });

  it('clamps a byte from outside the range rather than producing nonsense', () => {
    expect(speedForByte(0x00)).toBe(SPEED_TIERS[0]);
    expect(speedForByte(0xff)).toBe(SPEED_TIERS[SPEED_TIERS.length - 1]);
  });
});

describe('the field', () => {
  it('is laid out from a seed, so a screenshot is reproducible', () => {
    const a = createStars(createRng('stars'), { count: 20 });
    const b = createStars(createRng('stars'), { count: 20 });
    expect(a).toEqual(b);
    expect(createStars(createRng('other'), { count: 20 })).not.toEqual(a);
  });

  it('stays on screen, wrapping at the bottom', () => {
    const stars = createStars(createRng('wrap'), { count: 40, height: 288 });
    for (let frame = 0; frame < 2000; frame += 1) advanceStars(stars, 1.5, 288);
    for (const star of stars) {
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(288);
    }
  });

  it('scrolls faster stars further in the same time', () => {
    const stars = createStars(createRng('depth'), { count: 60, height: 10_000 });
    const before = stars.map((star) => star.y);
    advanceStars(stars, 2, 10_000);
    const moved = stars.map((star, i) => star.y - (before[i] ?? 0));
    expect(new Set(moved).size).toBeGreaterThan(1);
  });

  it('pauses when the speed is zero — what a transition does', () => {
    const stars = createStars(createRng('pause'), { count: 10 });
    const before = stars.map((star) => star.y);
    advanceStars(stars, 0);
    expect(stars.map((star) => star.y)).toEqual(before);
  });

  it('blinks some stars and leaves others steady', () => {
    const stars = createStars(createRng('blink'), { count: 200 });
    expect(stars.some((star) => star.blinkPeriod > 0)).toBe(true);
    expect(stars.some((star) => star.blinkPeriod === 0)).toBe(true);
    expect(stars.filter((star) => star.blinkPeriod === 0).every(starIsLit)).toBe(true);
  });
});

describe('the starfield a renderer drives', () => {
  it('takes its speed from a sim stage-started event', () => {
    const field = createStarfield(createRng('field'), { count: 10 });
    field.setSpeedByte(starfieldSpeedByte(1));
    expect(field.speed).toBe(SPEED_TIERS[0]);
    field.setSpeedByte(starfieldSpeedByte(16));
    expect(field.speed).toBe(SPEED_TIERS[4]);
  });

  it('holds still while paused', () => {
    const field = createStarfield(createRng('field'), { count: 10 });
    field.paused = true;
    const before = field.stars.map((star) => star.y);
    for (let i = 0; i < 30; i += 1) field.advance();
    expect(field.stars.map((star) => star.y)).toEqual(before);
  });
});
