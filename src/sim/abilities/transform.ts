/**
 * `transform`: during a dive, the enemy becomes one `into` alien.
 *
 * A **change of type on a trigger**: one enemy becomes one different enemy and
 * carries on. It is not the arcade's transform attack, which turns one settled
 * enemy into a diving *group* once a stage and is the rules layer's
 * (`rules.transform`, run by `../dive.ts`) — the two share a word and nothing
 * else, and an alien may be subject to both.
 *
 * When is the pack's: `afterFrames` frames into a dive flown as this alien, at
 * every `trigger` segment naming `transform` on the path it is flying, or both.
 * Only a diving enemy changes, so the formation is always the fleet the stage put
 * there; the timer runs only while it dives and starts again with each dive.
 *
 * What carries over and what does not is the whole of the specification:
 *
 * | Carries over                                   | Is the new alien's, from the frame it changes |
 * | ---------------------------------------------- | --------------------------------------------- |
 * | its position and heading                       | sprite and hit sprites                        |
 * | its flight: the path, the speed, how far along | `hp`, whole: hits taken as the old one go     |
 * | the events still ahead on that path            | score base and moving multiplier              |
 * | its slot, its wave and its id                  | hit box, dive paths, whether it returns       |
 * | the bomb clock; the run's bombs, capped        | how it fires, and which abilities it carries  |
 *
 * And every piece of state that belonged to the old alien's abilities is lost
 * with it — shield charges, ability timers, a spawner's count of its minions, a
 * mirror's memory — which is the registry's doing (`forgetType` in
 * `./registry.ts`) because the registry owns that state.
 *
 * **Scoring follows the new type, through the same rule as every other target.**
 * The change itself is not a kill: it scores nothing and raises its own event
 * (`enemy-morphed`), the way the arcade's transform leaves its parent's field
 * with no score. A kill afterwards is worth the new alien's base, doubled while it
 * is moving (`enemyScore` in `../enemies.ts`, `docs/DESIGN.md` section 4) — the
 * same rule that makes the arcade's transformed enemy worth 160 on the dive. No
 * bonus attaches to it: the arcade's group bonus is for destroying the whole of
 * a transform trio, and this is one enemy. A member of such a trio that changes
 * type is still the same enemy, so it still counts towards the trio.
 *
 * Two enemies are never changed. The player's captured fighter carries no
 * abilities the registry acts on (`carriesAbilities`), and the capture channel's
 * captor keeps the type it was chosen for while its attempt is in progress.
 */

import type { AbilityParams } from '../../content/schema.js';
import { becomeAlien, type Enemy, StageContentError } from '../enemies.js';
import type { AbilityContext, AbilityModule, AbilityState, AbilityStep } from './registry.js';

/** One enemy's transform timer. */
export interface TransformState {
  /** Frames of this dive, flown as this alien, until it changes. */
  timer: number;
}

export const transform: AbilityModule<'transform'> = Object.freeze({
  type: 'transform',

  step(state, ctx, enemy, params, triggered, out) {
    if (enemy.state !== 'diving' || enemy.id === ctx.captorId) {
      // Off a dive the clock is not running: the next dive starts it afresh.
      state.transform.delete(enemy.id);
      return;
    }
    let due = triggered;
    if (params.afterFrames !== undefined) {
      const current = state.transform.get(enemy.id) ?? { timer: params.afterFrames };
      current.timer -= 1;
      if (current.timer <= 0) due = true;
      state.transform.set(enemy.id, current);
    }
    if (due) change(state, ctx, enemy, params, out);
  },
} satisfies AbilityModule<'transform'>);

/** Make the enemy its `into` alien, and say so. */
function change(
  state: AbilityState,
  ctx: AbilityContext,
  enemy: Enemy,
  params: AbilityParams<'transform'>,
  out: AbilityStep,
): void {
  const into = ctx.content.aliens.get(params.into);
  if (into === undefined) {
    throw new StageContentError(
      `enemy ${String(enemy.id)} transforms into "${params.into}", which is not in this stage's content`,
    );
  }
  const from = enemy.alienId;
  becomeAlien(enemy, into, ctx.rules);
  state.transformed.set(enemy.id, into.id);
  out.transformed.push({ enemy, from });
}
