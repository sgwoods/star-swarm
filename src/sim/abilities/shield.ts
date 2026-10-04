/**
 * `shield`: shots spent on the shield before any reach the enemy.
 *
 * A pack tunes two numbers — how many hits the shield takes, and how long it
 * must go unhit before it is whole again — and the engine owns everything else.
 * Three things make it more than a larger `hp`:
 *
 * - **A shield hit is not a hit on the enemy.** It scores nothing, leaves the
 *   enemy's `hitsRemaining` and therefore its sprite alone, and is reported as
 *   its own event (`shield-hit`), so a pack can bind it a sound or an effect of
 *   its own.
 * - **It recharges.** With `rechargeFrames`, any hit — on the shield or, once it
 *   is down, on the enemy — restarts the count, and a shield left alone that long
 *   is restored in full (`shield-restored`). Omitted, a shield once broken stays
 *   broken.
 * - **It is in front of everything.** It takes the shot before the enemy's own
 *   `hp`, and before any other ability sees the hit.
 *
 * State is made the first time a shot connects, which is all a full shield
 * needs: an enemy never hit has every hit of its shield left.
 */

import type { AbilityModule } from './registry.js';

/** One enemy's shield. */
export interface ShieldState {
  /** Hits the shield will still take. */
  remaining: number;
  /** Frames since any shot connected with this enemy. */
  sinceHit: number;
}

export const shield: AbilityModule<'shield'> = Object.freeze({
  type: 'shield',

  absorbShot(state, enemy, params) {
    const current = state.shield.get(enemy.id) ?? { remaining: params.hits, sinceHit: 0 };
    current.sinceHit = 0;
    state.shield.set(enemy.id, current);
    if (current.remaining <= 0) return false;
    current.remaining -= 1;
    return true;
  },

  step(state, _ctx, enemy, params, _triggered, out) {
    const current = state.shield.get(enemy.id);
    if (current === undefined || params.rechargeFrames === undefined) return;
    if (current.remaining >= params.hits) return;
    current.sinceHit += 1;
    if (current.sinceHit < params.rechargeFrames) return;
    current.remaining = params.hits;
    current.sinceHit = 0;
    out.restored.push(enemy);
  },
} satisfies AbilityModule<'shield'>);
