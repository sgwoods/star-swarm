import { describe, expect, it } from 'vitest';

import { isVariantDocument, resolveVariant } from '../../src/content/variants.js';
import { ACTIONS } from '../../src/engine/input.js';
import {
  bindingsFor,
  CONTROL_SCHEMES,
  createSettingsStore,
  DEFAULT_SETTINGS,
  freshVariationId,
  freshVariationName,
  type LegacyBase,
  parseSettings,
  quantiseVolume,
  readSettings,
  SETTINGS_STORAGE_KEY,
  type Settings,
  VARIATION_NAME_LENGTH,
  VOLUME_STEPS,
} from '../../src/ui/settings.js';
import {
  createMemoryStorage,
  createWebStorage,
  type WebStorageLike,
} from '../../src/ui/storage.js';
import { installedPacks, shippedVariants, shippedVariantSources } from '../helpers/variants.js';

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
    // The guard that keeps layer 3 out of layer 1. `difficulty` and `autoplay`
    // are ids and the only other values are presentation, controls and ids. A
    // number added here that a rule reads would fail this list.
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([
      'autoplay',
      'controls',
      'crt',
      'difficulty',
      'muted',
      'variant',
      'variations',
      'volume',
    ]);
    expect(typeof DEFAULT_SETTINGS.difficulty).not.toBe('number');
    // An autoplay persona is a document's id, not a skill number: a scalar here
    // would be a difficulty multiplier wearing a different label.
    expect(typeof DEFAULT_SETTINGS.autoplay).not.toBe('number');
  });

  it('starts with nothing chosen, so the first boot takes every default', () => {
    expect(DEFAULT_SETTINGS.variant).toBeUndefined();
    expect(DEFAULT_SETTINGS.difficulty).toBeUndefined();
    // Autoplay is off out of the box: a cabinet nobody asked to watch itself
    // must boot into the hands of whoever is standing at it.
    expect(DEFAULT_SETTINGS.autoplay).toBeUndefined();
    expect(DEFAULT_SETTINGS.variations).toEqual([]);
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
    expect(parseSettings('{"version":2}')).toBeUndefined();
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
      '{"version":2,"settings":{"volume":"loud","muted":"yes","controls":"joystick","variant":7,"variations":"classic"}}',
    );
    expect(parsed?.volume).toBe(DEFAULT_SETTINGS.volume);
    expect(parsed?.muted).toBe(DEFAULT_SETTINGS.muted);
    expect(parsed?.controls).toBe(DEFAULT_SETTINGS.controls);
    expect(parsed?.variant).toBeUndefined();
    expect(parsed?.variations).toEqual([]);
  });

  it('clamps a stored volume that is out of range', () => {
    expect(parseSettings('{"version":1,"settings":{"volume":12}}')?.volume).toBe(1);
  });
});

describe('the player’s variations, as stored', () => {
  const stored = (variations: unknown): Settings | undefined =>
    parseSettings(JSON.stringify({ version: 2, settings: { variations } }));

  it('keeps each one as written — whether or not it would load', () => {
    const mine = { id: 'classic-2', name: 'REEFS', packs: ['classic', 'moon-base'], extra: 1 };
    // A pack this build lacks and a field no schema has: still the player's,
    // still listed, and judged only when it is played.
    expect(stored([mine])?.variations).toEqual([mine]);
  });

  it('drops only what cannot be addressed: no id, not an object, an id read twice', () => {
    const first = { id: 'classic-2', name: 'ONE', packs: ['classic'] };
    expect(
      stored([first, { name: 'NO ID' }, { id: '' }, 'classic-3', [1], null, { id: 'classic-2' }])
        ?.variations,
    ).toEqual([first]);
  });

  it('reads a variation back through a store exactly as it was written', () => {
    const storage = createMemoryStorage();
    const mine = { id: 'classic-2', name: 'REEFS', derivedFrom: 'classic', packs: ['classic'] };
    createSettingsStore({ storage }).update({ variations: [mine], variant: 'classic-2' });
    expect(createSettingsStore({ storage }).value).toMatchObject({
      variant: 'classic-2',
      variations: [mine],
    });
    expect(JSON.parse(storage.load() ?? '{}')).toMatchObject({ version: 2 });
  });
});

