/**
 * The playability pass of `npm run validate-packs` — `docs/DESIGN.md` section 8
 * step 2, run over every stage every variant plays.
 *
 * The schema and reference passes say a pack is well formed. This one starts the
 * simulation and asks whether what loaded is a game. It is the generalisation of
 * `tests/sim/forged-pack.test.ts`, which proved the same questions over one pack
 * by hand; where that file names the Deep Sea pack, this answers the general form.
 *
 * **What is flown.** A stage document plays under a variant — its rules, its
 * layered content, its rank — so the unit is a *(variant, stage document)* pair,
 * flown at the first stage number that variant's sequence plays it, so the
 * difficulty row in force is the one a player meets it under. Every document the
 * default preset's rank plays is flown at that rank; a document only some other
 * rank's sequence plays is flown at that rank. Nothing is sampled: every stage of
 * every variant, every slot of every role, every seed of the protocol.
 *
 * **The checks**, each reported against the stage and the file at fault:
 *
 * 1. `entry` — the fleet builds, every enemy it launches reaches a slot of its
 *    own, the formation settles (the event that arms the dives), and no entry
 *    path strays further outside the playfield than {@link OFF_SCREEN_MARGIN}.
 * 2. `dive` — every dive path of every alien the stage's waves name, and the
 *    capture dive for the captor role, flown from every formation slot of that
 *    role in the mirror sense the formation picks: it ends, it leaves the bottom,
 *    and it never takes the sprite off either side.
 * 3. `finishes` — the strong persona, with lost fighters replaced, clears the
 *    stage inside {@link PROTOCOL.stageSteps} on every seed but at most
 *    {@link PROTOCOL.stallsTolerated}. With fighters replaced a run can only end
 *    by clearing, so one that reaches the limit is a stall — and a stall on many
 *    seeds is an enemy nothing can reach or a wave that never launches, where a
 *    stall on one or two is a pilot losing a duel. The protocol says how the two
 *    were told apart.
 * 4. `clearable` — the mid-tier persona, fighters replaced, clears on at least
 *    {@link PROTOCOL.midClears} seeds. A stage only the ceiling can finish is not
 *    calibrated, and nothing else in the gate would say so.
 * 5. `bullet-wall` — whenever a bullet launches, the bullets in flight are flown
 *    forward with the fighter's own speed and hit window: if no column of the
 *    fighter's row survives them, from **any** starting position, it is a wall.
 * 6. `deterministic` — the first strong-persona run, flown again, ends on the
 *    same fingerprint.
 *
 * And once per variant, `ordered`: the strong persona outscores the mid-tier one
 * over whole games from the first stage, or the personas are not a ladder.
 *
 * **Why fighters are replaced.** The question is whether the *stage* can be
 * finished, and with a variant's starting fighters the answer is mostly about the
 * pilot: on the Classic pack's stage 5 the strongest persona loses all three
 * fighters during the entry, inside eight seconds, on every seed, and clears it
 * every time once a lost fighter is handed back. Replacing them is a measurement
 * harness topping up the reserve, the same kind of reach into the world the
 * forged-pack test makes when it holds `dive.armed` down — the pilot still only
 * sees what is drawn.
 *
 * **Which personas.** A variant declares its personas weakest first — the order
 * `tests/sim/autoplay-personas.test.ts` holds Classic's four to — so the strong
 * one is the last and the mid-tier one is the middle (rounded down). A variant
 * that declares none, which is the normal case, is flown by the personas of a
 * variant running the **same rules document**: a persona's units are that
 * document's pixels and steps, so the borrowing is exact. A variant with neither
 * fails, because a pass with no pilot would measure nothing and report green.
 *
 * **What it does not cover**, so nobody reads more into a pass than there is:
 * challenge-stage scripts are flown (`finishes`, `clearable`, `bullet-wall`,
 * `deterministic`) but not path-checked, because their flyers leave the screen
 * by design; dives are aimed at the fighter's home column, because the shipped
 * Classic dives overshoot a side by up to 36 px when aimed at a fighter parked
 * in a corner and the arcade reference does not say that is wrong; a transform's
 * spawned divers start mid-dive rather than from a slot, so no slot check
 * reaches them; and the wall check is the single fighter's — a dual fighter is
 * wider, so a gap the check accepts can still be too narrow for two ships.
 *
 * Nothing here reads the filesystem: it is handed resolved variants, so the
 * script and `tests/unit/playability.test.ts` exercise the same code.
 */

