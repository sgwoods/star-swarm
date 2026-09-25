/**
 * Overlap tests (docs/DESIGN.md section 4).
 *
 * The arcade original does not use bounding boxes. It compares two sprite
 * anchors and asks whether the difference falls inside a *window* — which is why
 * the dual fighter's shot has two windows with a four-pixel dead gap between
 * them, something no box intersection can express. So the primitive here is the
 * window, and the windows themselves are data from `src/sim/rules.ts` rather
 * than constants in this file: a pack that wants fatter aliens changes its
 * rules, not this code.
 *
 * Every offset is measured target-anchor minus subject-anchor, so a positive Δx
 * means the target is to the right of the thing being tested.
 */

import type { HitWindow } from './rules.js';

/** Anything with a position. Anchors are sprite top-left, in playfield pixels. */
export interface Anchored {
  readonly x: number;
  readonly y: number;
}

/**
 * How much a target widens the window it is tested against, in pixels per side.
 *
 * The original tests one window per fighter mode against *every* enemy — enemy
 * size is baked into the single window it uses. Star Swarm has to let a pack
 * define a fatter alien without breaking that, so a target carries padding that
 * widens whatever window is being applied rather than replacing it. Zero padding
 * is exactly the arcade behaviour, and padding composes correctly with the dual
 * fighter's *two* windows — including the dead gap between them, which a
 * per-target replacement window would silently lose.
 */
export interface HitPadding {
  readonly x: number;
  readonly y: number;
}

/** No widening: the arcade's own behaviour. */
export const NO_PADDING: HitPadding = Object.freeze({ x: 0, y: 0 });

/** Widen a window by a target's padding. */
export function expandWindow(hitWindow: HitWindow, padding: HitPadding): HitWindow {
  if (padding.x === 0 && padding.y === 0) return hitWindow;
  return {
    dxMin: hitWindow.dxMin - padding.x,
    dxMax: hitWindow.dxMax + padding.x,
    dyMin: hitWindow.dyMin - padding.y,
    dyMax: hitWindow.dyMax + padding.y,
  };
}

/** Does `target` sit inside `window`, measured from `subject`? */
export function withinWindow(subject: Anchored, target: Anchored, hitWindow: HitWindow): boolean {
  const dx = target.x - subject.x;
  const dy = target.y - subject.y;
  return (
    dx >= hitWindow.dxMin && dx <= hitWindow.dxMax && dy >= hitWindow.dyMin && dy <= hitWindow.dyMax
  );
}

/**
 * Does `target` sit inside any of `windows`? Returns the index of the window
 * that matched, or `-1`. The index matters for the dual fighter: it says which
 * of the two bullets connected, which Milestone 2 uses for the hit effect.
 */
export function hitWindowIndex(
  subject: Anchored,
  target: Anchored,
  windows: readonly HitWindow[],
  padding: HitPadding = NO_PADDING,
): number {
  for (let i = 0; i < windows.length; i += 1) {
    const candidate = windows[i];
    if (candidate === undefined) continue;
    if (withinWindow(subject, target, expandWindow(candidate, padding))) return i;
  }
  return -1;
}

/** Convenience over {@link hitWindowIndex}. */
export function hitsAny(
  subject: Anchored,
  target: Anchored,
  windows: readonly HitWindow[],
  padding: HitPadding = NO_PADDING,
): boolean {
  return hitWindowIndex(subject, target, windows, padding) >= 0;
}

/**
 * The gaps a set of windows leaves along Δx, as `[from, to]` pairs.
 *
 * Exists so the dual fighter's deliberate dead zone can be asserted directly
 * rather than inferred: `docs/reference/arcade-reference.md` section 3 records
 * Δx ∈ [+5, +8] as missing, and a test that says so will notice if someone
 * "fixes" the gap away.
 */
export function windowGapsX(windows: readonly HitWindow[]): [number, number][] {
  const sorted = [...windows].sort((a, b) => a.dxMin - b.dxMin);
  const gaps: [number, number][] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous === undefined || current === undefined) continue;
    if (current.dxMin > previous.dxMax + 1) gaps.push([previous.dxMax + 1, current.dxMin - 1]);
  }
  return gaps;
}
