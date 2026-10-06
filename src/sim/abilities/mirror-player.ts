/**
 * `mirrorPlayer`: a diving enemy copies the fighter's horizontal movement.
 *
 * Two ways round, and the pack says which. With `track` the enemy closes on the
 * fighter's column, so it slides the way the fighter slid; with `opposite` it
 * closes on that column mirrored about the playfield's centre line — the same
 * axis every mirrored path uses (`mirrorX` in `../paths.ts`) — so it slides the
 * other way, and the two meet only in the middle. How far behind it is and how
 * hard it pulls are the pack's too, and nothing here has a number of its own:
 *
 * - **`delayFrames`** — the fighter position it copies is that many frames old.
 *   A copy that lags is what makes the cause visible: the fighter moves, and a
 *   moment later the enemy answers.
 * - **`strength`** — the fraction of the remaining sideways gap it closes each
 *   frame. At 1 its column *is* the fighter's, as it was `delayFrames` ago; below
 *   1 it eases towards it, and its own path's sideways motion shows through.
 *
 * The enemy keeps flying its own flight the whole time. The pull is a sideways
 * **displacement of that flight** — the same `shiftPath` a teleport uses, a little
 * every frame — so its row, its speed down the screen, its place on the path and
 * the events still ahead on it are the path's, and where the dive ends is where
 * the path ends it, displaced. Neither target can leave the playfield, because
 * the fighter cannot and the mirror of anywhere on it is on it, so neither can
 * the pull.
 *
 * It acts only while the enemy is diving, from the frame its dive begins: an
 * enemy in the formation *is* its slot, and the formation holds no per-enemy
 * offset (`../formation.ts`). With no fighter on the field there is nothing to
 * copy — the enemy flies its path unmoved, and its memory of the fighter is
 * dropped, so a replacement fighter is copied from where it appears rather than
 * from where its predecessor died. The memory starts again with every dive.
 *
 * No random number is drawn: it reads the fighter, which the world already has,
 * and does arithmetic on it.
 */

import { mirrorX, shiftPath } from '../paths.js';
import type { AbilityModule } from './registry.js';

/** One enemy's memory of the fighter. */
export interface MirrorState {
  /**
   * The fighter's x on each recent frame of this dive, oldest first, and never
   * more than `delayFrames + 1` of them. The oldest is the one it copies, so it
   * copies on exactly the frames on which the memory is full.
   */
  seen: number[];
}

export const mirrorPlayer: AbilityModule<'mirrorPlayer'> = Object.freeze({
  type: 'mirrorPlayer',

  step(state, ctx, enemy, params) {
    if (enemy.state !== 'diving' || ctx.playerAt === undefined) {
      state.mirrorPlayer.delete(enemy.id);
      return;
    }
    const memory = state.mirrorPlayer.get(enemy.id) ?? { seen: [] };
    state.mirrorPlayer.set(enemy.id, memory);
    memory.seen.push(ctx.playerAt[0]);
    if (memory.seen.length > params.delayFrames + 1) memory.seen.shift();
    // Not yet `delayFrames` into the dive: it has seen nothing old enough to copy.
    const seen = memory.seen[0];
    if (memory.seen.length <= params.delayFrames || seen === undefined) return;

    const target = params.mode === 'track' ? seen : mirrorX(seen, ctx.rules.playfield);
    const dx = (target - enemy.x) * params.strength;
    const flight = ctx.fleet.flights.get(enemy.id);
    if (dx === 0 || flight === undefined) return;
    ctx.fleet.flights.set(enemy.id, shiftPath(flight, dx, 0));
    enemy.x += dx;
  },
} satisfies AbilityModule<'mirrorPlayer'>);