import type { ContentError } from '../src/content/errors.js';
import type { Persona } from '../src/content/personas.js';
import { maxXFor, resolveStageId } from '../src/content/rules.js';
import type { Rules, Stage } from '../src/content/schema.js';
import type { StageSource } from '../src/content/stages.js';
import type { ResolvedVariant } from '../src/content/variants.js';
import { VARIANTS_GROUP } from '../src/content/variants.js';
import type { EnemyBullet } from '../src/sim/shots.js';
import { createFormation, isRightOfCentre, slotPosition } from '../src/sim/formation.js';
import {
  compilePath,
  OFF_SCREEN_MARGIN,
  pathBounds,
  samplePath,
  type Vec2,
} from '../src/sim/paths.js';
import { startX } from '../src/sim/player.js';
import { createWorld, fingerprintWorld, stepWorld, type World } from '../src/sim/world.js';
import { autopilotSource } from '../src/ui/autoplay.js';

/* -------------------------------------------------------------------------- */
/* The protocol                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every number the verdict rests on, in one place.
 *
 * The seeds are fixed strings, so the same packs give the same verdict on every
 * machine: a failure reproduces, and nothing here is a flake that reads as an
 * unplayable pack. The thresholds are still statistical in what they *mean* — 16
 * seeds is a sample of a pilot's luck — which is why the clear threshold is a
 * fraction with room in it rather than "every seed", and why the messages say so.
 */
export const PROTOCOL = {
  /** Seeds per persona per stage, and per persona for the ordering. */
  seeds: 16,
  /**
   * The time limit on one stage, in simulation steps: three minutes. When this was
   * set, the slowest clear measured on any shipped stage was 6,635 steps for the
   * strong persona and 8,487 for the mid-tier one, so a strong run that reaches it
   * is a stall rather than a long stage cut short.
   */
  stageSteps: 3 * 60 * 60,
  /** The limit on the entry choreography alone: one minute, from the first frame. */
  entrySteps: 60 * 60,
  /**
   * How many of the strong persona's seeds may stall before `finishes` fails: two,
   * so a stage fails on its third. A stall is still reported — see the notes — but
   * it is not proof by itself that nothing can reach an enemy.
   *
   * Statistical for the same reason the clear threshold is, and bounded by
   * measurement rather than by hope. A stage nothing can finish stalls on every
   * seed: `tests/fixtures/unplayable/`'s ledge stalls on 16 of 16. A strong pilot
   * that merely loses a duel stalls on a few: over 48 extra seeds per stage, when
   * the thirteen Classic scripts landed, Classic stalled 0 of 1,008 runs and Deep
   * Sea 0 of 528, while Swarm Remix stalled 6 of 1,008 — the astronaut persona
   * failing to kill a lone drone flying that pack's dive, which it rams the fighter
   * with over and over while staying in reach. That rate predates the thirteen
   * scripts: it reached the documents that were already shipped, and the gate saw
   * it only when a rename redrew their seeds. "Every seed" read that as a stage
   * that cannot be finished, which it is not.
   *
   * That duel was the pilot's to lose: it walked through the drone's flattened pass
   * to stand in the clear column behind it (`reachOf` in `src/ui/autoplay.ts`).
   * Since it stopped, 480 extra seeds per stage stall Classic 0 of 10,080 runs,
   * Swarm Remix 0 of 10,080 (18 before) and Deep Sea 1 of 5,280 (1 before). Two is
   * still the threshold: it is a floor for a duel any pilot can lose, not a
   * measurement of this one.
   */
  stallsTolerated: 2,
  /**
   * How many of the mid-tier persona's seeds must clear. Half, against a measured
   * 16 of 16 on every shipped stage: a stage that has stopped being finishable for
   * anyone but the ceiling falls through it, a bad seed or two does not.
   */
  midClears: 8,
  /** The limit on one whole game for the ordering check: three minutes, as above. */
  runSteps: 3 * 60 * 60,
} as const;

/* -------------------------------------------------------------------------- */
/* Findings                                                                    */
/* -------------------------------------------------------------------------- */

export type CheckId =
  | 'entry'
  | 'dive'
  | 'finishes'
  | 'clearable'
  | 'bullet-wall'
  | 'deterministic'
  | 'ordered'
  | 'personas';

