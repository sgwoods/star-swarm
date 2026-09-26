import { describe, expect, it } from 'vitest';

import { isContinuousBombing, resolveDifficultyRow } from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { EMPTY_FRAME, frameOf } from '../../src/engine/input.js';
import { armDives, diverCount, maxDiversNow } from '../../src/sim/dive.js';
import type { Enemy } from '../../src/sim/enemies.js';
import { enemyScore } from '../../src/sim/enemies.js';
import { eventsOfType, type SimEvent } from '../../src/sim/events.js';
import { bulletsInFlight } from '../../src/sim/shots.js';
import { createWorld, stepWorld, type World } from '../../src/sim/world.js';
import { classicRules, classicStages } from '../helpers/rules.js';

/**
 * Dive attacks, enemy fire and the difficulty ramp — `src/sim/dive.ts`.
 *
 * Everything here runs against the **shipped Classic pack**, read through the
 * real loader, because the point of most of these tests is that the ramp's own
 * rows govern the attack. A test that built its own rules object would prove the
 * test's numbers rather than the pack's.
 *
 * Node environment, no DOM: the simulation would not survive the import if it
 * reached for one.
 */

const rules = classicRules();
const stages = classicStages();
const FIRE = frameOf('fire');

/**
 * The same rules with a cabinet full of spare fighters.
 *
 * Needed by anything that watches the attack for more than a few seconds: the
 * world does nothing at all once the last ship is lost, so a three-ship cabinet
 * with an idle fighter freezes after the first handful of dives and every later
 * assertion would be measuring a stopped game.
 */
function longLived(): Rules {
  return { ...rules, lives: { ...rules.lives, default: 400 } };
}

/**
 * A world on `stage` with the formation already full, settled and armed.
 *
 * Shortcuts the 1,024 frames of entry choreography, which
 * `tests/unit/world.test.ts` and the `stage-entry` golden already cover. What it
 * does *not* shortcut is `armDives`: diving begins from that call and nowhere
 * else, which is the gate `player-core.test.ts` asserts end to end.
 */
function armedWorld(stage = 1, options: { seed?: string; rules?: Rules } = {}): World {
  const world = createWorld({
    seed: options.seed ?? 'dive',
    rules: options.rules ?? rules,
    stages,
    stage,
  });
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

/** Step `steps` frames, returning every event raised along the way. */
function run(world: World, steps: number, frame = EMPTY_FRAME): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i += 1) events.push(...stepWorld(world, frame));
  return events;
}

/** Leave exactly `count` enemies alive, taking them from the front of the fleet. */
function keepAlive(world: World, count: number): Enemy[] {
  const kept: Enemy[] = [];
  world.fleet.enemies.forEach((enemy, index) => {
    if (index < count) kept.push(enemy);
    else enemy.state = 'dead';
  });
  return kept;
}

describe('launching dives', () => {
  it('launches nothing until the formation has settled', () => {
    // `armedWorld` is the armed case; this is the same world without the arming,
    // which is the whole of the gate. Diving begins from `formation-settled`.
    const world = armedWorld();
    world.dive.armed = false;
    expect(eventsOfType(run(world, 600), 'enemy-dived')).toHaveLength(0);
    expect(diverCount(world.fleet)).toBe(0);
  });

  it('launches nothing on a row whose diver limit is zero', () => {
    // Stage 3 is a challenge stage, and every challenge-stage row is all zeros —
    // nothing attacks there. The row *selects* that, without the engine knowing
    // what a challenge stage is.
    expect(resolveDifficultyRow(rules, 3)?.maxDivers).toBe(0);
    const world = armedWorld(3, { rules: longLived() });
    expect(eventsOfType(run(world, 1_200), 'enemy-dived')).toHaveLength(0);
  });

  it('launches more often on a later row, because the row says so', () => {
    // Not a multiplier and not a curve: stage 20's launch counters are 2/8/8
    // where stage 1's are 0/0/0, and its diver limit is 4 rising to 6 where stage
    // 1's is 2. More dives follow from reading the row, and nothing else.
    const count = (stage: number): number =>
      eventsOfType(
        run(armedWorld(stage, { rules: longLived(), seed: 'rates' }), 1_800),
        'enemy-dived',
      ).length;
    const early = count(1);
    const late = count(20);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early * 2);
  });

  it('decides launches on the round robin, never on an arbitrary frame', () => {
    // The four-phase update is what shapes the cadence (reference section 2), so a
    // dive can only begin on a frame the launcher runs.
    const world = armedWorld(20, { rules: longLived() });
    const phases = rules.enemies.updatePhases;
    let dives = 0;
    for (let i = 0; i < 1_200; i += 1) {
      const step = stepWorld(world, EMPTY_FRAME);
      const launched = eventsOfType(step, 'enemy-dived').length;
      if (launched > 0) {
        expect(world.fleet.frame % phases).toBe(0);
        dives += launched;
      }
    }
    expect(dives).toBeGreaterThan(4);
  });

  it('only ever dives an enemy that is sitting in the formation', () => {
    const world = armedWorld(20, { rules: longLived() });
    for (let i = 0; i < 1_200; i += 1) {
      const step = stepWorld(world, EMPTY_FRAME);
      for (const event of eventsOfType(step, 'enemy-dived')) {
        const enemy = world.fleet.enemies.find((each) => each.id === event.targetId);
        // It is `diving` by the time the event is read, and it was `home` a moment
        // before — which is what makes the diver limit a limit at all.
        expect(enemy?.state).toBe('diving');
      }
    }
  });
});

