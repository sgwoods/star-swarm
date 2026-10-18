import { describe, expect, it } from 'vitest';

import {
  createHighScoreBoard,
  createHighScoreBook,
  createInitialsEntry,
  DEFAULT_HIGH_SCORES,
  formatTableScore,
  HIGH_SCORE_CAPACITY,
  HIGH_SCORE_STORAGE_KEY,
  type HighScoreEntry,
  INITIALS_ALPHABET,
  normaliseInitials,
  parseHighScores,
} from '../../src/ui/highscores.js';
import {
  createMemoryStorage,
  createWebStorage,
  type KeyedStorage,
  type WebStorageLike,
} from '../../src/ui/storage.js';

/** A table with room to spare, so insertion is visible without truncation. */
const TABLE: readonly HighScoreEntry[] = [
  { initials: 'AAA', score: 10_000, stage: 5 },
  { initials: 'BBB', score: 5_000, stage: 3 },
];

function boardWith(entries: readonly HighScoreEntry[], capacity = 5) {
  return createHighScoreBoard({ storage: createMemoryStorage(), defaults: entries, capacity });
}

describe('the high-score table', () => {
  it('orders by score, best first', () => {
    const board = boardWith([
      { initials: 'LOW', score: 100, stage: 1 },
      { initials: 'TOP', score: 900, stage: 4 },
      { initials: 'MID', score: 500, stage: 2 },
    ]);
    expect(board.entries().map((entry) => entry.initials)).toEqual(['TOP', 'MID', 'LOW']);
    expect(board.best()).toBe(900);
  });

  it('reports the rank a score would take', () => {
    const board = boardWith(TABLE, 5);
    expect(board.rankFor(20_000)).toBe(0);
    expect(board.rankFor(7_000)).toBe(1);
    expect(board.rankFor(1)).toBe(2);
  });

  it('inserts at that rank and pushes the rest down', () => {
    const board = boardWith(TABLE, 5);
    expect(board.submit('ZZZ', 7_000, 4)).toBe(1);
    expect(board.entries().map((entry) => entry.initials)).toEqual(['AAA', 'ZZZ', 'BBB']);
    expect(board.entries()[1]).toEqual({ initials: 'ZZZ', score: 7_000, stage: 4 });
  });

  it('keeps the table at its capacity, dropping the worst row', () => {
    const board = boardWith(DEFAULT_HIGH_SCORES, HIGH_SCORE_CAPACITY);
    expect(board.entries()).toHaveLength(HIGH_SCORE_CAPACITY);
    board.submit('NEW', 999_999, 40);
    expect(board.entries()).toHaveLength(HIGH_SCORE_CAPACITY);
    expect(board.entries()[0]?.initials).toBe('NEW');
    expect(board.entries().some((entry) => entry.score === 5_000)).toBe(false);
  });

  it('takes a score only when it beats the bottom of a full table', () => {
    const board = boardWith(TABLE, 2);
    expect(board.qualifies(5_001)).toBe(true);
    // A tie does not displace the row that got there first.
    expect(board.qualifies(5_000)).toBe(false);
    expect(board.submit('TIE', 5_000)).toBeUndefined();
    expect(board.entries().map((entry) => entry.initials)).toEqual(['AAA', 'BBB']);
  });

  it('never takes a zero score, however empty the table is', () => {
    const board = boardWith([], 5);
    expect(board.qualifies(0)).toBe(false);
    expect(board.submit('AAA', 0)).toBeUndefined();
    expect(board.entries()).toEqual([]);
    expect(board.best()).toBe(0);
  });

  it('places an equal score above a later one, so ties keep their order', () => {
    const board = boardWith([], 5);
    board.submit('ONE', 1_000);
    board.submit('TWO', 1_000);
    expect(board.entries().map((entry) => entry.initials)).toEqual(['ONE', 'TWO']);
  });
});

describe('persistence', () => {
  it('writes the table and reads it back on the next session', () => {
    const storage = createMemoryStorage();
    const first = createHighScoreBoard({ storage, defaults: TABLE });
    first.submit('NEW', 20_000, 9);

    const second = createHighScoreBoard({ storage, defaults: [] });
    expect(second.entries().map((entry) => entry.initials)).toEqual(['NEW', 'AAA', 'BBB']);
  });

  it('falls back to the defaults when the stored document is corrupt', () => {
    for (const text of ['', 'not json', '{}', '{"version":99,"entries":[]}', '[]']) {
      expect(parseHighScores(text)).toBeUndefined();
    }
    const board = createHighScoreBoard({
      storage: createMemoryStorage('not json'),
      defaults: TABLE,
    });
    expect(board.entries()).toHaveLength(TABLE.length);
  });

  it('drops individual rows that are not legal entries', () => {
    const document = JSON.stringify({
      version: 1,
      entries: [{ initials: 'OK', score: 10 }, { score: 'nope' }, null, { initials: 'NO' }],
    });
    expect(parseHighScores(document)).toEqual([{ initials: 'OK.', score: 10, stage: 0 }]);
  });
});

