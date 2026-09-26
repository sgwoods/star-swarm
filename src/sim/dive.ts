/**
 * Dive attacks, enemy fire and the difficulty ramp that drives both
 * (`docs/DESIGN.md` section 4, "Enemies and formation" and "Difficulty ramp").
 *
 * This is the file that turns a formation into a game that fights back. Five
 * ideas hold it together, and each is something a plausible implementation gets
 * wrong:
 *
 * 1. **The ramp selects; it does not scale.** Every number that varies by stage
 *    comes from one literal row of `packs/classic/rules.json` — the per-role
 *    launch rates, the simultaneous-diver limit and its later bump, the
 *    continuous-bombing threshold. The rows are *not monotonic*: three of the
 *    four arcade rank tables contain a stage markedly easier than the one before
 *    (`docs/reference/arcade-reference.md` section 6). So the row is looked up
 *    and read, never interpolated, and there is no difficulty multiplier
 *    anywhere. `src/content/rules.ts` is the only place that interprets a row.
 * 2. **Diving begins from `formation-settled`**, which is the frame the entry
 *    sway passes back through zero — not the frame the last wave arrived. The
 *    director is armed by that event and does nothing before it.
 * 3. **It runs inside the four-phase round robin.** Launch decisions happen once
 *    per round robin and each enemy's own bombing decision happens on its own
 *    phase, because a strictly uniform update will not reproduce the original's
 *    cadence (reference section 2). Positions still move every frame; that is
 *    `stepFleet`'s business.
 * 4. **Enemy bullets come from one global pool of eight.** The cap is global
 *    rather than per enemy and is a first-order contributor to how the game
 *    feels (reference section 4), so this file asks {@link launchEnemyBullet} for
 *    a slot and copes with being refused. It never keeps a pool of its own.
 * 5. **Homing is `toSlot` and nothing else.** A diver that leaves the bottom
 *    re-enters at the top and flies the pack's return path, which ends in the
 *    same segment the entry waves use. There is one homing implementation in the
 *    simulation and it lives in the path interpreter.
 *
 * No constants: every number arrives in the `Rules` value.
 */

import {
  allowsEntryBombing,
  allowsTransform,
  isContinuousBombing,
  lookup,
  nearestBombVector,
  resolveBombCooldown,
  resolveBombVectors,
  resolveDifficultyRow,
  resolveLaunchCredit,
  resolveMaxDivers,
  resolveTransformType,
  transformGroupIndex,
} from '../content/rules.js';
import type { DifficultyRow, Rules } from '../content/schema.js';
import type { StageContent } from '../content/stages.js';
import type { Rng } from '../engine/rng.js';
import type { Enemy, Fleet, ScriptedFire } from './enemies.js';
import { aliveEnemies, beginDive, spawnDiver } from './enemies.js';
import type { FormationState } from './formation.js';
import { isRightOfCentre } from './formation.js';
import { headingToVector, vectorToHeading, type Vec2 } from './paths.js';
import { launchEnemyBullet, type EnemyBulletPool } from './shots.js';

/**
 * Everything the attack director carries for one stage.
 *
 * It is a plain value with no closures, so a replay can fingerprint it — which
 * matters, because the launch credit below is the whole of the dive cadence and a
 * run that agreed on positions but not on credit would diverge later.
 */
export interface DiveState {
  /**
   * The difficulty row in force, resolved once when the stage is entered.
   *
   * Resolved once rather than per frame because a stage's row cannot change
   * under it, and because reading it once is what makes "the ramp selects" a
   * fact about this file rather than a claim.
   */
  readonly row: DifficultyRow | undefined;
  /** Set by `formation-settled`. Nothing dives before it. */
  armed: boolean;
  /** Frames since diving began. The only clock the director has. */
  frame: number;
  /** Role id → launch credit banked so far. */
  readonly credit: Map<string, number>;
  /** Roles the launcher considers, in order. Sorted, so authoring order cannot matter. */
  readonly roles: readonly string[];

  /** Transform attempts this stage has spent. */
  transformsUsed: number;
  /** The enemy chosen to transform, and the frames left of its tell. */
  transformTarget: number | undefined;
  transformTell: number;
  /** Members of the group on the field that have yet to be destroyed. */
  readonly transformGroup: Set<number>;
  /** False once a member left the screen alive, so the all-of-them bonus is off. */
  transformGroupIntact: boolean;
}

