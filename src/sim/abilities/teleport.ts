/**
 * `teleport`: a diving enemy blinks to another column and carries on.
 *
 * The blink is a **displacement of the flight it is already flying** — same
 * path, same frame of it, same events still to come — rather than a new dive,
 * so a teleport cannot reload a bomb allowance, restart a path that triggers it
 * again, or change where the dive ends up relative to where it now is
 * (`shiftPath` in `../paths.ts`). Only the column moves; the row is the one the
 * enemy had.
 *
 * Where it lands is a draw from the world's seeded generator, anywhere at least
 * `margin` inside either edge of the playfield, so a seed still gives one world.
 * When is the pack's: every `everyFrames` frames of a dive, at every `trigger`
 * segment naming `teleport` on the path it is flying, or both. The timer runs
 * only while the enemy is diving and starts again with each dive, so an enemy
 * never blinks out of the formation or on its way back into it.
 */

import type { AbilityParams } from '../../content/schema.js';
import type { Enemy } from '../enemies.js';
import { shiftPath, type Vec2 } from '../paths.js';
import type { AbilityContext, AbilityModule, AbilityStep } from './registry.js';

/** One enemy's teleport timer. */
export interface TeleportState {
  /** Frames of this dive until the next timed blink. */
  timer: number;
}

export const teleport: AbilityModule<'teleport'> = Object.freeze({
  type: 'teleport',

  step(state, ctx, enemy, params, triggered, out) {
    if (enemy.state !== 'diving') {
      // Off a dive the clock is not running: the next dive starts it afresh.
      state.teleport.delete(enemy.id);
      return;
    }
    let due = triggered;
    if (params.everyFrames !== undefined) {
      const current = state.teleport.get(enemy.id) ?? { timer: params.everyFrames };
      current.timer -= 1;
      if (current.timer <= 0) {
        current.timer = params.everyFrames;
        due = true;
      }
      state.teleport.set(enemy.id, current);
    }
    if (due) blink(ctx, enemy, params, out);
  },
} satisfies AbilityModule<'teleport'>);

/** Move the enemy, and the rest of its flight with it, to a new column. */
function blink(
  ctx: AbilityContext,
  enemy: Enemy,
  params: AbilityParams<'teleport'>,
  out: AbilityStep,
): void {
  const flight = ctx.fleet.flights.get(enemy.id);
  if (flight === undefined) return;
  const { width } = ctx.rules.playfield;
  // A margin wider than half the field leaves one place to land: the middle.
  const low = Math.min(params.margin, width / 2);
  const high = Math.max(width - params.margin, width / 2);
  const x = low < high ? ctx.rng.float(low, high) : low;
  const from: Vec2 = [enemy.x, enemy.y];
  const dx = x - enemy.x;
  ctx.fleet.flights.set(enemy.id, shiftPath(flight, dx, 0));
  enemy.x = x;
  out.teleported.push({ enemy, from });
}
