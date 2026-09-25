import { describe, expect, it } from 'vitest';

import type { Rules } from '../../src/content/schema.js';
import { packManifestSchema, rulesSchema } from '../../src/content/schema.js';
import {
  challengeOrdinal,
  extraLivesEarned,
  isChallengeStage,
  normalStageOrdinal,
  resolveDifficultyRow,
  resolveLaunchRate,
  resolveStageId,
  resolveStageSequence,
  resolveTransformType,
  transformGroupIndex,
} from '../../src/content/rules.js';

/**
 * The rules layer is where "rank is a selector, not a multiplier" and "each
 * table plateaus on its own terms" either hold or quietly stop holding
 * (`docs/DESIGN.md` section 6). These tests are the place that notices.
 */

function rulesWith(overrides: Record<string, unknown> = {}): Rules {
  return rulesSchema.parse({
    id: 'r',
    lives: { default: 3 },
    extraLives: { award: { mode: 'none' } },
    player: { speed: 1.5, maxShots: 2 },
    enemies: { maxBullets: 8 },
    challengeStages: { firstStage: 3, everyStages: 4 },
    difficulty: { defaultRank: 'A', ranks: { A: { stageTable: { rows: [] } } } },
    ...overrides,
  });
}

describe('challenge-stage cadence', () => {
  const rules = rulesWith();

  it('makes stages 3, 7, 11 challenge stages and nothing else', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 11, 12].filter((n) => isChallengeStage(rules, n))).toEqual([
      3, 7, 11,
    ]);
  });

  it('numbers challenge stages from zero', () => {
    expect(challengeOrdinal(rules, 3)).toBe(0);
    expect(challengeOrdinal(rules, 7)).toBe(1);
    expect(challengeOrdinal(rules, 35)).toBe(8);
  });

  it('numbers normal stages separately, skipping the challenge ones', () => {
    expect([1, 2, 4, 5, 6, 8].map((n) => normalStageOrdinal(rules, n))).toEqual([0, 1, 2, 3, 4, 5]);
    // Stage 22 is the seventeenth normal stage, which is where the arcade
    // entry-script sequence runs out and starts cycling.
    expect(normalStageOrdinal(rules, 22)).toBe(16);
    expect(normalStageOrdinal(rules, 24)).toBe(17);
  });

  it('treats every stage as normal when challenge stages are off', () => {
    const off = rulesWith({ challengeStages: { enabled: false, firstStage: 3, everyStages: 4 } });
    expect(isChallengeStage(off, 3)).toBe(false);
    expect(normalStageOrdinal(off, 3)).toBe(2);
  });
});

describe('rank selects a whole data set', () => {
  const rules = rulesWith({
    difficulty: {
      defaultRank: 'A',
      ranks: {
        A: { stageTable: { rows: [{ maxDivers: 2 }, { maxDivers: 3 }], repeatLast: 1 } },
        D: { stageTable: { rows: [{ maxDivers: 5 }, { maxDivers: 6 }], repeatLast: 1 } },
      },
    },
  });

  it('reads a different table per rank rather than scaling one', () => {
    expect(resolveDifficultyRow(rules, 1)?.maxDivers).toBe(2);
    expect(resolveDifficultyRow(rules, 1, 'D')?.maxDivers).toBe(5);
  });

  it('falls back to the default rank when none is named', () => {
    expect(resolveDifficultyRow(rules, 2)?.maxDivers).toBe(3);
  });

  it('has nothing to say about a rank the rules do not declare', () => {
    expect(resolveDifficultyRow(rules, 1, 'Z')).toBeUndefined();
  });

  it('reads per-role launch rates by role id', () => {
    const byRole = rulesWith({
      difficulty: {
        defaultRank: 'A',
        ranks: { A: { stageTable: { rows: [{ launchRates: { drone: 2, warden: 6 } }] } } },
      },
    });
    expect(resolveLaunchRate(byRole, 1, 'warden')).toBe(6);
    expect(resolveLaunchRate(byRole, 1, 'nobody')).toBe(0);
  });
});

