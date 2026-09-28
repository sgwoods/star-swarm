/**
 * The content registry — `docs/DESIGN.md` section 9.
 *
 * One or more loaded packs, presented to the rest of the game as a single
 * lookup. Packs are layered in the order given and later ones win, which is
 * what makes "Classic + Weird" (section 6) a matter of listing two packs rather
 * than editing either.
 *
 * Every pack in a registry has already passed `loadPack`, so there is no such
 * thing as a registry holding content that failed validation.
 *
 * **"Later wins" reaches the manifest and the rules, not only the content maps.**
 * See {@link composeManifest}: an overlay pack states what it changes, and every
 * field it leaves out it inherits. A single-pack registry gets its own manifest
 * and its own rules back unchanged, so this is a generalisation of the rule
 * above rather than a second rule beside it.
 */

import type { LoadedPack } from './loader.js';
import type {
  Alien,
  Formation,
  MovementPath,
  PackManifest,
  Rules,
  Sound,
  Sprite,
  Stage,
  StageSequence,
} from './schema.js';

/** One half of a stage sequence, as the schema infers it. */
type SequenceTable = StageSequence['normal'];

/** Where a given id came from, when two packs both define it. */
export interface ContentSource {
  readonly packId: string;
  readonly file: string;
}

export interface ContentRegistry {
  /** The packs, in the order they were layered. */
  readonly packs: readonly LoadedPack[];
  /** The last pack layered, whose identity the registry reports. */
  readonly active: LoadedPack;
  /** The manifest in force: the layered packs' manifests, composed field by field. */
  readonly manifest: PackManifest;
  /** The rules in force: the last layered pack that ships a `rules.json`. */
  readonly rules: Rules | undefined;

  alien(id: string): Alien | undefined;
  path(id: string): MovementPath | undefined;
  stage(id: string): Stage | undefined;
  sprite(id: string): Sprite | undefined;
  sound(id: string): Sound | undefined;
  formation(id: string): Formation | undefined;

  readonly aliens: ReadonlyMap<string, Alien>;
  readonly paths: ReadonlyMap<string, MovementPath>;
  readonly stages: ReadonlyMap<string, Stage>;
  readonly sprites: ReadonlyMap<string, Sprite>;
  readonly sounds: ReadonlyMap<string, Sound>;
  readonly formations: ReadonlyMap<string, Formation>;

  /** Which pack and file an id resolved to. For the `/lab` previewer and errors. */
  sourceOf(
    kind: 'aliens' | 'paths' | 'stages' | 'sprites' | 'sounds',
    id: string,
  ): ContentSource | undefined;
}

function layer<T>(
  packs: readonly LoadedPack[],
  pick: (pack: LoadedPack) => ReadonlyMap<string, T>,
): Map<string, T> {
  const merged = new Map<string, T>();
  for (const pack of packs) {
    for (const [id, value] of pick(pack)) merged.set(id, value);
  }
  return merged;
}

/** Merge a manifest record per key, later packs winning. */
function mergeRecords<T>(
  packs: readonly LoadedPack[],
  pick: (manifest: PackManifest) => Readonly<Record<string, T>>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const pack of packs) Object.assign(out, pick(pack.manifest));
  return out;
}

/** The last non-empty value, or the empty one if no pack stated anything. */
function lastStated<T>(
  packs: readonly LoadedPack[],
  pick: (manifest: PackManifest) => T,
  isStated: (value: T) => boolean,
  empty: T,
): T {
  for (let index = packs.length - 1; index >= 0; index -= 1) {
    const pack = packs[index];
    if (pack === undefined) continue;
    const value = pick(pack.manifest);
    if (isStated(value)) return value;
  }
  return empty;
}

const EMPTY_TABLE: SequenceTable = { rows: [], repeatLast: 1 };

