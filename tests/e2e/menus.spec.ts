import { expect, type Page, test } from '@playwright/test';

import { reachAttract, startGame } from './harness.js';

/**
 * The one scheme every card is worked with (`src/ui/keys.ts`), proved by key
 * press in a real browser: up and down move between rows, left and right change
 * the row under the cursor, Enter takes, Escape goes back — and the exit card
 * still commits on Enter and still refuses the double-tap of the key that opened
 * it.
 *
 * `tests/unit/flow.test.ts` proves the same against the state machine. What only
 * a browser shows is that the **keys** reach it: that ArrowUp and ArrowDown are
 * bound at all, and that a control scheme narrows them with the keys it keeps.
 */

/** Roughly two frames of the 60 Hz simulation step. */
const FRAMES = 40;

/** Hold a key for a couple of frames and let it go for a couple more. */
async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(FRAMES);
  await page.keyboard.up(key);
  await page.waitForTimeout(FRAMES);
}

const row = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.starSwarm?.settingsMenuRow);

async function openSettings(page: Page): Promise<void> {
  await reachAttract(page);
  await tap(page, 'Escape');
  await page.waitForFunction(() => window.starSwarm?.phase === 'settings');
}

test('up and down move between rows, both ways, and wrap', async ({ page }) => {
  await openSettings(page);
  const rows = (await page.evaluate(() => window.starSwarm?.settingsRows ?? [])).map((entry) =>
    entry.split('=')[0]?.toLowerCase(),
  );
  expect(await row(page)).toBe(rows[0]);

  await tap(page, 'ArrowDown');
  expect(await row(page)).toBe(rows[1]);
  await tap(page, 'ArrowDown');
  expect(await row(page)).toBe(rows[2]);
  // The row above is one press away — the thing fire-for-next never offered.
  await tap(page, 'ArrowUp');
  expect(await row(page)).toBe(rows[1]);
  await tap(page, 'ArrowUp');
  await tap(page, 'ArrowUp');
  expect(await row(page)).toBe(rows[rows.length - 1]);
});

test('left and right change the row under the cursor, and only that row', async ({ page }) => {
  await openSettings(page);
  for (let i = 0; i < 12 && (await row(page)) !== 'volume'; i += 1) await tap(page, 'ArrowDown');
  expect(await row(page)).toBe('volume');

  const before = await page.evaluate(() => window.starSwarm?.settings.volume ?? 0);
  const difficulty = await page.evaluate(() => window.starSwarm?.settings.difficulty);
  await tap(page, 'ArrowLeft');
  const lower = await page.evaluate(() => window.starSwarm?.settings.volume ?? 0);
  expect(lower).toBeLessThan(before);
  await tap(page, 'ArrowRight');
  expect(await page.evaluate(() => window.starSwarm?.settings.volume)).toBe(before);
  expect(await page.evaluate(() => window.starSwarm?.settings.difficulty)).toBe(difficulty);

  // Enter is done, as it is on every card, and the change stays.
  await tap(page, 'ArrowLeft');
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'attract');
  expect(await page.evaluate(() => window.starSwarm?.settings.volume)).toBe(lower);
});

test('the WASD scheme works the card with W and S as well as A and D', async ({ page }) => {
  await openSettings(page);
  for (let i = 0; i < 12 && (await row(page)) !== 'controls'; i += 1) {
    await tap(page, 'ArrowDown');
  }
  for (let i = 0; i < 3; i += 1) {
    if ((await page.evaluate(() => window.starSwarm?.settings.controls)) === 'wasd') break;
    await tap(page, 'ArrowRight');
  }
  expect(await page.evaluate(() => window.starSwarm?.settings.controls)).toBe('wasd');

  // The arrows are now someone else's scheme; W and S are this one's.
  await tap(page, 'ArrowUp');
  expect(await row(page)).toBe('controls');
  await tap(page, 'KeyW');
  expect(await row(page)).not.toBe('controls');
  await tap(page, 'KeyS');
  expect(await row(page)).toBe('controls');
  await tap(page, 'KeyD');
  expect(await page.evaluate(() => window.starSwarm?.settings.controls)).toBe('both');
});

test.describe('the exit card', () => {
  test('walks with the arrows and still refuses the double-tap on EXIT', async ({ page }) => {
    await startGame(page);
    await tap(page, 'x');
    await page.waitForFunction(() => window.starSwarm?.phase === 'exit-confirm');
    expect(await page.evaluate(() => window.starSwarm?.exitChoice)).toBe('resume');

    await tap(page, 'ArrowDown');
    expect(await page.evaluate(() => window.starSwarm?.exitChoice)).toBe('exit');
    await tap(page, 'ArrowUp');
    expect(await page.evaluate(() => window.starSwarm?.exitChoice)).toBe('resume');
    await tap(page, 'ArrowRight');
    expect(await page.evaluate(() => window.starSwarm?.exitChoice)).toBe('exit');

    // On EXIT, the key that opened the card cancels: the run survives.
    await tap(page, 'x');
    await page.waitForFunction(() => window.starSwarm?.phase === 'paused');
  });

  test('commits on Enter once EXIT is chosen', async ({ page }) => {
    await startGame(page);
    await tap(page, 'x');
    await page.waitForFunction(() => window.starSwarm?.phase === 'exit-confirm');
    await tap(page, 'ArrowDown');
    expect(await page.evaluate(() => window.starSwarm?.exitChoice)).toBe('exit');
    await tap(page, 'Enter');
    await page.waitForFunction(() => window.starSwarm?.phase === 'attract');
  });
});
