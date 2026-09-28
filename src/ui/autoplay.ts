/**
 * Autoplay: the cabinet playing itself, as a persona.
 *
 * Attract mode (`./attract.ts`) is the real simulation driven by a **recorded
 * input log**, which is the right shape for a demo and the wrong shape for a
 * persona: a recording cannot adapt to a game that fights back differently, so
 * "beginner" and "astronaut" would be two recordings of two different runs rather
 * than two ways of playing one. The pilots in `scripts/record-replay.ts` are the
 * right shape — something that reads the world and decides — and this is that,
 * made into data and given a way in.
 *
 * Four rules hold this file, and each one is asserted in
 * `tests/unit/autoplay.test.ts` rather than trusted:
 *
 * 1. **A persona plays; it does not cheat.** The pilot is handed a
 *    {@link PilotView} — a freshly built plain value holding *what is on the
 *    screen* — and never the {@link World}. It cannot read the difficulty row, a
 *    bomb timer, a launch frame, the RNG or anything else a player cannot see, and
 *    it cannot write anything at all: {@link viewOfWorld} copies numbers out, so
 *    there is no reference for the pilot to reach back through. What it returns is
 *    one {@link InputFrame} carrying the same three bits a human's keyboard
 *    carries.
 * 2. **The engine has no `if persona === …` in it.** Every {@link Persona} field
 *    is read by name and interpreted identically for every persona. Nothing in
 *    this file names one, and adding a fifth is adding a row of JSON to a variant
 *    document.
 * 3. **Determinism survives.** No wall clock and no `Math.random`: the only clock
 *    is {@link PilotView.step}, which is the simulation's own step count, and the
 *    only source of chance is a seeded {@link Rng}. Same seed and same persona
 *    means the same run, which `tests/unit/autoplay.test.ts` proves by playing one
 *    twice. `eslint.config.js` puts this file under the same `Math.random` and
 *    host-global bans `src/sim/` and `src/engine/` are under, so the rule is
 *    mechanical.
 * 4. **The pilot's own RNG is not the world's.** It draws from its own stream, so
 *    how much a persona dithers cannot change what the simulation computes — a
 *    pilot that drew from `world.rng` would make the fleet's behaviour depend on
 *    who was flying.
 *
 * The one thing it does *not* do is start a game or clear a screen. That is the
 * flow's, because those are phases and phases are `./flow.ts`'s alone.
 */

import type { Persona } from '../content/personas.js';
import { maxXFor } from '../content/rules.js';
import { type Action, EMPTY_FRAME, frameOf, type InputFrame } from '../engine/input.js';
import { createRng, type Rng } from '../engine/rng.js';
import { beamCaptor, beamWindow } from '../sim/capture.js';
import type { World } from '../sim/world.js';

/* -------------------------------------------------------------------------- */
/* What a player can see                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One thing on the screen with a sprite on it.
 *
 * `x` and `y` are the sprite anchor, which is the coordinate system every window
 * in the simulation is measured in (`src/sim/collision.ts`), so an anchor
 * difference is directly comparable with the ±5 px the fighter's shot window is
 * wide. The two flags are the two things a watcher can tell apart at a glance: is
 * it coming down at me, and is it my own stolen ship.
 *
 * The `id` is not a secret. It is "this is the same sprite I was looking at last
 * frame", which is what eyes do for free, and it is what lets the pilot *derive* a
 * diver's descent rate from two views instead of being handed a velocity.
 */
export interface Sighting {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /**
   * Off its slot and in the air rather than sitting in the block.
   *
   * `entering` counts, and that is not a detail: `enemies.collision` is on, so an
   * enemy flying its entry path will take a fighter that walks into it just as a
   * diver will. A pilot that only watched the divers chased the entry file
   * straight into it and lost every ship before the formation had even settled.
   */
  readonly flying: boolean;
  /** The player's captured fighter, which the renderer draws as a fighter. */
  readonly captured: boolean;
}