/** Build the director for one stage, from the row that stage resolves to. */
export function createDiveState(rules: Rules, stage: number, rank?: string): DiveState {
  const row = resolveDifficultyRow(rules, stage, rank);
  return {
    row,
    armed: false,
    frame: 0,
    credit: new Map(),
    // A role the row says nothing about never attacks, which is how a pack keeps
    // a role out of the lottery without touching the engine.
    roles: Object.keys(row?.launchRates ?? {}).sort(),
    transformsUsed: 0,
    transformTarget: undefined,
    transformTell: 0,
    transformGroup: new Set(),
    transformGroupIntact: true,
  };
}

/**
 * Let the dives begin.
 *
 * Called on `formation-settled` and nowhere else: the arcade's two-part sway exit
 * is what guarantees the formation is exactly centred before anything peels off,
 * and arming on the last wave's arrival instead would start dives mid-swing.
 */
export function armDives(state: DiveState): void {
  state.armed = true;
}

/** The simultaneous-diver limit in force right now, bump included. */
export function maxDiversNow(state: DiveState, rules: Rules): number {
  return resolveMaxDivers(rules, state.row, state.frame);
}

/**
 * How many enemies are diving.
 *
 * A diver **rotating back into its slot does not count**: the row's limit is on
 * simultaneous bombers, and an enemy on its return leg has stopped attacking. The
 * same distinction decides what it scores, which is why the state machine and not
 * a velocity test is the authority on both.
 */
export function diverCount(fleet: Fleet): number {
  let count = 0;
  for (const enemy of fleet.enemies) {
    if (enemy.state === 'diving') count += 1;
  }
  return count;
}

/** What the director needs of the world for one step. */
export interface AttackContext {
  readonly fleet: Fleet;
  readonly content: StageContent;
  readonly formation: FormationState;
  readonly rules: Rules;
  readonly stage: number;
  readonly rng: Rng;
  readonly bullets: EnemyBulletPool;
  /** The fighter's anchor, or `undefined` while it is off the field. */
  readonly playerAt: Vec2 | undefined;
  /** `fire` segments the fleet's flights passed through on this frame. */
  readonly scripted: readonly ScriptedFire[];
}

/** What one step of the director did, for the world to turn into events. */
export interface AttackStep {
  /** Enemies that began a dive on this frame. */
  readonly dived: readonly Enemy[];
  /** Enemies that dropped at least one bomb on this frame. */
  readonly fired: readonly Enemy[];
  /** The group a transform put on the field on this frame, if any. */
  readonly transformed: readonly Enemy[];
  /** The enemy that group replaced. It is off the field from this frame. */
  readonly transformedFrom: number | undefined;
  /** The enemy that began pulsing before transforming, on the frame it was chosen. */
  readonly transforming: Enemy | undefined;
}

/**
 * Advance the attack by one frame.
 *
 * Order within the frame is fixed — transform, launches, bombing, scripted fire —
 * because every one of them can consume a bullet slot or a diver slot and a
 * replay has to agree on who got there first.
 */
export function stepAttacks(state: DiveState, ctx: AttackContext): AttackStep {
  if (state.armed) state.frame += 1;

  const alive = aliveEnemies(ctx.fleet.enemies).length;
  const transformed: Enemy[] = [];
  const parent = state.transformTarget;
  const transforming = stepTransform(state, ctx, alive, transformed);
  const dived = state.armed ? launchDives(state, ctx) : [];
  const fired = dropBombs(state, ctx, alive);

  return {
    dived,
    fired,
    transformed,
    // The parent is forgotten as the group launches, so it is read from before.
    transformedFrom: transformed.length > 0 ? parent : undefined,
    transforming,
  };
}

/* -------------------------------------------------------------------------- */
/* Launching dives                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Grant every role its launch credit and spend what the diver limit allows.
 *
 * The launcher runs **once per round robin**, which is the arcade's own task rate
 * and the cadence the reference is explicit about (section 2). Credit
 * **saturates** at one launch: a role blocked by the diver limit does not bank
 * launches, so the moment a slot frees the field does not fill with five enemies
 * that were queued up behind it.
 */
