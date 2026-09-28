import { describe, expect, it } from 'vitest';

import { loadPackOrThrow, packSourceFromRecord } from '../../src/content/loader.js';
import type { LoadedPack } from '../../src/content/loader.js';
import { composeManifest, composeRules, createRegistry } from '../../src/content/registry.js';
import { classicPack, minimalRules } from '../helpers/rules.js';

/**
 * Layering packs, and what "later wins" means for the manifest and the rules.
 *
 * The registry's docstring has promised since Milestone 1 that "Classic + Weird"
 * is a list of packs rather than an edit to either. That only holds if an
 * **overlay** pack — a `pack.json` stating nothing but what it changes — inherits
 * everything it leaves out. Every manifest field has a schema default, so taking
 * the last pack's manifest whole turned such a pack into a game with no roles, no
 * formation and no stage sequence, and a pack that shipped no `rules.json` left
 * the simulation with no rules at all.
 *
 * So these tests are in two halves: that a single-pack registry is unchanged —
 * which is what makes the composition a generalisation rather than a new rule —
 * and that an overlay inherits field by field.
 */

/** A pack from a flat record of pack-relative path to JSON, through the real loader. */
function pack(name: string, files: Readonly<Record<string, unknown>>): LoadedPack {
  return loadPackOrThrow(packSourceFromRecord(name, `test:${name}`, files));
}

const base = (): LoadedPack =>
  pack('base', {
    'pack.json': {
      id: 'base',
      name: 'Base',
      palette: ['#0000', '#ffffff', '#ff2b2b'],
      roles: { drone: { label: 'Drone' }, wing: {} },
      formations: {
        grid: {
          id: 'grid',
          slots: [
            { column: 0, row: 0, role: 'drone' },
            { column: 1, row: 0, role: 'wing' },
          ],
        },
      },
      sounds: { 'shot-fired': 'pew' },
      stageBadges: [{ value: 1, sprite: 'badge' }],
      stageSequence: { normal: { rows: ['one'], repeatLast: 1 } },
    },
    'rules.json': minimalRules('base-rules'),
    'sounds/pew.json': { id: 'pew', wave: 'square', freq: 440 },
    'sprites/badge.json': {
      id: 'badge',
      size: 1,
      palette: ['#ffffff'],
      frames: [['0']],
    },
    'stages/one.json': {
      id: 'one',
      formation: 'grid',
      waves: [{ at: 0, entryPath: 'in', slots: [{ alien: 'a', home: 0 }] }],
    },
    'paths/in.json': { id: 'in', start: [0, 0], segments: [{ type: 'toSlot', speed: 1 }] },
    'aliens/a.json': {
      id: 'a',
      role: 'drone',
      sprite: 'badge',
      score: { base: 10 },
    },
  });

describe('a registry over one pack', () => {
  it('reports that pack’s own manifest, unchanged and identical', () => {
    const only = base();
    const registry = createRegistry([only]);
    // Identity, not deep equality: nothing is rebuilt for the one-pack case, so
    // no field can be quietly normalised on the way through.
    expect(registry.manifest).toBe(only.manifest);
    expect(registry.rules).toBe(only.rules);
    expect(registry.active).toBe(only);
  });

  it('reports the shipped Classic pack’s manifest unchanged', () => {
    const only = classicPack();
    expect(createRegistry([only]).manifest).toBe(only.manifest);
  });
});

describe('a registry over a base pack and an overlay', () => {
  /** The whole of an overlay: an id, a name, and the one document it replaces. */
  const overlay = (): LoadedPack =>
    pack('tweak', {
      'pack.json': { id: 'tweak', name: 'Tweak' },
      'sounds/pew.json': { id: 'pew', wave: 'triangle', freq: 880 },
    });

  it('layers the content, later winning', () => {
    const registry = createRegistry([base(), overlay()]);
    expect(registry.sound('pew')?.wave).toBe('triangle');
    // And everything the overlay said nothing about is still there.
    expect(registry.stage('one')?.formation).toBe('grid');
    expect(registry.alien('a')?.score.base).toBe(10);
  });

  it('inherits every manifest field the overlay does not state', () => {
    const registry = createRegistry([base(), overlay()]);
    expect(Object.keys(registry.manifest.roles).sort()).toEqual(['drone', 'wing']);
    expect(registry.manifest.formations.grid?.slots).toHaveLength(2);
    expect(registry.manifest.stageSequence.normal.rows).toEqual(['one']);
    expect(registry.manifest.stageBadges).toHaveLength(1);
    expect(registry.manifest.sounds['shot-fired']).toBe('pew');
    // The formation map and the manifest are one source, not two merges of it.
    expect(registry.formations.get('grid')).toBe(registry.manifest.formations.grid);
  });

  it('inherits the rules of the last pack that ships any', () => {
    const registry = createRegistry([base(), overlay()]);
    // The overlay ships none, so the base's are in force. Reading the *active*
    // pack's rules instead would be `undefined`, and `createWorld` requires them.
    expect(registry.rules?.id).toBe('base-rules');
    expect(composeRules([base(), overlay()])?.id).toBe('base-rules');
  });

  it('lets an overlay that ships rules take them over', () => {
    const own = pack('own', {
      'pack.json': { id: 'own', name: 'Own' },
      'rules.json': minimalRules('own-rules'),
    });
    expect(createRegistry([base(), own]).rules?.id).toBe('own-rules');
  });

  it('unions the palette rather than replacing it', () => {
    // The pack palette is a *permission list* — `src/render/sprites.ts` checks
    // membership in it and never indexes it — so an overlay adding one colour
    // must not have to restate the base's, and must not invalidate art that
    // uses them.
    const tinted = pack('tinted', {
      'pack.json': { id: 'tinted', name: 'Tinted', palette: ['#00e25a', '#ffffff'] },
    });
    expect(createRegistry([base(), tinted]).manifest.palette).toEqual([
      '#0000',
      '#ffffff',
      '#ff2b2b',
      '#00e25a',
    ]);
  });

  it('replaces a stated stage-sequence half and inherits the other', () => {
    const resequenced = pack('resequenced', {
      'pack.json': {
        id: 'resequenced',
        name: 'Resequenced',
        stageSequence: { challenge: { rows: [], repeatLast: 1 } },
      },
    });
    const registry = createRegistry([base(), resequenced]);
    // The two halves plateau independently in the original, so they compose
    // independently here: a pack that states neither changes neither.
    expect(registry.manifest.stageSequence.normal.rows).toEqual(['one']);
    expect(registry.manifest.stageSequence.challenge.rows).toEqual([]);
  });

  it('merges roles per key, so an overlay can add one and relabel another', () => {
    const extra = pack('extra', {
      'pack.json': {
        id: 'extra',
        name: 'Extra',
        roles: { wing: { label: 'Escort' }, warden: { label: 'Warden' } },
      },
    });
    const roles = createRegistry([base(), extra]).manifest.roles;
    expect(roles.drone?.label).toBe('Drone');
    expect(roles.wing?.label).toBe('Escort');
    expect(roles.warden?.label).toBe('Warden');
  });

  it('takes its identity from the last pack layered', () => {
    const registry = createRegistry([base(), overlay()]);
    expect(registry.manifest.id).toBe('tweak');
    expect(registry.active.id).toBe('tweak');
  });

  it('refuses to compose nothing', () => {
    expect(() => composeManifest([])).toThrow(/at least one/);
    expect(() => createRegistry([])).toThrow(/at least one/);
  });
});
