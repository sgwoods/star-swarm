import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { readPackSource } from '../../src/content/fs.js';
import type { LoadedPack } from '../../src/content/loader.js';
import { loadPack } from '../../src/content/loader.js';
import type { Sprite } from '../../src/content/schema.js';
import { spriteSchema } from '../../src/content/schema.js';
import type { Bitmap, SpriteSheet } from '../../src/render/sprites.js';
import {
  createSpriteSheet,
  drawSprite,
  drawSpriteCentred,
  frameIndexAt,
  parseColour,
  rasteriseFrame,
  SpriteSheetError,
} from '../../src/render/sprites.js';

/**
 * The sprite pipeline, tested where it lives: on Node, with no canvas anywhere.
 * That is the point of splitting the rasteriser from the drawable surface —
 * pixels are a pure function of pack data, so they can be asserted exactly.
 */

const PACK_DIR = resolve(import.meta.dirname, '..', '..', 'packs', 'classic');

/** A two-frame 4x4 sprite: small enough to write the expected pixels out in full. */
const TOY = spriteSchema.parse({
  id: 'toy',
  size: 4,
  palette: ['#0000', '#ff0000', '#00ff0080'],
  frameDuration: 3,
  frames: [
    ['1..2', '....', '....', '2..1'],
    ['....', '.12.', '.21.', '....'],
  ],
});

/** The pack palette a toy sheet is checked against. */
const TOY_PALETTE = ['#0000', '#ff0000', '#00ff0080'];

/** Read one pixel as `[r, g, b, a]`. */
function pixel(bitmap: Bitmap, x: number, y: number): number[] {
  const at = (y * bitmap.width + x) * 4;
  return [...bitmap.data.slice(at, at + 4)];
}

/** Every pixel as a palette-ish sketch, so a whole frame can be asserted at once. */
function sketch(bitmap: Bitmap): string[] {
  const rows: string[] = [];
  for (let y = 0; y < bitmap.height; y += 1) {
    const cells: string[] = [];
    for (let x = 0; x < bitmap.width; x += 1) {
      const [r, g, b, a] = pixel(bitmap, x, y);
      cells.push(a === 0 ? '.' : `${String(r)}/${String(g)}/${String(b)}/${String(a)}`);
    }
    rows.push(cells.join(' '));
  }
  return rows;
}

/** The parts of a 2D context the drawing helpers touch, and nothing else. */
interface DrawCall {
  readonly image: unknown;
  readonly args: readonly number[];
}

