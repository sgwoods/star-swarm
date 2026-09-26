/**
 * The world: one simulation step, start to finish (docs/DESIGN.md sections 4, 9).
 *
 * Everything the game does happens here, in a fixed order, driven by exactly one
 * {@link InputFrame} per step and one seeded generator. No wall clock, no DOM, no
 * canvas, no audio — what happened comes out as a list of {@link SimEvent}s that
 * `src/render/`, `src/ui/` and `src/audio/` read. That is what makes `tests/sim/`
 * able to prove behaviour without a browser, and what makes a recorded run replay
 * to the same state every time.
 *
 * The world is handed two resolved values and loads nothing itself: a `Rules`, and
 * a {@link StageSource} that answers "what plays as stage *n*". Both come from
 * `src/content/`; neither is a pack, a registry or a file, which is what keeps the
 * simulation free of the content layer's plumbing.
 *
 * Milestone 2 scope so far: entry waves, formation sway and breathe, slot homing,
 * and — from the dive task — dive attacks, enemy fire and the difficulty ramp that
 * drives both (`src/sim/dive.ts`). The capture beam, the captured fighter, rescue,
 * the dual fighter and the challenge stages are the sibling tasks that build on
 * this, and are deliberately absent rather than stubbed. The seam the capture task
 * wants is {@link World.dive}: a captor's dive is an ordinary dive with a beam on
 * it, so it launches through the same director and the same `beginDive`.
 */

import { extraLivesEarned, starfieldSpeedByte } from '../content/rules.js';
import type { Rules } from '../content/schema.js';
import type { StageContent, StageSource } from '../content/stages.js';
import { EMPTY_STAGE_SOURCE } from '../content/stages.js';
import { isDown, type InputFrame } from '../engine/input.js';
import { createRng, type Rng, type RngState } from '../engine/rng.js';
import { hitWindowIndex } from './collision.js';
import type { DiveState } from './dive.js';
import {
  armDives,
  createDiveState,
  diveFingerprint,
  noteDeparted,
  noteDestroyed,
  stepAttacks,
} from './dive.js';
import type { Enemy, Fleet } from './enemies.js';
import { aliveEnemies, createFleet, enemyScore, isTargetable, stepFleet } from './enemies.js';
import type { SimEvent } from './events.js';
import type { FormationState } from './formation.js';
import { createFormation, stepFormation } from './formation.js';
import { createLives, type LivesState } from './lives.js';
import type { Vec2 } from './paths.js';
import { createPlayer, type PlayerState, shipAnchors, startX, stepPlayer } from './player.js';
import {
  clearEnemyBullets,
  clearShots,
  createEnemyBullets,
  createShots,
  type EnemyBulletPool,
  fireShot,
  type ShotPool,
  stepEnemyBullets,
  stepShots,
} from './shots.js';

export type WorldStatus = 'playing' | 'game-over';

export interface World {
  /**
   * The rules this run obeys, as the content loader resolved them from a pack.
   * The simulation never loads one: it is handed a value, which is what lets a
   * test swap a single field and watch behaviour follow.
   */
  readonly rules: Rules;
  /** What plays as each stage. Also a value: see the file header. */
  readonly stages: StageSource;
  /**
   * The difficulty rank this run is played at — the cabinet's DIP setting.
   *
   * Rank selects whole data sets rather than scaling one (`docs/DESIGN.md`
   * section 6), so it is carried here and handed to the rules layer on every
   * lookup rather than folded into the rules when they load.
   */
  readonly rank: string | undefined;
  /** Simulation steps run. The only notion of time the sim has. */
  step: number;
  stage: number;
  score: number;
  status: WorldStatus;
  player: PlayerState;
  lives: LivesState;
  shots: ShotPool;
  enemyBullets: EnemyBulletPool;
  /** The stage on the field, or `undefined` when the pack has none for it. */
  content: StageContent | undefined;
  /** The formation's coordinates and their motion. `undefined` with no stage. */
  formation: FormationState | undefined;
  fleet: Fleet;
  /** Dives, enemy fire and the difficulty row in force. Replaced every stage. */
  dive: DiveState;
  rng: Rng;
  /** Events raised by the step just run. Replaced every step, never appended to across steps. */
  events: SimEvent[];
}

