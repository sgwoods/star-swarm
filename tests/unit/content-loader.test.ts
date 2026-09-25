import { describe, expect, it } from 'vitest';

import { ContentValidationError } from '../../src/content/errors.js';
import type { PackSource } from '../../src/content/loader.js';
import { loadPack, loadPackOrThrow, packSourceFromRecord } from '../../src/content/loader.js';
import { createRegistry } from '../../src/content/registry.js';
import { minimalRules } from '../helpers/rules.js';

/**
 * `docs/DESIGN.md` section 11: a pack that fails validation never loads. These
 * tests are about the second pass in particular — a schema-valid pack whose ids
 * point at nothing is exactly the failure a per-file schema check cannot see.
 */

const SPRITE = { id: 'drone', size: 2, palette: ['#0000', '#fff'], frames: [['.1', '1.']] };
const SOUND = { id: 'pop', wave: 'noise', freq: 220 };
const PATH = { id: 'left-hook', segments: [{ type: 'line', to: [112, 200], speed: 1.5 }] };
const ALIEN = {
  id: 'drone',
  role: 'drone',
  sprite: 'drone',
  score: { base: 50 },
  dive: { paths: ['left-hook'] },
  sounds: { death: 'pop' },
};
const STAGE = {
  id: 'stage-01',
  kind: 'normal',
  formation: 'grid',
  waves: [{ at: 0, entryPath: 'left-hook', slots: [{ alien: 'drone', home: 0 }] }],
};
const MANIFEST = {
  id: 'testpack',
  name: 'Test pack',
  roles: { drone: { label: 'Drone' } },
  formations: { grid: { id: 'grid', slots: [{ row: 0, column: 0, role: 'drone' }] } },
  stageSequence: { normal: { rows: ['stage-01'], repeatLast: 1 } },
};

/** A pack that loads, plus whatever the test wants changed. */
function source(overrides: Partial<Record<string, unknown>> = {}): PackSource {
  return packSourceFromRecord('testpack', 'memory:testpack', {
    'pack.json': MANIFEST,
    'sprites/drone.json': SPRITE,
    'sounds/pop.json': SOUND,
    'paths/left-hook.json': PATH,
    'aliens/drone.json': ALIEN,
    'stages/stage-01.json': STAGE,
    ...overrides,
  });
}

function errorsFrom(
  overrides: Partial<Record<string, unknown>>,
): readonly { file: string; field?: string; message: string }[] {
  const result = loadPack(source(overrides));
  if (result.ok) throw new Error('expected the pack to fail validation');
  return result.errors;
}

describe('a pack that resolves', () => {
  it('loads, and indexes every document by id', () => {
    const result = loadPack(source());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.id).toBe('testpack');
    expect(result.pack.aliens.get('drone')?.score.base).toBe(50);
    expect(result.pack.formations.get('grid')?.slots).toHaveLength(1);
    expect(result.pack.rules).toBeUndefined();
  });

  it('remembers which file each document came from', () => {
    const pack = loadPackOrThrow(source());
    expect(pack.files.get('aliens:drone')).toBe('aliens/drone.json');
  });
});

