import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

/**
 * The shelf, in a real browser: the page beside the game lists every variation in
 * `shelf/`, and its `PLAY` opens the game with that one chosen — on the list,
 * marked and credited — and plays it from its own document.
 *
 * What is on the shelf is the curator's and changes with every accepted
 * submission, so nothing here names an entry: the spec reads `shelf/` the way the
 * gate does and holds the page to whatever is there. An empty shelf is a real
 * state of the page as well, and the play test says it is skipped rather than
 * passing on nothing.
 */

const SHELF = resolve(import.meta.dirname, '..', '..', 'shelf');

interface OnDisk {
  readonly id: string;
  readonly name: string;
  readonly author: string;
}

/** Every entry in `shelf/`, by file order, as its document states it. */
function shelfOnDisk(): readonly OnDisk[] {
  let files: string[];
  try {
    files = readdirSync(SHELF)
      .filter((file) => file.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  return files.map((file) => {
    const value = JSON.parse(readFileSync(join(SHELF, file), 'utf8')) as Record<string, unknown>;
    return { id: String(value.id), name: String(value.name), author: String(value.author) };
  });
}

/** Roughly two frames of the 60 Hz simulation step. */
const FRAMES = 40;

async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(FRAMES);
  await page.keyboard.up(key);
  await page.waitForTimeout(FRAMES);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('the shelf page lists every entry, with its maker, its changes and a way to play it', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/shelf.html');
  await page.waitForSelector('#shelf[aria-busy="false"]');

  const entries = shelfOnDisk();
  const cards = page.locator('#shelf article.entry');
  await expect(cards).toHaveCount(entries.length);
  if (entries.length === 0) {
    await expect(page.locator('#shelf .empty')).toContainText('Nothing is on the shelf yet');
  }
  for (const entry of entries) {
    const card = page.locator(`#shelf article.entry[id="${entry.id}"]`);
    await expect(card.locator('h2')).toHaveText(entry.name);
    await expect(card.locator('.credit')).toContainText(`by ${entry.author} · made from `);
    expect(await card.locator('li').count()).toBeGreaterThan(0);
    await expect(card.locator('a.play')).toHaveAttribute('href', `./?game=${entry.id}`);
  }
  // The way in is on the page whatever is on the shelf.
  await expect(page.getByRole('link', { name: 'Put it on the shelf' })).toHaveAttribute(
    'href',
    /CONTRIBUTING\.md$/,
  );
  expect(errors).toEqual([]);
});

test('PLAY opens the game with that entry chosen, and the entry plays as itself', async ({
  page,
}) => {
  const [first] = shelfOnDisk();
  test.skip(first === undefined, 'the shelf is empty, so there is nothing to play');
  if (first === undefined) return;
  const errors = collectErrors(page);

  await page.goto('/shelf.html');
  await page.locator(`#shelf article.entry[id="${first.id}"] a.play`).click();
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);

  // On the list, with the cursor on it — and the address has forgotten the choice,
  // so a refresh after choosing another game does not choose this one again.
  expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('variant-select');
  expect(await page.evaluate(() => window.starSwarm?.selecting)).toBe(first.id);
  expect(await page.evaluate(() => window.starSwarm?.shelf)).toContain(first.id);
  expect(await page.evaluate(() => window.starSwarm?.shelfRefused)).toEqual([]);
  expect(new URL(page.url()).search).toBe('');
  // Listed after every reference game, never among them.
  const games = await page.evaluate(() => window.starSwarm?.games ?? []);
  const references = await page.evaluate(() => window.starSwarm?.variants ?? []);
  const at = games.findIndex((game) => game.startsWith(`${first.id}=`));
  expect(at).toBeGreaterThanOrEqual(references.length);

  // Enter takes it, and Enter there plays it: its own document, its own table.
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'attract');
  expect(await page.evaluate(() => window.starSwarm?.game)).toBe(first.id);
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');
  expect(await page.evaluate(() => window.starSwarm?.variant)).toBe(first.id);
  expect(await page.evaluate(() => window.starSwarm?.startingLives)).toBe(
    await page.evaluate(() => window.starSwarm?.variantLives),
  );
  expect(errors).toEqual([]);
});

test('a link naming no game on offer plays what the player would have had', async ({ page }) => {
  await page.goto('/?game=no-such-game');
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
  expect(await page.evaluate(() => window.starSwarm?.game)).toBe('classic');
  expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('variant-select');
});

test('Esc on the shelf page goes back to the game, as it does on every screen', async ({
  page,
}) => {
  await page.goto('/shelf.html');
  await page.waitForSelector('#shelf[aria-busy="false"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
  expect(new URL(page.url()).pathname).toBe('/');
});
