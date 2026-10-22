import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

/**
 * `/lab` in a real browser: the four views load over every game, draw, and
 * answer the keys the way the game's own screens do — `ENTER` takes, `ESC` goes
 * back.
 *
 * What each view *says* is held to the game in Vitest
 * (`tests/unit/lab-content.test.ts`, `tests/sim/lab-stages.test.ts`); what only a
 * browser can show is that the page boots on the bundled packs and variants, that
 * the views build their DOM and draw without throwing — a sprite sheet from the
 * wrong game is a throw from `drawScene`, not a wrong picture — and that a real
 * keypress reaches them.
 */

/** Every error the page raised, so a test can say it raised none. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

/** Open the lab at a query and wait for its loop to turn. */
async function openLab(page: Page, query: string): Promise<void> {
  await page.goto(`/lab?${query}`);
  await page.waitForFunction(() => (window.starSwarmLab?.steps ?? 0) > 2);
}

/** How many pixels of the presented canvas are not black. */
async function litPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#screen');
    const ctx = canvas?.getContext('2d');
    if (canvas === null || canvas === undefined || ctx === null || ctx === undefined) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 0) lit += 1;
    }
    return lit;
  });
}

const VIEWS = ['paths', 'aliens', 'stages', 'sounds'] as const;
/** Every game the build ships, read from `variants/` so a new one is covered by being added. */
const VARIANTS = resolve(import.meta.dirname, '..', '..', 'variants');
const GAMES = readdirSync(VARIANTS)
  .filter((name) => name.endsWith('.json'))
  .map((name) => (JSON.parse(readFileSync(join(VARIANTS, name), 'utf8')) as { id: string }).id);

for (const game of GAMES) {
  test(`every view of ${game} builds and draws`, async ({ page }) => {
    const errors = collectErrors(page);
    for (const view of VIEWS) {
      await openLab(page, `game=${game}&view=${view}`);
      expect(await page.evaluate(() => window.starSwarmLab?.game)).toBe(game);
      expect(await page.evaluate(() => window.starSwarmLab?.view)).toBe(view);
      expect(await page.evaluate(() => window.starSwarmLab?.item)).toBeTruthy();
      expect(await litPixels(page)).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
}

test('ESC goes back along the links, and does nothing at the top', async ({ page }) => {
  const errors = collectErrors(page);
  await openLab(page, 'game=classic&view=aliens&item=drone');
  await page.getByRole('button', { name: 'open path' }).first().click();
  await page.waitForFunction(() => window.starSwarmLab?.view === 'paths');
  expect(await page.evaluate(() => window.starSwarmLab?.depth)).toBe(1);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.starSwarmLab?.view === 'aliens');
  expect(await page.evaluate(() => window.starSwarmLab?.item)).toBe('drone');
  expect(await page.evaluate(() => window.starSwarmLab?.depth)).toBe(0);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.starSwarmLab?.view)).toBe('aliens');
  expect(errors).toEqual([]);
});

test('ENTER on the stage list plays the highlighted stage from its start', async ({ page }) => {
  const errors = collectErrors(page);
  await openLab(page, 'game=classic&view=stages');
  const scrubber = page.locator('#stage-scrub');
  expect(await scrubber.inputValue()).toBe('0');

  await page.locator('#stage').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => Number(document.querySelector<HTMLInputElement>('#stage-scrub')?.value) > 30,
  );
  // A stage is steppable: a frame back is exactly one frame back.
  await page.getByRole('button', { name: 'Pause' }).click();
  const at = Number(await scrubber.inputValue());
  await page.getByRole('button', { name: '◀ 1' }).click();
  expect(Number(await scrubber.inputValue())).toBe(at - 1);
  expect(errors).toEqual([]);
});

test('ENTER on the sound list plays the sound, through the game’s synth', async ({ page }) => {
  const errors = collectErrors(page);
  await openLab(page, 'game=classic&view=sounds&item=game-start');
  await page.locator('#sound').focus();
  await page.keyboard.press('Enter');
  // Playing is what draws the playhead: a red line on the plan.
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#screen');
    const ctx = canvas?.getContext('2d');
    if (canvas === null || canvas === undefined || ctx === null || ctx === undefined) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 0xff && data[i + 1] === 0x60 && data[i + 2] === 0x60) return true;
    }
    return false;
  });
  expect(errors).toEqual([]);
});
