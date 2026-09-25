import { describe, expect, it } from 'vitest';

import { BADGE_DENOMINATIONS, badgesForStage, formatScore } from '../../src/ui/hud.js';

describe('stage badges', () => {
  it('uses the six arcade denominations', () => {
    expect([...BADGE_DENOMINATIONS].sort((a, b) => a - b)).toEqual([1, 5, 10, 20, 30, 50]);
  });

  it('is greedy, largest first', () => {
    expect(badgesForStage(1)).toEqual([1]);
    expect(badgesForStage(4)).toEqual([1, 1, 1, 1]);
    expect(badgesForStage(7)).toEqual([5, 1, 1]);
    expect(badgesForStage(31)).toEqual([30, 1]);
    expect(badgesForStage(50)).toEqual([50]);
    expect(badgesForStage(99)).toEqual([50, 30, 10, 5, 1, 1, 1, 1]);
  });

  it('always adds up to the stage number', () => {
    for (let stage = 0; stage <= 120; stage += 1) {
      const total = badgesForStage(stage).reduce((sum, badge) => sum + badge, 0);
      expect(total).toBe(stage);
    }
  });

  it('shows nothing before the first stage', () => {
    expect(badgesForStage(0)).toEqual([]);
    expect(badgesForStage(-3)).toEqual([]);
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
