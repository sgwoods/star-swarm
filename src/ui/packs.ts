/**
 * The pack manager and the stage-sequence editor — the two cards the settings
 * screen's `PACKS` and `STAGES` rows open, and the player-facing half of
 * `docs/DESIGN.md` section 6's "active packs".
 *
 * Both are **values with a cursor**, like the menus in `./menus.ts`: the state
 * machine in `./flow.ts` calls a verb on the matching input edge, and the draw
 * functions at the bottom render whatever the value says. Neither applies
 * anything. Keeping a card hands the flow a list to store, and the flow is the one
 * place a kept list has consequences.
 *
 * Four things worth knowing before editing:
 *
 * - **A card edits a draft, and refuses at the point of choosing.** Every change
 *   is judged at once — `judge` is handed in, and `./compose.ts` is the real one:
 *   the variant loader and the playability pass's structural checks, run over the
 *   draft — and the verdict is on the card while the player is still choosing.
 *   `ENTER` keeps a draft only when its verdict allows it; on a refused one it
 *   keeps nothing and says so. So a list that will not load, or whose fleet will
 *   not build, never reaches the settings document, and nothing fails at start.
 * - **The draft may pass through lists that cannot be kept.** Switching the base
 *   pack off on the way to a different one is a refused list for one press, and
 *   refusing the press itself would make the second list unreachable. The verdict
 *   says why at every step; only keeping is refused.
 * - **`ESC` throws the draft away** and is the only way off a card without
 *   keeping. The settings card applies each row as it changes; these two cannot,
 *   because a half-composed list is exactly what must not reach the game.
 * - **Nothing here names a pack, a stage or a rank.** The rows come from what the
 *   build installs and what the packs hold; the verdict's words come from
 *   `./compose.ts`.
 */

import type { VariantDocument } from '../content/variants.js';
import { KEY, keyLine } from './keys.js';
import { type CardRow, cycle, drawRowCard, type MenuLine, windowOf } from './menus.js';

export { windowOf } from './menus.js';

/** One pack this build installs, as the pack manager lists it. */
export interface InstalledPack {
  readonly id: string;
  /** The manifest's display name. */
  readonly name: string;
  /** It ships a `rules.json`: the one kind of pack a list cannot do without. */
  readonly rules: boolean;
  /** How many stage documents it holds. */
  readonly stages: number;
}

/**
 * What a card says about a draft.
 *
 * `headline` is a word or three and is inked by `ok`; `details` are the lines
 * under it — the reason for a refusal, or what the mix is coupled to when it may
 * be kept. Written by `./compose.ts`, in words a player can read.
 */
export interface Verdict {
  /** True when the draft may be kept. */
  readonly ok: boolean;
  readonly headline: string;
  readonly details: readonly string[];
  /**
   * True when keeping this pack list sets the stored stage order aside, because
   * that order names a stage the new list does not hold. Said on the card before
   * `ENTER`, so it is never silent.
   */
  readonly clearsStages?: boolean;
}

/** A combat stage a stage order may name, and the pack it comes from. */
export interface StageOption {
  readonly id: string;
  /** The display name of the pack the stage resolves to. */
  readonly pack: string;
}

/**
 * What the cards need from the content side.
 *
 * Structural, and generic in the variant it hands back, so `./flow.ts` holds it
 * as its own `FlowVariant` and `./compose.ts` implements it over a resolved one —
 * this module never imports a loader, a registry or a validator. A game is
 * handed over as its **document**, as JSON holds it: a shipped game's own
 * (`documentOf`), a variation as the settings store kept it, or a draft of
 * either. The composer validates every document it is handed except a shipped
 * game's own, which it recognises by identity and never judges.
 */
export interface PackComposer<V> {
  /** Every pack this build installs, in a fixed order. */
  readonly installed: readonly InstalledPack[];
  /** A shipped game's document, as `variants/<id>.json` holds it, or `undefined`. */
  documentOf: (id: string) => VariantDocument | undefined;
  /**
   * The verdict on one document, and the variant it plays as. `variant` is
   * present exactly when the verdict is `ok`.
   */
  compose: (document: VariantDocument) => {
    readonly verdict: Verdict;
    readonly variant: V | undefined;
  };
  /**
   * The verdict on a document with its pack list replaced, given the stage order
   * it already states. When that order is all that stops the list loading, the
   * list may still be kept and the verdict says the order will be cleared
   * ({@link Verdict.clearsStages}).
   */
  judgePacks: (document: VariantDocument, packs: readonly string[]) => Verdict;
  /** The verdict on a document with its stage order replaced: `undefined` is the packs' own. */
  judgeStages: (document: VariantDocument, stages: readonly string[] | undefined) => Verdict;
  /** The combat stages an order may name over a pack list, in menu order. */
  stageOptions: (document: VariantDocument, packs: readonly string[]) => readonly StageOption[];
  /** The packs' own combat order at a rank: what `OWN` plays. */
  ownStages: (
    document: VariantDocument,
    packs: readonly string[],
    rank: string,
  ) => readonly string[];
}

