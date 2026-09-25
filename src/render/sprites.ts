/**
 * The sprite pipeline: pack sprite data → cached bitmaps (`docs/DESIGN.md`
 * sections 5 and 7.4).
 *
 * **Caching is the point.** A 16x16 sprite is 256 palette lookups; a stage has
 * 40 aliens plus shots and explosions, at 60 fps. Rasterising per frame would
 * not hold the section 11 performance bar, so every frame of every sprite is
 * rasterised exactly once when the sheet is built and handed back by reference
 * from then on. {@link SpriteSheet.bitmap} returns the *same* object each call —
 * callers may read it but must not write to it.
 *
 * **The palette is pack data.** There are no colours in this file. A pack
 * declares its global palette in `pack.json` (`docs/DESIGN.md` section 5:
 * saturated arcade colours on black, one palette per pack), and every colour a
 * sprite names has to be one the pack defined. A sprite that reaches for a
 * colour the pack does not have is a **load-time error** — {@link
 * createSpriteSheet} throws before a frame is ever drawn, rather than letting a
 * silent black pixel reach the screen and be mistaken for art.
 *
 * Nothing here touches the DOM until a caller asks for a drawable surface, so
 * the whole rasteriser is testable headlessly on Node (`tests/unit/sprites.test.ts`).
 * This is `src/render/`: it subscribes to simulation state, and `src/sim/` never
 * imports it (`docs/DESIGN.md` section 9, enforced in `eslint.config.js`).
 */

import type { Sprite } from '../content/schema.js';

/** Bytes per pixel in a {@link Bitmap}. RGBA, straight (not premultiplied) alpha. */
const CHANNELS = 4;

/**
 * A rasterised image: plain numbers, no canvas, so it exists on Node too.
 *
 * The layout is exactly what `ImageData` wants, which is what makes turning one
 * into a drawable surface a copy rather than a conversion.
 */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major, `width * height * 4` bytes. Treat as read-only. */
  readonly data: Uint8ClampedArray;
}

/** A colour split into channels. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Everything wrong with a sheet, in one throw.
 *
 * One problem at a time would mean one rebuild per bad colour; a pack author
 * fixing generated content wants the whole list (the same reason
 * `src/content/errors.ts` reports every Zod issue rather than the first).
 */
export class SpriteSheetError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`sprite sheet could not be built:\n  ${problems.join('\n  ')}`);
    this.name = 'SpriteSheetError';
    this.problems = problems;
  }
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                       */
/* -------------------------------------------------------------------------- */

const COLOUR_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Parse one of the four forms `colourSchema` admits. Returns `undefined` rather
 * than throwing so callers can gather problems instead of stopping at the first.
 */
export function parseColour(colour: string): Rgba | undefined {
  if (!COLOUR_PATTERN.test(colour)) return undefined;
  const body = colour.slice(1);
  const wide = body.length <= 4 ? [...body].map((char) => char + char).join('') : body;
  const byte = (at: number): number => Number.parseInt(wide.slice(at, at + 2), 16);
  return { r: byte(0), g: byte(2), b: byte(4), a: wide.length === 8 ? byte(6) : 255 };
}

/**
 * The key two colours are compared by. `#f00`, `#ff0000` and `#ff0000ff` are the
 * same colour written three ways, and a pack that defines one has defined all
 * three — comparing the strings would call that a missing colour.
 */
function colourKey(colour: Rgba): string {
  return `${String(colour.r)},${String(colour.g)},${String(colour.b)},${String(colour.a)}`;
}

/* -------------------------------------------------------------------------- */
/* Rasterising                                                                  */
/* -------------------------------------------------------------------------- */

/** A sprite row character to its index into the sprite's own palette. */
function paletteIndexOf(char: string): number {
  return char === '.' ? 0 : Number.parseInt(char, 16);
}

/**
 * Rasterise one animation frame. Pure: same input, same pixels, no host objects.
 *
 * Exported for tests and for one-off uses such as the contact sheet script;
 * game code goes through a {@link SpriteSheet} so the work happens once.
 */
export function rasteriseFrame(sprite: Sprite, frameIndex: number): Bitmap {
  const problems: string[] = [];
  const colours = resolveSpritePalette(sprite, undefined, problems);
  if (problems.length > 0) throw new SpriteSheetError(problems);
  const bitmap = rasterise(sprite, frameIndex, colours, problems);
  if (problems.length > 0) throw new SpriteSheetError(problems);
  return bitmap;
}

/**
 * Resolve a sprite's palette to channels, checking it against the pack's.
 *
 * `packColours` is the set of colours the pack declared, keyed by
 * {@link colourKey}; passing `undefined` skips the pack check, which is only for
 * a sprite being rasterised outside a pack.
 */
