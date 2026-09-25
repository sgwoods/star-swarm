/**
 * Render a contact sheet of a pack's sprite set and the pixel font.
 *
 * `docs/DESIGN.md` section 11 asks every PR touching visuals for a clip or a
 * contact sheet. This makes one, and makes it *through the real pipeline* —
 * `loadPack` then `createSpriteSheet` then `rasteriseFontStrip` — so the picture
 * in the PR is the pixels the game will draw rather than a separate rendering of
 * the same JSON that could drift from it.
 *
 * No canvas is involved: the sheet is composed straight out of the cached
 * bitmaps, which is only possible because the rasteriser is pure (see
 * `src/render/sprites.ts`).
 *
 *     npm run sprite-sheet -- [pack] [output.png]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import { readPackSource } from '../src/content/fs.js';
import { loadPack } from '../src/content/loader.js';
import type { Bitmap } from '../src/render/sprites.js';
import { createSpriteSheet, parseColour } from '../src/render/sprites.js';
import { CELL, FIRST_CODE, LAST_CODE, rasteriseFontStrip } from '../src/render/text.js';

const CHANNELS = 4;
/** Whole-number magnification of the finished sheet, so the pixels stay pixels. */
const SCALE = 3;
/** The sheet is the width of the playfield, which makes the sprite scale honest. */
const WIDTH = 224;
const MARGIN = 6;
const LABEL_COLUMN = 140;
const ROW_PITCH = 20;
const FRAME_PITCH = 20;

const INK = '#ffffff';
const DIM = '#7d8aa8';
const BACKGROUND = { r: 8, g: 8, b: 14, a: 255 };

/* -------------------------------------------------------------------------- */
/* A canvas made of numbers                                                     */
/* -------------------------------------------------------------------------- */

interface Surface {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

function createSurface(width: number, height: number): Surface {
  const data = new Uint8ClampedArray(width * height * CHANNELS);
  for (let at = 0; at < data.length; at += CHANNELS) {
    data[at] = BACKGROUND.r;
    data[at + 1] = BACKGROUND.g;
    data[at + 2] = BACKGROUND.b;
    data[at + 3] = BACKGROUND.a;
  }
  return { width, height, data };
}

/** Source-over blit. Alpha matters: the sprites have soft edges nowhere but do have holes. */
function blit(target: Surface, source: Bitmap, dx: number, dy: number): void {
  for (let y = 0; y < source.height; y += 1) {
    const ty = dy + y;
    if (ty < 0 || ty >= target.height) continue;
    for (let x = 0; x < source.width; x += 1) {
      const tx = dx + x;
      if (tx < 0 || tx >= target.width) continue;
      const from = (y * source.width + x) * CHANNELS;
      const alpha = source.data[from + 3] ?? 0;
      if (alpha === 0) continue;
      const to = (ty * target.width + tx) * CHANNELS;
      const mix = alpha / 255;
      for (let channel = 0; channel < 3; channel += 1) {
        const src = source.data[from + channel] ?? 0;
        const dst = target.data[to + channel] ?? 0;
        target.data[to + channel] = Math.round(src * mix + dst * (1 - mix));
      }
      target.data[to + 3] = 255;
    }
  }
}

function fill(target: Surface, x: number, y: number, w: number, h: number, colour: string): void {
  const ink = parseColour(colour);
  if (ink === undefined) throw new Error(`"${colour}" is not a colour`);
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || tx >= target.width || ty < 0 || ty >= target.height) continue;
      const at = (ty * target.width + tx) * CHANNELS;
      target.data[at] = ink.r;
      target.data[at + 1] = ink.g;
      target.data[at + 2] = ink.b;
      target.data[at + 3] = 255;
    }
  }
}

/** Draw a line of text by blitting cells out of a font strip. */
function text(target: Surface, strip: Bitmap, line: string, x: number, y: number): void {
  const upper = line.toUpperCase();
  for (let i = 0; i < upper.length; i += 1) {
    const code = upper.codePointAt(i) ?? 0;
    if (code < FIRST_CODE || code > LAST_CODE) continue;
    const left = (code - FIRST_CODE) * CELL;
    const cell: Bitmap = {
      width: CELL,
      height: CELL,
      data: sliceCell(strip, left),
    };
    blit(target, cell, x + i * CELL, y);
  }
}

