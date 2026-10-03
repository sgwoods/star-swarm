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
 *
 * **"No sheet" and "a sheet that has never heard of this sprite" are not the
 * same thing**, and treating them as one is how a wiring bug became art. An
 * enemy's sprite id is its own pack's, and `loadPack` has already proved that
 * reference resolves, so a sheet built from that pack cannot be missing it: an
 * absent id means the sheet and the world came from *different* variants, which
 * is a bug and not a pack without art. That case throws (see
 * {@link SceneSheetMismatchError}) rather than drawing a placeholder, because a
 * placeholder is indistinguishable from a deliberate one and the whole Deep Sea
 * fleet drew as squares for a release behind exactly that ambiguity.
 */

import { beamCaptor, beamWindow } from '../sim/capture.js';
import { enemySprite } from '../sim/enemies.js';
import { shipAnchors } from '../sim/player.js';
import type { World } from '../sim/world.js';
import { drawSprite, type SpriteSheet } from './sprites.js';

const PLAYER_COLOR = '#e8eaff';
const PLAYER_ACCENT = '#4d9bff';
const SHOT_COLOR = '#fff6a5';
const BULLET_COLOR = '#ff5a5a';
const BEAM_COLOR = '#7de3ff';
const BEAM_EDGE_COLOR = '#ffffff';

/**
 * Placeholder colours, used only when no sprite sheet was supplied.
 *
 * Exported because they are the signature a test looks for: a placeholder on a
 * screen that should be showing art is the symptom this module's mismatch check
 * exists to stop, and `tests/e2e/variants.spec.ts` proves it from the pixels. No
 * shipped pack declares one — `tests/unit/scene.test.ts` holds that true, so the
 * signature cannot quietly stop being one.
 */
export const ROLE_COLORS: Readonly<Record<string, string>> = Object.freeze({
  drone: '#4fc3f7',
  wing: '#ff7043',
  warden: '#66bb6a',
});

/** Every colour that only ever reaches the screen as a placeholder enemy. */
export const PLACEHOLDER_COLOURS: readonly string[] = Object.freeze(Object.values(ROLE_COLORS));

/** The fighter's sprite id. A pack-facing name would be a rules field; it is not one yet. */
const PLAYER_SPRITE = 'player';

/**
 * A sheet was supplied and does not hold a sprite the world asked for.
 *
 * Its own type so the one thing a caller can do about it — say which sheet is
 * under which world — is in the message rather than guessed from a string.
 */
export class SceneSheetMismatchError extends Error {
  readonly sprite: string;
  readonly available: readonly string[];

  constructor(sprite: string, available: readonly string[]) {
    super(
      `the sprite sheet has no "${sprite}": it was built from a different pack than the world ` +
        `being drawn. The sheet holds: ${available.join(', ')}`,
    );
    this.name = 'SceneSheetMismatchError';
    this.sprite = sprite;
    this.available = available;
  }
}

export interface SceneOptions {
  /** The pack's rasterised sprites. Omitted draws placeholder shapes. */
  readonly sheet?: SpriteSheet;
}

/**
 * The fighter, drawn from its anchor — two ships when it is a dual fighter.
 *
 * Unlike an enemy's, {@link PLAYER_SPRITE} is this file's own constant rather
 * than something a pack declared and the loader checked, so a pack that ships no
 * fighter art is a pack without that sprite — not a mismatched sheet. It gets the
 * placeholder, and the enemies are the half that can tell the two apart.
 */
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
 * The fleet. A `standby` enemy has not launched and a `dead` one is off the
 * field — shot down, or flown away alive — so neither is drawn. The simulation's
 * own state is what decides that, not a flag here.
 *
 * Throws rather than falling back when a sheet is present without the id: see
 * the module comment. With no sheet at all, every enemy is a flat shape.
 */
function drawEnemies(ctx: CanvasRenderingContext2D, world: World, sheet?: SpriteSheet): void {
  for (const enemy of world.fleet.enemies) {
    if (enemy.state === 'standby' || enemy.state === 'dead') continue;
    const id = enemySprite(enemy);
    if (sheet !== undefined) {
      if (!sheet.has(id)) throw new SceneSheetMismatchError(id, sheet.ids);
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

/**
 * The tractor beam, drawn as the shape it is tested against.
 *
 * The window the simulation catches the fighter with *is* the beam, so drawing it
 * from {@link beamWindow} means what the player sees and what can take their ship
 * cannot drift apart. Banding it into the beam's own animation steps is what makes
 * a late-stage beam visibly faster: the steps are the same, the period is shorter.
 */
function drawCaptureBeam(ctx: CanvasRenderingContext2D, world: World): void {
  const beam = beamWindow(world.capture, world.rules);
  const captor = beamCaptor(world.capture, world.fleet);
  if (beam === undefined || captor === undefined) return;

  const { steps } = world.rules.capture.beam;
  const top = captor.y + beam.dyMin;
  const depth = beam.dyMax - beam.dyMin;
  if (depth <= 0) return;

  const bands = Math.max(1, Math.min(steps, world.capture.beamStep));
  const band = depth / bands;
  const centre = captor.x + (beam.dxMin + beam.dxMax) / 2 + 8;

  ctx.save();
  for (let i = 0; i < bands; i += 1) {
    // Widening and fading with depth, with a gap between the bands: a striped cone
    // rather than a slab, which is what the beam looks like and what makes its
    // *extension* legible a band at a time.
    const spread = (i + 1) / bands;
    const halfWidth = ((beam.dxMax - beam.dxMin) / 2) * spread;
    ctx.globalAlpha = 0.9 - 0.45 * spread;
    ctx.fillStyle = BEAM_COLOR;
    ctx.fillRect(centre - halfWidth, top + i * band, halfWidth * 2, Math.max(1, band - 1));
  }
  // The two edges, bright the whole way down, so the cone has a shape at any depth.
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = BEAM_EDGE_COLOR;
  for (const side of [-1, 1]) {
    for (let i = 0; i < bands; i += 1) {
      const spread = (i + 1) / bands;
      const halfWidth = ((beam.dxMax - beam.dxMin) / 2) * spread;
      ctx.fillRect(centre + side * halfWidth, top + i * band, 1, band);
    }
  }
  ctx.restore();
}

/**
 * The freed fighter, spinning where it was released until it docks.
 *
 * It is no longer an enemy by then — that is how "invulnerable to your own shots
 * while it spins" is implemented — so the only place left to draw it from is the
 * capture channel's own pose.
 */
function drawFreedFighter(ctx: CanvasRenderingContext2D, world: World, sheet?: SpriteSheet): void {
  const at = world.capture.freedAt;
  if (at === undefined) return;
  const [x, y] = at;
  if (sheet?.has(PLAYER_SPRITE) === true) {
    drawSprite(ctx, sheet, PLAYER_SPRITE, x, y);
    return;
  }
  ctx.fillStyle = PLAYER_COLOR;
  ctx.fillRect(x + 4, y + 4, 8, 8);
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
  drawCaptureBeam(ctx, world);
  drawEnemies(ctx, world, options.sheet);
  drawShots(ctx, world);
  drawEnemyBullets(ctx, world);
  drawFreedFighter(ctx, world, options.sheet);
  drawPlayer(ctx, world, options.sheet);
}
