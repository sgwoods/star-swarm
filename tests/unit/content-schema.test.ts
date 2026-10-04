import { describe, expect, it } from 'vitest';

import {
  alienSchema,
  formationSchema,
  packManifestSchema,
  pathSchema,
  resolveRow,
  rulesSchema,
  soundSchema,
  spriteSchema,
  stageSchema,
} from '../../src/content/schema.js';
import { minimalRules } from '../helpers/rules.js';

/**
 * The schemas are the contract three sibling tasks build against
 * (`docs/DESIGN.md` section 7), so these tests pin both halves: the shapes the
 * plan's own examples use must parse, and the mistakes generated content
 * actually makes must not.
 */

/** A 16×16 sprite frame of nothing but transparent pixels. */
function blankFrame(size = 16): string[] {
  return Array.from({ length: size }, () => '.'.repeat(size));
}

describe('7.1 alien', () => {
  const minimal = { id: 'drone', role: 'drone', sprite: 'drone', score: { base: 50 } };

  it('accepts the minimum and fills the defaults in', () => {
    const alien = alienSchema.parse(minimal);
    expect(alien).toMatchObject({ hp: 1, abilities: [], sounds: {} });
  });

  it("accepts the design plan's own example, adapted to the score rule", () => {
    const alien = alienSchema.parse({
      id: 'jellyfish',
      role: 'wing',
      hp: 1,
      sprite: 'jellyfish',
      score: { base: 80 },
      fire: { pattern: 'aimed', shotsPerDive: 2 },
      dive: { paths: ['swirl8'], weight: 1.0 },
      abilities: [{ type: 'splitOnHit', into: 'jellyling', count: 2 }],
      sounds: { dive: 'wobble', death: 'pop' },
    });
    expect(alien.abilities[0]).toMatchObject({ type: 'splitOnHit', into: 'jellyling' });
    expect(alien.fire?.pattern).toBe('aimed');
  });

  it('rejects a misspelt field rather than ignoring it', () => {
    const result = alienSchema.safeParse({ ...minimal, sprit: 'drone' });
    expect(result.success).toBe(false);
  });

  it('rejects an ability outside the registry', () => {
    const result = alienSchema.safeParse({ ...minimal, abilities: [{ type: 'summonKraken' }] });
    expect(result.success).toBe(false);
  });

  it('validates each implemented ability’s parameters with its own schema', () => {
    const parse = (ability: Record<string, unknown>) =>
      alienSchema.safeParse({ ...minimal, abilities: [ability] });
    // Defaults come from the ability's schema, not from the simulation.
    const shielded = alienSchema.parse({ ...minimal, abilities: [{ type: 'shield', hits: 2 }] });
    expect(shielded.abilities).toEqual([{ type: 'shield', hits: 2 }]);
    const spawner = alienSchema.parse({
      ...minimal,
      abilities: [{ type: 'spawnMinions', alien: 'mite', maxAlive: 2, everyFrames: 60 }],
    });
    expect(spawner.abilities).toEqual([
      { type: 'spawnMinions', alien: 'mite', count: 1, everyFrames: 60, maxAlive: 2, spacing: 8 },
    ]);
    expect(parse({ type: 'teleport', everyFrames: 30 }).success).toBe(true);
    // Strict: a misspelt or a missing parameter is an error, not a no-op.
    expect(parse({ type: 'shield', hits: 2, recharge: 30 }).success).toBe(false);
    expect(parse({ type: 'shield' }).success).toBe(false);
    expect(parse({ type: 'splitOnHit', into: 'jellyling' }).success).toBe(false);
    expect(parse({ type: 'spawnMinions', alien: 'mite' }).success).toBe(false);
    expect(parse({ type: 'teleport', everyFrames: 0 }).success).toBe(false);
  });

  it('keeps the reserved ids loose, because nothing reads them', () => {
    for (const type of ['transform', 'mirrorPlayer']) {
      const result = alienSchema.safeParse({ ...minimal, abilities: [{ type, anything: 1 }] });
      expect([type, result.success]).toEqual([type, true]);
    }
  });

  it('refuses captureBeam on an alien, and says where its switch is', () => {
    const result = alienSchema.safeParse({ ...minimal, abilities: [{ type: 'captureBeam' }] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/switched on by "capture" in rules\.json/);
  });

  it('allows each ability once per alien', () => {
    const result = alienSchema.safeParse({
      ...minimal,
      abilities: [
        { type: 'shield', hits: 1 },
        { type: 'shield', hits: 2 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a score with no base', () => {
    const result = alienSchema.safeParse({ ...minimal, score: { formation: 50, diving: 100 } });
    expect(result.success).toBe(false);
  });

  it('takes any role id, because roles are the pack’s vocabulary and not the engine’s', () => {
    expect(alienSchema.safeParse({ ...minimal, role: 'flagship' }).success).toBe(true);
  });
});

describe('7.2 movement path', () => {
  it("accepts the design plan's swirl8 example", () => {
    const path = pathSchema.parse({
      id: 'swirl8',
      mirror: true,
      segments: [
        { type: 'bezier', to: [112, 160], c1: [20, 40], c2: [200, 80], speed: 1.6 },
        { type: 'loop', radius: 24, turns: 1, dir: 'cw' },
        { type: 'lissajous', ax: 30, ay: 20, fx: 2, fy: 1, duration: 120 },
        { type: 'aimAtPlayer', speed: 2.2 },
        { type: 'exitBottom' },
      ],
    });
    expect(path.segments).toHaveLength(5);
  });

  it('covers every segment type section 7.2 names', () => {
    const path = pathSchema.parse({
      id: 'everything',
      segments: [
        { type: 'line', to: [10, 10], speed: 1 },
        { type: 'bezier', to: [1, 1], c1: [0, 0], c2: [2, 2] },
        { type: 'arc', radius: 10, degrees: 90, dir: 'ccw' },
        { type: 'loop', radius: 8, turns: 2, dir: 'cw' },
        { type: 'lissajous', ax: 1, ay: 1, fx: 1, fy: 1, duration: 10 },
        { type: 'sine', amplitude: 4, wavelength: 20, duration: 30 },
        { type: 'wait', frames: 5 },
        { type: 'aimAtPlayer', speed: 2 },
        { type: 'toSlot' },
        { type: 'exitBottom' },
        { type: 'fire' },
        { type: 'trigger', ability: 'captureBeam' },
      ],
    });
    expect(path.segments.map((s) => s.type)).toContain('toSlot');
    expect(path.mirror).toBe(false);
  });

  it('rejects an unknown segment type', () => {
    expect(
      pathSchema.safeParse({ id: 'p', segments: [{ type: 'teleport', to: [0, 0] }] }).success,
    ).toBe(false);
  });

  it('rejects a path with no segments', () => {
    expect(pathSchema.safeParse({ id: 'p', segments: [] }).success).toBe(false);
  });

  it('rejects a negative speed', () => {
    expect(
      pathSchema.safeParse({ id: 'p', segments: [{ type: 'line', to: [0, 0], speed: -1 }] })
        .success,
    ).toBe(false);
  });
});

describe('7.3 stage', () => {
  const wave = {
    at: 0,
    entryPath: 'swirl8',
    spacing: 10,
    slots: [
      { alien: 'jellyfish', mirror: false, trailing: false },
      { alien: 'jellyfish', mirror: true, trailing: false },
      { alien: 'drone', mirror: false, trailing: true },
    ],
  };

  it("accepts the design plan's jelly-bloom example", () => {
    const stage = stageSchema.parse({
      id: 'jelly-bloom',
      kind: 'normal',
      formation: 'classic40',
      waves: [wave],
      diveRules: { maxConcurrent: 3, intervalFrames: [60, 180] },
      modifiers: { enemyBulletSpeed: 1.1 },
    });
    expect(stage.waves[0]?.slots[2]).toMatchObject({ alien: 'drone', trailing: true });
  });

  it('defaults mirror and trailing to false, so a slot need only name its alien', () => {
    const stage = stageSchema.parse({
      id: 's',
      formation: 'f',
      waves: [{ at: 0, entryPath: 'p', slots: [{ alien: 'a' }] }],
    });
    expect(stage.waves[0]?.slots[0]).toMatchObject({ mirror: false, trailing: false });
    expect(stage.waves[0]?.spacing).toBe(0);
    expect(stage.kind).toBe('normal');
  });

  it('accepts a mixed-type wave, which is the whole point of a per-slot array', () => {
    const stage = stageSchema.parse({
      id: 's',
      formation: 'f',
      waves: [
        {
          at: 0,
          entryPath: 'p',
          slots: [
            { alien: 'warden', home: 0 },
            { alien: 'warden', home: 1 },
            { alien: 'wing', home: 4 },
            { alien: 'wing', home: 5 },
          ],
        },
      ],
    });
    expect(new Set(stage.waves[0]?.slots.map((s) => s.alien))).toEqual(new Set(['warden', 'wing']));
  });

  it('rejects a slot with no path and a wave with no entryPath', () => {
    const result = stageSchema.safeParse({
      id: 's',
      formation: 'f',
      waves: [{ at: 0, slots: [{ alien: 'a' }] }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['waves', 0, 'slots', 0, 'path']);
  });

  it('accepts a per-slot path instead of a wave-level entryPath', () => {
    expect(
      stageSchema.safeParse({
        id: 's',
        formation: 'f',
        waves: [{ at: 0, slots: [{ alien: 'a', path: 'p' }] }],
      }).success,
    ).toBe(true);
  });

  it('rejects an empty wave', () => {
    expect(
      stageSchema.safeParse({ id: 's', formation: 'f', waves: [{ at: 0, slots: [] }] }).success,
    ).toBe(false);
  });

  it('rejects an unknown stage kind', () => {
    expect(stageSchema.safeParse({ id: 's', kind: 'bonus', formation: 'f' }).success).toBe(false);
  });
});

describe('7.4 sprite', () => {
  const minimal = { id: 's', size: 16, palette: ['#0000', '#7df'], frames: [blankFrame()] };

  it('accepts a square frame whose rows match its size', () => {
    expect(spriteSchema.parse(minimal).frames).toHaveLength(1);
  });

  it('rejects a frame with the wrong number of rows', () => {
    const result = spriteSchema.safeParse({ ...minimal, frames: [blankFrame().slice(0, 15)] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('16 rows');
  });

  it('rejects a row of the wrong length', () => {
    const rows = blankFrame();
    rows[3] = '.'.repeat(15);
    const result = spriteSchema.safeParse({ ...minimal, frames: [rows] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('16 characters');
  });

  it('rejects a palette index the palette does not have', () => {
    const rows = blankFrame();
    rows[0] = '9'.repeat(16);
    const result = spriteSchema.safeParse({ ...minimal, frames: [rows] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('out of range');
  });

  it('rejects a malformed colour', () => {
    expect(spriteSchema.safeParse({ ...minimal, palette: ['0000', '#7df'] }).success).toBe(false);
  });
});

describe('7.4 sound', () => {
  it("accepts the design plan's wobble example", () => {
    const sound = soundSchema.parse({
      id: 'wobble',
      wave: 'square',
      freq: [440, 220],
      vibrato: { rate: 8, depth: 0.3 },
      envelope: [0.01, 0.1, 0.2],
    });
    expect(sound.freq).toEqual([440, 220]);
  });

  it('accepts a jingle as a sequence of steps', () => {
    const sound = soundSchema.parse({
      id: 'rescue',
      wave: 'triangle',
      sequence: [
        { freq: 440, duration: 0.08 },
        { freq: 660, duration: 0.16 },
      ],
    });
    expect(sound.sequence).toHaveLength(2);
  });

  it('rejects a sound with neither a freq nor a sequence', () => {
    expect(soundSchema.safeParse({ id: 's', wave: 'square' }).success).toBe(false);
  });

  it('rejects an unknown waveform', () => {
    expect(soundSchema.safeParse({ id: 's', wave: 'pulse', freq: 440 }).success).toBe(false);
  });
});

describe('formation', () => {
  it('accepts logical row/column slots with no pixel grid yet', () => {
    const formation = formationSchema.parse({
      id: 'f',
      slots: [{ row: 0, column: 6, role: 'warden' }],
      captiveSlots: [{ row: -1, column: 6, captor: 0 }],
    });
    expect(formation.grid).toBeUndefined();
    expect(formation.captiveSlots[0]?.captor).toBe(0);
  });

  it('rejects a fractional column', () => {
    expect(
      formationSchema.safeParse({ id: 'f', slots: [{ row: 0, column: 6.5, role: 'a' }] }).success,
    ).toBe(false);
  });
});

describe('pack manifest', () => {
  it('needs only an id and a name', () => {
    const manifest = packManifestSchema.parse({ id: 'classic', name: 'Classic' });
    expect(manifest).toMatchObject({ version: '0.0.0', palette: [], roles: {}, formations: {} });
    expect(manifest.stageSequence.normal.rows).toEqual([]);
  });

  it('rejects an id with characters that would not survive a filename', () => {
    expect(packManifestSchema.safeParse({ id: 'my pack', name: 'x' }).success).toBe(false);
  });
});

describe('section 6 rules', () => {
  // `minimalRules` is the least a rules.json can say; keeping it in one place
  // means a new required field is one edit rather than one per fixture.
  const minimal = minimalRules();

  it('accepts the minimum and defaults the optional layers', () => {
    const rules = rulesSchema.parse(minimal);
    expect(rules.capture.enabled).toBe(false);
    expect(rules.scoring.movingMultiplier).toBe(2);
    expect(rules.difficulty.ranks['A']?.stageTable.repeatLast).toBe(1);
  });

  it('keeps every rank as its own data set rather than a multiplier', () => {
    const rules = rulesSchema.parse({
      ...minimal,
      difficulty: {
        defaultRank: 'A',
        ranks: {
          A: { stageTable: { rows: [{ maxDivers: 2 }], repeatLast: 1 } },
          D: { stageTable: { rows: [{ maxDivers: 5 }], repeatLast: 1 } },
        },
      },
    });
    expect(rules.difficulty.ranks['A']?.stageTable.rows[0]?.maxDivers).toBe(2);
    expect(rules.difficulty.ranks['D']?.stageTable.rows[0]?.maxDivers).toBe(5);
  });

  it('holds a non-monotonic ramp without complaint', () => {
    const rules = rulesSchema.parse({
      ...minimal,
      difficulty: {
        defaultRank: 'A',
        ranks: {
          A: { stageTable: { rows: [{ maxDivers: 4 }, { maxDivers: 2 }, { maxDivers: 5 }] } },
        },
      },
    });
    expect(rules.difficulty.ranks['A']?.stageTable.rows.map((r) => r.maxDivers)).toEqual([4, 2, 5]);
  });

  it('expresses "no extra lives" as well as a triple', () => {
    expect(rulesSchema.parse(minimal).extraLives.award.mode).toBe('none');
    const withThresholds = rulesSchema.parse({
      ...minimal,
      extraLives: { award: { mode: 'thresholds', first: 20000, second: 70000, repeat: 70000 } },
    });
    expect(withThresholds.extraLives.award).toMatchObject({ first: 20000, repeat: 70000 });
  });

  it('expresses a capped capture channel and per-impact challenge scoring, or neither', () => {
    // Both shapes exist because the arcade original needs them — one held fighter
    // globally, and a per-impact award that differs by challenge stage. A pack
    // that wants neither says nothing and gets null for both.
    const silent = rulesSchema.parse(minimal);
    expect(silent.capture.maxHeldTotal).toBeNull();
    expect(silent.scoring.challenge).toBeUndefined();

    const classicShaped = rulesSchema.parse({
      ...minimal,
      capture: { maxHeldTotal: 1 },
      scoring: {
        challenge: {
          groupBonus: { rows: [1000] },
          impactAward: { rows: [100, 160], repeatLast: 2 },
        },
      },
    });
    expect(classicShaped.capture.maxHeldTotal).toBe(1);
    expect(classicShaped.scoring.challenge?.impactAward?.rows).toEqual([100, 160]);
    // `repeatLast` above the plateau of 1: the table cycles, which is what the
    // per-impact award does and the group bonus beside it does not.
    expect(classicShaped.scoring.challenge?.impactAward?.repeatLast).toBe(2);
  });

  it('rejects an unknown rules field rather than silently dropping it', () => {
    expect(rulesSchema.safeParse({ ...minimal, difficultyMultiplier: 1.5 }).success).toBe(false);
  });
});

describe('plateau tables', () => {
  const table = { rows: ['a', 'b', 'c', 'd', 'e'], repeatLast: 3 };

  it('reads rows directly while the index is in range', () => {
    expect(resolveRow(table, 0)).toBe('a');
    expect(resolveRow(table, 4)).toBe('e');
  });

  it('cycles the last rows past the end rather than freezing or climbing', () => {
    expect(resolveRow(table, 5)).toBe('c');
    expect(resolveRow(table, 6)).toBe('d');
    expect(resolveRow(table, 7)).toBe('e');
    expect(resolveRow(table, 8)).toBe('c');
  });

  it('holds the last row when the period is 1', () => {
    expect(resolveRow({ rows: ['a', 'b'], repeatLast: 1 }, 9)).toBe('b');
  });

  it('has nothing to give for an empty table', () => {
    expect(resolveRow({ rows: [], repeatLast: 1 }, 0)).toBeUndefined();
  });
});
