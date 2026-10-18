import { describe, expect, it } from 'vitest';

import { createRegistry } from '../../src/content/registry.js';
import {
  resolveEscortBonus,
  resolveEscortBonusAtKill,
  shotWindowsFor,
} from '../../src/content/rules.js';
import type { Alien, DiveEscorts, Rules } from '../../src/content/schema.js';
import { alienSchema, rulesSchema } from '../../src/content/schema.js';
import type { StageSource } from '../../src/content/stages.js';
import { createStageSource } from '../../src/content/stages.js';
import { EMPTY_FRAME } from '../../src/engine/input.js';
import { armDives, diverCount } from '../../src/sim/dive.js';
import type { Enemy } from '../../src/sim/enemies.js';
import { eventsOfType, type SimEvent } from '../../src/sim/events.js';
import type { Group } from '../../src/sim/groups.js';
import {
  createGroupState,
  escortBonusAtKill,
  formSortie,
  groupFingerprint,
  groupNoteDestroyed,
  groupNoteSurvived,
} from '../../src/sim/groups.js';
import { createWorld, fingerprintWorld, stepWorld, type World } from '../../src/sim/world.js';
import { classicPack, classicRules, classicStages, minimalRules } from '../helpers/rules.js';
import { installedPack, installedPacks } from '../helpers/variants.js';

/**
 * Sortie groups — `src/sim/groups.ts`, launched by `src/sim/dive.ts`.
 *
 * Three halves, and the third is the one the change was judged on:
 *
 * 1. **A sortie is a group.** A leader whose alien names escorts launches with
 *    them, they fly its dive beside it, and the group keeps one identity for the
 *    whole flight, the wrap-around included.
 * 2. **Scoring reads the group in exactly three ways**: the escorts launched with
 *    the leader, latched; the escorts still flying with it when it dies; the
 *    whole group destroyed with none escaping. None of them reads the order of
 *    kills, because neither arcade lineage does.
 * 3. **Inert unless a pack declares one.** A game whose aliens name no escorts
 *    forms no group, and its world fingerprints exactly as it did before groups
 *    existed. Classic's warden names them, and `tests/sim/classic-escorts.test.ts`
 *    is where the shipped pack's own values are proved.
 *
 * The fixture is the shipped Classic content with one edit: the `warden` names
 * the two `wing`s diagonally below it as its escorts, in place of the three-wide
 * window the shipped warden looks in, so which two go is fixed. The `wing` and `drone` are
 * taken out of the dive lottery, so every launch is a warden's and every wing
 * that moves is an escort. The capture channel is off unless a test turns it on,
 * so a warden launch is never a capture attempt by accident.
 */

const shipped = classicRules();

const DIAGONALS: DiveEscorts = {
  roles: ['wing'],
  max: 2,
  offsets: [
    { column: -1, row: 1 },
    { column: 1, row: 1 },
  ],
};

type EscortRecord = Rules['scoring']['escortBonus'];

/** The shipped rules with spare fighters, no beam, and the escort record bent. */
function sortieRules(
  record: Partial<EscortRecord> = {},
  options: { capture?: boolean } = {},
): Rules {
  return {
    ...shipped,
    lives: { ...shipped.lives, default: 400 },
    capture: { ...shipped.capture, enabled: options.capture ?? false },
    scoring: {
      ...shipped.scoring,
      escortBonus: { ...shipped.scoring.escortBonus, ...record },
    },
  };
}

/** The shipped content, with the warden leading and nobody else diving alone. */
function sortieStages(rules: Rules, escorts: DiveEscorts = DIAGONALS): StageSource {
  const registry = createRegistry([classicPack()]);
  const aliens = new Map(registry.aliens);
  const patch = (id: string, dive: (alien: Alien) => Partial<NonNullable<Alien['dive']>>) => {
    const alien = aliens.get(id);
    if (alien?.dive === undefined) throw new Error(`no diving alien "${id}"`);
    aliens.set(id, { ...alien, dive: { ...alien.dive, ...dive(alien) } });
  };
  patch('warden', () => ({ escorts }));
  patch('wing', () => ({ weight: 0 }));
  patch('drone', () => ({ weight: 0 }));
  return createStageSource({
    manifest: registry.manifest,
    rules,
    stages: registry.stages,
    formations: registry.formations,
    aliens,
    paths: registry.paths,
  });
}

/**
 * A world with the formation full, settled and armed — the shortcut
 * `tests/unit/dive.test.ts` takes, for the same reason: the entry choreography
 * is covered elsewhere, and diving begins from `armDives` and nowhere else.
 */
