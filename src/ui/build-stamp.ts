/**
 * The build stamp: what is running, readable at a glance and invisible while you
 * play.
 *
 * Two places, because "at a glance" and "out of the way" pull in opposite
 * directions:
 *
 * - **The corner, every phase.** Two short rows in the **top HUD band**, hard
 *   right — the date on the `1UP`/`HIGH SCORE` row and the commit on the score
 *   row. The top band is the HUD's, not the playfield's, so nothing is ever drawn
 *   over the game. The two free gaps there are exactly 9 and 11 cells wide
 *   ({@link CORNER_ROW_0_CELLS}, {@link CORNER_ROW_1_CELLS}) once the arcade's own
 *   labels have their space, which is what fixes the abbreviations below.
 * - **A full line in attract mode**, where there is room for a four-digit year
 *   and the words. `src/ui/attract.ts` already owns that band.
 *
 * When a newer build is being served, the commit row and the attract line each
 * *alternate* with the notice rather than being replaced by it — so the identity
 * stays readable, nothing on screen moves, and the notice cannot be mistaken for
 * part of the score. Nothing here reads input or interrupts anything: it is text,
 * and that is the whole of the update story on screen.
 *
 * Everything is driven by a step count, never the wall clock, like every other
 * timer in `src/ui/`.
 */

import { LOGICAL_WIDTH } from '../render/canvas.js';
import { drawText } from '../render/text.js';
import { type BuildIdentity, type BuildComparison, isUpdate } from './build-info.js';

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/** Right edge the corner stamp is aligned to: the playfield's own edge. */
export const CORNER_RIGHT = LOGICAL_WIDTH;

/** Rows of the top HUD band the two corner lines sit on. */
export const CORNER_ROW_0_Y = 0;
export const CORNER_ROW_1_Y = 8;

/**
 * Cells free on each corner row, right of the HUD's own text.
 *
 * Row 0 carries `1UP` at x 16 and `HIGH SCORE` ending at x 152; row 1 carries the
 * two six-digit scores, the second ending at x 136 (`src/ui/hud.ts`). 224 − 152
 * and 224 − 136, in 8-pixel cells. A string longer than these overlaps the score.
 */
export const CORNER_ROW_0_CELLS = 9;
export const CORNER_ROW_1_CELLS = 11;

/**
 * Row the attract line sits on: under the "push start" prompt at y 226 and above
 * the fighter, whose row starts at y 248 (`packs/classic/rules.json`).
 */
export const ATTRACT_LINE_Y = 238;

/** Blink period of the update notice, in simulation steps — one second on, one off. */
export const NOTICE_BLINK_STEPS = 60;

const STAMP_COLOUR = '#5a6480';
const NOTICE_COLOUR = '#ffd400';

/** What the corner row and the attract line say when a newer build is served. */
export const CORNER_NOTICE = 'NEW BUILD';
export const ATTRACT_NOTICE = 'NEW BUILD - REFRESH';

/* -------------------------------------------------------------------------- */
/* The strings                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `YYYY-MM-DD` of the build, or `????-??-??` when the identity carries no date.
 *
 * Sliced out of the ISO timestamp rather than reformatted: the timestamp is
 * already `YYYY-MM-DDTHH:MM:SSZ`, and a second date formatter is a second thing
 * that can disagree with the first.
 */
export function buildDate(build: BuildIdentity): string {
  return build.builtAt.length >= 10 ? build.builtAt.slice(0, 10) : '????-??-??';
}

/** The same date without the century, which is what fits the corner's 9 cells. */
export function shortBuildDate(build: BuildIdentity): string {
  return buildDate(build).slice(2);
}

/**
 * The commit, and how far it is from a clean release.
 *
 * `+` is a modified working tree and `DEV` is the dev server — two separate
 * facts, both shown, because conflating them would make a dirty release look like
 * a dev build. A clean `vite build` is the only thing that reads as a bare
 * commit, which is the point: a development build says so.
 *
 * Unspaced, and that is a measurement rather than a style: seven commit
 * characters plus both markers is exactly {@link CORNER_ROW_1_CELLS}, and a space
 * in here put the `DEV` through the high score.
 */
export function buildCode(build: BuildIdentity): string {
  return `${build.commit}${build.dirty ? '+' : ''}${build.mode === 'dev' ? 'DEV' : ''}`;
}

/** The attract line: the whole identity in one row, with room for the century. */
export function buildLine(build: BuildIdentity): string {
  return `${buildDate(build)} ${buildCode(build)}`;
}

/** Is the notice showing on this step? Half the period on, half off. */
export function noticeVisible(steps: number, period: number = NOTICE_BLINK_STEPS): boolean {
  return Math.floor(Math.max(0, steps) / Math.max(1, period)) % 2 === 1;
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                     */
/* -------------------------------------------------------------------------- */

export interface BuildStampOptions {
  readonly build: BuildIdentity;
  /** The last poll's verdict. Anything but a detected update draws no notice. */
  readonly comparison?: BuildComparison;
  /** Steps, for the blink. The flow's own counter, so it only ever goes up. */
  readonly steps?: number;
  readonly blinkSteps?: number;
}

/**
 * The corner stamp. Drawn after the HUD, on every phase.
 *
 * Right-aligned, so a shorter or longer commit never moves the date above it.
 */
export function drawBuildStamp(ctx: CanvasRenderingContext2D, options: BuildStampOptions): void {
  const { build, comparison = 'unknown', steps = 0, blinkSteps = NOTICE_BLINK_STEPS } = options;
  const notice = isUpdate(comparison) && noticeVisible(steps, blinkSteps);

  drawText(ctx, shortBuildDate(build), CORNER_RIGHT, CORNER_ROW_0_Y, {
    colour: STAMP_COLOUR,
    align: 'right',
  });
  drawText(ctx, notice ? CORNER_NOTICE : buildCode(build), CORNER_RIGHT, CORNER_ROW_1_Y, {
    colour: notice ? NOTICE_COLOUR : STAMP_COLOUR,
    align: 'right',
  });
}

/** The attract-mode line, centred under the "push start" prompt. */
export function drawBuildLine(ctx: CanvasRenderingContext2D, options: BuildStampOptions): void {
  const { build, comparison = 'unknown', steps = 0, blinkSteps = NOTICE_BLINK_STEPS } = options;
  const notice = isUpdate(comparison) && noticeVisible(steps, blinkSteps);

  drawText(ctx, notice ? ATTRACT_NOTICE : buildLine(build), LOGICAL_WIDTH / 2, ATTRACT_LINE_Y, {
    colour: notice ? NOTICE_COLOUR : STAMP_COLOUR,
    align: 'center',
  });
}
