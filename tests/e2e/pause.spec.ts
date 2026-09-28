import { expect, type Page, test } from '@playwright/test';

import { startGame } from './harness.js';

/**
 * Pause and the way out, in a real browser (`docs/ARCHITECTURE.md` §2, "Pause,
 * and the way out").
 *
 * The machine's transitions are proved headlessly in `tests/unit/flow.test.ts`,
 * including the one that matters most — that a resumed run continues bit for
 * bit. What only a browser can show is the **wiring**: that `P` and `X` are bound
 * at all, that a real keypress reaches the flow, and that the simulation's own
 * step counter stops while the loop keeps turning. That last one is not a detail
 * a unit test can reach: the page's fixed-step loop is still running under a
 * paused game, and "the loop runs but the world does not" is exactly what could
 * be wired wrong here and nowhere else.
 *
 * Deliberately shallow for the same reason the other specs are: behaviour belongs
 * in Vitest, wiring belongs here. Every press is held for a couple of frames and
 * released for a couple more, because the front end reads *edges* over a frame
 * sampled once per simulation step — see the note at the top of
 * `tests/e2e/variants.spec.ts`.
 */

/** Roughly two frames of the 60 Hz simulation step. */
const FRAMES = 40;

/** Hold a key down for a couple of frames, then let it go for a couple more. */
async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(FRAMES);
  await page.keyboard.up(key);
  await page.waitForTimeout(FRAMES);
}

/** Press a key as a person does, then wait until the page shows it landed. */
async function press(page: Page, key: string, phase: string): Promise<void> {
  await tap(page, key);
  await page.waitForFunction((want) => window.starSwarm?.phase === want, phase);
}

const simStep = async (page: Page): Promise<number> =>
  (await page.evaluate(() => window.starSwarm?.simStep)) ?? -1;

const flowStep = async (page: Page): Promise<number> =>
  (await page.evaluate(() => window.starSwarm?.step)) ?? -1;

test.describe('pause', () => {
  test('P holds the game, and the loop keeps turning under it', async ({ page }) => {
    await startGame(page);
    await press(page, 'p', 'paused');

    const world = await simStep(page);
    const flow = await flowStep(page);
    await page.waitForTimeout(500);

    // The world is where it was; the page is not frozen, it is not stepping the
    // world. That difference is the whole of what pausing is here.
    expect(await simStep(page)).toBe(world);
    expect(await flowStep(page)).toBeGreaterThan(flow);
  });

  test('P lets it go again, and the world moves on from where it stopped', async ({ page }) => {
    await startGame(page);
    await press(page, 'p', 'paused');
    const held = await simStep(page);

    await press(page, 'p', 'playing');
    await page.waitForFunction((at) => (window.starSwarm?.simStep ?? 0) > at, held);
    expect(await simStep(page)).toBeGreaterThan(held);
  });
});

test.describe('exit', () => {
  test('X stops the game first and then asks, on the safe answer', async ({ page }) => {
    await startGame(page);
    await press(page, 'x', 'exit-confirm');

    // Stopped on the frame it was pressed: the question is not answered under
    // fire.
    const world = await simStep(page);
    await page.waitForTimeout(500);
    expect(await simStep(page)).toBe(world);
    expect(await page.evaluate(() => window.starSwarm?.exitChoice)).toBe('resume');
  });

  test('the fire button takes the default, which is to carry on playing', async ({ page }) => {
    await startGame(page);
    await press(page, 'x', 'exit-confirm');
    await press(page, 'Space', 'paused');
    await press(page, 'p', 'playing');
  });

  test('X is also the way back out of the card', async ({ page }) => {
    await startGame(page);
    await press(page, 'x', 'exit-confirm');
    await tap(page, 'ArrowRight');
    await page.waitForFunction(() => window.starSwarm?.exitChoice === 'exit');
    // Even with the cursor on EXIT: the key that opened the card cancels it.
    await press(page, 'x', 'paused');
  });

  test('choosing EXIT goes home to attract, and the run is gone', async ({ page }) => {
    await startGame(page);
    const best = (await page.evaluate(() => window.starSwarm?.highScore)) ?? 0;

    await press(page, 'x', 'exit-confirm');
    await tap(page, 'ArrowRight');
    await page.waitForFunction(() => window.starSwarm?.exitChoice === 'exit');
    await press(page, 'Space', 'attract');

    // Home is attract in this cabinet and in a one-variant one alike, and the
    // abandoned run left nothing behind on the table.
    expect(await page.evaluate(() => window.starSwarm?.highScore)).toBe(best);
    // And start plays again from there, as it does between games.
    await press(page, 'Enter', 'playing');
  });
});