export interface WorldOptions {
  /** A loaded pack's rules. Required: the simulation has no rules of its own. */
  readonly rules: Rules;
  /**
   * What plays as each stage, from `createStageSource` in `src/content/`.
   * Omitted means a world with no enemies at all, which is what a test of the
   * player half on its own wants.
   */
  readonly stages?: StageSource;
  readonly seed?: number | string | RngState;
  readonly stage?: number;
  /** The difficulty rank. Omitted means the rules' own `defaultRank`. */
  readonly rank?: string;
}

/** An empty fleet, for a stage the pack has no content for. */
const NO_FLEET: () => Fleet = () => ({
  enemies: [],
  flights: new Map(),
  frame: 0,
  entryComplete: true,
});

export function createWorld(options: WorldOptions): World {
  const { rules } = options;
  const rng = createRng(options.seed ?? 'star-swarm');
  const stage = options.stage ?? rules.stages.firstStage;
  const stages = options.stages ?? EMPTY_STAGE_SOURCE;
  const content = stages.stageFor(stage);

  const world: World = {
    rules,
    stages,
    rank: options.rank,
    step: 0,
    stage,
    score: 0,
    status: 'playing',
    player: createPlayer(rules),
    lives: createLives(rules),
    shots: createShots(rules),
    enemyBullets: createEnemyBullets(rules),
    content,
    formation:
      content === undefined
        ? undefined
        : createFormation(content.formation, rules, content.stage.kind),
    fleet: content === undefined ? NO_FLEET() : createFleet(content, rules),
    dive: createDiveState(rules, stage, options.rank),
    rng,
    events: [],
  };

  world.events = [
    { type: 'stage-started', stage, starfieldSpeed: starfieldSpeedByte(rules, stage) },
    { type: 'player-ready', x: world.player.x, y: world.player.y },
  ];
  return world;
}

/** Add to the score, raising the score event and any extra lives it earns. */
function addScore(world: World, delta: number): void {
  if (delta === 0) return;
  const previous = world.score;
  world.score += delta;
  world.events.push({ type: 'score-changed', score: world.score, delta });

  const awards = extraLivesEarned(world.rules, previous, world.score);
  for (let i = 0; i < awards; i += 1) {
    world.lives.reserve += 1;
    world.lives.bonusesAwarded += 1;
    world.events.push({ type: 'extra-life', lives: world.lives.reserve, score: world.score });
  }
}

/**
 * Player shots against the fleet.
 *
 * The score is read from the enemy's *state*, not from a table: an enemy shot
 * during its entry wave is worth the doubled value and one shot while rotating
 * back into its slot is worth the plain one. See {@link enemyScore}.
 */
function resolvePlayerShots(world: World): void {
  for (const shot of world.shots) {
    if (!shot.active) continue;
    for (const enemy of world.fleet.enemies) {
      if (!isTargetable(enemy)) continue;
      if (hitWindowIndex(shot, enemy, shot.windows, enemy.hitPadding) < 0) continue;

      shot.active = false;
      enemy.hitsRemaining -= 1;
      if (enemy.hitsRemaining > 0) {
        // A two-hit enemy's first hit scores nothing and only changes its
        // colour; the whole value lands on the hit that destroys it.
        world.events.push({
          type: 'target-hit',
          targetId: enemy.id,
          alienId: enemy.alienId,
          x: enemy.x,
          y: enemy.y,
          hitsRemaining: enemy.hitsRemaining,
        });
      } else {
        const score = enemyScore(enemy);
        const bonus = noteDestroyed(world.dive, world.rules, world.stage, enemy);
        enemy.state = 'dead';
        world.fleet.flights.delete(enemy.id);
        world.events.push({
          type: 'target-destroyed',
          targetId: enemy.id,
          alienId: enemy.alienId,
          x: enemy.x,
          y: enemy.y,
          score,
        });
        // The kill and any bonus it completed are two channels, added in that
        // order: every bonus in the game is the same 100-points-per-unit
        // accumulator, and a group bonus is not part of the last member's value.
        addScore(world, score);
        addScore(world, bonus);
      }
      break; // One shot, one target.
    }
  }
}

