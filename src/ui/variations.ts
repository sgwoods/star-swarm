/**
 * The two cards that make a player's variation theirs: naming one, and deleting
 * one.
 *
 * A **variation** is a game a player made by editing another — a whole variant
 * document kept in the settings store (`./settings.ts`), derived from a shipped
 * game by `deriveVariant` in `src/content/variants.ts`. The pack manager and the
 * stage-sequence editor (`./packs.ts`) are where one is made: keeping an edit to
 * a shipped game opens the naming card here, and only a named variation is kept.
 * The shipped game is never written, so it plays as it ships whatever the player
 * does. A variation is edited in place, renamed here, and deleted here.
 *
 * Both cards are **values with a cursor**, like every card in `src/ui/`: the
 * state machine in `./flow.ts` calls a verb on the matching input edge, and the
 * draw functions render whatever the value says. Neither applies anything.
 *
 * Naming is worked the way initials entry is (`./highscores.ts`), because it is
 * the same act at a different length — the one line of choices is the letter
 * under the cursor, so every direction spins it, `ENTER` takes it and `ESC` steps
 * back to the letter before. Past the last letter is `END`, which a new letter
 * starts on: `ENTER` on it keeps the name. `ESC` with no letter left to step back
 * to leaves the card, which is the one way off it without naming.
 */

import { drawText, measureText } from '../render/text.js';
import { KEY, keyLine } from './keys.js';
import { cardHeight, fitText, MENU_BLINK_STEPS, MENU_INK, type MenuLine } from './menus.js';
import { drawCentredPanel } from './panel.js';
import { VARIATION_NAME_LENGTH } from './settings.js';

/** The letters a name is spelt from. Every one is in the pixel font. */
export const NAME_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.';

/** What the cursor reads past the last letter. Taking it keeps the name. */
export const NAME_END = 'END';

/** Every fixed string the two cards draw. Held to the font by `tests/unit/variations.test.ts`. */
export const VARIATION_TEXT = Object.freeze({
  nameHeading: 'NAME YOUR GAME',
  renameHeading: 'RENAME',
  /** Under the name on a new game: the reference it came from is untouched. */
  stays: 'WHICH STAYS AS IT SHIPS',
  emptyName: 'A NAME NEEDS A LETTER',
  takenName: 'A GAME HAS THAT NAME',
  deleteHeading: 'DELETE GAME?',
  keep: 'KEEP',
  delete: 'DELETE',
  cannotUndo: 'IT CANNOT BE UNDONE',
  deleteKeys: keyLine([KEY.values, 'MOVE'], [KEY.ok, 'CHOOSES']),
  deleteBack: keyLine([KEY.back, 'BACK']),
});

/* -------------------------------------------------------------------------- */
/* Naming                                                                      */
/* -------------------------------------------------------------------------- */

/** What `ENTER` did on the naming card. */
export type NameCommit = 'next' | 'kept' | 'refused';

export interface NameEntry {
  /** The letters taken so far, in order. */
  readonly taken: string;
  /** What the cursor is on: one letter of {@link NAME_ALPHABET}, or {@link NAME_END}. */
  readonly under: string;
  /** The name `ENTER` on `END` would keep: the letters taken, trimmed. */
  readonly name: string;
  /** Why the last `ENTER` on `END` kept nothing, until the name changes. */
  readonly refusal: string | undefined;
  /** Walk the letter under the cursor backwards, wrapping through `END`. */
  previous: () => void;
  /** Walk it forwards. */
  next: () => void;
  /** Take the letter under the cursor, or on `END`, keep the name if it may be kept. */
  commit: () => NameCommit;
  /**
   * Step back to the letter before, which the cursor is then on. False when there
   * is no letter to step back to — the flow's cue to leave the card.
   */
  back: () => boolean;
}

export interface NameEntryOptions {
  /** The name the card opens on, with the cursor past its last letter. */
  readonly start: string;
  /** Why a name may not be kept, or `undefined` when it may. Asked on `ENTER` at `END`. */
  readonly check: (name: string) => string | undefined;
}

/** A stored name as the card can spell it: upper case, in the alphabet, short enough. */
export function spellable(name: string): string {
  return [...name.toUpperCase()]
    .filter((letter) => NAME_ALPHABET.includes(letter))
    .join('')
    .slice(0, VARIATION_NAME_LENGTH);
}

/**
 * The reason a name may not be kept, given the names the other games have.
 *
 * Empty is refused, and so is a name another game on the list already has —
 * a shipped one in particular, because two `STAR SWARM` rows on the selector
 * would leave a player unable to tell the reference from their copy.
 */