/** Every fixed string the two cards draw. Held to the font by `tests/unit/packs.test.ts`. */
export const PACKS_TEXT = Object.freeze({
  packsHeading: 'PACKS',
  stagesHeading: 'STAGES',
  /** Under the pack list, always: the one rule that decides what a mix plays. */
  laterWins: 'LATER PACKS WIN',
  packsKeys: keyLine([KEY.rows, 'MOVE'], [KEY.values, 'SWITCH']),
  stagesKeys: keyLine([KEY.rows, 'MOVE'], [KEY.values, 'CHANGE']),
  /** The same on both cards: keeping is the only way a draft reaches the game. */
  editorDone: keyLine([KEY.ok, 'KEEP'], [KEY.back, 'CANCEL']),
  /**
   * What keeping does, on both cards: over a shipped game it makes a new one —
   * the game itself is never written — and over a variation it changes that.
   */
  keepsNew: 'KEEPING MAKES A NEW GAME',
  keepsYours: 'KEEPING CHANGES YOURS',
  off: 'OFF',
  missing: 'MISSING',
  missingNote: 'NOT INSTALLED IN THIS BUILD',
  rules: 'RULES',
  noStages: 'NO STAGES',
  orderLabel: 'ORDER',
  orderOwn: 'OWN',
  orderMine: 'MINE',
  orderOwnNote: 'AS THE PACKS ORDER THEM',
  orderMineNote: 'YOURS, THEN IT REPEATS',
  addLabel: '+',
  empty: '--',
  emptyNote: 'EMPTY: DROPPED WHEN KEPT',
  addNote: 'ADD A STAGE HERE',
  fullNote: 'THE ORDER IS FULL',
  staleNote: 'NOT IN THESE PACKS',
  /** Prefixed to the headline when `ENTER` was refused, so the press is seen. */
  notKept: 'NOT KEPT:',
});

/** The longest stage order the editor builds. Ours: a list longer than a game. */
export const MAX_STAGE_ORDER = 32;

/** Rows of the stage card on screen at once; the list scrolls past them. */
export const STAGE_WINDOW = 8;

/** Whether two lists hold the same ids in the same order. */
export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => b[index] === id);
}

/** The three lines a verdict draws: its headline, then two of detail. Always three. */
export function verdictLines(verdict: Verdict, refused: boolean): readonly MenuLine[] {
  const [first = '', second = ''] = verdict.details;
  return [
    {
      text: refused ? `${PACKS_TEXT.notKept} ${verdict.headline}` : verdict.headline,
      tone: verdict.ok ? 'accept' : 'refuse',
    },
    { text: first, tone: 'note' },
    { text: second, tone: 'note' },
  ];
}

/* -------------------------------------------------------------------------- */
/* The pack manager                                                            */
/* -------------------------------------------------------------------------- */

/** One row of the pack card: an installed pack, or a stored id that is not. */
export interface PackRow extends CardRow {
  readonly id: string;
  readonly note: string;
}

export interface PackEditorOptions {
  readonly installed: readonly InstalledPack[];
  /** The list the card opens on: the player's stored list, else the variant's own. */
  readonly start: readonly string[];
  /** The game's own list. Keeping exactly this changes nothing. */
  readonly own: readonly string[];
  /** The verdict on a draft. Asked once per distinct draft. */
  readonly judge: (draft: readonly string[]) => Verdict;
  /** True over a shipped game, where keeping makes a new one rather than changing it. */
  readonly makesNew?: boolean;
}

/** What keeping a pack card hands the flow. */
export type PackKeep =
  | {
      readonly kept: true;
      /** The list to store, or `undefined` for "the variant's own". */
      readonly packs: readonly string[] | undefined;
      /** The stored stage order goes too: the card said so first. */
      readonly clearsStages: boolean;
    }
  | { readonly kept: false };

export interface PackEditor {
  /** True over a shipped game, where keeping makes a new one. */
  readonly makesNew: boolean;
  readonly rows: readonly PackRow[];
  readonly index: number;
  readonly row: PackRow;
  /** The list as composed so far, in layering order. */
  readonly draft: readonly string[];
  readonly verdict: Verdict;
  /** True after `ENTER` was refused, until the draft changes. */
  readonly refused: boolean;
  next: () => void;
  previous: () => void;
  /** Switch the pack under the cursor off, or on at the top of the layers. */
  toggle: () => void;
  keep: () => PackKeep;
}

