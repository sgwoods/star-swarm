import { expect, type Page, test } from '@playwright/test';

/**
 * The capture mechanic, **in a browser**.
 *
 * There are three committed capture goldens and forty-odd capture unit tests, and
 * every one of them was green while live play was broken. That is not an accident
 * of coverage, it is what those tests are built out of: the capture goldens run on
 * a cabinet with `enemies.maxBullets` at zero and `enemies.collision` off, so that
 * a pilot walking into a beam on purpose is not shot or rammed on the way — which
 * means *the beam is the only thing in them that can cost a fighter*. The state the
 * bug lives in is "the fighter was destroyed by something else while a capture
 * attempt was already in the air", and that state is unreachable by construction in
 * every test that covers capture.
 *
 * So this file plays the real game in a real browser, with the shipped cabinet and
 * everything live, and asserts the one thing the headless net cannot see.
 *
 * It is slow on purpose: a capture attempt at stage 1 takes the best part of half a
 * minute of simulation to come round, and the point is to play until one does
 * rather than to assemble the state by hand.
 */

/** What the page reports about the run; see the `window.starSwarm` block in `src/main.ts`. */
interface Harness {
  /** Frames in which a beam was out over the playfield. */
  readonly beamFrames: number;
  /** Distinct beams seen come out. */
  readonly beams: number;
  /** Captures that completed — the fighter parked in a captive slot. */
  readonly captures: number;
  /**
   * The bug: a replacement fighter that arrived while a beam was already out.
   *
   * It arrives at a fixed column, so arriving under an open beam means being taken
   * on the frame it appears, with no frame in which to move.
   */
  readonly arrivalsUnderBeam: number;
  /**
   * Fighters destroyed by something *other* than the beam while a capture attempt
   * was already in the air — the state the whole bug lives in, and the state every
   * headless capture test excludes by construction. Asserted non-zero so that a
   * green run means "it went through this and came out right" rather than "it never
   * got there".
   */
  readonly deathsDuringAttempt: number;
  /** Games played out, so a run that ends can keep the harness going. */
  readonly games: number;
  readonly steps: number;
}

declare global {
  interface Window {
    __capture?: Harness;
  }
}

/**
 * Play the game from inside the page.
 *
 * A harness rather than Playwright keystrokes because the steering has to keep up
 * with the simulation: a capture needs the fighter under the captor for over a
 * second at stage 1, and a round trip per frame cannot do that. It drives the real
 * keyboard path — synthetic `keydown`/`keyup` on `window`, which is exactly what
 * `createKeyboardInput` listens to — so nothing here bypasses input handling.
 *
 * It plays to *provoke* captures, not to survive: it steers into any live capture
 * attempt, sweeps otherwise, and starts a fresh game whenever one ends, so the run
 * keeps producing attempts for as long as the test watches.
 */
