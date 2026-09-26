import { describe, expect, it } from 'vitest';

import {
  resolveBeamStepFrames,
  resolveDifficultyRow,
  shotWindowsFor,
} from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { isChallengeStage } from '../../src/content/rules.js';
import { EMPTY_FRAME, frameOf } from '../../src/engine/input.js';
import type { CapturePhase } from '../../src/sim/capture.js';
import { beamWindow, capturedFighter, captorOfCaptive } from '../../src/sim/capture.js';
import { hitsAny, windowGapsX } from '../../src/sim/collision.js';
import { armDives } from '../../src/sim/dive.js';
import type { Enemy } from '../../src/sim/enemies.js';
import { isTargetable } from '../../src/sim/enemies.js';
import { eventsOfType, type SimEvent } from '../../src/sim/events.js';
import { createWorld, stepWorld, type World } from '../../src/sim/world.js';
import { classicRules, classicStages } from '../helpers/rules.js';

/**
 * The capture mechanic — `src/sim/capture.ts`.
 *
 * Everything here runs against the **shipped Classic pack**, read through the real
 * loader, and reaches every state by *playing* rather than by assigning to the
 * channel. That matters more here than anywhere else in the simulation: the whole
 * mechanic is a state machine whose interesting property is which transitions are
 * reachable, and a test that set `phase` by hand would prove the test's state
 * machine rather than the game's.
 *
 * Node environment, no DOM.
 */

const rules = classicRules();
const stages = classicStages();
const FIRE = frameOf('fire');

/**
 * The shipped rules with nothing shooting back and nothing solid to fly into: a
 * global bullet cap of zero, and enemy bodies switched off.
 *
 * The default for these tests, and the reason is not convenience. The question
 * every one of them asks is what the *beam* does, and an idle fighter standing in
 * front of forty bombers is dead within a few seconds — of a bomb, or now of a
 * diver flying through it, since `enemies.collision` landed. Either way the run
 * measures being killed rather than being captured, and "a capture is not a hit"
 * below is only a claim about the channel if nothing *else* can hit. Two rules
 * fields, and every other number is the pack's; the handful of tests whose subject
 * *is* the body put them back through {@link solidFleet}.
 */
function unarmedFleet(): Rules {
  return {
    ...rules,
    lives: { ...rules.lives, default: 400 },
    enemies: { ...rules.enemies, maxBullets: 0, collision: { enabled: false } },
  };
}

/** {@link unarmedFleet} on the very last fighter: reserve zero. */
function lastFighter(): Rules {
  return { ...unarmedFleet(), lives: { ...rules.lives, default: 1 } };
}

/**
 * {@link unarmedFleet} with the bodies put back: bombs off, `enemies.collision`
 * exactly as the pack ships it.
 *
 * For the handful of tests whose subject *is* the body — whether a beam still
 * connects when the captor that carries it is solid, and what colliding with a
 * captured fighter, a rogue or a dual fighter means. Everywhere else the bodies are
 * off so that "a capture is not a hit" is a claim about the channel.
 */
function solidFleet(): Rules {
  return {
    ...unarmedFleet(),
    enemies: { ...unarmedFleet().enemies, collision: rules.enemies.collision },
  };
}

/**
 * The stage these tests are played on, and why it is not stage 1.
 *
 * Stage 20's row launches captors often — a rate of 8 where stage 1's is 0 — and
 * gives the beam a 3-frame step period where stage 1's is 12, so the channel's
 * whole life fits inside a test instead of taking the best part of a minute. It is
 * the shipped row, not a softened one: the difference between the two stages is
 * itself something the beam-period tests below assert.
 */
const STAGE = 20;

/**
 * A world with the formation already full, settled and armed.
 *
 * Shortcuts the 1,024 frames of entry choreography that `tests/unit/world.test.ts`
 * and the `stage-entry` golden already cover. `armDives` is *not* shortcut: dives,
 * and therefore capture attempts, begin from that call and nowhere else.
 */
