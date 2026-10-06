import { expect, type Page, test } from '@playwright/test';

import { PLACEHOLDER_COLOURS } from '../../src/render/scene.js';
import { reachAttract } from './harness.js';

/**
 * A player's variations, played in a real browser with the real keyboard — the
 * captain's question, "do changes made by players persist?", answered: an edit to
 * a shipped game is a named game beside it, and the shipped game plays as it
 * ships.
 *
 * `tests/unit/variations-flow.test.ts` tells the same story to the state machine.
 * What only a browser shows is that each game is **drawn** as itself — a variation
 * mixing in Deep Sea in Deep Sea's art, CLASSIC in its own — that the choice and
 * the variations survive a reload through real `localStorage`, and that the
 * naming card is spelt with the keys a player has.
 */

/** Roughly two frames of the 60 Hz simulation step. */
const FRAMES = 40;

async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(FRAMES);
  await page.keyboard.up(key);
  await page.waitForTimeout(FRAMES);
}

async function phase(page: Page, want: string): Promise<void> {
  await page.waitForFunction((value) => window.starSwarm?.phase === value, want);
}

/** From attract, open the settings. */
async function openSettings(page: Page): Promise<void> {
  await tap(page, 'Escape');
  await phase(page, 'settings');
}

/** Move the settings cursor to a row. */
async function toRow(page: Page, row: string): Promise<void> {
  for (
    let i = 0;
    i < 14 && (await page.evaluate(() => window.starSwarm?.settingsMenuRow)) !== row;
    i += 1
  ) {
    await tap(page, 'ArrowDown');
  }
  expect(await page.evaluate(() => window.starSwarm?.settingsMenuRow)).toBe(row);
}

/** Step the GAME row until the named game is chosen. */
async function choose(page: Page, id: string): Promise<void> {
  await toRow(page, 'game');
  for (let i = 0; i < 10 && (await page.evaluate(() => window.starSwarm?.game)) !== id; i += 1) {
    await tap(page, 'ArrowRight');
  }
  expect(await page.evaluate(() => window.starSwarm?.game)).toBe(id);
}

/** On the pack card, switch one pack on or off. */
async function togglePack(page: Page, id: string): Promise<void> {
  for (
    let i = 0;
    i < 6 && (await page.evaluate(() => window.starSwarm?.editorRow)) !== id;
    i += 1
  ) {
    await tap(page, 'ArrowDown');
  }
  expect(await page.evaluate(() => window.starSwarm?.editorRow)).toBe(id);
  await tap(page, 'ArrowRight');
}

/** The letters the naming card spins through, `END` last — `src/ui/variations.ts`. */
const CHOICES = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.', 'END'];

/** On the naming card: step back over every letter, then spell `name` and keep it. */
async function spell(page: Page, name: string): Promise<void> {
  while (((await page.evaluate(() => window.starSwarm?.nameTaken)) ?? '').length > 0) {
    await tap(page, 'Escape');
  }
  for (const letter of [...name, 'END']) {
    const under = (await page.evaluate(() => window.starSwarm?.nameUnder)) ?? 'END';
    const steps =
      (CHOICES.indexOf(letter) - CHOICES.indexOf(under) + CHOICES.length) % CHOICES.length;
    for (let i = 0; i < steps; i += 1) await tap(page, 'ArrowRight');
    expect(await page.evaluate(() => window.starSwarm?.nameUnder)).toBe(letter);
    await tap(page, 'Enter');
  }
}

/** Edit CLASSIC's pack list and keep the edit as a game called `name`. */
async function makeFromClassic(page: Page, pack: string, name: string): Promise<void> {
  await choose(page, 'classic');
  await toRow(page, 'packs');
  await tap(page, 'ArrowRight');
  await phase(page, 'packs');
  await togglePack(page, pack);
  await tap(page, 'Enter');
  await phase(page, 'name');
  await spell(page, name);
  await phase(page, 'settings');
}

