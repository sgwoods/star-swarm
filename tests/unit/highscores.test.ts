import { describe, expect, it } from 'vitest';

import {
  createHighScoreBoard,
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
