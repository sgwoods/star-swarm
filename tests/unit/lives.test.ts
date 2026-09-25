import { describe, expect, it } from 'vitest';

import {
  bonusesAwarded,
  bonusesEarnedAt,
  bonusThresholdsFor,
  bonusThresholdsOf,
  createLives,
  NO_BONUS,
} from '../../src/sim/lives.js';
import {
  BONUS_CEILING,
  BONUS_TABLE_SHIPS_2_TO_4,
  BONUS_TABLE_SHIPS_5,
  CLASSIC_RULES,
  FACTORY_BONUS_SETTING,
} from '../../src/sim/rules.js';

describe('the two threshold tables', () => {
  it('has eight settings in each', () => {
    expect(BONUS_TABLE_SHIPS_2_TO_4).toHaveLength(8);
    expect(BONUS_TABLE_SHIPS_5).toHaveLength(8);
  });

  it('gives the factory default 20k / 70k / every 70k on a 3-ship cabinet', () => {
    expect(bonusThresholdsFor(3, FACTORY_BONUS_SETTING)).toEqual({
      first: 20_000,
      second: 70_000,
      repeat: 70_000,
    });
  });

  it('gives the same setting different thresholds on a 5-ship cabinet', () => {
    // The reason there are two tables: the set on offer depends on the
    // starting-ship count, so one table keyed by setting alone is wrong.
    expect(bonusThresholdsFor(5, FACTORY_BONUS_SETTING)).toEqual({
      first: 30_000,
      second: 120_000,
      repeat: 120_000,
    });
  });

  it('uses the 2-to-4 table for 2 and 4 ships too', () => {
    for (const ships of [2, 3, 4]) {
      expect(bonusThresholdsFor(ships, 0)).toEqual(BONUS_TABLE_SHIPS_2_TO_4[0]);
    }
  });

  it('models the settings that award nothing at all', () => {
    expect(bonusThresholdsFor(3, 7)).toEqual(NO_BONUS);
    expect(bonusThresholdsFor(5, 7)).toEqual(NO_BONUS);
  });

  it('falls back to no bonus rather than guessing at an unknown setting', () => {
    expect(bonusThresholdsFor(3, 99)).toEqual(NO_BONUS);
    expect(bonusThresholdsFor(3, -1)).toEqual(NO_BONUS);
  });

  it('resolves from the rules', () => {
    expect(bonusThresholdsOf(CLASSIC_RULES.lives)).toEqual({
      first: 20_000,
      second: 70_000,
      repeat: 70_000,
    });
  });
});

describe('awarding extra lives', () => {
  const classic = bonusThresholdsFor(3, FACTORY_BONUS_SETTING);

  it('counts the awards a score has earned', () => {
    expect(bonusesEarnedAt(0, classic)).toBe(0);
    expect(bonusesEarnedAt(19_999, classic)).toBe(0);
    expect(bonusesEarnedAt(20_000, classic)).toBe(1);
    expect(bonusesEarnedAt(69_999, classic)).toBe(1);
    expect(bonusesEarnedAt(70_000, classic)).toBe(2);
    expect(bonusesEarnedAt(140_000, classic)).toBe(3);
    expect(bonusesEarnedAt(209_999, classic)).toBe(3);
    expect(bonusesEarnedAt(210_000, classic)).toBe(4);
  });

  it('awards on the crossing, once', () => {
    expect(bonusesAwarded(19_999, 20_000, classic)).toBe(1);
    expect(bonusesAwarded(20_000, 20_001, classic)).toBe(0);
    expect(bonusesAwarded(20_000, 69_999, classic)).toBe(0);
  });

  it('awards twice when one hit crosses two thresholds', () => {
    // A 1,600-point boss taken at 19,000 crosses nothing else here, but a
    // setting whose thresholds sit close together can, and a per-step crossing
    // test would swallow the second award.
    const tight = { first: 100, second: 200, repeat: 100 };
    expect(bonusesAwarded(0, 500, tight)).toBe(5);
  });

  it('stops repeating when the setting has no repeat interval', () => {
    const twoOnly = bonusThresholdsFor(3, 3); // 20,000 and 60,000 only
    expect(twoOnly).toEqual({ first: 20_000, second: 60_000, repeat: null });
    expect(bonusesEarnedAt(1_000_000, twoOnly)).toBe(2);
  });

  it('awards nothing on the "none" setting, at any score', () => {
    expect(bonusesEarnedAt(999_999, NO_BONUS)).toBe(0);
    expect(bonusesAwarded(0, 999_999, NO_BONUS)).toBe(0);
  });

  it('stops awarding past 1,000,000', () => {
    expect(BONUS_CEILING).toBe(1_000_000);
    const atCeiling = bonusesEarnedAt(1_000_000, classic);
    expect(bonusesEarnedAt(5_000_000, classic)).toBe(atCeiling);
    expect(bonusesAwarded(1_000_000, 5_000_000, classic)).toBe(0);
  });
});

describe('the reserve', () => {
  it('starts one below the ship count, because one is on the field', () => {
    expect(createLives(CLASSIC_RULES.lives).reserve).toBe(2);
    expect(createLives({ ...CLASSIC_RULES.lives, startingShips: 5 }).reserve).toBe(4);
  });

  it('never starts negative', () => {
    expect(createLives({ ...CLASSIC_RULES.lives, startingShips: 0 }).reserve).toBe(0);
  });
});