/** What a pack brings to a mix, in a few words: rules, and how many stages. */
function packNote(pack: InstalledPack): string {
  const stages = pack.stages > 0 ? `${String(pack.stages)} STAGES` : PACKS_TEXT.noStages;
  return pack.rules ? `${PACKS_TEXT.rules} + ${stages}` : stages;
}

/**
 * Build the pack card.
 *
 * **The rows stay put and the value is the layer.** Every installed pack is a row
 * in a fixed order; a pack that is on reads its place in the layering — `1` is the
 * base, the highest number wins — and one that is off reads `OFF`. Switching a
 * pack on puts it **on top**, which is the whole of how order is chosen: to move a
 * pack up, switch it off and on again. A stored id this build does not install is
 * a row of its own, reading `MISSING`, so a list written against other packs is
 * readable rather than lost — switching it off drops it, and it cannot come back
 * because there is nothing to switch on.
 */
export function createPackEditor(options: PackEditorOptions): PackEditor {
  const { installed, own, judge, makesNew = false } = options;
  let draft: readonly string[] = [...options.start];
  let index = 0;
  let refused = false;
  const verdicts = new Map<string, Verdict>();

  const verdictOf = (list: readonly string[]): Verdict => {
    const key = list.join('\u0000');
    const known = verdicts.get(key);
    if (known !== undefined) return known;
    const verdict = judge(list);
    verdicts.set(key, verdict);
    return verdict;
  };

  const rowsOf = (): PackRow[] => {
    const known = new Set(installed.map((pack) => pack.id));
    const rows: PackRow[] = installed.map((pack) => {
      const at = draft.indexOf(pack.id);
      return {
        id: pack.id,
        label: pack.name,
        value: at < 0 ? PACKS_TEXT.off : String(at + 1),
        editable: true,
        note: packNote(pack),
      };
    });
    for (const id of draft) {
      if (known.has(id)) continue;
      rows.push({
        id,
        label: id,
        value: PACKS_TEXT.missing,
        editable: true,
        note: PACKS_TEXT.missingNote,
      });
    }
    return rows;
  };

  const clamp = (rows: readonly PackRow[]): number => Math.min(index, Math.max(0, rows.length - 1));

  return {
    makesNew,
    get rows(): readonly PackRow[] {
      return rowsOf();
    },
    get index(): number {
      return clamp(rowsOf());
    },
    get row(): PackRow {
      const rows = rowsOf();
      const row = rows[clamp(rows)];
      if (row === undefined) throw new Error('a pack card with no rows: nothing is installed');
      return row;
    },
    get draft(): readonly string[] {
      return draft;
    },
    get verdict(): Verdict {
      return verdictOf(draft);
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
    toggle: () => {
      const rows = rowsOf();
      const row = rows[clamp(rows)];
      if (row === undefined) return;
      draft = draft.includes(row.id) ? draft.filter((id) => id !== row.id) : [...draft, row.id];
      refused = false;
      // A missing pack's row goes with it, so the cursor must not point past the end.
      index = clamp(rowsOf());
    },
    keep: (): PackKeep => {
      const verdict = verdictOf(draft);
      if (!verdict.ok) {
        refused = true;
        return { kept: false };
      }
      return {
        kept: true,
        packs: sameList(draft, own) ? undefined : draft,
        clearsStages: verdict.clearsStages === true,
      };
    },
  };
}

/** Every line under the pack list, in the order {@link drawPackEditor} draws them. */
export function packEditorNotes(editor: PackEditor): readonly MenuLine[] {
  return [
    { text: editor.row.note, tone: 'note' },
    { text: PACKS_TEXT.laterWins, tone: 'legend' },
    { text: editor.makesNew ? PACKS_TEXT.keepsNew : PACKS_TEXT.keepsYours, tone: 'legend' },
    ...verdictLines(editor.verdict, editor.refused),
    { text: PACKS_TEXT.packsKeys, tone: 'help' },
    { text: PACKS_TEXT.editorDone, tone: 'help' },
  ];
}

/* -------------------------------------------------------------------------- */
/* The stage-sequence editor                                                   */
/* -------------------------------------------------------------------------- */

export type StageRowKind = 'order' | 'stage' | 'add';

/** One row of the stage card. */
export interface StageRow extends CardRow {
  readonly kind: StageRowKind;
  readonly note: string;
  /** The stage id on a `stage` row, `undefined` on an empty one and the others. */
  readonly stage?: string | undefined;
}

export interface StageEditorOptions {
  /** The combat stages a row may name, in menu order. */
  readonly options: readonly StageOption[];
  /** The packs' own order at the rank in force: what `OWN` plays. */
  readonly own: readonly string[];
  /** The player's stored order, if one is stored. */
  readonly stored: readonly string[] | undefined;
  /** The stage number the `position`th combat stage (zero-based) plays as. */
  readonly numberOf: (position: number) => number;
  /** The verdict on a draft: `undefined` is the packs' own order. */
  readonly judge: (draft: readonly string[] | undefined) => Verdict;
  /** True over a shipped game, where keeping makes a new one rather than changing it. */
  readonly makesNew?: boolean;
}

/** What keeping a stage card hands the flow: the order to store, or none. */
export type StageKeep =
  | { readonly kept: true; readonly stages: readonly string[] | undefined }
  | { readonly kept: false };

export interface StageEditor {
  /** True over a shipped game, where keeping makes a new one. */
  readonly makesNew: boolean;
  /** Every row, the `ORDER` row first and the `+` row last. */
  readonly rows: readonly StageRow[];
  readonly index: number;
  readonly row: StageRow;
  /** True when the player's own order is on, false for the packs'. */
  readonly mine: boolean;
  /** The order that would be kept: `undefined` for the packs' own, empties dropped. */
  readonly draft: readonly string[] | undefined;
  readonly verdict: Verdict;
  readonly refused: boolean;
  next: () => void;
  previous: () => void;
  /** Change the row under the cursor: the mode, a stage, or a new one at the end. */
  adjust: (delta: number) => void;
  keep: () => StageKeep;
}

/** A slot the player emptied. Dropped when the order is kept, so rows never jump. */
const EMPTY = '';

/**
 * Build the stage card.
 *
 * **`ORDER` is the first row and decides what the rest mean.** `OWN` shows the
 * packs' own combat order at the rank in force, dim; `MINE` shows the player's,
 * bright. Changing any stage row while it reads `OWN` starts `MINE` from the
 * packs' order with that one change, so the order on screen is always the one
 * being edited; switching back to `OWN` is how a stored order is dropped.
 *
 * **A row cycles through every combat stage the packs hold, then empty.** An
 * emptied row stays on screen as `--` until the order is kept, so the list never
 * moves under the cursor; the `+` row at the end appends. Each stage row's note
 * says which stage number it plays as, because the challenge stages take their
 * own numbers and row 3 is not stage 3 (`docs/content-guide.md` section 7.5).
 */
export function createStageEditor(options: StageEditorOptions): StageEditor {
  const { options: choices, own, numberOf, judge, makesNew = false } = options;
  let mine = options.stored !== undefined;
  let order: string[] = [...(options.stored ?? own)];
  let index = 0;
  let refused = false;
  const verdicts = new Map<string, Verdict>();
  const packOf = new Map(choices.map((choice) => [choice.id, choice.pack]));

  const draftOf = (): readonly string[] | undefined =>
    mine ? order.filter((id) => id !== EMPTY) : undefined;

  const verdictOf = (draft: readonly string[] | undefined): Verdict => {
    const key = draft === undefined ? '\u0001own' : draft.join('\u0000');
    const known = verdicts.get(key);
    if (known !== undefined) return known;
    const verdict = judge(draft);
    verdicts.set(key, verdict);
    return verdict;
  };

  const rowsOf = (): StageRow[] => {
    const listed = mine ? order : own;
    const rows: StageRow[] = [
      {
        kind: 'order',
        label: PACKS_TEXT.orderLabel,
        value: mine ? PACKS_TEXT.orderMine : PACKS_TEXT.orderOwn,
        editable: true,
        note: mine ? PACKS_TEXT.orderMineNote : PACKS_TEXT.orderOwnNote,
      },
    ];
    listed.forEach((id, position) => {
      const pack = packOf.get(id);
      const note =
        id === EMPTY
          ? PACKS_TEXT.emptyNote
          : pack === undefined
            ? PACKS_TEXT.staleNote
            : `STAGE ${String(numberOf(position))}, FROM ${pack}`;
      rows.push({
        kind: 'stage',
        label: String(position + 1),
        value: id === EMPTY ? PACKS_TEXT.empty : id,
        editable: mine,
        note,
        stage: id === EMPTY ? undefined : id,
      });
    });
    const full = listed.length >= MAX_STAGE_ORDER;
    rows.push({
      kind: 'add',
      label: PACKS_TEXT.addLabel,
      value: PACKS_TEXT.empty,
      editable: mine && !full,
      note: full ? PACKS_TEXT.fullNote : PACKS_TEXT.addNote,
    });
    return rows;
  };

  const clamp = (rows: readonly StageRow[]): number =>
    Math.min(index, Math.max(0, rows.length - 1));

  /** Start the player's order from the packs', if it is not already theirs. */
  const takeOver = (): void => {
    if (mine) return;
    mine = true;
    order = [...own];
  };

  const adjust = (delta: number): void => {
    const rows = rowsOf();
    const at = clamp(rows);
    const row = rows[at];
    if (row === undefined || delta === 0) return;
    refused = false;
    switch (row.kind) {
      case 'order': {
        // Back and forth keeps the player's edits: switching to `OWN` only sets
        // them aside until switched back, or until the card is cancelled.
        mine = !mine;
        if (mine && order.length === 0) order = [...own];
        break;
      }
      case 'stage': {
        takeOver();
        const position = at - 1;
        const ids = [...choices.map((choice) => choice.id), EMPTY];
        const current = ids.indexOf(order[position] ?? EMPTY);
        const next =
          current < 0 ? (delta > 0 ? 0 : ids.length - 1) : cycle(current, delta, ids.length);
        order[position] = ids[next] ?? EMPTY;
        break;
      }
      case 'add': {
        takeOver();
        if (order.length >= MAX_STAGE_ORDER) break;
        const first = choices[0];
        const last = choices[choices.length - 1];
        const added = delta > 0 ? first : last;
        if (added !== undefined) order.push(added.id);
        break;
      }
    }
  };

  return {
    makesNew,
    get rows(): readonly StageRow[] {
      return rowsOf();
    },
    get index(): number {
      return clamp(rowsOf());
    },
    get row(): StageRow {
      const rows = rowsOf();
      const row = rows[clamp(rows)];
      if (row === undefined) throw new Error('a stage card always has its ORDER row');
      return row;
    },
    get mine(): boolean {
      return mine;
    },
    get draft(): readonly string[] | undefined {
      return draftOf();
    },
    get verdict(): Verdict {
      return verdictOf(draftOf());
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
    adjust,
    keep: (): StageKeep => {
      const draft = draftOf();
      if (!verdictOf(draft).ok) {
        refused = true;
        return { kept: false };
      }
      return { kept: true, stages: draft };
    },
  };
}

/** Every line under the stage list, in the order {@link drawStageEditor} draws them. */
export function stageEditorNotes(editor: StageEditor): readonly MenuLine[] {
  return [
    { text: editor.row.note, tone: 'note' },
    { text: editor.makesNew ? PACKS_TEXT.keepsNew : PACKS_TEXT.keepsYours, tone: 'legend' },
    ...verdictLines(editor.verdict, editor.refused),
    { text: PACKS_TEXT.stagesKeys, tone: 'help' },
    { text: PACKS_TEXT.editorDone, tone: 'help' },
  ];
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                     */
/* -------------------------------------------------------------------------- */

/** Both cards are the settings card's width, and open where it sits. */
export const EDITOR_CARD_WIDTH = 216;

export interface EditorScreenOptions<E> {
  readonly editor: E;
  readonly steps: number;
  readonly x: number;
  readonly y: number;
}

/** Draw the pack manager. */
export function drawPackEditor(
  ctx: CanvasRenderingContext2D,
  options: EditorScreenOptions<PackEditor>,
): void {
  const { editor, steps, x, y } = options;
  drawRowCard(ctx, {
    heading: PACKS_TEXT.packsHeading,
    rows: editor.rows,
    index: editor.index,
    lines: packEditorNotes(editor),
    steps,
    x,
    y,
    width: EDITOR_CARD_WIDTH,
  });
}

/**
 * Draw the stage-sequence editor: a window of {@link STAGE_WINDOW} rows over the
 * order, and a plate that height however short the order is, so the card does
 * not grow under the player as rows are added.
 */
export function drawStageEditor(
  ctx: CanvasRenderingContext2D,
  options: EditorScreenOptions<StageEditor>,
): void {
  const { editor, steps, x, y } = options;
  const view = windowOf(editor.rows, editor.index, STAGE_WINDOW);
  drawRowCard(ctx, {
    heading: PACKS_TEXT.stagesHeading,
    rows: view.rows,
    index: view.index,
    height: STAGE_WINDOW,
    lines: stageEditorNotes(editor),
    more: { above: view.above, below: view.below },
    steps,
    x,
    y,
    width: EDITOR_CARD_WIDTH,
  });
}
