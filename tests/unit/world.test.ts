import { describe, expect, it } from 'vitest';

import { starfieldSpeedByte } from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { EMPTY_FRAME, frameOf } from '../../src/engine/input.js';
import type { Enemy } from '../../src/sim/enemies.js';
import { eventsOfType, type SimEvent } from '../../src/sim/events.js';
import { createFormation, homePosition, stepFormation } from '../../src/sim/formation.js';
import { launchEnemyBullet } from '../../src/sim/shots.js';
import { createWorld, fingerprintWorld, stepWorld, type World } from '../../src/sim/world.js';
import { classicFormation, classicRules, classicStages, stageSourceOf } from '../helpers/rules.js';

const rules = classicRules();
const stages = classicStages();

const FIRE = frameOf('fire');

/**
 * One enemy, standing still exactly where the test puts it.
 *
 * `returning` is the state to use for that, and not by accident: it is the one
 * targetable state whose position comes from a flight rather than from the
 * formation, so an enemy in it with no flight registered stays exactly where it
 * was put. It also scores the *formation* value while visibly moving, which is
 * the arcade rule (`docs/reference/arcade-reference.md` section 9).
 */
function enemyAt(overrides: Partial<Enemy> = {}): Enemy {
  return {
    id: 0,
    alienId: 'drone',
    role: 'drone',
    sprite: 'drone',
    hitSprites: [],
    home: 20,
    inCaptiveSlot: false,
    phase: 0,
    launchFrame: 0,
    path: 'entry-side-file',
    mirror: false,
    homes: true,
    trailing: false,
    wave: 0,
    hp: 1,
    scoreBase: 50,
    movingMultiplier: 2,
    escortBonus: 0,
    hitPadding: { x: 0, y: 0 },
    divePaths: [],
    diveWeight: 0,
    returnsFromDive: true,
    fire: undefined,
    abilities: [],
    state: 'returning',
    x: 0,
    y: 0,
    heading: 0,
    hitsRemaining: 1,
    pathFrame: 0,
    bombTimer: 0,
    bombsLeft: 0,
    ...overrides,
  };
}

/** A world whose fleet is exactly the given enemies. */
function worldWith(enemies: Enemy[], seed = 'world-test'): World {
  const world = createWorld({ seed, rules, stages });
  world.fleet.enemies.splice(0, world.fleet.enemies.length, ...enemies);
  world.fleet.entryComplete = true;
  return world;
}

/** Step until `predicate` holds, collecting every event; fails if it never does. */
function runUntil(
  world: World,
  frame: number,
  predicate: (world: World) => boolean,
  limit = 600,
): SimEvent[] {
  const collected: SimEvent[] = [];
  for (let i = 0; i < limit; i += 1) {
    collected.push(...stepWorld(world, frame));
    if (predicate(world)) return collected;
  }
  throw new Error(`Condition not reached within ${String(limit)} steps`);
}

