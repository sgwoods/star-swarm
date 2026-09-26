import { describe, expect, it } from 'vitest';

import type { SimEvent } from '../../src/sim/events.js';
import {
  countEvents,
  EMPTY_STATS,
  formatHitRatio,
  hitRatio,
  resultRows,
  type RunStats,
} from '../../src/ui/results.js';

const shot: SimEvent = { type: 'shot-fired', slot: 0, x: 100, y: 240 };
const destroyed: SimEvent = {
  type: 'target-destroyed',
  targetId: 1,
  alienId: 'drone',
  x: 40,
  y: 60,
  score: 50,
};
const grazed: SimEvent = {
  type: 'target-hit',
  targetId: 2,
  alienId: 'warden',
  x: 40,
  y: 60,
  hitsRemaining: 1,
};

describe('counting a run from simulation events', () => {
  it('counts shots fired and hits, and nothing else', () => {
    const stats = countEvents(EMPTY_STATS, [shot, shot, destroyed]);
    expect(stats.shotsFired).toBe(2);
    expect(stats.hits).toBe(1);
    expect(stats.destroyed).toBe(1);
  });

  it('counts the first hit on a two-hit target as a hit but not a kill', () => {
    const stats = countEvents(EMPTY_STATS, [shot, grazed, shot, destroyed]);
    expect(stats.hits).toBe(2);
    expect(stats.destroyed).toBe(1);
    expect(stats.shotsFired).toBe(2);
  });

  it('tracks the score, the highest stage and the extra lives awarded', () => {
    const stats = countEvents(EMPTY_STATS, [
      { type: 'stage-started', stage: 1, starfieldSpeed: 0x40 },
      { type: 'score-changed', score: 50, delta: 50 },
      { type: 'extra-life', lives: 3, score: 20_000 },
      { type: 'score-changed', score: 20_000, delta: 19_950 },
      { type: 'stage-started', stage: 2, starfieldSpeed: 0x40 },
    ]);
    expect(stats.score).toBe(20_000);
    expect(stats.stage).toBe(2);
    expect(stats.extraLives).toBe(1);
  });

  it('accumulates across steps', () => {
    let stats = EMPTY_STATS;
    for (let i = 0; i < 10; i += 1) stats = countEvents(stats, [shot]);
    stats = countEvents(stats, [destroyed, destroyed]);
    expect(stats).toMatchObject({ shotsFired: 10, hits: 2, destroyed: 2 });
  });
});

describe('the hit ratio', () => {
  const stats = (shotsFired: number, hits: number): RunStats => ({
    ...EMPTY_STATS,
    shotsFired,
    hits,
  });

  it('is hits over shots', () => {
    expect(hitRatio(stats(4, 1))).toBeCloseTo(0.25);
    expect(hitRatio(stats(200, 73))).toBeCloseTo(0.365);
  });

  it('is zero for a run that never fired, not a division by zero', () => {
    expect(hitRatio(stats(0, 0))).toBe(0);
    expect(Number.isFinite(hitRatio(stats(0, 0)))).toBe(true);
  });

  it('shows one decimal place', () => {
    expect(formatHitRatio(0)).toBe('0.0%');
    expect(formatHitRatio(0.365)).toBe('36.5%');
    expect(formatHitRatio(1)).toBe('100.0%');
  });

  it('truncates, so a run that missed once never reads 100.0%', () => {
    expect(formatHitRatio(hitRatio(stats(1000, 999)))).toBe('99.9%');
    // 0.36549 would round up to 36.5 either way; 0.3999 is the case that matters.
    expect(formatHitRatio(0.3999)).toBe('39.9%');
  });

  it('cannot exceed 100%, because a shot dies on its first hit', () => {
    const stats = countEvents(EMPTY_STATS, [shot, destroyed, grazed]);
    // Two hits off one shot could only come from the simulation double-counting;
    // the formatter still refuses to print more than 100%.
    expect(formatHitRatio(hitRatio(stats))).toBe('100.0%');
  });
});

describe('the results rows', () => {
  it('are shots fired, hits and the ratio, in that order', () => {
    const rows = resultRows({ ...EMPTY_STATS, shotsFired: 200, hits: 73 });
    expect(rows.map((row) => row.label)).toEqual(['SHOTS FIRED', 'HITS', 'HIT RATIO']);
    expect(rows.map((row) => row.value)).toEqual(['200', '73', '36.5%']);
  });
});
