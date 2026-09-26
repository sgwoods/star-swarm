import { describe, expect, it } from 'vitest';

import { isChallengeStage, normalStageOrdinal, resolveStageId } from '../../src/content/rules.js';
import { formationAxes } from '../../src/content/schema.js';
import { waveLaunchFrames } from '../../src/sim/enemies.js';
import { classicFormation, classicPack, classicRules } from '../helpers/rules.js';

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
const formation = classicFormation();

/**
 * Every normal stage the pack ships, in sequence order and de-duplicated.
 *
 * De-duplicated because a stage document is an **entry script**, not a stage: the
 * reference's selection table gives stage 8 script row 4, the same row as stage 4,
 * so `stage-4` plays twice and shipping a `stage-8.json` copy of it would be two
 * files that have to stay in step. See `packs/classic/README.md`.
 */
const normalStages = [...new Set(pack.manifest.stageSequence.normal.rows)].map((id) => {
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
    // score and a dive belong to each type separately.
    expect([...pack.aliens.keys()].sort()).toEqual([
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

describe('the normal stage sequence', () => {
  /**
   * Reference section 5's per-stage script assignment, rank A, as far as this
   * pack authors it. A stage document is named for the *first* stage that plays
   * its script row, which is why stage 8 plays `stage-4`: both are script row 4.
   */
  const rankA: readonly (readonly [stage: number, script: number, plays: string])[] = [
    [1, 0, 'stage-1'],
    [2, 1, 'stage-2'],
    [4, 4, 'stage-4'],
    [5, 3, 'stage-5'],
    [6, 2, 'stage-6'],
    [8, 4, 'stage-4'],
  ];

  it.each(rankA)('plays stage %i (script row %i) as %s', (stage, _script, plays) => {
    expect(isChallengeStage(rules, stage)).toBe(false);
    expect(resolveStageId(pack.manifest, rules, stage)).toBe(plays);
  });

  it('indexes the sequence exactly as the ROM indexes its own', () => {
    // `adj − (adj >> 2) − 1` for a non-challenge stage, which is what
    // `normalStageOrdinal` has to agree with for the rows to line up at all.
    for (const [stage] of rankA) {
      expect(normalStageOrdinal(rules, stage)).toBe(stage - (stage >> 2) - 1);
    }
  });

  it('leaves stages 3 and 7 to the challenge task', () => {
    // `(stage + 1) mod 4 == 0` is the ROM's own test, so the cadence is settled
    // even though the content is not. `challenge.rows` is still empty, which is
    // why these resolve to nothing rather than to a normal stage.
    expect([3, 7].map((stage) => isChallengeStage(rules, stage))).toEqual([true, true]);
    expect([3, 7].map((stage) => resolveStageId(pack.manifest, rules, stage))).toEqual([
      undefined,
      undefined,
    ]);
    expect(pack.manifest.stageSequence.challenge.rows).toEqual([]);
  });

  it('cycles one row past stage 8, because the rest of the table is not authored', () => {
    // The arcade cycles the last *three* from stage 24, a property of the whole
    // 17-entry table. Until rows 7–17 land, `repeatLast: 1` is the honest
    // statement: nothing is claimed about a plateau that is not there yet.
    expect(pack.manifest.stageSequence.normal.rows).toEqual([
      'stage-1',
      'stage-2',
      'stage-4',
      'stage-5',
      'stage-6',
      'stage-4',
    ]);
    expect(pack.manifest.stageSequence.normal.repeatLast).toBe(1);
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
