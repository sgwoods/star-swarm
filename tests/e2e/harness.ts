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

/**
 * What `selecting` reads on the game list's `SETTINGS` row (`src/main.ts`).
 * Parentheses, because no game id may contain one.
 */
export const SETTINGS_ROW = '(settings)';

/** How long a key is held, and then left up: a few fixed steps each way. */
const KEY_FRAMES = 60;

/**
 * Press a key as a person does: down for a few frames, then up for a few. The
 * front end reads edges once a step, so a press shorter than a step can be missed.
 */
async function tapKey(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(KEY_FRAMES);
  await page.keyboard.up(key);
  await page.waitForTimeout(KEY_FRAMES);
}

/** Walk the game list's cursor up until it is on one row, by its `selecting` id. */
export async function walkListTo(page: Page, id: string): Promise<void> {
  for (let i = 0; i < 24; i += 1) {
    if ((await page.evaluate(() => window.starSwarm?.selecting)) === id) return;
    await tapKey(page, 'ArrowUp');
  }
  throw new Error(`the game list never reached ${id}`);
}

/**
 * Open the settings from attract, the way a player does: `Escape` climbs to the
 * game list, whose last row is `SETTINGS` — or, in a build with one game and so
 * no list, opens the settings directly (`src/ui/keys.ts`).
 */
export async function openSettings(page: Page): Promise<void> {
  await tapKey(page, 'Escape');
  await page.waitForFunction(
    () => window.starSwarm?.phase === 'variant-select' || window.starSwarm?.phase === 'settings',
  );
  if ((await page.evaluate(() => window.starSwarm?.phase)) === 'variant-select') {
    await walkListTo(page, SETTINGS_ROW);
    await tapKey(page, 'Enter');
  }
  await page.waitForFunction(() => window.starSwarm?.phase === 'settings');
}

/**
 * Leave the settings for the chosen game's attract screen: `Escape` goes back to
 * the list they were opened from, and `Enter` on the chosen game takes it.
 *
 * It waits only for the page to be off both menus, not for attract itself: with
 * autoplay armed, attract presses start on its own and may be gone before a poll
 * sees it. A test that needs attract waits for it.
 */
export async function leaveSettings(page: Page): Promise<void> {
  await tapKey(page, 'Escape');
  await page.waitForFunction(
    () => window.starSwarm?.phase === 'variant-select' || window.starSwarm?.phase === 'attract',
  );
  if ((await page.evaluate(() => window.starSwarm?.phase)) === 'variant-select') {
    await walkListTo(page, (await page.evaluate(() => window.starSwarm?.game)) ?? '');
    await tapKey(page, 'Enter');
  }
  await page.waitForFunction(
    () => window.starSwarm?.phase !== 'settings' && window.starSwarm?.phase !== 'variant-select',
  );
}
