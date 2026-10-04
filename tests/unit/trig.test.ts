import { describe, expect, it } from 'vitest';

import {
  angleToDegrees,
  atan2Angle,
  cosine,
  degreesToAngle,
  sine,
  trigTables,
  TURN,
} from '../../src/engine/trig.js';

/**
 * `src/engine/trig.ts` is the simulation's only trigonometry. Two kinds of claim
 * are held here.
 *
 * **The contract.** Every golden replay is recorded through these tables, so —
 * like the RNG stream in `rng.test.ts` — their contents are locked: a change to
 * how they are built has to be a deliberate, visible decision. And a machine that
 * built them differently would fail here, which is the in-process half of the
 * cross-architecture claim.
 *
 * **The cost.** The module's header states how far from the true values its
 * answers may be, and the documents quote it. These are the measurements behind
 * those figures, against the engine's own functions — which a test may consult,
 * because it compares within a bound rather than to the bit.
 */

const QUARTER = TURN / 4;
const UNITS_PER_DEGREE = 2 ** 22;

/** FNV-1a over each entry's four bytes, low first. */
function digest(values: readonly number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (value >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
}

/** A spread of whole angles that lands on, beside and between table entries. */
function sweep(count: number): number[] {
  return Array.from({ length: count }, (_, k) =>
    Math.floor((k * 2_147_483.6471 * 1000.0013) % TURN),
  );
}

const toRadians = (angle: number): number => (angle / TURN) * 2 * Math.PI;

describe('the tables', () => {
  const { sine: sines, arctan: arctans } = trigTables();

  it('match the locked digest', () => {
    expect(sines).toHaveLength(5761);
    expect(arctans).toHaveLength(8193);
    expect(digest(sines)).toBe(2_966_537_421);
    expect(digest(arctans)).toBe(33_756_996);
    // 1/64°, 1°, 15°, 30°, 45° and 60°, then the last interval.
    expect([1, 64, 960, 1920, 2880, 3840, 5759].map((i) => sines[i])).toEqual([
      292_818, 18_739_379, 277_904_834, 536_870_912, 759_250_125, 929_887_697, 1_073_741_784,
    ]);
    expect([1, 2048, 4096, 6144, 8191].map((j) => arctans[j])).toEqual([
      29_335, 58_872_272, 111_421_900, 154_643_559, 188_729_011,
    ]);
  });

  it('end exactly on 0 and 1, and on an eighth of a turn', () => {
    expect(sines[0]).toBe(0);
    expect(sines[5760]).toBe(2 ** 30);
    expect(arctans[0]).toBe(0);
    expect(arctans[8192]).toBe(TURN / 8);
  });

  it('are each the true value rounded to the fixed-point grid', () => {
    sines.forEach((entry, i) => {
      const exact = Math.sin((i * Math.PI) / (180 * 64)) * 2 ** 30;
      expect(Math.abs(entry - exact)).toBeLessThanOrEqual(0.5 + 1e-6);
    });
    arctans.forEach((entry, j) => {
      const exact = (Math.atan(j / 8192) * TURN) / (2 * Math.PI);
      expect(Math.abs(entry - exact)).toBeLessThanOrEqual(0.5 + 1e-6);
    });
  });

  it('rise strictly, so interpolating between entries never turns back', () => {
    for (let i = 1; i < sines.length; i += 1) {
      expect(sines[i] ?? 0).toBeGreaterThan(sines[i - 1] ?? 0);
      expect(arctans[i] ?? 0).toBeGreaterThan(arctans[i - 1] ?? 0);
    }
  });
});

describe('what the precision costs', () => {
  it('puts a sine or cosine within 1.1e-8 of the true value', () => {
    let worst = 0;
    for (const angle of sweep(200_000)) {
      worst = Math.max(
        worst,
        Math.abs(sine(angle) - Math.sin(toRadians(angle))),
        Math.abs(cosine(angle) - Math.cos(toRadians(angle))),
      );
    }
    expect(worst).toBeLessThan(1.1e-8);
    // And the bound is not slack: the chord between two entries really costs this.
    expect(worst).toBeGreaterThan(0.9e-8);
  });

  it('puts an arctangent within 5.5e-9 rad of the true value, at every scale', () => {
    let worst = 0;
    for (let k = 0; k < 200_000; k += 1) {
      const scale = 10 ** ((k % 9) - 4);
      const x = Math.cos(k * 0.0031) * scale;
      const y = Math.sin(k * 0.0031) * scale * (1 + (k % 7));
      const ours = toRadians(atan2Angle(y, x));
      const theirs = Math.atan2(y, x);
      let gap = Math.abs(ours - (theirs < 0 ? theirs + 2 * Math.PI : theirs));
      if (gap > Math.PI) gap = 2 * Math.PI - gap;
      worst = Math.max(worst, gap);
    }
    expect(worst).toBeLessThan(5.5e-9);
  });

  it('turns a vector back into the angle it came from to within one unit', () => {
    for (const angle of sweep(50_000)) {
      let gap = Math.abs(atan2Angle(sine(angle), cosine(angle)) - angle);
      if (gap > TURN / 2) gap = TURN - gap;
      expect(gap).toBeLessThanOrEqual(1);
    }
  });
});

describe('exactness', () => {
  it('reads every whole degree straight off an entry, so 30° is exactly a half', () => {
    // What content is written in: headings, arc sweeps and bombing vectors are
    // whole degrees, and none of them is interpolated. A bomb on a 30° vector at
    // two pixels a frame therefore moves exactly one pixel sideways, and lands on
    // the whole pixel the hit window's edge is drawn at.
    for (let degrees = -720; degrees <= 720; degrees += 1) {
      const exact = Math.sin((degrees * Math.PI) / 180);
      const ours = sine(degreesToAngle(degrees));
      expect(Math.abs(ours - exact) * 2 ** 30).toBeLessThanOrEqual(0.5 + 1e-6);
    }
    expect([30, 150, 210, 330].map((degrees) => sine(degreesToAngle(degrees)))).toEqual([
      0.5, 0.5, -0.5, -0.5,
    ]);
    expect(cosine(degreesToAngle(60))).toBe(0.5);
    expect(2 * sine(degreesToAngle(30))).toBe(1);
  });

  it('hands out exact multiples of 2^-30', () => {
    for (const angle of sweep(10_000)) {
      expect(Number.isInteger(sine(angle) * 2 ** 30)).toBe(true);
      expect(Number.isInteger(cosine(angle) * 2 ** 30)).toBe(true);
    }
  });

  it('gives the four axes exactly, both ways round', () => {
    const axes = [0, 90, 180, 270].map((degrees) => degreesToAngle(degrees));
    expect(axes).toEqual([0, QUARTER, 2 * QUARTER, 3 * QUARTER]);
    expect(axes.map((angle) => [sine(angle) + 0, cosine(angle) + 0])).toEqual([
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ]);
    expect([atan2Angle(0, 1), atan2Angle(1, 0), atan2Angle(0, -1), atan2Angle(-1, 0)]).toEqual(
      axes,
    );
  });

  it('is odd, so a mirrored heading is exactly a mirrored vector', () => {
    for (let k = 0; k < 5_000; k += 1) {
      const degrees = k * 0.0731 - 180;
      const ahead = degreesToAngle(degrees);
      const mirrored = degreesToAngle(-degrees);
      expect(sine(mirrored) + 0).toBe(-sine(ahead) + 0);
      expect(cosine(mirrored)).toBe(cosine(ahead));
    }
  });

  it('converts degrees exactly when they are binary fractions, and wraps them', () => {
    for (const degrees of [1, 15, 22.5, 0.375, 359.9921875, 2 ** -22]) {
      expect(degreesToAngle(degrees)).toBe(degrees * UNITS_PER_DEGREE);
    }
    for (const angle of [0, 1, 12_345, QUARTER - 1, TURN / 3, TURN - 1].map(Math.floor)) {
      expect(degreesToAngle(angleToDegrees(angle))).toBe(angle);
    }
    expect(degreesToAngle(360)).toBe(0);
    expect(degreesToAngle(450)).toBe(QUARTER);
    expect(degreesToAngle(-90)).toBe(3 * QUARTER);
    expect(degreesToAngle(-0)).toBe(0);
  });

  it('answers NaN for an angle that is not a number, as Math.sin does', () => {
    expect(sine(degreesToAngle(Number.NaN))).toBeNaN();
    expect(cosine(degreesToAngle(Number.POSITIVE_INFINITY))).toBeNaN();
    expect(atan2Angle(Number.NaN, 1)).toBeNaN();
  });
});