/** One failed check, attributed to the document an author would open. */
export interface Finding {
  readonly check: CheckId;
  /** The pack and file at fault — a stage, a path, or the variant document. */
  readonly pack: string;
  readonly file: string;
  readonly message: string;
}

export interface PlayabilityReport {
  readonly findings: readonly Finding[];
  /** One line per variant flown, for the script's success report. */
  readonly notes: readonly string[];
}

/** Findings as the script's report lines, grouped per file like every other pass. */
export function asContentErrors(findings: readonly Finding[]): ContentError[] {
  return findings.map(({ check, pack, file, message }) => ({
    pack,
    file,
    message: `playability ${check}: ${message}`,
  }));
}

/* -------------------------------------------------------------------------- */
/* What is flown                                                               */
/* -------------------------------------------------------------------------- */

/** One stage document as one variant plays it. */
export interface StageFlight {
  readonly stage: Stage;
  /** The first stage number that plays it at {@link rank}. */
  readonly number: number;
  readonly rank: string;
}

/**
 * How far into the sequence to look for a document. Both halves of a sequence
 * plateau or cycle within their row count, so this only has to cover the longest
 * pair of halves a pack could plausibly ship and the cadence that interleaves them.
 */
const SEQUENCE_HORIZON = 400;

/** Every stage document a variant plays, each at the first number that plays it. */
export function stageFlights(variant: ResolvedVariant): StageFlight[] {
  const { manifest } = variant.registry;
  const ranks = [
    variant.defaultPreset.rank,
    ...Object.keys(variant.rules.difficulty.ranks).filter(
      (rank) => rank !== variant.defaultPreset.rank,
    ),
  ];
  const seen = new Set<string>();
  const flights: StageFlight[] = [];
  for (const rank of ranks) {
    for (let number = 1; number <= SEQUENCE_HORIZON; number += 1) {
      const id = resolveStageId(manifest, variant.rules, number, rank);
      if (id === undefined || seen.has(id)) continue;
      const stage = variant.registry.stages.get(id);
      if (stage === undefined) continue;
      seen.add(id);
      flights.push({ stage, number, rank });
    }
  }
  return flights;
}

/** The personas a variant is flown by, and where they came from. */
export interface Pilots {
  readonly strong: Persona;
  readonly mid: Persona;
  /** The variant whose document declares them. */
  readonly from: string;
  /** Whether that is some other variant than the one being flown. */
  readonly borrowed: boolean;
}

/**
 * The strong and mid-tier personas for a variant, borrowed when it declares none.
 * `undefined` when no variant running the same rules document declares any.
 */
export function pilotsFor(
  variant: ResolvedVariant,
  all: readonly ResolvedVariant[],
): Pilots | undefined {
  const owner =
    variant.personas.length > 0
      ? variant
      : all.find((other) => other.rules === variant.rules && other.personas.length > 0);
  if (owner === undefined) return undefined;
  const { personas } = owner;
  const strong = personas[personas.length - 1];
  const mid = personas[Math.floor((personas.length - 1) / 2)];
  if (strong === undefined || mid === undefined) return undefined;
  return { strong, mid, from: owner.id, borrowed: owner !== variant };
}

/* -------------------------------------------------------------------------- */
/* Bullet walls                                                                */
/* -------------------------------------------------------------------------- */

/** How far ahead a wall is looked for. Longer than any bullet takes to cross the field. */
const WALL_HORIZON = 600;

/**
 * The first step, counting from 1, at which the bullets in flight leave no column
 * of the fighter's row alive from any starting position — or `undefined` if some
 * column always survives.
 *
 * A reachability sweep over whole-pixel positions, which is what the fighter
 * occupies: start from every column of its travel, and each step widen the set by
 * the longest step the pack's `stepPattern` allows, clamp it to the travel limits,
 * then strike out every column a bullet's hit window covers on that step. The
 * order mirrors `stepWorld` — the fighter moves, the bullets move, then they are
 * tested — and a bullet retires on exactly the bounds `stepEnemyBullets` uses.
 *
 * It is generous to the fighter twice over, on purpose: it may start anywhere,
 * and it may take the longer of its two alternating steps every frame. So a wall
 * it reports is unavoidable for any pilot, which is the claim the check makes.
 */
