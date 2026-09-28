import { describe, expect, it } from 'vitest';

import { LOGICAL_HEIGHT } from '../../src/render/canvas.js';
import { GLYPH_CHARS } from '../../src/render/text.js';
import { cardHeight } from '../../src/ui/menus.js';
import { CARD_BOTTOM, CARD_TOP } from '../../src/ui/panel.js';
import {
  createExitConfirm,
  EXIT_CARD_TOP,
  EXIT_CHOICES,
  exitConfirmLines,
  PAUSE_CARD_TOP,
  PAUSE_TEXT,
} from '../../src/ui/pause.js';

/**
 * The pause card and the card that asks before a run is thrown away.
 *
 * Two things are under test and the first is the one that matters: **the default
 * is the safe one**. Confirming is destructive to a run in progress, so a cursor
 * that opened on `EXIT` would turn a stray press of the fire button into the end
 * of somebody's game. The second is the same pair of checks every card in
 * `src/ui/` gets — that it fits the playfield and draws only characters the pixel
 * font has — because `drawText` neither clips nor complains.
 */
describe('the exit confirmation’s cursor', () => {
  it('opens on the safe choice', () => {
    const confirm = createExitConfirm();
    expect(confirm.choice).toBe('resume');
    expect(confirm.index).toBe(0);
  });

  it('offers exactly the two choices, the safe one first', () => {
    expect([...EXIT_CHOICES]).toEqual(['resume', 'exit']);
  });

  it('moves between them, wrapping either way', () => {
    const confirm = createExitConfirm();
    confirm.next();
    expect(confirm.choice).toBe('exit');
    confirm.next();
    expect(confirm.choice).toBe('resume');
    confirm.previous();
    expect(confirm.choice).toBe('exit');
    confirm.previous();
    expect(confirm.choice).toBe('resume');
  });

  it('is a fresh value every time, so a card never opens where the last one closed', () => {
    const first = createExitConfirm();
    first.next();
    expect(first.choice).toBe('exit');
    expect(createExitConfirm().choice).toBe('resume');
  });
});

describe('both cards fit the band the game leaves clear', () => {
  /**
   * `drawCentredPanel` is called at `top - 6` in both cards, and a card drawn
   * past {@link CARD_BOTTOM} runs into the fighter's row — or, further down, off
   * the playfield entirely, where nothing on screen says so.
   */
  const fits = (top: number, height: number): boolean =>
    top - 6 >= 0 && top - 6 + height <= CARD_BOTTOM;

  it('the pause card does', () => {
    expect(fits(PAUSE_CARD_TOP, cardHeight(0, 1))).toBe(true);
  });

  it('the exit card does, with and without the line about the table', () => {
    expect(fits(EXIT_CARD_TOP, cardHeight(1, exitConfirmLines(false)))).toBe(true);
    expect(fits(EXIT_CARD_TOP, cardHeight(1, exitConfirmLines(true)))).toBe(true);
  });

  it('puts both in the clear band rather than over the formation', () => {
    expect(PAUSE_CARD_TOP).toBeGreaterThanOrEqual(CARD_TOP);
    expect(EXIT_CARD_TOP).toBeGreaterThanOrEqual(CARD_TOP);
    expect(CARD_BOTTOM).toBeLessThan(LOGICAL_HEIGHT);
  });

  it('grows by exactly one line when the score would have placed', () => {
    expect(exitConfirmLines(true) - exitConfirmLines(false)).toBe(1);
  });
});

describe('everything these cards draw is in the pixel font', () => {
  /**
   * `drawText` draws an unknown character as **nothing** and still advances, so a
   * string the font cannot spell is a gap nobody notices until a clip is
   * recorded. `tests/unit/menus.test.ts` holds the menu cards to the same rule.
   */
  const drawable = new Set(GLYPH_CHARS);
  const missing = (text: string): string[] =>
    [...text.toUpperCase()].filter((char) => !drawable.has(char));

  it('covers every fixed string on both cards', () => {
    for (const text of Object.values(PAUSE_TEXT)) expect(missing(text)).toEqual([]);
  });

  it('covers the two lines that are built from numbers', () => {
    // The score and the rank are the only characters on either card that are not
    // in PAUSE_TEXT, and both are digits.
    expect(missing(`SCORE ${String(1234567)}`)).toEqual([]);
    expect(missing(`${PAUSE_TEXT.wouldRank} ${String(10)}`)).toEqual([]);
  });
});
