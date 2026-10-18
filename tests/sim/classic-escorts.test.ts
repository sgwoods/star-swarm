import { describe, expect, it } from 'vitest';

import { shotWindowsFor } from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { EMPTY_FRAME } from '../../src/engine/input.js';
import { armDives } from '../../src/sim/dive.js';
import type { Enemy } from '../../src/sim/enemies.js';
import { eventsOfType, type SimEvent } from '../../src/sim/events.js';
import { createWorld, stepWorld, type World } from '../../src/sim/world.js';
import { classicPack, classicRules, classicStages } from '../helpers/rules.js';

/**
 * Classic's bosses launch with escorts, and a boss's 800 and 1,600 are reachable.
 *
 * The values have been in `packs/classic/rules.json` from the start; what was
 * missing was a warden that brought anyone with it. This file is the proof that
 * the shipped pack — not a fixture bent for the test, as in
 * `tests/unit/groups.test.ts` — pays all three entries of the arcade's table
 * (`docs/reference/arcade-reference.md` section 9):
 *
 * - **400** diving alone, **800** with one escort, **1,600** with two;
 * - **latched at launch**: shooting the escorts first does not reduce the boss,
 *   because the ROM writes the record when the boss launches and nothing writes it
 *   when an escort dies. The opposite reading — the boss worth less once its
 *   escorts are gone — is the other lineage's rule, not this one.
 *
 * The only thing changed from the shipped pack is the number of spare fighters,
 * so a stray bomb cannot end the run before the measurement.
 */

const shipped = classicRules();

function spareFighters(): Rules {
  return { ...shipped, lives: { ...shipped.lives, default: 400 } };
}

/** The shipped stage 1 with the formation full, settled and armed. */
function armedWorld(seed: string): World {
  const world = createWorld({ seed, rules: spareFighters(), stages: classicStages() });
  for (const enemy of world.fleet.enemies) {
    enemy.state = 'home';
    enemy.pathFrame = 0;
  }
  world.fleet.entryComplete = true;
  if (world.formation !== undefined) {
    world.formation.entryComplete = true;
    world.formation.motion = 'breathe';
  }
  armDives(world.dive);
  return world;
}

function enemy(world: World, id: number): Enemy {
  const found = world.fleet.enemies.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no enemy ${String(id)}`);
  return found;
}

/** Step until a warden launches with exactly `escorts` escorts. */
function nextSortie(
  world: World,
  escorts: number,
  limit = 6_000,
): { leader: Enemy; escorts: Enemy[] } {
  for (let frame = 0; frame < limit; frame += 1) {
    for (const launched of eventsOfType(stepWorld(world, EMPTY_FRAME), 'sortie-launched')) {
      if (launched.alienId !== 'warden' || launched.members.length !== escorts) continue;
      return {
        leader: enemy(world, launched.targetId),
        escorts: launched.members.map((id) => enemy(world, id)),
      };
    }
  }
  throw new Error(`no warden launched with ${String(escorts)} escorts in ${String(limit)} frames`);
}

/** Shoot one enemy dead through the real collision path, re-aiming every frame. */
function shoot(world: World, target: Enemy, limit = 240): SimEvent[] {
  const events: SimEvent[] = [];
  const shot = world.shots[0];
  if (shot === undefined) throw new Error('no shot slot');
  for (let frame = 0; frame < limit && target.state !== 'dead'; frame += 1) {
    shot.active = true;
    shot.windows = shotWindowsFor(world.rules, 'single');
    shot.x = target.x;
    shot.y = target.y + world.rules.player.shot.speed;
    events.push(...stepWorld(world, EMPTY_FRAME));
  }
  expect(target.state, 'the shot should have destroyed its target').toBe('dead');
  return events;
}

function paidFor(events: readonly SimEvent[], target: Enemy): number {
  const destroyed = eventsOfType(events, 'target-destroyed').filter(
    (event) => event.targetId === target.id,
  );
  expect(destroyed).toHaveLength(1);
  return destroyed[0]?.score ?? 0;
}

describe('Classic’s escorted bosses', () => {
  it('names the ROM’s window: the three top-row wings beneath it, left first', () => {
    // [LIST] main `$1C36`–`$1C73` and `c_1D03`: six wingman candidates, the top
    // butterfly row's columns 4–14, and each boss tests the three at its own
    // column and either side of it, taking the left one first. One axis step is
    // one formation column, so -1, 0 and +1 are the slots 2 apart.
    expect(classicPack().aliens.get('warden')?.dive?.escorts).toEqual({
      roles: ['wing'],
      max: 2,
      offsets: [
        { column: -1, row: 1 },
        { column: 0, row: 1 },
        { column: 1, row: 1 },
      ],
    });
  });

  it('pays 1,600 for a boss that launched with two, even with both shot first', () => {
    const world = armedWorld('escorts-two');
    const { leader, escorts } = nextSortie(world, 2);
    expect(escorts.map((each) => each.role)).toEqual(['wing', 'wing']);
    for (const escort of escorts) shoot(world, escort);
    expect(paidFor(shoot(world, leader), leader)).toBe(1_600);
  });

  it('pays 800 for a boss that launched with one, even with it shot first', () => {
    // Leave one wing in the top row, at column 8 (axis step 4), so every boss's
    // window holds at most that one.
    const world = armedWorld('escorts-one');
    const rowOf = (each: Enemy): number => world.formation?.slotRow[each.home] ?? -1;
    const wings = world.fleet.enemies.filter((each) => each.role === 'wing');
    const top = Math.min(...wings.map(rowOf));
    const topRow = wings.filter((each) => rowOf(each) === top);
    const keep = topRow.find((each) => world.formation?.slotColumn[each.home] === 4);
    expect(topRow).toHaveLength(8);
    expect(keep).toBeDefined();
    for (const wing of topRow) if (wing !== keep) wing.state = 'dead';

    const { leader, escorts } = nextSortie(world, 1);
    expect(escorts).toEqual([keep]);
    shoot(world, escorts[0] as Enemy);
    expect(paidFor(shoot(world, leader), leader)).toBe(800);
  });

  it('still pays 400 for a boss that dived alone, and 150 for one at home', () => {
    const world = armedWorld('escorts-none');
    for (const wing of world.fleet.enemies) if (wing.role === 'wing') wing.state = 'dead';
    const { leader } = nextSortie(world, 0);
    expect(paidFor(shoot(world, leader), leader)).toBe(400);

    const sitting = world.fleet.enemies.find(
      (each) => each.role === 'warden' && each.state === 'home',
    );
    if (sitting === undefined) throw new Error('no warden left at home');
    expect(paidFor(shoot(world, sitting), sitting)).toBe(150);
  });
});
