import { expect, test } from '@playwright/test';

import { booted, reachAttract, startGame } from './harness.js';

/**
 * The front-end shell in a real browser (docs/DESIGN.md section 4, "Game flow").
 *
 * The state machine's transitions are proved headlessly in
 * `tests/unit/flow.test.ts`; what only a browser can show is that the cabinet
 * reaches attract mode, that the demo runs the simulation there without anybody
 * touching a key, and that a real keypress starts a game.
 *
 * The page boots into the start-up selector while more than one variant ships, so
 * `reachAttract` in `./harness.ts` is how a test that wants attract gets there —
 * the selector itself is `./variants.spec.ts`.
 *
 * Deliberately shallow for the same reason `smoke.spec.ts` is: behaviour belongs
 * in Vitest, wiring belongs here.
 */

test('the cabinet reaches attract mode and runs the demo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await reachAttract(page);

  // Nobody is playing, and the ship is still flying: the demo is the real
  // simulation being driven by a recorded input log.
  const first = await page.evaluate(() => window.starSwarm?.playerX ?? 0);
  await page.waitForFunction((x) => (window.starSwarm?.playerX ?? 0) !== x, first, {
    timeout: 10_000,
  });

  expect(await page.evaluate(() => window.starSwarm?.phase)).toBe('attract');
  expect(errors).toEqual([]);
});

test('start begins a game from zero, and the arrows reach that ship', async ({ page }) => {
  await startGame(page);

  expect(await page.evaluate(() => window.starSwarm?.score)).toBe(0);
  expect(await page.evaluate(() => window.starSwarm?.shotsFired)).toBe(0);
  expect(await page.evaluate(() => window.starSwarm?.stage)).toBe(1);

  const before = await page.evaluate(() => window.starSwarm?.playerX ?? 0);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  expect(await page.evaluate(() => window.starSwarm?.playerX ?? 0)).toBeGreaterThan(before);
});

test('the shots the results screen counts are the ones the player fired', async ({ page }) => {
  await startGame(page);

  await page.keyboard.down('Space');
  await page.waitForTimeout(800);
  await page.keyboard.up('Space');

  const { shotsFired, hits } = await page.evaluate(() => ({
    shotsFired: window.starSwarm?.shotsFired ?? 0,
    hits: window.starSwarm?.hits ?? 0,
  }));
  expect(shotsFired).toBeGreaterThan(0);
  // A shot dies on its first hit, so the ratio the results screen shows can
  // never exceed 100%.
  expect(hits).toBeLessThanOrEqual(shotsFired);
});

test('the high-score table survives a reload', async ({ page }) => {
  await booted(page);

  const best = await page.evaluate(() => window.starSwarm?.highScore ?? 0);
  expect(best).toBeGreaterThan(0);

  // Write a table directly, as a finished game would, and check the board reads
  // it back on the next boot rather than falling back to the shipped defaults.
  await page.evaluate(() => {
    localStorage.setItem(
      'star-swarm/high-scores/v1',
      JSON.stringify({ version: 1, entries: [{ initials: 'ZZZ', score: 123_450, stage: 7 }] }),
    );
  });
  await page.reload();
  await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
  expect(await page.evaluate(() => window.starSwarm?.highScore)).toBe(123_450);
});

/**
 * The stage badges, in a real browser.
 *
 * The denominations and their art are pack data now, and a sprite the pack does
 * not have is a load-time throw from `createSpriteSheet` — so a boot that draws
 * the row at all is what proves the pack reached the HUD. The decomposition
 * itself is `tests/unit/hud.test.ts`.
 *
 * The challenge stage is deliberately *not* driven from here. Stages 1 and 2 have
 * to be cleared to reach one and nothing dives yet, so the journey takes about
 * three minutes of real time — a poor trade for a suite whose job is wiring
 * (`tests/unit/challenge.test.ts` and the two golden replays in
 * `tests/sim/player-core.test.ts` prove the behaviour, and the PR carries a clip).
 */
test('draws the stage badges the pack declares', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await startGame(page);

  // Stage 1 shows a single 1-point badge; the denominations are the pack's.
  expect(await page.evaluate(() => window.starSwarm?.badges)).toEqual([1]);
  expect(errors).toEqual([]);
});