function launchDives(state: DiveState, ctx: AttackContext): Enemy[] {
  const { fleet, rules } = ctx;
  if (fleet.frame % rules.enemies.updatePhases !== 0) return [];

  const { launchCost } = rules.enemies.dive;
  const limit = maxDiversNow(state, rules);
  const dived: Enemy[] = [];
  let diving = diverCount(fleet);

  for (const role of state.roles) {
    const banked = (state.credit.get(role) ?? 0) + resolveLaunchCredit(rules, state.row, role);
    let credit = Math.min(banked, launchCost);
    if (credit >= launchCost && diving < limit) {
      const enemy = pickDiver(ctx, role);
      if (enemy !== undefined) {
        launchDive(ctx, enemy);
        credit -= launchCost;
        diving += 1;
        dived.push(enemy);
      }
    }
    state.credit.set(role, credit);
  }
  return dived;
}

/**
 * Choose which settled enemy of a role dives, by the aliens' own weights.
 *
 * The draw comes from the world's seeded generator, so which enemy peels off is
 * part of what a replay reproduces. An alien with no dive paths, or a weight of
 * zero, is simply not in the draw — a pack says "this one never attacks" by
 * leaving `dive` off it rather than by the engine knowing which roles fight.
 */
function pickDiver(ctx: AttackContext, role: string): Enemy | undefined {
  const eligible = ctx.fleet.enemies.filter(
    (enemy) =>
      enemy.state === 'home' &&
      enemy.role === role &&
      enemy.divePaths.length > 0 &&
      enemy.diveWeight > 0,
  );
  if (eligible.length === 0) return undefined;

  const total = eligible.reduce((sum, enemy) => sum + enemy.diveWeight, 0);
  let draw = ctx.rng.float(0, total);
  for (const enemy of eligible) {
    draw -= enemy.diveWeight;
    if (draw < 0) return enemy;
  }
  return eligible[eligible.length - 1];
}

/**
 * Send one enemy down one of its dive paths.
 *
 * Which path is a seeded draw; whether it flies mirrored is **not** — an enemy in
 * the right-hand half of the formation sweeps right and one in the left half
 * sweeps left, which is what makes the dives fan outwards the way the arcade's do
 * (`docs/reference/arcade-reference.md` section 5) rather than all crossing the
 * same piece of screen.
 */
function launchDive(ctx: AttackContext, enemy: Enemy): void {
  const path = ctx.rng.pick(enemy.divePaths);
  const mirror = isRightOfCentre(ctx.formation, enemy.home);
  beginDive(ctx.fleet, enemy, ctx.content, ctx.formation, ctx.rules, path, mirror, ctx.playerAt);
}

/* -------------------------------------------------------------------------- */
/* Enemy fire                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every enemy's bombing decision, on its own phase of the round robin.
 *
 * Two gates beyond the enemy's own delay, both of them the arcade's and both
 * verified. **No entry bombing on stage 1**: an enemy still flying its entry path
 * may only bomb from the stage the pack names (`docs/DESIGN.md` section 4, report
 * test R14). And **continuous bombing when few remain**: once the live enemy
 * count has fallen to the row's `continuousBombingAt` — 6 at stage 1, rising to
 * 12 by stage 22 — the per-dive shot allowance stops limiting and the shorter
 * continuous delay takes over. "The last few get nastier" is that threshold, and
 * it is a count rather than a timer.
 */
function dropBombs(state: DiveState, ctx: AttackContext, alive: number): Enemy[] {
  const { fleet, rules, stage } = ctx;
  const phase = fleet.frame % rules.enemies.updatePhases;
  const continuous = isContinuousBombing(state.row, alive);
  const entryBombing = allowsEntryBombing(rules, stage);
  const vectors = resolveBombVectors(rules, state.row);
  const fired: Enemy[] = [];

  for (const enemy of fleet.enemies) {
    if (enemy.phase !== phase) continue;
    const fire = enemy.fire;
    if (fire === undefined || fire.pattern === 'none') continue;
    if (enemy.state === 'entering' ? !entryBombing : enemy.state !== 'diving') continue;
    if (enemy.bombTimer > 0) continue;
    if (!continuous && enemy.bombsLeft <= 0) continue;

    // The eight-slot pool may be full. The timer stays at zero, so the enemy
    // tries again next time round rather than losing its turn — which is what
    // makes the global cap a rate limit on the whole fleet rather than a
    // silent forfeit for whoever asked at the wrong moment.
    if (bomb(ctx, enemy, 1, vectors) === 0) continue;

    if (!continuous) enemy.bombsLeft -= 1;
    enemy.bombTimer = resolveBombCooldown(rules, fire.cooldownFrames, continuous);
    fired.push(enemy);
  }

  // A `fire` segment on a flight path is the other channel: the pack scripting a
  // shot at a point in the dive rather than leaving it to the timer. It ignores
  // the delay, because the author asked for it there, but not the global cap.
  for (const scripted of ctx.scripted) {
    if (bomb(ctx, scripted.enemy, scripted.count, vectors) > 0) fired.push(scripted.enemy);
  }
  return fired;
}

