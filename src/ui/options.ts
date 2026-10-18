/**
 * A game's own options: the card its attract screen opens, so that each game has
 * a settings control of its own rather than one reached only from the top of the
 * front end.
 *
 * **Every row is something the game's variant document already selects**, so this
 * card is a view onto that document and holds no setting of its own. `SHIPS` is
 * the document's `lives` — one of the counts the rules offer, the cabinet's own
 * starting-ship setting (`startingLivesOffered` in `src/content/rules.ts`) — and
 * `AUDIO` says which sound set the game plays. There is nowhere here to put a
 * number the rules do not already list, for the reason the difficulty preset has
 * nowhere to put a multiplier (`./settings.ts`).
 *
 * It is worked exactly as the pack manager is (`./packs.ts`), because it does the
 * same thing to the same document:
 *
 * - **It edits a draft, judged as it changes.** `judge` is handed in, and the flow
 *   hands in the composer's (`./compose.ts`) — the loader's two passes and the
 *   structural half of the playability pass, over the document with the draft's
 *   count — so a count is refused on the card for exactly what a document in
 *   `variants/` stating it would be refused for.
 * - **`ENTER` keeps and `ESC` cancels.** Over a shipped game keeping makes a new
 *   game — the naming card comes next, and the shipped game is never written —
 *   and over the player's own variation it changes that. The legend says which
 *   before the press, in the pack manager's words.
 *
 * **Only one audio theme exists**, and the `AUDIO` row says so rather than
 * offering a choice it cannot honour. A game's sounds are its packs' `sounds`,
 * `music` and sound documents, layered as everything else is; nothing in the
 * content model declares a second set a player could choose instead. So the row
 * is not editable, and the day a pack can declare one, this is where it is chosen.
 *
 * A value with a cursor, like every card in `src/ui/`: `./flow.ts` calls a verb on
 * the matching input edge, and {@link drawOptionsCard} renders what the value says.
 */

import type { ExtraLifeAward } from '../content/schema.js';
import { KEY, keyLine } from './keys.js';
import { type CardRow, cycle, drawRowCard, fitText, type MenuLine } from './menus.js';
import { EDITOR_CARD_WIDTH, PACKS_TEXT, type Verdict, verdictLines } from './packs.js';

/** Every fixed string the card draws. Held to the font by `tests/unit/options.test.ts`. */
export const OPTIONS_TEXT = Object.freeze({
  /** After the game's name in the heading: `STAR SWARM OPTIONS`. */
  heading: 'OPTIONS',
  shipsLabel: 'SHIPS',
  /** Under `SHIPS` when the rules offer one count, so a dim row says why it is. */
  shipsOnly: 'THE ONLY COUNT IT OFFERS',
  audioLabel: 'AUDIO',
  /** What `AUDIO` reads: the game's own sounds, as its packs layer them. */
  audioOwn: 'OWN',
  /** Under `AUDIO`, always: there is no second theme to choose. */
  audioOnly: 'ONLY ONE THEME EXISTS',
  /** Under `SHIPS` for a count whose cabinet setting awards nothing. */
  noBonus: 'NO BONUS SHIPS',
  keys: keyLine([KEY.rows, 'MOVE'], [KEY.values, 'CHANGE']),
});

export type OptionsRowId = 'ships' | 'audio';

/** One row of the card. */
export interface OptionsRow extends CardRow {
  readonly id: OptionsRowId;
  readonly note: string;
}

export interface OptionsCardOptions {
  /** The game's name, for the heading. */
  readonly name: string;
  /** The starting counts the rules offer, ascending. At least one. */
  readonly offered: readonly number[];
  /** The count the game's document plays now. Keeping exactly this changes nothing. */
  readonly own: number;
  /** The extra-life award a count selects: the rules', resolved for that count. */
  readonly bonusOf: (lives: number) => ExtraLifeAward;
  /** The verdict on a draft count. Asked once per distinct count. */
  readonly judge: (lives: number) => Verdict;
  /** True over a shipped game, where keeping makes a new one rather than changing it. */
  readonly makesNew?: boolean;
}

/** What keeping the card hands the flow: the count to store, or none. */
export type OptionsKeep =
  | {
      readonly kept: true;
      /** The count to store, or `undefined` when it is the one the game already plays. */
      readonly lives: number | undefined;
    }
  | { readonly kept: false };

export interface OptionsCard {
  /** The game's name, as the heading says it. */
  readonly name: string;
  /** True over a shipped game, where keeping makes a new one. */
  readonly makesNew: boolean;
  readonly rows: readonly OptionsRow[];
  readonly index: number;
  readonly row: OptionsRow;
  /** The starting count as drafted so far. */
  readonly lives: number;
  readonly verdict: Verdict;
  /** True after `ENTER` was refused, until the draft changes. */
  readonly refused: boolean;
  next: () => void;
  previous: () => void;
  /** Change the row under the cursor by `delta` places, if it is editable. */
  adjust: (delta: number) => void;
  keep: () => OptionsKeep;
}

/** A score as the note says it: `20K` for whole thousands, the number otherwise. */
function scoreText(score: number): string {
  return score % 1000 === 0 ? `${String(score / 1000)}K` : String(score);
}