describe('storage that is not there', () => {
  /** A store that throws on every call, as a blocked browser store does. */
  const hostile: WebStorageLike = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };

  it('degrades to an in-memory table rather than throwing', () => {
    const storage = createWebStorage({ resolve: () => undefined });
    expect(storage.load()).toBeUndefined();
    expect(storage.save('anything')).toBe(false);
    expect(storage.persistent).toBe(false);

    const board = createHighScoreBoard({ storage, defaults: TABLE });
    expect(() => board.submit('AAA', 99_999)).not.toThrow();
    expect(board.entries()[0]?.initials).toBe('AAA');
    expect(board.persistent).toBe(false);
  });

  it('survives a store whose every call throws', () => {
    const storage = createWebStorage({ resolve: () => hostile });
    expect(() => storage.load()).not.toThrow();
    expect(storage.save('x')).toBe(false);
    expect(storage.persistent).toBe(false);

    const board = createHighScoreBoard({ storage, defaults: TABLE });
    expect(board.submit('AAA', 99_999)).toBe(0);
    // The table still works for this session, it just does not outlive it.
    expect(board.entries()[0]?.score).toBe(99_999);
  });

  it('keeps the session table when only the write is blocked', () => {
    // Reads work, writes do not: a full store, or a quota of zero.
    const writeOnce: WebStorageLike = {
      getItem: () => null,
      setItem() {
        throw new Error('quota');
      },
    };
    const storage = createWebStorage({ resolve: () => writeOnce });
    expect(storage.save('{"version":1,"entries":[]}')).toBe(false);
    // The in-memory fallback took the write even though the browser refused it.
    expect(storage.load()).toBe('{"version":1,"entries":[]}');
  });

  it('uses the real store when there is one, under the versioned key', () => {
    const map = new Map<string, string>();
    const fake: WebStorageLike = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
    const storage: KeyedStorage = createWebStorage({
      key: HIGH_SCORE_STORAGE_KEY,
      resolve: () => fake,
    });
    expect(storage.persistent).toBe(true);
    createHighScoreBoard({ storage, defaults: TABLE }).submit('WIN', 50_000, 11);
    expect(map.has(HIGH_SCORE_STORAGE_KEY)).toBe(true);
    expect(parseHighScores(map.get(HIGH_SCORE_STORAGE_KEY))?.[0]?.initials).toBe('WIN');
  });

  it('works with no arguments on a host that has no browser storage', () => {
    // Node may or may not expose a Web Storage global depending on the flags it
    // was started with, so this asserts the contract rather than which half of
    // it ran: no throw either way, and a write that reads back.
    const storage = createWebStorage({ key: 'star-swarm/test/round-trip' });
    expect(() => storage.load()).not.toThrow();
    expect(() => storage.save('{"version":1,"entries":[]}')).not.toThrow();
    expect(storage.load()).toBe('{"version":1,"entries":[]}');
  });
});

/**
 * One table per game. A score is comparable only with scores from the same game,
 * so a variation's table must never be the game it was made from.
 */
