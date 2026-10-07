/**
 * A player's variation, out of this machine and into another: the export and
 * import cards, and the text that crosses between them.
 *
 * **The text is the document.** A variation is stored as a whole variant
 * document (`./settings.ts`), the shape of `variants/<id>.json`, so exporting one
 * is writing that document as JSON — formatted the way the shipped ones are —
 * and nothing else: no envelope, no version field, no checksum. An exported
 * variation and a shipped variant are the same kind of thing, and a file in
 * `variants/` pasted into the import card is read exactly as an exported
 * variation is.
 *
 * **How the text travels.** The page has no server, so the text reaches the
 * player through the one thing every browser has: a text box. The export card
 * puts the document in a box, selected, and `ENTER` copies it to the clipboard
 * where the browser allows that — and where it does not, the selected text is
 * one `CTRL+C` away. The import card opens an empty box to paste into. Between
 * the two machines the text goes however the player moves text: an email, a
 * chat message, a note. The box itself is `./text-port.ts`, driven by
 * `src/main.ts`; this file holds no DOM, so both cards are tested on Node.
 *
 * **An import is untrusted input**, and it is judged by nothing of its own. Read
 * here only far enough to be a document at all — JSON, an object, not absurdly
 * long — and then handed to the composer (`./compose.ts`): the loader's two
 * passes with the duplicate-id rule held against the shipped games, then the
 * structural half of the playability pass. That is the check every variant in
 * `variants/` and every variation the pack manager keeps is held to, so there is
 * no weaker way in. A document naming a pack this build does not install is
 * refused there, with the pack's id on the card.
 *
 * What the flow adds (`./flow.ts`) is the store's half: an imported document
 * whose id a stored variation already has is given a fresh one, never written
 * over the variation that has it, and every import is kept through the naming
 * card, which refuses a name another game already has. A shipped game's id is
 * the loader's to refuse, so an import can never stand in for a reference game.
 */

import { drawText } from '../render/text.js';
import { isVariantDocument, type VariantDocument } from '../content/variants.js';
import { KEY, keyLine } from './keys.js';
import { cardHeight, fitText, MENU_BLINK_STEPS, MENU_INK, type MenuLine } from './menus.js';
import type { Verdict } from './packs.js';
import { drawCentredPanel } from './panel.js';

/**
 * The longest text the import card reads, in characters. A shipped variant
 * document is under three thousand; this is a bound on pasting a whole book into
 * the box, not a rule about games.
 */
export const IMPORT_TEXT_LIMIT = 65536;

/** Every fixed string the two cards draw. Held to the font by `tests/unit/exchange.test.ts`. */
export const EXCHANGE_TEXT = Object.freeze({
  exportHeading: 'EXPORT GAME',
  importHeading: 'IMPORT GAME',
  /** Where the text is, on each card. */
  exportWhere: 'ITS TEXT IS IN THE BOX',
  exportHow: 'COPY IT, SEND IT ANYWHERE',
  importWhere: 'PASTE A GAME IN THE BOX',
  importHow: 'CTRL+V OR CMD+V PASTES',
  /** What `ENTER` did on the export card. */
  copied: 'COPIED TO THE CLIPBOARD',
  notCopied: 'SELECT IT AND COPY IT',
  /** What the import card says about a text that is not yet a document. */
  waiting: 'NOTHING PASTED YET',
  wontImport: 'WILL NOT IMPORT',
  notJson: 'IT IS NOT JSON',
  tooLong: 'IT IS TOO LONG',
  notDocument: 'IT IS NOT A GAME DOCUMENT',
  exportKeys: keyLine([KEY.ok, 'COPIES'], [KEY.back, 'BACK']),
  importKeys: keyLine([KEY.ok, 'IMPORTS'], [KEY.back, 'BACK']),
});

/**
 * A variation as text: the document, two-space indented with a closing newline,
 * as the shipped `variants/<id>.json` files are.
 */