describe('player shots against the fleet', () => {
  it('destroys an enemy the shot flies into, and scores it', () => {
    const world = worldWith([enemyAt({ x: 0, y: 120, alienId: 'wing', scoreBase: 80 })]);
    world.player.x = 0;

    const events = runUntil(world, FIRE, (w) => w.score > 0);
    const destroyed = eventsOfType(events, 'target-destroyed');
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]?.score).toBe(80);
    expect(destroyed[0]?.alienId).toBe('wing');
    expect(world.score).toBe(80);
  });

  it('misses an enemy outside the window, however long it flies', () => {
    // Δx = +6 is one past the single fighter's verified [−5, +5].
    const world = worldWith([enemyAt({ x: 6, y: 120 })]);
    world.player.x = 0;
    for (let i = 0; i < 300; i += 1) stepWorld(world, FIRE);
    expect(world.fleet.enemies[0]?.state).toBe('returning');
    expect(world.score).toBe(0);
  });

  it('takes two hits to destroy a warden, and scores only the second', () => {
    const world = worldWith([
      enemyAt({ alienId: 'warden', x: 0, y: 120, hp: 2, hitsRemaining: 2, scoreBase: 150 }),
    ]);
    world.player.x = 0;

    const events = runUntil(world, FIRE, (w) => w.score > 0);
    expect(eventsOfType(events, 'target-hit')).toHaveLength(1);
    expect(eventsOfType(events, 'target-destroyed')).toHaveLength(1);
    expect(world.score).toBe(150);
  });

  it('spends one shot on one enemy, not on everything in its path', () => {
    const world = worldWith([enemyAt({ id: 0, x: 0, y: 120 }), enemyAt({ id: 1, x: 0, y: 121 })]);
    world.player.x = 0;
    runUntil(world, FIRE, (w) => w.fleet.enemies.some((e) => e.state === 'dead'));
    expect(world.fleet.enemies.filter((e) => e.state !== 'dead')).toHaveLength(1);
  });

  it("widens the window by the enemy's own padding, not by a constant", () => {
    // Δx = +8 misses the verified [−5, +5] outright; an alien padded by 3 px a
    // side is hit anyway, and the padding comes from the alien's own data.
    const narrow = worldWith([enemyAt({ x: 8, y: 120 })]);
    narrow.player.x = 0;
    for (let i = 0; i < 200; i += 1) stepWorld(narrow, FIRE);
    expect(narrow.score).toBe(0);

    const padded = worldWith([enemyAt({ x: 8, y: 120, hitPadding: { x: 3, y: 0 } })]);
    padded.player.x = 0;
    runUntil(padded, FIRE, (w) => w.score > 0);
    expect(padded.score).toBe(50);
  });

  it('cannot hit an enemy that has not launched yet', () => {
    // Due far in the future, so it stays in standby for the whole run.
    const world = worldWith([
      enemyAt({ x: 0, y: 120, state: 'standby', launchFrame: Number.MAX_SAFE_INTEGER }),
    ]);
    world.player.x = 0;
    for (let i = 0; i < 200; i += 1) stepWorld(world, FIRE);
    expect(world.score).toBe(0);
    expect(world.fleet.enemies[0]?.state).toBe('standby');
  });

  it('doubles the value of an enemy shot on its way in', () => {
    // S3 from the scout report: a drone shot during the entry wave is 100.
    const world = worldWith([enemyAt({ x: 0, y: 120, state: 'entering' })]);
    world.player.x = 0;
    runUntil(world, FIRE, (w) => w.score > 0);
    expect(world.score).toBe(100);
  });
});

/**
 * What a kill is worth, played end to end against the shipped aliens — the scout
 * report's acceptance tests **S1 to S6, S8 and S10**.
 *
 * Every other scoring test in the tree asserts one link of the chain: `enemyScore`
 * on a hand-made enemy (`tests/unit/enemies.test.ts`), the pack's own numbers
 * (`tests/unit/classic-pack.test.ts`), one state against another
 * (`tests/unit/dive.test.ts`). None of them says what the *game* pays for shooting
 * a drone, and a table of numbers that agree with each other is exactly the shape
 * an audit mistakes for coverage. So these fly a real shot from the real fighter
 * into the pack's own `drone`, `wing` and `warden`, and read the score off the
 * kill's own event **and** off the run's total — which is what catches a bonus
 * arriving from somewhere else, or failing to.
 */
