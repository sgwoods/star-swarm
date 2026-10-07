import { expect, type Page, test } from '@playwright/test';

import { reachAttract } from './harness.js';

/**
 * A variation carried out of one browser and into another as text, played with
 * the real keyboard through the real text box: made, exported, the stored
 * settings cleared — which is what a second machine is — imported from the text,
 * and played.
 *
 * `tests/unit/exchange.test.ts` tells the same story to the state machine. What
 * only a browser shows is the box: that it appears with its card and goes with
 * it, that the export's text is selected so one `CTRL+C` takes it, that `ENTER`
 * puts it on the real clipboard, and that a paste into the box reaches the card.
 */

const FRAMES = 40;
const BOX = '#variation-text';

async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(FRAMES);
  await page.keyboard.up(key);
  await page.waitForTimeout(FRAMES);
}

async function phase(page: Page, want: string): Promise<void> {
  await page.waitForFunction((value) => window.starSwarm?.phase === value, want);
}

async function toRow(page: Page, row: string): Promise<void> {
  for (
    let i = 0;
    i < 16 && (await page.evaluate(() => window.starSwarm?.settingsMenuRow)) !== row;
    i += 1
  ) {
    await tap(page, 'ArrowDown');
  }
  expect(await page.evaluate(() => window.starSwarm?.settingsMenuRow)).toBe(row);
}

const CHOICES = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.', 'END'];

async function spell(page: Page, name: string): Promise<void> {
  while (((await page.evaluate(() => window.starSwarm?.nameTaken)) ?? '').length > 0) {
    await tap(page, 'Escape');
  }
  for (const letter of [...name, 'END']) {
    const under = (await page.evaluate(() => window.starSwarm?.nameUnder)) ?? 'END';
    const steps =
      (CHOICES.indexOf(letter) - CHOICES.indexOf(under) + CHOICES.length) % CHOICES.length;
    for (let i = 0; i < steps; i += 1) await tap(page, 'ArrowRight');
    await tap(page, 'Enter');
  }
}

/** From attract: make a variation of CLASSIC with Deep Sea switched on, named `name`. */
async function makeVariation(page: Page, name: string): Promise<void> {
  await tap(page, 'Escape');
  await phase(page, 'settings');
  for (
    let i = 0;
    i < 10 && (await page.evaluate(() => window.starSwarm?.game)) !== 'classic';
    i += 1
  ) {
    await tap(page, 'ArrowRight');
  }
  await toRow(page, 'packs');
  await tap(page, 'ArrowRight');
  await phase(page, 'packs');
  for (
    let i = 0;
    i < 6 && (await page.evaluate(() => window.starSwarm?.editorRow)) !== 'deep-sea';
    i += 1
  ) {
    await tap(page, 'ArrowDown');
  }
  await tap(page, 'ArrowRight');
  await tap(page, 'Enter');
  await phase(page, 'name');
  await spell(page, name);
  await phase(page, 'settings');
}

test.describe('a variation, as text', () => {
  test('is exported, the settings are cleared, and it is imported and played', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await reachAttract(page);
    await makeVariation(page, 'MY SWARM');
    const made = await page.evaluate(() => window.starSwarm?.game ?? '');
    const packs = await page.evaluate(() => window.starSwarm?.packList ?? []);
    expect(packs).toContain('deep-sea');

    // Export: the box appears holding the stored document, selected.
    await expect(page.locator(BOX)).toHaveCount(0);
    await toRow(page, 'export');
    await tap(page, 'ArrowRight');
    await phase(page, 'export');
    const box = page.locator(BOX);
    await expect(box).toBeVisible();
    const text = await page.evaluate(() => window.starSwarm?.exportText ?? '');
    const stored = await page.evaluate(() =>
      window.starSwarm?.settings.variations.find((variation) => variation.name === 'MY SWARM'),
    );
    expect(JSON.parse(text)).toEqual(stored);
    await expect(box).toHaveValue(text);
    expect(
      await box.evaluate((node: HTMLTextAreaElement) => [
        node.readOnly,
        node.selectionStart,
        node.selectionEnd,
      ]),
    ).toEqual([true, 0, text.length]);

    // ENTER puts it on the clipboard, and the card says so.
    await tap(page, 'Enter');
    await page.waitForFunction(() => window.starSwarm?.exportCopy === 'copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
    await tap(page, 'Escape');
    await phase(page, 'settings');
    await expect(page.locator(BOX)).toHaveCount(0);

    // Another machine: nothing stored at all.
    await page.evaluate(() => {
      localStorage.clear();
    });
    await reachAttract(page);
    expect(await page.evaluate(() => window.starSwarm?.settings.variations)).toEqual([]);

    // Import: the box appears empty and focused, and a paste reaches the card.
    await tap(page, 'Escape');
    await phase(page, 'settings');
    await toRow(page, 'import');
    await tap(page, 'ArrowRight');
    await phase(page, 'import');
    await expect(page.locator(BOX)).toBeFocused();
    await expect(page.locator(BOX)).toHaveValue('');
    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.locator(BOX)).toHaveValue(text);
    expect(await page.evaluate(() => window.starSwarm?.importName)).toBe('MY SWARM');
    expect((await page.evaluate(() => window.starSwarm?.importVerdict))?.[0]).toBe(
      'LOADS AND BUILDS',
    );

    // Kept through the naming card, and chosen.
    await tap(page, 'Enter');
    await phase(page, 'name');
    await tap(page, 'Enter');
    await phase(page, 'settings');
    await expect(page.locator(BOX)).toHaveCount(0);
    expect(await page.evaluate(() => window.starSwarm?.game)).toBe(made);
    expect(await page.evaluate(() => window.starSwarm?.gameName)).toBe('MY SWARM');
    expect(await page.evaluate(() => window.starSwarm?.setAside)).toBe('');

    // And it plays as it was made.
    await tap(page, 'Enter');
    await phase(page, 'attract');
    await tap(page, 'Enter');
    await phase(page, 'playing');
    expect(await page.evaluate(() => window.starSwarm?.packList)).toEqual(packs);
  });

  test('refuses a game naming a pack this build does not install, and says why', async ({
    page,
  }) => {
    await reachAttract(page);
    await makeVariation(page, 'MY SWARM');
    await toRow(page, 'export');
    await tap(page, 'ArrowRight');
    await phase(page, 'export');
    const document = JSON.parse(await page.evaluate(() => window.starSwarm?.exportText ?? '')) as {
      packs: string[];
    };
    await tap(page, 'Escape');
    await phase(page, 'settings');

    await toRow(page, 'import');
    await tap(page, 'ArrowRight');
    await phase(page, 'import');
    const before = await page.evaluate(() => window.starSwarm?.settings.variations.length);
    await page
      .locator(BOX)
      .fill(JSON.stringify({ ...document, packs: [...document.packs, 'moon-base'] }));
    expect(await page.evaluate(() => window.starSwarm?.importVerdict)).toEqual([
      'WILL NOT LOAD',
      'PACK moon-base',
      'IS NOT INSTALLED HERE',
    ]);
    await tap(page, 'Enter');
    await page.waitForTimeout(FRAMES * 3);
    expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('import');
    expect(await page.evaluate(() => window.starSwarm?.settings.variations.length)).toBe(before);
  });
});