/**
 * Put up to `count` bullets in the air for one enemy. Returns how many launched.
 *
 * Velocities are fixed at launch, so a bullet aimed at the fighter keeps going
 * where the fighter *was* — the arcade drops bombs, it does not fire homing
 * missiles.
 */
function bomb(ctx: AttackContext, enemy: Enemy, count: number, vectors: readonly number[]): number {
  const fire = enemy.fire;
  if (fire === undefined) return 0;
  const { speed } = ctx.rules.enemies.bullet;
  let launched = 0;

  for (let shot = 0; shot < count; shot += 1) {
    for (const [vx, vy] of bombVelocities(enemy, speed, ctx.playerAt, vectors)) {
      if (launchEnemyBullet(ctx.bullets, enemy.x, enemy.y, vx, vy) !== null) launched += 1;
    }
  }
  return launched;
}

/**
 * The velocity of each bullet one shot puts up.
 *
 * `straight` drops down the screen. `aimed` and `spread` take the direction of
 * the fighter and **snap it to the nearest bombing flight vector** — a bomb
 * travels along one of a fixed set of headings rather than along a heading
 * computed to the pixel, which is both what the original does (reference section
 * 6, parameter 9) and the reason it is dodgeable: an exactly-aimed bomb dropped
 * from above cannot be side-stepped. `spread` then fans one bullet per offset
 * either side of that vector.
 *
 * With no fighter to aim at, everything falls back to straight down, so an enemy
 * bombing while the fighter is off the field is harmless rather than undefined.
 */
function bombVelocities(
  enemy: Enemy,
  speed: number,
  playerAt: Vec2 | undefined,
  vectors: readonly number[],
): readonly Vec2[] {
  const fire = enemy.fire;
  if (fire === undefined || fire.pattern === 'none') return [];

  // Heading 0 points down the screen (`schema.ts`), so "straight" needs no case
  // of its own: it is the aim nobody took.
  let heading = 0;
  if (fire.pattern !== 'straight' && playerAt !== undefined) {
    const dx = playerAt[0] - enemy.x;
    const dy = playerAt[1] - enemy.y;
    if (dx !== 0 || dy !== 0) heading = nearestBombVector(vectors, vectorToHeading(dx, dy));
  }

  const offsets = fire.pattern === 'spread' ? fire.spreadOffsets : [0];
  return offsets.map((offset) => {
    const [dx, dy] = headingToVector(heading + offset);
    return [dx * speed, dy * speed] as Vec2;
  });
}

/* -------------------------------------------------------------------------- */
/* The transform attack                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The once-per-stage transform, and the tell that warns the player about it.
 *
 * Every gate is verified (`docs/reference/arcade-reference.md` section 6, as
 * corrected by report section 7.6): from stage 4, never on a challenge stage,
 * once per stage, and only once **fewer than** ten enemies remain. The target is
 * the first settled enemy of the first role the rules list, which is the arcade's
 * "a bee, or a butterfly if no bees are left".
 *
 * If the chosen enemy is destroyed during its tell, the attempt is **not** spent:
 * the arcade disables the task when the group launches, not when it is chosen.
 */
function stepTransform(
  state: DiveState,
  ctx: AttackContext,
  alive: number,
  out: Enemy[],
): Enemy | undefined {
  const { rules, stage } = ctx;
  const transform = rules.transform;
  if (transform === undefined) return undefined;

  if (state.transformTarget === undefined) {
    if (state.transformsUsed >= transform.perStage) return undefined;
    if (!allowsTransform(rules, stage, alive)) return undefined;
    const target = pickTransformTarget(ctx, transform.fromRoles);
    if (target === undefined) return undefined;
    state.transformTarget = target.id;
    state.transformTell = transform.tellFrames;
    return target;
  }

  const target = ctx.fleet.enemies.find((enemy) => enemy.id === state.transformTarget);
  // Shot during the tell, or dived away from its slot: forget it and try again.
  if (target === undefined || target.state !== 'home') {
    state.transformTarget = undefined;
    return undefined;
  }
  if (state.transformTell > 0) {
    state.transformTell -= 1;
    return undefined;
  }

  out.push(...launchTransformGroup(state, ctx, target));
  state.transformTarget = undefined;
  state.transformsUsed += 1;
  return undefined;
}