describe('how many may dive at once', () => {
  it('holds the row’s limit, then raises it to the row’s bump', () => {
    // Every row carries two limits and the pack says how long "after a time" is.
    // Stage 20 is where the two differ most in rank A: 4, then 6.
    const row = resolveDifficultyRow(rules, 20);
    expect([row?.maxDivers, row?.maxDiversBump]).toEqual([4, 6]);

    const world = armedWorld(20, { rules: longLived(), seed: 'bump' });
    const bumpAt = rules.enemies.dive.bumpAfterFrames;
    let before = 0;
    let after = 0;
    for (let i = 0; i < 2_400; i += 1) {
      stepWorld(world, EMPTY_FRAME);
      const diving = diverCount(world.fleet);
      if (world.dive.frame < bumpAt) before = Math.max(before, diving);
      else after = Math.max(after, diving);
    }
    expect(before).toBe(4);
    expect(after).toBe(6);
  });

  it('reports the limit in force rather than one of the two blindly', () => {
    const world = armedWorld(20);
    expect(maxDiversNow(world.dive, rules)).toBe(4);
    world.dive.frame = rules.enemies.dive.bumpAfterFrames;
    expect(maxDiversNow(world.dive, rules)).toBe(6);
  });

  it('never exceeds the limit on any frame of a long run', () => {
    for (const stage of [1, 13, 20]) {
      const world = armedWorld(stage, { rules: longLived(), seed: `cap-${String(stage)}` });
      for (let i = 0; i < 1_800; i += 1) {
        stepWorld(world, EMPTY_FRAME);
        expect(diverCount(world.fleet)).toBeLessThanOrEqual(maxDiversNow(world.dive, rules));
      }
    }
  });

  it('does not count a diver on its way back into its slot', () => {
    // The row's limit is on simultaneous *bombers*; an enemy rotating home has
    // stopped attacking. Counting it would silently halve the attack.
    //
    // Long enough for a whole round trip on stage 1, where two divers at a time is
    // the row's limit and a capture attempt can hold one of the two for seconds.
    const world = armedWorld(1, { rules: longLived() });
    run(world, 2_400);
    const returning = world.fleet.enemies.filter((enemy) => enemy.state === 'returning');
    expect(returning.length).toBeGreaterThan(0);
    expect(diverCount(world.fleet)).toBe(
      world.fleet.enemies.filter((enemy) => enemy.state === 'diving').length,
    );
  });
});