/** A bomb in the air. Its velocity is what two frames of watching it gives you. */
export interface Incoming {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** The fighter, or the pair of them. */
export interface FighterSighting {
  readonly x: number;
  readonly y: number;
  readonly dual: boolean;
}

/**
 * Everything the pilot may know, and nothing else.
 *
 * Deliberately a flat bag of numbers rather than a narrowed view *of* the world:
 * a view holding a `World` behind an interface is a view a cast can get through,
 * and the property this shape exists to guarantee is that there is nothing to get
 * through to.
 */
export interface PilotView {
  /** The simulation's step count. The only clock a pilot has. */
  readonly step: number;
  /** The fighter, or `undefined` while it is off the field after a hit. */
  readonly fighter: FighterSighting | undefined;
  /** The walls, which a player finds by hitting them. */
  readonly minX: number;
  readonly maxX: number;
  /** Rocket slots not currently in flight. The player's cap is two, not eight. */
  readonly shotsFree: number;
  /**
   * How close something has to get to take the fighter, across and up.
   *
   * The fighter's own hit window, which is the size of the player's own ship —
   * something a player learns in one life and can see on the screen in front of
   * them. It is here because without it a persona's clearance would have to *be*
   * the vulnerable band, and then a persona that noticed less would also be in
   * danger less: blindness came out calm, and calm came out safe. The real band is
   * the game's, the clearance a persona keeps on top of it is the persona's.
   */
  readonly strikeDepth: number;
  readonly strikeWidth: number;
  /**
   * How fast the fighter's own rockets climb, in pixels per step.
   *
   * Here for the same reason as the two above: it is a property of the player's own
   * ship, plainly visible in every shot they have ever fired, and without it the
   * pilot cannot **lead** a moving target. A rocket takes about thirty steps to
   * reach the formation, and a diver crossing at two pixels a step is sixty pixels
   * from where it was aimed by the time the rocket arrives — so a pilot that fires
   * at where something *is* misses almost everything that moves, and `aimTolerance`
   * stops being a competence axis at all.
   */
  readonly shotSpeed: number;
  readonly bombs: readonly Incoming[];
  /** Everything the renderer draws of the fleet, by the renderer's own test. */
  readonly enemies: readonly Sighting[];
  /** The tractor beam, as the column the renderer paints, or `undefined`. */
  readonly beam: { readonly x: number; readonly y: number } | undefined;
}

/**
 * Project a world onto what is on the screen.
 *
 * Every number is copied, so the value handed on shares no object with the world
 * and the pilot has nothing to mutate. That costs one small allocation per
 * enemy per step, which is the price of the boundary and is the reason the
 * boundary is checkable at all.
 *
 * The visibility test is the renderer's own — `standby` has not launched and
 * `dead` is off the field, so neither is drawn (`src/render/scene.ts`) — because
 * a pilot that could see an enemy nobody has drawn yet would be reading the
 * stage script.
 */
export function viewOfWorld(world: World): PilotView {
  const { player, rules } = world;

  const enemies: Sighting[] = [];
  for (const enemy of world.fleet.enemies) {
    if (enemy.state === 'standby' || enemy.state === 'dead') continue;
    enemies.push({
      id: enemy.id,
      x: enemy.x,
      y: enemy.y,
      flying: enemy.state !== 'home',
      captured: enemy.inCaptiveSlot,
    });
  }

  const bombs: Incoming[] = [];
  for (const bullet of world.enemyBullets) {
    if (!bullet.active) continue;
    bombs.push({ x: bullet.x, y: bullet.y, vx: bullet.vx, vy: bullet.vy });
  }

  let shotsFree = 0;
  for (const shot of world.shots) if (!shot.active) shotsFree += 1;

  // The beam is drawn from exactly these two values (`src/render/scene.ts`), so
  // this is the shape on screen rather than a second reading of the channel.
  const beamShape = beamWindow(world.capture, rules);
  const captor = beamCaptor(world.capture, world.fleet);
  const beam =
    beamShape === undefined || captor === undefined
      ? undefined
      : { x: captor.x + (beamShape.dxMin + beamShape.dxMax) / 2, y: captor.y + beamShape.dyMax };

  return {
    step: world.step,
    fighter: player.alive ? { x: player.x, y: player.y, dual: player.mode === 'dual' } : undefined,
    minX: rules.player.minX,
    maxX: maxXFor(rules, player.mode),
    shotsFree,
    strikeDepth: rules.player.hitWindow.dyMax,
    strikeWidth: rules.player.hitWindow.dxMax,
    shotSpeed: rules.player.shot.speed,
    bombs,
    enemies,
    beam,
  };
}

/* -------------------------------------------------------------------------- */
/* The pilot                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A pilot: one view in, one input frame out.
 *
 * Not an `InputSource`, on purpose — an `InputSource.sample()` takes nothing, so a
 * pilot shaped like one would have to close over something to look at, and the
 * thing it closed over would be the world. Taking the view as an argument is what
 * makes the no-cheating rule a type rather than a promise.
 */
export interface Pilot {
  readonly persona: Persona;
  /** The frame for the step about to run. Called exactly once per step. */
  sample: (view: PilotView) => InputFrame;
}

export interface PilotOptions {
  readonly persona: Persona;
  /** Seed for the pilot's own generator. Never the world's. */
  readonly seed: number | string;
}

/* -------------------------------------------------------------------------- */
/* Threats                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Something on its way that could take the fighter, reduced to the two questions
 * a pilot actually has to answer: **when could it reach my row, and where would it
 * be while it is there.**
 *
 * The second question is why this is a swept interval in time rather than a
 * single column. A bomb falls straight and crosses the fighter's row once, so for
 * a bomb the two readings agree. An **entry path does not**: it dips to within a
 * few pixels of the fighter's own row and then sweeps sideways along it before
 * climbing back to its slot, so at the bottom of that arc the enemy is level with
 * the fighter and *no longer descending*. Asked "when will you cross my row" it
 * answers "never", and a pilot that believes it stands still while the file sweeps
 * through. That was a real bug and it cost every careful persona its whole run:
 * expert and astronaut were rammed three times each, before a single bomb had been
 * dropped, by something they had classified as no threat at all.
 */
interface Threat {
  /** Sighting id for a body; negative and distinct for a bomb or a beam. */
  readonly id: number;
  /** Where it is now, in fighter-anchor coordinates. */
  readonly x: number;
  /** Pixels of altitude between it and the fighter's row, never below zero. */
  readonly above: number;
  /** Sideways pixels per step, as measured over two views. */
  readonly drift: number;
  /** Downward pixels per step, likewise. Zero or negative for something level. */
  readonly descent: number;
  /**
   * First step at which it could strike a fighter standing where it is now, at
   * this persona's full clearance. Drives urgency and the engagement bail-out.
   */
  readonly from: number;
  /** The column to stand in to hit it: where a rocket fired now would meet it. */
  readonly column: number;
  /** True for something a rocket can destroy; a bomb cannot be shot down. */
  readonly shootable: boolean;
}

/**
 * How far apart a captor and the captive flying beside it may be, in pixels, for
 * the pilot to read them as the escorted pair the manual's rescue condition
 * describes.
 *
 * Generous — the pair is two 16-px sprites side by side — and it only ever selects
 * *which* diver to aim at among divers already on the screen, so it changes no
 * outcome a player could not reach by eye.
 */
const ESCORT_SPAN = 40;

/** Steps of a panic reversal, drawn from the pilot's own generator. */
const PANIC_MIN_STEPS = 6;
const PANIC_MAX_STEPS = 18;

/** The one threat that is neither a sighting nor a bomb: an open tractor beam. */
const BEAM_THREAT_ID = -1_000;

/**
 * Pixels between the columns the pilot considers standing in.
 *
 * Two, because the fighter's own cadence alternates 1 px and 2 px steps
 * (`src/sim/player.ts`), so a finer grid would offer columns it cannot tell apart.
 * About a hundred candidates across the playfield, which is a few hundred
 * closed-form interval tests a frame and nothing at 60 Hz.
 */
const COLUMN_STEP = 2;

/**
 * The steps at which `start + rate * t` is within `margin` of `target`.
 *
 * One solver for both axes, because "when is it at my altitude" and "when is it
 * over this column" are the same question asked of the same straight line. A rate
 * of zero is the degenerate case and the honest answer is "always, or never".
 * Returns `undefined` for never.
 */
function windowOfApproach(
  start: number,
  rate: number,
  target: number,
  margin: number,
): { readonly from: number; readonly until: number } | undefined {
  if (rate === 0) {
    if (Math.abs(target - start) > margin) return undefined;
    return { from: 0, until: Number.POSITIVE_INFINITY };
  }
  const a = (target - margin - start) / rate;
  const b = (target + margin - start) / rate;
  const from = Math.max(0, Math.min(a, b));
  const until = Math.max(a, b);
  if (until < 0) return undefined;
  return { from, until };
}

/* -------------------------------------------------------------------------- */
/* The pilot                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Build a pilot.
 *
 * The state it keeps is the three things that make a persona read as a player
 * rather than as a controller: the views it has not reacted to yet, the engagement
 * it has committed to, and the panic it is in the middle of.
 */
export function createAutopilot(options: PilotOptions): Pilot {
  const { persona } = options;
  const rng: Rng = createRng(options.seed);

  /**
   * The last `reactionSteps + 2` views, oldest first.
   *
   * The pilot decides from `history[1]`, which is the view `reactionSteps` steps
   * ago — the whole of the reaction axis: a persona with 20 here is steering by
   * where things were a third of a second ago, including its own dodges.
   * `history[0]` is the step before that, and exists because how a thing is
   * *moving* is derived from two frames rather than handed over. Two entries deep
   * at `reactionSteps` 0, so the astronaut reacts to the current frame and still
   * has a previous one to measure against.
   */
  const history: PilotView[] = [];
  const depth = persona.reactionSteps + 2;

  /**
   * Steps of warning this persona needs to get out of the way.
   *
   * Its own reaction delay back, plus one step per pixel of the clearance it
   * wants — one step per pixel being the fighter's **slowest** cadence
   * (`src/sim/player.ts` alternates 1 px and 2 px) and therefore the safe
   * assumption. This one quantity is the whole boundary between "that is a hazard
   * I must move for" and "that is a target I still have time to shoot", so it is
   * derived from the persona rather than tuned.
   */
  const warning = persona.reactionSteps + persona.dodgeMargin;

  /**
   * The altitude band inside which something can strike, at a given clearance.
   *
   * The fighter's own vulnerable depth plus whatever room the pilot is asking for.
   * A function of the *clearance* rather than of the persona because
   * {@link bestColumn} asks the question twice — once at the clearance this persona
   * would like, and once at none at all.
   */
  const band = (seen: PilotView, margin: number): number => seen.strikeDepth + margin;

  /** The threat this pilot has decided to shoot at rather than leave alone. */
  let engagedId: number | undefined;
  /** The threat the engagement decision was last made about. */
  let decidedAbout: number | undefined;

  let panicSteps = 0;
  let panicDirection: -1 | 1 = 1;
  /**
   * Which pressing threat the last panic and discipline decisions were made about.
   *
   * **Per threat, not per step**, and that distinction is not a detail: rolled every
   * frame, a 0.15 chance of panic is a pilot panicking within seven frames of
   * anything appearing — so "normal" dithered continuously and scored *below*
   * "beginner", which is the wrong way round and was the last thing wrong with these
   * four. A habit is something a player brings to a situation once.
   */
  let reactedTo: number | undefined;
  let panicking = false;
  let holdingBack = false;

  /** Where each sighting was one step earlier, so drift is a lookup not a search. */
  let wasAt: Map<number, Sighting> = new Map();

  /** How a sighting is moving, from the two views the pilot has. */
  const driftOf = (now: Sighting): { readonly dx: number; readonly dy: number } => {
    const then = wasAt.get(now.id);
    if (then === undefined) return { dx: 0, dy: 0 };
    return { dx: now.x - then.x, dy: now.y - then.y };
  };

  /**
   * The column to stand in for a rocket fired now to meet this sighting.
   *
   * Flight time is the altitude over the rocket's own speed, and the target is led
   * by its measured sideways drift over that time. This is the whole of the pilot's
   * marksmanship, and it is what `aimTolerance` is a tolerance *on*: without it the
   * number would measure how sloppily the pilot fires at a stale position, and
   * tightening it would make a persona worse rather than better.
   */
  const interceptOf = (seen: PilotView, fighter: FighterSighting, target: Sighting): number => {
    const above = Math.max(0, fighter.y - target.y);
    const flight = seen.shotSpeed > 0 ? above / seen.shotSpeed : 0;
    return target.x + driftOf(target).dx * flight;
  };

  /**
   * One threat from a thing's position now and how it is moving.
   *
   * `dodgeMargin` is the clearance this persona keeps, **on top of the fighter's
   * own vulnerable band** and in both axes: the altitude at which it starts calling
   * something a threat, and the sideways room it wants outside whatever that thing
   * sweeps. The band itself is {@link PilotView.strikeDepth} and belongs to the
   * game — see the note there for why the two must not be the same number.
   */
  const threatOf = (
    seen: PilotView,
    id: number,
    above: number,
    x: number,
    dx: number,
    dy: number,
    shootable: boolean,
    aim?: { readonly column: number },
  ): Threat => {
    const strike = windowOfApproach(Math.max(0, above), -dy, 0, band(seen, persona.dodgeMargin));
    return {
      id,
      x,
      above: Math.max(0, above),
      drift: dx,
      descent: dy,
      from: strike?.from ?? Number.POSITIVE_INFINITY,
      column: aim?.column ?? x,
      shootable,
    };
  };

  /** Everything inside this persona's horizon that could reach the fighter's row. */
  const threatsFor = (seen: PilotView): Threat[] => {
    const fighter = seen.fighter;
    if (fighter === undefined) return [];
    const out: Threat[] = [];

    seen.bombs.forEach((bomb, index) => {
      const above = fighter.y - bomb.y;
      // A bomb only ever falls, so one that is past the fighter's row has missed.
      if (above < 0 || above > persona.threatHorizon) return;
      // Negative so a bomb's id can never collide with a sighting's.
      out.push(threatOf(seen, -1 - index, above, bomb.x, bomb.vx, bomb.vy, false));
    });

    // A flying enemy is both the thing that will kill you and the thing worth
    // double for killing, which is why `engage` is an axis at all.
    for (const enemy of seen.enemies) {
      if (!enemy.flying) continue;
      const above = fighter.y - enemy.y;
      if (above > persona.threatHorizon) continue;
      const drift = driftOf(enemy);
      out.push(
        threatOf(seen, enemy.id, above, enemy.x, drift.dx, drift.dy, true, {
          column: interceptOf(seen, fighter, enemy),
        }),
      );
    }

    // A tractor beam, for a persona that will not take the risk. One that will
    // walks into it instead, below.
    const beam = seen.beam;
    if (!persona.rescue && beam !== undefined) {
      const above = fighter.y - beam.y;
      if (above <= persona.threatHorizon) {
        out.push(threatOf(seen, BEAM_THREAT_ID, above, beam.x, 0, 0, false));
      }
    }

    // Anything that never reaches striking altitude at all is not a threat, and
    // dropping it here rather than downstream matters twice: it keeps a thing that
    // will never arrive from being picked as the one to engage, and it keeps
    // `Infinity - Infinity` out of the comparator below, which is a NaN and an
    // inconsistent sort.
    return out.filter((threat) => Number.isFinite(threat.from)).sort((a, b) => a.from - b.from);
  };

  /**
   * The flyer this persona would go out of its way to shoot: the lowest thing in the
   * air, within the altitude it notices things at.
   *
   * A moving target is worth double (`resolveMovingMultiplier`), and a flyer left
   * alone becomes the thing that kills you, so going under one is what a great pilot
   * does with the time a merely good one spends repositioning. Which is exactly what
   * `engage` decides, and it is the most visible of the eight axes: at 1 the screen
   * fills with enemies dying on the way down.
   */
  const quarryOf = (seen: PilotView, fighter: FighterSighting): Sighting | undefined => {
    let best: Sighting | undefined;
    for (const enemy of seen.enemies) {
      if (enemy.captured || !enemy.flying) continue;
      if (fighter.y - enemy.y > persona.threatHorizon) continue;
      if (best === undefined || enemy.y > best.y) best = enemy;
    }
    return best;
  };

  /**
   * The captor to shoot for a rescue: a diver flying beside the captive.
   *
   * The manual's condition is that the pair is *attacking*, which on screen is both
   * of them off their slots and coming down — so that is the test, and nothing here
   * reads the capture channel's phase.
   */
  const rescueTarget = (seen: PilotView): Sighting | undefined => {
    const captive = seen.enemies.find((enemy) => enemy.captured && enemy.flying);
    if (captive === undefined) return undefined;
    let best: Sighting | undefined;
    for (const enemy of seen.enemies) {
      if (enemy.captured || !enemy.flying) continue;
      const span = Math.abs(enemy.x - captive.x);
      if (span > ESCORT_SPAN) continue;
      if (best === undefined || span < Math.abs(best.x - captive.x)) best = enemy;
    }
    return best;
  };

  /**
   * When `threat` would first be a danger to a fighter standing in `column`, or
   * `undefined` if it never is inside the warning window.
   *
   * The intersection of two intervals: the steps it is at striking altitude, and
   * the steps it is over this column. That intersection is what makes a sweeping
   * body dodgeable at all — the answer is *later* for a column the sweeper reaches
   * last, which is exactly where the pilot should be standing.
   */
  const strikesAt = (
    seen: PilotView,
    threat: Threat,
    column: number,
    margin: number,
  ): number | undefined => {
    const altitude = windowOfApproach(threat.above, -threat.descent, 0, band(seen, margin));
    if (altitude === undefined) return undefined;
    const over = windowOfApproach(threat.x, threat.drift, column, seen.strikeWidth + margin);
    if (over === undefined) return undefined;
    const from = Math.max(altitude.from, over.from);
    if (from > Math.min(altitude.until, over.until) || from > warning) return undefined;
    return from;
  };

  /**
   * How bad it is to stand in this column: how soon each threat would reach it.
   *
   * Sooner counts for more, so among columns that are all reachable the pilot
   * takes the one it has longest in. Zero means nothing reaches this column inside
   * the warning window — the column is clear, and that is a different kind of
   * answer rather than a smaller number, which is why {@link bestColumn} treats it
   * separately.
   */
  const dangerAt = (
    seen: PilotView,
    column: number,
    threats: readonly Threat[],
    margin: number,
  ): number => {
    let danger = 0;
    for (const threat of threats) {
      const strike = strikesAt(seen, threat, column, margin);
      if (strike !== undefined) danger += 1 / (1 + strike);
    }
    return danger;
  };

  /**
   * The column to stand in.
   *
   * **Three questions in order, and no weight between them**, because a weight here
   * is a tuned constant and this is the decision the whole pilot turns on:
   *
   * 1. Is there a column nothing reaches inside the warning window, at the
   *    clearance this persona wants? Then stand in the most *appealing* one. This is
   *    the ordinary case, and it is why one pilot both hunts and dodges rather than
   *    having two modes that fight: while it is safe it walks towards something to
   *    shoot, and the moment that place stops being safe it walks away instead.
   * 2. Failing that, the same question at no clearance at all — a column that is
   *    merely not lethal.
   * 3. Failing even that, the column that stays safe longest, and among equals the
   *    nearest: walking across a full screen to a marginally better place is how a
   *    pilot dies on the way.
   *
   * An earlier draft weighted danger against distance with a big multiplier and the
   * careful personas were measurably *worse* for it: a thousandth of a pixel of
   * theoretical danger outbid a hundred pixels of walking, so the good pilots spent
   * the game chasing infinitesimal safety and never fired. Hence the lexicographic
   * form.
   */
  const bestColumn = (
    seen: PilotView,
    threats: readonly Threat[],
    fighter: FighterSighting,
    appeal: (column: number) => number,
  ): number => {
    // The clearance the persona would *like*, and the clearance that is merely not
    // lethal — the fighter's own width, with nothing on top.
    //
    // Asking twice is what makes `dodgeMargin` a competence axis instead of a taste
    // one. Asked only at full clearance, a persona that wanted a lot of room found
    // none on a crowded screen, gave up on shooting and spent the run running: the
    // astronaut with 28 px scored *below* the expert with 22. A real player who
    // wants twenty pixels and cannot get them takes eight, so the pilot does too —
    // and a large clearance now costs nothing when the screen will not allow it.
    for (const margin of [persona.dodgeMargin, 0]) {
      let clear: number | undefined;
      let clearCost = Number.POSITIVE_INFINITY;
      for (let column = seen.minX; column <= seen.maxX; column += COLUMN_STEP) {
        if (dangerAt(seen, column, threats, margin) > 0) continue;
        const cost = appeal(column);
        if (cost < clearCost) {
          clearCost = cost;
          clear = column;
        }
      }
      if (clear !== undefined) return clear;
    }

    // Nowhere is even non-lethal. Take the column that stays safe longest.
    let safest = fighter.x;
    let safestDanger = Number.POSITIVE_INFINITY;
    let safestWalk = Number.POSITIVE_INFINITY;

    for (let column = seen.minX; column <= seen.maxX; column += COLUMN_STEP) {
      const danger = dangerAt(seen, column, threats, 0);
      // Nothing is clear, so the tie-break is distance from **here**, not from
      // whatever it wanted to shoot: the thing it wants to shoot is very often the
      // thing bearing down on it, and a pilot that broke the tie towards its target
      // walked into the sweeper it was running from. That was the last defect this
      // function had, and it read on screen as the astronaut turning into a diver.
      const walk = Math.abs(column - fighter.x);
      if (danger < safestDanger || (danger === safestDanger && walk < safestWalk)) {
        safestDanger = danger;
        safestWalk = walk;
        safest = column;
      }
    }

    return safest;
  };

  /**
   * How far a column is from the nearest thing worth shooting.
   *
   * The appeal of a *safe* column, and deliberately "the nearest target" rather
   * than "the one target I picked": the lowest enemy on screen is very often the one
   * the pilot is getting away from, so steering at it is steering at the hazard.
   * Asking instead for a safe column with *something* above it is what makes the
   * good personas look like they are working the formation rather than running
   * around under it.
   */
  const nearestTarget = (seen: PilotView, column: number): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const enemy of seen.enemies) {
      if (enemy.captured) continue;
      best = Math.min(best, Math.abs(enemy.x - column));
    }
    return best;
  };

  return {
    persona,

    sample(view: PilotView): InputFrame {
      history.push(view);
      while (history.length > depth) history.shift();

      // The view the persona's reaction delay allows, and the step before it, for
      // measuring how things are moving. Early in a run there is less history than
      // that, and the oldest there is is the honest answer.
      const previous = history.length > 1 ? history[0] : undefined;
      const seen = (history.length > 1 ? history[1] : history[0]) ?? view;
      const fighter = seen.fighter;
      if (fighter === undefined) {
        // No fighter on the field: nothing to steer and nothing to shoot. Let go of
        // the button so the next life does not begin mid-burst.
        panicSteps = 0;
        engagedId = undefined;
        decidedAbout = undefined;
        return EMPTY_FRAME;
      }

      wasAt = new Map((previous ?? seen).enemies.map((enemy) => [enemy.id, enemy]));
      const threats = threatsFor(seen);
      const urgent = threats[0];
      const beam = seen.beam;
      const rescue = persona.rescue ? rescueTarget(seen) : undefined;

      /* -- the engagement --------------------------------------------------- */

      const quarry = quarryOf(seen, fighter);

      // One decision per quarry rather than one per step: a coin flipped every frame
      // is a pilot that twitches, not one that commits.
      if (quarry === undefined) {
        decidedAbout = undefined;
        engagedId = undefined;
      } else if (decidedAbout !== quarry.id) {
        decidedAbout = quarry.id;
        engagedId = rng.chance(persona.engage) ? quarry.id : undefined;
      }

      // The two habits, decided once per pressing threat (see `reactedTo`), and the
      // one gate on an engagement: safety first, always.
      const pressing = urgent !== undefined && urgent.from <= warning ? urgent : undefined;
      if (pressing === undefined) {
        reactedTo = undefined;
        panicking = false;
        holdingBack = false;
      } else if (reactedTo !== pressing.id) {
        reactedTo = pressing.id;
        panicking = rng.chance(persona.panic);
        holdingBack = rng.chance(persona.shotDiscipline);
      }

      // An engagement only ever *steers*, and only while nothing is bearing down: the
      // moment something could reach the fighter's row inside the warning window that
      // thing is an ordinary hazard and the pilot moves for it like anything else. So
      // `engage` is exactly "with the time I have spare, do I go under that diver to
      // shoot it, or stay where the formation is" — the difference between a very
      // good pilot and a great one, and the one a watcher can see.
      const engaging =
        quarry !== undefined &&
        engagedId === quarry.id &&
        pressing === undefined &&
        seen.shotsFree > 0;

      /* -- where to stand ---------------------------------------------------- */

      let goal: number;
      if (rescue !== undefined) {
        // Deliberately not through `bestColumn`: lining up under a captor while the
        // pair is attacking is the risk the persona said it would take.
        goal = rescue.x;
      } else if (persona.rescue && beam !== undefined) {
        // Walking into an open beam on purpose is the standard way to go after a
        // dual fighter, and it is silent: a captor has to survive its descent.
        goal = beam.x;
      } else if (engaging && quarry !== undefined) {
        // A deliberate walk under the thing in the air, to shoot it out of it.
        const target = interceptOf(seen, fighter, quarry);
        goal = bestColumn(seen, threats, fighter, (column) => Math.abs(column - target));
      } else {
        goal = bestColumn(seen, threats, fighter, (column) => nearestTarget(seen, column));
      }

      /* -- whether to fire ---------------------------------------------------- */

      // Anything lined up within this persona's tolerance is a reason to fire, not
      // only the thing it is steering at: a player holds the button when something
      // is above them, and a pilot that fired only at its chosen target would walk
      // past two thirds of the formation in silence.
      let wantsFire = false;
      let firingAt: number | undefined;
      let firingLow = Number.NEGATIVE_INFINITY;
      for (const enemy of seen.enemies) {
        if (enemy.captured) continue;
        if (Math.abs(interceptOf(seen, fighter, enemy) - fighter.x) > persona.aimTolerance)
          continue;
        // The lowest of the candidates: the one a rocket reaches first, and the one
        // most likely to be about to matter.
        if (enemy.y < firingLow) continue;
        firingLow = enemy.y;
        wantsFire = true;
        firingAt = enemy.id;
      }

      // Never shoot your own stolen ship out of the sky to get at something behind
      // it — that is the one target on screen that costs you the dual fighter. The
      // captive is drawn as a fighter, so a watcher sees this too.
      if (wantsFire && firingAt !== rescue?.id) {
        const captive = seen.enemies.find(
          (enemy) =>
            enemy.captured &&
            Math.abs(interceptOf(seen, fighter, enemy) - fighter.x) <= persona.aimTolerance,
        );
        if (captive !== undefined) wantsFire = false;
      }

      // Shot discipline: the player's cap is two rockets **in total**, so a pilot
      // with the button held has nothing left for the diver in its face. At 1 the
      // pilot always keeps the last slot back while something it could still shoot
      // is closing on it and is not already what it is shooting at.
      //
      // `shootable` is the whole of why this reads as discipline rather than as
      // hesitation: a rocket saved for a **bomb** buys nothing, because a bomb
      // cannot be shot down. Withholding for one anyway halved the astronaut's rate
      // of fire and cost it a third of its score — full discipline came out worse
      // than half of it, which is the signature of a rule that is not the rule it
      // says it is.
      if (
        wantsFire &&
        holdingBack &&
        seen.shotsFree <= 1 &&
        pressing !== undefined &&
        pressing.shootable &&
        pressing.id !== firingAt
      ) {
        wantsFire = false;
      }
      if (seen.shotsFree === 0) wantsFire = false;

      /* -- panic -------------------------------------------------------------- */

      // A wasted reversal, and only ever while something could actually reach the
      // fighter, which is what makes it read as a person losing rather than as
      // noise: the fighter bolts for a wall exactly when it should have sidestepped,
      // and talks itself into a corner.
      if (panicSteps > 0) {
        panicSteps -= 1;
        goal = panicDirection < 0 ? seen.minX : seen.maxX;
      } else if (panicking && pressing !== undefined) {
        panicking = false;
        panicSteps = rng.int(PANIC_MIN_STEPS, PANIC_MAX_STEPS + 1);
        panicDirection = goal >= fighter.x ? -1 : 1;
        goal = panicDirection < 0 ? seen.minX : seen.maxX;
      }

      const actions: Action[] = [];
      const dx = goal - fighter.x;
      if (dx > 1) actions.push('right');
      else if (dx < -1) actions.push('left');
      if (wantsFire) actions.push('fire');
      return frameOf(...actions);
    },
  };
}

/**
 * {@link viewOfWorld} plus {@link createAutopilot}, as one function over a world.
 *
 * For the harnesses that drive a world directly — `tests/sim/` and anything shaped
 * like `runWorld` in `scripts/record-replay.ts`, which want an `InputSource`. It is
 * exactly the two functions above and nothing else: the world is read through the
 * projection on every step and the pilot still never sees it, which is what
 * `tests/unit/autoplay.test.ts` asserts by fingerprinting the world either side of
 * a sample.
 */
export function autopilotSource(world: World, options: PilotOptions): { sample: () => InputFrame } {
  const pilot = createAutopilot(options);
  return { sample: () => pilot.sample(viewOfWorld(world)) };
}
