import { join, resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { readPackSource } from '../../src/content/fs.js';
import type { LoadedPack } from '../../src/content/loader.js';
import { loadPack } from '../../src/content/loader.js';
import {
  allowsEntryBombing,
  averageStepDistance,
  challengeOrdinal,
  extraLivesEarned,
  isChallengeStage,
  provenanceOf,
  resolveDifficultyRow,
  resolveExtraLifeAward,
  resolveLaunchCredit,
  resolveStageId,
  starfieldSpeedByte,
  unknownProvenancePaths,
} from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { formationAxes, resolveRow } from '../../src/content/schema.js';
import { windowGapsX } from '../../src/sim/collision.js';

/**
 * The shipped Classic pack, checked against the verification record in
 * `docs/reference/arcade-reference.md`. `AGENTS.md`: change a number in the plan
 * and the reference changes with it — this test is the third leg, so a number
 * cannot change in `packs/classic/rules.json` without someone noticing.
 *
 * The content directories fill one Milestone 1 task at a time; what is checked
 * here is the shape, the formation and the four rank tables. The content itself
 * has its own tests — `tests/unit/classic-sounds.test.ts` for `sounds/`,
 * `tests/unit/classic-paths.test.ts` for `paths/` and
 * `tests/unit/sprites.test.ts` for `sprites/`.
 */

const PACK_DIR = resolve(import.meta.dirname, '..', '..', 'packs', 'classic');

/** Stand-in for a table that is absent, so a lookup is `undefined` rather than a throw. */
const EMPTY_TABLE = { rows: [] as number[], repeatLast: 1 };

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
  it('loads with its rules', () => {
    expect(pack.id).toBe('classic');
    expect(rules.id).toBe('classic');
    // The three formation roles, the three transform types and the captured
    // fighter; and five entry scripts for the normal stages through 8 — five
    // rather than six because stage 8 replays stage 4's script row — plus the
    // eight challenge scripts.
    // `tests/unit/classic-content.test.ts` checks what is in them; here it is only
    // that they are there.
    expect(pack.aliens.size).toBe(7);
    expect(pack.stages.size).toBe(13);
  });

  it('holds exactly the content its landed tasks put there, and loads all of it', () => {
    // Two things at once, because the directories fill one task at a time and
    // each answer goes stale on its own schedule:
    //
    //  - *which* directories have landed. All five now have content; what is in
    //    each has its own test — `classic-sounds.test.ts`, `classic-paths.test.ts`,
    //    `sprites.test.ts` and `classic-content.test.ts`.
    //  - that nothing on disk is silently dropped on the way in, which a list of
    //    kinds cannot see. The empty-tree case is covered by
    //    `tests/unit/validate-packs.test.ts`.
    const { source } = readPackSource(PACK_DIR);
    if (source === undefined) throw new Error('classic pack could not be read');
    const kinds = new Set(source.documents.map((document) => document.kind));
    expect([...kinds].sort()).toEqual(['aliens', 'paths', 'sounds', 'sprites', 'stages']);

    const onDisk = source.documents.length;
    const loaded =
      pack.aliens.size + pack.paths.size + pack.stages.size + pack.sprites.size + pack.sounds.size;
    expect(loaded).toBe(onDisk);

    // Every remaining directory is now referenced by something — the manifest's
    // `sounds` map, the aliens' sprites, the stage's paths and the sequence's
    // stage — so dropping any one of them is a load failure rather than a shrug.
    // That is the reference pass doing its job; `content-loader.test.ts` covers
    // the individual messages.
    for (const kind of ['aliens', 'paths', 'sounds', 'sprites', 'stages'] as const) {
      const without = source.documents.filter((document) => document.kind !== kind);
      expect(loadPack({ ...source, documents: without }).ok, kind).toBe(false);
    }
  });

  it('declares its own role vocabulary rather than borrowing the engine’s', () => {
    expect(Object.keys(pack.manifest.roles).sort()).toEqual([
      'captive',
      'drone',
      'ensign',
      'manta',
      'scourge',
      'warden',
      'wing',
    ]);
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
    const rowSpacing = formation?.grid?.rowSpacing ?? 1;
    for (const captive of formation?.captiveSlots ?? []) {
      const captor = formation?.slots[captive.captor];
      expect(captor?.role).toBe('warden');
      // One row step above the warden row, in the same column. Row indices are in
      // a 4 px unit rather than one-per-row, because the verified resting row gaps
      // are not uniform — see `packs/classic/README.md`.
      expect(captive.row).toBeLessThan(captor?.row ?? 0);
      expect((captor?.row ?? 0) - captive.row).toBe(16 / rowSpacing);
      expect(captive.column).toBe(captor?.column);
    }
  });

  it('maps the formation onto the verified column positions', () => {
    const formation = pack.formations.get('classic40');
    const grid = formation?.grid;
    expect(grid).toBeDefined();
    const columns = formationAxes(formation!).columns.map(
      (column) => (grid?.originX ?? 0) + column * (grid?.columnSpacing ?? 0),
    );
    // Reference section 5: ten column origins landing at screen x 32…176, pitch
    // 16 — a 160 px formation with 32 px of margin each side, which is exactly
    // the sway's amplitude and the breathe's outermost displacement.
    expect(columns).toEqual([32, 48, 64, 80, 96, 112, 128, 144, 160, 176]);
    expect(rules.formation.sway?.amplitude).toBe(32);
  });

  it('states each sequence plateau period on its own terms', () => {
    // The two halves fold at different stages — the entry choreography cycles its
    // last three from stage 24, the challenge scripts cycle all eight — so the
    // periods are stated per table and never derived from one another.
    expect(pack.manifest.stageSequence.challenge.repeatLast).toBe(8);
    // The normal half holds the six normal stages through 8, which is the first six
    // of the reference's seventeen. Cycling the last three is a property of the
    // whole table, so `repeatLast` stays 1 until rows 7–17 land rather than
    // asserting a plateau three rows early.
    expect(pack.manifest.stageSequence.normal.rows).toHaveLength(6);
    expect(pack.manifest.stageSequence.normal.repeatLast).toBe(1);
  });
});

