/**
 * The high-score table and its initials entry (docs/DESIGN.md section 4, "Game
 * flow": "High-score table with 3-letter initials, stored locally").
 *
 * Two halves, and the split is the point:
 *
 * - {@link HighScoreStorage} is the whole of what this module knows about
 *   persistence: two methods over a string. `localStorage` is not available in
 *   every browser state — a private window, blocked site data, a cookie policy
 *   that makes the *property access itself* throw — and a blocked storage API
 *   must never take the game down. So the board is built over an interface, the
 *   browser implementation catches on every path, and the fallback is an
 *   in-memory table that behaves identically for one session.
 * - {@link HighScoreBoard} is ordering and insertion, and knows nothing about
 *   where the bytes go. It is therefore testable on the Node environment that
 *   `tests/unit/` runs, without a DOM.
 *
 * Entry uses the four actions the game already has (`src/engine/input.ts`):
 * left/right walk the alphabet, fire commits a letter. The original walks the
 * letters with the stick's vertical axis, which this cabinet does not have.
 */

import { drawText, measureText } from '../render/text.js';
import { drawCentredPanel } from './panel.js';

/** One row of the table. */
export interface HighScoreEntry {
  /** Exactly {@link INITIALS_LENGTH} characters from {@link INITIALS_ALPHABET}. */
  readonly initials: string;
  readonly score: number;
  /** Stage reached. Presentation only; the ordering never looks at it. */
  readonly stage: number;
}

/** Rows the table holds. Ours, not an arcade value. */
export const HIGH_SCORE_CAPACITY = 5;

/** Letters an entry is made of. */
export const INITIALS_LENGTH = 3;

/**
 * The alphabet the stick walks. A–Z plus two marks, all of which the pixel font
 * in `src/render/text.ts` can draw.
 */
export const INITIALS_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';

/** Key the browser implementation stores under. */
export const STORAGE_KEY = 'star-swarm/high-scores/v1';

/**
 * The table a machine ships with, so the attract screen has something to show
 * and the first run has something to beat. Ours — the original's factory table
 * is not in `docs/reference/arcade-reference.md`, so these are provisional and
 * a pack may one day supply them (see the seam note in `src/ui/README.md`).
 */
export const DEFAULT_HIGH_SCORES: readonly HighScoreEntry[] = Object.freeze([
  { initials: 'AAA', score: 30_000, stage: 12 },
  { initials: 'BBB', score: 20_000, stage: 9 },
  { initials: 'CCC', score: 15_000, stage: 7 },
  { initials: 'DDD', score: 10_000, stage: 5 },
  { initials: 'EEE', score: 5_000, stage: 3 },
]);

/**
 * Everything the board needs from a place to keep bytes.
 *
 * Neither method may throw: an implementation that cannot read says so by
 * returning `undefined`, and one that cannot write says so by returning `false`.
 */
export interface HighScoreStorage {
  /** The stored document, or `undefined` when there is none or it is unreadable. */
  load: () => string | undefined;
  /** Persist. `false` means the write did not stick; the caller carries on. */
  save: (text: string) => boolean;
  /** False for the in-memory fallback, so the UI can say the table is session-only. */
  readonly persistent: boolean;
}

/** The slice of the Web Storage API this needs. */
export interface WebStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/** A table that lives as long as the tab. The fallback, and useful in tests. */
export function createMemoryStorage(initial?: string): HighScoreStorage {
  let held: string | undefined = initial;
  return {
    load: () => held,
    save(text: string): boolean {
      held = text;
      return true;
    },
    persistent: false,
  };
}

export interface WebStorageOptions {
  readonly key?: string;
  /**
   * How to reach the store. Called on every access rather than once, because a
   * browser can revoke it between calls. Defaults to `globalThis.localStorage`,
   * read inside a `try` — reading the property is itself what throws when site
   * data is blocked.
   */
  readonly resolve?: () => WebStorageLike | undefined;
}

