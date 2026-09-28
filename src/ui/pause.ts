/**
 * The pause card, and the card that asks before a run is thrown away.
 *
 * Two screens with almost no state, drawn over a game that has stopped being
 * stepped. They sit here rather than in `./menus.ts` because a menu is a list of
 * settings and this is neither: nothing on either card is remembered, and the
 * only value is which of two words the cursor is on.
 *
 * The same split the rest of `src/ui/` uses holds: {@link createExitConfirm} is a
 * **value with a cursor** — the state machine in `./flow.ts` calls a verb when it
 * sees the matching input edge — and the two draw functions render whatever they
 * are handed. Neither knows what confirming does.
 *
 * **The default is the safe one.** A confirmation opens on `RESUME`, so the
 * press that opens the card and the press that commits it can never be the same
 * key held twice, and a player who mashes the fire button out of habit resumes
 * their game rather than ending it.
 *
 * The card layout helpers come from `./menus.ts`: a card is a card, and a second
 * copy of the arithmetic is a second card that can be drawn off the bottom of the
 * playfield.
 */

import { drawText } from '../render/text.js';
import { cardHeight, fitText, MENU_BLINK_STEPS } from './menus.js';
import { CARD_TOP, drawCentredPanel } from './panel.js';

/** What the cursor is on. */
export type ExitChoice = 'resume' | 'exit';

/** The two, in the order they are drawn: the safe one first. */
export const EXIT_CHOICES: readonly ExitChoice[] = Object.freeze(['resume', 'exit']);

/**
 * A cursor over {@link EXIT_CHOICES}.
 *
 * It starts on `resume` and there is no option to start it anywhere else —
 * confirming is destructive to a run in progress, so the default is a property of
 * the type rather than of the caller.
 */
export interface ExitConfirm {
  readonly index: number;
  readonly choice: ExitChoice;
  previous: () => void;
  next: () => void;
}

