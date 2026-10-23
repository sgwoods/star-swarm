/**
 * The shelf: variations other players made, curated into this repository and
 * published with the game.
 *
 * **A shelf entry is a variant document like any other.** It is the text a
 * player's `EXPORT` card writes (`./exchange.ts`), saved as `shelf/<id>.json`
 * with two things said by hand: its `id`, which is the file's name, and its
 * `author`. It is loaded by the very passes a game in `variants/` is —
 * `resolveVariant` in `src/content/variants.ts`, the schema and then the
 * references — under {@link SHELF_GROUP}, so a failure names `shelf/<id>.json`.
 * There is no second store, no upload, and no weaker way in.
 *
 * **What this module adds is the shelf's own rules**, the things a document in
 * `variants/` is not asked because nobody outside the project writes one:
 *
 * - it takes no reference game's id, and not the shape the game gives a
 *   player's own variations (`classic-2`), so it can never be confused with a
 *   game in somebody's browser — or share that game's high-score table;
 * - it says who made it, in characters the pixel font can draw;
 * - its name is one the naming card could spell, and no reference game's or
 *   other entry's — the rule the naming card already holds a player to;
 * - it names the game it was made from, and that game is on offer here;
 * - it changes something from that game, because a copy of a reference is not a
 *   variation of it.
 *
 * Whether it **plays** is the gate's question, not this module's:
 * `npm run validate-packs` flies every entry through `scripts/playability.ts`,
 * the same pass every shipped game is flown through. The browser runs only the
 * rules above, as it runs only the loader for the shipped games: what reaches
 * `main` has been flown.
 *
 * **One entry never takes the others down.** `loadVariants` returns errors or
 * games, never both, because a malformed shipped game is a build that must not
 * boot. A shelf entry is somebody else's, so {@link loadShelf} returns both: each
 * entry that passes, and why each other one did not. The gate fails on any
 * error; the browser leaves a refused entry off the list and plays everything
 * else — a reference game can never be lost to a shelf entry.
 *
 * And **what an entry changes is derived, never declared** ({@link shelfChanges}):
 * the shelf page and the gate's report compare the entry with the game it was
 * made from, so the list of changes a visitor reads cannot disagree with what the
 * entry plays.
 */

import type { ContentError } from '../content/errors.js';
import type { LoadedPack } from '../content/loader.js';
import {
  resolveVariant,
  type ResolvedVariant,
  SHELF_GROUP,
  sortVariants,
  type VariantSource,
} from '../content/variants.js';
import { hasGlyph } from '../render/text.js';
import { spellable } from './variations.js';

/**
 * The longest `author` the shelf takes: what fits after `BY ` on the game list's
 * note line, twenty-four cells across (`./menus.ts`).
 */
export const AUTHOR_LENGTH = 21;

/**
 * The note under the game list for a shelf entry: who made it. The row's mark and
 * the legend explaining it are the list's own (`MENU_TEXT` in `./menus.ts`).
 */
export function byLine(author: string): string {
  return `BY ${author}`;
}

/** The query parameter a link to one game carries: the shelf page's `PLAY` is `./?game=<id>`. */
export const GAME_PARAMETER = 'game';

/** The address of the game with one game chosen, relative to a page beside `index.html`. */
export function playHref(id: string): string {
  return `./?${GAME_PARAMETER}=${encodeURIComponent(id)}`;
}

/**
 * The game a page's query string asks for, when it names one on offer — and
 * `undefined` otherwise, so that a stale or mistyped link plays whatever the
 * player would have had rather than failing.
 */
export function gameAsked(search: string, offered: readonly string[]): string | undefined {
  const id = new URLSearchParams(search).get(GAME_PARAMETER);
  return id !== null && offered.includes(id) ? id : undefined;
}

/* -------------------------------------------------------------------------- */
/* What an entry changes                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One way an entry plays differently from the game it was made from.
 *
 * Exactly the fields a variant document selects, and nothing finer: a variant
 * cannot override a rules number, so neither can an entry, and there is nothing
 * else for it to change.
 */
export type ShelfChange =
  | {
      readonly kind: 'packs';
      readonly packs: readonly string[];
      readonly was: readonly string[];
    }
  | {
      /** `stages` is its own combat order, or `undefined` for the packs' own. */
      readonly kind: 'stages';
      readonly stages: readonly string[] | undefined;
    }
  | { readonly kind: 'lives'; readonly lives: number; readonly was: number }
  | {
      readonly kind: 'theme';
      readonly theme: string | undefined;
      readonly was: string | undefined;
    }
  | { readonly kind: 'difficulty' }
  | { readonly kind: 'autoplay' };

/** JSON with its keys sorted, so two equal values compare equal whatever order they were written in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((id, index) => b[index] === id);
}

/**
 * How `entry` plays differently from `from`, field by field, compared as each
 * one plays rather than as it is written: a document stating the rules' own
 * starting count, or its packs' default theme, changes nothing.
 */
