/**
 * Drawing the playfield.
 *
 * Nothing here decides anything: it reads a {@link World} and draws it. Which
 * pixels an alien is made of is pack data the sprite pipeline rasterised when the
 * pack loaded (`./sprites.ts`), and which sprite an enemy shows for its current
 * damage comes from the simulation, so this file names no art and no colours of
 * its own beyond the placeholder fallback.
 *
 * The sheet is optional. A caller without one — a test, or a build before the
 * pack has loaded — gets flat shapes: enough to see where everything is,
 * deliberately not enough to be mistaken for finished art.
 */

import { enemySprite } from '../sim/enemies.js';
import { shipAnchors } from '../sim/player.js';
import type { World } from '../sim/world.js';
import { drawSprite, type SpriteSheet } from './sprites.js';

const PLAYER_COLOR = '#e8eaff';
const PLAYER_ACCENT = '#4d9bff';
const SHOT_COLOR = '#fff6a5';
const BULLET_COLOR = '#ff5a5a';

/** Placeholder colours, used only when no sprite sheet was supplied. */
const ROLE_COLORS: Readonly<Record<string, string>> = Object.freeze({
  drone: '#4fc3f7',
  wing: '#ff7043',
  warden: '#66bb6a',
});

/** The fighter's sprite id. A pack-facing name would be a rules field; it is not one yet. */
const PLAYER_SPRITE = 'player';

export interface SceneOptions {
  /** The pack's rasterised sprites. Omitted draws placeholder shapes. */
  readonly sheet?: SpriteSheet;
}

/** The fighter, drawn from its anchor — two ships when it is a dual fighter. */
function drawPlayer(ctx: CanvasRenderingContext2D, world: World, sheet?: SpriteSheet): void {
  if (!world.player.alive) return;
  for (const { x, y } of shipAnchors(world.player, world.rules)) {
    if (sheet?.has(PLAYER_SPRITE) === true) {
      drawSprite(ctx, sheet, PLAYER_SPRITE, x, y);
      continue;
    }
    ctx.fillStyle = PLAYER_COLOR;
    ctx.fillRect(x + 7, y + 2, 2, 6);
    ctx.fillRect(x + 4, y + 8, 8, 4);
    ctx.fillRect(x + 1, y + 12, 14, 3);
    ctx.fillStyle = PLAYER_ACCENT;
    ctx.fillRect(x + 1, y + 9, 3, 3);
    ctx.fillRect(x + 12, y + 9, 3, 3);
  }
}

/**
 * The fleet. A `standby` enemy has not launched and is not on the field, so it
 * is not drawn — the simulation's own state is what decides that, not a flag
 * here.
 */
function drawEnemies(ctx: CanvasRenderingContext2D, world: World, sheet?: SpriteSheet): void {
  for (const enemy of world.fleet.enemies) {
    if (enemy.state === 'standby' || enemy.state === 'dead') continue;
    const id = enemySprite(enemy);
    if (sheet?.has(id) === true) {
      // The wing flap comes from the sprite's own `frameDuration`, so a pack sets
      // the animation speed and the renderer only supplies the clock.
      drawSprite(ctx, sheet, id, enemy.x, enemy.y, sheet.frameAt(id, world.step));
      continue;
    }
    ctx.fillStyle = ROLE_COLORS[enemy.role] ?? '#ffffff';
    ctx.fillRect(enemy.x + 4, enemy.y + 4, 8, 8);
  }
}

function drawShots(ctx: CanvasRenderingContext2D, world: World): void {
  const { muzzleOffsetX, width, height } = world.rules.player.shot;
  ctx.fillStyle = SHOT_COLOR;
  for (const shot of world.shots) {
    if (!shot.active) continue;
    ctx.fillRect(shot.x + muzzleOffsetX, shot.y, width, height);
    // The dual fighter's second bullet, 15 px right — one rocket object, two
    // bullets, exactly as the hardware's double-width flag draws it.
    if (shot.windows.length > 1) {
      ctx.fillRect(
        shot.x + muzzleOffsetX + world.rules.player.secondShipOffsetX,
        shot.y,
        width,
        height,
      );
    }
  }
}

function drawEnemyBullets(ctx: CanvasRenderingContext2D, world: World): void {
  const { width, height } = world.rules.enemies.bullet;
  ctx.fillStyle = BULLET_COLOR;
  for (const bullet of world.enemyBullets) {
    if (!bullet.active) continue;
    ctx.fillRect(Math.round(bullet.x + 4), Math.round(bullet.y), width, height);
  }
}

/** Draw the simulation. Call after the starfield, before the HUD. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  world: World,
  options: SceneOptions = {},
): void {
  drawEnemies(ctx, world, options.sheet);
  drawShots(ctx, world);
  drawEnemyBullets(ctx, world);
  drawPlayer(ctx, world, options.sheet);
}