export function createExitConfirm(): ExitConfirm {
  let index = 0;
  const move = (delta: number): void => {
    index = (index + delta + EXIT_CHOICES.length) % EXIT_CHOICES.length;
  };
  return {
    get index(): number {
      return index;
    },
    get choice(): ExitChoice {
      return EXIT_CHOICES[index] ?? 'resume';
    },
    previous: () => {
      move(-1);
    },
    next: () => {
      move(1);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every fixed string these two cards draw.
 *
 * Gathered for the same reason `MENU_TEXT` is: `drawText` draws a character the
 * font lacks as **nothing** while still advancing, so an unknown character is a
 * gap nobody notices until a clip is recorded. `tests/unit/pause.test.ts` holds
 * all of these to the font's glyph set at once.
 */
export const PAUSE_TEXT = Object.freeze({
  pausedHeading: 'PAUSED',
  pausedKeys: 'P RESUMES   X EXITS',
  exitHeading: 'EXIT GAME?',
  resume: 'RESUME',
  exit: 'EXIT',
  /** Said out loud, because a run that vanishes without warning is the bug. */
  lost: 'THIS RUN IS LOST',
  /** Prefix of the line drawn when the score would have taken a place. */
  wouldRank: 'IT WOULD HAVE RANKED',
  exitKeys: 'L/R PICK   FIRE OK',
  exitBack: 'X GOES BACK',
});

const HEADING_COLOUR = '#ff2b2b';
const VALUE_COLOUR = '#ffffff';
const CURSOR_COLOUR = '#ffd400';
const DIM_COLOUR = '#7d8aa8';
const WARNING_COLOUR = '#ff8c1a';

/** Matches `./menus.ts`; a card's rows and its lines under them share a pitch. */
const ROW_PITCH = 10;

/** Air above the first row, under the heading. Matches `./menus.ts`. */
const HEADING_GAP = 16;

const CARD_WIDTH = 208;

/** Characters that fit across the card, inside the 8-pixel padding both sides. */
const CARD_CELLS = 24;

/**
 * Where each card sits, in logical rows.
 *
 * Both are shorter than the settings card, so both fit the clear band the game
 * leaves under the formation without starting above it. `tests/unit/pause.test.ts`
 * does the arithmetic rather than trusting this comment.
 */
export const PAUSE_CARD_TOP = CARD_TOP + 16;
export const EXIT_CARD_TOP = CARD_TOP;

/** Lines under the choice row: the warning, the rank line if any, and two keys. */
export function exitConfirmLines(qualifies: boolean): number {
  return qualifies ? 5 : 4;
}

export interface PausedCardOptions {
  /** Flow steps in this phase, for the blink. */
  readonly steps: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Draw the pause card.
 *
 * The heading blinks, because a still screen with a still card on it looks like
 * a game that has crashed rather than one that is waiting.
 */
export function drawPaused(ctx: CanvasRenderingContext2D, options: PausedCardOptions): void {
  const { steps, x, y } = options;
  drawCentredPanel(ctx, x, y - 6, CARD_WIDTH, cardHeight(0, 1));

  const lit = Math.floor(steps / MENU_BLINK_STEPS) % 2 === 0;
  drawText(ctx, PAUSE_TEXT.pausedHeading, x, y + 4, {
    colour: lit ? HEADING_COLOUR : VALUE_COLOUR,
    align: 'center',
  });
  drawText(ctx, PAUSE_TEXT.pausedKeys, x, y + HEADING_GAP + 4, {
    colour: DIM_COLOUR,
    align: 'center',
  });
}

export interface ExitConfirmCardOptions {
  readonly confirm: ExitConfirm;
  readonly steps: number;
  readonly x: number;
  readonly y: number;
  /** The run's score, said on the card so nothing is discarded silently. */
  readonly score: number;
  /** The place the score would have taken, when it would have taken one. */
  readonly rank?: number | undefined;
}

/** How far either word sits from the card's centre, in logical pixels. */
const CHOICE_OFFSET = 48;

/**
 * Draw the exit confirmation.
 *
 * It names the score and, when the table would have taken it, the place it would
 * have taken — the run **is** discarded, and the one thing that must not happen
 * is for it to be discarded without the player being told what they are giving
 * up.
 */
export function drawExitConfirm(
  ctx: CanvasRenderingContext2D,
  options: ExitConfirmCardOptions,
): void {
  const { confirm, steps, x, y, score, rank } = options;
  const qualifies = rank !== undefined;

  drawCentredPanel(ctx, x, y - 6, CARD_WIDTH, cardHeight(1, exitConfirmLines(qualifies)));
  drawText(ctx, PAUSE_TEXT.exitHeading, x, y + 4, { colour: HEADING_COLOUR, align: 'center' });

  const lit = Math.floor(steps / MENU_BLINK_STEPS) % 2 === 0;
  const choiceY = y + HEADING_GAP + 4;
  EXIT_CHOICES.forEach((choice, index) => {
    const live = index === confirm.index;
    drawText(
      ctx,
      choice === 'resume' ? PAUSE_TEXT.resume : PAUSE_TEXT.exit,
      x + (index === 0 ? -CHOICE_OFFSET : CHOICE_OFFSET),
      choiceY,
      { colour: live ? (lit ? CURSOR_COLOUR : VALUE_COLOUR) : DIM_COLOUR, align: 'center' },
    );
  });

  let line = choiceY + ROW_PITCH + 4;
  const under = (text: string, colour: string): void => {
    drawText(ctx, fitText(text, CARD_CELLS), x, line, { colour, align: 'center' });
    line += ROW_PITCH;
  };

  under(`SCORE ${String(score)}`, VALUE_COLOUR);
  under(PAUSE_TEXT.lost, WARNING_COLOUR);
  if (qualifies) under(`${PAUSE_TEXT.wouldRank} ${String(rank)}`, WARNING_COLOUR);
  under(PAUSE_TEXT.exitKeys, DIM_COLOUR);
  under(PAUSE_TEXT.exitBack, DIM_COLOUR);
}
