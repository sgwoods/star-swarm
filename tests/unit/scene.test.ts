import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listPackDirs, readPackSource } from '../../src/content/fs.js';
import { loadPackOrThrow } from '../../src/content/loader.js';
import type { Sprite } from '../../src/content/schema.js';
import { EMPTY_FRAME } from '../../src/engine/input.js';
import { drawScene, PLACEHOLDER_COLOURS, SceneSheetMismatchError } from '../../src/render/scene.js';
import { createSpriteSheet, type SpriteSheet } from '../../src/render/sprites.js';
import { aliveEnemies, enemySprite } from '../../src/sim/enemies.js';
import type { World } from '../../src/sim/world.js';
import { createWorld, stepWorld } from '../../src/sim/world.js';
import { classicRules, classicStages } from '../helpers/rules.js';

/**
 * `src/render/scene.ts`: which of the two things on screen an enemy is drawn as.
 *
 * The module had no test, and that is how the whole Deep Sea fleet shipped as
 * flat squares. Its placeholder path is a real feature — a caller with no sheet
 * draws a frame with no art — but it was reached by two different conditions
 * wearing one `if`, and only one of them is a feature:
 *
 * - **No sheet at all.** A test, or a build before the pack has loaded. Squares.
 * - **A sheet that does not have this sprite.** An enemy's sprite id comes from
 *   its own pack and `loadPack` has already proved it resolves, so a sheet built
 *   from that pack *cannot* lack it — an absent id means the sheet and the world
 *   were built from different variants. That is a bug, and it now throws.
 *
 * Nothing here asserts what an alien looks like. That is art, and pinning pixels
 * would only make it harder to redraw (same reason `effects.test.ts` does not).
 */

const PACKS_ROOT = resolve(import.meta.dirname, '..', '..', 'packs');

/** The parts of a 2D context this module touches, and nothing else. */
interface Recorded {
  readonly fills: { readonly colour: string; readonly args: readonly number[] }[];
  readonly images: number;
}

function fakeContext(): { ctx: CanvasRenderingContext2D; recorded: Recorded } {
  const fills: { colour: string; args: number[] }[] = [];
  let images = 0;
  const ctx = {
    fillStyle: '',
    globalAlpha: 1,
    save() {},
    restore() {},
    fillRect(this: { fillStyle: string }, ...args: number[]) {
      fills.push({ colour: this.fillStyle, args });
    },
    drawImage() {
      images += 1;
    },
  } as unknown as CanvasRenderingContext2D;
  const recorded: Recorded = {
    fills,
    get images() {
      return images;
    },
  };
  return { ctx, recorded };
}

/**
 * The enemies {@link drawScene} actually draws.
 *
 * Not `aliveEnemies`: that is everything not `dead`, which at step zero is the
 * whole standby fleet waiting to launch. A scene test that counts those is
 * comparing drawing against enemies that are not on the field yet.
 */
function drawnEnemies(world: World): readonly { readonly state: string }[] {
  return world.fleet.enemies.filter((enemy) => enemy.state !== 'standby' && enemy.state !== 'dead');
}

/** A stage-1 Classic world stepped until a few enemies have launched. */
function worldWithEnemies(): World {
  const world = createWorld({
    seed: 'scene',
    rules: classicRules(),
    stages: classicStages(),
  });
  for (let step = 0; step < 1200 && drawnEnemies(world).length === 0; step += 1) {
    stepWorld(world, EMPTY_FRAME);
  }
  expect(drawnEnemies(world).length).toBeGreaterThan(0);
  expect(aliveEnemies(world.fleet.enemies).length).toBeGreaterThan(0);
  return world;
}

/** A one-pixel stand-in, so a sheet can be built without the shipped art. */
const probeSprite = (id: string): Sprite => ({
  id,
  size: 1,
  palette: ['#0000', '#ffffff'],
  frames: [['1']],
});

function sheetOf(ids: readonly string[]): SpriteSheet {
  return createSpriteSheet(
    { sprites: ids.map(probeSprite), palette: ['#ffffff'] },
    { surfaceFactory: (bitmap) => ({ bitmap }) as unknown as CanvasImageSource },
  );
}

