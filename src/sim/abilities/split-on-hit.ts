/**
 * `splitOnHit`: destroyed by a shot, the enemy breaks into `count` of another
 * alien, already diving.
 *
 * The kill is an ordinary kill — scored, reported and counted exactly as it
 * would be without the ability — and the fragments arrive after it, abreast of
 * where it died (`spawnAbreast` in `../enemies.ts`). Each is an ordinary enemy of
 * the `into` alien: it flies one of that alien's dive paths, can be shot for that
 * alien's value, and leaves at the end of its dive, because it owns no slot to
 * return to. The stage does not end while one is still on the field.
 *
 * Three things the engine settles rather than the pack:
 *
 * - **Only a shot splits.** Leaving the field, being replaced by a transform or
 *   anything else that ends an enemy without destroying it leaves nothing behind.
 * - **Nothing splits where nothing may attack.** Fragments dive at the fighter,
 *   which is an attack, so on a stage where `allowsAttacks` is false — a challenge
 *   stage — the kill stands alone and the stage's hit count stays the stage's.
 * - **A chain of splits ends.** The loader refuses an `into` that leads back to
 *   an alien already in the chain (`src/content/loader.ts`), so every fragment of
 *   a fragment is one generation further from something that does not split.
 */

import { StageContentError, spawnAbreast } from '../enemies.js';
import type { AbilityModule } from './registry.js';

export const splitOnHit: AbilityModule<'splitOnHit'> = Object.freeze({
  type: 'splitOnHit',

  destroyed(_state, ctx, enemy, params) {
    if (!ctx.attacks) return [];
    const into = ctx.content.aliens.get(params.into);
    if (into === undefined) {
      throw new StageContentError(
        `enemy ${String(enemy.id)} splits into "${params.into}", which is not in this stage's content`,
      );
    }
    return spawnAbreast(
      ctx.fleet,
      into,
      ctx.content,
      ctx.formation,
      ctx.rules,
      ctx.rng,
      enemy,
      params.count,
      params.spacing,
      ctx.playerAt,
    );
  },
} satisfies AbilityModule<'splitOnHit'>);
