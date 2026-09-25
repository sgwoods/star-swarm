/**
 * The pixel font: an original 8x8 face in the arcade spirit (`docs/DESIGN.md`
 * section 5), and the cache that draws with it.
 *
 * **Original, like the sprites.** `docs/DESIGN.md` section 2 rules out the
 * original's font as firmly as its art, so this is drawn from scratch: a 5x7
 * body on an 8x8 cell, single-pixel strokes, a slashed zero so `0` and `O` never
 * read alike on a score line. It covers ASCII 0x20–0x5F — space, digits,
 * uppercase and the punctuation the HUD, the `STAGE n` and `READY` interstitials
 * and the challenge and game-over results screens need. There are no lowercase
 * glyphs on purpose; {@link drawText} upper-cases as it goes, which is what an
 * arcade screen does anyway.
 *
 * **Cached like the sprites, for the same reason.** Text is redrawn every frame,
 * so tinting one glyph at a time would be the per-frame rasterise that
 * `sprites.ts` exists to avoid. Instead each *colour* gets one strip — all 64
 * glyphs side by side, rasterised once — and drawing a string is one
 * `drawImage` per character out of that strip.
 *
 * Cell geometry is fixed at 8x8 because the HUD lays out against it: the 224x288
 * playfield is 28 cells wide, and the top band of `src/ui/hud.ts` is two rows of
 * one cell.
 */

import type { Bitmap, SurfaceFactory } from './sprites.js';
import { createCanvasSurface, parseColour } from './sprites.js';

/** Cell size: the advance between characters and the line height, in pixels. */
export const CELL = 8;

/** Drawn extent of a glyph inside its cell. The rest is side bearing and leading. */
export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

/** The first and last code points the font covers. */
export const FIRST_CODE = 0x20;
export const LAST_CODE = 0x5f;

/**
 * The face. Each glyph is its seven rows, space-separated, `#` for ink.
 *
 * Rows rather than a packed bitfield because this is art: it has to be readable
 * and editable in the diff that changes it. Seven rows on one line keeps a glyph
 * to a line, so the whole face fits on a screen and its weight can be judged at
 * a glance.
 */
const GLYPHS: Readonly<Record<string, string>> = {
  ' ': '..... ..... ..... ..... ..... ..... .....',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '"': '.#.#. .#.#. ..... ..... ..... ..... .....',
  '#': '.#.#. ##### .#.#. .#.#. ##### .#.#. .....',
  $: '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
  '%': '##..# ##..# ...#. ..#.. .#... #..## #..##',
  '&': '.##.. #..#. #..#. .##.. #.#.# #..#. .##.#',
  "'": '..#.. ..#.. ..... ..... ..... ..... .....',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  '*': '..... #.#.# .###. ##### .###. #.#.# .....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  ',': '..... ..... ..... ..... ..#.. ..#.. .#...',
  '-': '..... ..... ..... .###. ..... ..... .....',
  '.': '..... ..... ..... ..... ..... ..#.. ..#..',
  '/': '....# ....# ...#. ..#.. .#... #.... #....',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '.###. #...# ....# ..##. ....# #...# .###.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '..##. .#... #.... ####. #...# #...# .###.',
  '7': '##### #...# ....# ...#. ..#.. ..#.. ..#..',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ...#. .##..',
  ':': '..... ..#.. ..#.. ..... ..#.. ..#.. .....',
  ';': '..... ..#.. ..#.. ..... ..#.. ..#.. .#...',
  '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
  '=': '..... ..... ##### ..... ##### ..... .....',
  '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
  '?': '.###. #...# ....# ..##. ..#.. ..... ..#..',
  '@': '.###. #...# #.##. #.#.# #.##. #.... .###.',
  A: '..#.. .#.#. #...# #...# ##### #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #..## #...# #...# .###.',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '...## ....# ....# ....# ....# #...# .###.',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #...# #...# #...# #...#',
  N: '#...# ##..# #.#.# #..## #...# #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# .###. ....#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.###. #...# #.... .###. ....# #...# .###.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# ##.## #...#',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  '[': '.###. .#... .#... .#... .#... .#... .###.',
  '\\': '#.... #.... .#... ..#.. ...#. ....# ....#',
  ']': '.###. ...#. ...#. ...#. ...#. ...#. .###.',
  '^': '..#.. .#.#. #...# ..... ..... ..... .....',
  _: '..... ..... ..... ..... ..... ..... #####',
};

/** Every character the font can draw, in code-point order. */
export const GLYPH_CHARS: readonly string[] = Object.freeze(Object.keys(GLYPHS));

/** Where a character sits in the strip, or `undefined` if the face lacks it. */
function cellIndexOf(char: string): number | undefined {
  const code = char.codePointAt(0);
  if (code === undefined || code < FIRST_CODE || code > LAST_CODE) return undefined;
  return code - FIRST_CODE;
}

/** Whether the font can draw this character. Case-insensitive, like {@link drawText}. */
export function hasGlyph(char: string): boolean {
  return cellIndexOf(char.toUpperCase()) !== undefined;
}

/**
 * One glyph as its seven `.`/`#` rows, for tests and for anything that wants to
 * inspect the face rather than draw with it.
 */