describe('a dive, end to end', () => {
  it('leaves the formation, leaves the bottom and comes back to its own slot', () => {
    // The three outcomes of a dive are die, leave, or return to its *own* slot.
    // This is the return, and the slot has to be the one it left.
    const world = armedWorld(1, { rules: longLived(), seed: 'round-trip' });
    const seen = new Map<number, string[]>();
    for (let i = 0; i < 2_400; i += 1) {
      stepWorld(world, EMPTY_FRAME);
      for (const enemy of world.fleet.enemies) {
        const log = seen.get(enemy.id) ?? [];
        if (log[log.length - 1] !== enemy.state) {
          log.push(enemy.state);
          seen.set(enemy.id, log);
        }
      }
    }
    const roundTrips = [...seen.values()].filter((log) =>
      log.join(' ').includes('home diving returning home'),
    );
    expect(roundTrips.length).toBeGreaterThan(0);

    // And every enemy back at home is standing in its own slot, not in a
    // neighbour's: homing resolves the slot the enemy owns for the whole stage.
    // Keyed on the whole address, because a home index names a slot in one of two
    // tables — a captured fighter's names a captive slot (`src/sim/capture.ts`).
    const homes = world.fleet.enemies.filter((enemy) => enemy.state === 'home');
    const addresses = homes.map((enemy) => `${String(enemy.inCaptiveSlot)}:${String(enemy.home)}`);
    expect(new Set(addresses).size).toBe(homes.length);
  });

  it('flies the dive from the slot it left, not from a fixed point', () => {
    const world = armedWorld(20, { rules: longLived(), seed: 'from-slot' });
    const starts: number[] = [];
    for (let i = 0; i < 1_200; i += 1) {
      const step = stepWorld(world, EMPTY_FRAME);
      for (const event of eventsOfType(step, 'enemy-dived')) starts.push(event.x);
    }
    // Several enemies dived, and they did not all set off from the same column.
    expect(starts.length).toBeGreaterThan(3);
    expect(new Set(starts).size).toBeGreaterThan(1);
  });
});

describe('enemy fire', () => {
  /**
   * Put the first `count` enemies into a dive with no flight, so they hold still
   * and bomb, and leave the rest sitting in the formation.
   *
   * The rest matter: they keep the live count above the row's
   * `continuousBombingAt`, and continuous bombing is precisely the state in which
   * the per-dive allowance and the alien's own delay stop applying. A test of
   * either that left one enemy alive would be testing the other thing.
   */
  function bombers(world: World, count: number): Enemy[] {
    const kept = world.fleet.enemies.slice(0, count);
    for (const enemy of kept) {
      enemy.state = 'diving';
      enemy.bombTimer = 0;
      enemy.bombsLeft = enemy.fire?.shotsPerDive ?? 0;
    }
    // Nobody else fires, so every bomb in these tests has a known owner.
    for (const enemy of world.fleet.enemies.slice(count)) enemy.bombTimer = 100_000;
    return kept;
  }

  it('never puts more than the global cap of eight bullets in the air', () => {
    // The cap is global rather than per enemy, and it is a first-order
    // contributor to how the game feels (reference section 4). Forty enemies all
    // ready to bomb is the case that proves it is a pool and not an array.
    expect(rules.enemies.maxBullets).toBe(8);
    const world = armedWorld(20, { rules: longLived() });
    bombers(world, 40);

    let peak = 0;
    for (let i = 0; i < 240; i += 1) {
      stepWorld(world, EMPTY_FRAME);
      peak = Math.max(peak, bulletsInFlight(world.enemyBullets));
      expect(bulletsInFlight(world.enemyBullets)).toBeLessThanOrEqual(8);
    }
    expect(peak).toBe(8);
  });

  it('holds each enemy to its own inter-shot delay', () => {
    // One enemy, two shots, and the gap between them is the alien's own
    // `cooldownFrames` — not a global timer, which would make forty enemies fire
    // in lockstep. The gap may run up to one round robin longer, because the
    // decision is taken on the enemy's own phase.
    const world = armedWorld(1, { rules: longLived() });
    const [bomber] = bombers(world, 1);
    if (bomber === undefined) throw new Error('no bomber');
    bomber.bombsLeft = 2;
    const cooldown = bomber.fire?.cooldownFrames ?? 0;
    expect(cooldown).toBeGreaterThan(0);

    const firedAt: number[] = [];
    for (let i = 0; i < 400; i += 1) {
      const step = stepWorld(world, EMPTY_FRAME);
      if (eventsOfType(step, 'enemy-fired').length > 0) firedAt.push(i);
    }
    expect(firedAt.length).toBe(2);
    const gap = (firedAt[1] ?? 0) - (firedAt[0] ?? 0);
    expect(gap).toBeGreaterThanOrEqual(cooldown);
    expect(gap).toBeLessThanOrEqual(cooldown + rules.enemies.updatePhases);
  });

  it('gives each enemy its role’s timer at the start of a stage', () => {
    // Loaded unconditionally at stage start and keyed by *role*, which is the
    // arcade's own `16 02 02` init (reference section 6).
    const world = createWorld({ seed: 'timers', rules, stages, stage: 1 });
    for (const enemy of world.fleet.enemies) {
      expect([enemy.role, enemy.bombTimer]).toEqual([
        enemy.role,
        rules.enemies.bomberReadyTimers[enemy.role],
      ]);
    }
  });

  it('spends a dive’s allowance and then stops until the next dive', () => {
    const world = armedWorld(1, { rules: longLived() });
    const [bomber] = bombers(world, 1);
    if (bomber === undefined) throw new Error('no bomber');
    const allowance = bomber.fire?.shotsPerDive ?? 0;
    expect(allowance).toBeGreaterThan(0);

    const fired = eventsOfType(run(world, 600), 'enemy-fired');
    expect(fired).toHaveLength(allowance);
    expect(bomber.bombsLeft).toBe(0);
  });

  it('holds its fire while the fighter is off the field', () => {
    // Bombs aim at the fighter; with none there they drop straight down, which is
    // harmless rather than undefined. Nothing may be hit while it is respawning.
    const world = armedWorld(1, { rules: longLived() });
    bombers(world, 40);
    world.player.alive = false;
    world.player.respawnTimer = 400;
    const events = run(world, 120);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(0);
    // Straight down, so `vx` is zero — written as a comparison because a heading
    // of zero produces a negative zero, which `toBe` does not treat as zero.
    for (const bullet of world.enemyBullets) {
      if (bullet.active) expect(bullet.vx === 0).toBe(true);
    }
  });
});