export function exportText(document: VariantDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** What reading a pasted text found: a document to judge, or why there is none. */
export type ImportRead =
  | { readonly ok: true; readonly document: VariantDocument }
  | { readonly ok: false; readonly verdict: Verdict };

const refused = (detail: string): ImportRead => ({
  ok: false,
  verdict: { ok: false, headline: EXCHANGE_TEXT.wontImport, details: [detail] },
});

/**
 * Read a pasted text as far as being a document: within the limit, JSON, and an
 * object. Whether that document is a game this build can play is the composer's
 * question, not this one's.
 */
export function readImport(text: string): ImportRead {
  if (text.length > IMPORT_TEXT_LIMIT) return refused(EXCHANGE_TEXT.tooLong);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refused(EXCHANGE_TEXT.notJson);
  }
  if (!isVariantDocument(parsed)) return refused(EXCHANGE_TEXT.notDocument);
  return { ok: true, document: parsed };
}

/* -------------------------------------------------------------------------- */
/* The export card                                                             */
/* -------------------------------------------------------------------------- */

/** Whether `ENTER` has copied the text: not yet asked, asked, done, or refused by the browser. */
export type CopyState = 'idle' | 'asked' | 'copied' | 'failed';

/**
 * The export card: the text, and whether it has been copied.
 *
 * The clipboard is the browser's, so the card cannot copy anything: `ENTER`
 * {@link ExportCard.ask}s, `src/main.ts` {@link ExportCard.take}s the request and
 * reports back with {@link ExportCard.settle}, and the card says what happened.
 */
export interface ExportCard {
  /** The variation's name, said on the card so the player knows what they are sending. */
  readonly name: string;
  readonly text: string;
  readonly copy: CopyState;
  /** `ENTER`: ask for the text to be copied. */
  ask: () => void;
  /** True once per {@link ask}, for whoever owns the clipboard. */
  take: () => boolean;
  settle: (copied: boolean) => void;
}

export function createExportCard(name: string, document: VariantDocument): ExportCard {
  const text = exportText(document);
  let copy: CopyState = 'idle';
  let asked = false;
  return {
    name,
    text,
    get copy(): CopyState {
      return copy;
    },
    ask: () => {
      asked = true;
      copy = 'asked';
    },
    take: () => {
      const was = asked;
      asked = false;
      return was;
    },
    settle: (copied) => {
      copy = copied ? 'copied' : 'failed';
    },
  };
}

/** Every line under the name on the export card, in the order it is drawn. */
export function exportNotes(card: ExportCard): readonly MenuLine[] {
  const status =
    card.copy === 'copied'
      ? { text: EXCHANGE_TEXT.copied, tone: 'accept' as const }
      : card.copy === 'failed'
        ? { text: EXCHANGE_TEXT.notCopied, tone: 'refuse' as const }
        : { text: '', tone: 'note' as const };
  return [
    { text: EXCHANGE_TEXT.exportWhere, tone: 'note' },
    { text: EXCHANGE_TEXT.exportHow, tone: 'legend' },
    status,
    { text: EXCHANGE_TEXT.exportKeys, tone: 'help' },
  ];
}

/* -------------------------------------------------------------------------- */
/* The import card                                                             */
/* -------------------------------------------------------------------------- */

/** What the flow makes of one document: the verdict, and the game it would be. */
export interface ImportJudgement {
  readonly verdict: Verdict;
  /** The document as it would be kept — re-addressed when its id was taken — when it may be. */
  readonly document: VariantDocument | undefined;
  /** The name it carries, for the card. */
  readonly name: string;
}

/**
 * The import card: the text pasted so far, and what it is.
 *
 * Judged when the text changes rather than on `ENTER`, so the card says whether
 * a game will import before the player asks — the way the pack manager's verdict
 * is on its card before `ENTER` keeps a list.
 */
export interface ImportCard {
  readonly text: string;
  /** `undefined` until something is pasted. */
  readonly judgement: ImportJudgement | undefined;
  /** The text in the box changed. */
  offer: (text: string) => void;
}

