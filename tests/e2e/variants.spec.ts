import { expect, type Page, test } from '@playwright/test';

import { PLACEHOLDER_COLOURS } from '../../src/render/scene.js';
import { booted, reachAttract } from './harness.js';

/**
 * The start-up selector and the settings menu in a real browser
 * (`docs/ARCHITECTURE.md` §4.5 and §6).
 *
 * The state machine's transitions are proved headlessly in
 * `tests/unit/flow.test.ts` and the variant loading in
 * `tests/unit/variants.test.ts`; what only a browser can show is that the
 * **bundled** variants load at all, that the page boots into the selector, and
 * that a real keypress reaches it. That is not hypothetical for content: a pack
 * that loads from disk and not from the bundler leaves the page blank, and
 * `variants/` is read the same two ways.
 *
 * Deliberately shallow for the same reason `smoke.spec.ts` is: behaviour belongs
 * in Vitest, wiring belongs here.
 *
 * **Every press is a press, not an event.** The front end reads *edges*
 * (`wasPressed` in `src/engine/input.ts`) over an input frame that is latched and
 * sampled once per simulation step, so back-to-back `keyboard.press` calls can
 * be swallowed two ways: two different keys landing in one frame mean "move a
 * row" and "change a value" at once, and two presses of the *same* key with no
 * sampled gap between them read as one key held down for two frames — which is
 * one edge, not two.
 *
 * So {@link press} holds the key for a couple of frames, releases it for a couple
 * more, and only then waits for what it did. That is what a player's fingers do
 * anyway, and it is the same shape as `press` in `tests/unit/flow.test.ts`, which
 * steps once with the key down and once with it up.
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
async function press(page: Page, key: string, settled: () => boolean): Promise<void> {
  await tap(page, key);
  await page.waitForFunction(settled);
}

/**
 * Walk the settings cursor on one row, naming the row to expect.
 *
 * Its own helper because a `waitForFunction` predicate runs **in the page** and
 * cannot close over a loop variable from this side — the row has to be handed
 * across as an argument.
 */
async function pressToRow(page: Page, row: string): Promise<void> {
  await tap(page, 'ArrowDown');
  await page.waitForFunction((id) => window.starSwarm?.settingsMenuRow === id, row);
}

/** The row the settings cursor is on, as `LABEL=VALUE`. */
async function rows(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => window.starSwarm?.settingsRows ?? []);
}

/**
 * Walk the selector's cursor onto one named variant.
 *
 * Named rather than "the one after `classic`": the list is `variants/`'s, sorted
 * by each document's `order`, so a new game landing between two others silently
 * changes what one press to the right reaches. A test about the demonstration
 * variant has to ask for the demonstration variant.
 */
async function selectVariant(page: Page, id: string): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    if ((await page.evaluate(() => window.starSwarm?.selecting)) === id) return;
    await tap(page, 'ArrowRight');
  }
  throw new Error(`the selector never reached "${id}"`);
}

test('the page boots into the selector with the bundled variants on it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await booted(page);

  expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('variant-select');

  // The list is what `variants/` holds, through the bundler and the real loader.
  const variants = await page.evaluate(() => window.starSwarm?.variants ?? []);
  expect(variants).toContain('classic');
  expect(variants.length).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.starSwarm?.selecting)).toBe('classic');

  // The demo runs behind the list, so nothing on screen is still.
  const first = await page.evaluate(() => window.starSwarm?.playerX ?? 0);
  await page.waitForFunction((x) => (window.starSwarm?.playerX ?? 0) !== x, first, {
    timeout: 10_000,
  });
  expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('variant-select');
  expect(errors).toEqual([]);
});

test('up and down walk the list, and Enter takes the game under the cursor', async ({ page }) => {
  await booted(page);

  await press(page, 'ArrowDown', () => window.starSwarm?.selecting !== 'classic');
  const chosen = await page.evaluate(() => window.starSwarm?.selecting);
  expect(chosen).not.toBe('classic');
  // And back up, which the list never offered before it had a vertical axis.
  await press(page, 'ArrowUp', () => window.starSwarm?.selecting === 'classic');
  await press(page, 'ArrowDown', () => window.starSwarm?.selecting !== 'classic');
  expect(await page.evaluate(() => window.starSwarm?.selecting)).toBe(chosen);

  // Enter takes it, as on every card, and lands on that game's attract screen;
  // Enter there plays it.
  await press(page, 'Enter', () => window.starSwarm?.phase === 'attract');
  expect(await page.evaluate(() => window.starSwarm?.variant)).toBe(chosen);
  await press(page, 'Enter', () => window.starSwarm?.phase === 'playing');

  // The game that started is the one that was under the cursor, and it is a real
  // game from zero.
  expect(await page.evaluate(() => window.starSwarm?.variant)).toBe(chosen);
  expect(await page.evaluate(() => window.starSwarm?.score)).toBe(0);
  expect(await page.evaluate(() => window.starSwarm?.stage)).toBe(1);
  expect(await page.evaluate(() => window.starSwarm?.enemiesAlive)).toBeGreaterThan(0);
});

