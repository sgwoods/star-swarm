import { describe, expect, it } from 'vitest';

import type { Rules } from '../../src/content/schema.js';
import { packManifestSchema, rulesSchema } from '../../src/content/schema.js';
import {
  allowsAttacks,
  allowsEntryBombing,
  allowsTransform,
  challengeOrdinal,
  extraLivesEarned,
  isChallengeStage,
  isContinuousBombing,
  nearestBombVector,
  normalStageOrdinal,
  resolveBombCooldown,
  resolveBombVectors,
  resolveDifficultyRow,
  resolveLaunchCredit,
  resolveLaunchRate,
  resolveMaxDivers,
  resolveStageId,
  resolveStageSequence,
  resolveTransformType,
  transformGroupIndex,
} from '../../src/content/rules.js';
import { minimalRules } from '../helpers/rules.js';

/**
 * The rules layer is where "rank is a selector, not a multiplier" and "each
 * table plateaus on its own terms" either hold or quietly stop holding
 * (`docs/DESIGN.md` section 6). These tests are the place that notices.
 */

function rulesWith(overrides: Record<string, unknown> = {}): Rules {
  return rulesSchema.parse({ ...minimalRules(), ...overrides });
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

describe('reading a row into an attack', () => {
  /** Two rows that differ in every field the attack reads. */
  const rules = rulesWith({
    enemies: {
      maxBullets: 8,
      bullet: { speed: 2, width: 1, height: 3 },
      dive: { baseLaunchRate: 1, launchCost: 8, bumpAfterFrames: 300 },
      bombing: {
        entryFromStage: 2,
        continuousCooldownFrames: 12,
        vectors: [-20, 0, 20],
        altVectors: [-40, 0, 40],
      },
    },
    difficulty: {
      defaultRank: 'A',
      ranks: {
        A: {
          stageTable: {
            rows: [
              {
                launchRates: { bee: 0 },
                maxDivers: 2,
                maxDiversBump: 2,
                continuousBombingAt: 6,
              },
              {
                launchRates: { bee: 4, boss: 1 },
                maxDivers: 3,
                maxDiversBump: 5,
                continuousBombingAt: 9,
                reloadBombVectors: true,
              },
            ],
          },
        },
      },
    },
  });
  const row = (stage: number) => resolveDifficultyRow(rules, stage);

  it('picks the row’s limit, then its bump, and never a value in between', () => {
    // Two literal numbers and a frame count: the one thing it must not do is ramp
    // from the first to the second, because the table is not a curve.
    expect(resolveMaxDivers(rules, row(2), 0)).toBe(3);
    expect(resolveMaxDivers(rules, row(2), 299)).toBe(3);
    expect(resolveMaxDivers(rules, row(2), 300)).toBe(5);
    expect(resolveMaxDivers(rules, row(2), 10_000)).toBe(5);
    // A row whose two limits agree never changes, however long the stage runs.
    expect([0, 300, 10_000].map((f) => resolveMaxDivers(rules, row(1), f))).toEqual([2, 2, 2]);
    expect(resolveMaxDivers(rules, undefined, 0)).toBe(0);
  });

  it('reads a launch counter literally, with a rate of zero still attacking', () => {
    // The arcade's stage 1 has every counter at zero and dives regardless, so zero
    // has to be the floor of the ramp rather than silence — and a higher counter
    // has to launch more often, without anything multiplying.
    expect(resolveLaunchCredit(rules, row(1), 'bee')).toBe(1);
    expect(resolveLaunchCredit(rules, row(2), 'bee')).toBe(5);
    expect(resolveLaunchCredit(rules, row(2), 'boss')).toBe(2);
    // A role the row says nothing about does not attack at all.
    expect(resolveLaunchCredit(rules, row(1), 'boss')).toBe(0);
    expect(resolveLaunchCredit(rules, undefined, 'bee')).toBe(0);
  });

  it('turns bombing continuous at the row’s own live-enemy count', () => {
    expect([7, 6, 1].map((alive) => isContinuousBombing(row(1), alive))).toEqual([
      false,
      true,
      true,
    ]);
    // The threshold is the row's, so the same count answers differently per stage.
    expect(isContinuousBombing(row(2), 7)).toBe(true);
    // A row of zero — every challenge-stage row — disables it.
    const quiet = rulesWith({
      difficulty: {
        defaultRank: 'A',
        ranks: { A: { stageTable: { rows: [{ continuousBombingAt: 0 }] } } },
      },
    });
    expect(isContinuousBombing(resolveDifficultyRow(quiet, 1), 1)).toBe(false);
  });

  it('replaces an alien’s own delay only while bombing is continuous', () => {
    expect(resolveBombCooldown(rules, 40, false)).toBe(40);
    expect(resolveBombCooldown(rules, 40, true)).toBe(12);
    // With no continuous delay declared, the threshold changes nothing.
    const plain = rulesWith();
    expect(resolveBombCooldown(plain, 40, true)).toBe(40);
  });

  it('swaps the bombing vectors when the row says to reload them', () => {
    expect(resolveBombVectors(rules, row(1))).toEqual([-20, 0, 20]);
    expect(resolveBombVectors(rules, row(2))).toEqual([-40, 0, 40]);
    // A pack with no second table keeps the first whatever the row says.
    const one = rulesWith({
      enemies: {
        maxBullets: 8,
        bullet: { speed: 2, width: 1, height: 3 },
        bombing: { vectors: [7] },
      },
    });
    expect(resolveBombVectors(one, row(2))).toEqual([7]);
  });

  it('snaps an aim to the nearest vector, the short way round the circle', () => {
    const vectors = [-20, 0, 20];
    expect([-19, -9, 0, 9, 19, 60].map((h) => nearestBombVector(vectors, h))).toEqual([
      -20, 0, 0, 0, 20, 20,
    ]);
    // 355° is 5° short of zero, not 355° away from it: the comparison goes the
    // short way round the circle.
    expect(nearestBombVector(vectors, 355)).toBe(0);
    // An exact tie — 350° is 10° from both −20 and 0 — takes the earlier entry, so
    // the choice is a function of the table's order and never of rounding.
    expect(nearestBombVector(vectors, 350)).toBe(-20);
    expect(nearestBombVector([], 0)).toBe(0);
  });

  it('allows entry bombing only from the stage the pack names', () => {
    // Stages 3 and 7 are challenge stages under these rules and are excluded
    // whatever the pack names, which is the next assertion's business.
    expect([1, 2, 4, 40].map((stage) => allowsEntryBombing(rules, stage))).toEqual([
      false,
      true,
      true,
      true,
    ]);
    // Omitted means an entering enemy never bombs, on any stage.
    expect(allowsEntryBombing(rulesWith(), 40)).toBe(false);
  });

  it('never allows it on a challenge stage, whatever the stage number', () => {
    // A challenge flyer never settles, so it is `entering` for its whole life —
    // the one state entry bombing applies to. Without the stage-kind gate the
    // forty of them would bomb from the second challenge stage onwards.
    expect([3, 7, 11, 35].some((stage) => allowsEntryBombing(rules, stage))).toBe(false);
    expect([3, 7, 11, 35].some((stage) => allowsAttacks(rules, stage))).toBe(false);
    expect([1, 2, 4, 5, 40].every((stage) => allowsAttacks(rules, stage))).toBe(true);
  });
});

describe('when a transform may fire', () => {
  const rules = rulesWith({
    transform: {
      enabled: true,
      fromStage: 4,
      stagesPerType: 4,
      remainingThreshold: 10,
      types: ['t1', 't2', 't3'],
      groupSize: 3,
    },
  });

  it('fires only below the threshold, never at it', () => {
    // The direction of the test is the correction of report section 7.6: the ROM
    // returns while the live count is greater than *or equal to* the threshold.
    expect(allowsTransform(rules, 4, 11)).toBe(false);
    expect(allowsTransform(rules, 4, 10)).toBe(false);
    expect(allowsTransform(rules, 4, 9)).toBe(true);
  });

  it('fires only from its own stage, and never on a challenge stage', () => {
    expect([1, 2, 4, 5].map((stage) => allowsTransform(rules, stage, 1))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    // Stage 3 and stage 7 are challenge stages: the arcade's enabling value is
    // zero there, which is why stage 4 rather than stage 3 is the first.
    expect([3, 7].map((stage) => allowsTransform(rules, stage, 1))).toEqual([false, false]);
  });

  it('does not fire for a pack that has named no transform aliens', () => {
    const empty = rulesWith({
      transform: { enabled: true, fromStage: 1, remainingThreshold: 10, types: [] },
    });
    expect(allowsTransform(empty, 4, 1)).toBe(false);
    // Nor for rules with no transform block at all, or a disabled one.
    expect(allowsTransform(rulesWith(), 4, 1)).toBe(false);
    const off = rulesWith({ transform: { enabled: false, types: ['t1'] } });
    expect(allowsTransform(off, 4, 1)).toBe(false);
  });
});

describe('extra lives', () => {
  const rules = rulesWith({
    extraLives: {
      award: { mode: 'thresholds', first: 20000, second: 70000, repeat: 70000 },
      thresholdUnit: 10000,
      thresholdModulus: 100,
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

  it('stops once the threshold outgrows the digits it is compared against', () => {
    // 980,000 is the last one these thresholds reach: the next is 1,050,000,
    // which `floor(score / 10,000) mod 100` can never produce.
    expect(extraLivesEarned(rules, 979999, 980000)).toBe(1);
    expect(extraLivesEarned(rules, 980000, 5000000)).toBe(0);
  });

  it('awards nothing at all when the rules say none', () => {
    expect(extraLivesEarned(rulesWith(), 0, 1000000)).toBe(0);
  });
});
