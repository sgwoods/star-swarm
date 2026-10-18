import { expect, type Page, test } from '@playwright/test';

import { booted, reachAttract, walkListTo } from './harness.js';

/**
 * A game's own options, played in a real browser with the real keyboard — the
 * captain's "each game should have a settings control", reached from the game,
 * and his boundary that a reference game must not be breakable while a player's
 * variation may persist.
 *
 * `tests/unit/options-flow.test.ts` tells the same story to the state machine.
 * What only a browser shows is that the card is reached with the keys a player
 * has, that the count reaches the game actually played, and that the variation
 * and CLASSIC's own count both survive a reload through real `localStorage`.
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

async function optionsRows(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => window.starSwarm?.optionsRows ?? []);
}

test('a game’s options are reached from its attract screen, and Esc goes back', async ({
  page,
}) => {
  await reachAttract(page);
  expect(await page.evaluate(() => window.starSwarm?.game)).toBe('classic');
  await tap(page, 'ArrowDown');
  await phase(page, 'options');
  expect(await page.evaluate(() => window.starSwarm?.optionsHeading)).toBe('STAR SWARM OPTIONS');
  expect(await optionsRows(page)).toEqual(['SHIPS=3', 'AUDIO=ARCADE']);

  // A draft thrown away is nothing written.
  await tap(page, 'ArrowRight');
  expect(await optionsRows(page)).toEqual(['SHIPS=4', 'AUDIO=ARCADE']);
  await tap(page, 'Escape');
  await phase(page, 'attract');
  expect(await page.evaluate(() => window.starSwarm?.settings.variations.length)).toBe(0);
  expect(await page.evaluate(() => window.starSwarm?.variantLives)).toBe(3);
});

test('five ships on CLASSIC is a game of the player’s own, and CLASSIC still starts on three', async ({
  page,
}) => {
  await reachAttract(page);
  await tap(page, 'ArrowDown');
  await phase(page, 'options');
  await tap(page, 'ArrowRight');
  await tap(page, 'ArrowRight');
  expect(await optionsRows(page)).toEqual(['SHIPS=5', 'AUDIO=ARCADE']);
  expect(await page.evaluate(() => window.starSwarm?.optionsVerdict[0])).toBe('LOADS AND BUILDS');
  await tap(page, 'Enter');
  await phase(page, 'name');
  await spell(page, 'FIVE SHIPS');
  await phase(page, 'attract');

  expect(await page.evaluate(() => window.starSwarm?.game)).toBe('classic-2');
  expect(await page.evaluate(() => window.starSwarm?.gameName)).toBe('FIVE SHIPS');
  expect(await page.evaluate(() => window.starSwarm?.variantLives)).toBe(5);

  // The count reaches the game played.
  await tap(page, 'Enter');
  await phase(page, 'playing');
  expect(await page.evaluate(() => window.starSwarm?.startingLives)).toBe(5);
  expect(await page.evaluate(() => window.starSwarm?.lives)).toBe(4);

  // Through a reload: the variation is kept, and carries its count as a document field.
  await booted(page);
  expect(await page.evaluate(() => window.starSwarm?.game)).toBe('classic-2');
  expect(await page.evaluate(() => window.starSwarm?.variantLives)).toBe(5);
  const stored = await page.evaluate(() => window.starSwarm?.settings.variations ?? []);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ id: 'classic-2', derivedFrom: 'classic', lives: 5 });

  // CLASSIC, chosen again, is the game as shipped: three ships.
  await walkListTo(page, 'classic');
  await tap(page, 'Enter');
  await phase(page, 'attract');
  expect(await page.evaluate(() => window.starSwarm?.variantLives)).toBe(3);
  await tap(page, 'Enter');
  await phase(page, 'playing');
  expect(await page.evaluate(() => window.starSwarm?.startingLives)).toBe(3);
});

test('DUSK on CLASSIC is a game of the player’s own that plays its sounds, and CLASSIC still plays its own', async ({
  page,
}) => {
  await reachAttract(page);
  expect(await page.evaluate(() => window.starSwarm?.soundFor('shot-fired'))).toBe('fire');
  await tap(page, 'ArrowDown');
  await phase(page, 'options');
  await tap(page, 'ArrowDown');
  expect(await page.evaluate(() => window.starSwarm?.optionsRow)).toBe('audio');
  await tap(page, 'ArrowRight');
  expect(await optionsRows(page)).toEqual(['SHIPS=3', 'AUDIO=DUSK']);
  await tap(page, 'Enter');
  await phase(page, 'name');
  await spell(page, 'DUSK');
  await phase(page, 'attract');

  // The theme reaches the effect channel the game plays through.
  expect(await page.evaluate(() => window.starSwarm?.game)).toBe('classic-2');
  expect(await page.evaluate(() => window.starSwarm?.soundFor('shot-fired'))).toBe('dusk-fire');
  const stored = await page.evaluate(() => window.starSwarm?.settings.variations ?? []);
  expect(stored[0]).toMatchObject({ id: 'classic-2', derivedFrom: 'classic', theme: 'dusk' });

  // CLASSIC, chosen again from the game list, sounds as shipped.
  await tap(page, 'Escape');
  await phase(page, 'variant-select');
  await walkListTo(page, 'classic');
  await tap(page, 'Enter');
  await phase(page, 'attract');
  expect(await page.evaluate(() => window.starSwarm?.soundFor('shot-fired'))).toBe('fire');
});
