import { expect, type Page, test } from '@playwright/test';

import { reachAttract } from './harness.js';

/**
 * Autoplay in a real browser (`docs/ARCHITECTURE.md` §7).
 *
 * The pilot's decisions, the persona ordering and the flow's transitions are all
 * proved headlessly — `tests/unit/autoplay.test.ts`,
 * `tests/sim/autoplay-personas.test.ts` and `tests/unit/flow.test.ts`. What only a
 * browser can show is the two things those cannot:
 *
 * 1. **The way in works with a keyboard.** Autoplay is reached by walking the
 *    settings menu with real keypresses, and a persona chosen there has to reach a
 *    real game. Everything in between — the row being present, the setting
 *    persisting, the flow rebuilding a pilot — is wiring, and wiring is what a
 *    browser test is for.
 * 2. **A human taking the controls really does win.** The headless test asserts it
 *    against an `InputFrame`; this asserts it against `createKeyboardInput`, the
 *    latch, and the loop's one-sample-per-step rule. Those are exactly the layers
 *    that could swallow the takeover, and the layers the capture investigation
 *    already found things hiding in.
 *
 * **Every press is a press, not an event** — see the note at the top of
 * `tests/e2e/variants.spec.ts`. The front end reads *edges* over a latched frame
 * sampled once per simulation step, so a key has to be held for a frame or two and
 * released for a frame or two before the next one.
 */

/** Roughly two frames of the 60 Hz simulation step. */
const FRAMES = 40;

async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(FRAMES);
  await page.keyboard.up(key);
  await page.waitForTimeout(FRAMES);
}

/** Walk the settings cursor to a row, naming the row to expect. */
async function toRow(page: Page, row: string): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    if ((await page.evaluate(() => window.starSwarm?.settingsMenuRow)) === row) return;
    await tap(page, 'ArrowDown');
  }
  throw new Error(`never reached the ${row} settings row`);
}

/**
 * Open the settings menu and choose `persona` on the `AUTOPLAY` row.
 *
 * The whole way in, done the way a person does it: escape, cursor down to the row,
 * right until the persona shows, escape again.
 */
async function chooseAutoplay(page: Page, persona: string): Promise<void> {
  await reachAttract(page);
  await tap(page, 'Escape');
  await page.waitForFunction(() => window.starSwarm?.phase === 'settings');

  await toRow(page, 'autoplay');
  for (let i = 0; i < 8; i += 1) {
    if ((await page.evaluate(() => window.starSwarm?.autoplay)) === persona) break;
    await tap(page, 'ArrowRight');
  }
  expect(await page.evaluate(() => window.starSwarm?.autoplay)).toBe(persona);

  await tap(page, 'Escape');
}

test('the shipped game offers the four personas', async ({ page }) => {
  await reachAttract(page);
  // Nothing under `src/` names one: this list is `variants/classic.json`'s, read
  // through the bundled reader and the real loader, and it is the order the
  // settings row walks.
  expect(await page.evaluate(() => window.starSwarm?.personas)).toEqual([
    'beginner',
    'normal',
    'expert',
    'astronaut',
  ]);
  // And off out of the box: a cabinet nobody asked to watch itself is a person's.
  expect(await page.evaluate(() => window.starSwarm?.autoplay)).toBe('');
});

test('choosing a persona sets the cabinet playing itself', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await chooseAutoplay(page, 'astronaut');

  // Out of the settings screen, autoplay starts a game itself: attract has no timer
  // to move it on, so it is the one screen the flow pushes a button on.
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');

  // And the persona flies it. Both halves matter: the ship has to move, and shots
  // have to be fired, or a "pilot" that stands still with the trigger down would
  // pass.
  const startedAt = await page.evaluate(() => window.starSwarm?.playerX ?? 0);
  await page.waitForFunction((from) => (window.starSwarm?.playerX ?? from) !== from, startedAt, {
    timeout: 5_000,
  });
  await page.waitForFunction(() => (window.starSwarm?.shotsFired ?? 0) > 0);
  expect(await page.evaluate(() => window.starSwarm?.autoplay)).toBe('astronaut');
  expect(errors).toEqual([]);
});

test('a human taking the controls wins immediately, and for good', async ({ page }) => {
  await chooseAutoplay(page, 'beginner');
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');
  // Let it fly for a moment, so the takeover interrupts something.
  await page.waitForTimeout(500);

  await tap(page, 'ArrowLeft');

  // Cleared rather than suspended: the setting itself is off, so nothing takes the
  // stick back without being asked again.
  await page.waitForFunction(() => window.starSwarm?.autoplay === '');
  expect(await page.evaluate(() => window.starSwarm?.settings.autoplay)).toBeUndefined();

  // And the fighter now does what the person does, which here is nothing at all.
  await page.waitForTimeout(300);
  const parked = await page.evaluate(() => window.starSwarm?.playerX ?? 0);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.starSwarm?.playerX ?? -1)).toBe(parked);
  expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('playing');
});

test('a watched run pauses, and pausing is not a takeover', async ({ page }) => {
  // The captain's pause is what a watcher wants mid-run: stop, look at what the
  // persona has got itself into, carry on. So `pause` must not read as grabbing the
  // stick — otherwise the one control for looking at a persona would be the control
  // that ends the demonstration.
  await chooseAutoplay(page, 'normal');
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');
  await page.waitForTimeout(400);

  await tap(page, 'KeyP');
  await page.waitForFunction(() => window.starSwarm?.phase === 'paused');
  expect(await page.evaluate(() => window.starSwarm?.autoplay)).toBe('normal');

  // Nothing moves behind the card, including the fighter the pilot was flying.
  const held = await page.evaluate(() => window.starSwarm?.playerX ?? 0);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.starSwarm?.playerX ?? -1)).toBe(held);

  // And the persona picks the run back up.
  await tap(page, 'KeyP');
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');
  await page.waitForFunction((from) => (window.starSwarm?.playerX ?? from) !== from, held, {
    timeout: 5_000,
  });
  expect(await page.evaluate(() => window.starSwarm?.autoplay)).toBe('normal');
});

test('the AUTOPLAY row says who is flying and can turn it off again', async ({ page }) => {
  // The way back out through the menu. Reaching it means taking the controls first,
  // because with autoplay armed the attract screen lasts a single step — which is
  // stated in `docs/ARCHITECTURE.md` §7 rather than worked around here.
  await chooseAutoplay(page, 'expert');
  await page.waitForFunction(() => window.starSwarm?.phase === 'playing');
  await page.waitForTimeout(300);

  // One keypress hands the cabinet back.
  await tap(page, 'ArrowLeft');
  await page.waitForFunction(() => window.starSwarm?.autoplay === '');

  // Leave the human's run, which lands in attract — and attract now stays, because
  // nothing is flying it.
  await tap(page, 'KeyX');
  await page.waitForFunction(() => window.starSwarm?.phase === 'exit-confirm');
  await tap(page, 'ArrowRight');
  await tap(page, 'Space');
  await page.waitForFunction(() => window.starSwarm?.phase === 'attract');

  await tap(page, 'Escape');
  await page.waitForFunction(() => window.starSwarm?.phase === 'settings');
  await toRow(page, 'autoplay');
  // The row remembers nothing a human turned off: it reads OFF, and the note says
  // what the row is for.
  expect(await page.evaluate(() => window.starSwarm?.settingsRows)).toContain('AUTOPLAY=OFF');
  expect(await page.evaluate(() => window.starSwarm?.settingsMenuNote)).toBe(
    'WATCH IT PLAY ITSELF',
  );
});
