import { describe, expect, it } from 'vitest';

import {
  extraLivesEarnedAt,
  extraLivesEarnedBetween,
  NO_EXTRA_LIFE_AWARD,
  resolveExtraLifeAward,
} from '../../src/content/rules.js';
import type { ExtraLifeAward, Rules } from '../../src/content/schema.js';
import { createLives } from '../../src/sim/lives.js';
import { classicRules } from '../helpers/rules.js';

/**
 * Extra lives are a *rule*, so they are tested against the shipped pack rather
 * than against numbers this file makes up. What the simulation contributes is
 * only the reserve count; everything above that is `src/content/rules.ts`
 * reading `packs/classic/rules.json`.
 */
const rules = classicRules();

/** The same rules, as a cabinet started on a different number of fighters. */
function startedOn(startingLives: number): Rules {
  return { ...rules, lives: { ...rules.lives, default: startingLives } };
}

/** The same rules on a different DIP setting. */
function atSetting(setting: number): Rules {
  return { ...rules, extraLives: { ...rules.extraLives, setting } };
}

describe('the two threshold tables', () => {
  it('ships eight settings for each starting-fighter count', () => {
    const forThreeShips = rules.extraLives.options.filter((option) =>
      option.startingLives.includes(3),
    );
    const forFiveShips = rules.extraLives.options.filter((option) =>
      option.startingLives.includes(5),
    );
    expect(forThreeShips).toHaveLength(8);
    expect(forFiveShips).toHaveLength(8);
  });

  it('gives the factory default 20k / 70k / every 70k on a 3-fighter cabinet', () => {
    expect(resolveExtraLifeAward(rules)).toEqual({
      mode: 'thresholds',
      first: 20_000,
      second: 70_000,
      repeat: 70_000,
    });
  });

  it('gives the same setting different thresholds on a 5-fighter cabinet', () => {
    // The reason there are two tables: the set on offer depends on the
    // starting-fighter count, so one table keyed by setting alone is wrong.
    expect(resolveExtraLifeAward(startedOn(5))).toEqual({
      mode: 'thresholds',
      first: 30_000,
      second: 120_000,
      repeat: 120_000,
    });
  });

  it('uses the 2-to-4 table for 2 and 4 fighters too', () => {
    const first = resolveExtraLifeAward(startedOn(2), 2);
    for (const ships of [2, 3, 4]) {
      expect(resolveExtraLifeAward(startedOn(ships))).toEqual(first);
    }
  });

  it('models the settings that award nothing at all', () => {
    expect(resolveExtraLifeAward(atSetting(7))).toEqual(NO_EXTRA_LIFE_AWARD);
    expect(resolveExtraLifeAward(atSetting(7), 5)).toEqual(NO_EXTRA_LIFE_AWARD);
  });

  it('falls back to no award rather than guessing at an unknown setting', () => {
    expect(resolveExtraLifeAward(atSetting(99))).toEqual(NO_EXTRA_LIFE_AWARD);
  });

  it('takes the stated award when the rules name no setting', () => {
    const { setting: _unset, ...extraLives } = rules.extraLives;
    const unset: Rules = { ...rules, extraLives };
    expect(resolveExtraLifeAward(unset, 5)).toEqual(rules.extraLives.award);
  });
});

describe('awarding extra lives', () => {
  const classic = resolveExtraLifeAward(rules);
  const ceiling = rules.extraLives.stopAfterScore;

  it('counts the awards a score has earned', () => {
    const at = (score: number) => extraLivesEarnedAt(classic, score, ceiling);
    expect(at(0)).toBe(0);
    expect(at(19_999)).toBe(0);
    expect(at(20_000)).toBe(1);
    expect(at(69_999)).toBe(1);
    expect(at(70_000)).toBe(2);
    expect(at(140_000)).toBe(3);
    expect(at(209_999)).toBe(3);
    expect(at(210_000)).toBe(4);
  });

  it('awards on the crossing, once', () => {
    const between = (from: number, to: number) =>
      extraLivesEarnedBetween(classic, from, to, ceiling);
    expect(between(19_999, 20_000)).toBe(1);
    expect(between(20_000, 20_001)).toBe(0);
    expect(between(20_000, 69_999)).toBe(0);
  });

  it('awards twice when one hit crosses two thresholds', () => {
    // A 1,600-point captor taken at 19,000 crosses nothing else here, but a
    // setting whose thresholds sit close together can, and a per-step crossing
    // test would swallow the second award.
    const tight: ExtraLifeAward = { mode: 'thresholds', first: 100, second: 200, repeat: 100 };
    expect(extraLivesEarnedBetween(tight, 0, 500)).toBe(5);
  });

  it('stops repeating when the setting has no repeat interval', () => {
    const twoOnly = resolveExtraLifeAward(atSetting(3));
    expect(twoOnly).toMatchObject({ first: 20_000, second: 60_000 });
    expect(twoOnly).not.toHaveProperty('repeat');
    expect(extraLivesEarnedAt(twoOnly, 1_000_000, ceiling)).toBe(2);
  });

  it('awards nothing on the "none" setting, at any score', () => {
    expect(extraLivesEarnedAt(NO_EXTRA_LIFE_AWARD, 999_999)).toBe(0);
    expect(extraLivesEarnedBetween(NO_EXTRA_LIFE_AWARD, 0, 999_999)).toBe(0);
  });

  it('stops awarding past the ceiling the pack states', () => {
    expect(ceiling).toBe(1_000_000);
    const atCeiling = extraLivesEarnedAt(classic, 1_000_000, ceiling);
    expect(extraLivesEarnedAt(classic, 5_000_000, ceiling)).toBe(atCeiling);
    expect(extraLivesEarnedBetween(classic, 1_000_000, 5_000_000, ceiling)).toBe(0);
  });

  it('never stops when the rules state no ceiling', () => {
    expect(extraLivesEarnedBetween(classic, 1_000_000, 5_000_000)).toBeGreaterThan(0);
  });
});

describe('the reserve', () => {
  it('starts one below the fighter count, because one is on the field', () => {
    expect(createLives(rules).reserve).toBe(2);
    expect(createLives(startedOn(5)).reserve).toBe(4);
  });

  it('never starts negative', () => {
    expect(createLives({ ...rules, lives: { ...rules.lives, default: 0 } }).reserve).toBe(0);
  });
});