describe('dangling cross-references are caught', () => {
  it("names the file and field for an alien's missing sprite", () => {
    const errors = errorsFrom({ 'aliens/drone.json': { ...ALIEN, sprite: 'nope' } });
    expect(errors).toEqual([
      {
        pack: 'testpack',
        file: 'aliens/drone.json',
        field: 'sprite',
        message: 'no sprite with id "nope" in this pack',
      },
    ]);
  });

  it("catches an alien's missing sound", () => {
    const errors = errorsFrom({ 'aliens/drone.json': { ...ALIEN, sounds: { death: 'silence' } } });
    expect(errors[0]?.field).toBe('sounds.death');
    expect(errors[0]?.message).toContain('no sound');
  });

  it("catches an alien's missing dive path", () => {
    const errors = errorsFrom({
      'aliens/drone.json': { ...ALIEN, dive: { paths: ['left-hook', 'ghost'] } },
    });
    expect(errors[0]).toMatchObject({ field: 'dive.paths[1]' });
  });

  it("catches a wave slot's missing alien", () => {
    const errors = errorsFrom({
      'stages/stage-01.json': {
        ...STAGE,
        waves: [{ at: 0, entryPath: 'left-hook', slots: [{ alien: 'drone' }, { alien: 'ghost' }] }],
      },
    });
    expect(errors[0]).toMatchObject({
      file: 'stages/stage-01.json',
      field: 'waves[0].slots[1].alien',
      message: 'no alien with id "ghost" in this pack',
    });
  });

  it("catches a wave's missing entry path", () => {
    const errors = errorsFrom({
      'stages/stage-01.json': {
        ...STAGE,
        waves: [{ at: 0, entryPath: 'ghost', slots: [{ alien: 'drone' }] }],
      },
    });
    expect(errors[0]).toMatchObject({ field: 'waves[0].entryPath' });
  });

  it("catches a stage's missing formation", () => {
    const errors = errorsFrom({ 'stages/stage-01.json': { ...STAGE, formation: 'ghost' } });
    expect(errors[0]).toMatchObject({ field: 'formation' });
  });

  it('catches a home slot outside the formation', () => {
    const errors = errorsFrom({
      'stages/stage-01.json': {
        ...STAGE,
        waves: [{ at: 0, entryPath: 'left-hook', slots: [{ alien: 'drone', home: 7 }] }],
      },
    });
    expect(errors[0]?.message).toContain('out of range');
  });

  it('catches a missing stage in the sequence', () => {
    const errors = errorsFrom({
      'pack.json': { ...MANIFEST, stageSequence: { normal: { rows: ['stage-01', 'stage-99'] } } },
    });
    expect(errors[0]).toMatchObject({
      file: 'pack.json',
      field: 'stageSequence.normal.rows[1]',
      message: 'no stage with id "stage-99" in this pack',
    });
  });

  it('catches a challenge stage listed in the normal sequence', () => {
    const errors = errorsFrom({
      'stages/stage-01.json': { ...STAGE, kind: 'challenge' },
    });
    expect(errors[0]?.message).toContain('listed in the normal sequence');
  });

  it("catches a sound named by a path's fire segment", () => {
    const errors = errorsFrom({
      'paths/left-hook.json': { ...PATH, segments: [{ type: 'fire', sound: 'ghost' }] },
    });
    expect(errors[0]).toMatchObject({ file: 'paths/left-hook.json', field: 'segments[0].sound' });
  });

  it('catches a role no pack declares, which is how role typos surface', () => {
    const errors = errorsFrom({ 'aliens/drone.json': { ...ALIEN, role: 'drome' } });
    expect(errors[0]?.message).toContain('not declared in pack.json');
  });

  it('catches a captive slot pointing at a captor that is not there', () => {
    const errors = errorsFrom({
      'pack.json': {
        ...MANIFEST,
        formations: {
          grid: {
            id: 'grid',
            slots: [{ row: 0, column: 0, role: 'drone' }],
            captiveSlots: [{ row: -1, column: 0, captor: 3 }],
          },
        },
      },
    });
    expect(errors[0]?.field).toBe('formations.grid.captiveSlots[0].captor');
  });

  it('reports every dangling reference at once, not just the first', () => {
    const errors = errorsFrom({
      'aliens/drone.json': { ...ALIEN, sprite: 'nope', sounds: { death: 'silence' } },
    });
    expect(errors).toHaveLength(2);
  });
});

describe('a pack that fails never loads', () => {
  it('returns errors instead of a pack when a schema fails', () => {
    const result = loadPack(source({ 'aliens/drone.json': { id: 'drone', role: 'drone' } }));
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('pack');
  });

  it('does not chase references once a schema has failed', () => {
    const errors = errorsFrom({ 'aliens/drone.json': { id: 'drone', role: 'drone' } });
    expect(errors.every((error) => error.file === 'aliens/drone.json')).toBe(true);
  });

  it('rejects a manifest whose id disagrees with the directory', () => {
    const errors = errorsFrom({ 'pack.json': { ...MANIFEST, id: 'other' } });
    expect(errors[0]?.message).toContain('but the pack directory is');
  });

  it('rejects two documents of the same kind sharing an id', () => {
    const errors = errorsFrom({ 'aliens/copy.json': ALIEN });
    expect(errors[0]?.message).toContain('duplicate alien id');
  });

  it('throws from loadPackOrThrow with the file and field in the message', () => {
    expect(() =>
      loadPackOrThrow(source({ 'aliens/drone.json': { ...ALIEN, sprite: 'nope' } })),
    ).toThrow(ContentValidationError);
    try {
      loadPackOrThrow(source({ 'aliens/drone.json': { ...ALIEN, sprite: 'nope' } }));
    } catch (error) {
      expect((error as Error).message).toContain('testpack/aliens/drone.json');
      expect((error as Error).message).toContain('sprite: no sprite with id "nope"');
    }
  });
});

