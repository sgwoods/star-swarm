import { expect, type Page, test } from '@playwright/test';

import { logRequest } from '../../scripts/capture.js';
import { replayFingerprint } from '../../scripts/record.js';
import type { CaptureSession } from '../../src/ui/lab/capture.js';

/**
 * The round trip phase 2 exists for (`docs/ROADMAP.md`, "Capturing gameplay
 * video"): a run played in the browser on the record page comes out as a log,
 * and phase 1 renders that log back as **the run that was played** — not a run
 * like it.
 *
 * Played with real key presses on the real page, held and let go mid-run, and
 * ended with the exit key. Then three things are compared against what the page
 * showed and sealed:
 *
 * - the log played in Node lands on the state the page sealed it with;
 * - the capture page, given the log the way `npm run capture` builds a request
 *   for one, lands on that state too;
 * - and at every step the test photographed while playing — including the frame
 *   the run was held on and the one it ended on — the capture page draws the
 *   same picture, pixel for pixel.
 *
 * The plain dev server this suite runs against has no route to keep a run, so
 * the page also has to say it kept nothing; `npm run record` is what keeps one.
 */

interface Shot {
  readonly step: number;
  readonly png: string;
}

async function shot(page: Page): Promise<Shot> {
  const frame = await page.evaluate(() => window.starSwarmRecord?.frame());
  if (frame === undefined) throw new Error('no run on the page');
  return frame;
}

/** Wait until the run on the page has taken at least `step` steps. */
async function reach(page: Page, step: number): Promise<void> {
  await page.waitForFunction((at) => (window.starSwarmRecord?.step ?? 0) >= at, step);
}

for (const stage of [undefined, 3]) {
  const from = stage === undefined ? '' : ` from stage ${String(stage)}`;

  test(`a run played${from} renders back through phase 1 as the run that was played`, async ({
    page,
    context,
  }) => {
    await page.goto(stage === undefined ? '/record.html' : `/record.html?stage=${String(stage)}`);
    await page.waitForFunction(() => window.starSwarmRecord?.state === 'ready');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.starSwarmRecord?.state === 'playing');

    const shots: Shot[] = [];
    await page.keyboard.down('Space');
    await page.keyboard.down('ArrowRight');
    await reach(page, 80);
    shots.push(await shot(page));
    await page.keyboard.up('ArrowRight');
    await page.keyboard.down('ArrowLeft');
    await reach(page, 200);

    // Held: the world stops, and so does the log.
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.starSwarmRecord?.state === 'paused');
    const held = await shot(page);
    await page.waitForTimeout(400);
    expect((await shot(page)).step).toBe(held.step);
    shots.push(held);
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.starSwarmRecord?.state === 'playing');

    await reach(page, held.step + 90);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('Space');
    shots.push(await shot(page));

    await page.keyboard.press('KeyX');
    await page.waitForFunction(() => window.starSwarmRecord?.state === 'ended');
    const last = await page.evaluate(() => window.starSwarmRecord?.last);
    if (last === undefined) throw new Error('the run was not sealed');
    const end = await shot(page);
    expect(end.step).toBe(last.replay.steps);
    shots.push(end);
    expect(last.replay.seed).toBe('record:game-1');
    expect(last.stage).toBe(stage);

    // Nothing here could keep it, and the page does not pretend otherwise.
    await page.waitForFunction(() => window.starSwarmRecord?.receipt !== undefined);
    const receipt = await page.evaluate(() => window.starSwarmRecord?.receipt);
    expect(receipt).toMatchObject({ ok: false, error: expect.stringMatching(/^NOT KEPT/) });

    // The log is the run, to the bit, outside the browser.
    expect(replayFingerprint(last.replay, last.stage)).toBe(last.replay.finalState);

    // And phase 1 draws it back.
    const capture = await context.newPage();
    await capture.goto('/capture.html');
    await capture.waitForFunction(() => window.starSwarmCapture !== undefined);
    const rendered = await capture.evaluate(
      ({ request, steps }) => {
        const open = window.starSwarmCapture?.open;
        if (open === undefined) throw new Error('capture page not ready');
        const session: CaptureSession = open(request);
        const frames = steps.map((step) => session.frameAt(step));
        session.skipTo(request.replay.steps);
        return { frames, fingerprint: session.fingerprint };
      },
      { request: logRequest(last.replay, last.stage), steps: shots.map((each) => each.step) },
    );
    expect(rendered.fingerprint).toBe(last.replay.finalState);
    // Four different pictures, so agreeing on them is not agreeing on nothing.
    expect(new Set(shots.map((each) => each.png)).size).toBe(shots.length);
    shots.forEach((each, index) => {
      expect(rendered.frames[index] === each.png, `the frame at step ${String(each.step)}`).toBe(
        true,
      );
    });
  });
}