describe('the book of tables, one per game', () => {
  it('keeps each game its own table, so a score in one is not in another', () => {
    const book = createHighScoreBook({ carryTo: 'classic', defaults: TABLE });
    expect(book.boardFor('classic').submit('CLS', 50_000, 9)).toBe(0);
    expect(book.boardFor('convoy').entries()).toEqual(TABLE);
    expect(book.boardFor('classic-2').entries()).toEqual(TABLE);
    expect(book.boardFor('classic').best()).toBe(50_000);
    expect(book.boardFor('classic-2').best()).toBe(10_000);
  });

  it('hands back the same board for the same game', () => {
    const book = createHighScoreBook({ carryTo: 'classic' });
    expect(book.boardFor('convoy')).toBe(book.boardFor('convoy'));
  });

  it('writes every table into one version 2 document and reads them all back', () => {
    const storage = createMemoryStorage();
    const book = createHighScoreBook({ storage, carryTo: 'classic', defaults: [] });
    book.boardFor('classic').submit('CLS', 4_000, 2);
    book.boardFor('convoy').submit('CNV', 3_000, 3);
    expect(JSON.parse(storage.load() ?? '')).toEqual({
      version: 2,
      tables: {
        classic: [{ initials: 'CLS', score: 4_000, stage: 2 }],
        convoy: [{ initials: 'CNV', score: 3_000, stage: 3 }],
      },
    });

    const again = createHighScoreBook({ storage, carryTo: 'classic', defaults: TABLE });
    expect(again.boardFor('classic').entries()).toEqual([
      { initials: 'CLS', score: 4_000, stage: 2 },
    ]);
    expect(again.boardFor('convoy').best()).toBe(3_000);
    // A game with no table yet starts from the defaults, as the one table did.
    expect(again.boardFor('deep-sea').entries()).toEqual(TABLE);
  });

  it('carries a version 1 table, which names no game, to the game it is told to, and writes version 2 back', () => {
    const legacy = [
      { initials: 'OLD', score: 77_000, stage: 14 },
      { initials: 'AAA', score: 30_000, stage: 12 },
    ];
    const storage = createMemoryStorage(JSON.stringify({ version: 1, entries: legacy }));
    const book = createHighScoreBook({ storage, carryTo: 'classic' });

    // Nothing earned is dropped: the whole table is the carried game's...
    expect(book.boardFor('classic').entries()).toEqual(legacy);
    // ...and no other game's, so a variation does not inherit it either.
    expect(book.boardFor('classic-2').entries()).toEqual(DEFAULT_HIGH_SCORES);
    expect(book.boardFor('convoy').entries()).toEqual(DEFAULT_HIGH_SCORES);
    // Upgraded on read, before any submission, so the question is asked once.
    expect(JSON.parse(storage.load() ?? '')).toEqual({ version: 2, tables: { classic: legacy } });
  });

  it('reads a corrupt table as no table, without losing the others', () => {
    const storage = createMemoryStorage(
      JSON.stringify({
        version: 2,
        tables: { classic: [{ initials: 'CLS', score: 4_000, stage: 2 }], convoy: 'garbage' },
      }),
    );
    const book = createHighScoreBook({ storage, carryTo: 'classic', defaults: TABLE });
    expect(book.boardFor('classic').best()).toBe(4_000);
    expect(book.boardFor('convoy').entries()).toEqual(TABLE);
  });

  it('forgets a game, so an id used again later starts from the defaults', () => {
    const storage = createMemoryStorage();
    const book = createHighScoreBook({ storage, carryTo: 'classic', defaults: TABLE });
    book.boardFor('classic-2').submit('GON', 90_000, 20);
    book.boardFor('classic').submit('CLS', 80_000, 18);
    book.forget('classic-2');

    expect(book.boardFor('classic-2').entries()).toEqual(TABLE);
    expect(book.boardFor('classic').best()).toBe(80_000);
    const again = createHighScoreBook({ storage, carryTo: 'classic', defaults: TABLE });
    expect(again.boardFor('classic-2').entries()).toEqual(TABLE);
    expect(again.boardFor('classic').best()).toBe(80_000);
  });

  it('says every table is session-only when the store is', () => {
    const blocked = createWebStorage({ resolve: () => undefined });
    const book = createHighScoreBook({ storage: blocked, carryTo: 'classic' });
    expect(book.persistent).toBe(false);
    expect(book.boardFor('convoy').persistent).toBe(false);
    expect(book.boardFor('convoy').submit('NEW', 999_999)).toBe(0);
    expect(book.boardFor('convoy').best()).toBe(999_999);
  });
});

describe('initials', () => {
  it('pads, upper-cases and replaces anything off the alphabet', () => {
    expect(normaliseInitials('ab')).toBe('AB.');
    expect(normaliseInitials('abcd')).toBe('ABC');
    expect(normaliseInitials('a b')).toBe('A.B');
    expect(normaliseInitials('')).toBe('...');
  });

  it('walks the alphabet in both directions, wrapping', () => {
    const entry = createInitialsEntry();
    expect(entry.value).toBe('AAA');
    entry.next();
    expect(entry.letters[0]).toBe('B');
    entry.previous();
    entry.previous();
    expect(entry.letters[0]).toBe(INITIALS_ALPHABET[INITIALS_ALPHABET.length - 1]);
  });

  it('commits one letter at a time and then reports done', () => {
    const entry = createInitialsEntry();
    entry.next(); // B
    entry.commit();
    expect(entry.index).toBe(1);
    expect(entry.done).toBe(false);
    entry.next();
    entry.next(); // C
    entry.commit();
    entry.commit();
    expect(entry.done).toBe(true);
    expect(entry.value).toBe('BCA');
    // Nothing moves once entry is finished.
    entry.next();
    expect(entry.value).toBe('BCA');
  });
});

describe('the table layout', () => {
  it('right-aligns scores in a fixed column', () => {
    expect(formatTableScore(0)).toBe('     0');
    expect(formatTableScore(12_340)).toBe(' 12340');
    expect(formatTableScore(123_456)).toBe('123456');
  });
});