function defaultResolve(): WebStorageLike | undefined {
  try {
    const store: unknown = (globalThis as { localStorage?: unknown }).localStorage;
    if (store === null || store === undefined) return undefined;
    const candidate = store as Partial<WebStorageLike>;
    if (typeof candidate.getItem !== 'function' || typeof candidate.setItem !== 'function') {
      return undefined;
    }
    return candidate as WebStorageLike;
  } catch {
    return undefined;
  }
}

/**
 * Browser-backed storage that degrades instead of throwing.
 *
 * If the store is missing or any call throws, this falls back to an in-memory
 * table for the rest of the session and reports `persistent: false`. The game
 * keeps its high scores for as long as the tab lives and never sees an error.
 */
export function createWebStorage(options: WebStorageOptions = {}): HighScoreStorage {
  const { key = STORAGE_KEY, resolve = defaultResolve } = options;
  const fallback = createMemoryStorage();
  let usable = resolve() !== undefined;

  return {
    load(): string | undefined {
      // Once anything has failed, the in-memory table is the newer of the two:
      // it took every write the browser refused, so it is what to read back.
      if (!usable) return fallback.load();
      const store = resolve();
      if (store === undefined) {
        usable = false;
        return fallback.load();
      }
      try {
        return store.getItem(key) ?? fallback.load();
      } catch {
        usable = false;
        return fallback.load();
      }
    },

    save(text: string): boolean {
      fallback.save(text);
      if (!usable) return false;
      const store = resolve();
      if (store === undefined) {
        usable = false;
        return false;
      }
      try {
        store.setItem(key, text);
        return true;
      } catch {
        // A quota error or a blocked write: the session keeps its table, the
        // next run does not.
        usable = false;
        return false;
      }
    },

    get persistent(): boolean {
      return usable;
    },
  };
}

/** The document shape on disk. Bumped if the shape ever changes. */
const DOCUMENT_VERSION = 1;

interface StoredDocument {
  readonly version: number;
  readonly entries: readonly HighScoreEntry[];
}

/** Coerce anything to a legal row, or reject it. Storage is untrusted input. */
function parseEntry(value: unknown): HighScoreEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const row = value as Partial<Record<keyof HighScoreEntry, unknown>>;
  if (typeof row.initials !== 'string') return undefined;
  if (typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0) {
    return undefined;
  }
  const stage = typeof row.stage === 'number' && Number.isFinite(row.stage) ? row.stage : 0;
  return {
    initials: normaliseInitials(row.initials),
    score: Math.trunc(row.score),
    stage: Math.max(0, Math.trunc(stage)),
  };
}

/** Read a stored table. Anything unreadable or corrupt reads as "no table". */
export function parseHighScores(text: string | undefined): HighScoreEntry[] | undefined {
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const document = parsed as Partial<StoredDocument>;
  if (document.version !== DOCUMENT_VERSION || !Array.isArray(document.entries)) return undefined;

  const entries: HighScoreEntry[] = [];
  for (const row of document.entries) {
    const entry = parseEntry(row);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}

/** Pad, upper-case and clamp initials to the table's fixed width. */
export function normaliseInitials(initials: string): string {
  const letters = [...initials.toUpperCase()]
    .map((letter) => (INITIALS_ALPHABET.includes(letter) ? letter : '.'))
    .slice(0, INITIALS_LENGTH);
  while (letters.length < INITIALS_LENGTH) letters.push('.');
  return letters.join('');
}

/**
 * Sort rows into table order: score descending, and an existing row stays ahead
 * of a later one with the same score. That tie rule is what makes "you have to
 * *beat* the bottom score to qualify" true rather than approximately true.
 */
function sorted(entries: readonly HighScoreEntry[]): HighScoreEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.score - a.entry.score || a.index - b.index)
    .map(({ entry }) => entry);
}

export interface HighScoreBoard {
  readonly capacity: number;
  /** False when the table is session-only because storage is unavailable. */
  readonly persistent: boolean;
  /** The table, best first. */
  entries: () => readonly HighScoreEntry[];
  /** The top score, or 0 on an empty table. What the HUD shows. */
  best: () => number;
  /** Where a score would land, or `undefined` if it would not make the table. */
  rankFor: (score: number) => number | undefined;
  qualifies: (score: number) => boolean;
  /** Insert and persist. Returns the rank taken, or `undefined` if it did not qualify. */
  submit: (initials: string, score: number, stage?: number) => number | undefined;
}

