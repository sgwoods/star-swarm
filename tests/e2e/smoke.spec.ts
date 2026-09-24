import { expect, test } from '@playwright/test';

/**
 * Smoke test: the dev build loads, the canvas exists, and it is presenting the
 * 224x288 playfield at a whole-number scale (docs/DESIGN.md section 3).
 *
 * Deliberately shallow. Behaviour is proved headlessly in `tests/sim/`; this only
 * checks that the browser half — the thing Vitest cannot see — is wired up.
 */

const LOGICAL_WIDTH = 224;
const LOGICAL_HEIGHT = 288;

test('the game canvas is present and correctly sized', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/');

  const canvas = page.locator('canvas#screen');
  await expect(canvas).toBeVisible();

  // The backbuffer is 224x288 and the presented image is an exact whole-number
  // multiple of it, centred, with the remainder as letterbox bars.
  const layout = await page.evaluate(() => window.starSwarm?.layout);
  expect(layout).toBeDefined();
  expect(layout?.width).toBe(LOGICAL_WIDTH * (layout?.scale ?? 0));
  expect(layout?.height).toBe(LOGICAL_HEIGHT * (layout?.scale ?? 0));
  expect(Number.isInteger(layout?.scale)).toBe(true);
  expect(layout?.scale).toBeGreaterThanOrEqual(1);
  expect(layout?.offsetX).toBeGreaterThanOrEqual(0);
  expect(layout?.offsetY).toBeGreaterThanOrEqual(0);
  expect(Number.isInteger(layout?.offsetX)).toBe(true);
  expect(Number.isInteger(layout?.offsetY)).toBe(true);

  // The on-screen canvas covers its container, bars included.
  const surface = await canvas.evaluate((el: HTMLCanvasElement) => ({
    width: el.width,
    height: el.height,
  }));
  expect(surface.width).toBe(layout?.surfaceWidth);
  expect(surface.height).toBe(layout?.surfaceHeight);
  expect(surface.width).toBeGreaterThanOrEqual(layout?.width ?? 0);
  expect(surface.height).toBeGreaterThanOrEqual(layout?.height ?? 0);

  // Nothing blurry: image smoothing must be off on the presenting context.
  const smoothing = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d');
    return ctx === null ? null : ctx.imageSmoothingEnabled;
  });
  expect(smoothing).toBe(false);

  expect(errors).toEqual([]);
});

test('the fixed-step loop runs at 60 Hz', async ({ page }) => {
  await page.goto('/');

  const stepHz = await page.evaluate(() => window.starSwarm?.stepHz);
  expect(stepHz).toBe(60);

  const before = await page.evaluate(() => window.starSwarm?.step ?? 0);
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => window.starSwarm?.step ?? 0);

  // A second of wall clock should be about 60 steps. The bounds are loose
  // because CI machines stall; the point is that the loop advances and does not
  // run away at the display's refresh rate.
  const steps = after - before;
  expect(steps).toBeGreaterThan(30);
  expect(steps).toBeLessThan(90);
});

test('the display relayouts on resize without distorting', async ({ page }) => {
  await page.goto('/');

  /**
   * Resize, then wait for the display to actually pick it up. A viewport change
   * is asynchronous, so reading the layout straight afterwards can still return
   * the previous one — which is how this test originally passed by accident.
   */
  async function resizeTo(width: number, height: number) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(
      ({ w, h }) => {
        const layout = window.starSwarm?.layout;
        if (layout === undefined) return false;
        const dpr = window.devicePixelRatio || 1;
        return (
          layout.surfaceWidth === Math.round(w * dpr) &&
          layout.surfaceHeight === Math.round(h * dpr)
        );
      },
      { w: width, h: height },
    );
    const layout = await page.evaluate(() => window.starSwarm?.layout);
    expect(layout).toBeDefined();
    return layout;
  }

  const wide = await resizeTo(1280, 1024);
  const narrow = await resizeTo(480, 640);

  // A smaller viewport must drop to a smaller whole-number factor, not squeeze.
  expect(narrow?.scale).toBeLessThan(wide?.scale ?? 0);

  for (const layout of [wide, narrow]) {
    expect(Number.isInteger(layout?.scale)).toBe(true);
    expect(layout?.width).toBe(LOGICAL_WIDTH * (layout?.scale ?? 0));
    expect(layout?.height).toBe(LOGICAL_HEIGHT * (layout?.scale ?? 0));
    // Still centred, still inside the surface, still whole offsets.
    expect(layout?.offsetX).toBe(
      Math.floor(((layout?.surfaceWidth ?? 0) - (layout?.width ?? 0)) / 2),
    );
    expect(layout?.offsetY).toBe(
      Math.floor(((layout?.surfaceHeight ?? 0) - (layout?.height ?? 0)) / 2),
    );
    expect((layout?.offsetX ?? 0) + (layout?.width ?? 0)).toBeLessThanOrEqual(
      layout?.surfaceWidth ?? 0,
    );
    expect((layout?.offsetY ?? 0) + (layout?.height ?? 0)).toBeLessThanOrEqual(
      layout?.surfaceHeight ?? 0,
    );
  }
});
