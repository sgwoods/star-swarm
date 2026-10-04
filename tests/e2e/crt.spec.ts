import { expect, type Page, test } from '@playwright/test';

import { reachAttract } from './harness.js';

/**
 * The CRT filter, read off the real canvas (`src/render/crt.ts`).
 *
 * The overlay's geometry is proved headlessly in `tests/unit/crt.test.ts`; what
 * only a browser can show is what reaches the screen. So every check here
 * compares the presented canvas with the 224x288 backbuffer the same frame was
 * drawn on, inside one `evaluate` — no frame can land between the two reads.
 *
 * - **Off is the bare blit.** Every device pixel is exactly its logical pixel, and
 *   every letterbox pixel black. An "off" filter that still touched one pixel
 *   would silently change every other visual test, so this is measured on both
 *   sides of turning the filter on, not assumed from the default.
 * - **On only darkens, and moves nothing.** No channel of any device pixel is
 *   brighter than the blit put there, the letterbox is untouched, every lit
 *   logical pixel keeps most of its light somewhere in its block, and in the
 *   middle of the screen the top device row of every lit pixel is still exact
 *   while the bottom one is darker — scanlines, aligned to the logical rows.
 *
 * Two window sizes, because the scanline is a fraction of a logical row and the
 * fraction is the scale's: 2x is one dark device row in two, 4x one in four.
 */

/** Roughly two frames of the 60 Hz simulation step. */
const FRAMES = 40;

async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(FRAMES);
  await page.keyboard.up(key);
  await page.waitForTimeout(FRAMES);
}

/** Open the settings and walk the cursor to the `CRT` row, as a player does. */
async function openCrtRow(page: Page): Promise<void> {
  await tap(page, 'Escape');
  await page.waitForFunction(() => window.starSwarm?.phase === 'settings');
  for (let i = 0; i < 12; i += 1) {
    if ((await page.evaluate(() => window.starSwarm?.settingsMenuRow)) === 'crt') return;
    await tap(page, 'ArrowDown');
  }
  throw new Error('the settings cursor never reached the CRT row');
}

/** Flip the CRT row and wait until the display has the filter the setting says. */
async function toggleCrt(page: Page, on: boolean): Promise<void> {
  await tap(page, 'ArrowRight');
  await page.waitForFunction((want) => window.starSwarm?.crt === want, on);
  expect(await page.evaluate(() => window.starSwarm?.settings.crt)).toBe(on);
}

interface Measurement {
  readonly scale: number;
  /** Device pixels that are not exactly what the bare integer blit puts there. */
  readonly changed: number;
  /** Device pixels with any channel brighter than the blit put there. */
  readonly brightened: number;
  /** Letterbox pixels that are not black. */
  readonly letterbox: number;
  /** Logical pixels with any ink, and how many of those lost most of their light. */
  readonly lit: number;
  readonly faded: number;
  /** Lit logical pixels in the middle of the screen, and what their rows did. */
  readonly middle: number;
  readonly topExact: number;
  readonly bottomDarker: number;
}