describe('the rules layer', () => {
  const RULES = {
    ...minimalRules('testpack'),
    enemies: {
      ...(minimalRules()['enemies'] as Record<string, unknown>),
      bomberReadyTimers: { drone: 22 },
    },
    difficulty: {
      defaultRank: 'A',
      ranks: { A: { stageTable: { rows: [{ launchRates: { drone: 1 } }] } } },
    },
  };

  it('loads alongside the pack', () => {
    const pack = loadPackOrThrow(source({ 'rules.json': RULES }));
    expect(pack.rules?.difficulty.defaultRank).toBe('A');
  });

  it('catches a default rank that is not declared', () => {
    const errors = errorsFrom({
      'rules.json': { ...RULES, difficulty: { ...RULES.difficulty, defaultRank: 'Z' } },
    });
    expect(errors[0]).toMatchObject({ file: 'rules.json', field: 'difficulty.defaultRank' });
  });

  it('catches a launch rate keyed by a role the pack never declares', () => {
    const errors = errorsFrom({
      'rules.json': {
        ...RULES,
        difficulty: {
          defaultRank: 'A',
          ranks: { A: { stageTable: { rows: [{ launchRates: { wing: 1 } }] } } },
        },
      },
    });
    expect(errors[0]?.field).toBe('difficulty.ranks.A.stageTable.rows[0].launchRates.wing');
  });

  it('catches a transform type that is not an alien in the pack', () => {
    const errors = errorsFrom({
      'rules.json': { ...RULES, transform: { enabled: true, types: ['ghost'] } },
    });
    expect(errors[0]?.field).toBe('transform.types[0]');
  });

  it('catches a provenance key that names nothing in the file', () => {
    const errors = errorsFrom({
      'rules.json': {
        ...RULES,
        provenance: {
          'player.maxShots': { confidence: 'verified' },
          'player.maxShotz': { confidence: 'verified' },
        },
      },
    });
    // The marking outliving the value it describes is how a verified number
    // quietly becomes an unmarked one, so the rename has to fail loudly.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      file: 'rules.json',
      field: 'provenance.player.maxShotz',
    });
  });

  it('accepts a provenance key that reaches into an array', () => {
    const pack = loadPackOrThrow(
      source({
        'rules.json': {
          ...RULES,
          provenance: { 'player.shot.windows.single[0].dxMin': { confidence: 'verified' } },
        },
      }),
    );
    expect(pack.rules?.provenance['player.shot.windows.single[0].dxMin']?.confidence).toBe(
      'verified',
    );
  });

  it('catches a plateau longer than the table it cycles', () => {
    const errors = errorsFrom({
      'rules.json': {
        ...RULES,
        difficulty: {
          defaultRank: 'A',
          ranks: { A: { stageTable: { rows: [{}], repeatLast: 4 } } },
        },
      },
    });
    expect(errors[0]?.message).toContain('cannot cycle the last 4 of 1 row(s)');
  });
});

describe('the registry', () => {
  it('layers packs so a later one wins, which is what makes "Classic + Weird" work', () => {
    const base = loadPackOrThrow(source());
    const overlay = loadPackOrThrow(
      packSourceFromRecord('weird', 'memory:weird', {
        'pack.json': { id: 'weird', name: 'Weird', roles: { drone: {} }, formations: {} },
        'sprites/drone.json': { ...SPRITE, palette: ['#0000', '#f0f'] },
      }),
    );

    const registry = createRegistry([base, overlay]);
    expect(registry.sprite('drone')?.palette[1]).toBe('#f0f');
    expect(registry.alien('drone')?.score.base).toBe(50);
    expect(registry.active.id).toBe('weird');
    expect(registry.sourceOf('sprites', 'drone')?.packId).toBe('weird');
    expect(registry.sourceOf('aliens', 'drone')?.packId).toBe('testpack');
  });

  it('refuses to exist with no packs at all', () => {
    expect(() => createRegistry([])).toThrow('at least one loaded pack');
  });
});