/**
 * What a count's extra-life award is, in one line: `BONUS 20K 70K EVERY 70K`.
 *
 * Said under `SHIPS` because it is the half of the choice nobody would guess: the
 * cabinet offers a different set of thresholds to a game started on more ships
 * (`resolveExtraLifeAward`), so the count changes the bonuses too. No commas, so
 * the longest Classic setting — five ships, `BONUS 30K 150K EVERY 150K` — is the
 * card's twenty-five cells exactly.
 */
export function bonusLine(award: ExtraLifeAward): string {
  if (award.mode === 'none') return OPTIONS_TEXT.noBonus;
  const first = scoreText(award.first);
  if (award.second === undefined) return `BONUS AT ${first}`;
  const second = scoreText(award.second);
  if (award.repeat === undefined) return `BONUS ${first} AND ${second}`;
  return `BONUS ${first} ${second} EVERY ${scoreText(award.repeat)}`;
}

/** Build the card. It opens on the game's own count, with the cursor on `SHIPS`. */
export function createOptionsCard(options: OptionsCardOptions): OptionsCard {
  const { name, offered, own, bonusOf, judge, makesNew = false } = options;
  let lives = own;
  let index = 0;
  let refused = false;
  const verdicts = new Map<number, Verdict>();

  const verdictOf = (count: number): Verdict => {
    const known = verdicts.get(count);
    if (known !== undefined) return known;
    const verdict = judge(count);
    verdicts.set(count, verdict);
    return verdict;
  };

  const rowsOf = (): OptionsRow[] => {
    const choosable = offered.length > 1;
    return [
      {
        id: 'ships',
        label: OPTIONS_TEXT.shipsLabel,
        value: String(lives),
        editable: choosable,
        note: choosable ? bonusLine(bonusOf(lives)) : OPTIONS_TEXT.shipsOnly,
      },
      {
        id: 'audio',
        label: OPTIONS_TEXT.audioLabel,
        value: OPTIONS_TEXT.audioOwn,
        editable: false,
        note: OPTIONS_TEXT.audioOnly,
      },
    ];
  };

  const clamp = (rows: readonly OptionsRow[]): number =>
    Math.min(index, Math.max(0, rows.length - 1));

  const rowAt = (): OptionsRow => {
    const rows = rowsOf();
    const row = rows[clamp(rows)];
    if (row === undefined) throw new Error('an options card always has its rows');
    return row;
  };

  return {
    name,
    makesNew,
    get rows(): readonly OptionsRow[] {
      return rowsOf();
    },
    get index(): number {
      return clamp(rowsOf());
    },
    get row(): OptionsRow {
      return rowAt();
    },
    get lives(): number {
      return lives;
    },
    get verdict(): Verdict {
      return verdictOf(lives);
    },
    get refused(): boolean {
      return refused;
    },
    next: () => {
      index = cycle(clamp(rowsOf()), 1, rowsOf().length);
    },
    previous: () => {
      index = cycle(clamp(rowsOf()), -1, rowsOf().length);
    },
    adjust: (delta) => {
      const row = rowAt();
      if (!row.editable || delta === 0) return;
      // Only `SHIPS` is editable, and it walks the counts on offer, wrapping like
      // every row that steps through a list.
      const at = Math.max(0, offered.indexOf(lives));
      lives = offered[cycle(at, delta, offered.length)] ?? lives;
      refused = false;
    },
    keep: (): OptionsKeep => {
      if (!verdictOf(lives).ok) {
        refused = true;
        return { kept: false };
      }
      return { kept: true, lives: lives === own ? undefined : lives };
    },
  };
}

/** Every line under the rows, in the order {@link drawOptionsCard} draws them. */
export function optionsNotes(card: OptionsCard): readonly MenuLine[] {
  return [
    { text: card.row.note, tone: 'note' },
    { text: card.makesNew ? PACKS_TEXT.keepsNew : PACKS_TEXT.keepsYours, tone: 'legend' },
    ...verdictLines(card.verdict, card.refused),
    { text: OPTIONS_TEXT.keys, tone: 'help' },
    { text: PACKS_TEXT.editorDone, tone: 'help' },
  ];
}

/** The heading: the game's name and `OPTIONS`, cut to the card rather than off it. */
export function optionsHeading(name: string): string {
  return fitText(`${name} ${OPTIONS_TEXT.heading}`, OPTIONS_CARD_CELLS);
}

/** The card is the settings card's width, and opens where it sits. */
export const OPTIONS_CARD_WIDTH = EDITOR_CARD_WIDTH;

/** Characters across the card, inside its padding. Matches `./menus.ts`. */
const OPTIONS_CARD_CELLS = Math.floor((OPTIONS_CARD_WIDTH - 16) / 8);

export interface OptionsScreenOptions {
  readonly card: OptionsCard;
  readonly steps: number;
  readonly x: number;
  readonly y: number;
}

/** Draw the card: {@link drawRowCard} over its rows, headed by the game's name. */
export function drawOptionsCard(
  ctx: CanvasRenderingContext2D,
  options: OptionsScreenOptions,
): void {
  const { card, steps, x, y } = options;
  drawRowCard(ctx, {
    heading: optionsHeading(card.name),
    rows: card.rows,
    index: card.index,
    lines: optionsNotes(card),
    steps,
    x,
    y,
    width: OPTIONS_CARD_WIDTH,
  });
}