function armedWorld(options: { stage?: number; seed?: string; rules?: Rules } = {}): World {
  const world = createWorld({
    seed: options.seed ?? 'capture',
    rules: options.rules ?? unarmedFleet(),
    stages,
    stage: options.stage ?? STAGE,
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

/**
 * Step until `done` holds, and fail the test if it never does.
 *
 * Returns every event raised on the way, so a caller can assert both the state it
 * arrived in and what was announced getting there.
 */
function runUntil(
  world: World,
  done: (world: World) => boolean,
  options: { limit?: number; frame?: number } = {},
): SimEvent[] {
  const { limit = 4_000, frame = EMPTY_FRAME } = options;
  const events: SimEvent[] = [];
  for (let i = 0; i < limit; i += 1) {
    if (done(world)) return events;
    events.push(...stepWorld(world, frame));
  }
  expect(done(world), `condition never held within ${String(limit)} steps`).toBe(true);
  return events;
}

/** Step until the channel is in one of `phases`. */
function runToPhase(
  world: World,
  phases: readonly CapturePhase[],
  options: { limit?: number; frame?: number } = {},
): SimEvent[] {
  return runUntil(world, (live) => phases.includes(live.capture.phase), options);
}

/**
 * Step for as long as the world stays on `stage`, returning what happened there.
 *
 * A challenge stage ends on its own — its forty fly their scripts and leave — so
 * a fixed number of steps runs past it into the next stage, where dives are
 * supposed to resume. Anything asserting "nothing attacks here" has to stop at
 * the boundary or it measures the wrong stage.
 */
function runOnStage(
  world: World,
  stage: number,
  limit = 6_000,
  frame = EMPTY_FRAME,
  each?: (world: World) => void,
): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < limit && world.stage === stage; i += 1) {
    events.push(...stepWorld(world, frame));
    if (world.stage === stage) each?.(world);
  }
  return events;
}

/** Kill everything but a captured fighter, so the stage ends on the next step. */
function clearFleet(world: World): void {
  for (const enemy of world.fleet.enemies) {
    if (!enemy.inCaptiveSlot) enemy.state = 'dead';
  }
}

/** A world whose fighter has been captured and parked: the channel is `held`. */
function heldWorld(options: { stage?: number; seed?: string; rules?: Rules } = {}): World {
  const world = armedWorld(options);
  runToPhase(world, ['held']);
  return world;
}

/** The enemy holding the captured fighter, which the channel addresses by slot. */
function captorOf(world: World): Enemy {
  const captor = captorOfCaptive(world.capture, world.fleet);
  expect(captor, 'the captor should still be on the field').toBeDefined();
  if (captor === undefined) throw new Error('no captor');
  return captor;
}

/**
 * Shoot one enemy dead, through the real collision path.
 *
 * Aims slot 0 at the target and steps until the target is gone, re-aiming each
 * frame: a Warden takes two hits and the formation is moving, and a shot placed on
 * one anchor can be consumed by another enemy that happens to be crossing it. Going
 * through `resolvePlayerShots` rather than setting `state = 'dead'` is the whole
 * point — that is where the capture channel is told about a kill.
 */
function shoot(world: World, target: Enemy, limit = 240): SimEvent[] {
  const events: SimEvent[] = [];
  const shot = world.shots[0];
  expect(shot).toBeDefined();
  if (shot === undefined) return events;

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

/**
 * Put one enemy bullet into the fighter and step a frame.
 *
 * Pushed straight into the pool rather than fired, because these tests run with the
 * bullet cap at zero: the point is the *collision*, and an enemy that fired it would
 * have had to be lined up first.
 */
function hitPlayer(world: World, shipIndex = 0): SimEvent[] {
  const x = world.player.x + shipIndex * world.rules.player.secondShipOffsetX;
  world.enemyBullets.push({
    slot: world.enemyBullets.length,
    active: true,
    x,
    y: world.player.y,
    vx: 0,
    vy: 0,
  });
  return run(world, 1);
}

describe('a capture, end to end', () => {
  it('takes the fighter with a beam and parks it in its captor’s captive slot', () => {
    const world = armedWorld();
    const events = runToPhase(world, ['held']);

    // The beam came out, the fighter was taken, and the two are distinct events:
    // being captured is not being shot.
    expect(eventsOfType(events, 'capture-started').length).toBeGreaterThan(0);
    expect(eventsOfType(events, 'player-captured')).toHaveLength(1);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(0);

    // The captured fighter is now an enemy in the formation's captive row, in the
    // column of whichever captor took it.
    const captive = capturedFighter(world.capture, world.fleet);
    expect(captive?.inCaptiveSlot).toBe(true);
    expect(captive?.state).toBe('home');
    expect(captive?.alienId).toBe(rules.capture.captiveAlien);
    expect(world.capture.captiveSlot).toBe(captive?.home);

    // And the pairing is recorded by formation slot, not by enemy: the captor of a
    // held fighter has to survive a stage change, and no enemy does.
    const formation = world.formation;
    expect(formation).toBeDefined();
    if (formation === undefined) return;
    expect(formation.captiveCaptor[world.capture.captiveSlot ?? -1]).toBe(world.capture.captorSlot);
  });

  it('costs the fighter, and puts the next one back on its own row', () => {
    const world = armedWorld();
    const before = world.lives.reserve;
    runToPhase(world, ['held']);
    expect(world.lives.reserve).toBe(before - 1);

    // The beam is the one thing that moves the fighter off its row, so the next
    // one has to be put back on it.
    runUntil(world, (live) => live.player.alive);
    expect(world.player.y).toBe(rules.player.y);
  });

  it('ignores the stick and disables fire while the beam has the ship', () => {
    const world = armedWorld();
    runToPhase(world, ['carrying']);

    const events = run(world, 8, frameOf('left', 'fire'));
    // Being dragged: the stick does nothing, and neither does the button. The step
    // flag is the tell — `stepPlayer` toggles it on every frame it moves the
    // fighter, and it was never called. "Disables your rockets when the boss has
    // finally connected" — reference section 7.
    expect(world.player.stepFlag).toBe(0);
    expect(eventsOfType(events, 'shot-fired')).toHaveLength(0);
    expect(world.capture.phase).toBe('carrying');
  });

  it('never dies to a bullet while the beam is dragging it', () => {
    const world = armedWorld();
    runToPhase(world, ['carrying']);
    // Already lost to the beam; killing it here would swallow the capture.
    expect(eventsOfType(hitPlayer(world), 'player-hit')).toHaveLength(0);
    expect(world.capture.phase).toBe('carrying');
  });
});

describe('the beam is a speed, not a probability', () => {
  it('takes its step period from the stage’s difficulty row', () => {
    // Report section 7.7: parameter 6 is the beam's step period in frames, falling
    // from 12 to 3 across the ramp. Read from the row like every other
    // stage-varying number, and resolved by `src/content/rules.ts` alone.
    expect(resolveBeamStepFrames(resolveDifficultyRow(rules, 1))).toBe(12);
    expect(resolveBeamStepFrames(resolveDifficultyRow(rules, 20))).toBe(3);

    expect(armedWorld({ stage: 1 }).capture.stepFrames).toBe(12);
    expect(armedWorld({ stage: 20 }).capture.stepFrames).toBe(3);
  });

  it('extends four times faster on stage 20 than on stage 1', () => {
    // The player-visible consequence, and the reason a late capture is hard to
    // escape: the same number of animation steps, a quarter of the period.
    const framesToFullExtension = (stage: number): number => {
      const world = armedWorld({ stage, seed: `beam-${String(stage)}` });
      runToPhase(world, ['beam']);
      let frames = 0;
      while (world.capture.beamStep < rules.capture.beam.steps && frames < 1_000) {
        // Standing well clear, so the beam runs its animation out instead of
        // ending the moment it reaches the fighter.
        world.player.x = rules.player.minX;
        stepWorld(world, EMPTY_FRAME);
        frames += 1;
      }
      return frames;
    };
    const early = framesToFullExtension(1);
    const late = framesToFullExtension(20);
    expect(early).toBe(rules.capture.beam.steps * 12);
    expect(late).toBe(rules.capture.beam.steps * 3);
  });

  it('cannot take a fighter the beam has not reached yet', () => {
    const world = armedWorld();
    runToPhase(world, ['beam']);
    const beam = beamWindow(world.capture, rules);
    // One step in, the reach is a fraction of the full window's: a beam that has
    // not got down to the fighter's row cannot take it, which is the whole of why
    // an early, slow beam is escapable.
    expect(beam).toBeDefined();
    expect(beam?.dyMax).toBeLessThan(rules.capture.beam.catchWindow.dyMax);
  });
});

describe('exactly one captured fighter, ever', () => {
  it('attempts no capture at all while a fighter is held', () => {
    const world = heldWorld();
    // Long enough for several more captor launches: the flag, not a cooldown, is
    // what stops them (report acceptance test R3).
    const events = run(world, 3_000);
    expect(eventsOfType(events, 'capture-started')).toHaveLength(0);
    expect(world.capture.phase).not.toBe('idle');
  });

  it('attempts no capture while the fighter is parked as a rogue', () => {
    // The expert's technique: shoot the captor while it is in formation and the
    // captured fighter turns rogue — and capture stays off, because that boss is
    // no longer the channel's (report acceptance test R4).
    const world = heldWorld({ seed: 'rogue-parked' });
    runUntil(world, bothHome);
    const killed = shoot(world, captorOf(world));
    expect(eventsOfType(killed, 'captive-rogue')).toHaveLength(1);
    expect(world.capture.phase).toBe('rogue');

    const events = run(world, 3_000);
    expect(eventsOfType(events, 'capture-started')).toHaveLength(0);
  });

  it('never targets a dual fighter, and resumes once it loses a half', () => {
    const world = rescuedWorld();
    expect(world.player.mode).toBe('dual');
    expect(eventsOfType(run(world, 2_000), 'capture-started')).toHaveLength(0);

    // Losing a half is the last of the arcade's releases (report test R6).
    const events = hitPlayer(world);
    expect(eventsOfType(events, 'dual-half-lost')).toHaveLength(1);
    expect(world.player.mode).toBe('single');
    expect(world.capture.phase).toBe('idle');
  });

  it('never makes the first captor launch of a game a capture attempt', () => {
    // `everyNthLaunch` is 2 and the counter is pre-incremented, so capture is
    // reachable on the 2nd, 4th, 6th eligible launch and never the 1st (R8).
    const world = armedWorld({ seed: 'first-launch' });
    let firstCaptorLaunch = -1;
    for (let i = 0; i < 2_000 && world.capture.launches < 1; i += 1) {
      stepWorld(world, EMPTY_FRAME);
      if (world.capture.launches === 1 && firstCaptorLaunch < 0) firstCaptorLaunch = i;
    }
    expect(world.capture.launches).toBe(1);
    // One eligible launch has happened and it did not become an attempt.
    expect(world.capture.phase).toBe('idle');
  });
});

/** Are the captor and its captive both sitting in the formation? */
function bothHome(world: World): boolean {
  const captive = capturedFighter(world.capture, world.fleet);
  return captorOfCaptive(world.capture, world.fleet)?.state === 'home' && captive?.state === 'home';
}

/**
 * Are the captor and its captive both attacking?
 *
 * The manual's rescue condition, word for word: "destroy the boss while they are
 * **both attacking** your current fighter". `!== 'home'` is not the same test — a
 * captor rotating back into its slot has stopped attacking, and killing it then
 * creates a rogue instead.
 */
function bothAttacking(world: World): boolean {
  const captive = capturedFighter(world.capture, world.fleet);
  const captor = captorOfCaptive(world.capture, world.fleet);
  const attacking = captor?.state === 'diving' || captor?.state === 'beaming';
  return attacking && captive?.state === 'diving';
}

/** A world that has been captured and then rescued into a dual fighter. */
function rescuedWorld(options: { rules?: Rules } = {}): World {
  const world = heldWorld({ seed: 'rescue', ...options });
  // Wait for the captor to dive; a held fighter attacks *with* its captor, which is
  // what makes the manual's "while they are both attacking" condition reachable.
  runUntil(world, bothAttacking);
  const captor = captorOf(world);
  // Down to its last hit before the shot is taken. Not a shortcut: a rescue is a
  // *window* — the pair has to still be attacking when the captor dies — and a
  // Warden takes two hits, so a test that spent frames landing both would often
  // find the dive over and get a rogue instead. Which is the arcade behaviour, and
  // is what the rogue tests assert deliberately.
  captor.hitsRemaining = 1;
  shoot(world, captor);
  expect(world.capture.phase).toBe('docking');
  runToPhase(world, ['dual']);
  return world;
}

describe('every way the channel is released', () => {
  it('a new game starts idle, with no launches counted', () => {
    const world = createWorld({ rules, stages, seed: 'fresh' });
    expect(world.capture.phase).toBe('idle');
    expect(world.capture.launches).toBe(0);
  });

  it('the captor shot before the beam is out', () => {
    const world = armedWorld({ seed: 'shot-early' });
    runToPhase(world, ['diving']);
    const captor = world.fleet.enemies.find((enemy) => enemy.id === world.capture.captorId);
    expect(captor).toBeDefined();
    if (captor === undefined) return;

    const events = shoot(world, captor);
    expect(eventsOfType(events, 'capture-failed').length).toBeGreaterThan(0);
    expect(world.capture.phase).toBe('idle');
  });

  it('the captor shot while the beam is out', () => {
    const world = armedWorld({ seed: 'shot-beaming' });
    runToPhase(world, ['beam']);
    const captor = world.fleet.enemies.find((enemy) => enemy.id === world.capture.captorId);
    expect(captor?.state).toBe('beaming');
    if (captor === undefined) return;

    const events = shoot(world, captor);
    expect(eventsOfType(events, 'capture-failed').length).toBeGreaterThan(0);
    expect(world.capture.phase).toBe('idle');
  });

  it('the beam retracting without connecting, leaving the captor to fly on', () => {
    const world = armedWorld({ seed: 'retract' });
    runToPhase(world, ['beam']);
    const captor = world.fleet.enemies.find((enemy) => enemy.id === world.capture.captorId);
    if (captor === undefined) return;

    // Out of the beam's way. The window is ±16 px of the captor's column, so the
    // far edge of the playfield is safe whichever column it came from.
    world.player.x = captor.x > rules.playfield.width / 2 ? rules.player.minX : rules.player.maxX;
    const events = runToPhase(world, ['idle']);
    expect(eventsOfType(events, 'capture-failed').length).toBeGreaterThan(0);
    expect(eventsOfType(events, 'player-captured')).toHaveLength(0);
    // Its flight resumed from the frame it paused on rather than being thrown away.
    expect(['diving', 'returning', 'home', 'dead']).toContain(captor.state);
  });

  it('the captor shot mid-carry: too late to rescue, and the fighter is lost', () => {
    // Report acceptance test R10, and the arcade's own comment — "status may still
    // be $80 meaning I have killed the boss before he pulls the ship all in!"
    const world = armedWorld({ seed: 'too-late' });
    runToPhase(world, ['carrying']);
    const captor = world.fleet.enemies.find((enemy) => enemy.id === world.capture.captorId);
    if (captor === undefined) return;

    const events = shoot(world, captor);
    expect(eventsOfType(events, 'player-captured')).toHaveLength(1);
    expect(eventsOfType(events, 'fighter-rescued')).toHaveLength(0);
    expect(world.capture.phase).toBe('idle');
    expect(world.player.mode).toBe('single');
  });

  it('the captured fighter shot: beams resume', () => {
    const world = heldWorld({ seed: 'shoot-captive' });
    const captive = capturedFighter(world.capture, world.fleet);
    expect(captive).toBeDefined();
    if (captive === undefined) return;

    shoot(world, captive);
    expect(world.capture.phase).toBe('idle');
    // And attempts really do come back, which is the point of releasing it.
    expect(eventsOfType(run(world, 3_000), 'capture-started').length).toBeGreaterThan(0);
  });

  it('a dual fighter losing a half: covered above', () => {
    // The seventh release. Asserted in "never targets a dual fighter", which needs
    // the same state; repeating the setup here would double a slow test for nothing.
    expect(rules.dualFighter.losingHalfCostsLife).toBe(false);
  });
});

describe('the captured fighter', () => {
  it('scores 500 in formation and 1,000 attacking', () => {
    // Read off the kill's own event rather than the score, because a shot aimed at
    // one enemy over several frames can be consumed by another crossing it — and
    // what is being asserted is this target's value, not the run's total.
    const scoreFor = (events: SimEvent[], id: number): number | undefined =>
      eventsOfType(events, 'target-destroyed').find((event) => event.targetId === id)?.score;

    const standing = heldWorld({ seed: 'score-home' });
    const parked = capturedFighter(standing.capture, standing.fleet);
    expect(parked?.state).toBe('home');
    if (parked === undefined) return;
    expect(scoreFor(shoot(standing, parked), parked.id)).toBe(500);

    // The same ship, attacking: the ordinary doubling rule, on the same alien.
    const attacking = heldWorld({ seed: 'score-diving' });
    runUntil(attacking, (live) => capturedFighter(live.capture, live.fleet)?.state === 'diving');
    const diving = capturedFighter(attacking.capture, attacking.fleet);
    if (diving === undefined) return;
    expect(scoreFor(shoot(attacking, diving), diving.id)).toBe(1_000);
  });

  it('turns rogue when its captor dies in formation, then swoops once and leaves', () => {
    const world = heldWorld({ seed: 'rogue-swoop' });
    runUntil(world, bothHome);
    shoot(world, captorOf(world));
    expect(world.capture.phase).toBe('rogue');

    // It waits in its slot — which is what makes parking one a technique — and then
    // takes exactly one dive.
    const captive = capturedFighter(world.capture, world.fleet);
    expect(captive?.state).toBe('home');
    runUntil(world, (live) => capturedFighter(live.capture, live.fleet)?.state === 'diving');
    expect(world.capture.rogueDived).toBe(true);
    // And it does not come back during this stage.
    expect(captive?.returnsFromDive).toBe(false);
    runUntil(world, (live) => capturedFighter(live.capture, live.fleet) === undefined);
    expect(world.capture.phase).toBe('rogue');
  });

  it('re-enters as the last ship of the next stage’s wave, and never blocks a stage end', () => {
    const world = heldWorld({ seed: 'restage' });
    const captiveSlot = world.capture.captiveSlot;

    // Clear the fleet but not the captured fighter. A stage holding nothing but
    // your own stolen ship still ends: it is not something to clear.
    for (const enemy of world.fleet.enemies) {
      if (!enemy.inCaptiveSlot) enemy.state = 'dead';
    }
    const stage = world.stage;
    const events = run(world, 2);
    expect(eventsOfType(events, 'stage-cleared')).toHaveLength(1);
    expect(world.stage).toBe(stage + 1);

    // It comes back with the new stage's wave, last, and homes to the same slot.
    const captive = capturedFighter(world.capture, world.fleet);
    expect(captive?.state).toBe('standby');
    expect(captive?.home).toBe(captiveSlot);
    const others = world.fleet.enemies.filter((enemy) => !enemy.inCaptiveSlot);
    expect(captive?.launchFrame).toBeGreaterThan(
      Math.max(...others.map((enemy) => enemy.launchFrame)),
    );
    runUntil(world, (live) => capturedFighter(live.capture, live.fleet)?.state === 'home', {
      limit: 3_000,
    });
    expect(capturedFighter(world.capture, world.fleet)?.home).toBe(captiveSlot);
  });
});

describe('rescue and the dual fighter', () => {
  it('frees the fighter when its captor dies with both of them attacking', () => {
    const world = heldWorld({ seed: 'rescue-pair' });
    runUntil(world, bothAttacking);
    const captor = captorOf(world);
    captor.hitsRemaining = 1;

    const events = shoot(world, captor);
    expect(eventsOfType(events, 'fighter-rescued')).toHaveLength(1);
    expect(eventsOfType(events, 'captive-rogue')).toHaveLength(0);
    expect(world.capture.phase).toBe('docking');
    // Invulnerable while it spins: it is no longer a target at all.
    expect(capturedFighter(world.capture, world.fleet)).toBeUndefined();
    expect(world.capture.freedAt).toBeDefined();

    const docked = runToPhase(world, ['dual']);
    expect(eventsOfType(docked, 'fighter-docked')).toHaveLength(1);
    expect(world.player.mode).toBe('dual');
  });

  it('recalls enemies already mid-dive to the formation', () => {
    const world = heldWorld({ seed: 'recall' });
    runUntil(world, bothAttacking);
    const captor = captorOf(world);
    captor.hitsRemaining = 1;
    const diving = world.fleet.enemies.filter(
      (enemy) => enemy.state === 'diving' && !enemy.inCaptiveSlot,
    );
    shoot(world, captor);
    expect(world.capture.phase).toBe('docking');
    // Everything that was attacking turns round where it is, flying the one homing
    // path rather than leaving the screen and coming back.
    for (const enemy of diving) {
      if (enemy.state === 'dead') continue;
      expect(enemy.state).toBe('returning');
    }
  });

  it('keeps two logical shots, each a two-bullet spread with a dead gap', () => {
    // Milestone 1 built the cap and the windows for this: the dual fighter is a
    // fighter mode, not a second shot pool (report acceptance test R2).
    expect(rules.player.maxShots).toBe(2);
    const dual = shotWindowsFor(rules, 'dual');
    expect(dual).toHaveLength(2);
    expect(windowGapsX(dual)).toEqual([[5, 8]]);

    // And the gap is real, not an artefact of how the windows are written: a target
    // 6 px to the right of the anchor is between the two bullets and is missed,
    // while 4 px and 9 px are hit. No box intersection can express that.
    const shot = { x: 100, y: 100 };
    expect(hitsAny(shot, { x: 104, y: 100 }, dual)).toBe(true);
    expect(hitsAny(shot, { x: 106, y: 100 }, dual)).toBe(false);
    expect(hitsAny(shot, { x: 109, y: 100 }, dual)).toBe(true);
  });

  it('fires one shot per slot as a dual fighter, not two', () => {
    const world = rescuedWorld();
    world.player.alive = true;
    const events = run(world, 2, FIRE);
    // Two slots, so at most two `shot-fired` in two frames however many bullets
    // each draws.
    expect(eventsOfType(events, 'shot-fired').length).toBeLessThanOrEqual(2);
    for (const shot of world.shots) {
      if (shot.active) expect(shot.windows).toHaveLength(2);
    }
  });

  it('leaves the reserve alone when a half is lost, and moves the survivor over', () => {
    const world = rescuedWorld();
    const reserve = world.lives.reserve;
    const anchor = world.player.x;
    hitPlayer(world, 0);

    expect(world.player.mode).toBe('single');
    expect(world.lives.reserve).toBe(reserve);
    expect(world.player.alive).toBe(true);
    // The left ship was hit, so the right one — drawn at the offset — becomes the
    // fighter.
    expect(world.player.x).toBe(anchor + rules.player.secondShipOffsetX);
  });
});

describe('a challenge stage has no capture at all', () => {
  /**
   * Nothing settles into formation on a challenge stage and nothing attacks
   * there, so the capture channel must be as inert as the attack director is.
   * Two halves, and only the first is covered by the director's own gate:
   *
   * - no captor may be *chosen*, which `stepAttacks` already refuses; and
   * - a fighter already held must not be **put on the field** and must not
   *   swoop, which is the channel's own business because a captured fighter is
   *   the one attacker the director never launches.
   *
   * The second half was a real leak found on this rebase: a held fighter joined
   * the challenge stage's entry wave and, as a rogue, dived at the player in the
   * middle of a stage whose whole point is that nothing does.
   */
  const CHALLENGE = 3;

  it('is a challenge stage to begin with, so the rest of this means something', () => {
    expect(isChallengeStage(rules, CHALLENGE)).toBe(true);
    expect(classicStages().stageFor(CHALLENGE)?.stage.kind).toBe('challenge');
  });

  it('never selects a captor', () => {
    const world = armedWorld({ stage: CHALLENGE });
    const events = run(world, 4_000, FIRE);
    expect(eventsOfType(events, 'capture-started')).toHaveLength(0);
    expect(world.capture.phase).toBe('idle');
    expect(world.capture.launches).toBe(0);
  });

  it('does not bring a held fighter onto the field, and brings it back after', () => {
    const world = heldWorld({ stage: 2, seed: 'challenge-crossing' });
    const slot = world.capture.captiveSlot;
    expect(slot).toBeDefined();

    // Clear the fleet so the stage ends and stage 3 — a challenge stage — begins.
    clearFleet(world);
    run(world, 2);
    expect(world.stage).toBe(CHALLENGE);

    // Still held, and nothing of it on screen.
    expect(world.capture.phase).toBe('held');
    expect(world.capture.captiveSlot).toBe(slot);
    expect(world.fleet.enemies.some((enemy) => enemy.inCaptiveSlot)).toBe(false);
    // And `captiveId` is not left pointing at a number some challenge flyer now
    // answers to — shooting one would otherwise release the channel.
    expect(capturedFighter(world.capture, world.fleet)).toBeUndefined();

    // Nothing dives for the whole of the challenge stage, and nothing of the
    // captured fighter is on the field at any point in it. The loop ends at the
    // stage boundary, because the stage ends on its own and the next one is
    // allowed to attack again.
    let everOnField = false;
    const onChallenge = runOnStage(world, CHALLENGE, 6_000, FIRE, (live) => {
      if (live.fleet.enemies.some((enemy) => enemy.inCaptiveSlot)) everOnField = true;
    });
    expect(eventsOfType(onChallenge, 'enemy-dived')).toHaveLength(0);
    expect(everOnField).toBe(false);

    // The next stage has a formation to come back to, so it comes back.
    expect(world.stage).toBe(CHALLENGE + 1);
    expect(isChallengeStage(rules, world.stage)).toBe(false);
    const captive = capturedFighter(world.capture, world.fleet);
    expect(captive?.inCaptiveSlot).toBe(true);
    expect(captive?.home).toBe(slot);
  });

  it('does not let a rogue swoop on one', () => {
    const world = heldWorld({ stage: 2, seed: 'challenge-rogue' });
    runUntil(world, bothHome);
    shoot(world, captorOf(world));
    expect(world.capture.phase).toBe('rogue');

    clearFleet(world);
    run(world, 2);
    expect(world.stage).toBe(CHALLENGE);
    // A rogue takes one dive per stage — but not on this one.
    const events = runOnStage(world, CHALLENGE, 6_000, FIRE);
    expect(eventsOfType(events, 'enemy-dived')).toHaveLength(0);
    expect(world.capture.rogueDived).toBe(false);
    expect(world.capture.phase).toBe('rogue');
  });
});

describe('capture as a loss condition', () => {
  it('ends the game when it takes the last fighter', () => {
    // Report acceptance test R7, and the manual: "when the enemy destroys **or
    // captures** your last fighter, the words GAME OVER are displayed". A loss
    // condition the design plan originally missed.
    const world = armedWorld({ rules: lastFighter(), seed: 'last' });
    expect(world.lives.reserve).toBe(0);
    const events = runUntil(world, (live) => live.status === 'game-over');

    expect(eventsOfType(events, 'player-captured')).toHaveLength(1);
    expect(eventsOfType(events, 'game-over')).toHaveLength(1);
    expect(world.status).toBe('game-over');
    // And the world does nothing at all afterwards.
    expect(run(world, 60)).toHaveLength(0);
  });

  it('reaches game over on the same step, so the front end cannot miss it', () => {
    // The two events are raised together and in that order, which is what lets
    // `src/ui/flow.ts` take its game-over branch on the step the beam lands. The
    // flow's six phases now include a between-stage card that also fires off a
    // sim event, and game over has to win — `tests/unit/flow.test.ts` asserts the
    // front-end half; this is the sim's side of the contract.
    const world = armedWorld({ rules: lastFighter(), seed: 'same-step' });
    const events = runUntil(world, (live) => live.status === 'game-over');
    const captured = events.findIndex((event) => event.type === 'player-captured');
    const over = events.findIndex((event) => event.type === 'game-over');
    expect(captured).toBeGreaterThanOrEqual(0);
    expect(over).toBe(captured + 1);
  });

  it('is a different event from being shot, so a subscriber can tell them apart', () => {
    const world = armedWorld({ rules: lastFighter(), seed: 'distinct' });
    const events = runUntil(world, (live) => live.status === 'game-over');
    expect(eventsOfType(events, 'player-hit')).toHaveLength(0);
    const captured = eventsOfType(events, 'player-captured')[0];
    expect(captured?.livesRemaining).toBe(0);
  });
});

/**
 * Bodies and the channel — the three ships the capture mechanic puts in unusual
 * states, against `resolveBodyCollisions` in `src/sim/world.ts`.
 *
 * Every test here runs on {@link solidFleet}: the bombs are off so nothing else can
 * take a fighter, and `enemies.collision` is exactly as the pack ships it. A parked
 * diver stands in for the ram where the encounter would otherwise have to be flown —
 * an enemy in `diving` with no compiled flight stays where it is put — and where the
 * thing doing the ramming is the captive itself, the *fighter* is moved onto it,
 * because the captive is flying a real path and must keep flying it.
 */
describe('enemy bodies and the capture channel', () => {
  /** Park a solid diver on one of the fighter's ships and step a frame. */
  function ram(world: World, shipIndex = 0): SimEvent[] {
    const anchorX = world.player.x + shipIndex * world.rules.player.secondShipOffsetX;
    const captive = capturedFighter(world.capture, world.fleet);
    const alien = captive?.alienId ?? 'drone';
    const enemy = world.fleet.enemies.find((candidate) => candidate.alienId === alien);
    expect(enemy, 'the fleet should have an enemy to copy').toBeDefined();
    if (enemy === undefined) return [];
    world.fleet.enemies.push({
      ...enemy,
      id: 9_000 + world.fleet.enemies.length,
      state: 'diving',
      inCaptiveSlot: false,
      x: anchorX,
      y: world.player.y,
    });
    return run(world, 1);
  }

  /**
   * Fly the fighter onto `enemy`, which is the only way to ram one that is moving.
   *
   * Waits for a fighter to be on the field first, and it is not a formality: with
   * the bodies live, a fighter parked at the centre of the screen while a test waits
   * for a captive to do something gets rammed by the rest of the fleet in the
   * meantime, and a ram against an empty row proves nothing.
   */
  function flyInto(world: World, enemy: Enemy): SimEvent[] {
    runUntil(world, (live) => live.player.alive);
    world.player.x = Math.round(enemy.x);
    world.player.y = Math.round(enemy.y);
    // And that `enemy` is the only thing in reach, so the hit below is the
    // captured ship's and not some other diver's that happened to be passing.
    const reachable = world.fleet.enemies.filter(
      (candidate) =>
        candidate !== enemy &&
        isTargetable(candidate) &&
        hitsAny(world.player, candidate, [world.rules.player.hitWindow], candidate.hitPadding),
    );
    expect(reachable.map((candidate) => candidate.id)).toEqual([]);
    return run(world, 1);
  }

  it('still lets a beam connect, with the captor that carries it solid', () => {
    // The thing a pack author would most reasonably fear about this change: a
    // captor has to descend towards the fighter to open its beam, so if its body
    // arrived first no capture could ever complete. It does not — the catch window
    // starts 16 px below the captor and the fighter's is ±6 — and this is the test
    // that says so on the shipped numbers rather than by reading them.
    const world = armedWorld({ rules: solidFleet(), seed: 'solid-capture' });
    const events = runToPhase(world, ['held']);
    expect(eventsOfType(events, 'capture-started').length).toBeGreaterThan(0);
    expect(eventsOfType(events, 'player-captured')).toHaveLength(1);
    expect(world.capture.phase).toBe('held');
  });

  it('cannot touch the fighter while the beam is dragging it', () => {
    // Already lost to the beam: killing it here would swallow the capture and
    // leave the channel holding a ship the run never paid for. The same guard the
    // bullets are behind.
    const world = armedWorld({ rules: solidFleet(), seed: 'solid-carry' });
    runToPhase(world, ['carrying']);
    const events = ram(world);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(0);
    expect(world.capture.phase).toBe('carrying');
    // And the capture still finishes, so nothing was merely deferred.
    runToPhase(world, ['held']);
    expect(world.capture.phase).toBe('held');
  });

  it('kills the fighter with its own captured ship, escorting its captor', () => {
    // A captured fighter is an enemy in every other respect — it dives, it bombs
    // nobody, it can be shot for 500 or 1,000 — so it is an enemy in this respect
    // too. Exempting it would be a special case nothing in the reference asks for,
    // and it would make the captive the one safe thing on the screen.
    const world = heldWorld({ rules: solidFleet(), seed: 'solid-escort' });
    runUntil(world, bothAttacking);
    const captive = capturedFighter(world.capture, world.fleet);
    expect(captive?.state).toBe('diving');
    expect(captive?.inCaptiveSlot).toBe(true);
    if (captive === undefined) return;

    runUntil(world, (live) => live.player.alive);
    const before = world.lives.reserve;
    const events = flyInto(world, captive);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(1);
    expect(world.lives.reserve).toBe(before - 1);
    // It is still held: being killed by it releases nothing, and no second beam
    // may appear.
    expect(world.capture.phase).toBe('held');
  });

  it('kills the fighter with a rogue on its one dive', () => {
    const world = heldWorld({ rules: solidFleet(), seed: 'solid-rogue' });
    runUntil(world, bothHome);
    expect(eventsOfType(shoot(world, captorOf(world)), 'captive-rogue')).toHaveLength(1);
    expect(world.capture.phase).toBe('rogue');

    // The rogue sits in its slot for `rogueDelayFrames` and then swoops once.
    const rogue = capturedFighter(world.capture, world.fleet);
    expect(rogue).toBeDefined();
    if (rogue === undefined) return;
    runUntil(world, () => rogue.state === 'diving');

    runUntil(world, (live) => live.player.alive);
    const before = world.lives.reserve;
    const events = flyInto(world, rogue);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(1);
    expect(world.lives.reserve).toBe(before - 1);
    expect(world.capture.phase).toBe('rogue');
  });

  it('costs a dual fighter only the half that was flown into', () => {
    // The same rule the bullets follow, and the reference's own words about the
    // fighter's geometry: "collision detection is run once per ship sprite". So
    // the survivor plays on, the reserve is untouched, and losing the half
    // releases the channel.
    const world = rescuedWorld({ rules: solidFleet() });
    expect(world.player.mode).toBe('dual');
    const before = world.lives.reserve;

    const events = ram(world, 1);
    expect(eventsOfType(events, 'dual-half-lost')).toHaveLength(1);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(0);
    expect(world.player.mode).toBe('single');
    expect(world.lives.reserve).toBe(before);
    expect(world.capture.phase).toBe('idle');
  });
});