describe('a version 1 document, with an override per shipped game', () => {
  /** The shipped games, as `src/main.ts` hands them to the store. */
  const bases: readonly LegacyBase[] = shippedVariants().map((variant) => {
    const document = shippedVariantSources().find((source) => source.file === variant.file)?.value;
    if (!isVariantDocument(document)) throw new Error(`no document for ${variant.id}`);
    return { id: variant.id, name: variant.name, document };
  });

  const v1 = (settings: Record<string, unknown>): string =>
    JSON.stringify({ version: 1, settings });

  it('becomes a variation of the game it was stored against, chosen as it was playing', () => {
    const read = readSettings(
      v1({ variant: 'classic', difficulty: 'hard', packs: { classic: ['classic', 'deep-sea'] } }),
      bases,
    );
    expect(read?.upgraded).toBe(true);
    const settings = read?.settings;
    expect(settings?.difficulty).toBe('hard');
    expect(settings?.variant).toBe('classic-2');
    expect(settings?.variations).toHaveLength(1);
    const made = settings?.variations[0];
    expect(made).toMatchObject({
      id: 'classic-2',
      name: 'STAR SWARM 2',
      derivedFrom: 'classic',
      packs: ['classic', 'deep-sea'],
    });
    // A copy of the game's document, so the presets and personas come across…
    expect(made?.difficulty).toEqual(bases[0]?.document.difficulty);
    expect(made?.autoplay).toEqual(bases[0]?.document.autoplay);
    // …and the claims about the shipped game do not.
    expect(made).not.toHaveProperty('description');
    expect(made).not.toHaveProperty('order');
    expect(made).not.toHaveProperty('stages');
  });

  it('makes a variation that loads exactly as a variant document would', () => {
    const made = parseSettings(
      v1({ packs: { classic: ['classic', 'deep-sea'] }, stages: { classic: ['reef-2'] } }),
      bases,
    )?.variations[0];
    expect(made).toBeDefined();
    const result = resolveVariant(
      { file: 'classic-2.json', value: made },
      installedPacks(),
      {},
      {
        reserved: bases.map((base) => base.id),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.variant.packs).toEqual(['classic', 'deep-sea']);
      expect(result.variant.stages).toEqual(['reef-2']);
      expect(result.variant.derivedFrom).toBe('classic');
    }
  });

  it('chooses the variation when nothing was remembered, because the first game was playing', () => {
    const settings = parseSettings(v1({ stages: { classic: ['script-3'] } }), bases);
    expect(settings?.variant).toBe('classic-2');
    // Only an order was stored, so the game's own pack list comes with it.
    expect(settings?.variations[0]).toMatchObject({ packs: ['classic'], stages: ['script-3'] });
  });

  it('makes one per game, and leaves the choice alone when another game was playing', () => {
    const settings = parseSettings(
      v1({
        variant: 'swarm-remix',
        packs: {
          classic: ['classic', 'deep-sea'],
          'deep-sea': ['classic', 'deep-sea', 'swarm-remix'],
        },
      }),
      bases,
    );
    expect(settings?.variant).toBe('swarm-remix');
    expect(settings?.variations.map((variation) => [variation.id, variation.name])).toEqual([
      ['classic-2', 'STAR SWARM 2'],
      ['deep-sea-2', 'DEEP SEA 2'],
    ]);
  });

  it('keeps an override that will not load, rather than dropping what the player made', () => {
    const settings = parseSettings(v1({ packs: { classic: ['classic', 'moon-base'] } }), bases);
    expect(settings?.variations[0]?.packs).toEqual(['classic', 'moon-base']);
  });

  it('keeps an override for a game this build does not ship, as what it can state', () => {
    const settings = parseSettings(v1({ packs: { 'old-game': ['classic'] } }), bases);
    expect(settings?.variations[0]).toEqual({
      id: 'old-game-2',
      name: 'OLD-GAME 2',
      derivedFrom: 'old-game',
      packs: ['classic'],
    });
  });

  it('is upgraded on the store’s first read and written straight back as version 2', () => {
    const storage = createMemoryStorage(
      v1({ volume: 0.3, packs: { classic: ['classic', 'deep-sea'] } }),
    );
    const store = createSettingsStore({ storage, upgrade: bases });
    expect(store.value.variant).toBe('classic-2');
    const written = JSON.parse(storage.load() ?? '{}') as {
      version: number;
      settings: Record<string, unknown>;
    };
    expect(written.version).toBe(2);
    expect(written.settings).not.toHaveProperty('packs');
    expect(written.settings).not.toHaveProperty('stages');
    expect(written.settings.volume).toBe(0.3);
    // One-way: a second read finds version 2 and makes nothing more.
    expect(createSettingsStore({ storage, upgrade: bases }).value.variations).toHaveLength(1);
  });

  it('reads a version 1 document with no overrides as itself', () => {
    const storage = createMemoryStorage(v1({ difficulty: 'expert' }));
    const store = createSettingsStore({ storage, upgrade: bases });
    expect(store.value).toEqual({ ...DEFAULT_SETTINGS, difficulty: 'expert' });
  });
});

describe('a fresh variation’s id and name', () => {
  it('numbers from 2, past whatever is taken', () => {
    expect(freshVariationId('classic', ['classic'])).toBe('classic-2');
    expect(freshVariationId('classic', ['classic', 'classic-2', 'classic-4'])).toBe('classic-3');
    expect(freshVariationName('STAR SWARM', ['STAR SWARM'])).toBe('STAR SWARM 2');
    expect(freshVariationName('STAR SWARM', ['star swarm 2', 'STAR SWARM'])).toBe('STAR SWARM 3');
  });

  it('cuts a long name so the number still fits the row', () => {
    const name = freshVariationName('A VERY LONG GAME NAME', []);
    expect(name).toBe('A VERY LONG 2');
    expect(name.length).toBeLessThanOrEqual(VARIATION_NAME_LENGTH);
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

  it('narrow up and down with left and right, so a card is worked with one set of keys', () => {
    // On the WASD scheme a settings card that moved rows with the arrows and
    // changed them only with A and D would be two schemes at once.
    const arrows = bindingsFor('arrows');
    expect(arrows.ArrowUp).toBe('up');
    expect(arrows.ArrowDown).toBe('down');
    expect(arrows.KeyW).toBeUndefined();
    expect(arrows.KeyS).toBeUndefined();

    const wasd = bindingsFor('wasd');
    expect(wasd.KeyW).toBe('up');
    expect(wasd.KeyS).toBe('down');
    expect(wasd.ArrowUp).toBeUndefined();
    expect(wasd.ArrowDown).toBeUndefined();
  });

  it('leave `both` as the default map itself, so nothing is lost by filtering', () => {
    const both = bindingsFor('both');
    expect(both.ArrowLeft).toBe('left');
    expect(both.KeyA).toBe('left');
    expect(Object.keys(both).length).toBeGreaterThan(Object.keys(bindingsFor('arrows')).length);
  });
});
