import { expect, type Page, test } from '@playwright/test';

import { booted, reachAttract } from './harness.js';

/**
 * The attract demo naming its pilot, in a real browser (`docs/ARCHITECTURE.md`
 * §6).
 *
 * The cycle itself — who flies first, the handover on a game over, a leg repeating
 * exactly, the script for a variant with no personas — is proved headlessly in
 * `tests/unit/attract.test.ts` and `tests/unit/flow.test.ts`, where a whole leg
 * costs milliseconds rather than a minute of wall clock. What only the page can
 * show is that the tag is **drawn**, in the bottom band, for the variant the
 * cabinet is actually running — so this reads the backbuffer, because a page that
 * knew the persona and drew nothing would pass every state assertion there is.
 */

/** The dim ink the tag is drawn in (`src/ui/hud.ts`), as RGB. */
const TAG_INK = [0x7d, 0x8a, 0xa8] as const;

/** Pixels of the tag's ink in the middle of the bottom band, on the 224x288 backbuffer. */
async function tagPixels(page: Page): Promise<number> {
  return page.evaluate((ink) => {
    const canvas = window.starSwarm?.backbuffer;
    const ctx = canvas?.getContext('2d');
    if (ctx === null || ctx === undefined) return -1;
    // Between the widest the reserve row and the badge row ever get, on the
    // badges' own row: nothing but the tag is drawn in this ink there.
    const { data } = ctx.getImageData(72, 276, 70, 8);
    let hits = 0;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at] === ink[0] && data[at + 1] === ink[1] && data[at + 2] === ink[2]) hits += 1;
    }
    return hits;
  }, TAG_INK);
}

/** Lets a frame or two be drawn after the state a test waited for. */
async function settle(page: Page): Promise<void> {
  const step = await page.evaluate(() => window.starSwarm?.step ?? 0);
  await page.waitForFunction((from) => (window.starSwarm?.step ?? 0) > from + 2, step);
}

test('the demo is flown by one of the game’s personas, and says which', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await reachAttract(page);
  await settle(page);

  const { flying, personas, autoplay } = await page.evaluate(() => ({
    flying: window.starSwarm?.flying ?? '',
    personas: window.starSwarm?.personas ?? [],
    autoplay: window.starSwarm?.autoplay ?? '',
  }));
  expect(personas).toContain(flying);
  // Nobody armed anything: the demo's pilot is not the `AUTOPLAY` setting.
  expect(autoplay).toBe('');
  expect(await tagPixels(page)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a variant with no personas is demonstrated by the script, and names nobody', async ({
  page,
}) => {
  await booted(page);
  if ((await page.evaluate(() => window.starSwarm?.phase)) !== 'variant-select') {
    test.skip(true, 'this build offers one variant, so there is nothing to choose');
  }
  for (let i = 0; i < 8; i += 1) {
    if ((await page.evaluate(() => window.starSwarm?.selecting)) === 'swarm-remix') break;
    await page.keyboard.press('ArrowRight');
    await settle(page);
  }
  expect(await page.evaluate(() => window.starSwarm?.selecting)).toBe('swarm-remix');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.starSwarm?.phase === 'attract');
  await settle(page);

  expect(await page.evaluate(() => window.starSwarm?.personas)).toEqual([]);
  expect(await page.evaluate(() => window.starSwarm?.flying)).toBe('');
  expect(await tagPixels(page)).toBe(0);
});
