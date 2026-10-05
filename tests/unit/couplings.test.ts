import { describe, expect, it } from 'vitest';

import { findCouplings } from '../../src/content/couplings.js';
import {
  type LoadedPack,
  loadPackOrThrow,
  packSourceFromRecord,
} from '../../src/content/loader.js';
import { createRegistry } from '../../src/content/registry.js';
import {
  combatStageNumber,
  continuousBombingCounts,
  isChallengeStage,
  launchRoles,
} from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { classicPack, classicRules } from '../helpers/rules.js';
import { installedPack } from '../helpers/variants.js';

/**
 * The couplings `docs/content-guide.md` section 7 warns an author about, found in
 * a composed registry so the pack manager can show them to a player.
 *
 * None of them is a fault — each loads, passes the gate and plays — so what is
 * held here is that each one is *found*, against a pack built to have it, and
 * that a mix without it reports nothing.
 */

/**
 * An overlay with all four: a role Classic's rows never name, a six-column
 * formation under a ten-column breathe table, a six-enemy fleet under thresholds
 * written for forty, and captors with no captive slot to park a fighter in.
 */
function oddPack(): LoadedPack {
  const slots = ['warden', 'lurker', 'drone', 'drone', 'lurker', 'warden'].map((role, column) => ({
    column,
    row: 0,
    role,
  }));
  return loadPackOrThrow(
    packSourceFromRecord('odd', 'test:odd', {
      'pack.json': {
        id: 'odd',
        name: 'Odd',
        palette: ['#0000', '#ffffff'],
        roles: { drone: {}, warden: {}, lurker: { label: 'Lurker' } },
        formations: {
          narrow: {
            id: 'narrow',
            grid: { originX: 64, originY: 40, columnSpacing: 16, rowSpacing: 16 },
            slots,
          },
        },
        stageSequence: { normal: { rows: ['odd-1'], repeatLast: 1 } },
      },
      'sprites/blob.json': { id: 'blob', size: 1, palette: ['#ffffff'], frames: [['0']] },
      'paths/in.json': { id: 'in', start: [112, 0], segments: [{ type: 'toSlot', speed: 2 }] },
      'aliens/lurk.json': { id: 'lurk', role: 'lurker', sprite: 'blob', score: { base: 10 } },
      'aliens/boss.json': { id: 'boss', role: 'warden', sprite: 'blob', score: { base: 10 } },
      'aliens/bee.json': { id: 'bee', role: 'drone', sprite: 'blob', score: { base: 10 } },
      'stages/odd-1.json': {
        id: 'odd-1',
        formation: 'narrow',
        waves: [
          {
            at: 0,
            entryPath: 'in',
            slots: ['boss', 'lurk', 'bee', 'bee', 'lurk', 'boss'].map((alien, home) => ({
              alien,
              home,
            })),
          },
        ],
      },
    }),
  );
}

/** The couplings of a list of packs layered over Classic, under the rules in force. */
function couplingsOf(packs: readonly LoadedPack[]): ReturnType<typeof findCouplings> {
  const registry = createRegistry(packs);
  const rules = registry.rules;
  if (rules === undefined) throw new Error('these packs ship no rules');
  return findCouplings(registry, rules);
}

describe('the rules resolvers the couplings read', () => {
  it('names the roles a difficulty row gives launch credit', () => {
    expect([...launchRoles(classicRules())].sort()).toEqual(['drone', 'warden', 'wing']);
  });

  it('reads continuous bombing as a range of live-enemy counts', () => {
    expect(continuousBombingCounts(classicRules())).toEqual({ min: 6, max: 14 });
  });

  it('numbers a combat stage around the challenge stages', () => {
    const rules = classicRules();
    const numbers = Array.from({ length: 8 }, (_unused, position) =>
      combatStageNumber(rules, position),
    );
    // Classic's challenge stages are 3, 7 and 11: the third row is stage 4.
    expect(numbers).toEqual([1, 2, 4, 5, 6, 8, 9, 10]);
    for (const stage of numbers) expect(isChallengeStage(rules, stage)).toBe(false);
  });

  it('numbers every stage when the rules have no challenge stages', () => {
    const rules: Rules = {
      ...classicRules(),
      challengeStages: { ...classicRules().challengeStages, enabled: false },
    };
    expect(combatStageNumber(rules, 2)).toBe(3);
  });
});

describe('a mix is coupled to its rules in four ways the documents show', () => {
  const found = couplingsOf([classicPack(), oddPack()]);

  it('finds a role no difficulty row names, by its label (section 7.1)', () => {
    expect(found).toContainEqual({
      kind: 'silent-role',
      role: 'lurker',
      label: 'Lurker',
      stages: ['odd-1'],
    });
  });

  it('finds a formation narrower than the breathe table (section 7.2)', () => {
    expect(found).toContainEqual({
      kind: 'breathe',
      formation: 'narrow',
      columns: 6,
      rows: 1,
      tableColumns: 10,
      tableRows: 6,
      stages: ['odd-1'],
    });
  });

  it('finds a fleet smaller than the rules were written for (section 7.3)', () => {
    expect(found).toContainEqual({
      kind: 'continuous-bombing',
      fleet: 6,
      reference: 40,
      min: 6,
      max: 14,
      stages: ['odd-1'],
    });
  });

  it('finds captors with nowhere to park a fighter (section 7.4)', () => {
    expect(found).toContainEqual({ kind: 'no-capture', formation: 'narrow', stages: ['odd-1'] });
  });

  it('finds nothing else', () => {
    expect(found).toHaveLength(4);
  });
});

describe('the shipped packs', () => {
  it('couple Classic on its own to nothing', () => {
    expect(couplingsOf([classicPack()])).toEqual([]);
  });

  it('couple Deep Sea over Classic to the bombing threshold, and only that', () => {
    expect(couplingsOf([classicPack(), installedPack('deep-sea')])).toEqual([
      {
        kind: 'continuous-bombing',
        fleet: 26,
        reference: 40,
        min: 6,
        max: 14,
        stages: ['reef-1', 'reef-2', 'reef-3'],
      },
    ]);
  });

  it('couple nothing when the overlay changes no stage', () => {
    expect(couplingsOf([classicPack(), installedPack('swarm-remix')])).toEqual([]);
  });
});