describe('the aggression details', () => {
  it('has no entry bombing on stage 1, and has it from stage 2', () => {
    // Verified: enemies fire during dives, and during entry from stage 2 onward
    // (`docs/DESIGN.md` section 4, report acceptance test R14). The whole of
    // stage 1's entry runs before anything has settled, so a run that stops short
    // of the settle sees only entry fire.
    const entryOnly = (stage: number): number => {
      const world = createWorld({ seed: 'entry-bombs', rules: longLived(), stages, stage });
      const events = run(world, 1_000);
      expect(eventsOfType(events, 'formation-settled')).toHaveLength(0);
      expect(eventsOfType(events, 'enemy-dived')).toHaveLength(0);
      return eventsOfType(events, 'enemy-fired').length;
    };
    expect(entryOnly(1)).toBe(0);
    expect(entryOnly(2)).toBeGreaterThan(0);
  });

  it('turns bombing continuous once the row’s threshold of enemies is left', () => {
    // Parameter 7: "the number of aliens left when continuous bombing can start",
    // 6 at stage 1 and rising to 12 by stage 22 (reference section 6). It is a
    // threshold on the live count, not a timer — and what "continuous" means is
    // that the alien's own delay gives way to the shorter one.
    const threshold = resolveDifficultyRow(rules, 1)?.continuousBombingAt ?? 0;
    expect(threshold).toBe(6);
    expect(isContinuousBombing(resolveDifficultyRow(rules, 1), threshold + 1)).toBe(false);
    expect(isContinuousBombing(resolveDifficultyRow(rules, 1), threshold)).toBe(true);

    /** Fire one bomber with `alive` enemies on the field; return its reloaded delay. */
    const delayAfterFiring = (alive: number): number => {
      const world = armedWorld(1, { rules: longLived() });
      const kept = keepAlive(world, alive);
      const bomber = kept[0];
      if (bomber === undefined) throw new Error('no bomber');
      for (const enemy of kept) enemy.state = 'diving';
      bomber.bombTimer = 0;
      bomber.bombsLeft = 4;
      for (const enemy of kept.slice(1)) enemy.bombTimer = 10_000;
      for (let i = 0; i < 40; i += 1) {
        const step = stepWorld(world, EMPTY_FRAME);
        if (eventsOfType(step, 'enemy-fired').length > 0) return bomber.bombTimer;
      }
      throw new Error('the bomber never fired');
    };

    // Above the threshold the alien's own delay is in force; at it, the pack's
    // shorter continuous one replaces it.
    const continuous = rules.enemies.bombing.continuousCooldownFrames ?? 0;
    const own = delayAfterFiring(threshold + 1);
    expect(own).toBeGreaterThan(continuous);
    expect(delayAfterFiring(threshold)).toBe(continuous);
  });

  it('raises the threshold across the ramp rather than holding one number', () => {
    expect(resolveDifficultyRow(rules, 1)?.continuousBombingAt).toBe(6);
    expect(resolveDifficultyRow(rules, 22)?.continuousBombingAt).toBe(12);
  });
});

