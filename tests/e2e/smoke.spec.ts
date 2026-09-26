import { expect, test } from '@playwright/test';

/**
 * Smoke test: the dev build loads, the canvas exists, and it is presenting the
 * 224x288 playfield at a whole-number scale (docs/DESIGN.md section 3).
 *
 * Deliberately shallow. Behaviour is proved headlessly in `tests/sim/`; this only
 * checks that the browser half — the thing Vitest cannot see — is wired up: that
 * a real key event reaches the simulation and that what the simulation computes
 * comes back out.
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

test('a keypress in the browser reaches the simulation', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);

  const start = await page.evaluate(() => window.starSwarm?.playerX ?? 0);

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  const right = await page.evaluate(() => window.starSwarm?.playerX ?? 0);
  expect(right).toBeGreaterThan(start);

  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowLeft');
  expect(await page.evaluate(() => window.starSwarm?.playerX ?? 0)).toBeLessThan(right);

  // Half a second of the 1/2-px cadence is about 45 px. The bound is generous in
  // both directions on purpose: the fixed-step loop *catches up* after a stall, so
  // a busy machine can run more steps inside the measured window rather than
  // fewer, and pinning this near 45 makes it flake under parallel workers. What it
  // is really asserting is that the fighter moves at the arcade's pace and not at
  // a pixel per key event, which a bound of 80 still catches.
  expect(right - start).toBeLessThanOrEqual(80);
});

test('the entry waves fly in and fill the formation', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);

  expect(await page.evaluate(() => window.starSwarm?.stage)).toBe(1);
  expect(await page.evaluate(() => window.starSwarm?.lives)).toBe(2);
  // Forty enemies exist from the first frame, all of them still in standby.
  expect(await page.evaluate(() => window.starSwarm?.enemiesAlive)).toBe(40);
  expect(await page.evaluate(() => window.starSwarm?.enemiesHome)).toBe(0);

  // The whole entry takes about 15 seconds of simulation, and the sway then runs
  // on until the formation passes back through centre. Wait on the state rather
  // than on the clock: a stalled CI machine runs fewer steps, not different ones.
  await page.waitForFunction(() => (window.starSwarm?.enemiesHome ?? 0) === 40, undefined, {
    timeout: 60_000,
  });
  await page.waitForFunction(() => window.starSwarm?.formationMotion === 'breathe', undefined, {
    timeout: 30_000,
  });
});

test('holding fire scores against the formation', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);

  // Auto-fire: the button goes down once and stays down, as it does in the
  // arcade. Sweeping is necessary — the formation is symmetric about the screen
  // centre, so a fighter sitting dead centre lines up with nothing.
  await page.keyboard.down('Space');
  for (let sweep = 0; sweep < 12; sweep += 1) {
    const key = sweep % 2 === 0 ? 'ArrowRight' : 'ArrowLeft';
    await page.keyboard.down(key);
    await page.waitForTimeout(600);
    await page.keyboard.up(key);
    if ((await page.evaluate(() => window.starSwarm?.score ?? 0)) > 0) break;
  }
  await page.keyboard.up('Space');

  expect(await page.evaluate(() => window.starSwarm?.score ?? 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.starSwarm?.enemiesAlive ?? 40)).toBeLessThan(40);
});