function resolveSpritePalette(
  sprite: Sprite,
  packColours: ReadonlyMap<string, number> | undefined,
  problems: string[],
): Rgba[] {
  return sprite.palette.map((colour, index) => {
    const parsed = parseColour(colour);
    if (parsed === undefined) {
      problems.push(`sprite "${sprite.id}" palette[${String(index)}]: "${colour}" is not a colour`);
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    // Fully transparent is the "no pixel" entry, not a colour the pack has to
    // have declared: index 0 is conventionally clear (see `colourSchema`).
    if (packColours !== undefined && parsed.a > 0 && !packColours.has(colourKey(parsed))) {
      problems.push(
        `sprite "${sprite.id}" palette[${String(index)}]: "${colour}" is not in the pack palette`,
      );
    }
    return parsed;
  });
}

/** Paint one frame's rows into a fresh RGBA buffer. */
function rasterise(
  sprite: Sprite,
  frameIndex: number,
  colours: readonly Rgba[],
  problems: string[],
): Bitmap {
  const { size } = sprite;
  const data = new Uint8ClampedArray(size * size * CHANNELS);
  const rows = sprite.frames[frameIndex];
  if (rows === undefined) {
    problems.push(`sprite "${sprite.id}" has no frame ${String(frameIndex)}`);
    return { width: size, height: size, data };
  }

  for (let y = 0; y < size; y += 1) {
    const row = rows[y] ?? '';
    for (let x = 0; x < size; x += 1) {
      const index = paletteIndexOf(row[x] ?? '.');
      const colour = colours[index];
      if (colour === undefined) {
        // The schema rejects this, so reaching it means a sprite arrived from
        // somewhere else. Say so rather than painting an accidental black pixel.
        problems.push(
          `sprite "${sprite.id}" frame ${String(frameIndex)} row ${String(y)}: palette index ` +
            `${String(index)} is not defined by this sprite`,
        );
        continue;
      }
      if (colour.a === 0) continue;
      const at = (y * size + x) * CHANNELS;
      data[at] = colour.r;
      data[at + 1] = colour.g;
      data[at + 2] = colour.b;
      data[at + 3] = colour.a;
    }
  }

  return { width: size, height: size, data };
}

/* -------------------------------------------------------------------------- */
/* Animation                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Which animation frame a sprite is showing on a given simulation step.
 *
 * Deterministic by construction: the step counter is the only input, so two runs
 * of the same replay show the same wing position (`docs/DESIGN.md` pillar 4).
 * There is no wall clock anywhere in this file.
 */
export function frameIndexAt(frameCount: number, step: number, frameDuration: number): number {
  if (frameCount <= 1) return 0;
  const held = Math.max(1, Math.trunc(frameDuration));
  const at = Math.max(0, Math.trunc(step));
  return Math.floor(at / held) % frameCount;
}

/* -------------------------------------------------------------------------- */
/* Drawable surfaces                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Turns a bitmap into something `ctx.drawImage` accepts.
 *
 * Injectable so the cache can be tested on Node, where there is no canvas at
 * all — the unit tests hand in a stub and check that a surface is built once.
 */
export type SurfaceFactory = (bitmap: Bitmap) => CanvasImageSource;

/**
 * The default factory: a canvas per frame, written through `ImageData`.
 *
 * A canvas per frame rather than one packed atlas because the whole set is a few
 * hundred kilobytes and `drawImage` from separate canvases is not measurably
 * slower; the atlas can come later if section 11's budget ever says so.
 */
export function createCanvasSurface(bitmap: Bitmap): CanvasImageSource {
  const { width, height, data } = bitmap;
  if (typeof document === 'undefined') {
    throw new Error(
      'no DOM: sprite surfaces need a canvas. Pass a SurfaceFactory to createSpriteSheet, ' +
        'or stay on bitmap() outside the browser.',
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D context unavailable for a sprite surface');
  ctx.imageSmoothingEnabled = false;
  // `ImageData` copies, so the cached bitmap stays the authority on the pixels.
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

/* -------------------------------------------------------------------------- */
/* The sheet                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What a sheet is built from: the pack's sprites and the pack's palette.
 *
 * Deliberately not a `ContentRegistry` — the pipeline needs two fields, and
 * taking the registry would tie `src/render/` to the shape of the content layer
 * for no gain. From a registry, call
 * `createSpriteSheet({ sprites: registry.sprites.values(), palette: registry.manifest.palette })`.
 */
export interface SpriteSheetSource {
  readonly sprites: Iterable<Sprite>;
  /** The pack-wide palette. Every colour a sprite uses must appear here. */
  readonly palette: readonly string[];
}

export interface SpriteSheetOptions {
  /** How a cached bitmap becomes drawable. Defaults to {@link createCanvasSurface}. */
  readonly surfaceFactory?: SurfaceFactory;
}

export interface SpriteSheet {
  /** Every sprite id in the sheet, in the order they were given. */
  readonly ids: readonly string[];
  has(id: string): boolean;
  /** How many animation frames a sprite has: 2 for a wing flap, 4 for an explosion. */
  frameCount(id: string): number;
  /** The sprite's own `frameDuration`, or `fallback` when it left the choice to the caller. */
  frameDuration(id: string, fallback: number): number;
  /**
   * The cached bitmap for one frame. The **same instance** every call; do not
   * mutate it. Throws for an unknown id or frame — a typo in a sprite reference
   * is a bug, not a reason to draw nothing.
   */
  bitmap(id: string, frame?: number): Bitmap;
  /** {@link bitmap}, as something `drawImage` accepts. Cached the same way. */
  surface(id: string, frame?: number): CanvasImageSource;
  /** The animation frame for a simulation step, honouring the sprite's `frameDuration`. */
  frameAt(id: string, step: number, fallbackDuration?: number): number;
}

interface CachedSprite {
  readonly sprite: Sprite;
  readonly bitmaps: readonly Bitmap[];
  readonly surfaces: (CanvasImageSource | undefined)[];
}

/**
 * Build the sheet: validate every sprite against the pack palette, rasterise
 * every frame once, and cache the lot.
 *
 * Validation and rasterising are both eager, so a bad palette entry surfaces
 * when the pack loads rather than the first time that alien dives, and no frame
 * ever costs a rasterise mid-game.
 */
export function createSpriteSheet(
  source: SpriteSheetSource,
  options: SpriteSheetOptions = {},
): SpriteSheet {
  const { surfaceFactory = createCanvasSurface } = options;
  const problems: string[] = [];

  const packColours = new Map<string, number>();
  source.palette.forEach((colour, index) => {
    const parsed = parseColour(colour);
    if (parsed === undefined) {
      problems.push(`pack palette[${String(index)}]: "${colour}" is not a colour`);
      return;
    }
    if (!packColours.has(colourKey(parsed))) packColours.set(colourKey(parsed), index);
  });

  const cache = new Map<string, CachedSprite>();
  const ids: string[] = [];

  for (const sprite of source.sprites) {
    if (cache.has(sprite.id)) {
      problems.push(`sprite "${sprite.id}" is defined twice in this sheet`);
      continue;
    }
    const colours = resolveSpritePalette(sprite, packColours, problems);
    const bitmaps = sprite.frames.map((_frame, index) =>
      rasterise(sprite, index, colours, problems),
    );
    cache.set(sprite.id, { sprite, bitmaps, surfaces: bitmaps.map(() => undefined) });
    ids.push(sprite.id);
  }

  if (problems.length > 0) throw new SpriteSheetError(problems);

  const lookup = (id: string): CachedSprite => {
    const entry = cache.get(id);
    if (entry === undefined) throw new Error(`no sprite "${id}" in this sheet`);
    return entry;
  };

  const requireFrame = (entry: CachedSprite, frame: number): number => {
    if (!Number.isInteger(frame) || frame < 0 || frame >= entry.bitmaps.length) {
      throw new RangeError(
        `sprite "${entry.sprite.id}" has ${String(entry.bitmaps.length)} frame(s); ` +
          `asked for ${String(frame)}`,
      );
    }
    return frame;
  };

  return {
    ids,
    has: (id) => cache.has(id),
    frameCount: (id) => lookup(id).bitmaps.length,
    frameDuration: (id, fallback) => lookup(id).sprite.frameDuration ?? fallback,
    bitmap(id, frame = 0) {
      const entry = lookup(id);
      // Non-null: requireFrame has already proved the index is in range.
      return entry.bitmaps[requireFrame(entry, frame)] as Bitmap;
    },
    surface(id, frame = 0) {
      const entry = lookup(id);
      const index = requireFrame(entry, frame);
      const existing = entry.surfaces[index];
      if (existing !== undefined) return existing;
      const built = surfaceFactory(entry.bitmaps[index] as Bitmap);
      entry.surfaces[index] = built;
      return built;
    },
    frameAt(id, step, fallbackDuration = 1) {
      const entry = lookup(id);
      const held = entry.sprite.frameDuration ?? fallbackDuration;
      return frameIndexAt(entry.bitmaps.length, step, held);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                      */
/* -------------------------------------------------------------------------- */

/** Draw a sprite with its top-left corner at `(x, y)`. Coordinates are rounded. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  id: string,
  x: number,
  y: number,
  frame = 0,
): void {
  ctx.drawImage(sheet.surface(id, frame), Math.round(x), Math.round(y));
}

/**
 * Draw a sprite centred on `(x, y)`, which is how the simulation carries
 * positions: an entity has a centre, not a corner.
 */
export function drawSpriteCentred(
  ctx: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  id: string,
  x: number,
  y: number,
  frame = 0,
): void {
  const bitmap = sheet.bitmap(id, frame);
  drawSprite(ctx, sheet, id, x - bitmap.width / 2, y - bitmap.height / 2, frame);
}