export function createImportCard(
  judge: (document: VariantDocument) => ImportJudgement,
): ImportCard {
  let text = '';
  let judgement: ImportJudgement | undefined;
  return {
    get text(): string {
      return text;
    },
    get judgement(): ImportJudgement | undefined {
      return judgement;
    },
    offer: (next) => {
      if (next === text) return;
      text = next;
      if (next.trim().length === 0) {
        judgement = undefined;
        return;
      }
      const read = readImport(next);
      judgement = read.ok
        ? judge(read.document)
        : { verdict: read.verdict, document: undefined, name: '' };
    },
  };
}

/** Every line under the name on the import card, in the order it is drawn. */
export function importNotes(card: ImportCard): readonly MenuLine[] {
  const judgement = card.judgement;
  const verdict: readonly MenuLine[] =
    judgement === undefined
      ? [
          { text: EXCHANGE_TEXT.waiting, tone: 'note' },
          { text: '', tone: 'note' },
          { text: '', tone: 'note' },
        ]
      : [
          {
            text: judgement.verdict.headline,
            tone: judgement.verdict.ok ? 'accept' : 'refuse',
          },
          { text: judgement.verdict.details[0] ?? '', tone: 'note' },
          { text: judgement.verdict.details[1] ?? '', tone: 'note' },
        ];
  return [
    ...verdict,
    { text: EXCHANGE_TEXT.importHow, tone: 'legend' },
    { text: EXCHANGE_TEXT.importKeys, tone: 'help' },
  ];
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                     */
/* -------------------------------------------------------------------------- */

const HEADING_COLOUR = '#ff2b2b';
const VALUE_COLOUR = '#ffffff';
const CURSOR_COLOUR = '#ffd400';

/** Matches `./menus.ts`: a card's rows and its lines share a pitch. */
const ROW_PITCH = 10;
const HEADING_GAP = 16;
const PADDING = 8;

/** Both cards are the settings card's width, and open where it sits. */
export const EXCHANGE_CARD_WIDTH = 216;

/** Characters across the card, inside its padding. */
const CARD_CELLS = Math.floor((EXCHANGE_CARD_WIDTH - PADDING * 2) / 8);

export interface ExchangeCardOptions {
  readonly steps: number;
  readonly x: number;
  readonly y: number;
}

/** One card: a heading, one value line, then its notes. */
function drawCard(
  ctx: CanvasRenderingContext2D,
  heading: string,
  value: string,
  lines: readonly MenuLine[],
  options: ExchangeCardOptions,
): void {
  const { steps, x, y } = options;
  drawCentredPanel(ctx, x, y - 6, EXCHANGE_CARD_WIDTH, cardHeight(1, lines.length));
  drawText(ctx, heading, x, y + 4, { colour: HEADING_COLOUR, align: 'center' });
  const lit = Math.floor(steps / MENU_BLINK_STEPS) % 2 === 0;
  const top = y + HEADING_GAP + 4;
  drawText(ctx, fitText(value, CARD_CELLS), x, top, {
    colour: lit ? CURSOR_COLOUR : VALUE_COLOUR,
    align: 'center',
  });
  let line = top + ROW_PITCH + 4;
  for (const { text, tone } of lines) {
    drawText(ctx, fitText(text, CARD_CELLS), x, line, { colour: MENU_INK[tone], align: 'center' });
    line += ROW_PITCH;
  }
}

/** Draw the export card: the variation's name, where its text is, and what `ENTER` did. */
export function drawExportCard(
  ctx: CanvasRenderingContext2D,
  card: ExportCard,
  options: ExchangeCardOptions,
): void {
  drawCard(ctx, EXCHANGE_TEXT.exportHeading, card.name, exportNotes(card), options);
}

/** Draw the import card: the pasted game's name, and its verdict. */
export function drawImportCard(
  ctx: CanvasRenderingContext2D,
  card: ImportCard,
  options: ExchangeCardOptions,
): void {
  drawCard(
    ctx,
    EXCHANGE_TEXT.importHeading,
    card.judgement?.name ?? '',
    importNotes(card),
    options,
  );
}