/**
 * Compose the manifests of the layered packs into the one in force.
 *
 * `docs/DESIGN.md` section 6 promises that "Classic + Weird" is a list of packs
 * rather than an edit to either, and an **overlay pack** is how that is written:
 * a `pack.json` stating only what it changes. Every field of the manifest has a
 * schema default, so taking the last pack's manifest whole would turn such a
 * pack into a game with no roles, no formation and no stage sequence. Each field
 * is therefore layered on its own terms:
 *
 * - **`roles`, `formations` and `sounds` merge per key**, later winning — the
 *   same rule the content maps follow, and for the same reason.
 * - **`palette` is a union**, in layering order. It is a *permission list*:
 *   `src/render/sprites.ts` checks membership in it and never indexes it, so an
 *   overlay adding two colours must not have to restate the base's fourteen.
 * - **`stageBadges`, and each half of `stageSequence` on its own, are replaced by
 *   the last pack that states a non-empty one.** Those are ordered tables where a
 *   per-entry merge would mean nothing — a sequence is a sequence, not a set —
 *   and the two halves move separately because they already plateau separately.
 * - **`id`, `name`, `version` and `description` come from the last pack**, which
 *   is the one the registry reports as {@link ContentRegistry.active}.
 *
 * Nothing here can *remove* a field: an overlay widens or replaces, never
 * empties. A game that wants no stage badges layers a base that has none.
 */
export function composeManifest(packs: readonly LoadedPack[]): PackManifest {
  const active = packs[packs.length - 1];
  if (active === undefined) throw new Error('composing a manifest needs at least one loaded pack');
  if (packs.length === 1) return active.manifest;

  const palette: string[] = [];
  for (const pack of packs) {
    for (const colour of pack.manifest.palette) if (!palette.includes(colour)) palette.push(colour);
  }

  const half = (pick: (sequence: StageSequence) => SequenceTable): SequenceTable =>
    lastStated(
      packs,
      (manifest) => pick(manifest.stageSequence),
      (table) => table.rows.length > 0,
      EMPTY_TABLE,
    );

  const stageSequence: StageSequence = {
    normal: half((sequence) => sequence.normal),
    challenge: half((sequence) => sequence.challenge),
  };

  return {
    ...active.manifest,
    palette,
    roles: mergeRecords(packs, (manifest) => manifest.roles),
    formations: mergeRecords(packs, (manifest) => manifest.formations),
    sounds: mergeRecords(packs, (manifest) => manifest.sounds),
    stageBadges: lastStated(
      packs,
      (manifest) => manifest.stageBadges,
      (badges) => badges.length > 0,
      [],
    ),
    stageSequence,
  };
}

/**
 * The rules in force: the **last layered pack that ships a `rules.json`**.
 *
 * Not simply the last pack's, because an overlay that changes only art or a
 * flight path ships no rules document, and reading `undefined` off it would hand
 * the simulation no rules at all — `createWorld` requires them, so the game
 * would refuse to start over a pack that had nothing to say about rules.
 */
export function composeRules(packs: readonly LoadedPack[]): Rules | undefined {
  for (let index = packs.length - 1; index >= 0; index -= 1) {
    const rules = packs[index]?.rules;
    if (rules !== undefined) return rules;
  }
  return undefined;
}

/**
 * Layer packs into one registry. Content, the manifest and the rules all follow
 * "later wins"; see {@link composeManifest} for what that means field by field.
 */
export function createRegistry(packs: readonly LoadedPack[]): ContentRegistry {
  const active = packs[packs.length - 1];
  if (active === undefined) throw new Error('a registry needs at least one loaded pack');

  const manifest = composeManifest(packs);
  const aliens = layer(packs, (pack) => pack.aliens);
  const paths = layer(packs, (pack) => pack.paths);
  const stages = layer(packs, (pack) => pack.stages);
  const sprites = layer(packs, (pack) => pack.sprites);
  const sounds = layer(packs, (pack) => pack.sounds);
  // From the composed manifest rather than layered separately: formations live in
  // the manifest, so two merges of the same data are two chances to disagree.
  const formations = new Map(Object.entries(manifest.formations));

  const sources = new Map<string, ContentSource>();
  for (const pack of packs) {
    for (const [key, file] of pack.files) sources.set(key, { packId: pack.id, file });
  }

  return {
    packs,
    active,
    manifest,
    rules: composeRules(packs),
    alien: (id) => aliens.get(id),
    path: (id) => paths.get(id),
    stage: (id) => stages.get(id),
    sprite: (id) => sprites.get(id),
    sound: (id) => sounds.get(id),
    formation: (id) => formations.get(id),
    aliens,
    paths,
    stages,
    sprites,
    sounds,
    formations,
    sourceOf: (kind, id) => sources.get(`${kind}:${id}`),
  };
}
