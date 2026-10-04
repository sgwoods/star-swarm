/**
 * `spawnMinions`: the enemy launches `count` of another alien, diving, from
 * wherever it is.
 *
 * When is the pack's: every `everyFrames` frames, at every `trigger` segment
 * naming `spawnMinions` on the path it is flying, or both. How many is the
 * pack's too, and bounded twice — `count` per launch, and never more than
 * `maxAlive` of this enemy's minions on the field at once, so a spawner left
 * alone is a steady pressure rather than a flood.
 *
 * A minion is an ordinary enemy of its alien: it flies one of that alien's dive
 * paths, scores that alien's value, counts against the difficulty row's diver
 * limit like any other attacker, and leaves at the end of its dive because it
 * owns no slot (`spawnAbreast` in `../enemies.ts`). The stage does not end while
 * one is still on the field; with the spawner gone, the last of them dive away
 * and it does.
 *
 * Launching an attacker is an attack, so it waits for everything an attack waits
 * for: a stage where anything may attack at all (`allowsAttacks`), a formation
 * that has settled and armed the dives, and a spawner that is in its slot or
 * diving — never one still flying in or rotating home. The timer runs only
 * while all of that holds.
 */

import type { AbilityParams } from '../../content/schema.js';
import { type Enemy, StageContentError, spawnAbreast } from '../enemies.js';
import type { AbilityContext, AbilityModule, AbilityState, AbilityStep } from './registry.js';

/** One spawner's clock, and the minions it has put on the field. */
export interface SpawnState {
  /** Frames until the next timed launch. */
  timer: number;
  /** Ids of its minions launched this stage and not yet known to be gone. */
  minions: number[];
}

export const spawnMinions: AbilityModule<'spawnMinions'> = Object.freeze({
  type: 'spawnMinions',

  step(state, ctx, enemy, params, triggered, out) {
    if (!ctx.attacks || !ctx.armed) return;
    if (enemy.state !== 'home' && enemy.state !== 'diving') return;

    let due = triggered;
    if (params.everyFrames !== undefined) {
      const current = stateOf(state, enemy, params);
      current.timer -= 1;
      if (current.timer <= 0) {
        current.timer = params.everyFrames;
        due = true;
      }
    }
    if (due) launch(state, ctx, enemy, params, out);
  },
} satisfies AbilityModule<'spawnMinions'>);

function stateOf(
  state: AbilityState,
  enemy: Enemy,
  params: AbilityParams<'spawnMinions'>,
): SpawnState {
  let current = state.spawnMinions.get(enemy.id);
  if (current === undefined) {
    current = { timer: params.everyFrames ?? 0, minions: [] };
    state.spawnMinions.set(enemy.id, current);
  }
  return current;
}

/** Put as many minions on the field as the cap leaves room for. */
function launch(
  state: AbilityState,
  ctx: AbilityContext,
  enemy: Enemy,
  params: AbilityParams<'spawnMinions'>,
  out: AbilityStep,
): void {
  const current = stateOf(state, enemy, params);
  // Forget the minions that are gone — shot down or flown away — so the cap
  // counts the field rather than the history.
  const live = new Set(
    ctx.fleet.enemies.filter((other) => other.state !== 'dead').map((other) => other.id),
  );
  current.minions = current.minions.filter((id) => live.has(id));

  const room = Math.min(params.count, params.maxAlive - current.minions.length);
  if (room <= 0) return;

  const alien = ctx.content.aliens.get(params.alien);
  if (alien === undefined) {
    throw new StageContentError(
      `enemy ${String(enemy.id)} spawns "${params.alien}", which is not in this stage's content`,
    );
  }
  const minions = spawnAbreast(
    ctx.fleet,
    alien,
    ctx.content,
    ctx.formation,
    ctx.rules,
    ctx.rng,
    enemy,
    room,
    params.spacing,
    ctx.playerAt,
  );
  if (minions.length === 0) return;
  current.minions.push(...minions.map((minion) => minion.id));
  out.spawned.push({ parent: enemy, minions });
}