export interface HighScoreBoardOptions {
  readonly storage?: HighScoreStorage;
  readonly capacity?: number;
  /** Table used when storage holds nothing. Defaults to {@link DEFAULT_HIGH_SCORES}. */
  readonly defaults?: readonly HighScoreEntry[];
}

/**
 * Build the board.
 *
 * Reads once at construction: the table changes only through {@link
 * HighScoreBoard.submit}, so nothing here re-reads storage per frame.
 */
export function createHighScoreBoard(options: HighScoreBoardOptions = {}): HighScoreBoard {
  const {
    storage = createMemoryStorage(),
    capacity = HIGH_SCORE_CAPACITY,
    defaults = DEFAULT_HIGH_SCORES,
  } = options;

  const stored = parseHighScores(storage.load());
  let table = sorted(stored ?? defaults).slice(0, capacity);

  const persist = (): void => {
    const document: StoredDocument = { version: DOCUMENT_VERSION, entries: table };
    storage.save(JSON.stringify(document));
  };

  const rankFor = (score: number): number | undefined => {
    if (!Number.isFinite(score) || score <= 0) return undefined;
    const target = Math.trunc(score);
    const index = table.findIndex((entry) => target > entry.score);
    if (index >= 0) return index;
    return table.length < capacity ? table.length : undefined;
  };

  return {
    capacity,

    get persistent(): boolean {
      return storage.persistent;
    },

    entries: () => table,
    best: () => table[0]?.score ?? 0,
    rankFor,
    qualifies: (score) => rankFor(score) !== undefined,

    submit(initials, score, stage = 0): number | undefined {
      const rank = rankFor(score);
      if (rank === undefined) return undefined;
      const entry: HighScoreEntry = {
        initials: normaliseInitials(initials),
        score: Math.trunc(score),
        stage: Math.max(0, Math.trunc(stage)),
      };
      const next = [...table];
      next.splice(rank, 0, entry);
      table = next.slice(0, capacity);
      persist();
      return rank;
    },
  };
}

/**
 * Initials being entered, one letter at a time.
 *
 * A value with a cursor rather than a widget: the flow calls the three verbs
 * when it sees the matching input edge, and the screen draws {@link
 * InitialsEntry.letters}. That keeps entry testable without a key event.
 */
export interface InitialsEntry {
  readonly letters: readonly string[];
  /** Which letter the stick is on. Equals {@link INITIALS_LENGTH} once done. */
  readonly index: number;
  readonly done: boolean;
  /** The three letters as a string, whether or not entry has finished. */
  readonly value: string;
  /** Walk the alphabet backwards, wrapping. */
  previous: () => void;
  /** Walk the alphabet forwards, wrapping. */
  next: () => void;
  /** Accept the letter under the cursor and move on. */
  commit: () => void;
}

export interface InitialsEntryOptions {
  readonly alphabet?: string;
  readonly length?: number;
  /** Letter every position starts on. Defaults to the first of the alphabet. */
  readonly initial?: string;
}

export function createInitialsEntry(options: InitialsEntryOptions = {}): InitialsEntry {
  const { alphabet = INITIALS_ALPHABET, length = INITIALS_LENGTH } = options;
  const first = options.initial ?? alphabet[0] ?? 'A';
  const cursors = Array.from({ length }, () => Math.max(0, alphabet.indexOf(first)));
  let index = 0;

  const move = (delta: number): void => {
    if (index >= length) return;
    const at = cursors[index] ?? 0;
    cursors[index] = (at + delta + alphabet.length) % alphabet.length;
  };

  return {
    get letters(): readonly string[] {
      return cursors.map((cursor) => alphabet[cursor] ?? '.');
    },
    get index(): number {
      return index;
    },
    get done(): boolean {
      return index >= length;
    },
    get value(): string {
      return cursors.map((cursor) => alphabet[cursor] ?? '.').join('');
    },
    previous: () => {
      move(-1);
    },
    next: () => {
      move(1);
    },
    commit: () => {
      if (index < length) index += 1;
    },
  };
}

