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
} from './schema.js';

/** Where a given id came from, when two packs both define it. */
export interface ContentSource {
  readonly packId: string;
  readonly file: string;
}

export interface ContentRegistry {
  /** The packs, in the order they were layered. */
  readonly packs: readonly LoadedPack[];
  /** The last pack layered, whose manifest and rules are in force. */
  readonly active: LoadedPack;
  readonly manifest: PackManifest;
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

/**
 * Layer packs into one registry. The last pack layered supplies the manifest
 * and rules in force; earlier packs contribute content it does not override.
 */
export function createRegistry(packs: readonly LoadedPack[]): ContentRegistry {
  const active = packs[packs.length - 1];
  if (active === undefined) throw new Error('a registry needs at least one loaded pack');

  const aliens = layer(packs, (pack) => pack.aliens);
  const paths = layer(packs, (pack) => pack.paths);
  const stages = layer(packs, (pack) => pack.stages);
  const sprites = layer(packs, (pack) => pack.sprites);
  const sounds = layer(packs, (pack) => pack.sounds);
  const formations = layer(packs, (pack) => pack.formations);

  const sources = new Map<string, ContentSource>();
  for (const pack of packs) {
    for (const [key, file] of pack.files) sources.set(key, { packId: pack.id, file });
  }

  return {
    packs,
    active,
    manifest: active.manifest,
    rules: active.rules,
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