export function glyphRows(char: string): readonly string[] | undefined {
  const spec = GLYPHS[char.toUpperCase()];
  return spec === undefined ? undefined : spec.split(' ');
}

/** Width in pixels of a single line of text, at one cell per character. */
export function measureText(text: string): number {
  return text.length * CELL;
}

/* -------------------------------------------------------------------------- */
/* The strip                                                                    */
/* -------------------------------------------------------------------------- */

const CELL_COUNT = LAST_CODE - FIRST_CODE + 1;

/**
 * Rasterise the whole face in one colour: 64 cells in a row, one strip.
 *
 * Pure, so it runs on Node — the unit tests read glyph pixels straight out of a
 * strip without a canvas anywhere.
 */
export function rasteriseFontStrip(colour: string): Bitmap {
  const ink = parseColour(colour);
  if (ink === undefined) throw new Error(`"${colour}" is not a colour the font can be drawn in`);

  const width = CELL_COUNT * CELL;
  const data = new Uint8ClampedArray(width * CELL * 4);
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    const rows = glyphRows(String.fromCodePoint(FIRST_CODE + cell)) ?? [];
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] !== '#') continue;
        const at = (y * width + cell * CELL + x) * 4;
        data[at] = ink.r;
        data[at + 1] = ink.g;
        data[at + 2] = ink.b;
        data[at + 3] = ink.a;
      }
    });
  }
  return { width, height: CELL, data };
}

/* -------------------------------------------------------------------------- */
/* The cache                                                                    */
/* -------------------------------------------------------------------------- */

export type TextAlign = 'left' | 'center' | 'right';

export interface TextOptions {
  /**
   * Ink colour. Pass one from the pack palette — the palette is pack data
   * (`docs/DESIGN.md` section 5) and this file, like `sprites.ts`, holds none of
   * its own. Defaults to white.
   */
  readonly colour?: string;
  /** Where `x` sits relative to the text. Defaults to `left`. */
  readonly align?: TextAlign;
}

export interface Font {
  /** The cached strip for a colour. The same instance every call. */
  strip(colour: string): Bitmap;
  /** The strip as something `drawImage` accepts. Cached the same way. */
  surface(colour: string): CanvasImageSource;
  /** Draw one line with its top-left (or centre, or right edge) at `(x, y)`. */
  draw(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    options?: TextOptions,
  ): void;
  /** Characters the face cannot draw, for diagnostics. Empty means all of them. */
  missing(text: string): readonly string[];
}

export interface FontOptions {
  /** How a strip becomes drawable. Defaults to the canvas factory in `sprites.ts`. */
  readonly surfaceFactory?: SurfaceFactory;
}

const DEFAULT_COLOUR = '#ffffff';

/**
 * Build the font cache.
 *
 * One strip per colour, built on first use rather than eagerly: a screen uses
 * two or three colours and which ones is not known until it draws. Unlike the
 * sprite sheet there is nothing to validate up front — a colour that cannot be
 * parsed is the caller's bug at the call site, and says so there.
 */
export function createFont(options: FontOptions = {}): Font {
  const { surfaceFactory = createCanvasSurface } = options;
  const strips = new Map<string, Bitmap>();
  const surfaces = new Map<string, CanvasImageSource>();

  const strip = (colour: string): Bitmap => {
    const existing = strips.get(colour);
    if (existing !== undefined) return existing;
    const built = rasteriseFontStrip(colour);
    strips.set(colour, built);
    return built;
  };

  const surface = (colour: string): CanvasImageSource => {
    const existing = surfaces.get(colour);
    if (existing !== undefined) return existing;
    const built = surfaceFactory(strip(colour));
    surfaces.set(colour, built);
    return built;
  };

  return {
    strip,
    surface,
    missing(text) {
      const absent = new Set<string>();
      for (const char of text) {
        if (!hasGlyph(char)) absent.add(char);
      }
      return [...absent];
    },
    draw(ctx, text, x, y, textOptions = {}) {
      const { colour = DEFAULT_COLOUR, align = 'left' } = textOptions;
      const upper = text.toUpperCase();
      const width = measureText(upper);
      const offset = align === 'center' ? width / 2 : align === 'right' ? width : 0;
      // Integer positions: a half-pixel destination would resample the glyph and
      // undo the nearest-neighbour presentation in `canvas.ts`.
      const left = Math.round(x - offset);
      const top = Math.round(y);
      const image = surface(colour);

      for (let i = 0; i < upper.length; i += 1) {
        const cell = cellIndexOf(upper[i] ?? '');
        // An unknown character draws nothing and still advances, so a stray
        // symbol shifts no other text on the line.
        if (cell === undefined) continue;
        ctx.drawImage(image, cell * CELL, 0, CELL, CELL, left + i * CELL, top, CELL, CELL);
      }
    },
  };
}

/**
 * Draw one line without holding a {@link Font}.
 *
 * Convenience for callers that draw a line or two; anything drawing every frame
 * should keep a font and call {@link Font.draw}, so the strip is cached across
 * frames rather than rebuilt with the module-level one.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: TextOptions = {},
): void {
  sharedFont().draw(ctx, text, x, y, options);
}

let shared: Font | undefined;

/** The process-wide font, built on first use. */
function sharedFont(): Font {
  shared ??= createFont();
  return shared;
}
