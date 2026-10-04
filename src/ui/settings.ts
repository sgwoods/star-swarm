/**
 * Player settings — `docs/DESIGN.md` section 6, **layer 3**.
 *
 * The configuration system has three layers: engine rules, content packs, and
 * these. The rule that shapes this file is the boundary between the third layer
 * and the first:
 *
 * **Player settings never reach into the rules layer.** Nothing here holds a
 * number the simulation steps. The difficulty setting is a **preset id** and
 * nothing else; turning it into a rank is `rankFor` in
 * `src/content/variants.ts`, and turning that rank into whole data tables is
 * `src/content/rules.ts`. There is deliberately nowhere in this shape to put a
 * scalar, a multiplier or a rules override — section 6 is explicit that rank
 * selects data sets rather than scaling one, and a settings value that could
 * scale would be that mistake wearing a player-facing label.
 *
 * What each setting *does* reach:
 *
 * | Setting      | Applied by                                                   |
 * | ------------ | ------------------------------------------------------------ |
 * | `variant`    | which game `src/ui/flow.ts` runs                              |
 * | `difficulty` | a preset id → a rank → the rules layer's own tables           |
 * | `autoplay`   | a persona id → the pilot `src/ui/flow.ts` hands the controls to |
 * | `volume`     | `Synth.setVolume` (`src/audio/synth.ts`)                      |
 * | `muted`      | `Synth.setMuted`                                              |
 * | `controls`   | the keyboard map handed to `createKeyboardInput`              |
 * | `crt`        | the scanline filter `src/render/crt.ts` draws over the screen |
 * | `packs`      | an override of a variant's own pack list, per variant          |
 *
 * Persistence is {@link KeyedStorage} from `./storage.ts` — the same interface
 * the high-score table uses, for the same reason: blocked or unavailable browser
 * storage must degrade to defaults rather than throw. A store that cannot write
 * reports `persistent: false` and the settings last as long as the tab.
 */

import { type Action, DEFAULT_BINDINGS } from '../engine/input.js';
import { createMemoryStorage, type KeyedStorage } from './storage.js';

/** Key the browser implementation stores under. */
export const SETTINGS_STORAGE_KEY = 'star-swarm/settings/v1';

/** The keyboard schemes the settings menu offers. */
export const CONTROL_SCHEMES = ['both', 'arrows', 'wasd'] as const;
export type ControlScheme = (typeof CONTROL_SCHEMES)[number];

/** Volume steps the menu walks, so a row shows a value rather than a float. */
export const VOLUME_STEPS = 10;

/**
 * Everything the player has chosen.
 *
 * `variant` and `difficulty` are ids rather than resolved values, because a
 * settings document outlives the packs it was written against: a variant that is
 * no longer installed, or a preset a different variant does not offer, must read
 * back as "use the default" rather than as an error. `presetOf` and `rankFor` in
 * `src/content/variants.ts` are where that fallback lives.
 */
export interface Settings {
  /** Last chosen variant id, or `undefined` for "whichever comes first". */
  readonly variant: string | undefined;
  /**
   * Last chosen difficulty **preset id**, shared across variants.
   *
   * One value rather than one per variant: a difficulty preference is a property
   * of the player, and preset ids are meant to be a shared vocabulary across a
   * lineage. A variant that does not offer this preset falls back to its own
   * default, which is `presetOf`.
   */
  readonly difficulty: string | undefined;
  /**
   * The autoplay **persona id** the cabinet plays itself as, or `undefined` for
   * "a human is flying".
   *
   * An id rather than a resolved persona, and `undefined` rather than a
   * `'off'` sentinel, for the same reason `variant` and `difficulty` are: a
   * settings document outlives the packs and variants it was written against, and
   * an id the active variant does not offer must read as **off** rather than as
   * the first persona. `personaOf` in `src/content/personas.ts` is that fallback,
   * and it is deliberately the strict one — silently watching the cabinet play
   * itself as somebody else is worse than not watching.
   */
  readonly autoplay: string | undefined;
  /** Master volume, 0…1. */
  readonly volume: number;
  readonly muted: boolean;
  /** The CRT filter option: `src/main.ts` hands `src/render/crt.ts` to the display. */
  readonly crt: boolean;
  readonly controls: ControlScheme;
  /**
   * Per variant, an override of the pack list that variant declares.
   *
   * Keyed by variant id because a pack list is inherently a property of one
   * game. Empty by default, which means "the variant's own list". This is the
   * seam the pack manager attaches to: it is honoured on load today and nothing
   * in the menu writes it yet.
   */
  readonly packs: Readonly<Record<string, readonly string[]>>;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  variant: undefined,
  difficulty: undefined,
  autoplay: undefined,
  volume: 0.7,
  muted: false,
  crt: false,
  controls: 'both',
  packs: Object.freeze({}),
} satisfies Settings);

