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
 * | `variations` | the games the player has made, each a whole variant document  |
 *
 * **A shipped game is a reference, and nothing here can change one.** There is
 * no per-game override in this shape any more: an edit to a shipped game is a
 * new variant document — a *variation* — kept here beside the others, and the
 * shipped game plays as it ships because nothing stored is ever composed over
 * it. A variation is the player's sandbox and is edited in place.
 *
 * Persistence is {@link KeyedStorage} from `./storage.ts` — the same interface
 * the high-score table uses, for the same reason: blocked or unavailable browser
 * storage must degrade to defaults rather than throw. A store that cannot write
 * reports `persistent: false` and the settings last as long as the tab.
 *
 * ## The stored shape
 *
 * One JSON document under {@link SETTINGS_STORAGE_KEY}:
 *
 * ```
 * { "version": 2,
 *   "settings": { "variant": "classic-2", "difficulty": "arcade", "autoplay": undefined,
 *                 "volume": 0.7, "muted": false, "crt": false, "controls": "both",
 *                 "variations": [ { "id": "classic-2", "name": "STAR SWARM 2",
 *                                   "derivedFrom": "classic", "packs": [...], ... } ] } }
 * ```
 *
 * Each entry of `variations` is a variant document exactly as `variants/<id>.json`
 * would hold it (`src/content/variants.ts`), kept **as written**: it is validated
 * when it is played, never coerced when it is read, so a variation this build
 * cannot load — a pack it names is not installed, a field a later build added —
 * is still listed, still deletable, and comes back the day it loads again.
 *
 * **Version 1 is read, once, and never written.** It kept a per-variant pack
 * list and stage order (`packs` and `stages`, keyed by variant id) composed over
 * the shipped game itself, so an edit to Classic was what CLASSIC played. Reading
 * one turns every such override into a variation of the game it was stored
 * against ({@link SettingsStoreOptions.upgrade}), selects the one that was
 * playing, and writes version 2 straight back — so the override tables exist on
 * the first run after the change and on no run after it. Nothing a player made is
 * dropped by the migration, including an override that no longer loads.
 */

import { deriveVariant, isVariantDocument, type VariantDocument } from '../content/variants.js';
import { type Action, DEFAULT_BINDINGS } from '../engine/input.js';
import { createMemoryStorage, type KeyedStorage } from './storage.js';

/**
 * Key the browser implementation stores under. The `v1` is the key's, not the
 * document's: the document carries its own `version`, and the key stays put so
 * that the reader of a newer document is the one that finds an older one.
 */
export const SETTINGS_STORAGE_KEY = 'star-swarm/settings/v1';

/**
 * A variation as stored: a variant document with an `id` to address it by, and
 * everything else exactly as written.
 */
export type VariationDocument = VariantDocument & { readonly id: string };

/**
 * The longest name a variation may have. The settings card's value column is
 * fourteen cells of the fixed-advance font, and a name is what the `GAME` row
 * shows.
 */
export const VARIATION_NAME_LENGTH = 14;

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
   * The games the player has made, in the order they were made: each one a
   * variant document derived from a shipped game (`deriveVariant` in
   * `src/content/variants.ts`), named, and the player's own to edit and delete.
   *
   * Documents rather than ids, because a variation exists nowhere else — and
   * documents **as written** rather than resolved ones, for the reason `variant`
   * is an id: a stored variation naming a pack this build does not install is
   * **kept**, not repaired. The flow lists it, plays the game it was made from
   * in its place and says why (`./flow.ts`), and the pack manager is where it is
   * mended. `variant` names a variation by its `id` exactly as it names a
   * shipped game.
   */
  readonly variations: readonly VariationDocument[];
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  variant: undefined,
  difficulty: undefined,
  autoplay: undefined,
  volume: 0.7,
  muted: false,
  crt: false,
  controls: 'both',
  variations: Object.freeze([]),
} satisfies Settings);