test('fire chooses a variant and leaves the cabinet in attract', async ({ page }) => {
  await booted(page);

  await press(page, 'Space', () => window.starSwarm?.phase === 'attract');
  expect(await page.evaluate(() => window.starSwarm?.variant)).toBe('classic');

  // And start still starts a game from there.
  await press(page, 'Enter', () => window.starSwarm?.phase === 'playing');
});

test('the settings menu opens, changes the difficulty and survives a reload', async ({ page }) => {
  // Out of the selector first, so the menu is reached the way a player reaches it.
  await reachAttract(page);

  await press(page, 'Escape', () => window.starSwarm?.phase === 'settings');

  const labels = (await rows(page)).map((row) => row.split('=')[0]);
  // `AUTOPLAY` sits beside `DIFFICULTY` because it is the same kind of setting —
  // how the run is framed, not how it looks — and it is shown because the Classic
  // game declares personas. A variant that declares none has no such row.
  expect(labels).toEqual([
    'GAME',
    'DIFFICULTY',
    'AUTOPLAY',
    'VOLUME',
    'SOUND',
    'CONTROLS',
    'CRT',
    'PACKS',
  ]);
  // The pack row counts them; the list itself is the note under the card.
  expect(await rows(page)).toContain('PACKS=1');

  // Down walks to the difficulty row; right changes it. The rank has to move with
  // it — choosing a rank is the whole of what a preset does.
  const rankBefore = await page.evaluate(() => window.starSwarm?.rank);
  await press(page, 'ArrowDown', () => window.starSwarm?.settingsMenuRow === 'difficulty');
  await press(page, 'ArrowRight', () => window.starSwarm?.rank !== 'A');
  const rankAfter = await page.evaluate(() => window.starSwarm?.rank);
  expect(rankBefore).toBe('A');
  expect(rankAfter).not.toBe(rankBefore);

  // The variant did not change: a row change is one row's business.
  expect(await page.evaluate(() => window.starSwarm?.variant)).toBe('classic');

  const difficulty = await page.evaluate(() => window.starSwarm?.difficulty);
  await press(page, 'Escape', () => window.starSwarm?.phase === 'attract');

  // Persisted, if the browser let it be. Playwright's context has working
  // `localStorage`, so this is the real path rather than the fallback.
  expect(await page.evaluate(() => window.starSwarm?.settingsPersistent)).toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
  expect(await page.evaluate(() => window.starSwarm?.difficulty)).toBe(difficulty);
  expect(await page.evaluate(() => window.starSwarm?.rank)).toBe(rankAfter);
});

test('the chosen difficulty reaches the game that starts', async ({ page }) => {
  await reachAttract(page);

  await press(page, 'Escape', () => window.starSwarm?.phase === 'settings');
  await press(page, 'ArrowDown', () => window.starSwarm?.settingsMenuRow === 'difficulty');
  await press(page, 'ArrowRight', () => window.starSwarm?.rank !== 'A');
  const rank = await page.evaluate(() => window.starSwarm?.rank);
  const difficulty = await page.evaluate(() => window.starSwarm?.difficulty);
  await press(page, 'Escape', () => window.starSwarm?.phase === 'attract');

  await press(page, 'Enter', () => window.starSwarm?.phase === 'playing');
  // The rank the preset chose is the rank the run is playing at — the preset
  // reached the world, and nothing was scaled on the way.
  expect(await page.evaluate(() => window.starSwarm?.rank)).toBe(rank);
  expect(await page.evaluate(() => window.starSwarm?.settings.difficulty)).toBe(difficulty);
});

test('the GAME row changes the variant, and the change is remembered', async ({ page }) => {
  await reachAttract(page);

  await press(page, 'Escape', () => window.starSwarm?.phase === 'settings');
  expect(await page.evaluate(() => window.starSwarm?.settingsMenuRow)).toBe('game');
  await press(page, 'ArrowRight', () => window.starSwarm?.variant !== 'classic');
  const chosen = await page.evaluate(() => window.starSwarm?.variant);
  await press(page, 'Escape', () => window.starSwarm?.phase === 'attract');

  // A variant change rebuilds the sprite sheet and the effect map in `main.ts`; a
  // page that survived it and is still stepping is what says that worked.
  const step = await page.evaluate(() => window.starSwarm?.step ?? 0);
  await page.waitForFunction((was) => (window.starSwarm?.step ?? 0) > was, step);

  await page.reload();
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
  expect(await page.evaluate(() => window.starSwarm?.variant)).toBe(chosen);
  // The list opens on the remembered entry rather than at the top.
  expect(await page.evaluate(() => window.starSwarm?.selecting)).toBe(chosen);
});

