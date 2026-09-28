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
 * Fire chooses the variant under the cursor and drops into attract, which is the
 * ordinary way a player gets there.
 */
export async function reachAttract(page: Page): Promise<void> {
  await booted(page);
  if ((await page.evaluate(() => window.starSwarm?.phase)) === 'variant-select') {
    await page.keyboard.press('Space');
  }
  await page.waitForFunction(() => window.starSwarm?.phase === 'attract');
}

/**
 * Put a game on the screen.
 *
 * Start plays from either screen — from the selector it chooses the variant under
 * the cursor and plays it — so this is one press either way, exactly as a player
 * does it.
 */
export async function startGame(page: Page): Promise<void> {
  await booted(page);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');
}
