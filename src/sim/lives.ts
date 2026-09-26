/**
 * Lives, as the simulation carries them (docs/DESIGN.md section 4, "Player").
 *
 * The interesting part is not here any more, and that is the point. **The
 * extra-life thresholds depend on how many fighters the cabinet starts you
 * with**, which is a rule rather than a mechanic: `packs/classic/rules.json`
 * carries both tables of eight settings, and `resolveExtraLifeAward` in
 * `src/content/rules.ts` is the one place that resolves a setting against the
 * starting-life count in play. Keying the award off the setting alone hands a
 * five-fighter cabinet the wrong bonuses, silently, for a whole game — which is
 * exactly why the resolution lives with the data rather than being repeated
 * here.
 *
 * What is left is the shape the simulation steps: a reserve count and a tally of
 * awards paid, both of which are part of a saved state and of a replay.
 */

import type { Rules } from '../content/schema.js';

/** Lives, as the simulation carries them. */
export interface LivesState {
  /** Fighters left in reserve — what the HUD draws along the bottom row. */
  reserve: number;
  /** Extra lives handed out so far, so the award is never paid twice. */
  bonusesAwarded: number;
}

/**
 * `startingLives` is the count this run began on — the cabinet's setting, which
 * `rules.lives.options` lists. It defaults to the rules' own default, and it
 * matters beyond the reserve: it also selects which extra-life threshold set is
 * in force (`resolveExtraLifeAward` in `src/content/rules.ts`), which is why the
 * world remembers it rather than re-reading the default later.
 */
export function createLives(rules: Rules, startingLives?: number): LivesState {
  // The starting count includes the fighter on the field, so the reserve is one
  // fewer: a 3-ship cabinet shows two reserve fighters at the first "READY".
  return { reserve: Math.max(0, (startingLives ?? rules.lives.default) - 1), bonusesAwarded: 0 };
}
