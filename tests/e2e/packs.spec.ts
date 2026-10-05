import { expect, type Page, test } from '@playwright/test';

import { PLACEHOLDER_COLOURS } from '../../src/render/scene.js';
import { reachAttract } from './harness.js';

/**
 * The pack manager and the stage-sequence editor, played in a real browser with
 * the real keyboard — `docs/ROADMAP.md`'s Milestone 3 exit check, that a player
 * can change the rules from inside the game.
 *
 * `tests/unit/pack-manager-flow.test.ts` tells the same story to the state
 * machine. What only a browser shows is that the composed game is what is
 * **drawn**: the sprite sheet has to be rebuilt from the composed packs, and a
 * sheet that missed them would draw the mix's enemies as placeholder squares — or
 * throw `SceneSheetMismatchError` — while every state assertion stayed green. So
 * the game is read off the canvas as well as off `window.starSwarm`.
 */

/** Roughly two frames of the 60 Hz simulation step. */
const FRAMES = 40;

async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(FRAMES);
  await page.keyboard.up(key);
  await page.waitForTimeout(FRAMES);
}

/** From a fresh page to the settings screen over the Classic game. */
async function openSettings(page: Page): Promise<void> {
  await reachAttract(page);
  expect(await page.evaluate(() => window.starSwarm?.variant)).toBe('classic');
  await tap(page, 'Escape');
  await page.waitForFunction(() => window.starSwarm?.phase === 'settings');
}

/** Move the settings cursor to a row, then press right: the row opens its card. */
async function openCard(page: Page, row: string, phase: string): Promise<void> {
  for (
    let i = 0;
    i < 12 && (await page.evaluate(() => window.starSwarm?.settingsMenuRow)) !== row;
    i += 1
  ) {
    await tap(page, 'ArrowDown');
  }
  expect(await page.evaluate(() => window.starSwarm?.settingsMenuRow)).toBe(row);
  await tap(page, 'ArrowRight');
  await page.waitForFunction((want) => window.starSwarm?.phase === want, phase);
}

/** Move the pack card's cursor to a pack. */
async function toPack(page: Page, id: string): Promise<void> {
  for (
    let i = 0;
    i < 6 && (await page.evaluate(() => window.starSwarm?.editorRow)) !== id;
    i += 1
  ) {
    await tap(page, 'ArrowDown');
  }
  expect(await page.evaluate(() => window.starSwarm?.editorRow)).toBe(id);
}

/** Close the settings and start a game on what is in force. */
async function play(page: Page): Promise<void> {
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'attract');
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');
}

/** Pixels on the screen in one of `scene.ts`'s placeholder colours. */
async function placeholderPixels(page: Page): Promise<number> {
  return page.evaluate((colours) => {
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
}

test('a composed list is kept, played, drawn, and still there after a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await openSettings(page);
  await openCard(page, 'packs', 'packs');
  expect(await page.evaluate(() => window.starSwarm?.editorRows)).toEqual([
    'Classic=1',
    'Deep Sea=OFF',
    'Swarm Remix=OFF',
  ]);

  await toPack(page, 'deep-sea');
  await tap(page, 'ArrowRight');
  expect(await page.evaluate(() => window.starSwarm?.editorDraft)).toEqual(['classic', 'deep-sea']);
  expect(await page.evaluate(() => window.starSwarm?.editorOk)).toBe(true);
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'settings');
  expect(await page.evaluate(() => window.starSwarm?.packList)).toEqual(['classic', 'deep-sea']);

  await play(page);
  expect(await page.evaluate(() => window.starSwarm?.stageDocument)).toBe('reef-1');
  // The trench formation's fleet, drawn with the pack's own art.
  await page.waitForFunction(() => (window.starSwarm?.enemiesHome ?? 0) > 4);
  expect(await page.evaluate(() => window.starSwarm?.enemiesAlive)).toBe(26);
  expect(await placeholderPixels(page)).toBe(0);
  expect(errors).toEqual([]);

  // Leave the game, and the page; the list is the player's, so it comes back.
  await page.reload();
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
  expect(await page.evaluate(() => window.starSwarm?.packList)).toEqual(['classic', 'deep-sea']);
  expect(await page.evaluate(() => window.starSwarm?.setAside)).toBe('');
});

test('a list that cannot work is refused on the card, and nothing is written', async ({ page }) => {
  await openSettings(page);
  await openCard(page, 'packs', 'packs');
  await toPack(page, 'classic');
  await tap(page, 'ArrowRight');
  await toPack(page, 'deep-sea');
  await tap(page, 'ArrowRight');
  expect(await page.evaluate(() => window.starSwarm?.editorDraft)).toEqual(['deep-sea']);
  expect(await page.evaluate(() => window.starSwarm?.editorVerdict)).toEqual([
    'WILL NOT LOAD',
    'NO PACK IN IT HAS RULES',
    'SWITCH ON A BASE PACK',
  ]);

  await tap(page, 'Enter');
  // Still on the card, refusing; nothing stored, nothing changed in the game.
  expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('packs');
  expect(await page.evaluate(() => window.starSwarm?.settings.packs)).toEqual({});
  expect(await page.evaluate(() => window.starSwarm?.packList)).toEqual(['classic']);

  await tap(page, 'Escape');
  await page.waitForFunction(() => window.starSwarm?.phase === 'settings');
  expect(await page.evaluate(() => window.starSwarm?.settings.packs)).toEqual({});
});

test('a stage order mixes a Classic script into the Deep Sea stages, and plays it', async ({
  page,
}) => {
  await openSettings(page);
  await openCard(page, 'packs', 'packs');
  await toPack(page, 'deep-sea');
  await tap(page, 'ArrowRight');
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'settings');

  await openCard(page, 'stages', 'stages');
  expect(await page.evaluate(() => window.starSwarm?.editorRows)).toEqual([
    'ORDER=OWN',
    '1=reef-1',
    '2=reef-2',
    '3=reef-3',
    '+=--',
  ]);
  // Row 1, one step left: the last of Classic's thirteen scripts.
  await tap(page, 'ArrowDown');
  await tap(page, 'ArrowLeft');
  expect(await page.evaluate(() => window.starSwarm?.editorDraft)).toEqual([
    'script-12',
    'reef-2',
    'reef-3',
  ]);
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'settings');
  expect(await page.evaluate(() => window.starSwarm?.stageOrder)).toEqual([
    'script-12',
    'reef-2',
    'reef-3',
  ]);

  await play(page);
  expect(await page.evaluate(() => window.starSwarm?.stageDocument)).toBe('script-12');
});

test('a stored list naming a pack this build lacks is set aside, and readable', async ({
  page,
}) => {
  await reachAttract(page);
  await page.evaluate(() => {
    localStorage.setItem(
      'star-swarm/settings/v1',
      JSON.stringify({
        version: 1,
        settings: { packs: { classic: ['classic', 'deep-sea', 'moon-base'] } },
      }),
    );
  });
  await page.reload();
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
  // The game as shipped plays, and says why.
  expect(await page.evaluate(() => window.starSwarm?.packList)).toEqual(['classic']);
  expect(await page.evaluate(() => window.starSwarm?.setAside)).toBe(
    'WILL NOT LOAD / PACK moon-base / IS NOT INSTALLED HERE',
  );

  await tap(page, 'Enter');
  await page.waitForFunction(() => window.starSwarm?.phase === 'attract');
  await tap(page, 'Escape');
  await page.waitForFunction(() => window.starSwarm?.phase === 'settings');
  await openCard(page, 'packs', 'packs');
  expect(await page.evaluate(() => window.starSwarm?.editorRows)).toContain('moon-base=MISSING');
});