/** Compare the screen with the backbuffer it was presented from, in one frame. */
async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(() => {
    const hook = window.starSwarm;
    const screen = document.querySelector('canvas#screen');
    if (hook === undefined || !(screen instanceof HTMLCanvasElement)) {
      throw new Error('the page has no screen to measure');
    }
    const { layout } = hook;
    const screenCtx = screen.getContext('2d');
    const backCtx = hook.backbuffer.getContext('2d');
    if (screenCtx === null || backCtx === null) throw new Error('no 2D context to read');
    const shown = screenCtx.getImageData(0, 0, layout.surfaceWidth, layout.surfaceHeight).data;
    const { width: lw, height: lh } = hook.backbuffer;
    const drawn = backCtx.getImageData(0, 0, lw, lh).data;
    const s = layout.scale;

    const shownAt = (x: number, y: number): number => (y * layout.surfaceWidth + x) * 4;
    let changed = 0;
    let brightened = 0;
    let letterbox = 0;
    for (let y = 0; y < layout.surfaceHeight; y += 1) {
      for (let x = 0; x < layout.surfaceWidth; x += 1) {
        const at = shownAt(x, y);
        const px = x - layout.offsetX;
        const py = y - layout.offsetY;
        const inside = px >= 0 && py >= 0 && px < layout.width && py < layout.height;
        if (!inside) {
          if (shown[at] !== 0 || shown[at + 1] !== 0 || shown[at + 2] !== 0) letterbox += 1;
          continue;
        }
        const from = (Math.floor(py / s) * lw + Math.floor(px / s)) * 4;
        let differs = false;
        let brighter = false;
        for (let c = 0; c < 3; c += 1) {
          const a = shown[at + c] ?? 0;
          const b = drawn[from + c] ?? 0;
          if (a !== b) differs = true;
          if (a > b + 1) brighter = true;
        }
        if (differs) changed += 1;
        if (brighter) brightened += 1;
      }
    }

    const sum = (data: Uint8ClampedArray, at: number): number =>
      (data[at] ?? 0) + (data[at + 1] ?? 0) + (data[at + 2] ?? 0);
    let lit = 0;
    let faded = 0;
    let middle = 0;
    let topExact = 0;
    let bottomDarker = 0;
    for (let ly = 0; ly < lh; ly += 1) {
      for (let lx = 0; lx < lw; lx += 1) {
        const ink = sum(drawn, (ly * lw + lx) * 4);
        if (ink === 0) continue;
        lit += 1;
        const x0 = layout.offsetX + lx * s;
        const y0 = layout.offsetY + ly * s;
        let brightest = 0;
        for (let dy = 0; dy < s; dy += 1) {
          for (let dx = 0; dx < s; dx += 1) {
            brightest = Math.max(brightest, sum(shown, shownAt(x0 + dx, y0 + dy)));
          }
        }
        // The vignette may take 30% at the corner; more than that is lost ink.
        if (brightest < ink * 0.65) faded += 1;
        // The middle half on each axis, where the vignette is zero.
        if (lx >= lw / 4 && lx < (lw * 3) / 4 && ly >= lh / 4 && ly < (lh * 3) / 4) {
          middle += 1;
          const top = sum(shown, shownAt(x0, y0));
          const bottom = sum(shown, shownAt(x0, y0 + s - 1));
          if (top === ink) topExact += 1;
          if (bottom < top) bottomDarker += 1;
        }
      }
    }
    return { scale: s, changed, brightened, letterbox, lit, faded, middle, topExact, bottomDarker };
  });
}

/** What the bare integer blit looks like, measured. */
function expectBareBlit(frame: Measurement): void {
  expect(frame.changed).toBe(0);
  expect(frame.letterbox).toBe(0);
  // Something was drawn, or "nothing changed" would be true of a blank screen.
  expect(frame.lit).toBeGreaterThan(100);
}

for (const { width, height, scale } of [
  { width: 1280, height: 720, scale: 2 },
  { width: 1000, height: 1200, scale: 4 },
]) {
  test.describe(`at ${scale}x`, () => {
    test.use({ viewport: { width, height }, deviceScaleFactor: 1 });

    test('off is the bare blit, on darkens without moving a pixel, off is the blit again', async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await reachAttract(page);
      expect(await page.evaluate(() => window.starSwarm?.layout.scale)).toBe(scale);

      // Off by default, and off means untouched.
      expect(await page.evaluate(() => window.starSwarm?.settings.crt)).toBe(false);
      expect(await page.evaluate(() => window.starSwarm?.crt)).toBe(false);
      expectBareBlit(await measure(page));

      await openCrtRow(page);
      expectBareBlit(await measure(page));
      await toggleCrt(page, true);

      const on = await measure(page);
      // The frame differs, visibly: a scanline under every lit row at least.
      expect(on.changed).toBeGreaterThan(on.lit * scale);
      // And only ever by darkening, inside the picture.
      expect(on.brightened).toBe(0);
      expect(on.letterbox).toBe(0);
      // Readable: nothing drawn is lost, and in the middle the top of every lit
      // pixel is exact while its bottom row is the scanline.
      expect(on.faded).toBe(0);
      expect(on.middle).toBeGreaterThan(50);
      expect(on.topExact).toBe(on.middle);
      expect(on.bottomDarker).toBe(on.middle);

      // It survives a reload: the stored setting reaches the display at boot.
      await tap(page, 'Escape');
      await page.waitForFunction(() => window.starSwarm?.phase === 'attract');
      await page.reload();
      await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
      expect(await page.evaluate(() => window.starSwarm?.crt)).toBe(true);
      expect((await measure(page)).bottomDarker).toBeGreaterThan(50);

      // And off again is exactly the blit, not "nearly".
      if ((await page.evaluate(() => window.starSwarm?.phase)) === 'variant-select') {
        await tap(page, 'Space');
        await page.waitForFunction(() => window.starSwarm?.phase === 'attract');
      }
      await openCrtRow(page);
      await toggleCrt(page, false);
      expectBareBlit(await measure(page));

      expect(errors).toEqual([]);
    });
  });
}
