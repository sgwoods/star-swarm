import { join, resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { readPackSource } from '../../src/content/fs.js';
import type { LoadedPack } from '../../src/content/loader.js';
import { loadPack } from '../../src/content/loader.js';
import {
  averageStepDistance,
  challengeOrdinal,
  extraLivesEarned,
  isChallengeStage,
  provenanceOf,
  resolveDifficultyRow,
  resolveExtraLifeAward,
  starfieldSpeedByte,
  unknownProvenancePaths,
} from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { resolveRow } from '../../src/content/schema.js';
import { windowGapsX } from '../../src/sim/collision.js';

/**
 * The shipped Classic pack, checked against the verification record in
 * `docs/reference/arcade-reference.md`. `AGENTS.md`: change a number in the plan
 * and the reference changes with it — this test is the third leg, so a number
 * cannot change in `packs/classic/rules.json` without someone noticing.
 *
 * The content directories are deliberately empty at Milestone 1; sibling tasks
 * fill them. What is here is the shape, the formation and the four rank tables.
 */

const PACK_DIR = resolve(import.meta.dirname, '..', '..', 'packs', 'classic');

let pack: LoadedPack;
let rules: Rules;

beforeAll(() => {
  const { source, errors } = readPackSource(PACK_DIR);
  expect(errors).toEqual([]);
  if (source === undefined) throw new Error('classic pack could not be read');
  const result = loadPack(source);
  if (!result.ok)
    throw new Error(`classic pack failed to load:\n${JSON.stringify(result.errors, null, 2)}`);
  pack = result.pack;
  if (pack.rules === undefined) throw new Error('classic pack has no rules.json');
  rules = pack.rules;
});

describe('the pack itself', () => {
  it('loads with its rules and no content yet', () => {
    expect(pack.id).toBe('classic');
    expect(pack.aliens.size).toBe(0);
    expect(pack.stages.size).toBe(0);
    expect(rules.id).toBe('classic');
  });

  it('is still a valid pack with every content directory empty', () => {
    const { source } = readPackSource(PACK_DIR);
    expect(source?.documents).toEqual([]);
  });

  it('declares its own role vocabulary rather than borrowing the engine’s', () => {
    expect(Object.keys(pack.manifest.roles).sort()).toEqual(['drone', 'warden', 'wing']);
  });

  it('carries the 40-slot formation of docs/DESIGN.md section 4', () => {
    const formation = pack.formations.get('classic40');
    expect(formation).toBeDefined();
    expect(formation?.slots).toHaveLength(40);

    const byRole = (role: string) => formation?.slots.filter((slot) => slot.role === role) ?? [];
    expect(byRole('warden')).toHaveLength(4);
    expect(byRole('wing')).toHaveLength(16);
    expect(byRole('drone')).toHaveLength(20);

    expect(byRole('warden').map((slot) => slot.column)).toEqual([6, 8, 10, 12]);
    expect(
      byRole('wing')
        .slice(0, 8)
        .map((slot) => slot.column),
    ).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(
      byRole('drone')
        .slice(0, 10)
        .map((slot) => slot.column),
    ).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it('gives each captor its own captive slot, one row above it', () => {
    const formation = pack.formations.get('classic40');
    expect(formation?.captiveSlots).toHaveLength(4);
    for (const captive of formation?.captiveSlots ?? []) {
      const captor = formation?.slots[captive.captor];
      expect(captor?.role).toBe('warden');
      expect(captive.row).toBe((captor?.row ?? 0) - 1);
      expect(captive.column).toBe(captor?.column);
    }
  });

  it('states the two sequence plateau periods, which differ on purpose', () => {
    expect(pack.manifest.stageSequence.normal.repeatLast).toBe(3);
    expect(pack.manifest.stageSequence.challenge.repeatLast).toBe(8);
  });
});

describe('the four rank tables', () => {
  it('ships all four, not one table plus three multipliers', () => {
    expect(Object.keys(rules.difficulty.ranks).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(rules.difficulty.defaultRank).toBe('A');
  });

  it('holds 26 literal rows per rank, cycling the last four', () => {
    for (const rank of Object.values(rules.difficulty.ranks)) {
      expect(rank.stageTable.rows).toHaveLength(26);
      expect(rank.stageTable.repeatLast).toBe(4);
    }
  });

  it('matches the reference for rank A, stage 1', () => {
    expect(resolveDifficultyRow(rules, 1, 'A')).toEqual({
      bombEnable: 0,
      launchRates: { drone: 0, wing: 0, warden: 0 },
      maxDivers: 2,
      maxDiversBump: 2,
      captureRate: 12,
      continuousBombingAt: 6,
      reloadAttackVectors: false,
      reloadBombVectors: false,
    });
  });

  it('matches the reference for rank A, stage 9 — where the vectors first reload', () => {
    expect(resolveDifficultyRow(rules, 9, 'A')).toMatchObject({
      bombEnable: 2,
      launchRates: { drone: 2, wing: 3, warden: 6 },
      maxDivers: 3,
      maxDiversBump: 4,
      captureRate: 6,
      continuousBombingAt: 9,
      reloadAttackVectors: true,
      reloadBombVectors: false,
    });
  });

  it('keeps the deliberate breathers, so the ramp is not a monotonic curve', () => {
    // Rank A stages 10 and 18, rank B stages 6 and 14, rank C stage 10.
    const easier = (rank: string, stage: number, key: 'bombEnable' | 'maxDivers') =>
      (resolveDifficultyRow(rules, stage, rank)?.[key] ?? 0) <
      (resolveDifficultyRow(rules, stage - 1, rank)?.[key] ?? 0);
    expect(easier('A', 10, 'bombEnable')).toBe(true);
    expect(easier('A', 18, 'bombEnable')).toBe(true);
    expect(easier('B', 6, 'bombEnable')).toBe(true);
    expect(easier('B', 14, 'bombEnable')).toBe(true);
    expect(easier('C', 10, 'bombEnable')).toBe(true);
  });

  it('plateaus by cycling rows 23–26 forever, not by freezing at the hardest', () => {
    for (const rank of ['A', 'B', 'C', 'D']) {
      expect(resolveDifficultyRow(rules, 27, rank)).toEqual(resolveDifficultyRow(rules, 23, rank));
      expect(resolveDifficultyRow(rules, 28, rank)).toEqual(resolveDifficultyRow(rules, 24, rank));
      expect(resolveDifficultyRow(rules, 31, rank)).toEqual(resolveDifficultyRow(rules, 23, rank));
      expect(resolveDifficultyRow(rules, 200, rank)).toEqual(
        resolveDifficultyRow(rules, 23 + ((200 - 27) % 4), rank),
      );
    }
    // Stage 23 is a challenge row, so the plateau really does replay one.
    expect(resolveDifficultyRow(rules, 27, 'A')?.maxDivers).toBe(0);
  });

  it('sorts into two easier and two harder ranks, as the reference cross-check says', () => {
    const last = (rank: string) => resolveDifficultyRow(rules, 26, rank);
    expect(last('A')).toEqual(last('B'));
    expect(last('C')).toEqual(last('D'));
    expect(last('A')).not.toEqual(last('C'));
  });

  it('raises the continuous-bombing threshold from 6 to 12 across rank A', () => {
    expect(resolveDifficultyRow(rules, 1, 'A')?.continuousBombingAt).toBe(6);
    expect(resolveDifficultyRow(rules, 22, 'A')?.continuousBombingAt).toBe(12);
  });
});

describe('the rest of the Classic rules', () => {
  it('caps player shots at 2 in total and enemy bullets at 8 globally', () => {
    expect(rules.player.maxShots).toBe(2);
    expect(rules.player.autoFire).toBe(true);
    expect(rules.enemies.maxBullets).toBe(8);
    expect(rules.dualFighter.bulletsPerShot).toBe(2);
  });

  it('is played on the 224x288 portrait playfield', () => {
    expect(rules.playfield).toEqual({ width: 224, height: 288 });
  });

  it('steps 1 then 2 pixels, which averages the 1.5 px/frame the plan states', () => {
    expect(rules.player.stepPattern).toEqual([1, 2]);
    expect(averageStepDistance(rules)).toBe(1.5);
  });

  it('converts the verified ROM sprite-X limits with a single origin', () => {
    // `$12`…`$E1` for a single fighter and `$D1` for a dual one, all measured
    // from the same origin. The origin itself is provisional and the assertion
    // below is what pins it: it is `$12`, so the left limit is column 0.
    const origin = 0x12;
    expect(rules.player.minX).toBe(0x12 - origin);
    expect(rules.player.maxX).toBe(0xe1 - origin);
    expect(rules.player.dualMaxX).toBe(0xd1 - origin);
    expect(rules.player.secondShipOffsetX).toBe(0x0f);
  });

  it('tests one shot window for a single fighter and two for a dual one', () => {
    const single = rules.player.shot.windows.single;
    const dual = rules.player.shot.windows.dual;
    expect(single.map((each) => [each.dxMin, each.dxMax])).toEqual([[-5, 5]]);
    expect(dual.map((each) => [each.dxMin, each.dxMax])).toEqual([
      [-6, 4],
      [9, 19],
    ]);
    // The deliberate dead gap, and the 15-unit separation that is the second
    // ship's `$0F` offset.
    expect(windowGapsX([...dual])).toEqual([[5, 8]]);
    expect((dual[1]?.dxMin ?? 0) - (dual[0]?.dxMin ?? 0)).toBe(0x0f);
  });

  it('doubles the ROM’s half-scaled Y into playfield pixels for the fighter', () => {
    // Δy ∈ [−3, +3] in the ROM's units, so [−6, +6] here.
    expect(rules.player.hitWindow).toEqual({ dxMin: -6, dxMax: 6, dyMin: -6, dyMax: 6 });
  });

  it('starts three fighters on the factory bonus setting', () => {
    expect(rules.lives.default).toBe(3);
    expect(rules.lives.options).toEqual([2, 3, 4, 5]);
    expect(rules.extraLives.setting).toBe(1);
    expect(rules.extraLives.stopAfterScore).toBe(1_000_000);
  });

  it('resolves the setting against the starting-fighter count, not against itself', () => {
    expect(resolveExtraLifeAward(rules)).toEqual(rules.extraLives.award);
    expect(resolveExtraLifeAward(rules, 5)).toMatchObject({
      first: 30_000,
      second: 120_000,
      repeat: 120_000,
    });
  });

  it('computes the starfield speed byte with the verified ROM formula', () => {
    // `$40 + ((min(stage, 16) x 4) AND $70)`: five bytes, one step every four
    // stages, plateauing from stage 16.
    expect(rules.starfield?.speed).toEqual({
      base: 0x40,
      stageMultiplier: 4,
      mask: 0x70,
      plateauStage: 16,
    });
    expect([1, 4, 8, 12, 16, 40].map((stage) => starfieldSpeedByte(rules, stage))).toEqual([
      0x40, 0x50, 0x60, 0x70, 0x80, 0x80,
    ]);
  });

  it('starts every stage with the same three bomber timers, keyed by role', () => {
    expect(rules.enemies.bomberReadyTimers).toEqual({ drone: 22, wing: 2, warden: 2 });
  });

  it('awards extra lives at 20,000 and 70,000, then every 70,000, stopping at a million', () => {
    expect(rules.extraLives.award).toMatchObject({ first: 20000, second: 70000, repeat: 70000 });
    expect(extraLivesEarned(rules, 0, 70000)).toBe(2);
    expect(extraLivesEarned(rules, 1000000, 2000000)).toBe(0);
  });

  it('offers a threshold set per starting-ship count, because the cabinet did', () => {
    const forFive = rules.extraLives.options.filter((option) => option.startingLives.includes(5));
    const forThree = rules.extraLives.options.filter((option) => option.startingLives.includes(3));
    expect(forFive).toHaveLength(8);
    expect(forThree).toHaveLength(8);
    expect(forFive[1]?.award).toMatchObject({ first: 30000, second: 120000, repeat: 120000 });
    expect(forThree.at(-1)?.award.mode).toBe('none');
  });

  it('puts challenge stages at 3 and every 4th after it', () => {
    expect([3, 7, 11, 15].every((n) => isChallengeStage(rules, n))).toBe(true);
    expect([1, 2, 4, 12].some((n) => isChallengeStage(rules, n))).toBe(false);
  });

  it('scores a diving captor 400, 800 and 1,600 from a base and a latched bonus', () => {
    const base = 150;
    const doubled = base * rules.scoring.movingMultiplier;
    const bonus = rules.scoring.escortBonus.byEscortCount;
    expect(rules.scoring.escortBonus.latchedAtLaunch).toBe(true);
    expect([0, 1, 2].map((escorts) => doubled + (bonus[escorts] ?? 0))).toEqual([400, 800, 1600]);
  });

  it('steps the challenge group bonus by challenge-stage index and holds it at 3,000', () => {
    const groupBonus = rules.scoring.challenge?.groupBonus;
    expect(groupBonus).toBeDefined();
    if (groupBonus === undefined) return;
    const at = (stage: number) => resolveRow(groupBonus, challengeOrdinal(rules, stage));
    expect([3, 7, 11, 15, 19, 23, 27, 31, 99].map(at)).toEqual([
      1000, 1000, 1500, 1500, 2000, 2000, 3000, 3000, 3000,
    ]);
  });

  it('replaces the per-hit bonus with the perfect one rather than adding to it', () => {
    expect(rules.scoring.challenge?.perHit).toBe(100);
    expect(rules.scoring.challenge?.perfect).toBe(10000);
    expect(rules.scoring.challenge?.perfectReplacesPerHit).toBe(true);
    // A perfect first challenge stage: 5 groups × 1,000 + 10,000 = 15,000.
    const groups =
      5 * (resolveRow(rules.scoring.challenge?.groupBonus ?? { rows: [], repeatLast: 1 }, 0) ?? 0);
    expect(groups + (rules.scoring.challenge?.perfect ?? 0)).toBe(15000);
  });

  it('leaves the two unresolved arcade questions open rather than guessing', () => {
    // Whether challenge enemies pay out on impact — reference section 11 item 2.
    expect(rules.scoring.challenge?.impactAward).toBeNull();
    // Whether two captured fighters can be held at once — item 3.
    expect(rules.capture.maxHeldTotal).toBeNull();
    expect(rules.capture.slotsPerCaptor).toBe(1);
  });

  it('carries the capture rules that change the state machine', () => {
    expect(rules.capture.lastFighterCaptureEndsGame).toBe(true);
    expect(rules.capture.disablesFireWhileBeamed).toBe(true);
    expect(rules.rescue.requiresCaptorAttacking).toBe(true);
  });

  it('cycles three transform types on a four-stage period, with a 1,000/2,000/3,000 bonus', () => {
    expect(rules.transform).toMatchObject({
      enabled: true,
      fromStage: 4,
      stagesPerType: 4,
      groupSize: 3,
    });
    expect(rules.transform?.remainingThreshold).toBe(10);
    const bonus = rules.scoring.transformGroupBonus;
    expect(bonus?.rows).toEqual([1000, 2000, 3000]);
    // Group 3 (stage 16) starts the cycle again at 1,000.
    expect([0, 1, 2, 3].map((g) => resolveRow(bonus ?? { rows: [], repeatLast: 1 }, g))).toEqual([
      1000, 2000, 3000, 1000,
    ]);
  });

  it('has no transform aliens yet, which the loader is content with', () => {
    expect(rules.transform?.types).toEqual([]);
  });
});

/**
 * `AGENTS.md`: anywhere an arcade value is written down, it is marked verified
 * or provisional, because that marking is what decides whether a later
 * correction may change it. The values used to live in a sim-side module with
 * the marking in a comment; they live in `packs/classic/rules.json` now, so the
 * marking is data and this is what stops it being lost in the move.
 */
describe('how far each value may be trusted', () => {
  const confidenceOf = (path: string): string | undefined => provenanceOf(rules, path)?.confidence;

  it('marks every value that names a ROM routine as verified', () => {
    for (const path of [
      'playfield',
      'lives.default',
      'extraLives.award',
      'extraLives.setting',
      'extraLives.options',
      'player.stepPattern',
      'player.maxShots',
      'player.autoFire',
      'player.minX',
      'player.maxX',
      'player.dualMaxX',
      'player.secondShipOffsetX',
      'player.hitWindow',
      'player.shot.windows.single[0].dxMin',
      'player.shot.windows.dual[0].dxMin',
      'player.shot.windows.dual[1].dxMin',
      'enemies.maxBullets',
      'enemies.bomberReadyTimers',
      'starfield.speed',
    ]) {
      expect([path, confidenceOf(path)]).toEqual([path, 'verified']);
    }
  });

  it('keeps the values the reference does not cover legibly provisional', () => {
    for (const path of [
      'extraLives.stopAfterScore',
      'player.y',
      'player.width',
      'player.height',
      'player.respawnFrames',
      'player.shot.speed',
      'player.shot.width',
      'player.shot.height',
      'player.shot.muzzleOffsetX',
      'player.shot.windows.single[0].dyMin',
      'player.shot.windows.dual[0].dyMin',
      'enemies.bullet.speed',
      'enemies.bullet.width',
      'enemies.bullet.height',
    ]) {
      expect([path, confidenceOf(path)]).toEqual([path, 'provisional']);
    }
  });

  it('marks a window per half, because Δx is verified and Δy is not', () => {
    // The distinction would be lost by marking the window as one value, and it
    // is the whole reason the Δy half may be retuned and the Δx half may not.
    for (const mode of ['single', 'dual'] as const) {
      rules.player.shot.windows[mode].forEach((_each, index) => {
        const at = `player.shot.windows.${mode}[${String(index)}]`;
        expect(confidenceOf(`${at}.dxMax`)).toBe('verified');
        expect(confidenceOf(`${at}.dyMax`)).toBe('provisional');
      });
    }
  });

  it('gives every provisional value a note saying why it is one', () => {
    for (const [path, entry] of Object.entries(rules.provenance)) {
      expect([path, typeof entry.note]).toEqual([path, 'string']);
    }
  });

  it('names only fields that exist, which the loader also enforces', () => {
    expect(unknownProvenancePaths(rules)).toEqual([]);
  });
});

describe('packs/ as a whole', () => {
  it('contains only the classic pack for now', () => {
    expect(join(PACK_DIR, '..')).toContain('packs');
    expect(pack.origin).toBe(PACK_DIR);
  });
});
