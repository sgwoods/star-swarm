import { describe, expect, it } from 'vitest';

import { ACTIONS } from '../../src/engine/input.js';
import {
  bindingsFor,
  CONTROL_SCHEMES,
  createSettingsStore,
  DEFAULT_SETTINGS,
  parseSettings,
  quantiseVolume,
  SETTINGS_STORAGE_KEY,
  type Settings,
  VOLUME_STEPS,
} from '../../src/ui/settings.js';
import {
  createMemoryStorage,
  createWebStorage,
  type WebStorageLike,
} from '../../src/ui/storage.js';

/**
 * Player settings — `docs/DESIGN.md` section 6 layer 3.
 *
 * Two contracts are under test, and the first is the one that matters most:
 *
 * - **Layer 3 never reaches into layer 1.** Nothing here holds a number the
 *   simulation steps. The difficulty setting is a *preset id*; turning it into a
 *   rank is `src/content/variants.ts` and resolving that rank into tables is
 *   `src/content/rules.ts`. A settings value that could scale a rule would be the
 *   difficulty multiplier section 6 rules out, wearing a player-facing label.
 * - **Blocked storage degrades, never throws**, exactly as the high-score table
 *   does — the same `KeyedStorage`, so the fallback logic is not written twice.
 */

/** A hostile store: reachable, and throws on every call. */
const hostile: WebStorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('the settings shape', () => {
  it('holds nothing the simulation steps', () => {
    // The guard that keeps layer 3 out of layer 1. `difficulty` is a preset id and
    // the only other values are presentation, controls and ids. A number added
    // here that a rule reads would fail this list.
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([
      'controls',
      'crt',
      'difficulty',
      'muted',
      'packs',
      'variant',
      'volume',
    ]);
    expect(typeof DEFAULT_SETTINGS.difficulty).not.toBe('number');
  });

  it('starts with nothing chosen, so the first boot takes every default', () => {
    expect(DEFAULT_SETTINGS.variant).toBeUndefined();
    expect(DEFAULT_SETTINGS.difficulty).toBeUndefined();
    expect(DEFAULT_SETTINGS.packs).toEqual({});
  });

  it('quantises volume onto the menu’s own grid', () => {
    expect(quantiseVolume(0.44)).toBe(0.4);
    expect(quantiseVolume(1.9)).toBe(1);
    expect(quantiseVolume(-3)).toBe(0);
    expect(quantiseVolume(Number.NaN)).toBe(DEFAULT_SETTINGS.volume);
    // Every step the menu can reach round-trips exactly, so a stored value cannot
    // drift a little on each save.
    for (let step = 0; step <= VOLUME_STEPS; step += 1) {
      const value = step / VOLUME_STEPS;
      expect(quantiseVolume(value)).toBe(value);
    }
  });
});

describe('reading a stored settings document', () => {
  it('reads back what was written', () => {
    const storage = createMemoryStorage();
    const store = createSettingsStore({ storage });
    store.update({ variant: 'swarm-remix', difficulty: 'expert', volume: 0.3, crt: true });
    expect(parseSettings(storage.load())).toEqual({
      ...DEFAULT_SETTINGS,
      variant: 'swarm-remix',
      difficulty: 'expert',
      volume: 0.3,
      crt: true,
    });
  });

  it('treats anything unreadable as no settings at all', () => {
    expect(parseSettings(undefined)).toBeUndefined();
    expect(parseSettings('not json')).toBeUndefined();
    expect(parseSettings('[]')).toBeUndefined();
    expect(parseSettings('{"version":99,"settings":{}}')).toBeUndefined();
    expect(parseSettings('{"version":1}')).toBeUndefined();
  });

  it('honours a partial document field by field', () => {
    // A settings shape that grows a field must not throw away what a player had
    // already chosen, so a document from an older build reads as itself plus the
    // new defaults.
    const parsed = parseSettings('{"version":1,"settings":{"volume":0.2,"muted":true}}');
    expect(parsed?.volume).toBe(0.2);
    expect(parsed?.muted).toBe(true);
    expect(parsed?.controls).toBe(DEFAULT_SETTINGS.controls);
    expect(parsed?.crt).toBe(DEFAULT_SETTINGS.crt);
  });

  it('drops a field of the wrong type rather than trusting it', () => {
    const parsed = parseSettings(
      '{"version":1,"settings":{"volume":"loud","muted":"yes","controls":"joystick","variant":7,"packs":"classic"}}',
    );
    expect(parsed?.volume).toBe(DEFAULT_SETTINGS.volume);
    expect(parsed?.muted).toBe(DEFAULT_SETTINGS.muted);
    expect(parsed?.controls).toBe(DEFAULT_SETTINGS.controls);
    expect(parsed?.variant).toBeUndefined();
    expect(parsed?.packs).toEqual({});
  });

  it('keeps a per-variant pack override and drops a malformed one', () => {
    const parsed = parseSettings(
      '{"version":1,"settings":{"packs":{"x":["classic","extra"],"y":"nope","z":[1,2]}}}',
    );
    expect(parsed?.packs).toEqual({ x: ['classic', 'extra'] });
  });

  it('clamps a stored volume that is out of range', () => {
    expect(parseSettings('{"version":1,"settings":{"volume":12}}')?.volume).toBe(1);
  });
});