export function findBulletWall(bullets: readonly EnemyBullet[], rules: Rules): number | undefined {
  const active = bullets.filter((bullet) => bullet.active);
  if (active.length === 0) return undefined;

  const { minX, y: row, hitWindow, stepPattern } = rules.player;
  const maxX = maxXFor(rules, 'single');
  const reach = Math.max(...stepPattern);
  const { width, height } = rules.playfield;
  const span = maxX - minX + 1;

  let alive = new Uint8Array(span).fill(1);
  const live = active.map(({ x, y, vx, vy }) => ({ x, y, vx, vy, retired: false }));

  for (let step = 1; step <= WALL_HORIZON; step += 1) {
    // The fighter moves first.
    const next = new Uint8Array(span);
    for (let index = 0; index < span; index += 1) {
      if (alive[index] === 0) continue;
      const from = Math.max(0, index - reach);
      const to = Math.min(span - 1, index + reach);
      for (let reached = from; reached <= to; reached += 1) next[reached] = 1;
    }

    // Then the bullets, retiring on the bounds `stepEnemyBullets` uses, then the test.
    let flying = 0;
    for (const bullet of live) {
      if (bullet.retired) continue;
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      if (bullet.y > height || bullet.y < -8 || bullet.x < -8 || bullet.x > width) {
        bullet.retired = true;
        continue;
      }
      flying += 1;
      const dy = row - bullet.y;
      if (dy < hitWindow.dyMin || dy > hitWindow.dyMax) continue;
      // Hit when (fighter x − bullet x) is inside the window's Δx.
      const low = Math.ceil(bullet.x + hitWindow.dxMin) - minX;
      const high = Math.floor(bullet.x + hitWindow.dxMax) - minX;
      for (let index = Math.max(0, low); index <= Math.min(span - 1, high); index += 1) {
        next[index] = 0;
      }
    }

    alive = next;
    if (!alive.includes(1)) return step;
    if (flying === 0) return undefined;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Flights                                                                     */
/* -------------------------------------------------------------------------- */

/** How one persona's run of one stage went. */
export interface StageRun {
  readonly cleared: boolean;
  readonly steps: number;
  /** The first unavoidable wall seen, as `step` of the run. */
  readonly wall: { readonly step: number; readonly bullets: number } | undefined;
  readonly fingerprint: string;
}

/**
 * A world on the flown stage, whose source answers **only** that stage.
 *
 * Clearing a stage builds the next one on the same step, so a source that knew
 * the whole sequence would let the next document's fault surface as this one's —
 * a stage that cannot be built would be blamed on every stage before it. The
 * field after a clear is empty instead, which the simulation already handles.
 */
function worldFor(variant: ResolvedVariant, flight: StageFlight, seed: string): World {
  const sequence = variant.stagesFor(flight.rank);
  const only: StageSource = {
    stageFor: (number) => (number === flight.number ? sequence.stageFor(number) : undefined),
  };
  return createWorld({
    seed,
    rules: variant.rules,
    stages: only,
    stage: flight.number,
    rank: flight.rank,
  });
}

/**
 * Fly one stage with one persona, replacing every fighter it loses, until the
 * stage is cleared or the limit is reached.
 */
export function flyStage(
  variant: ResolvedVariant,
  flight: StageFlight,
  persona: Persona,
  seed: string,
  limit: number = PROTOCOL.stageSteps,
): StageRun {
  const world = worldFor(variant, flight, seed);
  const pilot = autopilotSource(world, { persona, seed: `pilot:${seed}` });
  const reserve = world.lives.reserve;
  let wall: StageRun['wall'];
  let steps = 0;

  for (; steps < limit && world.stage === flight.number; steps += 1) {
    const events = stepWorld(world, pilot.sample());
    if (world.lives.reserve < reserve) world.lives.reserve = reserve;
    if (wall === undefined && events.some((event) => event.type === 'enemy-fired')) {
      const at = findBulletWall(world.enemyBullets, world.rules);
      if (at !== undefined) {
        wall = {
          step: world.step,
          bullets: world.enemyBullets.filter((bullet) => bullet.active).length,
        };
      }
    }
  }
  return {
    cleared: world.stage > flight.number,
    steps,
    wall,
    fingerprint: fingerprintWorld(world),
  };
}

function seedsFor(variant: ResolvedVariant, label: string): string[] {
  return Array.from(
    { length: PROTOCOL.seeds },
    (_unused, index) => `playability:${variant.id}:${label}:${String(index)}`,
  );
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                  */
/* -------------------------------------------------------------------------- */

interface Blame {
  readonly pack: string;
  readonly file: string;
}

function blameOf(variant: ResolvedVariant, kind: 'stages' | 'paths' | 'aliens', id: string): Blame {
  const source = variant.registry.sourceOf(kind, id);
  return source === undefined
    ? { pack: variant.registry.active.id, file: `${kind}/${id}.json` }
    : { pack: source.packId, file: source.file };
}

function where(variant: ResolvedVariant, flight: StageFlight): string {
  return `${flight.stage.id} as stage ${String(flight.number)} of ${variant.id} (rank ${flight.rank})`;
}

/** Check 1: the entry choreography, with no input and the dives held off. */
export function checkEntry(variant: ResolvedVariant, flight: StageFlight): string[] {
  const { rules } = variant;
  let world: World;
  try {
    world = worldFor(variant, flight, `playability:${variant.id}:entry:${flight.stage.id}`);
  } catch (error) {
    return [`the fleet could not be built: ${String(error)}`];
  }

  const { width, height } = rules.playfield;
  const reserve = world.lives.reserve;
  let settled = false;
  let stray: string | undefined;
  let step = 0;
  try {
    for (; step < PROTOCOL.entrySteps; step += 1) {
      // `formation-settled` arms the dives, and a dive mid-measurement would move
      // an enemy out of its slot, so they are held off either side of the step.
      world.dive.armed = false;
      const events = stepWorld(world, 0);
      world.dive.armed = false;
      // Entry bombing will take a fighter that never moves, and a game that ends
      // stops stepping with waves still in the air. The entry is what is measured.
      if (world.lives.reserve < reserve) world.lives.reserve = reserve;
      if (events.some((event) => event.type === 'formation-settled')) settled = true;
      for (const enemy of world.fleet.enemies) {
        if (stray !== undefined || enemy.state !== 'entering') continue;
        const out =
          enemy.x < -OFF_SCREEN_MARGIN ||
          enemy.x > width + OFF_SCREEN_MARGIN ||
          enemy.y < -OFF_SCREEN_MARGIN ||
          enemy.y > height + OFF_SCREEN_MARGIN;
        if (out) {
          stray = `${enemy.alienId} #${String(enemy.id)} strays to (${enemy.x.toFixed(1)}, ${enemy.y.toFixed(1)}) on its entry, more than ${String(OFF_SCREEN_MARGIN)} px outside the ${String(width)}×${String(height)} playfield`;
        }
      }
      if (settled && world.fleet.enemies.every((enemy) => enemy.state === 'home')) break;
    }
  } catch (error) {
    return [`the entry failed at step ${String(step)}: ${String(error)}`];
  }

  const problems: string[] = [];
  if (stray !== undefined) problems.push(stray);
  const enemies = world.fleet.enemies;
  const away = enemies.filter((enemy) => enemy.state !== 'home');
  if (away.length > 0) {
    const named = away
      .slice(0, 4)
      .map((enemy) => `${enemy.alienId} #${String(enemy.id)} (${enemy.state})`)
      .join(', ');
    problems.push(
      `${String(away.length)} of ${String(enemies.length)} enemies are not in a slot after ${String(PROTOCOL.entrySteps)} steps: ${named}${away.length > 4 ? ', …' : ''}`,
    );
  }
  const homes = new Set(enemies.map((enemy) => enemy.home));
  if (away.length === 0 && homes.size !== enemies.length) {
    problems.push(
      `${String(enemies.length)} enemies share ${String(homes.size)} slots, so two of them sit in one place`,
    );
  }
  if (!settled && enemies.length > 0) {
    problems.push(
      `the formation never settled within ${String(PROTOCOL.entrySteps)} steps, and settling is what arms the dives — nothing would ever attack`,
    );
  }
  return problems;
}

/** One dive path that leaves the screen, with where it was flown from. */
export interface DiveFault {
  readonly path: string;
  readonly role: string;
  /** Up to three slots it fails from, and how. */
  readonly reasons: string;
}

/** Check 2: every dive the stage can launch, from every slot that can launch it. */
export function checkDives(variant: ResolvedVariant, flight: StageFlight): DiveFault[] {
  const { rules, registry } = variant;
  const { stage } = flight;
  const formation = registry.formations.get(stage.formation);
  if (formation === undefined) return [];
  const state = createFormation(formation, rules, stage.kind);
  const fighter: Vec2 = [startX(rules), rules.player.y];
  const { width, height } = rules.playfield;

  // Which dives, flown by which role, at what sprite width.
  const dives = new Map<string, { role: string; size: number }>();
  const alienIds = new Set(stage.waves.flatMap((wave) => wave.slots.map((slot) => slot.alien)));
  for (const id of alienIds) {
    const alien = registry.aliens.get(id);
    if (alien === undefined) continue;
    const size = registry.sprites.get(alien.sprite)?.size ?? 16;
    for (const path of alien.dive?.paths ?? []) {
      dives.set(`${alien.role}\u0000${path}`, { role: alien.role, size });
    }
  }
  const capture = rules.capture;
  if (capture?.captorRole !== undefined && capture.divePath !== undefined) {
    const captors = [...alienIds]
      .map((id) => registry.aliens.get(id))
      .filter((alien) => alien?.role === capture.captorRole);
    const size = Math.max(
      16,
      ...captors.map((alien) => registry.sprites.get(alien?.sprite ?? '')?.size ?? 16),
    );
    if (captors.length > 0) {
      dives.set(`${capture.captorRole}\u0000${capture.divePath}`, {
        role: capture.captorRole,
        size,
      });
    }
  }

  const faults: DiveFault[] = [];
  for (const [key, { role, size }] of dives) {
    const pathId = key.split('\u0000')[1] ?? '';
    const path = registry.paths.get(pathId);
    if (path === undefined) continue;
    const reasons: string[] = [];
    formation.slots.forEach((slot, index) => {
      if (slot.role !== role || reasons.length >= 3) return;
      const at = slotPosition(state, rules, index);
      const mirror = isRightOfCentre(state, index);
      const from = `from slot ${String(index)} (${String(at.x)}, ${String(at.y)})${mirror ? ' mirrored' : ''}`;
      let compiled;
      try {
        compiled = compilePath(path, {
          mirror,
          slot: [at.x, at.y],
          player: fighter,
          playfield: rules.playfield,
          start: [at.x, at.y],
          heading: 0,
        });
      } catch (error) {
        reasons.push(`${from}: does not compile: ${String(error)}`);
        return;
      }
      if (!Number.isFinite(compiled.totalFrames)) {
        reasons.push(`${from}: never ends`);
        return;
      }
      const end = samplePath(compiled, compiled.totalFrames);
      const bounds = pathBounds(compiled);
      if (!end.done || end.y < height) {
        reasons.push(`${from}: ends at y ${end.y.toFixed(1)} without leaving the bottom`);
      }
      if (bounds.minX < 0) {
        reasons.push(`${from}: reaches x ${bounds.minX.toFixed(1)}, off the left side`);
      }
      if (bounds.maxX > width - size) {
        reasons.push(
          `${from}: reaches x ${bounds.maxX.toFixed(1)}, taking a ${String(size)} px sprite off the right side (limit ${String(width - size)})`,
        );
      }
    });
    if (reasons.length > 0) {
      faults.push({ path: pathId, role, reasons: reasons.join('; ') });
    }
  }
  return faults;
}

/** A persona's id, and the variant it was borrowed from when it was. */
function named(pilots: Pilots, persona: Persona): string {
  return pilots.borrowed ? `${persona.id} (borrowed from ${pilots.from})` : persona.id;
}

/** Checks 3–6 for one stage, and how many strong-persona stalls it tolerated. */
function checkFlights(
  variant: ResolvedVariant,
  flight: StageFlight,
  pilots: Pilots,
): { readonly findings: Finding[]; readonly tolerated: number } {
  const blame = blameOf(variant, 'stages', flight.stage.id);
  const at = where(variant, flight);
  const findings: Finding[] = [];
  const seeds = seedsFor(variant, flight.stage.id);

  const fly = (persona: Persona): StageRun[] | string => {
    const runs: StageRun[] = [];
    for (const seed of seeds) {
      try {
        runs.push(flyStage(variant, flight, persona, seed));
      } catch (error) {
        return `the ${persona.id} persona's run on seed "${seed}" threw: ${String(error)}`;
      }
    }
    return runs;
  };

  const strong = fly(pilots.strong);
  if (typeof strong === 'string')
    return {
      findings: [{ check: 'finishes', ...blame, message: `${at}: ${strong}` }],
      tolerated: 0,
    };
  const mid = pilots.mid === pilots.strong ? strong : fly(pilots.mid);
  if (typeof mid === 'string')
    return {
      findings: [{ check: 'clearable', ...blame, message: `${at}: ${mid}` }],
      tolerated: 0,
    };

  const stalled = strong.filter((run) => !run.cleared).length;
  if (!finishesEnough(stalled)) {
    findings.push({
      check: 'finishes',
      ...blame,
      message: `${at}: the ${named(pilots, pilots.strong)} persona, with lost fighters replaced, was still on the stage after ${String(PROTOCOL.stageSteps)} steps on ${String(stalled)} of ${String(seeds.length)} seeds, more than the ${String(PROTOCOL.stallsTolerated)} a lost duel accounts for — a stage that cannot be finished, not a hard one`,
    });
  }

  const midCleared = mid.filter((run) => run.cleared).length;
  if (!clearsEnough(midCleared)) {
    findings.push({
      check: 'clearable',
      ...blame,
      message: `${at}: the mid-tier ${named(pilots, pilots.mid)} persona, with lost fighters replaced, cleared ${String(midCleared)} of ${String(seeds.length)} seeds and needs ${String(PROTOCOL.midClears)} — a statistical bound over fixed seeds, so it reproduces exactly, but it is a sample of a pilot's luck`,
    });
  }

  for (const [persona, runs] of [
    [pilots.strong, strong],
    [pilots.mid, mid],
  ] as const) {
    const index = runs.findIndex((run) => run.wall !== undefined);
    const wall = runs[index]?.wall;
    if (wall !== undefined) {
      findings.push({
        check: 'bullet-wall',
        ...blame,
        message: `${at}: on the ${persona.id} persona's seed "${seeds[index] ?? ''}", the ${String(wall.bullets)} bullets in flight at step ${String(wall.step)} leave no column of the fighter's row alive from any starting position`,
      });
      break;
    }
  }

  const first = seeds[0];
  const firstRun = strong[0];
  if (first !== undefined && firstRun !== undefined) {
    const again = flyStage(variant, flight, pilots.strong, first);
    if (again.fingerprint !== firstRun.fingerprint) {
      findings.push({
        check: 'deterministic',
        ...blame,
        message: `${at}: seed "${first}" flown twice by the ${pilots.strong.id} persona ended on two different worlds`,
      });
    }
  }
  return { findings, tolerated: finishesEnough(stalled) ? stalled : 0 };
}

/** The `finishes` threshold, on its own so both of its edges can be pinned. */
export function finishesEnough(stalled: number): boolean {
  return stalled <= PROTOCOL.stallsTolerated;
}

/** The `clearable` threshold, on its own so both of its edges can be pinned. */
export function clearsEnough(cleared: number): boolean {
  return cleared >= PROTOCOL.midClears;
}

/** One whole game from the first stage, with the variant's own fighters. */
export function playRun(variant: ResolvedVariant, persona: Persona, seed: string): number {
  const rank = variant.defaultPreset.rank;
  const world = createWorld({ seed, rules: variant.rules, stages: variant.stagesFor(rank), rank });
  const pilot = autopilotSource(world, { persona, seed: `pilot:${seed}` });
  for (let step = 0; step < PROTOCOL.runSteps && world.status === 'playing'; step += 1) {
    stepWorld(world, pilot.sample());
  }
  return world.score;
}

/** The variant-level check: the ladder climbs. */
function checkOrdered(variant: ResolvedVariant, pilots: Pilots): Finding[] {
  if (pilots.strong === pilots.mid) return [];
  const seeds = seedsFor(variant, 'run');
  const blame = { pack: VARIANTS_GROUP, file: variant.file };
  const mean = (persona: Persona): number | string => {
    let total = 0;
    for (const seed of seeds) {
      try {
        total += playRun(variant, persona, seed);
      } catch (error) {
        return `the ${persona.id} persona's whole game on seed "${seed}" threw: ${String(error)}`;
      }
    }
    return total / seeds.length;
  };
  const strong = mean(pilots.strong);
  if (typeof strong === 'string') return [{ check: 'ordered', ...blame, message: strong }];
  const mid = mean(pilots.mid);
  if (typeof mid === 'string') return [{ check: 'ordered', ...blame, message: mid }];
  if (strong > mid) return [];
  return [
    {
      check: 'ordered',
      ...blame,
      message: `the ${pilots.strong.id} persona averaged ${strong.toFixed(0)} over ${String(seeds.length)} whole games and the mid-tier ${pilots.mid.id} ${mid.toFixed(0)}; personas are declared weakest first, and these do not climb`,
    },
  ];
}

/**
 * The half of the pass that needs no pilot: checks 1 and 2, `entry` and `dive`,
 * over every combat stage the variant plays.
 *
 * On its own because it is cheap — no persona flies, and the slowest shipped
 * variant takes a few tens of milliseconds — so the pack manager in the browser
 * runs it on every list a player composes (`src/ui/compose.ts`), where flying
 * the personas would take seconds per list. One function for both, so the editor
 * and the gate cannot disagree about a fleet that will not build or a dive that
 * leaves the screen.
 *
 * One finding per faulty dive rather than one per stage that launches it: the
 * path is what needs fixing, and the stages are where it was seen.
 */
export function checkStructure(
  variant: ResolvedVariant,
  flights: readonly StageFlight[] = stageFlights(variant),
): Finding[] {
  const findings: Finding[] = [];
  const dives = new Map<string, { fault: DiveFault; stages: string[] }>();
  for (const flight of flights) {
    if (flight.stage.kind === 'challenge') continue;
    const blame = blameOf(variant, 'stages', flight.stage.id);
    for (const message of checkEntry(variant, flight)) {
      findings.push({
        check: 'entry',
        ...blame,
        message: `${where(variant, flight)}: ${message}`,
      });
    }
    for (const fault of checkDives(variant, flight)) {
      const key = `${fault.path}\u0000${fault.role}\u0000${fault.reasons}`;
      const seen = dives.get(key);
      if (seen === undefined) dives.set(key, { fault, stages: [flight.stage.id] });
      else seen.stages.push(flight.stage.id);
    }
  }
  for (const { fault, stages } of dives.values()) {
    findings.push({
      check: 'dive',
      ...blameOf(variant, 'paths', fault.path),
      message: `dive "${fault.path}" flown by the ${fault.role} role in ${variant.id} (${stages.join(', ')}), aimed at the fighter's home column: ${fault.reasons}`,
    });
  }
  return findings;
}

/** The whole pass, over every variant that loaded. */
export function checkPlayability(variants: readonly ResolvedVariant[]): PlayabilityReport {
  const findings: Finding[] = [];
  const notes: string[] = [];

  for (const variant of variants) {
    const flights = stageFlights(variant);
    if (flights.length === 0) {
      notes.push(`${variant.id}: no stages to fly`);
      continue;
    }
    const pilots = pilotsFor(variant, variants);
    if (pilots === undefined) {
      findings.push({
        check: 'personas',
        pack: VARIANTS_GROUP,
        file: variant.file,
        message: `${String(flights.length)} stage(s) to fly and no persona to fly them: declare autoplay.personas here, or run the rules document of a variant that does`,
      });
      continue;
    }

    const before = findings.length;
    const tolerated: string[] = [];
    findings.push(...checkStructure(variant, flights));
    for (const flight of flights) {
      const flown = checkFlights(variant, flight, pilots);
      findings.push(...flown.findings);
      if (flown.tolerated > 0) {
        tolerated.push(
          `${flight.stage.id} on ${String(flown.tolerated)} of ${String(PROTOCOL.seeds)}`,
        );
      }
    }
    findings.push(...checkOrdered(variant, pilots));

    const borrowed = pilots.borrowed ? ` (borrowed from ${pilots.from})` : '';
    // A tolerated stall is named rather than swallowed: under the threshold it is a
    // pilot losing a duel, and that is still worth a reader's eye.
    const stalls =
      tolerated.length > 0
        ? ` (${pilots.strong.id} stalls within the ${String(PROTOCOL.stallsTolerated)} tolerated: ${tolerated.join(', ')})`
        : '';
    notes.push(
      `${variant.id}: ${String(flights.length)} stage(s) flown by ${pilots.strong.id} and ${pilots.mid.id}${borrowed} over ${String(PROTOCOL.seeds)} seeds — ${findings.length === before ? 'playable' : `${String(findings.length - before)} problem(s)`}${stalls}`,
    );
  }
  return { findings, notes };
}