/** Close the settings and start a game on what is in force. */
async function play(page: Page): Promise<void> {
  await tap(page, 'Enter');
  await phase(page, 'attract');
  await tap(page, 'Enter');
  await phase(page, 'playing');
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

/** Leave whatever game is running, back to attract, and on to the settings. */
async function leaveGame(page: Page): Promise<void> {
  await tap(page, 'KeyX');
  await phase(page, 'exit-confirm');
  await tap(page, 'ArrowRight');
  await tap(page, 'Enter');
  await phase(page, 'attract');
  await openSettings(page);
}

test('an edit to CLASSIC is a named game, and CLASSIC still plays as it ships', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await reachAttract(page);
  await openSettings(page);
  await makeFromClassic(page, 'deep-sea', 'REEFS');
  expect(await page.evaluate(() => window.starSwarm?.game)).toBe('classic-2');
  expect(await page.evaluate(() => window.starSwarm?.gameName)).toBe('REEFS');
  expect(await page.evaluate(() => window.starSwarm?.packList)).toEqual(['classic', 'deep-sea']);

  // The variation plays its mix, drawn in Deep Sea's art.
  await play(page);
  expect(await page.evaluate(() => window.starSwarm?.stageDocument)).toBe('reef-1');
  await page.waitForFunction(() => (window.starSwarm?.enemiesHome ?? 0) > 4);
  expect(await placeholderPixels(page)).toBe(0);

  // CLASSIC, chosen again, is the game as shipped: its own pack, its own order,
  // its own first stage and its forty-strong fleet.
  await leaveGame(page);
  await choose(page, 'classic');
  expect(await page.evaluate(() => window.starSwarm?.packList)).toEqual(['classic']);
  expect(await page.evaluate(() => window.starSwarm?.stageOrder)).toEqual([]);
  expect(await page.evaluate(() => window.starSwarm?.setAside)).toBe('');
  await play(page);
  expect(await page.evaluate(() => window.starSwarm?.stageDocument)).toBe('script-0');
  await page.waitForFunction(() => (window.starSwarm?.enemiesHome ?? 0) > 4);
  expect(await page.evaluate(() => window.starSwarm?.enemiesAlive)).toBe(40);
  expect(await placeholderPixels(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('two variations are kept at once, found after a reload, and one is deleted', async ({
  page,
}) => {
  await reachAttract(page);
  await openSettings(page);
  await makeFromClassic(page, 'deep-sea', 'REEFS');
  await makeFromClassic(page, 'swarm-remix', 'NEW GUN');

  await page.reload();
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
  // Both on the list, the shipped games first; the last one made is chosen.
  expect(await page.evaluate(() => window.starSwarm?.games)).toEqual([
    'classic=STAR SWARM',
    'spore-storm=SPORE STORM',
    'deep-sea=DEEP SEA',
    'swarm-remix=SWARM REMIX',
    'classic-2=REEFS',
    'classic-3=NEW GUN',
  ]);
  expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('variant-select');
  expect(await page.evaluate(() => window.starSwarm?.selecting)).toBe('classic-3');
  expect(await page.evaluate(() => window.starSwarm?.packList)).toEqual(['classic', 'swarm-remix']);

  // Take it, open the settings, and delete it: the card opens on KEEP.
  await tap(page, 'Enter');
  await phase(page, 'attract');
  await openSettings(page);
  await toRow(page, 'delete');
  await tap(page, 'ArrowRight');
  await phase(page, 'delete');
  expect(await page.evaluate(() => window.starSwarm?.deleteChoice)).toBe('keep');
  await tap(page, 'ArrowRight');
  expect(await page.evaluate(() => window.starSwarm?.deleteChoice)).toBe('delete');
  await tap(page, 'Enter');
  await phase(page, 'settings');

  expect(await page.evaluate(() => window.starSwarm?.games)).toEqual([
    'classic=STAR SWARM',
    'spore-storm=SPORE STORM',
    'deep-sea=DEEP SEA',
    'swarm-remix=SWARM REMIX',
    'classic-2=REEFS',
  ]);
  expect(await page.evaluate(() => window.starSwarm?.game)).toBe('classic');

  // And it stays deleted.
  await page.reload();
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
  expect(await page.evaluate(() => window.starSwarm?.games)).toHaveLength(5);
});

test('a variation that cannot work is refused, on the card, with the reason', async ({ page }) => {
  await reachAttract(page);
  await openSettings(page);
  await toRow(page, 'packs');
  await tap(page, 'ArrowRight');
  await phase(page, 'packs');
  // No pack with rules left: refused before it can exist, so no naming card.
  await togglePack(page, 'classic');
  await togglePack(page, 'deep-sea');
  expect(await page.evaluate(() => window.starSwarm?.editorVerdict)).toEqual([
    'WILL NOT LOAD',
    'NO PACK IN IT HAS RULES',
    'SWITCH ON A BASE PACK',
  ]);
  await tap(page, 'Enter');
  expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('packs');
  expect(await page.evaluate(() => window.starSwarm?.settings.variations)).toEqual([]);

  // A name another game has is refused on the naming card too.
  await togglePack(page, 'classic');
  await tap(page, 'Enter');
  await phase(page, 'name');
  await spell(page, 'DEEP SEA');
  expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('name');
  expect(await page.evaluate(() => window.starSwarm?.nameRefusal)).toBe('A GAME HAS THAT NAME');
  expect(await page.evaluate(() => window.starSwarm?.settings.variations)).toEqual([]);
});
