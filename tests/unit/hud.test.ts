import { describe, expect, it } from 'vitest';

import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../src/render/canvas.js';
import type { SpriteSheet } from '../../src/render/sprites.js';
import { CELL } from '../../src/render/text.js';
import {
  BOTTOM_BAND_HEIGHT,
  badgesForStage,
  formatScore,
  PERSONA_TAG_Y,
  personaTag,
  personaTagCells,
  type StageBadge,
} from '../../src/ui/hud.js';
import { shippedVariants } from '../helpers/variants.js';
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

describe('the persona tag', () => {
  /** Never drawn from: `personaTagCells` only asks whether a sheet is there. */
  const sheet = {} as SpriteSheet;
  const labels = shippedVariants().flatMap((variant) => variant.personas.map((p) => p.label));

  it('sits in the bottom band, which is the HUD’s and never the playfield’s', () => {
    expect(PERSONA_TAG_Y).toBeGreaterThanOrEqual(LOGICAL_HEIGHT - BOTTOM_BAND_HEIGHT);
    expect(PERSONA_TAG_Y + CELL).toBeLessThanOrEqual(LOGICAL_HEIGHT);
  });

  it('says AUTO and the whole label for every shipped persona on an opening stage', () => {
    // Three fighters in reserve and one badge is the demo's opening screen.
    const cells = personaTagCells({ lives: 3, stage: 1, badges, sheet });
    for (const label of labels) expect(personaTag(label, cells)).toBe(`AUTO  ${label}`);
  });

  it('keeps clear of the reserve fighters and the badges as both rows grow', () => {
    for (const lives of [0, 2, 5, 9]) {
      for (const stage of [0, 1, 4, 9, 28, 99]) {
        const cells = personaTagCells({ lives, stage, badges, sheet });
        const half = (cells * CELL) / 2;
        const shownLives = Math.min(lives, 5);
        const livesRight = shownLives === 0 ? 0 : 2 + (shownLives - 1) * 14 + 12;
        const shownBadges = Math.min(badgesForStage(stage, badges).length, 8);
        const badgesLeft = shownBadges === 0 ? LOGICAL_WIDTH : LOGICAL_WIDTH - 2 - shownBadges * 10;
        expect(LOGICAL_WIDTH / 2 - half).toBeGreaterThan(livesRight);
        expect(LOGICAL_WIDTH / 2 + half).toBeLessThan(badgesLeft);
      }
    }
  });

  it('drops the prefix before the label, and cuts the label only when nothing else fits', () => {
    expect(personaTag('ASTRONAUT', 15)).toBe('AUTO  ASTRONAUT');
    expect(personaTag('ASTRONAUT', 14)).toBe('ASTRONAUT');
    expect(personaTag('ASTRONAUT', 7)).toBe('ASTRONA');
    expect(personaTag('ASTRONAUT', 0)).toBe('');
  });

  it('still says something true on the most crowded band there is', () => {
    // Five reserve fighters and eight badges: the widest both rows ever get.
    const cells = personaTagCells({ lives: 5, stage: 99, badges, sheet });
    expect(cells).toBeGreaterThan(0);
    for (const label of labels) {
      const tag = personaTag(label, cells);
      expect(tag.length).toBeGreaterThan(0);
      expect(label.startsWith(tag)).toBe(true);
    }
  });
});