/** The first settled enemy of the first listed role, or of any role if none are listed. */
function pickTransformTarget(ctx: AttackContext, fromRoles: readonly string[]): Enemy | undefined {
  const settled = ctx.fleet.enemies.filter((enemy) => enemy.state === 'home');
  if (fromRoles.length === 0) return settled[0];
  for (const role of fromRoles) {
    const found = settled.find((enemy) => enemy.role === role);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Replace one settled enemy with a group of another type, already diving.
 *
 * The group flies abreast, spaced by half the formation's own column pitch, so
 * the spacing comes from the formation rather than from a number invented here.
 * The parent does not die in the scoring sense — it *became* the group — so it
 * leaves the field with no score and no destruction event.
 */
function launchTransformGroup(state: DiveState, ctx: AttackContext, parent: Enemy): Enemy[] {
  const { content, fleet, formation, rules } = ctx;
  const transform = rules.transform;
  const alienId = resolveTransformType(rules, ctx.stage);
  const alien = alienId === undefined ? undefined : content.aliens.get(alienId);
  if (transform === undefined || alien === undefined) return [];

  const paths = alien.dive?.paths ?? [];
  if (paths.length === 0) return [];

  const group: Enemy[] = [];
  const mirror = isRightOfCentre(formation, parent.home);
  const pitch = columnPitch(formation) / 2;
  const middle = (transform.groupSize - 1) / 2;

  parent.state = 'dead';
  fleet.flights.delete(parent.id);
  state.transformGroup.clear();
  state.transformGroupIntact = true;

  for (let index = 0; index < transform.groupSize; index += 1) {
    const spawned = spawnDiver(fleet, alien, content, formation, rules, {
      at: [parent.x + (index - middle) * pitch, parent.y],
      heading: parent.heading,
      home: parent.home,
      wave: parent.wave,
      pathId: ctx.rng.pick(paths),
      mirror,
      playerAt: ctx.playerAt,
    });
    state.transformGroup.add(spawned.id);
    group.push(spawned);
  }
  return group;
}

/** The formation's own column spacing, taken from its resting coordinates. */
function columnPitch(formation: FormationState): number {
  const columns = formation.columnsAtRest;
  if (columns.length < 2) return 0;
  return (columns[1] ?? 0) - (columns[0] ?? 0);
}

/* -------------------------------------------------------------------------- */
/* What a kill means to the director                                            */
/* -------------------------------------------------------------------------- */

/**
 * Tell the director an enemy was destroyed, and collect any bonus it completed.
 *
 * The all-of-them bonus for a transform group is the arcade's, at the group index
 * the stage resolves to (`scoring.transformGroupBonus`). It is a *bonus channel*
 * rather than a score value, which is why it comes back separately from
 * {@link enemyScore} instead of being folded into it.
 */
export function noteDestroyed(state: DiveState, rules: Rules, stage: number, enemy: Enemy): number {
  if (!state.transformGroup.delete(enemy.id)) return 0;
  if (state.transformGroup.size > 0 || !state.transformGroupIntact) return 0;
  return lookup(rules.scoring.transformGroupBonus, transformGroupIndex(rules, stage) ?? 0) ?? 0;
}

/**
 * Tell the director an enemy left the field alive.
 *
 * A transform group with a survivor can never be wholly destroyed, so the bonus
 * is off from that moment — a later kill of the two that stayed must not pay it.
 */
export function noteDeparted(state: DiveState, enemy: Enemy): void {
  if (state.transformGroup.delete(enemy.id)) state.transformGroupIntact = false;
}

/** A single comparable value for the director, for the golden replays. */
export function diveFingerprint(state: DiveState): readonly unknown[] {
  return [
    state.armed,
    state.frame,
    [...state.credit].sort(([a], [b]) => a.localeCompare(b)),
    state.transformsUsed,
    state.transformTarget ?? -1,
    state.transformTell,
    [...state.transformGroup].sort((a, b) => a - b),
    state.transformGroupIntact,
  ];
}