export function nameRefusal(name: string, others: Iterable<string>): string | undefined {
  const wanted = name.trim().toUpperCase();
  if (wanted.length === 0) return VARIATION_TEXT.emptyName;
  for (const other of others) {
    if (other.trim().toUpperCase() === wanted) return VARIATION_TEXT.takenName;
  }
  return undefined;
}

export function createNameEntry(options: NameEntryOptions): NameEntry {
  const { check } = options;
  const choices = [...NAME_ALPHABET, NAME_END];
  const end = choices.length - 1;
  let taken = spellable(options.start);
  let under = end;
  let refusal: string | undefined;

  const spin = (delta: number): void => {
    // A full name has one choice left: keep it.
    if (taken.length >= VARIATION_NAME_LENGTH) return;
    under = (under + delta + choices.length) % choices.length;
    refusal = undefined;
  };

  return {
    get taken(): string {
      return taken;
    },
    get under(): string {
      return choices[under] ?? NAME_END;
    },
    get name(): string {
      return taken.trim();
    },
    get refusal(): string | undefined {
      return refusal;
    },
    previous: () => {
      spin(-1);
    },
    next: () => {
      spin(1);
    },
    commit: (): NameCommit => {
      if (under === end) {
        refusal = check(taken.trim());
        return refusal === undefined ? 'kept' : 'refused';
      }
      taken = `${taken}${choices[under] ?? ''}`;
      under = end;
      refusal = undefined;
      return 'next';
    },
    back: (): boolean => {
      const last = taken.at(-1);
      if (last === undefined) return false;
      taken = taken.slice(0, -1);
      under = Math.max(0, choices.indexOf(last));
      refusal = undefined;
      return true;
    },
  };
}

/** Why the naming card is open: a new game being kept, or one being renamed. */
export type NamePurpose = 'create' | 'rename';

/**
 * Every line under the name, in the order {@link drawNameEntry} draws them: where
 * the game comes from, what naming it does, the refusal if the last `ENTER` was
 * refused, and the two lines of help — whose verbs are what the keys do **now**,
 * because on this card they change: `ENTER` keeps on `END` and takes a letter
 * anywhere else, and `ESC` leaves only when there is no letter to step back to.
 */
export function nameEntryNotes(
  entry: NameEntry,
  purpose: NamePurpose,
  from: string,
  was: string,
): readonly MenuLine[] {
  return [
    // A variation that names no game it came from says only whose it is.
    { text: from.length > 0 ? `FROM ${from}` : 'YOURS', tone: 'note' },
    { text: purpose === 'create' ? VARIATION_TEXT.stays : `WAS ${was}`, tone: 'legend' },
    { text: entry.refusal ?? '', tone: 'refuse' },
    {
      text: keyLine([KEY.values, 'CHANGE'], [KEY.ok, entry.under === NAME_END ? 'KEEP' : 'NEXT']),
      tone: 'help',
    },
    { text: keyLine([KEY.back, entry.taken.length === 0 ? 'CANCEL' : 'BACK']), tone: 'help' },
  ];
}

/* -------------------------------------------------------------------------- */
/* Deleting                                                                    */
/* -------------------------------------------------------------------------- */

/** What the delete card's cursor is on. */
export type DeleteChoice = 'keep' | 'delete';

/** The two, in the order they are drawn: the safe one first. */
export const DELETE_CHOICES: readonly DeleteChoice[] = Object.freeze(['keep', 'delete']);

/**
 * A cursor over {@link DELETE_CHOICES}. It opens on `keep` and cannot be opened
 * anywhere else, for the reason the exit card opens on `RESUME` (`./pause.ts`):
 * the press that opens a destructive question must never be the one that answers
 * it.
 */
export interface DeleteConfirm {
  readonly index: number;
  readonly choice: DeleteChoice;
  previous: () => void;
  next: () => void;
}

export function createDeleteConfirm(): DeleteConfirm {
  let index = 0;
  const move = (delta: number): void => {
    index = (index + delta + DELETE_CHOICES.length) % DELETE_CHOICES.length;
  };
  return {
    get index(): number {
      return index;
    },
    get choice(): DeleteChoice {
      return DELETE_CHOICES[index] ?? 'keep';
    },
    previous: () => {
      move(-1);
    },
    next: () => {
      move(1);
    },
  };
}