describe('the store', () => {
  it('merges a patch rather than replacing the value', () => {
    const store = createSettingsStore({ storage: createMemoryStorage() });
    store.update({ volume: 0.5 });
    const after = store.update({ muted: true });
    expect(after.volume).toBe(0.5);
    expect(after.muted).toBe(true);
  });

  it('reads what a previous session stored', () => {
    const storage = createMemoryStorage(
      JSON.stringify({ version: 1, settings: { variant: 'classic', difficulty: 'hard' } }),
    );
    expect(createSettingsStore({ storage }).value.variant).toBe('classic');
    expect(createSettingsStore({ storage }).value.difficulty).toBe('hard');
  });

  it('quantises a volume it is handed', () => {
    const store = createSettingsStore({ storage: createMemoryStorage() });
    expect(store.update({ volume: 0.37 }).volume).toBe(0.4);
  });

  it('falls back to the defaults on a corrupt document', () => {
    const store = createSettingsStore({ storage: createMemoryStorage('{{{') });
    expect(store.value).toEqual(DEFAULT_SETTINGS);
  });

  it('takes a caller’s own defaults', () => {
    const defaults: Settings = { ...DEFAULT_SETTINGS, volume: 0.1, controls: 'wasd' };
    expect(createSettingsStore({ storage: createMemoryStorage(), defaults }).value).toEqual(
      defaults,
    );
  });
});

describe('when browser storage is not available', () => {
  it('works with no storage at all and says it is session-only', () => {
    const store = createSettingsStore();
    expect(store.persistent).toBe(false);
    expect(() => store.update({ crt: true })).not.toThrow();
    // Session-only, but it behaves identically for the tab that is open.
    expect(store.value.crt).toBe(true);
  });

  it('degrades to defaults rather than throwing when the store is missing', () => {
    const store = createSettingsStore({
      storage: createWebStorage({ key: SETTINGS_STORAGE_KEY, resolve: () => undefined }),
    });
    expect(store.persistent).toBe(false);
    expect(store.value).toEqual(DEFAULT_SETTINGS);
    expect(() => store.update({ volume: 0.2 })).not.toThrow();
    expect(store.value.volume).toBe(0.2);
  });

  it('degrades when the store is there but every call throws', () => {
    const storage = createWebStorage({ key: SETTINGS_STORAGE_KEY, resolve: () => hostile });
    const store = createSettingsStore({ storage });
    expect(store.value).toEqual(DEFAULT_SETTINGS);
    expect(() => store.update({ muted: true })).not.toThrow();
    expect(store.persistent).toBe(false);
    // The in-memory fallback took the write the browser refused, so the tab keeps
    // the setting for as long as it lives.
    expect(store.value.muted).toBe(true);
  });

  it('degrades when reading the property itself throws', () => {
    // The case a private window really produces: touching `localStorage` throws
    // before any method is called.
    const storage = createWebStorage({
      key: SETTINGS_STORAGE_KEY,
      resolve: () => {
        throw new Error('site data blocked');
      },
    });
    expect(() => createSettingsStore({ storage })).not.toThrow();
    expect(createSettingsStore({ storage }).value).toEqual(DEFAULT_SETTINGS);
  });

  it('uses the real store under its own key, not the high-score table’s', () => {
    const map = new Map<string, string>();
    const fake: WebStorageLike = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
    const storage = createWebStorage({ key: SETTINGS_STORAGE_KEY, resolve: () => fake });
    createSettingsStore({ storage }).update({ difficulty: 'brisk' });
    expect([...map.keys()]).toEqual([SETTINGS_STORAGE_KEY]);
    expect(parseSettings(map.get(SETTINGS_STORAGE_KEY))?.difficulty).toBe('brisk');
  });
});

describe('the control schemes', () => {
  it('bind left, right, fire and start in every scheme', () => {
    for (const scheme of CONTROL_SCHEMES) {
      const bound = new Set(Object.values(bindingsFor(scheme)));
      for (const action of ACTIONS) expect(bound.has(action)).toBe(true);
    }
  });

  it('keep the menu reachable in every scheme', () => {
    // A scheme that could not reopen the menu would be a setting a player could
    // not undo.
    for (const scheme of CONTROL_SCHEMES) {
      expect(Object.values(bindingsFor(scheme))).toContain('menu');
    }
  });

  it('keep the pause and the way out reachable in every scheme', () => {
    // A scheme narrows the three keys a player *plays* with and nothing else, so
    // an action appended to the default map is in every scheme by default. A
    // control scheme that could not pause is a game a player could not put down.
    for (const scheme of CONTROL_SCHEMES) {
      const bound = Object.values(bindingsFor(scheme));
      expect(bound).toContain('pause');
      expect(bound).toContain('exit');
    }
  });

  it('narrow the movement keys to the scheme’s own', () => {
    const arrows = bindingsFor('arrows');
    expect(arrows.ArrowLeft).toBe('left');
    expect(arrows.KeyA).toBeUndefined();
    expect(arrows.Space).toBe('fire');
    expect(arrows.KeyZ).toBeUndefined();

    const wasd = bindingsFor('wasd');
    expect(wasd.KeyD).toBe('right');
    expect(wasd.ArrowRight).toBeUndefined();
    expect(wasd.KeyZ).toBe('fire');
    expect(wasd.Space).toBeUndefined();
  });

  it('leave `both` as the default map itself, so nothing is lost by filtering', () => {
    const both = bindingsFor('both');
    expect(both.ArrowLeft).toBe('left');
    expect(both.KeyA).toBe('left');
    expect(Object.keys(both).length).toBeGreaterThan(Object.keys(bindingsFor('arrows')).length);
  });
});
