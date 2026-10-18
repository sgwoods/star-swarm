/**
 * A game's own options: the card its attract screen opens, so that each game has
 * a settings control of its own rather than one reached only from the top of the
 * front end.
 *
 * **Every row is something the game's variant document already selects**, so this
 * card is a view onto that document and holds no setting of its own. `SHIPS` is
 * the document's `lives` — one of the counts the rules offer, the cabinet's own
 * starting-ship setting (`startingLivesOffered` in `src/content/rules.ts`) — and
 * `AUDIO` is its `theme`, one of the audio themes its packs declare
 * (`src/content/themes.ts`). There is nowhere here to put a number the rules do
 * not already list or a sound no pack ships, for the reason the difficulty preset
 * has nowhere to put a multiplier (`./settings.ts`).
 *
 * It is worked exactly as the pack manager is (`./packs.ts`), because it does the
 * same thing to the same document:
 *
 * - **It edits a draft, judged as it changes.** `judge` is handed in, and the flow
 *   hands in the composer's (`./compose.ts`) — the loader's two passes and the
 *   structural half of the playability pass, over the document with the draft's
 *   count and theme — so a choice is refused on the card for exactly what a
 *   document in `variants/` stating it would be refused for.
 * - **`ENTER` keeps and `ESC` cancels.** Over a shipped game keeping makes a new
 *   game — the naming card comes next, and the shipped game is never written —
 *   and over the player's own variation it changes that. The legend says which
 *   before the press, in the pack manager's words.
 *
 * **`AUDIO` offers only what the packs declare.** A game whose packs declare two
 * or more audio themes steps through them by name, wrapping, with the theme's own
 * line under the row. One whose packs declare none — most games — reads `OWN`,
 * says that only one theme exists and is not editable, rather than offering a
 * choice it cannot honour. Keeping the packs' default theme states nothing, as
 * keeping the rules' default count does not.
 *
 * A value with a cursor, like every card in `src/ui/`: `./flow.ts` calls a verb on
 * the matching input edge, and {@link drawOptionsCard} renders what the value says.
 */

import type { ExtraLifeAward } from '../content/schema.js';
import type { ThemeChoice } from '../content/themes.js';
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
  /** Under `AUDIO` when the packs declare fewer than two themes: there is none to choose. */
  audioOnly: 'ONLY ONE THEME EXISTS',
  /** Under `SHIPS` for a count whose cabinet setting awards nothing. */
  noBonus: 'NO BONUS SHIPS',
  keys: keyLine([KEY.rows, 'MOVE'], [KEY.values, 'CHANGE']),
});

export type OptionsRowId = 'ships' | 'audio';

/** What the card is judging: a starting count and an audio theme together. */
export interface OptionsDraft {
  readonly lives: number;
  /** The theme id, or `undefined` for a game whose packs declare none. */
  readonly theme: string | undefined;
}

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
  /** The audio themes the packs declare, in order. Empty or omitted: the game has one sound. */
  readonly themes?: readonly ThemeChoice[];
  /** The theme the game's document plays now. Keeping exactly this changes nothing. */
  readonly theme?: string | undefined;
  /** The verdict on a draft. Asked once per distinct draft. */
  readonly judge: (draft: OptionsDraft) => Verdict;
  /** True over a shipped game, where keeping makes a new one rather than changing it. */
  readonly makesNew?: boolean;
}

/** What keeping the card hands the flow: what to store, field by field, or nothing. */
export type OptionsKeep =
  | {
      readonly kept: true;
      /** The count to store, or `undefined` when it is the one the game already plays. */
      readonly lives: number | undefined;
      /** The theme to store, or `undefined` when it is the one the game already plays. */
      readonly theme: string | undefined;
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
  /** The audio theme as drafted so far, or `undefined` when the packs declare none. */
  readonly theme: string | undefined;
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

/**
 * The note under an offered theme: its own line, or where it sits in the list
 * when the pack wrote none — never blank, so moving onto the row says something.
 */
function themeNote(themes: readonly ThemeChoice[], at: number): string {
  const theme = themes[at];
  return theme?.description ?? `THEME ${String(at + 1)} OF ${String(themes.length)}`;
}

/** Build the card. It opens on the game's own count and theme, with the cursor on `SHIPS`. */
export function createOptionsCard(options: OptionsCardOptions): OptionsCard {
  const { name, offered, own, bonusOf, judge, makesNew = false, themes = [] } = options;
  const ownTheme = options.theme;
  let lives = own;
  let theme = ownTheme;
  let index = 0;
  let refused = false;
  const verdicts = new Map<string, Verdict>();

  const draft = (): OptionsDraft => ({ lives, theme });

  const verdictOf = (judged: OptionsDraft): Verdict => {
    const key = `${String(judged.lives)} ${judged.theme ?? ''}`;
    const known = verdicts.get(key);
    if (known !== undefined) return known;
    const verdict = judge(judged);
    verdicts.set(key, verdict);
    return verdict;
  };

  const themeAt = (): number =>
    Math.max(
      0,
      themes.findIndex((choice) => choice.id === theme),
    );

  const audioRow = (): OptionsRow => {
    if (themes.length < 2) {
      return {
        id: 'audio',
        label: OPTIONS_TEXT.audioLabel,
        value: themes[0]?.name ?? OPTIONS_TEXT.audioOwn,
        editable: false,
        note: OPTIONS_TEXT.audioOnly,
      };
    }
    const at = themeAt();
    return {
      id: 'audio',
      label: OPTIONS_TEXT.audioLabel,
      value: themes[at]?.name ?? OPTIONS_TEXT.audioOwn,
      editable: true,
      note: themeNote(themes, at),
    };
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
      audioRow(),
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
    get theme(): string | undefined {
      return theme;
    },
    get verdict(): Verdict {
      return verdictOf(draft());
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
      // Each editable row walks the values on offer, wrapping like every row that
      // steps through a list: `SHIPS` the counts, `AUDIO` the declared themes.
      if (row.id === 'ships') {
        const at = Math.max(0, offered.indexOf(lives));
        lives = offered[cycle(at, delta, offered.length)] ?? lives;
      } else {
        theme = themes[cycle(themeAt(), delta, themes.length)]?.id ?? theme;
      }
      refused = false;
    },
    keep: (): OptionsKeep => {
      if (!verdictOf(draft()).ok) {
        refused = true;
        return { kept: false };
      }
      return {
        kept: true,
        lives: lives === own ? undefined : lives,
        theme: theme === ownTheme ? undefined : theme,
      };
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