/** Every line under the two choices, in the order {@link drawDeleteConfirm} draws them. */
export function deleteConfirmNotes(name: string): readonly MenuLine[] {
  return [
    { text: name, tone: 'note' },
    { text: VARIATION_TEXT.cannotUndo, tone: 'refuse' },
    { text: VARIATION_TEXT.deleteKeys, tone: 'help' },
    { text: VARIATION_TEXT.deleteBack, tone: 'help' },
  ];
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                     */
/* -------------------------------------------------------------------------- */

const HEADING_COLOUR = '#ff2b2b';
const VALUE_COLOUR = '#ffffff';
const CURSOR_COLOUR = '#ffd400';
const DIM_COLOUR = '#7d8aa8';

/** Matches `./menus.ts`: a card's rows and its lines share a pitch. */
const ROW_PITCH = 10;
const HEADING_GAP = 16;
const PADDING = 8;

/** Both cards are the settings card's width, and open where it sits. */
export const VARIATION_CARD_WIDTH = 216;

/** Characters across the card, inside its padding. */
const CARD_CELLS = Math.floor((VARIATION_CARD_WIDTH - PADDING * 2) / 8);

/** How far either word sits from the card's centre, as on the exit card. */
const CHOICE_OFFSET = 48;

export interface NameEntryCardOptions {
  readonly entry: NameEntry;
  readonly purpose: NamePurpose;
  /** The name of the game it was made from. */
  readonly from: string;
  /** Its name before this card, when renaming. */
  readonly was: string;
  readonly steps: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Draw the naming card: the letters taken, then the one under the cursor —
 * blinking, and underlined as initials entry underlines its letter — at a fixed
 * left edge, so the name grows rightwards rather than shifting under the player.
 */
export function drawNameEntry(ctx: CanvasRenderingContext2D, options: NameEntryCardOptions): void {
  const { entry, purpose, from, was, steps, x, y } = options;
  const lines = nameEntryNotes(entry, purpose, fitText(from, CARD_CELLS - 5), was);
  drawCentredPanel(ctx, x, y - 6, VARIATION_CARD_WIDTH, cardHeight(1, lines.length));
  drawText(
    ctx,
    purpose === 'create' ? VARIATION_TEXT.nameHeading : VARIATION_TEXT.renameHeading,
    x,
    y + 4,
    { colour: HEADING_COLOUR, align: 'center' },
  );

  const top = y + HEADING_GAP + 4;
  const widest = measureText('M'.repeat(VARIATION_NAME_LENGTH + NAME_END.length));
  const left = Math.round(x - widest / 2);
  drawText(ctx, entry.taken, left, top, { colour: VALUE_COLOUR });
  const lit = Math.floor(steps / MENU_BLINK_STEPS) % 2 === 0;
  const colour = lit ? CURSOR_COLOUR : DIM_COLOUR;
  // `END` stands half a cell clear of the name, so it reads as the way out rather
  // than as three more letters of it.
  const gap = entry.under === NAME_END && entry.taken.length > 0 ? 4 : 0;
  const at = left + measureText(entry.taken) + gap;
  // A space under the cursor is drawn as nothing, so the underline is what shows it.
  drawText(ctx, entry.under, at, top, { colour });
  ctx.fillStyle = colour;
  ctx.fillRect(at, top + 9, measureText(entry.under) - 2, 1);

  let line = top + ROW_PITCH + 4;
  for (const { text, tone } of lines) {
    drawText(ctx, fitText(text, CARD_CELLS), x, line, { colour: MENU_INK[tone], align: 'center' });
    line += ROW_PITCH;
  }
}

export interface DeleteConfirmCardOptions {
  readonly confirm: DeleteConfirm;
  /** The variation's name, said on the card so nothing is deleted unnamed. */
  readonly name: string;
  readonly steps: number;
  readonly x: number;
  readonly y: number;
}

/** Draw the delete card: the question, `KEEP` and `DELETE`, the name and the warning. */
export function drawDeleteConfirm(
  ctx: CanvasRenderingContext2D,
  options: DeleteConfirmCardOptions,
): void {
  const { confirm, name, steps, x, y } = options;
  const lines = deleteConfirmNotes(name);
  drawCentredPanel(ctx, x, y - 6, VARIATION_CARD_WIDTH, cardHeight(1, lines.length));
  drawText(ctx, VARIATION_TEXT.deleteHeading, x, y + 4, {
    colour: HEADING_COLOUR,
    align: 'center',
  });

  const lit = Math.floor(steps / MENU_BLINK_STEPS) % 2 === 0;
  const choiceY = y + HEADING_GAP + 4;
  DELETE_CHOICES.forEach((choice, index) => {
    const live = index === confirm.index;
    drawText(
      ctx,
      choice === 'keep' ? VARIATION_TEXT.keep : VARIATION_TEXT.delete,
      x + (index === 0 ? -CHOICE_OFFSET : CHOICE_OFFSET),
      choiceY,
      { colour: live ? (lit ? CURSOR_COLOUR : VALUE_COLOUR) : DIM_COLOUR, align: 'center' },
    );
  });

  let line = choiceY + ROW_PITCH + 4;
  for (const { text, tone } of lines) {
    drawText(ctx, fitText(text, CARD_CELLS), x, line, { colour: MENU_INK[tone], align: 'center' });
    line += ROW_PITCH;
  }
}
