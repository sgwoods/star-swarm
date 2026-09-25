import { describe, expect, it } from 'vitest';

import type { Bitmap } from '../../src/render/sprites.js';
import {
  CELL,
  createFont,
  FIRST_CODE,
  GLYPH_CHARS,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  glyphRows,
  hasGlyph,
  LAST_CODE,
  measureText,
  rasteriseFontStrip,
} from '../../src/render/text.js';

/**
 * The pixel font, tested headlessly like the sprites it shares a cache design
 * with. The screens listed in `SCREEN_TEXT` are the acceptance criterion: the
 * face has to cover every character the game puts on screen, and this test is
 * what notices when a new screen needs a character the face never had.
 */

/**
 * Every string the HUD and the interstitial and results screens draw
 * (`docs/DESIGN.md` section 4, "Game flow", and `src/ui/hud.ts`).
 *
 * Wording can change; what this list is for is the *characters*, so a screen
 * that needs a new symbol fails here rather than silently drawing a gap.
 */
const SCREEN_TEXT = [
  // HUD
  '1UP',
  'HIGH SCORE',
  '2UP',
  '0123456789',
  // Interstitials
  'STAGE 1',
  'READY',
  'PLAYER 1',
  'GAME OVER',
  // Challenge stage and its results
  'CHALLENGE STAGE',
  'NUMBER OF HITS',
  'PERFECT!',
  'BONUS 10000',
  // Game-over results
  'SHOTS FIRED',
  'HIT-MISS RATIO',
  '87.5%',
  // Attract mode and the high-score table
  'SCORE TABLE',
  'PUSH START BUTTON',
  'BEST 5 SCORES',
  'RANK  SCORE  NAME',
  'CREDIT 0',
  '(C) 2026',
];

/** Read one pixel out of a strip as `[r, g, b, a]`. */
function pixel(bitmap: Bitmap, x: number, y: number): number[] {
  const at = (y * bitmap.width + x) * 4;
  return [...bitmap.data.slice(at, at + 4)];
}

/** One cell of a strip, back as `.`/`#` rows, so a glyph can be asserted as art. */
function cellRows(strip: Bitmap, char: string): string[] {
  const code = char.codePointAt(0) ?? 0;
  const left = (code - FIRST_CODE) * CELL;
  const rows: string[] = [];
  for (let y = 0; y < CELL; y += 1) {
    let row = '';
    for (let x = 0; x < CELL; x += 1) {
      row += pixel(strip, left + x, y)[3] === 0 ? '.' : '#';
    }
    rows.push(row);
  }
  return rows;
}

interface DrawCall {
  readonly args: readonly number[];
}