function fakeContext(): { ctx: CanvasRenderingContext2D; calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  const ctx = {
    drawImage(image: unknown, ...args: number[]) {
      calls.push({ image, args });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/** A surface factory that counts how often it was asked to build one. */
function countingFactory(): {
  factory: (bitmap: Bitmap) => CanvasImageSource;
  count: () => number;
} {
  let built = 0;
  return {
    factory: (bitmap) => {
      built += 1;
      return { bitmap } as unknown as CanvasImageSource;
    },
    count: () => built,
  };
}

describe('parseColour', () => {
  it('reads every form the content schema admits', () => {
    expect(parseColour('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseColour('#f00a')).toEqual({ r: 255, g: 0, b: 0, a: 170 });
    expect(parseColour('#00ff80')).toEqual({ r: 0, g: 255, b: 128, a: 255 });
    expect(parseColour('#00ff8040')).toEqual({ r: 0, g: 255, b: 128, a: 64 });
  });

  it('treats a fully transparent entry as clear, whatever its channels say', () => {
    expect(parseColour('#0000')?.a).toBe(0);
  });

  it('rejects anything that is not a hex colour', () => {
    expect(parseColour('red')).toBeUndefined();
    expect(parseColour('#12345')).toBeUndefined();
    expect(parseColour('')).toBeUndefined();
  });
});

describe('rasterising', () => {
  it('turns a sprite definition into the exact pixel grid it describes', () => {
    expect(sketch(rasteriseFrame(TOY, 0))).toEqual([
      '255/0/0/255 . . 0/255/0/128',
      '. . . .',
      '. . . .',
      '0/255/0/128 . . 255/0/0/255',
    ]);
    expect(sketch(rasteriseFrame(TOY, 1))).toEqual([
      '. . . .',
      '. 255/0/0/255 0/255/0/128 .',
      '. 0/255/0/128 255/0/0/255 .',
      '. . . .',
    ]);
  });

  it('leaves index 0 and "." fully transparent rather than black', () => {
    const bitmap = rasteriseFrame(TOY, 0);
    expect(pixel(bitmap, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it('carries a colour’s alpha through to the pixel', () => {
    expect(pixel(rasteriseFrame(TOY, 0), 3, 0)).toEqual([0, 255, 0, 128]);
  });
});

describe('the sheet', () => {
  let sheet: SpriteSheet;

  beforeAll(() => {
    sheet = createSpriteSheet({ sprites: [TOY], palette: TOY_PALETTE });
  });

  it('rasterises once and hands back the same bitmap instance', () => {
    const first = sheet.bitmap('toy', 0);
    expect(sheet.bitmap('toy', 0)).toBe(first);
    expect(sheet.bitmap('toy', 0)).toBe(first);
    // A different frame is a different bitmap, not the same one repainted.
    expect(sheet.bitmap('toy', 1)).not.toBe(first);
  });

  it('builds a drawable surface once per frame and caches it too', () => {
    const counting = countingFactory();
    const cached = createSpriteSheet(
      { sprites: [TOY], palette: TOY_PALETTE },
      { surfaceFactory: counting.factory },
    );

    const surface = cached.surface('toy', 0);
    expect(cached.surface('toy', 0)).toBe(surface);
    expect(counting.count()).toBe(1);

    cached.surface('toy', 1);
    expect(counting.count()).toBe(2);
    cached.surface('toy', 1);
    expect(counting.count()).toBe(2);
  });

  it('does not touch the surface factory until a surface is asked for', () => {
    const counting = countingFactory();
    const cached = createSpriteSheet(
      { sprites: [TOY], palette: TOY_PALETTE },
      { surfaceFactory: counting.factory },
    );
    cached.bitmap('toy', 0);
    cached.bitmap('toy', 1);
    expect(counting.count()).toBe(0);
  });

  it('reports what it holds', () => {
    expect(sheet.ids).toEqual(['toy']);
    expect(sheet.has('toy')).toBe(true);
    expect(sheet.has('nope')).toBe(false);
    expect(sheet.frameCount('toy')).toBe(2);
    expect(sheet.frameDuration('toy', 99)).toBe(3);
  });

  it('throws for an unknown sprite rather than drawing nothing', () => {
    expect(() => sheet.bitmap('nope')).toThrow(/no sprite "nope"/);
  });

  it('throws for a frame the sprite does not have', () => {
    expect(() => sheet.bitmap('toy', 2)).toThrow(RangeError);
    expect(() => sheet.bitmap('toy', -1)).toThrow(RangeError);
  });

  it('refuses two sprites with the same id', () => {
    expect(() => createSpriteSheet({ sprites: [TOY, TOY], palette: TOY_PALETTE })).toThrow(
      /defined twice/,
    );
  });
});

describe('palette enforcement', () => {
  it('rejects a colour the pack palette does not define, at build time', () => {
    const stray = spriteSchema.parse({
      id: 'stray',
      size: 1,
      palette: ['#0000', '#123456'],
      frames: [['1']],
    });
    expect(() => createSpriteSheet({ sprites: [stray], palette: TOY_PALETTE })).toThrow(
      SpriteSheetError,
    );
    expect(() => createSpriteSheet({ sprites: [stray], palette: TOY_PALETTE })).toThrow(
      /"#123456" is not in the pack palette/,
    );
  });

  it('matches colours by value, so #f00 and #ff0000ff are the same colour', () => {
    const shorthand = spriteSchema.parse({
      id: 'shorthand',
      size: 1,
      palette: ['#0000', '#f00'],
      frames: [['1']],
    });
    expect(() =>
      createSpriteSheet({ sprites: [shorthand], palette: ['#0000', '#ff0000ff'] }),
    ).not.toThrow();
  });

  it('does not make the pack declare the clear entry', () => {
    const clearOnly = spriteSchema.parse({
      id: 'clear-only',
      size: 1,
      palette: ['#0000'],
      frames: [['.']],
    });
    expect(() => createSpriteSheet({ sprites: [clearOnly], palette: ['#ff0000'] })).not.toThrow();
  });

  it('rejects a palette index the sprite does not define, rather than painting black', () => {
    // Past the schema on purpose: this is the case where a sprite reaches the
    // renderer from somewhere other than `loadPack`.
    const smuggled = {
      id: 'smuggled',
      size: 2,
      palette: ['#0000', '#ff0000'],
      frames: [['1f', '..']],
    } as unknown as Sprite;
    expect(() => createSpriteSheet({ sprites: [smuggled], palette: TOY_PALETTE })).toThrow(
      /palette index 15 is not defined by this sprite/,
    );
  });

  it('reports every problem at once, not just the first', () => {
    const bad = {
      id: 'bad',
      size: 1,
      palette: ['#0000', '#123456', '#654321'],
      frames: [['1']],
    } as unknown as Sprite;
    try {
      createSpriteSheet({ sprites: [bad], palette: TOY_PALETTE });
      expect.unreachable('expected the sheet to refuse to build');
    } catch (error) {
      expect(error).toBeInstanceOf(SpriteSheetError);
      expect((error as SpriteSheetError).problems).toHaveLength(2);
    }
  });
});

describe('animation', () => {
  it('holds each frame for its frameDuration and then cycles', () => {
    expect(frameIndexAt(2, 0, 8)).toBe(0);
    expect(frameIndexAt(2, 7, 8)).toBe(0);
    expect(frameIndexAt(2, 8, 8)).toBe(1);
    expect(frameIndexAt(2, 15, 8)).toBe(1);
    expect(frameIndexAt(2, 16, 8)).toBe(0);
  });

  it('is a pure function of the step, so a replay shows the same wing position', () => {
    const first = Array.from({ length: 40 }, (_, step) => frameIndexAt(4, step, 6));
    const second = Array.from({ length: 40 }, (_, step) => frameIndexAt(4, step, 6));
    expect(second).toEqual(first);
  });

  it('never advances a single-frame sprite', () => {
    expect(frameIndexAt(1, 1000, 1)).toBe(0);
  });

  it('takes the duration from the sprite when it states one', () => {
    const sheet = createSpriteSheet({ sprites: [TOY], palette: TOY_PALETTE });
    // TOY holds each frame for 3 steps, so the fallback of 1 is ignored.
    expect(sheet.frameAt('toy', 2, 1)).toBe(0);
    expect(sheet.frameAt('toy', 3, 1)).toBe(1);
  });
});

describe('drawing', () => {
  const sheet = createSpriteSheet(
    { sprites: [TOY], palette: TOY_PALETTE },
    { surfaceFactory: (bitmap) => ({ bitmap }) as unknown as CanvasImageSource },
  );

  it('places a sprite by its top-left corner, on whole pixels', () => {
    const { ctx, calls } = fakeContext();
    drawSprite(ctx, sheet, 'toy', 10.4, 20.6);
    expect(calls[0]?.args).toEqual([10, 21]);
  });

  it('centres a sprite on the position the simulation carries', () => {
    const { ctx, calls } = fakeContext();
    drawSpriteCentred(ctx, sheet, 'toy', 100, 200);
    expect(calls[0]?.args).toEqual([98, 198]);
  });
});

describe('the shipped Classic sprite set', () => {
  let pack: LoadedPack;
  let sheet: SpriteSheet;

  beforeAll(() => {
    const { source, errors } = readPackSource(PACK_DIR);
    expect(errors).toEqual([]);
    if (source === undefined) throw new Error('classic pack could not be read');
    const result = loadPack(source);
    if (!result.ok)
      throw new Error(`classic pack failed to load:\n${JSON.stringify(result.errors, null, 2)}`);
    pack = result.pack;
    sheet = createSpriteSheet({
      sprites: pack.sprites.values(),
      palette: pack.manifest.palette,
    });
  });

  it('builds without a single colour outside the pack palette', () => {
    expect(sheet.ids.length).toBe(pack.sprites.size);
  });

  it('declares its global palette in the pack, not in the renderer', () => {
    expect(pack.manifest.palette.length).toBeGreaterThan(1);
    expect(pack.manifest.palette[0]).toBe('#0000');
  });

  it('gives every role of docs/DESIGN.md section 2 a sprite under its own name', () => {
    for (const role of Object.keys(pack.manifest.roles)) {
      expect(sheet.has(role)).toBe(true);
    }
    expect(sheet.ids).toEqual(expect.arrayContaining(['drone', 'wing', 'warden']));
  });

  it('flaps its wings over two frames, per section 5', () => {
    for (const role of ['drone', 'wing', 'warden']) {
      expect(sheet.frameCount(role)).toBe(2);
    }
  });

  it('explodes over four frames, per section 5', () => {
    expect(sheet.frameCount('explosion-alien')).toBe(4);
    expect(sheet.frameCount('explosion-player')).toBe(4);
  });

  it('draws its aliens and the fighter at 16x16, the size section 5 fixes', () => {
    for (const id of ['player', 'drone', 'wing', 'warden', 'explosion-alien']) {
      const bitmap = sheet.bitmap(id);
      expect([bitmap.width, bitmap.height]).toEqual([16, 16]);
    }
  });

  it('keeps each sprite to a handful of colours, as section 5 asks', () => {
    for (const sprite of pack.sprites.values()) {
      // "About 3 colours plus transparent per sprite."
      expect(sprite.palette.length).toBeLessThanOrEqual(4);
      expect(sprite.palette[0]).toBe('#0000');
    }
  });

  it('carries a badge for every denomination section 4 lists', () => {
    for (const denomination of [1, 5, 10, 20, 30, 50]) {
      expect(sheet.has(`badge-${String(denomination)}`)).toBe(true);
    }
  });

  it('draws something in every frame it ships — no blank art', () => {
    for (const id of sheet.ids) {
      for (let frame = 0; frame < sheet.frameCount(id); frame += 1) {
        const { data } = sheet.bitmap(id, frame);
        const opaque = data.filter((_value, index) => index % 4 === 3 && data[index] !== 0);
        expect(opaque.length, `${id} frame ${String(frame)}`).toBeGreaterThan(0);
      }
    }
  });

  it('animates the two-frame sprites: the frames are not identical', () => {
    for (const id of sheet.ids) {
      if (sheet.frameCount(id) < 2) continue;
      expect([...sheet.bitmap(id, 0).data], id).not.toEqual([...sheet.bitmap(id, 1).data]);
    }
  });
});