export function shelfChanges(
  entry: ResolvedVariant,
  from: ResolvedVariant,
): readonly ShelfChange[] {
  const changes: ShelfChange[] = [];
  if (!sameList(entry.packs, from.packs)) {
    changes.push({ kind: 'packs', packs: entry.packs, was: from.packs });
  }
  if (!sameList(entry.stages, from.stages)) changes.push({ kind: 'stages', stages: entry.stages });
  if (entry.lives !== from.lives)
    changes.push({ kind: 'lives', lives: entry.lives, was: from.lives });
  if (entry.theme !== from.theme)
    changes.push({ kind: 'theme', theme: entry.theme, was: from.theme });
  if (
    canonical(entry.presets) !== canonical(from.presets) ||
    entry.defaultPreset.id !== from.defaultPreset.id
  ) {
    changes.push({ kind: 'difficulty' });
  }
  if (
    canonical(entry.personas) !== canonical(from.personas) ||
    entry.defaultPersona?.id !== from.defaultPersona?.id
  ) {
    changes.push({ kind: 'autoplay' });
  }
  return changes;
}

/**
 * One change as a sentence a visitor can read, naming packs and themes as their
 * own documents name them. `from` is the game the entry was made from.
 */
export function changeText(
  change: ShelfChange,
  entry: ResolvedVariant,
  from: ResolvedVariant,
): string {
  const packName = (id: string): string =>
    entry.registry.packs.find((pack) => pack.id === id)?.manifest.name ??
    from.registry.packs.find((pack) => pack.id === id)?.manifest.name ??
    id;
  const themeName = (variant: ResolvedVariant, id: string | undefined): string =>
    variant.themes.find((theme) => theme.id === id)?.name ?? id ?? 'its own sound';
  const ships = (count: number): string => `${String(count)} ${count === 1 ? 'ship' : 'ships'}`;
  switch (change.kind) {
    case 'packs':
      return `Layers ${change.packs.map(packName).join(' + ')} — ${from.name} layers ${change.was.map(packName).join(' + ')}`;
    case 'stages':
      return change.stages === undefined
        ? `Plays its packs’ own order of stages — ${from.name} plays an order of its own`
        : `Plays its own order of ${String(change.stages.length)} combat ${change.stages.length === 1 ? 'stage' : 'stages'}`;
    case 'lives':
      return `Starts with ${ships(change.lives)} — ${from.name} starts with ${String(change.was)}`;
    case 'theme':
      return `Plays the ${themeName(entry, change.theme)} sound — ${from.name} plays ${themeName(from, change.was)}`;
    case 'difficulty':
      return 'Offers difficulty settings of its own';
    case 'autoplay':
      return 'Plays itself with autoplay personas of its own';
  }
}

/** One entry as the shelf page shows it: plain text throughout, never markup. */
export interface ShelfCard {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  /** The maker's own line about it, when the document has one. */
  readonly description: string | undefined;
  /** The name of the game it was made from, credited when that is another entry. */
  readonly from: string;
  /** What it changes, one sentence each, in the order {@link shelfChanges} finds them. */
  readonly changes: readonly string[];
  /** Where `PLAY` goes: the game, with this one chosen. */
  readonly href: string;
}

/** What the shelf page says about one entry. Pure, so the page's text is tested on Node. */
export function shelfCard(entry: ShelfEntry): ShelfCard {
  const { variant, from, changes } = entry;
  return {
    id: variant.id,
    name: variant.name,
    author: variant.author ?? '',
    description: variant.description,
    from:
      from.group === SHELF_GROUP && from.author !== undefined
        ? `${from.name}, by ${from.author}`
        : from.name,
    changes: changes.map((change) => changeText(change, variant, from)),
    href: playHref(variant.id),
  };
}

/* -------------------------------------------------------------------------- */
/* Loading the shelf                                                           */
/* -------------------------------------------------------------------------- */

/** One entry that passed the shelf's rules: the game, and what it changes. */
export interface ShelfEntry {
  readonly variant: ResolvedVariant;
  /** The game it was made from: a reference game, or another entry on the shelf. */
  readonly from: ResolvedVariant;
  /** Never empty: an entry that changes nothing is refused. */
  readonly changes: readonly ShelfChange[];
}

export interface ShelfLoad {
  /** Every entry that passed, in shelf order: `order`, then id. */
  readonly entries: readonly ShelfEntry[];
  /** Why each other one did not, filed under `shelf/<id>.json`. */
  readonly errors: readonly ContentError[];
}

/** The shape the game gives a player's own variation: a game's id, a hyphen, a number. */
const VARIATION_ID = /-\d+$/;

/**
 * Load the shelf against the packs this build installs and the reference games
 * it ships. Each document is judged on its own, so one that fails costs only
 * itself; see the module comment for why that is not the shipped games' rule.
 */
