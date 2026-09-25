/**
 * The player's fighter (docs/DESIGN.md section 4, "Player").
 *
 * Horizontal movement only, along the bottom row, with **no velocity and no
 * acceleration**. The original steps alternately 1 and 2 pixels per frame while
 * the stick is held — a flag XOR-ed with 1 on every call, 1 px when the result
 * is non-zero and 2 px when it is zero — and clears that flag whenever the stick
 * goes neutral, so the first frame of any new movement is always a 1-px step.
 * The average is 1.5 px/frame, ≈ 91 px/s.
 *
 * It is tempting to smooth that into `x += 1.5`. Don't: the cadence is audible
 * in the feel of the controls, it is the thing the reference actually verified,
 * and a whole-pixel position is what keeps the sim exactly reproducible.
 */

import { maxXFor } from '../content/rules.js';
import type { FighterMode, Rules } from '../content/schema.js';
import { isDown, type InputFrame } from '../engine/input.js';

export interface PlayerState {
  /** Sprite left edge, in playfield columns. Always a whole number. */
  x: number;
  y: number;
  mode: FighterMode;
  /**
   * The ROM's `$92A3` toggle. Part of the state, not a derived value: it has to
   * survive into a saved state or a replay would diverge by a pixel per burst.
   */
  stepFlag: number;
  /** False while the fighter is off the field after a hit. */
  alive: boolean;
  /** Steps left before the next fighter appears; 0 when none is pending. */
  respawnTimer: number;
}

/** Movement direction for one step: -1, 0 or +1. */
export type MoveDirection = -1 | 0 | 1;

/** Centre of the fighter's travel, where a new life starts. */
export function startX(rules: Rules, mode: FighterMode = 'single'): number {
  return Math.floor((rules.player.minX + maxXFor(rules, mode)) / 2);
}

export function createPlayer(rules: Rules, mode: FighterMode = 'single'): PlayerState {
  return {
    x: startX(rules, mode),
    y: rules.player.y,
    mode,
    stepFlag: 0,
    alive: true,
    respawnTimer: 0,
  };
}

/**
 * Which way the stick is pushed.
 *
 * A real cabinet stick cannot be left and right at once; a keyboard can, so both
 * held is read as neutral, which also clears the step flag exactly as letting go
 * would.
 */
export function moveDirection(frame: InputFrame): MoveDirection {
  const left = isDown(frame, 'left');
  const right = isDown(frame, 'right');
  if (left === right) return 0;
  return left ? -1 : 1;
}

/** The ROM's `flag ^= 1`, kept in one place so distance and state cannot drift. */
export function toggleStepFlag(stepFlag: number): number {
  return stepFlag === 0 ? 1 : 0;
}

/**
 * Pixels the next step moves, given the current flag — without advancing it.
 * Exported so a test can state the cadence as 1, 2, 1, 2 … rather than infer it
 * from positions.
 */
export function stepDistance(rules: Rules, stepFlag: number): number {
  const pattern = rules.player.stepPattern;
  // The ROM's branch: 1 px when the XOR result is non-zero, 2 px when it is
  // zero. `stepPattern` is that pair, and it comes from the pack, so a pack can
  // retune it — or state a single step, which is then a constant speed.
  const distance = toggleStepFlag(stepFlag) !== 0 ? pattern[0] : (pattern[1] ?? pattern[0]);
  return distance ?? 1;
}

/** Advance the fighter by exactly one simulation step. */
export function stepPlayer(player: PlayerState, frame: InputFrame, rules: Rules): void {
  if (!player.alive) return;

  const direction = moveDirection(frame);
  if (direction === 0) {
    // Neutral clears the flag, which is why any new movement starts at 1 px.
    player.stepFlag = 0;
    return;
  }

  const distance = stepDistance(rules, player.stepFlag);
  player.stepFlag = toggleStepFlag(player.stepFlag);

  const limit = maxXFor(rules, player.mode);
  player.x = Math.min(limit, Math.max(rules.player.minX, player.x + direction * distance));
}

/** Every ship the fighter currently is: one anchor, or two for a dual fighter. */
export function shipAnchors(
  player: PlayerState,
  rules: Rules,
): { readonly x: number; readonly y: number }[] {
  if (player.mode !== 'dual') return [{ x: player.x, y: player.y }];
  return [
    { x: player.x, y: player.y },
    { x: player.x + rules.player.secondShipOffsetX, y: player.y },
  ];
}