async function installHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const held = new Set<string>();
    const key = (code: string, down: boolean): void => {
      if (down === held.has(code)) return;
      if (down) held.add(code);
      else held.delete(code);
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    };

    const state = {
      beamFrames: 0,
      beams: 0,
      captures: 0,
      arrivalsUnderBeam: 0,
      deathsDuringAttempt: 0,
      games: 0,
      steps: 0,
    };
    window.__capture = state;

    let wasBeamOut = false;
    let wasAlive = true;
    let wasHolding = false;
    let wasPlaying = false;

    const tick = (): void => {
      const game = window.starSwarm;
      if (game !== undefined) {
        const capture = game.capture;
        const beamOut = capture.phase === 'beam' || capture.phase === 'carrying';
        const holding = capture.captiveOnField;
        state.steps = game.step;

        if (beamOut) state.beamFrames += 1;
        if (beamOut && !wasBeamOut) state.beams += 1;
        if (holding && !wasHolding) state.captures += 1;
        // The regression: the fighter went from off the field to on it while a
        // beam was already out over the playfield.
        if (game.playerAlive && !wasAlive && beamOut) state.arrivalsUnderBeam += 1;
        // Lost to a bomb or a body with an attempt already under way. The captor
        // does not notice — the arcade's capture flag is not cleared by the player
        // dying — so the beam comes out over the column the fighter died in.
        if (!game.playerAlive && wasAlive && capture.phase !== 'idle') {
          state.deathsDuringAttempt += 1;
        }
        if (wasPlaying && game.phase !== 'playing') state.games += 1;

        wasBeamOut = beamOut;
        wasAlive = game.playerAlive;
        wasHolding = holding;
        wasPlaying = game.phase === 'playing';

        if (game.phase === 'playing') {
          // Steer into a live attempt; otherwise sweep, so the run keeps meeting
          // divers and keeps losing fighters — which is the state under test.
          const chasing =
            (capture.phase === 'diving' || capture.phase === 'beam') &&
            capture.captorX !== undefined;
          const target = chasing ? (capture.captorX ?? 0) : 103 + 70 * Math.sin(game.step / 200);
          const dx = target - game.playerX;
          key('ArrowRight', dx > 1);
          key('ArrowLeft', dx < -1);
          key('Enter', false);
        } else {
          key('ArrowLeft', false);
          key('ArrowRight', false);
          // Any screen that is not play gets the start button, so a finished run
          // rolls into the next one without the test babysitting it.
          key('Enter', game.step % 30 < 15);
        }
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

const read = (page: Page): Promise<Harness | undefined> => page.evaluate(() => window.__capture);

test.describe('capture in the browser', () => {
  // Minutes, not seconds: this plays whole games at 60 Hz until enough beams have
  // come out to mean something.
  test.setTimeout(240_000);

  test('a replacement fighter never arrives underneath an open beam', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
    await installHarness(page);

    // Play for as many beams as the budget allows, and then assert on whatever
    // the run actually produced.
    //
    // Deliberately *not* "wait for N beams or fail": a capture attempt at stage 1
    // comes round about once every fifty seconds of simulation here, and a loaded
    // CI runner stepping at half speed would turn a fixed target into a timeout
    // that says nothing about the game. So the wait is a budget, a timeout is not
    // a failure, and the floors below are what keep it from passing vacuously.
    await page
      .waitForFunction(() => (window.__capture?.beams ?? 0) >= 4, undefined, {
        timeout: 180_000,
      })
      .catch(() => undefined);

    const harness = await read(page);
    expect(harness).toBeDefined();
    // Floor one: beams really did come out over a playfield being played on.
    expect(harness?.beams ?? 0).toBeGreaterThan(0);
    expect(harness?.beamFrames ?? 0).toBeGreaterThan(0);

    // Floor two, and the one that matters: the run really did lose fighters with
    // an attempt already in the air. That is the state the three capture goldens
    // cannot reach, because their cabinet has bombs and bodies switched off so the
    // beam is the only thing that can cost a fighter.
    expect(harness?.deathsDuringAttempt ?? 0).toBeGreaterThan(0);

    // The regression itself. A capture attempt is a committed swoop, so destroying
    // the fighter mid-attempt leaves the beam open over the column it died in —
    // and the next fighter is handed to it at the fixed column it always arrives
    // at. Running this same test with the guard in `resolveRespawn` removed fails
    // here; the deterministic statement of the same rule is
    // `tests/unit/capture.test.ts`, "the fighter lost while a beam is out".
    expect(harness?.arrivalsUnderBeam).toBe(0);

    expect(errors).toEqual([]);
  });

  test('a completed capture costs one fighter and leaves a captive on the field', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window.starSwarm?.step ?? 0) > 0);
    await installHarness(page);

    // Drive until a beam actually has the ship. That is the state the captain
    // described — "the ship goes all the way up" — and it is reached here by
    // playing, through the browser's own loop, input and renderer.
    await page.waitForFunction(() => window.starSwarm?.capture.phase === 'carrying', undefined, {
      timeout: 180_000,
    });

    const duringCarry = await page.evaluate(() => ({
      lives: window.starSwarm?.lives ?? -1,
      y: window.starSwarm?.playerY ?? -1,
      alive: window.starSwarm?.playerAlive ?? false,
    }));
    // Still the player's ship, still on its own row, still costing nothing yet:
    // the fighter is lost when it is *parked*, not when it is caught.
    expect(duringCarry.alive).toBe(true);
    expect(duringCarry.y).toBe(248);

    // The beam drags it up the screen and parks it in the captor's captive slot.
    await page.waitForFunction(() => window.starSwarm?.capture.captiveOnField === true, undefined, {
      timeout: 60_000,
    });

    const held = await page.evaluate(() => ({
      lives: window.starSwarm?.lives ?? -1,
      phase: window.starSwarm?.phase ?? '',
      capture: window.starSwarm?.capture.phase ?? '',
      captiveId: window.starSwarm?.capture.captiveId,
      y: window.starSwarm?.playerY ?? -1,
    }));

    // It went up, and it is being held rather than simply gone.
    expect(held.y).toBeLessThan(duringCarry.y);
    expect(held.capture).toBe('held');
    expect(held.captiveId).toBeGreaterThanOrEqual(0);

    // Exactly one fighter, and only when there was one to take. A capture on the
    // last fighter ends the game, which is the arcade's own rule and not a bug —
    // so the run either carries on a fighter lighter or is over, never both.
    if (held.phase === 'playing') {
      expect(held.lives).toBe(duringCarry.lives - 1);
      // And the next fighter comes back onto its own row rather than staying up
      // there with its captor.
      await page.waitForFunction(() => window.starSwarm?.playerAlive === true, undefined, {
        timeout: 60_000,
      });
      expect(await page.evaluate(() => window.starSwarm?.playerY)).toBe(248);
    } else {
      expect(duringCarry.lives).toBe(0);
    }
  });
});
