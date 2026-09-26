import { describe, expect, it } from 'vitest';

import { badgesForStage, formatScore, type StageBadge } from '../../src/ui/hud.js';
import { classicPack } from '../helpers/rules.js';

/**
 * The badge denominations are the shipped pack's, not the HUD's — a sibling game
 * in the lineage counts stages differently or not at all, so reading them off
 * `pack.json` is what keeps this game's numbers out of `src/ui/`.
 */
const badges = classicPack().manifest.stageBadges;
const values = (shown: readonly StageBadge[]): number[] => shown.map((badge) => badge.value);

describe('stage badges', () => {
  it('uses the six arcade denominations, declared by the pack', () => {
    expect([...badges].map((badge) => badge.value).sort((a, b) => a - b)).toEqual([
      1, 5, 10, 20, 30, 50,
    ]);
  });

  it('draws each denomination with the pack’s own sprite', () => {
    // Placeholder rectangles were what landed; the art is in the pack, and this
    // is what stops the HUD growing a colour table of its own again.
    expect(badges.map((badge) => badge.sprite).sort()).toEqual([
      'badge-1',
      'badge-10',
      'badge-20',
      'badge-30',
      'badge-5',
      'badge-50',
    ]);
  });

  it('is greedy, largest first', () => {
    expect(values(badgesForStage(1, badges))).toEqual([1]);
    expect(values(badgesForStage(4, badges))).toEqual([1, 1, 1, 1]);
    expect(values(badgesForStage(7, badges))).toEqual([5, 1, 1]);
    expect(values(badgesForStage(31, badges))).toEqual([30, 1]);
    expect(values(badgesForStage(50, badges))).toEqual([50]);
    expect(values(badgesForStage(99, badges))).toEqual([50, 30, 10, 5, 1, 1, 1, 1]);
  });

  it('is greedy however the pack ordered its denominations', () => {
    // Greedy is only correct largest-first, so the order in `pack.json` must not
    // be load-bearing: a pack listing 1 before 50 would otherwise show stage 50
    // as fifty single badges.
    const shuffled = [...badges].sort((a, b) => a.value - b.value);
    expect(values(badgesForStage(31, shuffled))).toEqual([30, 1]);
  });

  it('always adds up to the stage number', () => {
    for (let stage = 0; stage <= 120; stage += 1) {
      const total = badgesForStage(stage, badges).reduce((sum, badge) => sum + badge.value, 0);
      expect(total).toBe(stage);
    }
  });

  it('shows nothing before the first stage', () => {
    expect(badgesForStage(0, badges)).toEqual([]);
    expect(badgesForStage(-3, badges)).toEqual([]);
  });

  it('shows nothing for a pack that declares no badges', () => {
    expect(badgesForStage(31, [])).toEqual([]);
  });
});

describe('the score display', () => {
  it("is six digits wide, as the original's player-1 display is", () => {
    expect(formatScore(0)).toHaveLength(6);
    expect(formatScore(123_456)).toBe('123456');
    expect(formatScore(50)).toBe('    50');
  });

  it('shows a fresh game as 00 rather than 000000', () => {
    expect(formatScore(0)).toBe('    00');
  });
});