describe('scoring a dive kill', () => {
  /** Put one enemy in front of the fighter, fire, and return the score it paid. */
  function shootOne(state: Enemy['state']): number {
    const world = createWorld({ seed: 'score', rules, stages });
    const [target] = keepAlive(world, 1);
    if (target === undefined) throw new Error('no target');
    target.state = state;
    // Directly above the fighter, inside the shot's window from the frame it
    // leaves the muzzle. The fleet does not move an enemy in either state without
    // a flight registered, so it stays put.
    target.x = world.player.x;
    target.y = world.player.y - 8;
    world.fleet.entryComplete = true;

    const events = run(world, 6, FIRE);
    const destroyed = eventsOfType(events, 'target-destroyed');
    expect(destroyed).toHaveLength(1);
    return destroyed[0]?.score ?? 0;
  }

  /** The base value of the enemy `shootOne` puts in front of the fighter. */
  function targetBase(): number {
    const world = createWorld({ seed: 'score', rules, stages });
    return world.fleet.enemies[0]?.scoreBase ?? 0;
  }

  it('doubles a diving target and does not double a returning one', () => {
    // Report section 4.3, stated exactly: doubled unless the object's state is "at
    // home in the formation" or "rotating back into its slot after a dive". The
    // test is on the *state*, so a returning enemy scores the formation value
    // while visibly moving — which is the case a velocity test gets wrong.
    const base = targetBase();
    expect(base).toBeGreaterThan(0);
    expect(shootOne('diving')).toBe(base * 2);
    expect(shootOne('returning')).toBe(base);
    expect(shootOne('entering')).toBe(base * 2);
    // `home` is the fourth case and cannot be staged this way — an enemy at home
    // *is* its slot, so the fleet puts it back there every frame. The next test
    // covers it on the rule itself, and `tests/unit/world.test.ts` covers it end
    // to end.
  });

  it('reads the multiplier from the enemy’s state, not from a table of pairs', () => {
    // The same enemy, one field changed. A lookup table keyed on type and a
    // boolean happens to agree on the common cases; report section 4.7 lists where
    // it stops agreeing, and this is the mechanism that keeps it right.
    const world = createWorld({ seed: 'multiplier', rules, stages });
    const [enemy] = keepAlive(world, 1);
    if (enemy === undefined) throw new Error('no enemy');
    const base = enemy.scoreBase;
    const scores = (['home', 'returning', 'entering', 'diving'] as const).map((state) => {
      enemy.state = state;
      return enemyScore(enemy);
    });
    expect(scores).toEqual([base, base, base * 2, base * 2]);
  });

  it('pays a warden’s whole value on the hit that destroys it', () => {
    // A two-hit enemy's first hit scores nothing; the doubling still applies to
    // the second. 150 at home, 300 diving — the escort bonus that makes it 400 is
    // the capture task's, and is a separate channel.
    expect(rules.scoring.movingMultiplier).toBe(2);
    const world = createWorld({ seed: 'warden', rules, stages });
    const target = world.fleet.enemies.find((enemy) => enemy.alienId === 'warden');
    if (target === undefined) throw new Error('no warden in stage 1');
    for (const enemy of world.fleet.enemies) if (enemy !== target) enemy.state = 'dead';
    target.state = 'diving';
    target.x = world.player.x;
    target.y = world.player.y - 8;
    world.fleet.entryComplete = true;

    const events = run(world, 60, FIRE);
    expect(eventsOfType(events, 'target-hit')).toHaveLength(1);
    expect(eventsOfType(events, 'target-destroyed')[0]?.score).toBe(300);
  });
});