/** Clamp a volume to 0…1 on the menu's own grid, so a stored float cannot drift. */
export function quantiseVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_SETTINGS.volume;
  const steps = Math.round(Math.min(1, Math.max(0, volume)) * VOLUME_STEPS);
  return steps / VOLUME_STEPS;
}

/** The document shape on disk. Bumped if the shape ever changes. */
const DOCUMENT_VERSION = 1;

interface StoredDocument {
  readonly version: number;
  readonly settings: unknown;
}

function stringOr(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function packsOf(value: unknown): Record<string, readonly string[]> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, readonly string[]> = {};
  for (const [variant, list] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const ids = list.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length > 0) out[variant] = ids;
  }
  return out;
}

/**
 * Read a stored settings document. Storage is untrusted input, so every field is
 * coerced or dropped and anything unreadable reads as "no settings at all".
 *
 * A *partial* document is honoured field by field rather than rejected whole: a
 * settings shape that grows a field must not throw away what a player had
 * already chosen.
 */
export function parseSettings(text: string | undefined): Settings | undefined {
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const document = parsed as Partial<StoredDocument>;
  if (document.version !== DOCUMENT_VERSION) return undefined;
  if (typeof document.settings !== 'object' || document.settings === null) return undefined;

  const stored = document.settings as Partial<Record<keyof Settings, unknown>>;
  const controls = stringOr(stored.controls, DEFAULT_SETTINGS.controls);
  return {
    variant: stringOr(stored.variant, undefined),
    difficulty: stringOr(stored.difficulty, undefined),
    autoplay: stringOr(stored.autoplay, undefined),
    volume:
      typeof stored.volume === 'number' ? quantiseVolume(stored.volume) : DEFAULT_SETTINGS.volume,
    muted: typeof stored.muted === 'boolean' ? stored.muted : DEFAULT_SETTINGS.muted,
    crt: typeof stored.crt === 'boolean' ? stored.crt : DEFAULT_SETTINGS.crt,
    controls: (CONTROL_SCHEMES as readonly string[]).includes(controls ?? '')
      ? (controls as ControlScheme)
      : DEFAULT_SETTINGS.controls,
    packs: packsOf(stored.packs),
  };
}

/**
 * The keyboard map for a scheme.
 *
 * Derived from {@link DEFAULT_BINDINGS} by filtering rather than by three
 * hand-written tables, so a key added to the default map appears in whichever
 * schemes claim it and cannot be forgotten in one of them.
 *
 * **A scheme narrows the four directions and fire, and nothing else.** The
 * filter is stated that way round — everything else survives every scheme — so
 * that an action appended to {@link DEFAULT_BINDINGS} is in every scheme by
 * default rather than in none of them. A scheme that could not reopen the menu,
 * pause, or leave the game would be a setting a player could not undo.
 *
 * `up` and `down` are narrowed with `left` and `right` even though only the
 * cards read them, because a card is worked with all four (`./keys.ts`): on the
 * WASD scheme a settings screen that moved rows with the arrows and changed
 * them only with A and D would be two schemes at once.
 */
export function bindingsFor(scheme: ControlScheme): Readonly<Record<string, Action>> {
  if (scheme === 'both') return DEFAULT_BINDINGS;
  const arrows = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
  const wasd = new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyZ']);
  const keep = scheme === 'arrows' ? arrows : wasd;
  const played = new Set<Action>(['left', 'right', 'up', 'down', 'fire']);
  const out: Record<string, Action> = {};
  for (const [code, action] of Object.entries(DEFAULT_BINDINGS)) {
    if (!played.has(action) || keep.has(code)) out[code] = action;
  }
  return Object.freeze(out);
}

export interface SettingsStore {
  readonly value: Settings;
  /** False when the settings are session-only because storage is unavailable. */
  readonly persistent: boolean;
  /** Merge a patch in and persist. Returns the new value. */
  update: (patch: Partial<Settings>) => Settings;
}

export interface SettingsStoreOptions {
  readonly storage?: KeyedStorage;
  /** Used when storage holds nothing. Defaults to {@link DEFAULT_SETTINGS}. */
  readonly defaults?: Settings;
}

/**
 * Build the store.
 *
 * Reads once at construction, like the high-score board: settings change only
 * through {@link SettingsStore.update}, so nothing re-reads storage per frame.
 */
export function createSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  const { storage = createMemoryStorage(), defaults = DEFAULT_SETTINGS } = options;
  let value: Settings = parseSettings(storage.load()) ?? defaults;

  const persist = (): void => {
    const document: StoredDocument = { version: DOCUMENT_VERSION, settings: value };
    storage.save(JSON.stringify(document));
  };

  return {
    get value(): Settings {
      return value;
    },
    get persistent(): boolean {
      return storage.persistent;
    },
    update(patch: Partial<Settings>): Settings {
      const next: Settings = { ...value, ...patch };
      value = patch.volume === undefined ? next : { ...next, volume: quantiseVolume(next.volume) };
      persist();
      return value;
    },
  };
}