/** Every sprite id the enemies on the field could ask for, hits included. */
function spriteIdsOf(world: World): string[] {
  const ids = new Set<string>();
  for (const enemy of world.fleet.enemies) {
    ids.add(enemy.sprite);
    for (const id of enemy.hitSprites) ids.add(id);
  }
  return [...ids];
}

describe('with no sheet at all', () => {
  it('draws a flat placeholder for every enemy on the field', () => {
    const world = worldWithEnemies();
    const { ctx, recorded } = fakeContext();

    drawScene(ctx, world);

    const placeholders = recorded.fills.filter((fill) =>
      PLACEHOLDER_COLOURS.includes(fill.colour.toLowerCase()),
    );
    expect(placeholders.length).toBe(drawnEnemies(world).length);
    // The documented shape: an 8x8 block inset into the 16x16 cell.
    for (const fill of placeholders) expect(fill.args.slice(2)).toEqual([8, 8]);
    expect(recorded.images).toBe(0);
  });
});

describe('with the sheet the world’s own pack built', () => {
  it('draws sprites and not one placeholder', () => {
    const world = worldWithEnemies();
    const { ctx, recorded } = fakeContext();

    drawScene(ctx, world, { sheet: sheetOf(spriteIdsOf(world)) });

    expect(recorded.images).toBeGreaterThanOrEqual(drawnEnemies(world).length);
    const placeholders = recorded.fills.filter((fill) =>
      PLACEHOLDER_COLOURS.includes(fill.colour.toLowerCase()),
    );
    expect(placeholders).toEqual([]);
  });
});

describe('with a sheet built from some other pack', () => {
  /**
   * The failure the captain saw, in one assertion.
   *
   * A sheet that is *present* and does not hold the id can only be another
   * variant's. Drawing a square there is indistinguishable from a deliberate
   * placeholder, which is why it survived a browser test and a recorded clip —
   * so it throws, and names both the sprite and what the sheet does hold.
   */
  it('throws rather than quietly drawing squares', () => {
    const world = worldWithEnemies();
    const { ctx } = fakeContext();
    const foreign = sheetOf(['something-else']);

    expect(() => {
      drawScene(ctx, world, { sheet: foreign });
    }).toThrow(SceneSheetMismatchError);

    const onField = world.fleet.enemies.filter(
      (enemy) => enemy.state !== 'standby' && enemy.state !== 'dead',
    );
    const missing = enemySprite(onField[0] as Parameters<typeof enemySprite>[0]);
    expect(() => {
      drawScene(ctx, world, { sheet: foreign });
    }).toThrow(new RegExp(`no "${missing}"`));
  });

  it('throws for a sheet holding all but one of the ids', () => {
    const world = worldWithEnemies();
    const { ctx } = fakeContext();
    const [dropped, ...kept] = spriteIdsOf(world);
    expect(dropped).toBeDefined();

    expect(() => {
      drawScene(ctx, world, { sheet: sheetOf(kept) });
    }).toThrow(SceneSheetMismatchError);
  });
});

describe('the placeholder colours stay a signature', () => {
  /**
   * `tests/e2e/variants.spec.ts` proves the browser draws art rather than
   * placeholders by looking for these three colours in the canvas. That only
   * means anything while no pack can put one there itself, so this is what holds
   * that premise — a forged pack reaching for `#4fc3f7` would make the pixel test
   * silently stop testing anything.
   */
  it('is used by no shipped pack palette', () => {
    const packs = listPackDirs(PACKS_ROOT).map((dir) => {
      const { source } = readPackSource(dir);
      if (source === undefined) throw new Error(`could not read ${dir}`);
      return loadPackOrThrow(source);
    });
    expect(packs.length).toBeGreaterThan(0);

    for (const pack of packs) {
      for (const colour of pack.manifest.palette) {
        expect(PLACEHOLDER_COLOURS).not.toContain(colour.toLowerCase());
      }
    }
  });
});
