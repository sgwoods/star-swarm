import { describe, expect, it } from 'vitest';

import {
  isChallengeStage,
  normalStageOrdinal,
  resolveStageId,
  resolveStageSequence,
} from '../../src/content/rules.js';
import { formationAxes } from '../../src/content/schema.js';
import { createStageSource } from '../../src/content/stages.js';
import { waveLaunchFrames } from '../../src/sim/enemies.js';
import { classicFormation, classicPack, classicRules, classicStages } from '../helpers/rules.js';

/**
 * `packs/classic/aliens/` and `packs/classic/stages/`, against
 * `docs/reference/arcade-reference.md`.
 *
 * The reference draws a sharp line through entry choreography, and this file
 * keeps to it. **Verified and asserted here:** the enemy mix (4 + 16 + 20), the
 * per-wave composition of section 5's `db_attk_wav_IDs`, the score bases of
 * section 9, and the boss's two hits. **Ours and therefore only checked for
 * consistency:** which path each wave flies, the mirror and trailing flags and
 * the wave timings — section 5 says the mapping from each of the thirteen ROM
 * scripts to a shape was not derived, so a test that pinned our choreography to
 * the arcade would be asserting a fiction.
 *
 * The composition assertions run over **every** normal stage the pack ships, not
 * stage 1 alone. That is not thoroughness for its own sake: `c_25A2` resets the
 * wave-ID pointer to the top of `db_attk_wav_IDs` at every stage, so the forty
 * objects and the order they are grouped into five waves are the *same* on every
 * stage. A stage that composed its waves differently would be wrong, and only a
 * test over all of them says so.
 *
 * `tests/unit/classic-pack.test.ts` covers the manifest, the formation and the
 * rank tables; this file covers the content those two put on the field.
 */

const pack = classicPack();
const rules = classicRules();
const stages = classicStages();
const formation = classicFormation();

/**
 * Reference section 5's per-stage script assignment, verbatim: for each normal
 * stage through 22, the combat script row that rank A, B, C and D play. The rows
 * are the reference's own zero-based numbers, and `script-N` is row N.
 */
const SCRIPT_TABLE: readonly (readonly [stage: number, ...rows: number[]])[] = [
  [1, 0, 0, 0, 0],
  [2, 1, 1, 1, 1],
  [4, 4, 2, 4, 7],
  [5, 3, 3, 6, 9],
  [6, 2, 0, 5, 8],
  [8, 4, 4, 7, 7],
  [9, 6, 6, 9, 12],
  [10, 0, 5, 0, 11],
  [12, 7, 4, 7, 10],
  [13, 9, 6, 12, 12],
  [14, 8, 0, 11, 11],
  [16, 10, 7, 10, 10],
  [17, 12, 9, 12, 12],
  [18, 0, 8, 11, 11],
  [20, 10, 10, 10, 10],
  [21, 12, 12, 12, 12],
  [22, 11, 11, 11, 11],
];

/** The table's columns, in its order. The ROM stores them B, C, D, A. */
const RANKS = ['A', 'B', 'C', 'D'] as const;

/** The script row `rank` plays at the table's entry `index`. */
function scriptRow(index: number, rank: (typeof RANKS)[number]): number {
  const row = SCRIPT_TABLE[index]?.[RANKS.indexOf(rank) + 1];
  if (row === undefined) throw new Error(`no entry ${String(index)} for rank ${rank}`);
  return row;
}

/**
 * Every normal stage document any rank plays, de-duplicated.
 *
 * De-duplicated because a stage document is an **entry script**, not a stage: the
 * reference's selection table gives stage 8 script row 4, the same row as stage 4,
 * and several ranks share rows, so `script-4` plays at many stage numbers and
 * shipping a copy for each would be files that have to stay in step. Every rank,
 * because rank A never plays row 5 at all. See `packs/classic/stages/README.md`.
 */
