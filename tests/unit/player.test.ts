import { describe, expect, it } from 'vitest';

import { averageStepDistance } from '../../src/content/rules.js';
import { EMPTY_FRAME, frameOf } from '../../src/engine/input.js';
import {
  createPlayer,
  moveDirection,
  shipAnchors,
  stepDistance,
  stepPlayer,
} from '../../src/sim/player.js';
import { classicRules } from '../helpers/rules.js';

// Every number here comes from the shipped pack through the loader; nothing in
// this file states a rules value of its own.
const rules = classicRules();
const fighter = rules.player;
const LEFT = frameOf('left');
const RIGHT = frameOf('right');

/** Run `steps` steps of held input and report the X after each one. */
function positions(steps: number, frame: number, startAt?: number): number[] {
  const player = createPlayer(rules);
  if (startAt !== undefined) player.x = startAt;
  const out: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    stepPlayer(player, frame, rules);
    out.push(player.x);
  }
  return out;
}

describe('the alternating 1/2 pixel cadence', () => {
  it('steps 1, 2, 1, 2 … while the stick is held', () => {
    const start = createPlayer(rules).x;
    expect(positions(6, RIGHT, start)).toEqual([
      start + 1,
      start + 3,
      start + 4,
      start + 6,
      start + 7,
      start + 9,
    ]);
  });

  it('starts every new movement with a 1-pixel step', () => {
    const player = createPlayer(rules);
    const start = player.x;

    stepPlayer(player, RIGHT, rules);
    expect(player.x - start).toBe(1);
    stepPlayer(player, RIGHT, rules);
    expect(player.x - start).toBe(3); // the 2-px half of the cadence

    // Let go: the ROM clears the flag whenever the stick is neutral, so the
    // next movement starts at 1 px again rather than continuing 2, 1, 2 …
    stepPlayer(player, EMPTY_FRAME, rules);
    const afterRelease = player.x;
    stepPlayer(player, LEFT, rules);
    expect(afterRelease - player.x).toBe(1);
  });

  it("averages 1.5 px per frame — the arcade's ~91 px/s", () => {
    // 100 steps from the left limit, which stays clear of the right one.
    const moved = positions(100, RIGHT, fighter.minX);
    const travelled = (moved[moved.length - 1] ?? 0) - fighter.minX;
    expect(travelled / 100).toBe(1.5);
    // And the cadence's own mean says the same thing, so the two cannot drift.
    expect(averageStepDistance(rules)).toBe(1.5);
    // The original runs at 60.6061 Hz, where 1.5 px/frame is 90.9 px/s; we step
    // at 60 Hz and accept the 0.6% difference (docs/DESIGN.md section 4).
    expect(1.5 * 60.6061).toBeCloseTo(91, 0);
  });

  it('is whole pixels, never a fractional velocity', () => {
    for (const x of positions(50, LEFT, 150)) expect(Number.isInteger(x)).toBe(true);
  });

  it('exposes the next step distance without advancing anything', () => {
    expect(stepDistance(rules, 0)).toBe(1);
    expect(stepDistance(rules, 1)).toBe(2);
  });

  it('keeps toggling while held against a limit', () => {
    const player = createPlayer(rules);
    player.x = fighter.minX;
    for (let i = 0; i < 10; i += 1) stepPlayer(player, LEFT, rules);
    expect(player.x).toBe(fighter.minX);
    // The stick was never neutral, so the flag kept alternating: after ten
    // steps it is back where it started.
    expect(player.stepFlag).toBe(0);
  });
});

describe('travel limits', () => {
  it("clamps a single fighter to the pack's limits", () => {
    // That those limits are the verified ROM bytes $12…$E1 is asserted against
    // the arcade reference in tests/unit/classic-pack.test.ts; here the point is
    // that the simulation obeys whatever the pack said.
    const player = createPlayer(rules);
    for (let i = 0; i < 400; i += 1) stepPlayer(player, LEFT, rules);
    expect(player.x).toBe(fighter.minX);
    for (let i = 0; i < 400; i += 1) stepPlayer(player, RIGHT, rules);
    expect(player.x).toBe(fighter.maxX);
  });

  it('stops a dual fighter earlier, so its second ship still fits', () => {
    expect(fighter.maxX - (fighter.dualMaxX ?? fighter.maxX)).toBe(0x10);

    const player = createPlayer(rules, 'dual');
    for (let i = 0; i < 400; i += 1) stepPlayer(player, RIGHT, rules);
    expect(player.x).toBe(fighter.dualMaxX);
  });

  it('gives a fighter mode with no limit of its own the single-fighter one', () => {
    const { dualMaxX: _dropped, ...withoutDualLimit } = fighter;
    const noDualLimit = { ...rules, player: withoutDualLimit };
    const player = createPlayer(noDualLimit, 'dual');
    for (let i = 0; i < 400; i += 1) stepPlayer(player, RIGHT, noDualLimit);
    expect(player.x).toBe(fighter.maxX);
  });

  it('sits on the playfield, with the left limit at column 0', () => {
    // 207 positions of travel, so a 16-px fighter covers 223 of the 224
    // columns whatever the origin; the pack's choice of origin decides which
    // column is left over, and it puts the left limit flush against the edge.
    expect(fighter.minX).toBe(0);
    expect(fighter.maxX + fighter.width).toBe(223);
    expect(
      (fighter.dualMaxX ?? fighter.maxX) + fighter.secondShipOffsetX + fighter.width,
    ).toBeLessThanOrEqual(rules.playfield.width);
  });
});

describe('the stick', () => {
  it('reads left, right and neutral', () => {
    expect(moveDirection(LEFT)).toBe(-1);
    expect(moveDirection(RIGHT)).toBe(1);
    expect(moveDirection(EMPTY_FRAME)).toBe(0);
  });

  it('reads both directions at once as neutral, which a real stick cannot do', () => {
    expect(moveDirection(frameOf('left', 'right'))).toBe(0);
  });

  it('ignores fire and start', () => {
    expect(moveDirection(frameOf('fire', 'start'))).toBe(0);
  });
});

describe('ships', () => {
  it('is one ship for a single fighter', () => {
    const player = createPlayer(rules);
    expect(shipAnchors(player, rules)).toEqual([{ x: player.x, y: fighter.y }]);
  });

  it('is two ships 15 px apart for a dual fighter', () => {
    const player = createPlayer(rules, 'dual');
    const anchors = shipAnchors(player, rules);
    expect(anchors).toHaveLength(2);
    expect((anchors[1]?.x ?? 0) - (anchors[0]?.x ?? 0)).toBe(0x0f);
  });
});

describe('a fighter that is not on the field', () => {
  it('does not move', () => {
    const player = createPlayer(rules);
    player.alive = false;
    const before = player.x;
    for (let i = 0; i < 20; i += 1) stepPlayer(player, RIGHT, rules);
    expect(player.x).toBe(before);
  });
});
