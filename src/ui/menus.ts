/**
 * The start-up variant selector and the player-settings menu — `docs/DESIGN.md`
 * section 6 layer 3, and the captain's "create variants and select them when we
 * start".
 *
 * Two menus, one shape. Each is a **value with a cursor**, not a widget: the
 * state machine in `src/ui/flow.ts` calls a verb when it sees the matching input
 * edge, and the draw functions at the bottom of this file render whatever the
 * value says. That is the same split `highscores.ts` uses for initials entry, and
 * it is what makes both menus testable on the Node environment with no DOM.
 *
 * Three things worth knowing before editing:
 *
 * - **Neither menu applies anything.** {@link createSettingsMenu} is handed
 *   `read` and `write`, and a row that changes calls `write` with a patch. What a
 *   changed setting *does* — restart a synth, rebuild a sprite sheet, pick a
 *   different rank for the next game — belongs to whoever owns those things, and
 *   a menu that reached for them would be a second place the game is configured.
 * - **The rows are derived, never stored.** {@link SettingsMenu.rows} is computed
 *   from the settings and the active variant on every read, so a value the flow
 *   changed elsewhere cannot leave a stale row on screen. The `GAME` row is
 *   absent when there is only one variant, which is the same rule that keeps the
 *   selector from being a screen nobody needs.
 * - **Nothing here names a variant, a pack or a rank.** The labels come from the
 *   variant documents and the presets they declare.
 */

import type { Persona } from '../content/personas.js';
import { personaOf } from '../content/personas.js';
import type { DifficultyPreset } from '../content/variants.js';
import { presetOf } from '../content/variants.js';
import { drawText, measureText } from '../render/text.js';
import { KEY, keyLine } from './keys.js';
import { CARD_TOP, drawCentredPanel } from './panel.js';
import {
  CONTROL_SCHEMES,
  type ControlScheme,
  quantiseVolume,
  type Settings,
  VOLUME_STEPS,
} from './settings.js';

/**
 * What a menu needs to know about a variant.
 *
 * Structural, so `ResolvedVariant` from `src/content/variants.ts` satisfies it
 * and this module never imports a registry, a loader or a pack.
 */
export interface MenuVariant {
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly demonstration: boolean;
  /** The pack ids it layers, in order. */
  readonly packs: readonly string[];
  readonly presets: readonly DifficultyPreset[];
  readonly defaultPreset: DifficultyPreset;
  /**
   * The autoplay personas this game offers. **Empty is the normal case** and
   * means the `AUTOPLAY` row is not shown, the same rule the `GAME` row follows
   * on a one-variant cabinet: a row whose only value is OFF is a row nobody needs.
   */
  readonly personas: readonly Persona[];
  /** Which persona the row lands on first, if the document named one. */
  readonly defaultPersona?: Persona | undefined;
}

/* -------------------------------------------------------------------------- */
/* The variant selector                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A cursor over the variants on offer.
 *
 * Wrapping, because a list of two with a cursor that stops at the ends is a list
 * the player has to think about.
 */
export interface VariantMenu<T extends MenuVariant = MenuVariant> {
  readonly variants: readonly T[];
  readonly index: number;
  /** The variant under the cursor. */
  readonly chosen: T;
  previous: () => void;
  next: () => void;
}

export interface VariantMenuOptions<T extends MenuVariant> {
  readonly variants: readonly T[];
  /** Which to start on — the remembered choice. Unknown ids start at the first. */
  readonly selected?: string | undefined;
}

/**
 * Generic in the variant so that the caller gets its *own* type back from
 * {@link VariantMenu.chosen}. The flow hands in `FlowVariant`s and needs one back
 * to start a game with; looking the choice up again by id would be a second
 * lookup that could disagree with the first.
 */