const normalStages = [
  ...new Set(
    Object.keys(rules.difficulty.ranks).flatMap(
      (rank) => resolveStageSequence(pack.manifest, rules, rank).normal.rows,
    ),
  ),
].map((id) => {
  const document = pack.stages.get(id);
  if (document === undefined) throw new Error(`the classic pack has no ${id}`);
  return { id, stage: document };
});
if (normalStages.length === 0) throw new Error('the classic pack ships no normal stage');

describe('the aliens', () => {
  it('is exactly the roles the manifest declares', () => {
    // The three formation roles, plus the three transform types — which are
    // roles of their own rather than one shared "transform" role, because the
    // pack's role vocabulary is what everything else keys by and a sprite, a
    // score and a dive belong to each type separately — plus the captive, which
    // is the player's own stolen fighter as an alien (`src/sim/abilities/capture-beam.ts`).
    expect([...pack.aliens.keys()].sort()).toEqual([
      'captive',
      'drone',
      'ensign',
      'manta',
      'scourge',
      'warden',
      'wing',
    ]);
    for (const [id, alien] of pack.aliens) {
      expect(alien.role).toBe(id);
      expect(Object.keys(pack.manifest.roles)).toContain(alien.role);
    }
  });

  it('carries the verified base scores, and only the base', () => {
    // Section 9's score groups: bee role 50, butterfly role 80, boss 150 on the
    // hit that destroys it. The diving values are the rules layer's multiplier
    // applied to these, never a second stored number.
    expect(pack.aliens.get('drone')?.score.base).toBe(50);
    expect(pack.aliens.get('wing')?.score.base).toBe(80);
    expect(pack.aliens.get('warden')?.score.base).toBe(150);
    // A transform is worth 160 diving, which is 80 doubled — the same rule, not
    // a second stored number. Reference section 6, "Trio type and bonus".
    for (const id of rules.transform?.types ?? []) {
      expect([id, pack.aliens.get(id)?.score.base]).toEqual([id, 80]);
    }
    for (const alien of pack.aliens.values()) {
      expect(alien.score.movingMultiplier).toBeUndefined();
    }
  });

  it('gives the warden two hits and a second colour', () => {
    const warden = pack.aliens.get('warden');
    expect(warden?.hp).toBe(2);
    expect(warden?.hitSprites).toEqual(['warden-hit']);
    // Everything else dies to one shot.
    for (const id of ['drone', 'wing', 'scourge', 'manta', 'ensign']) {
      expect([id, pack.aliens.get(id)?.hp]).toEqual([id, 1]);
      expect([id, pack.aliens.get(id)?.hitSprites]).toEqual([id, []]);
    }
  });

  it('names a sprite that exists, and no hitbox of its own', () => {
    for (const alien of pack.aliens.values()) {
      expect(pack.sprites.has(alien.sprite)).toBe(true);
      // Zero padding is the arcade's behaviour: one window covers every enemy.
      expect(alien.hitPadding).toEqual({ x: 0, y: 0 });
    }
  });

  it('gives every alien a dive and a bomb, and no ability yet', () => {
    for (const [id, alien] of pack.aliens) {
      expect([id, alien.dive?.paths.length ?? 0]).toEqual([id, 1]);
      expect([id, alien.fire?.pattern]).toEqual([id, 'aimed']);
      // `cooldownFrames` *is* the per-enemy inter-shot delay of
      // `docs/DESIGN.md` section 4. An alien without one would bomb every frame
      // the global cap allowed, which is the failure this asserts against.
      expect(alien.fire?.cooldownFrames ?? 0).toBeGreaterThan(0);
      expect(alien.fire?.shotsPerDive ?? 0).toBeGreaterThan(0);
      // Abilities are Milestone 3; the capture beam is the sibling task's.
      expect([id, alien.abilities]).toEqual([id, []]);
    }
  });

  it('brings the roles back from a dive and the transform trio not at all', () => {
    // Reference section 5: divers that leave the bottom re-enter from the top.
    // Reference section 6: the trio "exits the screen — unlike bees, it does not
    // re-enter from the top". That difference is per-alien data, not a branch.
    for (const id of ['drone', 'wing', 'warden']) {
      expect([id, pack.aliens.get(id)?.dive?.returns]).toEqual([id, true]);
    }
    for (const id of rules.transform?.types ?? []) {
      expect([id, pack.aliens.get(id)?.dive?.returns]).toEqual([id, false]);
    }
  });
});

