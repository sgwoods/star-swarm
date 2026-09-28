/**
 * Somewhere to keep a few bytes between sessions, and what to do when there is
 * nowhere.
 *
 * Extracted from `./highscores.ts`, which is where this shape was first written
 * and still the place to read for *why* it is this shape: `localStorage` is not
 * available in every browser state — a private window, blocked site data, a
 * cookie policy that makes the **property access itself** throw — and a blocked
 * storage API must never take the game down. So everything that persists is built
 * over {@link KeyedStorage}, the browser implementation catches on every path,
 * and the fallback is an in-memory store that behaves identically for one session.
 *
 * It lives in its own module because there is now more than one thing to keep:
 * the high-score table and the player's settings (`./settings.ts`). One
 * implementation, two keys — a second copy of the fallback logic is a second
 * chance to get the "a browser can revoke it between calls" case wrong.
 *
 * Nothing here knows what it is storing. It is two methods over a string.
 */

/**
 * Everything a persisted value needs from a place to keep bytes.
 *
 * Neither method may throw: an implementation that cannot read says so by
 * returning `undefined`, and one that cannot write says so by returning `false`.
 */
export interface KeyedStorage {
  /** The stored document, or `undefined` when there is none or it is unreadable. */
  load: () => string | undefined;
  /** Persist. `false` means the write did not stick; the caller carries on. */
  save: (text: string) => boolean;
  /** False for the in-memory fallback, so the UI can say the value is session-only. */
  readonly persistent: boolean;
}

/** The slice of the Web Storage API this needs. */
export interface WebStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/** A store that lives as long as the tab. The fallback, and useful in tests. */
export function createMemoryStorage(initial?: string): KeyedStorage {
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
 * store for the rest of the session and reports `persistent: false`. The game
 * keeps the value for as long as the tab lives and never sees an error.
 *
 * Every real caller names its own `key` — see `HIGH_SCORE_STORAGE_KEY` and
 * `SETTINGS_STORAGE_KEY` — so that two things cannot quietly share a slot. The
 * default exists only so a test can build one without caring.
 */
export function createWebStorage(options: WebStorageOptions = {}): KeyedStorage {
  const { key = 'star-swarm/unnamed', resolve = defaultResolve } = options;
  const fallback = createMemoryStorage();

  /**
   * Resolve, and treat a throw as "no store".
   *
   * Every call goes through here, the construction-time probe included. The
   * default resolver catches internally, but a caller's own may not — and the
   * whole point of this module is that nothing it is handed can take the game
   * down. A `resolve` that throws is exactly what a private window does when the
   * `localStorage` property is read.
   */
  const tryResolve = (): WebStorageLike | undefined => {
    try {
      return resolve();
    } catch {
      return undefined;
    }
  };

  let usable = tryResolve() !== undefined;

  return {
    load(): string | undefined {
      // Once anything has failed, the in-memory store is the newer of the two:
      // it took every write the browser refused, so it is what to read back.
      if (!usable) return fallback.load();
      const store = tryResolve();
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
      const store = tryResolve();
      if (store === undefined) {
        usable = false;
        return false;
      }
      try {
        store.setItem(key, text);
        return true;
      } catch {
        // A quota error or a blocked write: the session keeps its value, the
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