describe('sequences plateau independently of the difficulty ramp', () => {
  const manifest = packManifestSchema.parse({
    id: 'p',
    name: 'P',
    stageSequence: {
      normal: { rows: ['n1', 'n2', 'n3', 'n4'], repeatLast: 3 },
      challenge: { rows: ['c1', 'c2'], repeatLast: 2 },
    },
  });

  const rules = rulesWith({
    difficulty: {
      defaultRank: 'A',
      ranks: {
        A: { stageTable: { rows: [{ maxDivers: 1 }, { maxDivers: 2 }], repeatLast: 2 } },
        B: {
          stageTable: { rows: [{ maxDivers: 9 }], repeatLast: 1 },
          stageSequence: { normal: { rows: ['n4', 'n3'], repeatLast: 1 } },
        },
      },
    },
  });

  it('walks normal and challenge stages along separate sequences', () => {
    expect(resolveStageId(manifest, rules, 1)).toBe('n1');
    expect(resolveStageId(manifest, rules, 2)).toBe('n2');
    expect(resolveStageId(manifest, rules, 3)).toBe('c1');
    expect(resolveStageId(manifest, rules, 4)).toBe('n3');
    expect(resolveStageId(manifest, rules, 7)).toBe('c2');
  });

  it('cycles the sequence past its end without touching the difficulty ramp', () => {
    // Five normal stages in, the four-row sequence cycles its last three.
    expect(resolveStageId(manifest, rules, 6)).toBe('n2');
    expect(resolveStageId(manifest, rules, 8)).toBe('n3');
    // Meanwhile the two-row difficulty table is on its own period.
    expect(resolveDifficultyRow(rules, 6)?.maxDivers).toBe(2);
    expect(resolveDifficultyRow(rules, 7)?.maxDivers).toBe(1);
  });

  it('lets a rank override half the sequence and inherit the other half', () => {
    const sequence = resolveStageSequence(manifest, rules, 'B');
    expect(sequence.normal.rows).toEqual(['n4', 'n3']);
    expect(sequence.challenge.rows).toEqual(['c1', 'c2']);
    expect(resolveStageId(manifest, rules, 1, 'B')).toBe('n4');
    expect(resolveStageId(manifest, rules, 3, 'B')).toBe('c1');
  });
});

describe('transforms', () => {
  const rules = rulesWith({
    transform: {
      enabled: true,
      fromStage: 4,
      stagesPerType: 4,
      types: ['t1', 't2', 't3'],
      groupSize: 3,
    },
  });

  it('does not fire before its first stage', () => {
    expect(transformGroupIndex(rules, 3)).toBeUndefined();
    expect(resolveTransformType(rules, 3)).toBeUndefined();
  });

  it('holds each type for four stages, then cycles', () => {
    expect([4, 6, 8, 12, 14, 16].map((n) => resolveTransformType(rules, n))).toEqual([
      't1',
      't1',
      't2',
      't3',
      't3',
      't1',
    ]);
  });

  it('gives nothing when the pack has not named its transform aliens yet', () => {
    const empty = rulesWith({ transform: { enabled: true, fromStage: 4, types: [] } });
    expect(resolveTransformType(empty, 4)).toBeUndefined();
  });
});

describe('extra lives', () => {
  const rules = rulesWith({
    extraLives: {
      award: { mode: 'thresholds', first: 20000, second: 70000, repeat: 70000 },
      stopAfterScore: 1000000,
    },
  });

  it('awards nothing below the first threshold', () => {
    expect(extraLivesEarned(rules, 0, 19999)).toBe(0);
  });

  it('awards one on crossing each threshold', () => {
    expect(extraLivesEarned(rules, 19999, 20000)).toBe(1);
    expect(extraLivesEarned(rules, 69999, 70000)).toBe(1);
    expect(extraLivesEarned(rules, 70000, 140000)).toBe(1);
  });

  it('awards two when one hit jumps two thresholds', () => {
    expect(extraLivesEarned(rules, 0, 70000)).toBe(2);
  });

  it('stops awarding past the ceiling', () => {
    expect(extraLivesEarned(rules, 999999, 5000000)).toBe(0);
  });

  it('awards nothing at all when the rules say none', () => {
    expect(extraLivesEarned(rulesWith(), 0, 1000000)).toBe(0);
  });
});