test('a variant chosen on the selector is remembered for the next session', async ({ page }) => {
  await booted(page);
  await press(page, 'ArrowRight', () => window.starSwarm?.selecting !== 'classic');
  const chosen = await page.evaluate(() => window.starSwarm?.selecting);
  await press(page, 'Space', () => window.starSwarm?.phase === 'attract');
  expect(await page.evaluate(() => window.starSwarm?.variant)).toBe(chosen);

  await page.reload();
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
  expect(await page.evaluate(() => window.starSwarm?.selecting)).toBe(chosen);
  expect(await page.evaluate(() => window.starSwarm?.variant)).toBe(chosen);
});

test('a game plays on the demonstration variant it was started on', async ({ page }) => {
  // The honest end of the demonstration: the overlay pack reaches a real run.
  await booted(page);
  await selectVariant(page, 'swarm-remix');
  await press(page, 'Enter', () => window.starSwarm?.phase === 'attract');
  await press(page, 'Enter', () => window.starSwarm?.phase === 'playing');

  expect(await page.evaluate(() => window.starSwarm?.variant)).toBe('swarm-remix');
  // A whole fleet on the field, from content the overlay inherited.
  expect(await page.evaluate(() => window.starSwarm?.enemiesAlive)).toBe(40);
  expect(await page.evaluate(() => window.starSwarm?.stage)).toBe(1);
});

test('the pack row shows the packs the chosen variant actually layers', async ({ page }) => {
  // The end of the chain the pack manager will attach to: a variant's pack list
  // reaching the screen. The demonstration layers two, so the row and its note
  // have something to disagree about if the wiring is wrong.
  await booted(page);
  await selectVariant(page, 'swarm-remix');
  await press(page, 'Space', () => window.starSwarm?.phase === 'attract');
  await press(page, 'Escape', () => window.starSwarm?.phase === 'settings');

  // Walk down to the pack row, naming each one on the way. The rows are the
  // chosen variant's: this one declares no autoplay personas, so there is no
  // AUTOPLAY row between CRT and PACKS.
  for (const row of ['difficulty', 'volume', 'sound', 'controls', 'crt', 'packs']) {
    await pressToRow(page, row);
  }
  expect(await rows(page)).toContain('PACKS=2');
  expect(await page.evaluate(() => window.starSwarm?.settingsMenuNote)).toBe(
    'classic + swarm-remix',
  );
});

/**
 * The art a remembered variant is drawn with, read off the canvas.
 *
 * This is the one the suite did not have. Every other test here asks the page
 * what it *thinks* — which variant, which rank, which packs — and the page was
 * right about all of it while drawing the Deep Sea fleet as flat squares for a
 * whole release. The flow boots on the remembered variant and `onVariantChange`
 * fires on a *change*, which starting on one is not, so `src/main.ts` held the
 * sheet of whatever came first in the list. Only the pixels show that.
 *
 * Deep Sea by name, like the `swarm-remix` tests above: this has to be a variant
 * that brings its **own** aliens, or a Classic sheet would draw it correctly and
 * the test would prove nothing.
 */
test('a remembered variant is drawn with its own art after a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // Choose it the way a player does, so what is remembered is remembered the
  // ordinary way, and then come back to the cabinet.
  await booted(page);
  await selectVariant(page, 'deep-sea');
  await press(page, 'Space', () => window.starSwarm?.phase === 'attract');
  await page.reload();
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
  expect(await page.evaluate(() => window.starSwarm?.variant)).toBe('deep-sea');

  await press(page, 'Enter', () => window.starSwarm?.phase === 'attract');
  await press(page, 'Enter', () => window.starSwarm?.phase === 'playing');
  // A fleet actually on the screen: with none launched there is nothing to draw
  // either way, and the count is the trench formation's rather than Classic's.
  await page.waitForFunction(() => (window.starSwarm?.enemiesHome ?? 0) > 4);
  expect(await page.evaluate(() => window.starSwarm?.enemiesAlive)).toBe(26);

  // `src/render/scene.ts` draws these three and only these three, and only for an
  // enemy it has no sprite for; `tests/unit/scene.test.ts` holds no shipped pack
  // palette to any of them, so a hit here is a placeholder and nothing else.
  const placeholderPixels = await page.evaluate((colours) => {
    const canvas = document.querySelector('canvas#screen');
    if (!(canvas instanceof HTMLCanvasElement)) return -1;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return -1;
    const wanted = colours.map((colour) => [
      Number.parseInt(colour.slice(1, 3), 16),
      Number.parseInt(colour.slice(3, 5), 16),
      Number.parseInt(colour.slice(5, 7), 16),
    ]);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let hits = 0;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at + 3] === 0) continue;
      for (const [r, g, b] of wanted) {
        if (data[at] === r && data[at + 1] === g && data[at + 2] === b) hits += 1;
      }
    }
    return hits;
  }, PLACEHOLDER_COLOURS as string[]);

  expect(placeholderPixels).toBe(0);
  // And the mismatch check in `scene.ts` did not have to fire to get there.
  expect(errors).toEqual([]);
});