/** Take a life, and end the game if that was the last one. */
function killPlayer(world: World, x: number, y: number): void {
  world.player.alive = false;
  world.player.respawnTimer = world.rules.player.respawnFrames;
  world.player.stepFlag = 0;
  clearShots(world.shots);
  clearEnemyBullets(world.enemyBullets);

  if (world.lives.reserve <= 0) {
    world.status = 'game-over';
    world.events.push({ type: 'player-hit', x, y, livesRemaining: 0 });
    world.events.push({ type: 'game-over', score: world.score });
    return;
  }

  world.lives.reserve -= 1;
  world.events.push({ type: 'player-hit', x, y, livesRemaining: world.lives.reserve });
}

/** Enemy bullets against the fighter — one test per ship, so a dual has two. */
function resolveEnemyBullets(world: World): void {
  if (!world.player.alive) return;
  const hitWindow = world.rules.player.hitWindow;
  const anchors = shipAnchors(world.player, world.rules);

  for (const bullet of world.enemyBullets) {
    if (!bullet.active) continue;
    for (const anchor of anchors) {
      if (hitWindowIndex(bullet, anchor, [hitWindow]) < 0) continue;
      bullet.active = false;
      killPlayer(world, anchor.x, anchor.y);
      return;
    }
  }
}

/** Bring the next fighter on after a hit. */
function resolveRespawn(world: World): void {
  if (world.player.alive || world.status === 'game-over') return;
  world.player.respawnTimer -= 1;
  if (world.player.respawnTimer > 0) return;
  world.player.respawnTimer = 0;
  world.player.alive = true;
  world.player.x = startX(world.rules, world.player.mode);
  world.events.push({ type: 'player-ready', x: world.player.x, y: world.player.y });
}

/** Load the stage content for `stage`, replacing the formation and the fleet. */
function enterStage(world: World, stage: number): void {
  world.stage = stage;
  world.content = world.stages.stageFor(stage);
  world.formation =
    world.content === undefined
      ? undefined
      : createFormation(world.content.formation, world.rules, world.content.stage.kind);
  world.fleet = world.content === undefined ? NO_FLEET() : createFleet(world.content, world.rules);
  world.dive = createDiveState(world.rules, stage, world.rank);
  world.events.push({
    type: 'stage-started',
    stage,
    starfieldSpeed: starfieldSpeedByte(world.rules, stage),
  });
}

/**
 * Clearing the fleet rolls on to the next stage.
 *
 * A stage the pack has no content for puts no enemies on the field, and the world
 * sits on it rather than rolling forward every frame — "the sequence ran out" is a
 * halt, not an infinite stage counter.
 */
function resolveStageEnd(world: World): void {
  if (world.fleet.enemies.length === 0) return;
  if (aliveEnemies(world.fleet.enemies).length > 0) return;

  world.events.push({ type: 'stage-cleared', stage: world.stage });
  clearShots(world.shots);
  clearEnemyBullets(world.enemyBullets);
  enterStage(world, world.stage + 1);
}

/**
 * Where a dive aims: the fighter's anchor, or nothing while it is off the field.
 *
 * A dual fighter aims at the anchor rather than at either ship, which is the one
 * the arcade's bomb vectors are measured from too.
 */
function playerTarget(world: World): Vec2 | undefined {
  return world.player.alive ? [world.player.x, world.player.y] : undefined;
}

/**
 * The formation's coordinates, then every enemy that addresses them, then the
 * attack the difficulty row asks for.
 *
 * The order is load-bearing three times over. The formation moves first, so an
 * enemy launching this frame predicts its slot from the offset the formation has
 * *now*. The fleet flies next, so a dive launched below is compiled from where
 * the enemy has just arrived. And `formation-settled` arms the dives on its own
 * frame, so nothing peels off a formation that is not yet centred.
 */