/**
 * The challenge-stage scripts, against reference section 8.
 *
 * Structure is confirmed there — eight distinct scripts cycling every eight
 * challenge stages, forty enemies in five groups of eight, never shooting. The
 * geometry is not: the ROM's flight vectors were never decoded, so the shapes are
 * this pack's. What this holds is the structure and the one engine-visible
 * property the shapes have to have.
 */
describe('the eight challenge scripts', () => {
  // `pack` is loaded in `beforeAll`, so the ids are read per test, not per file.
  const challengeIds = (): readonly string[] => pack.manifest.stageSequence.challenge.rows;

  it('ships eight, one per challenge stage of the cycle', () => {
    expect(challengeIds()).toEqual([
      'challenge-1',
      'challenge-2',
      'challenge-3',
      'challenge-4',
      'challenge-5',
      'challenge-6',
      'challenge-7',
      'challenge-8',
    ]);
    // And the cycle has the same period as the impact-award table, because the
    // original selects both with `(stage >> 2) AND 7`.
    expect(pack.manifest.stageSequence.challenge.repeatLast).toBe(challengeIds().length);
    expect(rules.scoring.challenge?.impactAward?.rows).toHaveLength(challengeIds().length);
  });

  it('plays one on every challenge stage, cycling on the ninth', () => {
    const at = (stage: number) => resolveStageId(pack.manifest, rules, stage);
    expect([3, 7, 11, 15, 19, 23, 27, 31].map(at)).toEqual(challengeIds());
    expect(at(35)).toBe('challenge-1');
    expect(at(39)).toBe('challenge-2');
  });

  it('is forty enemies in five groups of eight', () => {
    for (const id of challengeIds()) {
      const stage = pack.stages.get(id);
      expect([id, stage?.kind]).toEqual([id, 'challenge']);
      expect([id, stage?.waves.length]).toEqual([id, 5]);
      expect([id, stage?.waves.map((wave) => wave.slots.length)]).toEqual([id, [8, 8, 8, 8, 8]]);
    }
  });

  it('never shoots, and never asks for a formation slot', () => {
    // Reference section 8: "They do not drop any bombs." No `fire` segment in a
    // challenge script, and no `toSlot` either — a challenge flyer leaves.
    for (const id of challengeIds()) {
      for (const wave of pack.stages.get(id)?.waves ?? []) {
        for (const slot of wave.slots) {
          const path = pack.paths.get(slot.path ?? wave.entryPath ?? '');
          expect([id, path]).not.toEqual([id, undefined]);
          const kinds = path?.segments.map((segment) => segment.type) ?? [];
          expect([id, kinds.includes('fire')]).toEqual([id, false]);
          expect([id, kinds.includes('toSlot')]).toEqual([id, false]);
        }
      }
    }
  });

  it('authors all forty slots as single-hit aliens', () => {
    // The reference's one remaining open question is whether four of a challenge
    // stage's forty are two-hit bosses (section 11). The scout report recommends
    // authoring every slot single-hit and building to 19,000 regardless, because
    // the engine rule is what must be right and which aliens a challenge stage
    // holds is one line of pack data. This test is that decision, written down.
    for (const id of challengeIds()) {
      for (const wave of pack.stages.get(id)?.waves ?? []) {
        for (const slot of wave.slots) {
          expect([id, slot.alien, pack.aliens.get(slot.alien)?.hp]).toEqual([id, slot.alien, 1]);
        }
      }
    }
  });

  it('launches them in single file, which is what `trailing` means on a pair', () => {
    // The ROM's trailing flag lives on the second bug of a pair only, so a file of
    // eight sets it on the odd slots and nowhere else.
    for (const id of challengeIds()) {
      for (const wave of pack.stages.get(id)?.waves ?? []) {
        expect([id, wave.slots.map((slot) => slot.trailing)]).toEqual([
          id,
          [false, true, false, true, false, true, false, true],
        ]);
      }
    }
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
      beamStepFrames: 12,
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
      beamStepFrames: 6,
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
    // The award ceiling is the two score digits the ROM compares, not a score:
    // floor(score / 10,000) mod 100 (reference section 3).
    expect(rules.extraLives.thresholdUnit).toBe(10_000);
    expect(rules.extraLives.thresholdModulus).toBe(100);
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

  it('awards extra lives at 20,000 and 70,000, then every 70,000, ending at 980,000', () => {
    expect(rules.extraLives.award).toMatchObject({ first: 20000, second: 70000, repeat: 70000 });
    expect(extraLivesEarned(rules, 0, 70000)).toBe(2);
    // `docs/DESIGN.md` section 11: the award at 980,000 is the last, because the
    // next threshold needs a third digit and can never match.
    expect(extraLivesEarned(rules, 979_999, 980_000)).toBe(1);
    expect(extraLivesEarned(rules, 980_000, 5_000_000)).toBe(0);
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
    // A perfect first challenge stage, the whole sum: 40 hits on impact at 100,
    // 5 groups × 1,000, and the 10,000 perfect bonus replacing 100 × hits.
    // `docs/DESIGN.md` section 4 and reference section 8 both state 19,000.
    const impact = resolveRow(rules.scoring.challenge?.impactAward ?? EMPTY_TABLE, 0) ?? 0;
    const groups = 5 * (resolveRow(rules.scoring.challenge?.groupBonus ?? EMPTY_TABLE, 0) ?? 0);
    expect(40 * impact + groups + (rules.scoring.challenge?.perfect ?? 0)).toBe(19000);
  });

  it('scores challenge hits on impact, cycling rather than plateauing', () => {
    // Reference section 8: 100 on the 1st challenge stage, 160 on the 2nd-8th,
    // and the sprite/score set wraps on the 9th while the group bonus does not.
    const impactAward = rules.scoring.challenge?.impactAward;
    expect(impactAward).not.toBeNull();
    expect(impactAward?.rows).toEqual([100, 160, 160, 160, 160, 160, 160, 160]);
    expect(impactAward?.repeatLast).toBe(8);
    const at = (ordinal: number): number | undefined =>
      resolveRow(impactAward ?? EMPTY_TABLE, ordinal);
    expect([at(0), at(1), at(7)]).toEqual([100, 160, 160]);
    // The ninth challenge stage: per-hit wraps to 100, group bonus stays clamped.
    expect(at(8)).toBe(100);
    expect(resolveRow(rules.scoring.challenge?.groupBonus ?? EMPTY_TABLE, 8)).toBe(3000);
  });

  it('holds exactly one captured fighter, globally', () => {
    // Reference section 7: a single flag gates capture-boss selection and a
    // successful capture never clears it, so one is the hard global maximum.
    expect(rules.capture.maxHeldTotal).toBe(1);
    // The four home slots are one per possible captor, not four captives.
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

  it('names its own three transform types rather than the original’s', () => {
    // Three types on a four-stage period is verified; the names are ours, because
    // `docs/DESIGN.md` section 2 bars the original's. Reference section 6 records
    // which is which.
    expect(rules.transform?.types).toEqual(['scourge', 'manta', 'ensign']);
    expect(rules.transform?.types).toHaveLength(
      rules.scoring.transformGroupBonus?.rows.length ?? 0,
    );
    // A bee, or a butterfly if no bees remain — in that order.
    expect(rules.transform?.fromRoles).toEqual(['drone', 'wing']);
    expect(rules.transform?.perStage).toBe(1);
  });

  it('turns a difficulty row into dives without a multiplier anywhere', () => {
    // The two numbers that decode a row's launch counters into a cadence. They
    // are pack-wide, so changing one changes every stage together — which is the
    // difference between a rule and the difficulty curve the tables are not.
    expect(rules.enemies.dive.baseLaunchRate).toBeGreaterThan(0);
    expect(rules.enemies.dive.launchCost).toBeGreaterThan(rules.enemies.dive.baseLaunchRate);
    // Rank A stage 1 has all three launch counters at 0 and the original
    // certainly dives, so a rate of 0 has to still launch.
    expect(
      resolveLaunchCredit(rules, resolveDifficultyRow(rules, 1, 'A'), 'drone'),
    ).toBeGreaterThan(0);
    // And a role the row says nothing about does not attack at all.
    expect(resolveLaunchCredit(rules, resolveDifficultyRow(rules, 1, 'A'), 'scourge')).toBe(0);
  });

  it('bombs on entry from stage 2, never on stage 1, and never on a challenge stage', () => {
    expect(rules.enemies.bombing.entryFromStage).toBe(2);
    expect(allowsEntryBombing(rules, 1)).toBe(false);
    expect([2, 4, 5, 20].every((stage) => allowsEntryBombing(rules, stage))).toBe(true);
    // A challenge flyer is `entering` for its whole life, which is the one state
    // entry bombing applies to — so without this the forty of them would bomb
    // (reference section 8: "They do not drop any bombs").
    expect([3, 7, 11, 35].some((stage) => allowsEntryBombing(rules, stage))).toBe(false);
  });

  it('flies divers back into the formation from above the top of the screen', () => {
    // Confirmed behaviour (reference section 5): a diver that leaves the bottom
    // re-enters from the top. The return path homes with `toSlot` and nothing
    // else, which is what keeps one homing implementation in the simulation.
    expect(rules.enemies.dive.returnPath).toBe('dive-return');
    expect(rules.enemies.dive.reentryY).toBeLessThan(0);
    const returnPath = pack.paths.get(rules.enemies.dive.returnPath ?? '');
    expect(returnPath?.segments.map((segment) => segment.type)).toEqual(['toSlot']);
    expect(returnPath?.start).toBeUndefined();
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
      'enemies.updatePhases',
      'enemies.dive.returnPath',
      'enemies.bombing.entryFromStage',
      'transform.fromStage',
      'transform.remainingThreshold',
      'transform.stagesPerType',
      'transform.groupSize',
      'transform.fromRoles',
      'transform.perStage',
      'starfield.speed',
      'extraLives.thresholdUnit',
      'extraLives.thresholdModulus',
      'challengeStages.firstStage',
      'challengeStages.everyStages',
      'scoring.movingMultiplier',
      'scoring.challenge.groupBonus',
      'scoring.challenge.perHit',
      'scoring.challenge.perfect',
      'scoring.challenge.perfectReplacesPerHit',
      'scoring.challenge.impactAward',
    ]) {
      expect([path, confidenceOf(path)]).toEqual([path, 'verified']);
    }
  });

  it('keeps the values the reference does not cover legibly provisional', () => {
    for (const path of [
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
      // The launcher that reads the row's counters is ours; the counters are not.
      'enemies.dive.baseLaunchRate',
      'enemies.dive.launchCost',
      'enemies.dive.bumpAfterFrames',
      'enemies.dive.reentryY',
      'enemies.bombing.continuousCooldownFrames',
      'transform.tellFrames',
      'transform.types',
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