describe('the transform attack', () => {
  /** A world on `stage` with `alive` settled enemies and the dives armed. */
  function transformWorld(stage: number, alive: number, seed = 'transform'): World {
    const world = armedWorld(stage, { rules: longLived(), seed });
    keepAlive(world, alive);
    return world;
  }

  it('waits for fewer than ten enemies, and does not fire at exactly ten', () => {
    // Verified, and the direction of the test is the correction of report section
    // 7.6: `f_1A80` returns while the live count is >= the threshold, so the body
    // runs only strictly below it.
    expect(rules.transform?.remainingThreshold).toBe(10);
    const fires = (alive: number): number =>
      eventsOfType(run(transformWorld(4, alive), 600), 'enemy-transformed').length;
    expect(fires(11)).toBe(0);
    expect(fires(10)).toBe(0);
    expect(fires(9)).toBe(1);
  });

  it('never fires before its own stage, or on a challenge stage', () => {
    expect(rules.transform?.fromStage).toBe(4);
    const fires = (stage: number): number =>
      eventsOfType(run(transformWorld(stage, 6), 600), 'enemy-transformed').length;
    expect(fires(1)).toBe(0);
    expect(fires(2)).toBe(0);
    // Stage 3 is a challenge stage: the arcade's enabling value is zero there,
    // which is exactly why stage 4 and not stage 3 is the first.
    expect(fires(3)).toBe(0);
    expect(fires(4)).toBe(1);
  });

  it('fires once per stage and not again', () => {
    const world = transformWorld(4, 6);
    expect(eventsOfType(run(world, 2_400), 'enemy-transformed')).toHaveLength(1);
    expect(world.dive.transformsUsed).toBe(1);
  });

  it('pulses first, so the player is warned before the group appears', () => {
    const tell = rules.transform?.tellFrames ?? 0;
    expect(tell).toBeGreaterThan(0);
    const world = transformWorld(4, 6);
    let pulsedAt = -1;
    let appearedAt = -1;
    for (let i = 0; i < 600; i += 1) {
      const step = stepWorld(world, EMPTY_FRAME);
      if (pulsedAt < 0 && eventsOfType(step, 'enemy-transforming').length > 0) pulsedAt = i;
      if (appearedAt < 0 && eventsOfType(step, 'enemy-transformed').length > 0) appearedAt = i;
    }
    expect(pulsedAt).toBeGreaterThanOrEqual(0);
    expect(appearedAt - pulsedAt).toBe(tell + 1);
  });

  it('takes a drone while any is left, and a wing once none is', () => {
    // "A bee, or a butterfly if no bees remain", in that order — the pack's
    // `transform.fromRoles`, so the engine never names a role.
    expect(rules.transform?.fromRoles).toEqual(['drone', 'wing']);
    const roleTaken = (roles: readonly string[]): string | undefined => {
      const world = armedWorld(4, { rules: longLived(), seed: 'roles' });
      const kept = world.fleet.enemies.filter((enemy) => roles.includes(enemy.role)).slice(0, 6);
      for (const enemy of world.fleet.enemies) {
        if (!kept.includes(enemy)) enemy.state = 'dead';
      }
      const events = run(world, 600);
      const parent = eventsOfType(events, 'enemy-transformed')[0]?.targetId;
      return world.fleet.enemies.find((enemy) => enemy.id === parent)?.role;
    };
    expect(roleTaken(['drone', 'wing'])).toBe('drone');
    expect(roleTaken(['wing'])).toBe('wing');
  });

  it('spawns a group of the stage’s own type, already diving, and lets it leave', () => {
    const world = transformWorld(4, 6);
    const events = run(world, 1_800);
    const transformed = eventsOfType(events, 'enemy-transformed')[0];
    expect(transformed).toBeDefined();
    if (transformed === undefined) return;

    // Stage 4 is the first entry of the cycle.
    expect(transformed.alienId).toBe(rules.transform?.types[0]);
    expect(transformed.group).toHaveLength(rules.transform?.groupSize ?? 0);

    // The parent became the group: it is off the field, unscored and undestroyed.
    const parent = world.fleet.enemies.find((enemy) => enemy.id === transformed.targetId);
    expect(parent?.state).toBe('dead');
    expect(eventsOfType(events, 'target-destroyed')).toHaveLength(0);

    // And the trio leaves the screen rather than rejoining a formation it has no
    // place in — its alien says `dive.returns: false`.
    const departed = eventsOfType(events, 'enemy-departed').map((event) => event.targetId);
    expect(departed).toEqual(expect.arrayContaining([...transformed.group]));
  });

  it('cycles three types on a four-stage period, as the bonus does', () => {
    const typeAt = (stage: number): string | undefined => {
      const world = transformWorld(stage, 6, `cycle-${String(stage)}`);
      return eventsOfType(run(world, 600), 'enemy-transformed')[0]?.alienId;
    };
    // Stages 4, 8, 12 then 16 restart the cycle — the same period the all-three
    // bonus steps on (reference section 6).
    expect([typeAt(4), typeAt(8), typeAt(12), typeAt(16)]).toEqual([
      'scourge',
      'manta',
      'ensign',
      'scourge',
    ]);
  });

  it('pays the all-of-them bonus only when all of them are destroyed', () => {
    /**
     * Destroy `kills` of a fresh group and report what the kills paid.
     *
     * The group is caught on the frame it appears and frozen there: left to fly,
     * it leaves the bottom of the screen within a few seconds, and a group with a
     * survivor can never be wholly destroyed — which is the other half of this
     * rule and the reason it is measured rather than assumed.
     */
    const scoreFor = (kills: number): number => {
      const world = transformWorld(4, 6, 'bonus');
      let group: readonly number[] = [];
      for (let i = 0; i < 600 && group.length === 0; i += 1) {
        const step = stepWorld(world, EMPTY_FRAME);
        group = eventsOfType(step, 'enemy-transformed')[0]?.group ?? [];
      }
      expect(group).toHaveLength(3);
      const members = group.map((id) => {
        const member = world.fleet.enemies.find((enemy) => enemy.id === id);
        if (member === undefined) throw new Error('missing group member');
        return member;
      });

      // Park the group off screen, so a shot aimed at one cannot catch another and
      // pay the bonus early; send everyone else back to its slot, where a shot
      // from the fighter's row cannot reach it; and silence every bomb, because a
      // bomb that killed the fighter would clear the shots mid-measurement.
      for (const member of members) {
        world.fleet.flights.delete(member.id);
        member.x = -64;
        member.y = -64;
      }
      for (const enemy of world.fleet.enemies) {
        enemy.bombTimer = 100_000;
        if (!members.includes(enemy) && enemy.state !== 'dead') {
          enemy.state = 'home';
          world.fleet.flights.delete(enemy.id);
        }
      }

      const before = world.score;
      let destroyed = 0;
      for (const member of members.slice(0, kills)) {
        member.x = world.player.x;
        member.y = world.player.y - 8;
        member.state = 'diving';
        // A shot reaches the row above the fighter on the frame it is fired, but
        // the two-slot cap means the *next* shot waits for one of the pair to
        // leave the top of the screen — which is a good sixty frames away.
        for (let i = 0; i < 90; i += 1) {
          destroyed += eventsOfType(stepWorld(world, FIRE), 'target-destroyed').length;
        }
      }
      expect(destroyed).toBe(kills);
      return world.score - before;
    };

    const bonus = rules.scoring.transformGroupBonus?.rows[0] ?? 0;
    expect(bonus).toBe(1000);
    // Each transform is 80 doubled = 160 while it is attacking. Two of the three
    // pays nothing extra; the third completes the group.
    expect(scoreFor(2)).toBe(320);
    expect(scoreFor(3)).toBe(480 + bonus);
  });

  it('withholds the bonus once a member has left the screen alive', () => {
    // A group with a survivor can never be wholly destroyed, so the bonus is off
    // from the moment one leaves — a later kill of the two that stayed must not
    // pay it.
    const world = transformWorld(4, 6, 'survivor');
    let group: readonly number[] = [];
    for (let i = 0; i < 600 && group.length === 0; i += 1) {
      const step = stepWorld(world, EMPTY_FRAME);
      group = eventsOfType(step, 'enemy-transformed')[0]?.group ?? [];
    }
    expect(group).toHaveLength(3);

    // Let them fly until they have all left the bottom, undestroyed.
    const departed = eventsOfType(run(world, 1_200), 'enemy-departed').map(
      (event) => event.targetId,
    );
    expect(departed).toEqual(expect.arrayContaining([...group]));
    expect(world.dive.transformGroupIntact).toBe(false);
    expect(world.dive.transformGroup.size).toBe(0);
  });
});