describe('S1–S6, S8, S10 — what a kill pays', () => {
  /** One slot, directly above the fighter's home column, out of ramming reach. */
  const TARGET_Y = 200;

  /**
   * Nothing in the air but the shot: the global bullet cap at zero.
   *
   * A warden takes two hits, and a bomb that killed the fighter between them would
   * measure a lost life rather than a score. Two rules fields; every value under
   * test is the pack's.
   */
  function noBombs(): Rules {
    return { ...rules, enemies: { ...rules.enemies, maxBullets: 0 } };
  }

  /** A stage holding exactly one of `alien`, in a slot above the fighter. */
  function oneAlienStage(alien: string, role: string): ReturnType<typeof stageSourceOf> {
    return stageSourceOf(
      {
        id: `one-${alien}`,
        formation: `above-the-fighter-${role}`,
        waves: [{ at: 0, entryPath: 'entry-side-file', slots: [{ alien, home: 0 }] }],
      },
      {
        id: `above-the-fighter-${role}`,
        grid: { originX: 103, originY: TARGET_Y, columnSpacing: 16, rowSpacing: 16 },
        slots: [{ row: 0, column: 0, role }],
      },
    );
  }

  /**
   * Shoot one `alien` held in `state`, and report what happened.
   *
   * `home` is the state that cannot be staged by parking a body: an enemy at home
   * *is* its slot, so the fleet puts it back there every frame. It is reached by
   * putting the slot itself where the shot goes and holding the formation still —
   * the sway would walk the slot out from under the shot within a few frames, and
   * what is under test here is the value, not the motion (`formation.test.ts` owns
   * that). Every other state has no flight registered, so the enemy stays exactly
   * where it is put, which is how the rest of this file reaches them too.
   */
  function shootOne(
    alien: string,
    role: string,
    state: Enemy['state'],
  ): { readonly kill: number; readonly hits: number; readonly total: number } {
    const world = createWorld({
      seed: `pays-${alien}-${state}`,
      rules: noBombs(),
      stages: oneAlienStage(alien, role),
    });
    const enemy = world.fleet.enemies[0];
    expect(enemy, `no ${alien} on the field`).toBeDefined();
    if (enemy === undefined) throw new Error('no enemy');

    world.fleet.entryComplete = true;
    world.fleet.flights.delete(enemy.id);
    enemy.state = state;
    if (state === 'home') {
      if (world.formation !== undefined) world.formation.motion = 'still';
    } else {
      enemy.x = world.player.x;
      enemy.y = TARGET_Y;
    }

    // Stepped by hand rather than through `runUntil`: killing the only enemy on
    // the field clears the stage on the same step, and the next stage's fleet
    // replaces this one — so the enemy has to be watched by reference, not by index.
    const events = runUntil(world, FIRE, () => enemy.state === 'dead', 120);
    const destroyed = eventsOfType(events, 'target-destroyed');
    expect(destroyed).toHaveLength(1);
    return {
      kill: destroyed[0]?.score ?? -1,
      hits: eventsOfType(events, 'target-hit').length,
      total: world.score,
    };
  }

  it.each([
    { id: 'S1', alien: 'drone', state: 'home', pays: 50 },
    { id: 'S2', alien: 'drone', state: 'diving', pays: 100 },
    { id: 'S3', alien: 'drone', state: 'entering', pays: 100 },
    { id: 'S4', alien: 'drone', state: 'returning', pays: 50 },
    { id: 'S5 (in formation)', alien: 'wing', state: 'home', pays: 80 },
    { id: 'S5 (mid-dive)', alien: 'wing', state: 'diving', pays: 160 },
  ] as const)('$id — a $alien shot while $state pays $pays', ({ alien, state, pays }) => {
    const shot = shootOne(alien, alien, state);
    // The kill's own event, the run's total, and no non-fatal hit on a one-hit
    // alien: the three together say the whole value landed once, from one channel.
    expect(shot.kill).toBe(pays);
    expect(shot.total).toBe(pays);
    expect(shot.hits).toBe(0);
  });

  it('S6 — a warden in formation scores nothing on the first hit and 150 on the second', () => {
    const shot = shootOne('warden', 'warden', 'home');
    expect(shot.hits).toBe(1);
    expect(shot.kill).toBe(150);
    // The first hit really did pay nothing: the total is the kill and no more.
    expect(shot.total).toBe(150);
  });

  it('S8, S10 — a warden killed mid-dive pays 400: 300 and the solo escort bonus', () => {
    // The one case a flat `{type, moving} -> points` table cannot express, and the
    // reason an alien stores its base score alone. 300 is the doubled base; the
    // extra 100 is the escort record every stage start installs, which is also S10:
    // this warden has not been launched by anything, so the solo value is what it
    // carries.
    const bonus = rules.scoring.escortBonus.byEscortCount[0];
    expect(bonus).toBe(100);
    const shot = shootOne('warden', 'warden', 'diving');
    expect(shot.hits).toBe(1);
    expect(shot.kill).toBe(150 * rules.scoring.movingMultiplier + (bonus ?? 0));
    expect(shot.kill).toBe(400);
    // One channel, one number: the escort bonus is part of the captor's own value
    // and does not arrive as a second score change the way a group bonus does.
    expect(shot.total).toBe(400);
  });

  it('pays a warden its plain 150 at home, so the escort bonus rides the doubling', () => {
    // Stated as the pair, because "400 while diving" is only the arcade's rule if
    // the same warden is 150 sitting still — the verified scoring table's two
    // columns, not a flat +100 on every captor kill.
    expect(shootOne('warden', 'warden', 'home').kill).toBe(150);
    expect(shootOne('warden', 'warden', 'returning').kill).toBe(150);
  });
});