describe.each(normalStages)('$id', ({ stage }) => {
  it('is five waves of eight on the 40-slot formation', () => {
    expect(stage.kind).toBe('normal');
    expect(stage.formation).toBe('classic40');
    expect(stage.waves).toHaveLength(5);
    for (const wave of stage.waves) expect(wave.slots).toHaveLength(8);
  });

  it('composes the waves as the reference’s attack-wave table does', () => {
    const roles = stage.waves.map((wave) =>
      wave.slots.map((slot) => pack.aliens.get(slot.alien)?.role),
    );
    // Reference section 5, `db_attk_wav_IDs`: 4 butterfly + 4 bee, then all four
    // bosses plus 4 butterfly, then 8 butterfly, then 8 bee twice.
    expect(roles[0]).toEqual([...Array<string>(4).fill('wing'), ...Array<string>(4).fill('drone')]);
    expect(roles[1]).toEqual([
      ...Array<string>(4).fill('warden'),
      ...Array<string>(4).fill('wing'),
    ]);
    expect(roles[2]).toEqual(Array<string>(8).fill('wing'));
    expect(roles[3]).toEqual(Array<string>(8).fill('drone'));
    expect(roles[4]).toEqual(Array<string>(8).fill('drone'));
  });

  it('puts all four wardens in one wave, as the arcade does', () => {
    const wardenWaves = stage.waves
      .map((wave, index) => ({ index, wardens: wave.slots.filter((s) => s.alien === 'warden') }))
      .filter((entry) => entry.wardens.length > 0);
    expect(wardenWaves).toHaveLength(1);
    expect(wardenWaves[0]?.wardens).toHaveLength(4);
  });

  it('fields 40 enemies in the verified 4 / 16 / 20 mix', () => {
    const counts = new Map<string, number>();
    for (const wave of stage.waves) {
      for (const slot of wave.slots) counts.set(slot.alien, (counts.get(slot.alien) ?? 0) + 1);
    }
    expect(counts.get('warden')).toBe(4);
    expect(counts.get('wing')).toBe(16);
    expect(counts.get('drone')).toBe(20);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(40);
  });

  it('is identity-addressed: every slot names its home, and they cover the formation', () => {
    const homes = stage.waves.flatMap((wave) => wave.slots.map((slot) => slot.home));
    expect(homes.every((home) => home !== undefined)).toBe(true);
    expect([...homes].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      Array.from({ length: 40 }, (_unused, index) => index),
    );
  });

  it('sends each alien to a slot its own role fills', () => {
    for (const wave of stage.waves) {
      for (const slot of wave.slots) {
        const role = pack.aliens.get(slot.alien)?.role;
        expect(formation.slots[slot.home ?? -1]?.role).toBe(role);
      }
    }
  });

  it('names a path that exists, for every wave', () => {
    for (const wave of stage.waves) {
      expect(wave.entryPath).toBeDefined();
      expect(pack.paths.has(wave.entryPath ?? '')).toBe(true);
    }
  });

  it('never launches two aliens onto the same path from the same place at once', () => {
    // Our choreography, not the arcade's: one path plus a mirror flag cannot put
    // two aliens abreast, so a simultaneous pair has to differ in `mirror` and a
    // same-handed pair has to trail. Without that they would fly as one sprite.
    for (const wave of stage.waves) {
      const frames = waveLaunchFrames(wave);
      const seen = new Set<string>();
      wave.slots.forEach((slot, index) => {
        const key = `${String(frames[index])}:${slot.path ?? wave.entryPath ?? ''}:${String(slot.mirror)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      });
    }
  });
});

describe('the normal stage sequences', () => {
  const cases = RANKS.flatMap((rank) =>
    SCRIPT_TABLE.map(([stage], index) => [rank, stage, scriptRow(index, rank)] as const),
  );

  it.each(cases)('rank %s plays stage %i as script row %i', (rank, stage, row) => {
    expect(isChallengeStage(rules, stage)).toBe(false);
    expect(resolveStageId(pack.manifest, rules, stage, rank)).toBe(`script-${String(row)}`);
  });

  it('indexes the sequence exactly as the ROM indexes its own', () => {
    // `adj − (adj >> 2) − 1` for a non-challenge stage, which is what
    // `normalStageOrdinal` has to agree with for the rows to line up at all.
    SCRIPT_TABLE.forEach(([stage], index) => {
      expect(normalStageOrdinal(rules, stage)).toBe(stage - (stage >> 2) - 1);
      expect(normalStageOrdinal(rules, stage)).toBe(index);
    });
  });

  it('folds past stage 22 exactly as `c_25A2` does, at every rank', () => {
    // The ROM folds `while (adj >= 23) adj -= 4` before indexing, so stages 24
    // onward cycle entries 14, 15 and 16 for ever. `repeatLast: 3` has to say the
    // same thing, and only a walk well past the table shows that it does.
    for (const rank of RANKS) {
      for (let stage = 1; stage <= 255; stage += 1) {
        if (isChallengeStage(rules, stage)) continue;
        let adj = stage;
        while (adj >= 23) adj -= 4;
        const row = scriptRow(adj - (adj >> 2) - 1, rank);
        expect([rank, stage, resolveStageId(pack.manifest, rules, stage, rank)]).toEqual([
          rank,
          stage,
          `script-${String(row)}`,
        ]);
      }
    }
  });

  it('selects a whole sequence per rank, and the default rank’s is the manifest’s', () => {
    // A rank never multiplies another's table: each is a list of documents. Rank
    // A is the factory default, so its list is the pack-wide one and it states no
    // override; the other three state theirs in full.
    const listed = (rank: string) => resolveStageSequence(pack.manifest, rules, rank).normal;
    expect(listed('A')).toBe(pack.manifest.stageSequence.normal);
    expect(resolveStageId(pack.manifest, rules, 4)).toBe(
      resolveStageId(pack.manifest, rules, 4, 'A'),
    );
    for (const rank of RANKS) {
      expect(listed(rank).rows).toEqual(
        SCRIPT_TABLE.map((_entry, index) => `script-${String(scriptRow(index, rank))}`),
      );
      expect(listed(rank).repeatLast).toBe(3);
    }
  });

  it('ships one document per script row, named for the row', () => {
    // The naming rule: `script-N` is the reference's combat script row N, whatever
    // stage and rank play it. A stage-numbered name cannot work across ranks —
    // rank A plays row 4 at stage 4 and rank D plays row 7 there — and row 5 has
    // no stage under rank A to be named for.
    const shipped = [...pack.stages.values()]
      .filter((stage) => stage.kind === 'normal')
      .map((stage) => stage.id)
      .sort();
    expect(shipped).toEqual(
      Array.from({ length: 13 }, (_unused, row) => `script-${String(row)}`).sort(),
    );
    expect(new Set(normalStages.map(({ id }) => id))).toEqual(new Set(shipped));
    // And row 5 is reached by ranks B and C alone.
    const rankA = new Set(pack.manifest.stageSequence.normal.rows);
    expect(shipped.filter((id) => !rankA.has(id))).toEqual(['script-5']);
  });

  it('interleaves the two sequences, with a real normal stage either side', () => {
    // `(stage + 1) mod 4 == 0` is the ROM's own test. Now that both halves are
    // authored, this is the assertion that the *whole* ladder lines up: the two
    // sequences advance on separate ordinals, so a normal document inserted or
    // removed shifts everything after it on one side only, and a challenge stage
    // landing a stage early or late would go unnoticed by either half's own test.
    expect([3, 7, 11, 15].every((stage) => isChallengeStage(rules, stage))).toBe(true);
    const plays = (stage: number): string | undefined =>
      resolveStageId(pack.manifest, rules, stage);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(plays)).toEqual([
      'script-0',
      'script-1',
      'challenge-1',
      'script-4',
      'script-3',
      'script-2',
      'challenge-2',
      // Stage 8 is script row 4 again, which is why it replays stage 4's document
      // rather than shipping a second copy of it.
      'script-4',
    ]);
    expect([9, 10, 11, 12].map(plays)).toEqual(['script-6', 'script-0', 'challenge-3', 'script-7']);
    expect([23, 24, 25, 26, 27, 28].map(plays)).toEqual([
      'challenge-6',
      'script-10',
      'script-12',
      'script-11',
      'challenge-7',
      'script-10',
    ]);
  });

  it('gives every stage of the ladder the kind its half of the sequence implies', () => {
    // The loader enforces this per document; what it cannot see is the pairing of
    // a stage *number* with the kind that plays there, which is what decides
    // whether the formation sways and whether the enemies attack.
    for (const rank of RANKS) {
      const source = createStageSource(pack, { rank });
      for (let stage = 1; stage <= 30; stage += 1) {
        expect([rank, stage, source.stageFor(stage)?.stage.kind]).toEqual([
          rank,
          stage,
          isChallengeStage(rules, stage) ? 'challenge' : 'normal',
        ]);
      }
    }
    // The shared source the other tests use is rank A's.
    expect(stages.stageFor(9)?.stage.id).toBe('script-6');
  });

  it('composes every stage identically — the same forty homes in the same order', () => {
    // `c_25A2` resets the wave-ID pointer at every stage, so `db_attk_wav_IDs`
    // is the composition of *all* of them. Only the choreography is per-stage.
    const order = (id: string) =>
      (pack.stages.get(id)?.waves ?? []).map((wave) =>
        wave.slots.map((slot) => `${slot.alien}@${String(slot.home)}`),
      );
    const first = order(normalStages[0]?.id ?? '');
    expect(first.flat()).toHaveLength(40);
    for (const { id } of normalStages) expect(order(id)).toEqual(first);
  });

  it('gives every stage its own choreography', () => {
    // Ours, not the arcade's — so this only asks that the stages differ, which is
    // what stops a copied document going unnoticed. Paths *and* flags, because two
    // stages can fly the same three shapes in the same order and still read
    // differently: one side at a time is a mirror pattern, not a path.
    const choreography = normalStages.map(({ stage }) =>
      stage.waves
        .map(
          (wave) =>
            `${wave.entryPath ?? ''}:${wave.slots
              .map((slot) => `${slot.mirror ? 'R' : 'L'}${slot.trailing ? 'T' : '-'}`)
              .join('')}`,
        )
        .join(','),
    );
    expect(new Set(choreography).size).toBe(choreography.length);
  });
});

/**
 * Which of [SW]'s three entrance patterns a document reads as.
 *
 * Not a ROM value: the flight-vector programs that would say were never decoded.
 * What the reference does give is the patterns' order — 1 and 2 on stages 1 and 2,
 * then 1, 2, 3 on every later set of three — and the table above says which row
 * each rank plays where. Put the two together and every row but two lands only on
 * stages of one pattern, at every rank; that agreement is what the choreography
 * here is built on, and what this block holds it to.
 */
describe('the shape each script row reads as', () => {
  const OPENING_PATH: Readonly<Record<number, string>> = {
    1: 'entry-side-file',
    2: 'entry-wide-arc',
    3: 'entry-long-row',
  };

  /** The entrance pattern [SW]'s order puts at normal stage `stage`. */
  const patternAt = (stage: number): number => (stage <= 2 ? stage : (stage % 4) + 1);

  /** Every pattern any rank plays `row` under, through stage 22. */
  const patternsOf = (row: number): Set<number> =>
    new Set(
      SCRIPT_TABLE.flatMap(([stage], index) =>
        RANKS.filter((rank) => scriptRow(index, rank) === row).map(() => patternAt(stage)),
      ),
    );

  it('puts every row on stages of one pattern, at every rank, except rows 0 and 2', () => {
    // The two exceptions are recorded in `packs/classic/stages/README.md`: row 0 is
    // stage 1 everywhere and a third-pattern stage later on, and row 2 is a
    // third-pattern stage under rank A and a first-pattern one under rank B.
    const rows = Array.from({ length: 13 }, (_unused, row) => row);
    expect(rows.filter((row) => patternsOf(row).size > 1)).toEqual([0, 2]);
  });

  it.each(Array.from({ length: 13 }, (_unused, row) => row))(
    'opens script-%i with the pattern the first stage playing it calls for',
    (row) => {
      // Rank A first, as the factory setting [SW] describes; a row rank A never
      // plays is read off the first rank in the ROM's own order, B, C, D.
      const stage = ['A', 'B', 'C', 'D']
        .flatMap((rank) =>
          SCRIPT_TABLE.filter(
            (_entry, index) => scriptRow(index, rank as (typeof RANKS)[number]) === row,
          ),
        )
        .map(([first]) => first)[0];
      expect(stage).toBeDefined();
      const pattern = patternAt(stage ?? 0);
      const opening = pack.stages.get(`script-${String(row)}`)?.waves[0];
      expect(opening?.entryPath).toBe(OPENING_PATH[pattern]);
      const slots = opening?.slots ?? [];
      if (pattern === 1) {
        // Both sides at once: every pair launches together, one each side.
        expect(slots.every((slot) => !slot.trailing)).toBe(true);
      } else {
        // One side at a time, the first group from the left.
        expect(slots[0]?.mirror).toBe(false);
        expect(slots.filter((_slot, index) => index % 2 === 1).every((slot) => slot.trailing)).toBe(
          true,
        );
      }
    },
  );
});

describe('the formation motion and the formation agree', () => {
  it('has one breathe displacement per coordinate, in screen order', () => {
    const axes = formationAxes(formation);
    const breathe = rules.formation.breathe;
    expect(breathe).toBeDefined();
    expect(breathe?.columns).toHaveLength(axes.columns.length);
    expect(breathe?.rows).toHaveLength(axes.rows.length);
  });

  it('carries the verified displacements, signed outward and downward', () => {
    // Reference section 5: 32/25/18/11/4 px outward per column pair, and
    // 0/4/11/18/25/32 px downward per row with the captive row first and still.
    expect(rules.formation.breathe?.columns).toEqual([-32, -25, -18, -11, -4, 4, 11, 18, 25, 32]);
    expect(rules.formation.breathe?.rows).toEqual([0, 4, 11, 18, 25, 32]);
    expect(rules.formation.breathe?.rows[0]).toBe(0);
  });

  it('grows every inter-column gap by the same 7 px, which is what makes it an accordion', () => {
    const columns = rules.formation.breathe?.columns ?? [];
    const grid = formation.grid;
    expect(grid).toBeDefined();
    const axes = formationAxes(formation);
    const expanded = axes.columns.map(
      (column, index) =>
        (grid?.originX ?? 0) + column * (grid?.columnSpacing ?? 0) + (columns[index] ?? 0),
    );
    const gaps = expanded.slice(1).map((value, index) => value - (expanded[index] ?? 0));
    expect(gaps).toEqual([23, 23, 23, 23, 24, 23, 23, 23, 23]);
  });

  it('states the verified sway and the four-frame enemy round robin', () => {
    expect(rules.formation.sway).toEqual({ amplitude: 32, stepPixels: 1, stepFrames: 4 });
    expect(rules.formation.breathe?.steps).toBe(32);
    expect(rules.formation.breathe?.stepFrames).toBe(4);
    expect(rules.enemies.updatePhases).toBe(4);
  });

  it('runs neither motion on a challenge stage', () => {
    expect(rules.formation.animatedStageKinds).toEqual(['normal', 'boss']);
  });

  it('marks every one of those values verified, with a note', () => {
    for (const path of [
      'enemies.updatePhases',
      'formation.sway',
      'formation.breathe.steps',
      'formation.breathe.stepFrames',
      'formation.breathe.columns',
      'formation.breathe.rows',
      'formation.animatedStageKinds',
    ]) {
      const entry = rules.provenance[path];
      expect(entry, path).toBeDefined();
      expect(entry?.confidence, path).toBe('verified');
      expect(entry?.note, path).toBeTruthy();
    }
  });
});