export function createVariantMenu<T extends MenuVariant>(
  options: VariantMenuOptions<T>,
): VariantMenu<T> {
  const { variants } = options;
  const first = variants[0];
  if (first === undefined) throw new Error('a variant menu needs at least one variant');

  const remembered = variants.findIndex((variant) => variant.id === options.selected);
  let index = remembered >= 0 ? remembered : 0;

  const move = (delta: number): void => {
    index = (index + delta + variants.length) % variants.length;
  };

  return {
    variants,
    get index(): number {
      return index;
    },
    get chosen(): T {
      return variants[index] ?? first;
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
/* The settings menu                                                           */
/* -------------------------------------------------------------------------- */

/** The rows the menu can show, in menu order. */
export const SETTINGS_ROW_IDS = [
  'game',
  'difficulty',
  'autoplay',
  'volume',
  'sound',
  'controls',
  'crt',
  'packs',
] as const;

export type SettingsRowId = (typeof SETTINGS_ROW_IDS)[number];

export interface SettingsRow {
  readonly id: SettingsRowId;
  readonly label: string;
  /** What the row reads right now. */
  readonly value: string;
  /** A dim line under the row when there is something to say about it. */
  readonly note?: string;
  /**
   * False for a row that reports state this menu cannot change yet. It is still
   * a real setting — it is stored and honoured — but left and right do nothing.
   */
  readonly editable: boolean;
}

export interface SettingsMenu {
  /** Derived on every read from the settings and the active variant. */
  readonly rows: readonly SettingsRow[];
  readonly index: number;
  /** The row under the cursor. */
  readonly row: SettingsRow;
  /** Move the cursor. Wrapping, like the selector's. */
  next: () => void;
  previous: () => void;
  /** Change the row under the cursor by `delta` places, if it is editable. */
  adjust: (delta: number) => void;
}

export interface SettingsMenuOptions {
  readonly read: () => Settings;
  readonly write: (patch: Partial<Settings>) => void;
  /** Every variant on offer. One means the `GAME` row is not shown. */
  readonly variants: readonly MenuVariant[];
  /** The variant in force, read each time: changing the `GAME` row changes it. */
  readonly active: () => MenuVariant;
}

/** Human labels for the control schemes. */
const CONTROL_LABELS: Readonly<Record<ControlScheme, string>> = Object.freeze({
  both: 'ARROWS + WASD',
  arrows: 'ARROWS',
  wasd: 'WASD',
});

/** The two cells a volume bar is made of. Both are in the pixel font; `|` is not. */
const BAR_FILLED = '#';
const BAR_EMPTY = '.';

/**
 * `[#####.....]` — ten cells, so a row shows a level rather than a number.
 *
 * `#` rather than the obvious `|` because the font in `src/render/text.ts` has no
 * pipe, and `drawText` draws an unknown character as *nothing* while still
 * advancing: the first recorded clip of this menu showed a bar whose filled half
 * was blank. `tests/unit/menus.test.ts` holds every character these cards draw to
 * the font's own set.
 *
 * Through `quantiseVolume` rather than clamping here, so that the bar cannot
 * disagree with the value that was stored, and so a non-finite volume draws the
 * default level instead of an empty bracket.
 */
export function volumeBar(volume: number): string {
  const filled = Math.round(quantiseVolume(volume) * VOLUME_STEPS);
  return `[${BAR_FILLED.repeat(filled)}${BAR_EMPTY.repeat(VOLUME_STEPS - filled)}]`;
}

/** Step `index` by `delta` through `length` places, wrapping. */
function cycle(index: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return (index + delta + length * Math.max(1, Math.abs(delta))) % length;
}

export function createSettingsMenu(options: SettingsMenuOptions): SettingsMenu {
  const { read, write, variants, active } = options;
  let index = 0;

  const rowsOf = (): SettingsRow[] => {
    const settings = read();
    const variant = active();
    const preset = presetOf(variant, settings.difficulty);
    const rows: SettingsRow[] = [];

    // Only when there is a choice: a one-variant cabinet must not grow a row
    // whose only value is the game the player is already looking at.
    if (variants.length > 1) {
      rows.push({
        id: 'game',
        label: 'GAME',
        value: variant.name,
        editable: true,
        ...(variant.demonstration ? { note: 'DEMONSTRATION' } : {}),
      });
    }

    rows.push({
      id: 'difficulty',
      label: 'DIFFICULTY',
      value: preset.label,
      editable: true,
      // The whole of what a preset does, said on screen: it picks a rank, and
      // the rules layer resolves that rank into its own tables.
      note: preset.description ?? `RANK ${preset.rank}`,
    });

    // Only when this game declares personas. A cabinet whose variant ships none
    // must not grow a row that can only say OFF.
    if (variant.personas.length > 0) {
      const persona = personaOf(variant, settings.autoplay);
      rows.push({
        id: 'autoplay',
        label: 'AUTOPLAY',
        value: persona?.label ?? MENU_TEXT.autoplayOff,
        editable: true,
        note: persona?.description ?? MENU_TEXT.autoplayOffNote,
      });
    }

    rows.push({
      id: 'volume',
      label: 'VOLUME',
      value: volumeBar(settings.volume),
      editable: true,
    });
    rows.push({
      id: 'sound',
      label: 'SOUND',
      value: settings.muted ? 'OFF' : 'ON',
      editable: true,
    });
    rows.push({
      id: 'controls',
      label: 'CONTROLS',
      value: CONTROL_LABELS[settings.controls],
      editable: true,
    });
    rows.push({
      id: 'crt',
      label: 'CRT',
      value: settings.crt ? 'ON' : 'OFF',
      editable: true,
      // What `src/render/crt.ts` draws, so the row says what turning it on does.
      note: MENU_TEXT.crtNote,
    });
    // The value is a count and the note is the list, because a pack list is a
    // sentence's worth of text and the value column is a word's worth.
    const packs = settings.packs[variant.id] ?? variant.packs;
    rows.push({
      id: 'packs',
      label: 'PACKS',
      value: String(packs.length),
      editable: false,
      note: packs.join(' + '),
    });

    return rows;
  };

  const adjust = (delta: number): void => {
    const rows = rowsOf();
    const row = rows[Math.min(index, rows.length - 1)];
    if (row === undefined || !row.editable) return;
    const settings = read();
    const variant = active();

    switch (row.id) {
      case 'game': {
        const at = variants.findIndex((candidate) => candidate.id === variant.id);
        const next = variants[cycle(Math.max(0, at), delta, variants.length)];
        if (next !== undefined) write({ variant: next.id });
        break;
      }
      case 'difficulty': {
        const presets = variant.presets;
        const current = presetOf(variant, settings.difficulty);
        const at = presets.findIndex((preset) => preset.id === current.id);
        const next = presets[cycle(Math.max(0, at), delta, presets.length)];
        if (next !== undefined) write({ difficulty: next.id });
        break;
      }
      case 'autoplay': {
        // One list: off, then every persona in menu order. Off is a place in the
        // cycle rather than a special case, so left from the first persona and
        // right from the last both land on it.
        const choices: readonly (Persona | undefined)[] = [undefined, ...variant.personas];
        const current = personaOf(variant, settings.autoplay);
        const at = choices.findIndex((choice) => choice?.id === current?.id);
        const next = choices[cycle(Math.max(0, at), delta, choices.length)];
        write({ autoplay: next?.id });
        break;
      }
      case 'volume': {
        const steps = Math.round(settings.volume * VOLUME_STEPS) + delta;
        write({ volume: Math.min(VOLUME_STEPS, Math.max(0, steps)) / VOLUME_STEPS });
        break;
      }
      case 'sound': {
        write({ muted: !settings.muted });
        break;
      }
      case 'controls': {
        const at = CONTROL_SCHEMES.indexOf(settings.controls);
        const next = CONTROL_SCHEMES[cycle(Math.max(0, at), delta, CONTROL_SCHEMES.length)];
        if (next !== undefined) write({ controls: next });
        break;
      }
      case 'crt': {
        write({ crt: !settings.crt });
        break;
      }
      case 'packs': {
        break;
      }
    }
  };

  const move = (delta: number): void => {
    const length = rowsOf().length;
    index = cycle(index, delta, length);
  };

  return {
    get rows(): readonly SettingsRow[] {
      return rowsOf();
    },
    get index(): number {
      const rows = rowsOf();
      return Math.min(index, Math.max(0, rows.length - 1));
    },
    get row(): SettingsRow {
      const rows = rowsOf();
      const row = rows[Math.min(index, rows.length - 1)];
      if (row === undefined) throw new Error('a settings menu with no rows');
      return row;
    },
    next: () => {
      move(1);
    },
    previous: () => {
      move(-1);
    },
    adjust,
  };
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                     */
/* -------------------------------------------------------------------------- */

/** Blink period of the row or entry under the cursor, in simulation steps. */
export const MENU_BLINK_STEPS = 20;

/**
 * Every fixed string these two cards draw.
 *
 * Gathered rather than written inline so that `tests/unit/menus.test.ts` can hold
 * all of them to the font's glyph set at once — an unknown character draws
 * nothing and still advances, so a heading with a character the font lacks is a
 * gap nobody notices until a clip is recorded.
 */
export const MENU_TEXT = Object.freeze({
  selectHeading: 'SELECT GAME',
  selectLegend: '* DEMONSTRATION ONLY',
  /** The two lines of help on each card, in the one voice `./keys.ts` writes. */
  selectKeys: keyLine([KEY.rows, 'MOVE'], [KEY.ok, 'CHOOSES']),
  selectBack: keyLine([KEY.back, 'SETTINGS']),
  settingsHeading: 'SETTINGS',
  settingsKeys: keyLine([KEY.rows, 'MOVE'], [KEY.values, 'CHANGE']),
  settingsDone: keyLine([KEY.ok, 'DONE'], [KEY.back, 'BACK']),
  /** What the `AUTOPLAY` row reads when a human is flying, and the line under it. */
  autoplayOff: 'OFF',
  autoplayOffNote: 'WATCH IT PLAY ITSELF',
  sessionOnly: 'THIS SESSION ONLY',
  /** The line under the `CRT` row. */
  crtNote: 'SCANLINES, CURVED GLASS',
});

const HEADING_COLOUR = '#ff2b2b';
const VALUE_COLOUR = '#ffffff';
const CURSOR_COLOUR = '#ffd400';
const DIM_COLOUR = '#7d8aa8';
const NOTE_COLOUR = '#b9c9ff';

/**
 * Row pitch, in logical pixels: one 8-px cell plus two of air.
 *
 * Tight, and **one note line for the whole card** rather than a note under every
 * row, because the playfield is 288 pixels tall and the band a card sits in
 * (`./panel.ts`, `CARD_TOP`…`CARD_BOTTOM`) is about a hundred of them. Seven rows
 * each carrying their own note is a card taller than the screen — which is what
 * the first draft drew, off the bottom of the playfield. The note that matters is
 * the one under the cursor anyway.
 */
const ROW_PITCH = 10;

/** Air between a card's edge and its text, in logical pixels. */
const PADDING = 8;

/** Air above the first row, under the heading. */
const HEADING_GAP = 16;

/**
 * Trim `text` to `cells` characters.
 *
 * The playfield is 224 pixels wide and the font advances a fixed 8 per character
 * (`src/render/text.ts`), so a card holds a fixed number of them and nothing can
 * be relied on to fit. Authored text — a variant's description, a preset's — comes
 * from a document this code has never seen, and `drawText` clips nothing: it
 * simply keeps drawing, off the plate and off the screen. So every string drawn
 * below goes through here, and a document that says too much is cut rather than
 * allowed to spill across the playfield.
 */
export function fitText(text: string, cells: number): string {
  if (cells <= 0) return '';
  return text.length <= cells ? text : text.slice(0, cells);
}

/** How many characters fit in `width` pixels of card, inside its padding. */
function cellsIn(width: number): number {
  return Math.max(0, Math.floor((width - PADDING * 2) / measureText(' ')));
}

/**
 * The height a card needs: a heading, `rows` rows, and `lines` of text under
 * them, with air at the bottom to match the air at the top.
 *
 * Exported with the two tops below because a card that does not fit the 224x288
 * playfield is drawn off the bottom of it and nothing says so —
 * `tests/unit/menus.test.ts` does the arithmetic instead.
 */
export function cardHeight(rows: number, lines: number): number {
  return HEADING_GAP + 10 + rows * ROW_PITCH + lines * ROW_PITCH + PADDING;
}

/**
 * Where each card sits, in logical rows.
 *
 * Here rather than in `src/main.ts` so that the height above and the top are one
 * decision. The selector sits in the clear band the game leaves under the
 * formation; the settings card is taller, so it starts higher.
 */
export const SELECT_CARD_TOP = CARD_TOP;
export const SETTINGS_CARD_TOP = CARD_TOP - 24;

/**
 * Every line under the selector's list, in the order they are drawn: the chosen
 * game's description, the demonstration legend when there is a demonstration to
 * mark, and the two lines of help — which, as on the settings card, are never
 * conditional.
 */
export function variantSelectNotes(
  description: string,
  demonstrations: boolean,
): readonly MenuLine[] {
  const lines: MenuLine[] = [{ text: description, tone: 'note' }];
  if (demonstrations) lines.push({ text: MENU_TEXT.selectLegend, tone: 'legend' });
  lines.push({ text: MENU_TEXT.selectKeys, tone: 'help' });
  lines.push({ text: MENU_TEXT.selectBack, tone: 'help' });
  return lines;
}

/** Lines under the list on each card, which the height depends on. Derived, not stated. */
export function variantSelectLines(demonstrations: boolean): number {
  return variantSelectNotes('', demonstrations).length;
}

/**
 * How a line under the settings list is inked. See `./pause.ts` for why the
 * lines are a tone rather than a colour.
 */
export type MenuLineTone = 'note' | 'legend' | 'help';

/** One line under the settings list. */
export interface MenuLine {
  readonly text: string;
  readonly tone: MenuLineTone;
}

/**
 * Every line under the settings list, in the order they are drawn.
 *
 * {@link drawSettings} draws exactly this, so a test over the list is a test
 * over the card. **The control lines are not conditional**: an earlier draft
 * swapped both of them for `THIS SESSION ONLY` when storage was blocked, which
 * left a player whose browser refuses site data looking at a menu that said
 * nothing about which key changes a row or which one leaves. The storage note is
 * a line about the rows, so it goes with the row note, above the keys.
 */
export function settingsNotes(note: string, persistent: boolean): readonly MenuLine[] {
  const lines: MenuLine[] = [{ text: note, tone: 'note' }];
  if (!persistent) lines.push({ text: MENU_TEXT.sessionOnly, tone: 'help' });
  lines.push({ text: MENU_TEXT.settingsKeys, tone: 'help' });
  lines.push({ text: MENU_TEXT.settingsDone, tone: 'help' });
  return lines;
}

/** Lines under the list, which the card's height depends on. Derived, not stated. */
export function settingsLines(persistent: boolean): number {
  return settingsNotes('', persistent).length;
}

/** The ink each tone is drawn in. Help is the dim one, as on the pause cards. */
const MENU_INK: Record<MenuLineTone, string> = {
  note: NOTE_COLOUR,
  legend: DIM_COLOUR,
  help: DIM_COLOUR,
};

export interface VariantSelectOptions {
  readonly menu: VariantMenu;
  /** Flow steps in this phase, for the blink. */
  readonly steps: number;
  readonly x: number;
  readonly y: number;
}

const SELECT_CARD_WIDTH = 208;

/** Draw the start-up selector: the games on offer, one highlighted. */
export function drawVariantSelect(
  ctx: CanvasRenderingContext2D,
  options: VariantSelectOptions,
): void {
  const { menu, steps, x, y } = options;
  const demonstrations = menu.variants.some((variant) => variant.demonstration);
  // The chosen game's description, the demonstration legend if any, and the two
  // control lines.
  const lines = variantSelectLines(demonstrations);
  const cells = cellsIn(SELECT_CARD_WIDTH);

  drawCentredPanel(ctx, x, y - 6, SELECT_CARD_WIDTH, cardHeight(menu.variants.length, lines));
  drawText(ctx, MENU_TEXT.selectHeading, x, y + 4, { colour: HEADING_COLOUR, align: 'center' });

  const lit = Math.floor(steps / MENU_BLINK_STEPS) % 2 === 0;
  menu.variants.forEach((variant, index) => {
    const live = index === menu.index;
    // A demonstration is marked on its own row, not only in a legend: a variant
    // nobody committed to must not read like part of the line-up.
    const name = variant.demonstration ? `${variant.name} *` : variant.name;
    drawText(ctx, fitText(name, cells), x, y + HEADING_GAP + 4 + index * ROW_PITCH, {
      colour: live ? (lit ? CURSOR_COLOUR : VALUE_COLOUR) : DIM_COLOUR,
      align: 'center',
    });
  });

  // One description, for the game under the cursor. Every game's at once is a
  // card taller than the playfield as soon as there are a few of them.
  let line = y + HEADING_GAP + 8 + menu.variants.length * ROW_PITCH;
  for (const { text, tone } of variantSelectNotes(menu.chosen.description ?? '', demonstrations)) {
    drawText(ctx, fitText(text, cells), x, line, { colour: MENU_INK[tone], align: 'center' });
    line += ROW_PITCH;
  }
}

export interface SettingsScreenOptions {
  readonly menu: SettingsMenu;
  readonly steps: number;
  readonly x: number;
  readonly y: number;
  /** False when the settings are session-only because storage is unavailable. */
  readonly persistent?: boolean;
}

const SETTINGS_CARD_WIDTH = 216;

/**
 * Draw the settings screen.
 *
 * Laid out from a measured label column so that a longer label moves every value
 * with it, the same way `drawHighScoreTable` measures its rows. The note belongs
 * to the row under the cursor and is drawn once, under the list, with the card's
 * whole width to itself: a note is a sentence and a value is a word.
 */
export function drawSettings(ctx: CanvasRenderingContext2D, options: SettingsScreenOptions): void {
  const { menu, steps, x, y, persistent = true } = options;
  const rows = menu.rows;
  // The live row's note, the line that says these settings are going nowhere if
  // they are, and then the two control lines.
  const lines = settingsLines(persistent);

  drawCentredPanel(ctx, x, y - 6, SETTINGS_CARD_WIDTH, cardHeight(rows.length, lines));
  drawText(ctx, MENU_TEXT.settingsHeading, x, y + 4, { colour: HEADING_COLOUR, align: 'center' });

  const labelWidth = Math.max(...rows.map((row) => measureText(row.label)));
  const left = Math.round(x - SETTINGS_CARD_WIDTH / 2) + PADDING;
  const valueLeft = left + labelWidth + measureText(' ');
  const right = Math.round(x + SETTINGS_CARD_WIDTH / 2) - PADDING;
  const valueCells = Math.max(0, Math.floor((right - valueLeft) / measureText(' ')));
  const noteCells = cellsIn(SETTINGS_CARD_WIDTH);
  const lit = Math.floor(steps / MENU_BLINK_STEPS) % 2 === 0;

  rows.forEach((row, index) => {
    const live = index === menu.index;
    const top = y + HEADING_GAP + 4 + index * ROW_PITCH;
    const colour = live ? (lit ? CURSOR_COLOUR : VALUE_COLOUR) : DIM_COLOUR;
    drawText(ctx, row.label, left, top, { colour: live ? colour : DIM_COLOUR });
    drawText(ctx, fitText(row.value, valueCells), valueLeft, top, {
      colour: row.editable ? colour : DIM_COLOUR,
    });
  });

  let line = y + HEADING_GAP + 8 + rows.length * ROW_PITCH;
  for (const { text, tone } of settingsNotes(menu.row.note ?? '', persistent)) {
    drawText(ctx, fitText(text, noteCells), x, line, { colour: MENU_INK[tone], align: 'center' });
    line += ROW_PITCH;
  }
}
