/**
 * Placeholder playfield art.
 *
 * Milestone 1's sprite-pipeline task turns pack data into cached bitmaps and
 * gives the fighter, the aliens and the explosions their real 16x16 designs.
 * Until it lands, the playable core still has to be playable, so this file draws
 * the simulation as flat shapes: enough to see where everything is, deliberately
 * not enough to be mistaken for finished art.
 *
 * Nothing here decides anything. It reads a {@link World} and draws it.
 */

import { shipAnchors } from '../sim/player.js';
import type { World } from '../sim/world.js';

const PLAYER_COLOR = '#e8eaff';
const PLAYER_ACCENT = '#4d9bff';
const SHOT_COLOR = '#fff6a5';
const BULLET_COLOR = '#ff5a5a';

const ROLE_COLORS: Readonly<Record<string, string>> = Object.freeze({
  drone: '#4fc3f7',
  wing: '#ff7043',
  warden: '#66bb6a',
});

/** The fighter, drawn from its anchor — two ships when it is a dual fighter. */
function drawPlayer(ctx: CanvasRenderingContext2D, world: World): void {
  if (!world.player.alive) return;
  for (const { x, y } of shipAnchors(world.player, world.rules)) {
    ctx.fillStyle = PLAYER_COLOR;
    ctx.fillRect(x + 7, y + 2, 2, 6);
    ctx.fillRect(x + 4, y + 8, 8, 4);
    ctx.fillRect(x + 1, y + 12, 14, 3);
    ctx.fillStyle = PLAYER_ACCENT;
    ctx.fillRect(x + 1, y + 9, 3, 3);
    ctx.fillRect(x + 12, y + 9, 3, 3);
  }
}

function drawTargets(ctx: CanvasRenderingContext2D, world: World): void {
  for (const target of world.targets) {
    if (!target.alive) continue;
    ctx.fillStyle = ROLE_COLORS[target.role] ?? '#ffffff';
    ctx.fillRect(target.x, target.y, 8, 8);
    // A warden that has taken its first hit changes colour, as a boss does.
    if (target.role === 'warden' && target.hitsRemaining < 2) {
      ctx.fillStyle = '#4050ff';
      ctx.fillRect(target.x + 1, target.y + 1, 6, 6);
    }
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
export function drawScene(ctx: CanvasRenderingContext2D, world: World): void {
  drawTargets(ctx, world);
  drawShots(ctx, world);
  drawEnemyBullets(ctx, world);
  drawPlayer(ctx, world);
}
