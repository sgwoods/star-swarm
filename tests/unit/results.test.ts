import { describe, expect, it } from 'vitest';

import type { SimEvent } from '../../src/sim/events.js';
import {
  challengeHeading,
  challengeResultRows,
  countEvents,
  EMPTY_STATS,
  formatHitRatio,
  hitRatio,
  resultRows,
  type ChallengeSummary,
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

  it('say nothing about challenge stages in a run that saw none', () => {
    const rows = resultRows({ ...EMPTY_STATS, shotsFired: 200, hits: 73 });
    expect(rows).toHaveLength(3);
  });

  it('add the challenge tally once a run has played one', () => {
    const rows = resultRows({
      ...EMPTY_STATS,
      shotsFired: 200,
      hits: 73,
      challengeStages: 2,
      challengeHits: 74,
      challengeEnemies: 80,
      challengeScore: 32_000,
    });
    expect(rows.map((row) => row.label)).toEqual([
      'SHOTS FIRED',
      'HITS',
      'HIT RATIO',
      'CHALLENGE HITS',
      'CHALLENGE BONUS',
    ]);
    expect(rows.at(-2)?.value).toBe('74/80');
    expect(rows.at(-1)?.value).toBe('32000');
  });

  it('calls out perfect stages only when there were some', () => {
    const played = { ...EMPTY_STATS, challengeStages: 2, challengeHits: 74, challengeEnemies: 80 };
    expect(resultRows(played).map((row) => row.label)).not.toContain('PERFECT STAGES');
    expect(resultRows({ ...played, perfectStages: 1 }).map((row) => row.label)).toContain(
      'PERFECT STAGES',
    );
  });
});

/**
 * The between-stage card the original shows: "NUMBER OF HITS", then either
 * "BONUS" or, for all forty, the flashing "PERFECT !" and "SPECIAL BONUS"
 * (`docs/reference/arcade-reference.md` section 8, "Results screen").
 */
describe('the challenge-stage results', () => {
  const summary = (overrides: Partial<ChallengeSummary> = {}): ChallengeSummary => ({
    stage: 3,
    ordinal: 0,
    hits: 40,
    total: 40,
    perfect: true,
    impactScore: 4_000,
    groupBonus: 5_000,
    endBonus: 10_000,
    ...overrides,
  });

  it('is headed by the challenge stage’s number, counted from one', () => {
    expect(challengeHeading(summary())).toBe('CHALLENGE 1');
    expect(challengeHeading(summary({ ordinal: 8 }))).toBe('CHALLENGE 9');
  });

  it('shows the hit count and the special bonus on a perfect stage', () => {
    const rows = challengeResultRows(summary());
    expect(rows.map((row) => row.label)).toEqual(['NUMBER OF HITS', 'SPECIAL BONUS']);
    expect(rows.map((row) => row.value)).toEqual(['40/40', '10000']);
    expect(rows[1]?.colour).toBeDefined();
  });

  it('shows the ordinary bonus otherwise, labelled differently', () => {
    // The label changes with the branch because the perfect bonus *replaces* the
    // per-hit one: "BONUS 10000" would read as the same award scaled up.
    const rows = challengeResultRows(summary({ hits: 23, perfect: false, endBonus: 2_300 }));
    expect(rows.map((row) => row.label)).toEqual(['NUMBER OF HITS', 'BONUS']);
    expect(rows.map((row) => row.value)).toEqual(['23/40', '2300']);
    expect(rows[1]?.colour).toBeUndefined();
  });

  it('shows the end award alone, because the rest already ticked the counter', () => {
    // The impact awards and the group bonuses arrived during the stage; the
    // original's between-stage display carries the end award and the hit count.
    const rows = challengeResultRows(summary());
    expect(rows.map((row) => row.value)).not.toContain('19000');
  });
});

describe('counting challenge stages into a run', () => {
  const ended: SimEvent = {
    type: 'challenge-ended',
    stage: 3,
    ordinal: 0,
    hits: 40,
    total: 40,
    perfect: true,
    impactScore: 4_000,
    groupBonus: 5_000,
    endBonus: 10_000,
  };

  it('keeps the last summary and totals every stage', () => {
    const first = countEvents(EMPTY_STATS, [ended]);
    expect(first.challenge).toMatchObject({ stage: 3, hits: 40 });
    expect(first).toMatchObject({
      challengeStages: 1,
      challengeHits: 40,
      challengeEnemies: 40,
      perfectStages: 1,
      challengeScore: 19_000,
    });

    const second = countEvents(first, [
      {
        ...ended,
        stage: 7,
        ordinal: 1,
        hits: 23,
        perfect: false,
        impactScore: 3_680,
        endBonus: 2_300,
      },
    ]);
    expect(second.challenge).toMatchObject({ stage: 7, hits: 23 });
    expect(second).toMatchObject({
      challengeStages: 2,
      challengeHits: 63,
      challengeEnemies: 80,
      perfectStages: 1,
      challengeScore: 19_000 + 3_680 + 5_000 + 2_300,
    });
  });

  it('totals the challenge money from the event, not from a per-hit value', () => {
    // The ninth challenge stage pays 100 a hit while the group bonus stays at
    // 3,000, so a screen that multiplied hits by one number would be wrong there.
    const ninth = countEvents(EMPTY_STATS, [
      { ...ended, stage: 35, ordinal: 8, impactScore: 4_000, groupBonus: 15_000 },
    ]);
    expect(ninth.challengeScore).toBe(29_000);
  });
});
