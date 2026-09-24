import { describe, expect, it } from 'vitest';

import { createRng, hashSeed, seedToState } from '../../src/engine/rng.js';

/**
 * Locked reference sequence for seed `'star-swarm'`.
 *
 * Golden replay tests compare final simulation states, so the RNG stream is part
 * of the on-disk contract: changing it invalidates every recorded replay. This
 * vector makes that a deliberate, visible decision rather than an accident.
 */
const GOLDEN_SEED = 'star-swarm';
const GOLDEN_UINT32 = [
  2441397803, 3518453687, 1745524943, 4256867435, 178011089, 2541915167, 3046233713, 4239381553,
];

describe('reproducibility', () => {
  it('matches the locked reference sequence', () => {
    const rng = createRng(GOLDEN_SEED);
    const drawn = Array.from({ length: GOLDEN_UINT32.length }, () => rng.nextUint32());
    expect(drawn).toEqual(GOLDEN_UINT32);
  });

  it('gives the same sequence for the same seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const left = Array.from({ length: 200 }, () => a.nextUint32());
    const right = Array.from({ length: 200 }, () => b.nextUint32());
    expect(left).toEqual(right);
  });

  it('gives different sequences for different seeds, including adjacent ones', () => {
    const zeroRng = createRng(0);
    const oneRng = createRng(1);
    const zero = Array.from({ length: 16 }, () => zeroRng.nextUint32());
    const one = Array.from({ length: 16 }, () => oneRng.nextUint32());
    expect(zero).not.toEqual(one);
  });

  it('treats numeric and string seeds as distinct namespaces', () => {
    expect(createRng(7).nextUint32()).not.toBe(createRng('7').nextUint32());
  });

  it('produces only 32-bit unsigned integers', () => {
    const rng = createRng('range');
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('seed hashing', () => {
  it('is stable and 32-bit', () => {
    expect(hashSeed('classic')).toBe(hashSeed('classic'));
    expect(hashSeed('classic')).toBeGreaterThanOrEqual(0);
    expect(hashSeed('classic')).toBeLessThanOrEqual(0xffffffff);
  });

  it('separates seeds that differ only above 32 bits', () => {
    expect(hashSeed(0)).not.toBe(hashSeed(2 ** 32));
  });

  it('rejects a non-finite numeric seed', () => {
    expect(() => hashSeed(Number.NaN)).toThrow(RangeError);
  });

  it('never yields an all-zero state', () => {
    const state = seedToState(0);
    expect(state.reduce((a, b) => a | b, 0)).not.toBe(0);
  });
});

describe('next()', () => {
  it('stays within [0, 1)', () => {
    const rng = createRng('unit-interval');
    for (let i = 0; i < 20_000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('has roughly the right mean', () => {
    const rng = createRng('mean');
    let sum = 0;
    const n = 100_000;
    for (let i = 0; i < n; i += 1) sum += rng.next();
    expect(sum / n).toBeCloseTo(0.5, 2);
  });
});

describe('int()', () => {
  it('covers the range and respects the exclusive upper bound', () => {
    const rng = createRng('int');
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i += 1) {
      const value = rng.int(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(7);
      seen.add(value);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([3, 4, 5, 6]);
  });

  it('is close to uniform', () => {
    const rng = createRng('uniform');
    const buckets = new Array<number>(10).fill(0);
    const n = 200_000;
    for (let i = 0; i < n; i += 1) {
      const bucket = rng.int(0, 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count / n).toBeCloseTo(0.1, 2);
    }
  });

  it('rejects an empty range', () => {
    const rng = createRng('empty');
    expect(() => rng.int(5, 5)).toThrow(RangeError);
    expect(() => rng.int(5, 4)).toThrow(RangeError);
  });
});

describe('derived helpers', () => {
  it('float() stays within bounds', () => {
    const rng = createRng('float');
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.float(-2, 5);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThan(5);
    }
  });

  it('chance() saturates at both ends', () => {
    const rng = createRng('chance');
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(-1)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    expect(rng.chance(2)).toBe(true);
  });

  it('chance() approximates its probability', () => {
    const rng = createRng('chance-rate');
    let hits = 0;
    const n = 50_000;
    for (let i = 0; i < n; i += 1) if (rng.chance(0.25)) hits += 1;
    expect(hits / n).toBeCloseTo(0.25, 2);
  });

  it('pick() only returns members, and rejects an empty array', () => {
    const rng = createRng('pick');
    const items = ['drone', 'wing', 'warden'] as const;
    for (let i = 0; i < 100; i += 1) {
      expect(items).toContain(rng.pick(items));
    }
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('shuffled() permutes a copy and leaves the input alone', () => {
    const rng = createRng('shuffle');
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const output = rng.shuffled(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...output].sort((a, b) => a - b)).toEqual(input);
    expect(createRng('shuffle').shuffled(input)).toEqual(output);
  });
});

describe('state', () => {
  it('resumes exactly where it was saved', () => {
    const rng = createRng('resume');
    for (let i = 0; i < 37; i += 1) rng.nextUint32();

    const state = rng.getState();
    const expected = Array.from({ length: 10 }, () => rng.nextUint32());

    const resumed = createRng('resume');
    resumed.setState(state);
    expect(Array.from({ length: 10 }, () => resumed.nextUint32())).toEqual(expected);
  });

  it('clone() forks an independent generator at the same position', () => {
    const rng = createRng('clone');
    rng.nextUint32();
    const clone = rng.clone();
    const fromOriginal = Array.from({ length: 5 }, () => rng.nextUint32());
    const fromClone = Array.from({ length: 5 }, () => clone.nextUint32());
    expect(fromClone).toEqual(fromOriginal);
  });

  it('recovers from an all-zero state instead of locking up', () => {
    const rng = createRng('zero');
    rng.setState([0, 0, 0, 0]);
    const drawn = Array.from({ length: 8 }, () => rng.nextUint32());
    expect(new Set(drawn).size).toBeGreaterThan(1);
  });
});
