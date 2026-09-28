import { expect, type Page, test } from '@playwright/test';

/**
 * The build stamp and the new-build detector, in a real browser.
 *
 * The comparison logic and every degradation case are proved headlessly in
 * `tests/unit/build-info.test.ts`. What only a browser can show is the wiring:
 * that the page knows its own identity, that the identity it knows is the one
 * the server is serving, that the stamp is really on the glass and inside the
 * HUD band rather than over the playfield, and that a host with no `build.json`
 * leaves the page silent instead of showing an error.
 *
 * Deliberately shallow, like `smoke.spec.ts`.
 */

const LOGICAL_WIDTH = 224;
const TOP_BAND_HEIGHT = 16;

interface ServedIdentity {
  readonly commit: string;
  readonly dirty: boolean;
  readonly mode: string;
  readonly builtAt: string;
  readonly builtAtMs: number;
}

async function booted(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
}

/**
 * Lit pixels inside a rectangle of the *logical* playfield.
 *
 * The canvas presents the 224x288 backbuffer at a whole-number scale with
 * letterbox bars (`src/render/canvas.ts`), so the region has to be mapped
 * through the layout rather than guessed at.
 */
async function litPixelsIn(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
): Promise<number> {
  return page.evaluate((region) => {
    const layout = window.starSwarm?.layout;
    const canvas = document.querySelector<HTMLCanvasElement>('canvas#screen');
    const ctx = canvas?.getContext('2d');
    if (layout === undefined || ctx === null || ctx === undefined) return -1;

    const { scale, offsetX, offsetY } = layout;
    const data = ctx.getImageData(
      offsetX + region.x * scale,
      offsetY + region.y * scale,
      Math.max(1, region.width * scale),
      Math.max(1, region.height * scale),
    ).data;

    let lit = 0;
    for (let at = 0; at < data.length; at += 4) {
      if ((data[at] ?? 0) + (data[at + 1] ?? 0) + (data[at + 2] ?? 0) > 60) lit += 1;
    }
    return lit;
  }, rect);
}

test('the page knows which build it is, and it is the one being served', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await booted(page);

  const build = await page.evaluate(() => window.starSwarm?.build);
  expect(build).toBeDefined();
  // Derived, not written down: a real commit, a real timestamp. The dev server
  // is what serves this suite, so the mode is `dev` — a stamp that said
  // `release` here would mean the mode is not being derived at all.
  expect(build?.commit).toMatch(/^[0-9a-f]{7}$/);
  expect(build?.mode).toBe('dev');
  expect(build?.builtAtMs).toBeGreaterThan(0);
  expect(Date.parse(build?.builtAt ?? '')).toBe(build?.builtAtMs);

  // The static document a hosted deployment has to publish, served here by the
  // dev-server middleware from the same bytes that went into the bundle.
  const response = await page.request.get('build.json');
  expect(response.ok()).toBe(true);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect((await response.json()) as ServedIdentity).toEqual(build);

  // So the page is running what is served, and says so.
  await expect
    .poll(() => page.evaluate(() => window.starSwarm?.buildChecks ?? 0))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.starSwarm?.buildComparison)).toBe('same');
  expect(await page.evaluate(() => window.starSwarm?.buildUpdateAvailable)).toBe(false);
  expect(errors).toEqual([]);
});

test('the stamp is drawn in the top HUD band and nowhere over the playfield', async ({ page }) => {
  await booted(page);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');

  // Right of the HUD's own text on both rows of the top band: something is
  // there, and it is the stamp, because nothing else draws in that gap.
  const stamp = await litPixelsIn(page, {
    x: 152,
    y: 0,
    width: LOGICAL_WIDTH - 152,
    height: TOP_BAND_HEIGHT,
  });
  expect(stamp).toBeGreaterThan(0);

  // That it stays inside the band is geometry, not pixels: the rows it draws on
  // are asserted against `TOP_BAND_HEIGHT` in `tests/unit/build-info.test.ts`,
  // where a diving enemy cannot wander into the sample.
});

test('a host with nothing to poll leaves the page silent', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // Every poll 404s from here on, which is the "hosted somewhere that forgot to
  // publish build.json" case, and the offline case as far as the page can tell.
  await page.route('**/build.json*', (route) => route.fulfill({ status: 404, body: 'nope' }));
  await booted(page);

  const comparison = await page.evaluate(async () => window.starSwarm?.checkBuild());
  expect(comparison).toBe('unknown');
  expect(await page.evaluate(() => window.starSwarm?.buildUpdateAvailable)).toBe(false);
  expect(await page.evaluate(() => window.starSwarm?.buildCheckFailures ?? 0)).toBeGreaterThan(0);

  // Still playable, still quiet: no page error, and the game runs on.
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');
  expect(errors).toEqual([]);
});

test('a newer served build raises the notice, and steals nothing', async ({ page }) => {
  await booted(page);

  const build = await page.evaluate(() => window.starSwarm?.build);
  expect(build).toBeDefined();

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');
  const scoreBefore = await page.evaluate(() => window.starSwarm?.score ?? 0);
  const stepBefore = await page.evaluate(() => window.starSwarm?.step ?? 0);

  // Serve a build made a minute later than this one — a redeploy, as the page
  // would meet it.
  await page.route('**/build.json*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...build, builtAtMs: (build?.builtAtMs ?? 0) + 60_000 }),
    }),
  );

  expect(await page.evaluate(async () => window.starSwarm?.checkBuild())).toBe('newer');
  expect(await page.evaluate(() => window.starSwarm?.buildUpdateAvailable)).toBe(true);

  // The notice is text and nothing else: the run is still the same run, the
  // simulation is still stepping, and nothing took the keyboard.
  expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('playing');
  expect(await page.evaluate(() => window.starSwarm?.score ?? 0)).toBeGreaterThanOrEqual(
    scoreBefore,
  );
  await page.waitForFunction((step) => (window.starSwarm?.step ?? 0) > step, stepBefore);

  const playerX = await page.evaluate(() => window.starSwarm?.playerX ?? 0);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  expect(await page.evaluate(() => window.starSwarm?.playerX ?? 0)).toBeGreaterThan(playerX);
});