/**
 * Enemy **bodies** against the fighter — `resolveBodyCollisions` in
 * `src/sim/world.ts`.
 *
 * The pairing Milestone 2 left unconnected: bombs killed the fighter and the beam
 * took it, but a diver flew straight through it. [MANUAL] is explicit that it is a
 * way to die — "if they can’t bomb you, they’ll ram you in the rear"
 * (`docs/reference/arcade-reference.md` section 5) — and the geometry is the
 * fighter's own verified window with the alien's padding on top, the same
 * arrangement a player shot uses from the other side.
 *
 * A `diving` enemy with no compiled flight stays exactly where the test puts it,
 * which is what lets these state the offset rather than fly to it.
 */
describe('enemy bodies against the player', () => {
  /** A diver parked exactly `dx` to the right of the fighter, on its row. */
  function diverAt(dx: number, overrides: Partial<Enemy> = {}): World {
    const world = worldWith([]);
    world.fleet.enemies.push(
      enemyAt({ state: 'diving', x: world.player.x + dx, y: world.player.y, ...overrides }),
    );
    return world;
  }

  it('kills the fighter a diver flies into, and takes a life', () => {
    const world = diverAt(0);
    const events = runUntil(world, EMPTY_FRAME, (w) => !w.player.alive, 5);

    const hits = eventsOfType(events, 'player-hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ x: world.player.x, livesRemaining: 1 });
    expect(world.lives.reserve).toBe(1);
  });

  it('is the same loss as being shot, not an event of its own', () => {
    // One ROM routine handles every hit on the fighter, so there is no
    // `player-rammed`: a subscriber that drew an explosion for a bomb already
    // draws one for this. Being *captured* is the loss that does get its own
    // event, and this is not it.
    const events = runUntil(diverAt(0), EMPTY_FRAME, (w) => !w.player.alive, 5);
    expect(eventsOfType(events, 'player-captured')).toHaveLength(0);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(1);
  });

  it("misses a diver one pixel outside the fighter's window", () => {
    // Δx = +7 is one past the verified [−6, +6] — the same boundary the bullets
    // are held to, because it is the same window.
    const world = diverAt(7);
    for (let i = 0; i < 30; i += 1) stepWorld(world, EMPTY_FRAME);
    expect(world.player.alive).toBe(true);
    expect(world.lives.reserve).toBe(2);
  });

  it("widens the window by the enemy's own padding, not by a constant", () => {
    // The same Δx = +7, and a 1 px padded alien reaches the fighter with it. A
    // fatter alien is easier to shoot *and* harder to fly past, from one number.
    const padded = diverAt(7, { hitPadding: { x: 1, y: 0 } });
    runUntil(padded, EMPTY_FRAME, (w) => !w.player.alive, 5);
    expect(padded.lives.reserve).toBe(1);
  });

  it('leaves the enemy flying and scores nothing for it', () => {
    // The reading the reference supports: every point and every kill in it comes
    // through the *rocket* hit dispatcher, and nothing puts either on the
    // fighter-hit path. A ram that also destroyed the enemy would hand out free
    // kills nothing traced — see reference section 11 item 2.
    const world = diverAt(0);
    const events = runUntil(world, EMPTY_FRAME, (w) => !w.player.alive, 5);
    expect(eventsOfType(events, 'target-destroyed')).toHaveLength(0);
    expect(eventsOfType(events, 'score-changed')).toHaveLength(0);
    expect(world.score).toBe(0);
    expect(world.fleet.enemies[0]?.state).toBe('diving');
  });

  it('spares the fighter an enemy its own shot destroyed on the same frame', () => {
    // The order `stepWorld` resolves these in, stated as the behaviour it buys:
    // shots first, so nothing kills you from a position it has already left. On
    // this frame the shot has climbed 6 px and the enemy is Δy = +6 above it,
    // which is inside the single fighter's window.
    const world = diverAt(0);
    const events = runUntil(world, FIRE, (w) => w.score > 0, 5);
    expect(eventsOfType(events, 'target-destroyed')).toHaveLength(1);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(0);
    expect(world.player.alive).toBe(true);
  });

  it('ends the game when the last fighter is flown into', () => {
    const world = diverAt(0);
    world.lives.reserve = 0;
    const events = runUntil(world, EMPTY_FRAME, (w) => w.status === 'game-over', 5);
    expect(eventsOfType(events, 'player-hit')[0]?.livesRemaining).toBe(0);
    expect(eventsOfType(events, 'game-over')).toHaveLength(1);
  });

  it('brings the next fighter back, and the diver is still there to fly into', () => {
    // Nothing clears the field of *enemies* on a hit — only the shots and the
    // bombs — so the same diver takes the next fighter too. Three in a row is a
    // whole game, which is what the `collision-game-over` golden records.
    const world = diverAt(0);
    const events = runUntil(world, EMPTY_FRAME, (w) => w.status === 'game-over', 400);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(3);
    expect(eventsOfType(events, 'player-ready')).toHaveLength(2);
  });

  it('can be switched off by a pack whose enemies are not solid', () => {
    const soft: Rules = {
      ...rules,
      enemies: { ...rules.enemies, collision: { enabled: false } },
    };
    const world = createWorld({ seed: 'soft', rules: soft, stages });
    world.fleet.enemies.splice(0, world.fleet.enemies.length);
    world.fleet.enemies.push(enemyAt({ state: 'diving', x: world.player.x, y: world.player.y }));
    world.fleet.entryComplete = true;
    for (let i = 0; i < 60; i += 1) stepWorld(world, EMPTY_FRAME);
    expect(world.player.alive).toBe(true);
    expect(world.lives.reserve).toBe(2);
  });

  it('applies to an enemy at rest in the formation, with no state exception', () => {
    // The fighter-hit path carries no state test — unlike the *scoring* path,
    // which carries one — so "any enemy on the field" is the rule and a formation
    // slot is not a safe place to sit. Stated on a formation that puts one there,
    // because the shipped one cannot: see the test below.
    const onTheRow = stageSourceOf(
      {
        id: 'on-the-row',
        formation: 'one-low-slot',
        waves: [{ at: 0, entryPath: 'entry-side-file', slots: [{ alien: 'drone', home: 0 }] }],
      },
      {
        id: 'one-low-slot',
        grid: { originX: 103, originY: 248, columnSpacing: 16, rowSpacing: 16 },
        slots: [{ row: 0, column: 0, role: 'drone' }],
      },
    );
    const world = createWorld({ seed: 'at-home', rules, stages: onTheRow });
    const enemy = world.fleet.enemies[0];
    expect(enemy).toBeDefined();
    if (enemy === undefined) return;
    // Put it straight into its slot rather than flying it in, so this is about
    // the state and not about the entry path.
    enemy.state = 'home';
    world.fleet.entryComplete = true;

    const events = runUntil(world, EMPTY_FRAME, (w) => !w.player.alive, 10);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(1);
    expect(world.fleet.enemies[0]?.state).toBe('home');
  });

  it('is kept away from the fighter by the shipped formation, not by a rule', () => {
    // Why the generality above costs nothing: on `classic40` the lowest slot at
    // full breathe is still far above the fighter's window, so nothing at home can
    // reach it. If a pack moved its formation down the playfield, the rule above is
    // what would happen — which is the honest answer, and the arcade's.
    const formation = createFormation(classicFormation(), rules, 'normal');
    formation.entryComplete = true;
    formation.motion = 'breathe';
    expect(formation.slotRow).toHaveLength(40);
    let lowest = -Infinity;
    // A full breathe cycle is 256 frames; run two to be sure of both extremes.
    for (let i = 0; i < 512; i += 1) {
      stepFormation(formation, rules);
      for (let slot = 0; slot < formation.slotRow.length; slot += 1) {
        lowest = Math.max(lowest, homePosition(formation, rules, slot).y);
      }
    }
    // The fighter's window reaches this far up from its own row.
    const reach = rules.player.y + rules.player.hitWindow.dyMin;
    expect(lowest).toBeLessThan(reach);
    // And by a wide margin, so this is not a one-pixel accident.
    expect(reach - lowest).toBeGreaterThan(rules.player.height);
  });
});

describe('enemy bullets against the player', () => {
  it('takes a life and clears the field', () => {
    const world = worldWith([]);
    launchEnemyBullet(world.enemyBullets, world.player.x, world.player.y - 2, 0, 2);

    const events = runUntil(world, EMPTY_FRAME, (w) => !w.player.alive, 20);
    const hits = eventsOfType(events, 'player-hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.livesRemaining).toBe(1);
    expect(world.lives.reserve).toBe(1);
  });

  it('brings the next fighter back at the centre', () => {
    const world = worldWith([]);
    launchEnemyBullet(world.enemyBullets, world.player.x, world.player.y - 2, 0, 2);
    runUntil(world, EMPTY_FRAME, (w) => !w.player.alive, 20);

    const events = runUntil(world, EMPTY_FRAME, (w) => w.player.alive, 200);
    expect(eventsOfType(events, 'player-ready')).toHaveLength(1);
    expect(world.player.x).toBe(createWorld({ seed: 'x', rules }).player.x);
  });

  it('ends the game when the last fighter is lost', () => {
    const world = worldWith([]);
    world.lives.reserve = 0;
    launchEnemyBullet(world.enemyBullets, world.player.x, world.player.y - 2, 0, 2);

    const events = runUntil(world, EMPTY_FRAME, (w) => w.status === 'game-over', 20);
    expect(eventsOfType(events, 'game-over')).toHaveLength(1);
    expect(world.status).toBe('game-over');
  });

  it('stops simulating once the game is over', () => {
    const world = worldWith([]);
    world.status = 'game-over';
    const before = world.player.x;
    for (let i = 0; i < 60; i += 1) stepWorld(world, frameOf('right', 'fire'));
    expect(world.player.x).toBe(before);
  });

  it("misses a bullet that is outside the fighter's window", () => {
    const world = worldWith([]);
    // Δx = +7 is one past the verified [−6, +6].
    launchEnemyBullet(world.enemyBullets, world.player.x + 7, world.player.y - 2, 0, 2);
    for (let i = 0; i < 30; i += 1) stepWorld(world, EMPTY_FRAME);
    expect(world.player.alive).toBe(true);
    expect(world.lives.reserve).toBe(2);
  });
});

describe('extra lives', () => {
  it('awards one when the score crosses the first threshold', () => {
    const world = worldWith([enemyAt({ x: 0, y: 120, scoreBase: 1_000 })]);
    world.player.x = 0;
    world.score = 19_500;

    const events = runUntil(world, FIRE, (w) => w.score >= 20_000);
    const awards = eventsOfType(events, 'extra-life');
    expect(awards).toHaveLength(1);
    expect(awards[0]?.lives).toBe(3);
    expect(world.lives.reserve).toBe(3);
    expect(world.lives.bonusesAwarded).toBe(1);
  });

  it('does not award the same threshold twice', () => {
    const world = worldWith([
      enemyAt({ id: 0, x: 0, y: 120, scoreBase: 1_000 }),
      enemyAt({ id: 1, x: 0, y: 100, scoreBase: 1_000 }),
    ]);
    world.player.x = 0;
    world.score = 19_500;

    const events = runUntil(world, FIRE, (w) => w.score >= 21_500);
    expect(eventsOfType(events, 'extra-life')).toHaveLength(1);
  });
});

describe('the stage', () => {
  it('reports the verified starfield speed byte when a stage starts', () => {
    const world = createWorld({ seed: 'stage', stage: 1, rules, stages });
    const started = eventsOfType(world.events, 'stage-started');
    expect(started[0]?.starfieldSpeed).toBe(starfieldSpeedByte(rules, 1));
    expect(started[0]?.starfieldSpeed).toBe(0x40);
  });

  it('puts the pack’s stage on the field, with its formation', () => {
    const world = createWorld({ seed: 'stage', rules, stages });
    expect(world.content?.stage.id).toBe('stage-1');
    expect(world.fleet.enemies).toHaveLength(40);
    expect(world.formation?.columnsAtRest).toHaveLength(10);
  });

  it('rolls on to the next stage when the fleet is cleared', () => {
    const world = worldWith([enemyAt({ x: 0, y: 120 })]);
    world.player.x = 0;
    const events = runUntil(world, FIRE, (w) => w.stage > 1);

    expect(eventsOfType(events, 'stage-cleared')[0]?.stage).toBe(1);
    const started = eventsOfType(events, 'stage-started');
    expect(started[0]?.stage).toBe(2);
    // A fresh fleet, back in standby, for the new stage.
    expect(world.fleet.enemies).toHaveLength(40);
    expect(world.fleet.enemies.every((enemy) => enemy.state === 'standby')).toBe(true);
  });

  it('sits still on a stage the pack has no content for', () => {
    const world = createWorld({ seed: 'empty', rules });
    for (let i = 0; i < 120; i += 1) stepWorld(world, FIRE);
    expect(world.fleet.enemies).toHaveLength(0);
    expect(world.formation).toBeUndefined();
    // No content is a halt, not a stage counter running away every frame.
    expect(world.stage).toBe(1);
  });
});

describe('the entry, end to end', () => {
  it('launches five waves of eight and settles the formation exactly once', () => {
    const world = createWorld({ seed: 'entry', rules, stages });
    const events: SimEvent[] = [];
    // Whether every enemy is in its slot is only true *on* the settle frame:
    // diving begins from it, so a later snapshot finds enemies already peeling
    // off. Capturing it here is what keeps this a test of the entry.
    let statesAtSettle: string[] = [];
    for (let i = 0; i < 1_400; i += 1) {
      const step = stepWorld(world, EMPTY_FRAME);
      if (eventsOfType(step, 'formation-settled').length > 0) {
        statesAtSettle = world.fleet.enemies.map((enemy) => enemy.state);
      }
      events.push(...step);
    }

    const launched = eventsOfType(events, 'enemy-launched');
    expect(launched).toHaveLength(40);
    expect(new Set(launched.map((event) => event.wave))).toEqual(new Set([0, 1, 2, 3, 4]));
    for (const wave of [0, 1, 2, 3, 4]) {
      expect(launched.filter((event) => event.wave === wave)).toHaveLength(8);
    }

    const settled = eventsOfType(events, 'formation-settled');
    expect(settled).toHaveLength(1);
    expect(settled[0]?.enemies).toBe(40);
    expect(world.formation?.swayOffset).toBe(0);
    expect(world.formation?.motion).toBe('breathe');
    expect(statesAtSettle).toEqual(Array.from({ length: 40 }, () => 'home'));
  });

  it('never leaves an enemy off the playfield once it is flying', () => {
    const world = createWorld({ seed: 'bounds', rules, stages });
    const margin = 24;
    for (let i = 0; i < 1_400; i += 1) {
      stepWorld(world, EMPTY_FRAME);
      for (const enemy of world.fleet.enemies) {
        if (enemy.state === 'standby' || enemy.state === 'dead') continue;
        expect(enemy.x).toBeGreaterThanOrEqual(-margin);
        expect(enemy.x).toBeLessThanOrEqual(rules.playfield.width + margin);
        expect(enemy.y).toBeGreaterThanOrEqual(-margin);
        expect(enemy.y).toBeLessThanOrEqual(rules.playfield.height + margin);
      }
    }
  });
});

describe('the simulation boundary', () => {
  it('runs with no browser attached at all', () => {
    // The Vitest projects use the Node environment, so this is not rhetorical:
    // any DOM or Canvas reference inside src/sim/ would fail to import here.
    expect(typeof globalThis.document).toBe('undefined');
    const world = createWorld({ seed: 'headless', rules, stages });
    for (let i = 0; i < 300; i += 1) stepWorld(world, FIRE);
    expect(world.step).toBe(300);
  });

  it('replaces its event list every step rather than accumulating', () => {
    const world = createWorld({ seed: 'events', rules, stages });
    stepWorld(world, EMPTY_FRAME);
    const first = world.events;
    stepWorld(world, EMPTY_FRAME);
    expect(world.events).not.toBe(first);
  });
});

describe('the fingerprint’s precision', () => {
  /**
   * `fingerprintWorld` compares every number exactly. It used to round to six
   * decimal places, to absorb `Math.sin` landing a unit in the last place apart on
   * arm64 and x86-64, and both edges of that mesh were pinned here. Both edges of
   * exact are pinned now. The catching edge: one ULP, the smallest difference a
   * double can carry, reaches the string — in an enemy's position and in a bomb's
   * velocity alike — which the rounding absorbed and any tolerance at all would.
   * The absorbing edge has nothing left to absorb, and that is the claim to hold:
   * the numbers compared are made without engine noise, so exact costs nothing
   * across machines. Without the first half a mesh could come back unnoticed;
   * without the second, nobody could tell later whether exact was still safe.
   */
  const nextUp = (value: number): number => {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    view.setBigUint64(0, view.getBigUint64(0) + 1n);
    return view.getFloat64(0);
  };

  const slantedBullets = (world: World): World['enemyBullets'] =>
    world.enemyBullets.filter((bullet) => bullet.active && bullet.vx !== 0);

  /**
   * A stage-20 world with enemies flying in and aimed bombs in the air: stage 20
   * bombs on the way in, so the first slanted bullets are up within a second.
   */
  function busy(): World {
    const world = createWorld({ seed: 'fingerprint', rules, stages, stage: 20 });
    while (slantedBullets(world).length < 2) {
      if (world.step > 600) throw new Error('no aimed bombs in flight after 600 steps');
      stepWorld(world, EMPTY_FRAME);
    }
    return world;
  }

  /** The bullet whose velocity is furthest from an axis, so it went through a sine. */
  function slantedBullet(world: World): World['enemyBullets'][number] | undefined {
    return slantedBullets(world).sort((a, b) => Math.abs(b.vx) - Math.abs(a.vx))[0];
  }

  it.each([
    ['an enemy’s x', (world: World) => world.fleet.enemies.find((e) => !Number.isInteger(e.x))],
    ['a bullet’s velocity', (world: World) => slantedBullet(world)],
  ] as const)('catches a one-ULP difference in %s — nothing is rounded', (_label, pick) => {
    const world = busy();
    const target = pick(world) as { x?: number; vx?: number } | undefined;
    if (target === undefined) throw new Error('nothing fractional to nudge');
    const key = 'vx' in target ? 'vx' : 'x';
    const before = fingerprintWorld(world);
    const value = target[key] ?? 0;
    target[key] = nextUp(value);
    expect(target[key]).not.toBe(value);
    expect(fingerprintWorld(world)).not.toBe(before);
  });

  it('needs no tolerance: a bomb’s heading is the trig table’s, not the engine’s', () => {
    // A bullet's velocity is a unit vector from `src/engine/trig.ts` times the
    // pack's bullet speed, and that table hands out exact multiples of 2^-30 —
    // which `Math.sin` and `Math.cos` almost never return. So every slanted bomb in
    // flight lying on that grid is the simulation's numbers being made from the
    // portable table, and would stop being so the day an engine-defined function
    // came back.
    const world = busy();
    const speed = rules.enemies.bullet.speed;
    for (const bullet of slantedBullets(world)) {
      expect(Number.isInteger((bullet.vx / speed) * 2 ** 30)).toBe(true);
      expect(Number.isInteger((bullet.vy / speed) * 2 ** 30)).toBe(true);
    }
  });

  it('leaves the RNG state exactly as it is, bit for bit', () => {
    // The generator's four uint32s are part of the on-disk contract, so they must
    // pass through the serialiser untouched — `2 ** 32 - 1` included.
    const world = busy();
    world.rng.setState([4294967295, 0, 2324523762, 1]);
    const printed: unknown = JSON.parse(fingerprintWorld(world));
    expect((printed as { rng: number[] }).rng).toEqual([4294967295, 0, 2324523762, 1]);
  });
});