function fakeContext(): { ctx: CanvasRenderingContext2D; calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  const ctx = {
    drawImage(_image: unknown, ...args: number[]) {
      calls.push({ args });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const stubFactory = (bitmap: Bitmap): CanvasImageSource =>
  ({ bitmap }) as unknown as CanvasImageSource;

describe('the face', () => {
  it('covers ASCII 0x20 to 0x5F with no gaps', () => {
    expect(GLYPH_CHARS).toHaveLength(LAST_CODE - FIRST_CODE + 1);
    for (let code = FIRST_CODE; code <= LAST_CODE; code += 1) {
      const char = String.fromCodePoint(code);
      expect(hasGlyph(char), `missing glyph for ${JSON.stringify(char)}`).toBe(true);
    }
  });

  it('keeps every glyph to the same 5x7 body', () => {
    for (const char of GLYPH_CHARS) {
      const rows = glyphRows(char);
      expect(rows, char).toHaveLength(GLYPH_HEIGHT);
      for (const row of rows ?? []) {
        expect(row.length, char).toBe(GLYPH_WIDTH);
        expect(row, char).toMatch(/^[.#]+$/);
      }
    }
  });

  it('has a glyph for every character the game puts on screen', () => {
    const font = createFont({ surfaceFactory: stubFactory });
    for (const line of SCREEN_TEXT) {
      expect(font.missing(line), line).toEqual([]);
    }
  });

  it('draws uppercase for lowercase input, as an arcade screen would', () => {
    expect(hasGlyph('a')).toBe(true);
    expect(glyphRows('a')).toEqual(glyphRows('A'));
  });

  it('leaves space blank and the other glyphs not', () => {
    expect(glyphRows(' ')?.join('')).toMatch(/^\.+$/);
    for (const char of GLYPH_CHARS) {
      if (char === ' ') continue;
      expect(glyphRows(char)?.join(''), char).toContain('#');
    }
  });

  it('distinguishes 0 from O, which a score line depends on', () => {
    expect(glyphRows('0')).not.toEqual(glyphRows('O'));
  });

  it('has no glyph for anything outside the range it claims', () => {
    expect(hasGlyph('£')).toBe(false);
    expect(hasGlyph('~')).toBe(false);
    expect(glyphRows('~')).toBeUndefined();
  });
});

describe('rasterising the strip', () => {
  const strip = rasteriseFontStrip('#ff2b2b');

  it('lays the whole face out as one row of cells', () => {
    expect(strip.height).toBe(CELL);
    expect(strip.width).toBe((LAST_CODE - FIRST_CODE + 1) * CELL);
  });

  it('paints a glyph exactly where its rows say, in the ink it was given', () => {
    expect(cellRows(strip, 'T')).toEqual([
      '#####...',
      '..#.....',
      '..#.....',
      '..#.....',
      '..#.....',
      '..#.....',
      '..#.....',
      '........',
    ]);
    // Top-left of 'T' is ink; the cell's right-hand bearing column is clear.
    const left = (('T'.codePointAt(0) ?? 0) - FIRST_CODE) * CELL;
    expect(pixel(strip, left, 0)).toEqual([255, 43, 43, 255]);
    expect(pixel(strip, left + 7, 0)).toEqual([0, 0, 0, 0]);
  });

  it('matches the rows the face declares, glyph for glyph', () => {
    for (const char of GLYPH_CHARS) {
      const drawn = cellRows(strip, char)
        .slice(0, GLYPH_HEIGHT)
        .map((row) => row.slice(0, GLYPH_WIDTH));
      expect(drawn, char).toEqual(glyphRows(char));
    }
  });

  it('refuses ink that is not a colour', () => {
    expect(() => rasteriseFontStrip('scarlet')).toThrow(/not a colour/);
  });
});

describe('the cache', () => {
  it('rasterises a colour once and hands back the same strip', () => {
    const font = createFont({ surfaceFactory: stubFactory });
    const first = font.strip('#ffffff');
    expect(font.strip('#ffffff')).toBe(first);
    expect(font.strip('#ff2b2b')).not.toBe(first);
  });

  it('builds one surface per colour, not one per frame', () => {
    let built = 0;
    const font = createFont({
      surfaceFactory: (bitmap) => {
        built += 1;
        return { bitmap } as unknown as CanvasImageSource;
      },
    });
    const { ctx } = fakeContext();
    for (let frame = 0; frame < 60; frame += 1) {
      font.draw(ctx, 'HIGH SCORE', 0, 0, { colour: '#ff2b2b' });
      font.draw(ctx, '000000', 0, 8, { colour: '#ffffff' });
    }
    expect(built).toBe(2);
  });
});

describe('drawing', () => {
  const font = createFont({ surfaceFactory: stubFactory });

  it('advances one cell per character', () => {
    expect(measureText('1UP')).toBe(3 * CELL);
    const { ctx, calls } = fakeContext();
    font.draw(ctx, '1UP', 16, 0);
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.args[4])).toEqual([16, 24, 32]);
  });

  it('takes each glyph from its own cell of the strip', () => {
    const { ctx, calls } = fakeContext();
    font.draw(ctx, 'AB', 0, 0);
    const cellOf = (char: string): number => (('' + char).codePointAt(0) ?? 0) - FIRST_CODE;
    expect(calls[0]?.args[0]).toBe(cellOf('A') * CELL);
    expect(calls[1]?.args[0]).toBe(cellOf('B') * CELL);
    // Source rect is one whole cell; destination is the same size, never scaled.
    expect(calls[0]?.args.slice(1, 4)).toEqual([0, CELL, CELL]);
    expect(calls[0]?.args.slice(5)).toEqual([0, CELL, CELL]);
  });

  it('aligns centre and right against the whole line', () => {
    const { ctx, calls } = fakeContext();
    font.draw(ctx, 'GAME OVER', 112, 140, { align: 'center' });
    expect(calls[0]?.args[4]).toBe(112 - (9 * CELL) / 2);

    const right = fakeContext();
    font.draw(right.ctx, '00', 100, 0, { align: 'right' });
    expect(right.calls[0]?.args[4]).toBe(100 - 2 * CELL);
  });

  it('lands on whole pixels, so the nearest-neighbour blit stays crisp', () => {
    const { ctx, calls } = fakeContext();
    font.draw(ctx, 'X', 10.5, 20.5, { align: 'center' });
    for (const call of calls) {
      expect(Number.isInteger(call.args[4])).toBe(true);
      expect(Number.isInteger(call.args[5])).toBe(true);
    }
  });

  it('draws nothing for a character it lacks but still advances past it', () => {
    const { ctx, calls } = fakeContext();
    font.draw(ctx, 'A~B', 0, 0);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.args[4])).toEqual([0, 2 * CELL]);
  });

  it('names the characters it could not draw', () => {
    expect(font.missing('A~B€')).toEqual(['~', '€']);
    expect(font.missing('READY')).toEqual([]);
  });
});
