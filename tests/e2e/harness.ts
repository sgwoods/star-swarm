import type { Page } from '@playwright/test';

/**
 * Getting a browser to the state a test wants.
 *
 * Not a `*.spec.ts`, so Playwright does not collect it as a suite.
 *
 * The cabinet boots into the **start-up selector** when this build offers more
 * than one variant and into attract mode when it offers one
 * (`docs/ARCHITECTURE.md` §4.5). Every test that wants attract, or a game, has to
 * get past it — and has to keep working if the shipped variant list ever goes
 * back to one — so the two steps live here rather than in each spec.
 */

/** Wait for the fixed-step loop to be turning. */
export async function booted(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
}

/**
 * Leave the page in attract mode, whichever phase it booted into.
 *
 * Fire chooses the variant under the cursor and drops into attract, as Enter
 * does, which is the ordinary way a player gets there.
 */
export async function reachAttract(page: Page): Promise<void> {
  await booted(page);
  if ((await page.evaluate(() => window.starSwarm?.phase)) === 'variant-select') {
    await page.keyboard.press('Space');
  }
  await page.waitForFunction(() => window.starSwarm?.phase === 'attract');
}

/**
 * Press start until a game is on the screen, from whichever phase the page is in.
 *
 * From the selector that is two presses — the first takes the variant under the
 * cursor and lands on its attract screen, the second plays it — exactly as a
 * player does it. Between the two the page is allowed a couple of steps with the
 * key up, because the front end reads edges and two presses inside one sampled
 * frame read as one.
 */
export async function pressStart(page: Page): Promise<void> {
  if ((await page.evaluate(() => window.starSwarm?.phase)) === 'variant-select') {
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.starSwarm?.phase === 'attract');
    const step = await page.evaluate(() => window.starSwarm?.step ?? 0);
    await page.waitForFunction((was) => (window.starSwarm?.step ?? 0) > was + 1, step);
  }
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');
}

/** Put a game on the screen, from a fresh page. */
export async function startGame(page: Page): Promise<void> {
  await booted(page);
  await pressStart(page);
}