/** Score column width, in characters, for the table layouts below. */
const SCORE_WIDTH = 6;

/** `  12340` — right-aligned in a fixed column so the table reads as a column. */
export function formatTableScore(score: number): string {
  return String(Math.max(0, Math.trunc(score))).padStart(SCORE_WIDTH, ' ');
}

export interface HighScoreTableOptions {
  /** Top of the block, in logical pixels. */
  readonly y: number;
  /** Centre of the block. */
  readonly x: number;
  readonly headingColour?: string;
  readonly colour?: string;
  /** Rank to draw in the highlight colour — the row just entered. */
  readonly highlight?: number;
  readonly highlightColour?: string;
  readonly heading?: string;
}

/** Row pitch, in logical pixels: one 8-px cell plus two of air. */
const ROW_PITCH = 10;

/**
 * Draw the table centred on `x`.
 *
 * Laid out from a measured width rather than magic columns, so a change to the
 * font's glyph pitch moves rank, initials and score together.
 */
export function drawHighScoreTable(
  ctx: CanvasRenderingContext2D,
  entries: readonly HighScoreEntry[],
  options: HighScoreTableOptions,
): void {
  const {
    x,
    y,
    heading = 'HIGH SCORES',
    headingColour = '#ff2b2b',
    colour = '#ffffff',
    highlight,
    highlightColour = '#ffd400',
  } = options;

  drawText(ctx, heading, x, y, { colour: headingColour, align: 'center' });

  const rowText = (rank: number, entry: HighScoreEntry): string =>
    `${String(rank + 1)}  ${entry.initials}  ${formatTableScore(entry.score)}`;
  const width = Math.max(
    ...entries.map((entry, rank) => measureText(rowText(rank, entry))),
    measureText('1  AAA  000000'),
  );
  const left = Math.round(x - width / 2);

  entries.forEach((entry, rank) => {
    drawText(ctx, rowText(rank, entry), left, y + ROW_PITCH + rank * ROW_PITCH, {
      colour: rank === highlight ? highlightColour : colour,
    });
  });
}

export interface InitialsScreenOptions {
  readonly score: number;
  readonly rank: number;
  readonly entry: InitialsEntry;
  /** Flow steps elapsed, for the cursor blink. */
  readonly steps: number;
  readonly x: number;
  readonly y: number;
}

/** Blink period of the letter under the cursor, in simulation steps. */
export const CURSOR_BLINK_STEPS = 20;

/** The plate the entry screen sits on, in logical pixels. */
const ENTRY_CARD_WIDTH = 200;
const ENTRY_CARD_HEIGHT = 80;

/** Draw the "enter your initials" screen. */
export function drawInitialsEntry(
  ctx: CanvasRenderingContext2D,
  options: InitialsScreenOptions,
): void {
  const { score, rank, entry, steps, x, y } = options;

  drawCentredPanel(ctx, x, y - 6, ENTRY_CARD_WIDTH, ENTRY_CARD_HEIGHT);
  drawText(ctx, 'ENTER YOUR INITIALS', x, y + 4, { colour: '#ff2b2b', align: 'center' });
  drawText(ctx, `RANK ${String(rank + 1)}   SCORE ${String(score)}`, x, y + 18, {
    colour: '#b9c9ff',
    align: 'center',
  });

  // One glyph cell per letter, with the cursor blinking on the live one.
  const letters = entry.letters;
  const pitch = 16;
  const left = Math.round(x - ((letters.length - 1) * pitch) / 2);
  const lit = Math.floor(steps / CURSOR_BLINK_STEPS) % 2 === 0;

  letters.forEach((letter, index) => {
    const live = index === entry.index;
    const colour = live ? (lit ? '#ffd400' : '#7d8aa8') : '#ffffff';
    drawText(ctx, letter, left + index * pitch, y + 38, { colour, align: 'center' });
    if (live) {
      ctx.fillStyle = colour;
      ctx.fillRect(left + index * pitch - 4, y + 48, 8, 1);
    }
  });

  drawText(ctx, 'L/R  PICK   FIRE  ENTER', x, y + 60, {
    colour: '#7d8aa8',
    align: 'center',
  });
}