/** Clamp a volume to 0…1 on the menu's own grid, so a stored float cannot drift. */
export function quantiseVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_SETTINGS.volume;
  const steps = Math.round(Math.min(1, Math.max(0, volume)) * VOLUME_STEPS);
  return steps / VOLUME_STEPS;
}

/** The document shape on disk. Bumped if the shape ever changes. */
const DOCUMENT_VERSION = 2;

/** The one earlier shape this build still reads. */
const LEGACY_VERSION = 1;

interface StoredDocument {
  readonly version: number;
  readonly settings: unknown;
}

function stringOr(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** A per-variant table of id lists — version 1's `packs` and `stages` — coerced from storage. */
function listsOf(value: unknown): Record<string, readonly string[]> {
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
 * The stored variations: every entry that is an object with an `id`, as written.
 *
 * The one thing dropped is what cannot be addressed — an entry with no usable id,
 * or a second entry under an id already read — because a variation the player
 * cannot select or delete is not one they have. Nothing else is coerced: whether
 * a document loads is the loader's question, asked when it is played.
 */
function variationsOf(value: unknown): VariationDocument[] {
  if (!Array.isArray(value)) return [];
  const out: VariationDocument[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isVariantDocument(entry)) continue;
    const id = entry.id;
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(entry as VariationDocument);
  }
  return out;
}

/**
 * What a version 1 document kept per variant: the pack list and the stage order
 * the pack manager composed over the shipped game itself. Read only to be turned
 * into variations.
 */
export interface LegacyOverrides {
  readonly packs: Readonly<Record<string, readonly string[]>>;
  readonly stages: Readonly<Record<string, readonly string[]>>;
}

/**
 * A shipped game, as a version 1 document's overrides are turned into variations
 * of it: its id, its display name, and its document as JSON holds it.
 */
export interface LegacyBase {
  readonly id: string;
  readonly name: string;
  readonly document: VariantDocument;
}

/**
 * A fresh variation id: the base's id and the smallest number from 2 that no
 * game has. `classic` → `classic-2`, then `classic-3`.
 */
export function freshVariationId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 2; ; n += 1) {
    const id = `${base}-${String(n)}`;
    if (!used.has(id)) return id;
  }
}

/**
 * A fresh variation name: the base's name and the smallest number from 2 that no
 * game is called, cut to fit {@link VARIATION_NAME_LENGTH}. `STAR SWARM` →
 * `STAR SWARM 2`. The player renames it on the card that follows.
 */
export function freshVariationName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.trim().toUpperCase()));
  for (let n = 2; ; n += 1) {
    const suffix = ` ${String(n)}`;
    const stem = base
      .toUpperCase()
      .slice(0, VARIATION_NAME_LENGTH - suffix.length)
      .trimEnd();
    const name = `${stem}${suffix}`;
    if (!used.has(name)) return name;
  }
}

/**
 * Turn version 1's overrides into variations, one per variant that had either,
 * and select the one that was playing.
 *
 * Each becomes {@link deriveVariant} of the game it was stored against, with that
 * override's pack list (or the game's own, when only an order was stored) and
 * stage order. "The one that was playing" is the variant version 1 would have
 * composed: the remembered one if it is among `bases`, else the first of them, as
 * the old flow fell back. An override for a game `bases` does not hold — or every
 * override, when no bases are given — still becomes a variation, of the four
 * fields it can state; it may not load, and is kept and listed like any other
 * variation that does not.
 *
 * **One-way.** The overrides are not in what this returns, and version 2 has
 * nowhere to put them.
 */