function sliceCell(strip: Bitmap, left: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(CELL * CELL * CHANNELS);
  for (let y = 0; y < CELL; y += 1) {
    const from = (y * strip.width + left) * CHANNELS;
    out.set(strip.data.slice(from, from + CELL * CHANNELS), y * CELL * CHANNELS);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* PNG                                                                          */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tag: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  const tagged = Buffer.concat([Buffer.from(tag, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tagged), 0);
  return Buffer.concat([head, tagged, crc]);
}

/** Encode a surface as an 8-bit RGBA PNG, magnified by a whole number. */
function encodePng(surface: Surface, scale: number): Buffer {
  const width = surface.width * scale;
  const height = surface.height * scale;
  const stride = width * CHANNELS;
  const raw = Buffer.alloc((stride + 1) * height);

  let at = 0;
  for (let y = 0; y < surface.height; y += 1) {
    for (let copy = 0; copy < scale; copy += 1) {
      raw[at] = 0; // filter type 0: none
      at += 1;
      for (let x = 0; x < surface.width; x += 1) {
        const from = (y * surface.width + x) * CHANNELS;
        for (let repeat = 0; repeat < scale; repeat += 1) {
          raw[at] = surface.data[from] ?? 0;
          raw[at + 1] = surface.data[from + 1] ?? 0;
          raw[at + 2] = surface.data[from + 2] ?? 0;
          raw[at + 3] = surface.data[from + 3] ?? 0;
          at += CHANNELS;
        }
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* The sheet                                                                    */
/* -------------------------------------------------------------------------- */

const SAMPLE_SCREENS = [
  '1UP   HIGH SCORE',
  '  1230     20000',
  'STAGE 12   READY',
  'CHALLENGE STAGE',
  'NUMBER OF HITS 40',
  'PERFECT! BONUS 10000',
  'HIT-MISS RATIO 87.5%',
  'GAME OVER',
];

function main(): void {
  const [packArg, outArg] = process.argv.slice(2);
  const packDir = resolve(packArg ?? 'packs/classic');
  const outPath = resolve(outArg ?? 'docs/media/classic-sprite-sheet.png');

  const { source, errors } = readPackSource(packDir);
  if (source === undefined) {
    console.error(`sprite-sheet: could not read ${packDir}`);
    for (const error of errors) console.error(`  ${error.file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const loaded = loadPack(source);
  if (!loaded.ok) {
    console.error(`sprite-sheet: ${packDir} failed to load`);
    for (const error of loaded.errors) console.error(`  ${error.file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const pack = loaded.pack;
  const sheet = createSpriteSheet({
    sprites: pack.sprites.values(),
    palette: pack.manifest.palette,
  });

  // Biggest art first, then alphabetical: the 16x16 cast reads as a group, and
  // the 8x8 shots and HUD badges gather at the end. Pack-agnostic on purpose —
  // this script knows nothing about which pack it was pointed at.
  const ids = [...sheet.ids].sort((a, b) => {
    const size = sheet.bitmap(b).width - sheet.bitmap(a).width;
    return size !== 0 ? size : a.localeCompare(b);
  });

  const ink = rasteriseFontStrip(INK);
  const dim = rasteriseFontStrip(DIM);

  const faceRows = Math.ceil((LAST_CODE - FIRST_CODE + 1) / 16);
  const height =
    MARGIN * 2 +
    CELL * 2 + // title
    CELL * 2 + // palette heading
    12 +
    CELL * 2 + // sprite heading
    ids.length * ROW_PITCH +
    CELL * 2 + // font heading
    faceRows * CELL +
    CELL +
    SAMPLE_SCREENS.length * CELL +
    MARGIN;

  const surface = createSurface(WIDTH, height);
  let y = MARGIN;

  text(surface, ink, `${pack.manifest.name.toUpperCase()} PACK`, MARGIN, y);
  y += CELL;
  text(surface, dim, `${String(sheet.ids.length)} sprites - original art`, MARGIN, y);
  y += CELL * 2;

  text(surface, dim, 'PACK PALETTE', MARGIN, y);
  y += CELL;
  pack.manifest.palette.forEach((colour, index) => {
    const x = MARGIN + index * 10;
    // The clear entry gets an outline instead of a swatch: nothing to show.
    if (parseColour(colour)?.a === 0) fill(surface, x, y, 8, 1, DIM);
    else fill(surface, x, y, 8, 8, colour);
  });
  y += 12 + CELL;

  text(surface, dim, 'SPRITES', MARGIN, y);
  y += CELL;
  for (const id of ids) {
    text(surface, ink, id, MARGIN, y + (ROW_PITCH - CELL) / 2);
    for (let frame = 0; frame < sheet.frameCount(id); frame += 1) {
      const bitmap = sheet.bitmap(id, frame);
      blit(
        surface,
        bitmap,
        LABEL_COLUMN + frame * FRAME_PITCH + (16 - bitmap.width) / 2,
        y + (ROW_PITCH - bitmap.height) / 2,
      );
    }
    y += ROW_PITCH;
  }

  y += CELL;
  text(surface, dim, 'PIXEL FONT 8X8', MARGIN, y);
  y += CELL;
  for (let row = 0; row < faceRows; row += 1) {
    let line = '';
    for (let column = 0; column < 16; column += 1) {
      const code = FIRST_CODE + row * 16 + column;
      if (code <= LAST_CODE) line += String.fromCodePoint(code);
    }
    text(surface, ink, line, MARGIN, y);
    y += CELL;
  }

  y += CELL;
  for (const line of SAMPLE_SCREENS) {
    text(surface, ink, line, MARGIN, y);
    y += CELL;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, encodePng(surface, SCALE));
  console.log(
    `sprite-sheet: ${outPath} — ${String(sheet.ids.length)} sprite(s) at ${String(SCALE)}x`,
  );
}

main();