function armedWorld(rules: Rules, stages: StageSource, seed = 'sortie'): World {
  const world = createWorld({ seed, rules, stages });
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

interface Launched {
  readonly group: Group;
  readonly leader: Enemy;
  readonly escorts: readonly Enemy[];
  /** Every event of the frame it launched on. */
  readonly events: readonly SimEvent[];
}

/** Step until a sortie launches with `escorts` escorts, and hand it over. */
function nextSortie(world: World, escorts = 2, limit = 3_000): Launched {
  for (let frame = 0; frame < limit; frame += 1) {
    const events = stepWorld(world, EMPTY_FRAME);
    for (const launched of eventsOfType(events, 'sortie-launched')) {
      if (launched.members.length !== escorts) continue;
      const group = world.groups.groups[launched.group];
      if (group === undefined) throw new Error('an event named a group the world lacks');
      return {
        group,
        leader: enemy(world, launched.targetId),
        escorts: launched.members.map((id) => enemy(world, id)),
        events,
      };
    }
  }
  throw new Error(`no sortie with ${String(escorts)} escorts in ${String(limit)} frames`);
}

/**
 * Shoot one enemy dead through the real collision path, re-aiming each frame —
 * `tests/unit/capture.test.ts`'s helper: a warden takes two hits and a shot laid
 * on one anchor can be taken by another enemy crossing it.
 */
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

/** What the kill of `target` paid, from the events that shot it. */
function paidFor(events: readonly SimEvent[], target: Enemy): number {
  const destroyed = eventsOfType(events, 'target-destroyed').filter(
    (event) => event.targetId === target.id,
  );
  expect(destroyed).toHaveLength(1);
  return destroyed[0]?.score ?? 0;
}

/* -------------------------------------------------------------------------- */
/* 1. A sortie is a group                                                       */
/* -------------------------------------------------------------------------- */

describe('a sortie', () => {
  const rules = sortieRules();
  const stages = sortieStages(rules);

  it('launches the leader with the settled escorts at its offsets, in their order', () => {
    const world = armedWorld(rules, stages);
    const { leader, escorts, group } = nextSortie(world);
    const formation = world.formation;
    if (formation === undefined) throw new Error('no formation');

    const at = (each: Enemy) => [formation.slotColumn[each.home], formation.slotRow[each.home]];
    const [column = 0, row = 0] = at(leader);
    expect(escorts.map(at)).toEqual([
      [column - 1, row + 1],
      [column + 1, row + 1],
    ]);
    expect(escorts.every((escort) => escort.role === 'wing')).toBe(true);
    expect([leader, ...escorts].map((each) => each.state)).toEqual(['diving', 'diving', 'diving']);
    expect(group.leader).toBe(leader.id);
    expect(group.members).toEqual(escorts.map((escort) => escort.id));
  });

  it('is one launch: the leader dives, then each escort, then the group is announced', () => {
    const world = armedWorld(rules, stages);
    const { leader, escorts, events } = nextSortie(world);
    const order = events
      .filter((event) => event.type === 'enemy-dived' || event.type === 'sortie-launched')
      .map((event) => [event.type, 'targetId' in event ? event.targetId : -1]);
    expect(order).toEqual([
      ['enemy-dived', leader.id],
      ...escorts.map((escort) => ['enemy-dived', escort.id]),
      ['sortie-launched', leader.id],
    ]);
    // Its escorts are divers from the moment they leave, like anything diving.
    expect(diverCount(world.fleet)).toBe(1 + escorts.length);
  });

  it('flies the leader’s dive beside it, keeping the place each escort left from', () => {
    // Every segment of a dive is relative to the flyer's pose, and an escort aims
    // at the leader's aim point moved by its own offset — so until a flyer leaves
    // the bottom, the offset it launched at is held, to the rounding of adding it.
    const world = armedWorld(rules, stages);
    const { leader, escorts } = nextSortie(world);
    const offsets = escorts.map((escort) => [escort.x - leader.x, escort.y - leader.y]);
    let measured = 0;
    while ([leader, ...escorts].every((each) => each.state === 'diving')) {
      escorts.forEach((escort, index) => {
        const [dx = Number.NaN, dy = Number.NaN] = offsets[index] ?? [];
        expect(escort.x - leader.x).toBeCloseTo(dx, 9);
        expect(escort.y - leader.y).toBeCloseTo(dy, 9);
      });
      measured += 1;
      stepWorld(world, EMPTY_FRAME);
    }
    expect(measured).toBeGreaterThan(100);
  });

  it('keeps one identity through the wrap-around, and lets each flyer go as it lands', () => {
    const world = armedWorld(rules, stages);
    const { leader, escorts, group } = nextSortie(world);
    const flyers = [leader, ...escorts];
    let wrapped = false;
    for (let frame = 0; frame < 900 && group.inFlight.size > 0; frame += 1) {
      stepWorld(world, EMPTY_FRAME);
      for (const flyer of flyers) {
        // Re-entering at the top on the way home is still flying with the group;
        // being home is not.
        if (flyer.state === 'returning') wrapped = true;
        expect(group.inFlight.has(flyer.id)).toBe(flyer.state !== 'home');
      }
    }
    expect(wrapped).toBe(true);
    expect(group.inFlight.size).toBe(0);
    // Landed, not destroyed: it can never be destroyed whole now.
    expect(group.intact).toBe(false);
    expect(world.groups.groups[group.id]).toBe(group);
  });

  it('takes no escort that is not settled, so a busy neighbour leaves a smaller group', () => {
    const world = armedWorld(rules, stages);
    const formation = world.formation;
    if (formation === undefined) throw new Error('no formation');
    // Send every wing to the right of each warden away before anything launches.
    for (const warden of world.fleet.enemies.filter((each) => each.role === 'warden')) {
      const column = formation.slotColumn[warden.home] ?? 0;
      const row = formation.slotRow[warden.home] ?? 0;
      for (const wing of world.fleet.enemies) {
        if (
          formation.slotColumn[wing.home] === column + 1 &&
          formation.slotRow[wing.home] === row + 1
        ) {
          wing.state = 'dead';
        }
      }
    }
    const { leader, escorts } = nextSortie(world, 1);
    const [column = 0, row = 0] = [
      formation.slotColumn[leader.home],
      formation.slotRow[leader.home],
    ];
    expect(escorts.map((each) => formation.slotColumn[each.home])).toEqual([column - 1]);
    expect(escorts.map((each) => formation.slotRow[each.home])).toEqual([row + 1]);
  });

  it('goes alone on a capture attempt, and writes the solo record all the same', () => {
    // The arcade's tractor-beam boss "will skip escort selection" — but it is a
    // launch, so its record is written, at the solo entry.
    const capturing = sortieRules({}, { capture: true });
    const world = armedWorld(capturing, sortieStages(capturing));
    let attempt: Launched | undefined;
    let escorted = 0;
    for (let frame = 0; frame < 3_000 && attempt === undefined; frame += 1) {
      for (const launched of eventsOfType(stepWorld(world, EMPTY_FRAME), 'sortie-launched')) {
        const group = world.groups.groups[launched.group];
        if (group === undefined) continue;
        if (world.capture.captorId === launched.targetId) {
          attempt = { group, leader: enemy(world, launched.targetId), escorts: [], events: [] };
        } else if (launched.members.length > 0) {
          escorted += 1;
        }
      }
    }
    if (attempt === undefined) throw new Error('no capture attempt came up');
    expect(escorted).toBeGreaterThan(0);
    expect(attempt.group.members).toEqual([]);
    expect(attempt.leader.escortBonus).toBe(resolveEscortBonus(capturing, 'warden', 0));
  });

  it('is reproduced exactly by the same seed, and shows in the fingerprint', () => {
    const play = () => {
      const world = armedWorld(rules, stages, 'twice');
      for (let frame = 0; frame < 1_200; frame += 1) stepWorld(world, EMPTY_FRAME);
      return fingerprintWorld(world);
    };
    const first = play();
    expect(play()).toBe(first);
    expect(first).toContain('"groups"');
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The three readings, in play                                               */
/* -------------------------------------------------------------------------- */

describe('scoring a sortie, through the world', () => {
  // 150 doubled, plus the escort record.
  const diving = (record: number) => 150 * 2 + record;

  it('latches what launched: two escorts shot first leave the leader at 1,600', () => {
    const rules = sortieRules();
    const world = armedWorld(rules, sortieStages(rules));
    const { leader, escorts } = nextSortie(world);
    expect(leader.escortBonus).toBe(1300);
    for (const escort of escorts) shoot(world, escort);
    expect(paidFor(shoot(world, leader), leader)).toBe(diving(1300));
  });

  it('reads who is still flying at the kill, for the pairs the pack lists and no others', () => {
    // The lineage's "both escorts gone" value, as a pack would state it: a leader
    // that launched with two and dies with neither still flying is worth more.
    const rules = sortieRules({ atKill: [{ escorts: 2, inFlight: 0, bonus: 2000 }] });
    const stages = sortieStages(rules);

    const alone = armedWorld(rules, stages);
    const first = nextSortie(alone);
    for (const escort of first.escorts) shoot(alone, escort);
    expect(paidFor(shoot(alone, first.leader), first.leader)).toBe(diving(2000));

    // One escort still flying: the pair is not listed, so the latch stands.
    const accompanied = armedWorld(rules, stages);
    const second = nextSortie(accompanied);
    const [shot] = second.escorts;
    if (shot === undefined) throw new Error('no escort');
    shoot(accompanied, shot);
    expect(paidFor(shoot(accompanied, second.leader), second.leader)).toBe(diving(1300));
  });

  it('pays for the whole group once, beside the kill that completes it, in any order', () => {
    const rules = sortieRules({ wholeGroup: [0, 0, 1000] });
    const world = armedWorld(rules, sortieStages(rules));
    const { leader, escorts, group } = nextSortie(world);
    const [left, right] = escorts;
    if (left === undefined || right === undefined) throw new Error('no escorts');

    // The leader first, then the escorts: who dies last does not matter.
    const early = [...shoot(world, leader), ...shoot(world, left)];
    expect(eventsOfType(early, 'sortie-destroyed')).toEqual([]);
    const last = shoot(world, right);
    expect(eventsOfType(last, 'sortie-destroyed')).toEqual([
      { type: 'sortie-destroyed', group: group.id, targetId: leader.id, bonus: 1000 },
    ]);
    // The kill and then the bonus, as two awards.
    const deltas = eventsOfType(last, 'score-changed').map((event) => event.delta);
    expect(deltas).toEqual([80 * 2, 1000]);
  });

  it('decouples the record from the tractor beam: the role is the scoring layer’s', () => {
    // No capture channel at all, and the record still pays — which is what lets a
    // game without a beam have escorts.
    const beamless: Rules = {
      ...sortieRules(),
      capture: { ...shipped.capture, enabled: false, captorRole: undefined },
    };
    expect(resolveEscortBonus(beamless, 'warden', 2)).toBe(1300);
    const world = armedWorld(beamless, sortieStages(beamless));
    expect(nextSortie(world).leader.escortBonus).toBe(1300);

    // And the beam's role alone pays nothing.
    const unstated = sortieRules({ role: undefined });
    expect(unstated.capture.captorRole).toBe('warden');
    expect(resolveEscortBonus(unstated, 'warden', 0)).toBe(0);
    expect(resolveEscortBonusAtKill(unstated, 'warden', 2, 0)).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* The record on its own                                                        */
/* -------------------------------------------------------------------------- */

describe('the group record', () => {
  /** Real enemies from the shipped stage 1: its four wardens and its wings. */
  function cast() {
    const world = createWorld({ seed: 'cast', rules: shipped, stages: classicStages() });
    const of = (role: string) => world.fleet.enemies.filter((each) => each.role === role);
    const [leader] = of('warden');
    const [a, b] = of('wing');
    if (leader === undefined || a === undefined || b === undefined) throw new Error('no cast');
    return { world, leader, a, b };
  }

  const scored = sortieRules({
    atKill: [{ escorts: 2, inFlight: 0, bonus: 2000 }],
    wholeGroup: [0, 0, 1000],
  });

  it('rewrites the latch on every launch, a solo one included', () => {
    const { leader, a, b } = cast();
    const state = createGroupState();
    formSortie(state, scored, leader, [a, b]);
    expect(leader.escortBonus).toBe(1300);
    formSortie(state, scored, leader, []);
    expect(leader.escortBonus).toBe(100);
  });

  it('counts an escort that reached its slot as gone, exactly as one destroyed', () => {
    const { world, leader, a, b } = cast();
    const state = createGroupState();
    formSortie(state, scored, leader, [a, b]);
    expect(escortBonusAtKill(state, scored, leader)).toBe(1300);
    groupNoteSurvived(state, a);
    groupNoteDestroyed(state, scored, b, world.fleet.enemies);
    expect(escortBonusAtKill(state, scored, leader)).toBe(2000);
    // An escort reads its own record, not its leader's.
    expect(escortBonusAtKill(state, scored, a)).toBe(a.escortBonus);
  });

  it('never pays for a group one of whom escaped', () => {
    const { world, leader, a, b } = cast();
    const state = createGroupState();
    formSortie(state, scored, leader, [a, b]);
    groupNoteSurvived(state, a);
    expect(groupNoteDestroyed(state, scored, b, world.fleet.enemies)).toBeUndefined();
    expect(groupNoteDestroyed(state, scored, leader, world.fleet.enemies)).toBeUndefined();
  });

  it('reads nothing but who is flying: the order of the kills changes nothing', () => {
    const orders = [
      ['leader', 'a', 'b'],
      ['a', 'leader', 'b'],
      ['b', 'a', 'leader'],
    ] as const;
    const results = orders.map((order) => {
      const { world, leader, a, b } = cast();
      const who = { leader, a, b };
      const state = createGroupState();
      formSortie(state, scored, leader, [a, b]);
      return order.map(
        (name) => groupNoteDestroyed(state, scored, who[name], world.fleet.enemies)?.bonus,
      );
    });
    expect(results).toEqual(orders.map(() => [undefined, undefined, 1000]));
  });

  it('is absent from a fingerprint until a group is formed', () => {
    const { leader, a } = cast();
    const state = createGroupState();
    expect(groupFingerprint(state)).toBeUndefined();
    formSortie(state, scored, leader, [a]);
    expect(groupFingerprint(state)).toEqual([
      [0, leader.id, [a.id], [leader.id, a.id].sort(), true],
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* What a pack may declare                                                      */
/* -------------------------------------------------------------------------- */

describe('declaring escorts', () => {
  const alien = (escorts: unknown) =>
    alienSchema.safeParse({
      id: 'boss',
      role: 'boss',
      sprite: 'boss',
      score: { base: 150 },
      dive: { paths: ['dive'], escorts },
    });

  it('accepts a role list, a count and the offsets to look at', () => {
    expect(alien(DIAGONALS).success).toBe(true);
  });

  it('refuses a count the offsets cannot supply, the leader’s own slot, and a repeat', () => {
    expect(alien({ ...DIAGONALS, max: 3 }).success).toBe(false);
    expect(alien({ ...DIAGONALS, offsets: [{ column: 0, row: 0 }], max: 1 }).success).toBe(false);
    expect(
      alien({
        ...DIAGONALS,
        offsets: [
          { column: 1, row: 1 },
          { column: 1, row: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it('refuses an at-kill pair with more in flight than launched, or listed twice', () => {
    const rules = (atKill: unknown) =>
      rulesSchema.safeParse({ ...minimalRules(), scoring: { escortBonus: { atKill } } }).success;
    expect(rules([{ escorts: 2, inFlight: 0, bonus: 700 }])).toBe(true);
    expect(rules([{ escorts: 1, inFlight: 2, bonus: 700 }])).toBe(false);
    expect(
      rules([
        { escorts: 2, inFlight: 0, bonus: 700 },
        { escorts: 2, inFlight: 0, bonus: 800 },
      ]),
    ).toBe(false);
  });

  it('no longer accepts `latchedAtLaunch`, the switch that chose nothing', () => {
    // It validated and was read by nothing: the latch is not a choice — both
    // lineages latch what launched — and the reading at the kill is a separate,
    // additive rule (`atKill`), not the other side of a boolean.
    const parsed = rulesSchema.safeParse({
      ...minimalRules(),
      scoring: { escortBonus: { latchedAtLaunch: true } },
    });
    expect(parsed.success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Inert unless a pack declares a group                                      */
/* -------------------------------------------------------------------------- */

describe('without a declaration, nothing', () => {
  it('names escorts on Classic’s warden alone, so each game’s escorts are its own change', () => {
    // Classic's 800 and 1,600 became reachable the day its warden named escorts,
    // which changed how Classic plays and rewrote its golden replays. Any other
    // game naming them is the same kind of change, and this is what says so when
    // it comes.
    for (const [id, pack] of installedPacks()) {
      for (const alien of pack.aliens.values()) {
        const named = alien.dive?.escorts !== undefined;
        expect([id, alien.id, named]).toEqual([
          id,
          alien.id,
          id === 'classic' && alien.id === 'warden',
        ]);
      }
    }
  });

  it('forms no group in a game that names no escorts, and leaves the fingerprint as it was', () => {
    const convoy = installedPack('convoy');
    if (convoy.rules === undefined) throw new Error('packs/convoy has no rules.json');
    const world = armedWorld(
      { ...convoy.rules, lives: { ...convoy.rules.lives, default: 400 } },
      createStageSource(createRegistry([convoy])),
    );
    let dived = 0;
    for (let frame = 0; frame < 3_000; frame += 1) {
      const events = stepWorld(world, EMPTY_FRAME);
      dived += eventsOfType(events, 'enemy-dived').length;
      expect(eventsOfType(events, 'sortie-launched')).toEqual([]);
    }
    expect(dived).toBeGreaterThan(10);
    expect(world.groups.groups).toEqual([]);
    expect(fingerprintWorld(world)).not.toContain('"groups"');
  });
});