function stepEnemies(world: World): void {
  const { content, formation } = world;
  if (content === undefined || formation === undefined) return;

  const settled = stepFormation(formation, world.rules);
  if (settled) {
    world.events.push({
      type: 'formation-settled',
      stage: world.stage,
      enemies: aliveEnemies(world.fleet.enemies).length,
    });
    // Diving begins here — on the frame the sway passes back through zero — and
    // not on the frame the last wave arrived. See `armDives`.
    armDives(world.dive);
  }

  const playerAt = playerTarget(world);
  const step = stepFleet(world.fleet, content, formation, world.rules, playerAt);
  for (const enemy of step.launched) {
    world.events.push({
      type: 'enemy-launched',
      targetId: enemy.id,
      alienId: enemy.alienId,
      wave: enemy.wave,
      x: enemy.x,
      y: enemy.y,
    });
  }
  for (const enemy of step.departed) {
    noteDeparted(world.dive, enemy);
    world.events.push({
      type: 'enemy-departed',
      targetId: enemy.id,
      alienId: enemy.alienId,
      x: enemy.x,
      y: enemy.y,
    });
  }

  const attack = stepAttacks(world.dive, {
    fleet: world.fleet,
    content,
    formation,
    rules: world.rules,
    stage: world.stage,
    rng: world.rng,
    bullets: world.enemyBullets,
    playerAt,
    scripted: step.fired,
  });

  for (const enemy of attack.dived) {
    world.events.push({
      type: 'enemy-dived',
      targetId: enemy.id,
      alienId: enemy.alienId,
      x: enemy.x,
      y: enemy.y,
    });
  }
  for (const enemy of attack.fired) {
    world.events.push({ type: 'enemy-fired', targetId: enemy.id, x: enemy.x, y: enemy.y });
  }
  if (attack.transforming !== undefined) {
    const enemy = attack.transforming;
    world.events.push({
      type: 'enemy-transforming',
      targetId: enemy.id,
      x: enemy.x,
      y: enemy.y,
    });
  }
  if (attack.transformed.length > 0) {
    const first = attack.transformed[0];
    world.events.push({
      type: 'enemy-transformed',
      targetId: attack.transformedFrom ?? -1,
      alienId: first?.alienId ?? '',
      group: attack.transformed.map((enemy) => enemy.id),
    });
  }
}

/**
 * Advance the world by exactly one step and return what happened.
 *
 * The returned array is `world.events`; it is replaced on the next step, so a
 * subscriber that wants to keep events must copy them.
 */
export function stepWorld(world: World, frame: InputFrame): readonly SimEvent[] {
  world.events = [];
  if (world.status === 'game-over') {
    world.step += 1;
    return world.events;
  }

  resolveRespawn(world);
  stepPlayer(world.player, frame, world.rules);

  // No edge detection: holding fire fires whenever a slot is free. The cap and
  // the flight time are the whole of the fire rate.
  if (world.player.alive && isDown(frame, 'fire')) {
    const shot = fireShot(
      world.shots,
      world.player.x,
      world.player.y,
      world.player.mode,
      world.rules,
    );
    if (shot !== null) {
      world.events.push({ type: 'shot-fired', slot: shot.slot, x: shot.x, y: shot.y });
    }
  }

  stepEnemies(world);

  stepShots(world.shots, world.rules);
  resolvePlayerShots(world);

  stepEnemyBullets(world.enemyBullets, world.rules);
  resolveEnemyBullets(world);

  resolveStageEnd(world);

  world.step += 1;
  return world.events;
}

/** One enemy, reduced to the numbers a golden replay has to agree on. */
function enemyFingerprint(enemy: Enemy): readonly (string | number)[] {
  return [
    enemy.id,
    enemy.state,
    enemy.home,
    enemy.hitsRemaining,
    enemy.x,
    enemy.y,
    enemy.pathFrame,
    // The bomb delay and the per-run allowance are the whole of enemy fire, so a
    // run that agreed on positions but not on these would diverge a second later.
    enemy.bombTimer,
    enemy.bombsLeft,
  ];
}

/**
 * A single comparable value for the whole simulation state.
 *
 * Used by the golden replay tests: two runs that agree on this agree on
 * everything the simulation carries, including the RNG's position, which is what
 * catches a change that only shows up several thousand draws later.
 */
export function fingerprintWorld(world: World): string {
  return JSON.stringify({
    step: world.step,
    stage: world.stage,
    score: world.score,
    status: world.status,
    player: world.player,
    lives: world.lives,
    shots: world.shots.map(({ slot, active, x, y }) => [slot, active, x, y]),
    bullets: world.enemyBullets.map(({ slot, active, x, y, vx, vy }) => [
      slot,
      active,
      x,
      y,
      vx,
      vy,
    ]),
    dive: diveFingerprint(world.dive),
    formation: world.formation && [
      world.formation.frame,
      world.formation.motion,
      world.formation.swayOffset,
      world.formation.swayDirection,
      world.formation.breatheStep,
      world.formation.breatheDirection,
      world.formation.entryComplete,
    ],
    fleet: [world.fleet.frame, world.fleet.entryComplete],
    enemies: world.fleet.enemies.map(enemyFingerprint),
    rng: world.rng.getState(),
  });
}
