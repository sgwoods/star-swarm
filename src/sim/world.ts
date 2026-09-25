/**
 * The world: one simulation step, start to finish (docs/DESIGN.md sections 4, 9).
 *
 * Everything the playable core does happens here, in a fixed order, driven by
 * exactly one {@link InputFrame} per step and one seeded generator. No wall
 * clock, no DOM, no canvas, no audio — what happened comes out as a list of
 * {@link SimEvent}s that `src/render/`, `src/ui/` and `src/audio/` read. That is
 * what makes `tests/sim/` able to prove behaviour without a browser, and what
 * makes a recorded run replay to the same state every time.
 *
 * Milestone 1 scope: the player half. Enemies are a static stand-in
 * (`targets.ts`); entry waves, dives, capture and challenge stages are
 * Milestone 2 and are deliberately absent rather than stubbed.
 */

import { extraLivesEarned, starfieldSpeedByte } from '../content/rules.js';
import type { Rules } from '../content/schema.js';
import { isDown, type InputFrame } from '../engine/input.js';
import { createRng, type Rng, type RngState } from '../engine/rng.js';
import { hitWindowIndex } from './collision.js';
import type { SimEvent } from './events.js';
import { createLives, type LivesState } from './lives.js';
import { createPlayer, type PlayerState, shipAnchors, startX, stepPlayer } from './player.js';
import {
  clearEnemyBullets,
  clearShots,
  createEnemyBullets,
  createShots,
  type EnemyBulletPool,
  fireShot,
  launchEnemyBullet,
  type ShotPool,
  stepEnemyBullets,
  stepShots,
} from './shots.js';
import {
  aliveTargets,
  createStandInFormation,
  STAND_IN_FIRE_RATE,
  type Target,
} from './targets.js';

export type WorldStatus = 'playing' | 'game-over';

export interface World {
  /**
   * The rules this run obeys, as the content loader resolved them from a pack.
   * The simulation never loads one: it is handed a value, which is what lets a
   * test swap a single field and watch behaviour follow.
   */
  readonly rules: Rules;
  /** @see STAND_IN_FIRE_RATE — Milestone 1 scaffolding, and it goes with it. */
  readonly standInFireRate: number;
  /** Simulation steps run. The only notion of time the sim has. */
  step: number;
  stage: number;
  score: number;
  status: WorldStatus;
  player: PlayerState;
  lives: LivesState;
  shots: ShotPool;
  enemyBullets: EnemyBulletPool;
  targets: Target[];
  rng: Rng;
  /** Events raised by the step just run. Replaced every step, never appended to across steps. */
  events: SimEvent[];
}

export interface WorldOptions {
  /** A loaded pack's rules. Required: the simulation has no rules of its own. */
  readonly rules: Rules;
  readonly seed?: number | string | RngState;
  readonly stage?: number;
  /** @see STAND_IN_FIRE_RATE */
  readonly standInFireRate?: number;
}

export function createWorld(options: WorldOptions): World {
  const { rules } = options;
  const rng = createRng(options.seed ?? 'star-swarm');
  const stage = options.stage ?? rules.stages.firstStage;
  const standInFireRate = options.standInFireRate ?? STAND_IN_FIRE_RATE;

  const world: World = {
    rules,
    standInFireRate,
    step: 0,
    stage,
    score: 0,
    status: 'playing',
    player: createPlayer(rules),
    lives: createLives(rules),
    shots: createShots(rules),
    enemyBullets: createEnemyBullets(rules),
    targets: createStandInFormation(rng, { fireRate: standInFireRate }),
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

/** Player shots against the formation. */
function resolvePlayerShots(world: World): void {
  for (const shot of world.shots) {
    if (!shot.active) continue;
    for (const target of world.targets) {
      if (!target.alive) continue;
      if (hitWindowIndex(shot, target, shot.windows, target.hitPadding) < 0) continue;

      shot.active = false;
      target.hitsRemaining -= 1;
      if (target.hitsRemaining > 0) {
        world.events.push({
          type: 'target-hit',
          targetId: target.id,
          x: target.x,
          y: target.y,
          hitsRemaining: target.hitsRemaining,
        });
      } else {
        target.alive = false;
        world.events.push({
          type: 'target-destroyed',
          targetId: target.id,
          x: target.x,
          y: target.y,
          score: target.score,
        });
        addScore(world, target.score);
      }
      break; // One shot, one target.
    }
  }
}

/** The stand-in formation shooting back, inside the global 8-bullet cap. */
function fireEnemyBullets(world: World): void {
  const { speed } = world.rules.enemies.bullet;
  for (const target of world.targets) {
    if (!target.alive || target.fireIntervalSteps === 0) continue;
    target.fireTimer -= 1;
    if (target.fireTimer > 0) continue;
    target.fireTimer = target.fireIntervalSteps;

    // The cap is global and hard: a refused launch simply does not happen, which
    // is what stops a full formation drowning the screen.
    const bullet = launchEnemyBullet(world.enemyBullets, target.x, target.y + 8, 0, speed);
    if (bullet === null) continue;
    world.events.push({ type: 'enemy-fired', targetId: target.id, x: bullet.x, y: bullet.y });
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

/** Clearing the stand-in formation rolls on to the next stage. */
function resolveStageEnd(world: World): void {
  if (aliveTargets(world.targets).length > 0) return;
  world.events.push({ type: 'stage-cleared', stage: world.stage });
  world.stage += 1;
  clearShots(world.shots);
  clearEnemyBullets(world.enemyBullets);
  world.targets = createStandInFormation(world.rng, { fireRate: world.standInFireRate });
  world.events.push({
    type: 'stage-started',
    stage: world.stage,
    starfieldSpeed: starfieldSpeedByte(world.rules, world.stage),
  });
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

  stepShots(world.shots, world.rules);
  resolvePlayerShots(world);

  fireEnemyBullets(world);
  stepEnemyBullets(world.enemyBullets, world.rules);
  resolveEnemyBullets(world);

  resolveStageEnd(world);

  world.step += 1;
  return world.events;
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
    targets: world.targets.map(({ id, alive, hitsRemaining, fireTimer }) => [
      id,
      alive,
      hitsRemaining,
      fireTimer,
    ]),
    rng: world.rng.getState(),
  });
}
