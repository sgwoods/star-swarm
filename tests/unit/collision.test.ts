import { describe, expect, it } from 'vitest';

import {
  expandWindow,
  hitsAny,
  hitWindowIndex,
  NO_PADDING,
  windowGapsX,
  withinWindow,
} from '../../src/sim/collision.js';
import { CLASSIC_RULES, type HitWindow, shotWindowsFor } from '../../src/sim/rules.js';

const single = shotWindowsFor(CLASSIC_RULES.shots, 'single');
const dual = shotWindowsFor(CLASSIC_RULES.shots, 'dual');

/** Which Δx values hit, for a target on the same row as the subject. */
function hitsAcross(windows: readonly HitWindow[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let dx = from; dx <= to; dx += 1) {
    if (hitsAny({ x: 0, y: 0 }, { x: dx, y: 0 }, windows)) out.push(dx);
  }
  return out;
}

describe('hitWindow tests', () => {
  const hitWindow: HitWindow = { dxMin: -5, dxMax: 5, dyMin: -6, dyMax: 6 };

  it('measures the offset from subject to target', () => {
    expect(withinWindow({ x: 100, y: 100 }, { x: 105, y: 100 }, hitWindow)).toBe(true);
    expect(withinWindow({ x: 100, y: 100 }, { x: 106, y: 100 }, hitWindow)).toBe(false);
    expect(withinWindow({ x: 100, y: 100 }, { x: 95, y: 100 }, hitWindow)).toBe(true);
    expect(withinWindow({ x: 100, y: 100 }, { x: 94, y: 100 }, hitWindow)).toBe(false);
  });

  it('is inclusive at both edges on both axes', () => {
    expect(withinWindow({ x: 0, y: 0 }, { x: -5, y: -6 }, hitWindow)).toBe(true);
    expect(withinWindow({ x: 0, y: 0 }, { x: 5, y: 6 }, hitWindow)).toBe(true);
    expect(withinWindow({ x: 0, y: 0 }, { x: 0, y: 7 }, hitWindow)).toBe(false);
  });

  it('reports which hitWindow matched, not just that one did', () => {
    expect(hitWindowIndex({ x: 0, y: 0 }, { x: 0, y: 0 }, dual)).toBe(0);
    expect(hitWindowIndex({ x: 0, y: 0 }, { x: 15, y: 0 }, dual)).toBe(1);
    expect(hitWindowIndex({ x: 0, y: 0 }, { x: 6, y: 0 }, dual)).toBe(-1);
  });
});

describe('the verified shot windows', () => {
  it('gives a single fighter one continuous hitWindow, Δx ∈ [−5, +5]', () => {
    expect(hitsAcross(single, -10, 25)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
  });

  it('gives a dual fighter two windows with Δx ∈ [+5, +8] deliberately dead', () => {
    const hit = hitsAcross(dual, -10, 25);
    expect(hit).toEqual([
      -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    for (const dx of [5, 6, 7, 8]) expect(hit).not.toContain(dx);
  });

  it('names the dead gap, so nobody closes it as a bug', () => {
    expect(windowGapsX(dual)).toEqual([[5, 8]]);
    expect(windowGapsX(single)).toEqual([]);
  });
});

describe('windows are data, not constants in the collision code', () => {
  it('honours a hitWindow a pack invented', () => {
    const wide: HitWindow[] = [{ dxMin: -40, dxMax: 40, dyMin: -1, dyMax: 1 }];
    expect(hitsAny({ x: 0, y: 0 }, { x: 40, y: 1 }, wide)).toBe(true);
    expect(hitsAny({ x: 0, y: 0 }, { x: 40, y: 2 }, wide)).toBe(false);
  });

  it('misses everything when a target has no windows at all', () => {
    expect(hitsAny({ x: 0, y: 0 }, { x: 0, y: 0 }, [])).toBe(false);
  });
});

describe('target padding', () => {
  const hitWindow: HitWindow = { dxMin: -5, dxMax: 5, dyMin: -6, dyMax: 6 };

  it('widens a hitWindow without replacing it', () => {
    expect(expandWindow(hitWindow, { x: 3, y: 1 })).toEqual({
      dxMin: -8,
      dxMax: 8,
      dyMin: -7,
      dyMax: 7,
    });
  });

  it('is the arcade behaviour when it is zero', () => {
    expect(expandWindow(hitWindow, NO_PADDING)).toBe(hitWindow);
  });

  it("keeps the dual fighter's dead gap, which a replacement hitWindow would lose", () => {
    // A 1-px-wider target narrows the 4-px dead gap to 2 px; it does not close
    // it, and both windows are still there.
    const padding = { x: 1, y: 0 };
    expect(windowGapsX(dual.map((w) => expandWindow(w, padding)))).toEqual([[6, 7]]);
    expect(hitsAny({ x: 0, y: 0 }, { x: 5, y: 0 }, dual, padding)).toBe(true);
    expect(hitsAny({ x: 0, y: 0 }, { x: 6, y: 0 }, dual, padding)).toBe(false);
    expect(hitsAny({ x: 0, y: 0 }, { x: 7, y: 0 }, dual, padding)).toBe(false);
    expect(hitsAny({ x: 0, y: 0 }, { x: 8, y: 0 }, dual, padding)).toBe(true);
  });
});