export function loadShelf(
  sources: readonly VariantSource[],
  packs: ReadonlyMap<string, LoadedPack>,
  references: readonly ResolvedVariant[],
): ShelfLoad {
  const errors: ContentError[] = [];
  const reserved = references.map((reference) => reference.id);
  /** Entries with a problem of their own, which nothing past them may stand on. */
  const refused = new Set<ResolvedVariant>();
  const fail = (variant: ResolvedVariant, field: string | undefined, message: string): void => {
    refused.add(variant);
    errors.push(
      field === undefined
        ? { pack: SHELF_GROUP, file: variant.file, message }
        : { pack: SHELF_GROUP, file: variant.file, field, message },
    );
  };

  // Pass 1: each document alone — the loader's two passes, then the rules that
  // need nothing but the document. A document the loader refuses stops here; one
  // that loads goes on to pass 2 whatever else is wrong with it, so one run of
  // the gate names every problem an entry has rather than the first.
  const loaded: ResolvedVariant[] = [];
  for (const source of [...sources].sort((a, b) => a.file.localeCompare(b.file))) {
    const result = resolveVariant(source, packs, {}, { group: SHELF_GROUP, reserved });
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    const variant = result.variant;
    loaded.push(variant);
    if (VARIATION_ID.test(variant.id)) {
      fail(
        variant,
        'id',
        `"${variant.id}" is the shape the game gives a player's own variation; choose an id ` +
          'of your own, such as "dusk-patrol", and name the file after it',
      );
    }
    if (variant.author === undefined) {
      fail(variant, 'author', 'a shelf entry says who made it: add "author" with your name');
    } else if (
      variant.author.trim().length === 0 ||
      variant.author.length > AUTHOR_LENGTH ||
      ![...variant.author].every(hasGlyph)
    ) {
      fail(
        variant,
        'author',
        `"${variant.author}" must be 1 to ${String(AUTHOR_LENGTH)} characters the game's ` +
          'pixel font draws: letters, digits, spaces and plain punctuation',
      );
    }
    if (spellable(variant.name) !== variant.name || variant.name.trim().length === 0) {
      fail(
        variant,
        'name',
        `"${variant.name}" is not a name the naming card can spell: up to 14 of A-Z, 0-9, ` +
          'space, - and .',
      );
    }
  }

  // Pass 2: the rules that compare entries with the games on offer — names, and
  // the game each was made from — then what each changes.
  const offered = new Map<string, ResolvedVariant>(
    [...references, ...loaded].map((variant) => [variant.id, variant]),
  );
  const names = new Map<string, string>(
    references.map((reference) => [reference.name.trim().toUpperCase(), reference.name]),
  );
  const entries: ShelfEntry[] = [];
  for (const variant of loaded) {
    const name = variant.name.trim().toUpperCase();
    if (names.has(name)) {
      fail(
        variant,
        'name',
        `"${variant.name}" is the name of a game already on offer; a variation has a name of its own`,
      );
    }
    names.set(name, variant.name);

    const from = variant.derivedFrom === undefined ? undefined : offered.get(variant.derivedFrom);
    if (variant.derivedFrom === undefined) {
      fail(
        variant,
        'derivedFrom',
        'a shelf entry names the game it was made from; the EXPORT card writes it',
      );
    } else if (from === undefined || from === variant) {
      fail(
        variant,
        'derivedFrom',
        `"${variant.derivedFrom}" is no game this build offers: name a game in variants/ or ` +
          'another entry on the shelf',
      );
    }
    if (from === undefined || from === variant) continue;

    const changes = shelfChanges(variant, from);
    if (changes.length === 0) {
      fail(
        variant,
        undefined,
        `it plays exactly as ${from.name} does; a variation changes something`,
      );
      continue;
    }
    if (!refused.has(variant)) entries.push({ variant, from, changes });
  }

  // An entry made from another entry stands only while that one does: a visitor
  // told "made from REEFS" has to find REEFS on the list. Repeated, because the
  // one it was made from may have been made from a third.
  for (let pruned = true; pruned;) {
    pruned = false;
    const standing = new Set(entries.map((entry) => entry.variant));
    for (const entry of [...entries]) {
      if (entry.from.group !== SHELF_GROUP || standing.has(entry.from)) continue;
      fail(
        entry.variant,
        'derivedFrom',
        `"${entry.from.id}" is an entry the shelf refused, so this one cannot say what it changes`,
      );
      entries.splice(entries.indexOf(entry), 1);
      pruned = true;
    }
  }

  const order = new Map(sortVariants(entries.map((entry) => entry.variant)).map((v, i) => [v, i]));
  entries.sort((a, b) => (order.get(a.variant) ?? 0) - (order.get(b.variant) ?? 0));
  return { entries, errors };
}
