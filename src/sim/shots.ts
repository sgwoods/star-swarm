/**
 * Player shots and the two-slot cap (docs/DESIGN.md section 4, "Player").
 *
 * The cap is the game's metronome. The original has exactly **two** rocket
 * slots: the fire handler checks slot 0, then slot 1, and returns without firing
 * if both are occupied. Two *in total* — not two per ship. A dual fighter still
 * gets two shots in flight; each one is a single rocket object drawn
 * double-width, which is why {@link fireShot} takes the fighter mode and puts
 * the mode's hit windows on the shot rather than changing how many slots exist.
 * Milestone 2 turns the dual fighter on by setting `player.mode`, and this file
 * does not change.
 *
 * There is no edge detection either: holding fire fires continuously, so the
 * rate is set entirely by the cap and by how fast shots leave the screen.
 */

import { shotWindowsFor } from '../content/rules.js';
import type { FighterMode, HitWindow, Rules } from '../content/schema.js';

export interface Shot {
  /** Slot index; stable for the life of the pool, and reported in events. */
  readonly slot: number;
  active: boolean;
  /** Anchor, matching the fighter's: the hit windows are measured from it. */
  x: number;
  y: number;
  /** Windows this shot tests against, fixed at the moment it was fired. */
  windows: readonly HitWindow[];
}

/** The slot pool. Exactly `player.maxShots` slots exist, for the whole run. */
export type ShotPool = Shot[];

export function createShots(rules: Rules): ShotPool {
  return Array.from({ length: rules.player.maxShots }, (_unused, slot) => ({
    slot,
    active: false,
    x: 0,
    y: 0,
    windows: shotWindowsFor(rules, 'single'),
  }));
}

/** How many shots are in flight. */
export function shotsInFlight(shots: ShotPool): number {
  return shots.reduce((count, shot) => count + (shot.active ? 1 : 0), 0);
}

/** The first free slot, in the ROM's order — slot 0, then slot 1 — or null. */
export function freeSlot(shots: ShotPool): Shot | null {
  for (const shot of shots) {
    if (!shot.active) return shot;
  }
  return null;
}

/**
 * Fire, if a slot is free. Returns the shot, or `null` when the cap refuses it.
 *
 * `x` and `y` are the firing fighter's anchor; the shot keeps that anchor so
 * collision offsets stay in one coordinate system. Where the muzzle *looks* like
 * it is comes from `player.shot.muzzleOffsetX` and belongs to the renderer.
 */
export function fireShot(
  shots: ShotPool,
  x: number,
  y: number,
  mode: FighterMode,
  rules: Rules,
): Shot | null {
  const shot = freeSlot(shots);
  if (shot === null) return null;
  shot.active = true;
  shot.x = x;
  shot.y = y;
  shot.windows = shotWindowsFor(rules, mode);
  return shot;
}

/** Move every shot up one step, retiring the ones that leave the top. */
export function stepShots(shots: ShotPool, rules: Rules): void {
  const { speed, height } = rules.player.shot;
  for (const shot of shots) {
    if (!shot.active) continue;
    shot.y -= speed;
    if (shot.y + height < 0) shot.active = false;
  }
}

/** Free a slot — on a hit, or when the stage ends. */
export function retireShot(shot: Shot): void {
  shot.active = false;
}

/** Free every slot. */
export function clearShots(shots: ShotPool): void {
  for (const shot of shots) shot.active = false;
}

/* -------------------------------------------------------------------------- */
/* Enemy bullets                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Enemy bullets share this file because they share the rule that shapes them: a
 * hard global cap on how many exist. The player's is 2; the enemies' is **8, and
 * it is global rather than per enemy**. It is easy to overlook and it is a
 * first-order contributor to how the game feels, so like the player's cap it is
 * a fixed pool rather than an array that grows.
 */
export interface EnemyBullet {
  readonly slot: number;
  active: boolean;
  x: number;
  y: number;
  /** Fixed at launch, so a Milestone 2 aimed shot needs no new plumbing. */
  vx: number;
  vy: number;
}

export type EnemyBulletPool = EnemyBullet[];

export function createEnemyBullets(rules: Rules): EnemyBulletPool {
  return Array.from({ length: rules.enemies.maxBullets }, (_unused, slot) => ({
    slot,
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  }));
}

/** Launch a bullet, if the global cap allows it. */
export function launchEnemyBullet(
  bullets: EnemyBulletPool,
  x: number,
  y: number,
  vx: number,
  vy: number,
): EnemyBullet | null {
  const bullet = bullets.find((candidate) => !candidate.active);
  if (bullet === undefined) return null;
  bullet.active = true;
  bullet.x = x;
  bullet.y = y;
  bullet.vx = vx;
  bullet.vy = vy;
  return bullet;
}

/** Advance every bullet one step, retiring the ones that leave the playfield. */
export function stepEnemyBullets(bullets: EnemyBulletPool, rules: Rules): void {
  const { width, height } = rules.playfield;
  for (const bullet of bullets) {
    if (!bullet.active) continue;
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    if (bullet.y > height || bullet.y < -8 || bullet.x < -8 || bullet.x > width) {
      bullet.active = false;
    }
  }
}

export function clearEnemyBullets(bullets: EnemyBulletPool): void {
  for (const bullet of bullets) bullet.active = false;
}

export function bulletsInFlight(bullets: EnemyBulletPool): number {
  return bullets.reduce((count, bullet) => count + (bullet.active ? 1 : 0), 0);
}