export function upgradeLegacy(
  legacy: LegacyOverrides,
  settings: Settings,
  bases: readonly LegacyBase[] = [],
): Settings {
  const ids = [...new Set([...Object.keys(legacy.packs), ...Object.keys(legacy.stages)])];
  if (ids.length === 0) return settings;
  const playing =
    (bases.find((base) => base.id === settings.variant) ?? bases[0])?.id ?? settings.variant;
  const takenIds = new Set([
    ...bases.map((base) => base.id),
    ...settings.variations.map((v) => v.id),
  ]);
  const takenNames = new Set([
    ...bases.map((base) => base.name),
    ...settings.variations.map((v) => (typeof v.name === 'string' ? v.name : '')),
  ]);
  const made: VariationDocument[] = [];
  let variant = settings.variant;
  for (const from of ids) {
    const base = bases.find((candidate) => candidate.id === from);
    const id = freshVariationId(from, takenIds);
    const name = freshVariationName(base?.name ?? from, takenNames);
    takenIds.add(id);
    takenNames.add(name);
    const own = base === undefined ? [] : stringList(base.document.packs);
    const document = deriveVariant(base?.document, {
      id,
      name,
      from,
      packs: legacy.packs[from] ?? own,
      stages: legacy.stages[from],
    });
    made.push({ ...document, id });
    if (from === playing) variant = id;
  }
  return { ...settings, variant, variations: [...settings.variations, ...made] };
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/** The fields both document versions share, coerced. */
function commonOf(stored: Partial<Record<string, unknown>>): Settings {
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
    variations: variationsOf(stored.variations),
  };
}

/** What reading a stored document found, and whether it was the older shape. */
export interface ParsedSettings {
  readonly settings: Settings;
  /** True when the document was version 1, so what is read differs from what is stored. */
  readonly upgraded: boolean;
}

/**
 * Read a stored settings document. Storage is untrusted input, so every field is
 * coerced or dropped and anything unreadable reads as "no settings at all".
 *
 * A *partial* document is honoured field by field rather than rejected whole: a
 * settings shape that grows a field must not throw away what a player had
 * already chosen. A version 1 document is read the same way and its overrides
 * handed to {@link upgradeLegacy} with `bases`.
 */
export function readSettings(
  text: string | undefined,
  bases: readonly LegacyBase[] = [],
): ParsedSettings | undefined {
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const document = parsed as Partial<StoredDocument>;
  if (typeof document.settings !== 'object' || document.settings === null) return undefined;
  const stored = document.settings as Partial<Record<string, unknown>>;

  if (document.version === DOCUMENT_VERSION) {
    return { settings: commonOf(stored), upgraded: false };
  }
  if (document.version === LEGACY_VERSION) {
    // Version 1 had no variations, so anything under that name is not one.
    const settings = commonOf({ ...stored, variations: undefined });
    const legacy = { packs: listsOf(stored.packs), stages: listsOf(stored.stages) };
    return { settings: upgradeLegacy(legacy, settings, bases), upgraded: true };
  }
  return undefined;
}

/** {@link readSettings}, for a caller that only wants the value. */
export function parseSettings(
  text: string | undefined,
  bases: readonly LegacyBase[] = [],
): Settings | undefined {
  return readSettings(text, bases)?.settings;
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
  /**
   * The shipped games, in selector order, that a version 1 document's overrides
   * become variations of ({@link upgradeLegacy}). `src/main.ts` hands in every
   * variant the build loaded. Omitted, an override still becomes a variation —
   * of the four fields it can state, without its game's presets or personas —
   * which is what a store built with no games behind it can do.
   */
  readonly upgrade?: readonly LegacyBase[];
}

/**
 * Build the store.
 *
 * Reads once at construction, like the high-score board: settings change only
 * through {@link SettingsStore.update}, so nothing re-reads storage per frame.
 * A version 1 document is upgraded on that read and the result written straight
 * back, so the upgrade happens once, on the first run, whatever the player does.
 */
export function createSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  const { storage = createMemoryStorage(), defaults = DEFAULT_SETTINGS } = options;
  const read = readSettings(storage.load(), options.upgrade);
  let value: Settings = read?.settings ?? defaults;

  const persist = (): void => {
    const document: StoredDocument = { version: DOCUMENT_VERSION, settings: value };
    storage.save(JSON.stringify(document));
  };

  if (read?.upgraded === true) persist();

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
