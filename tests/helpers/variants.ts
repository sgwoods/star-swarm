/**
 * The variants this repository ships, read off disk through the real readers and
 * the real loaders — once per test process.
 *
 * A fixture rather than inline setup for the same reason `./rules.ts` is one: a
 * test asserting something about the shipped games must read them the way the
 * game does, and several tests need the *same* load because they compare
 * identities (the demonstration variant runs the Classic rules document itself,
 * not a copy of it).
 */

import { resolve } from 'node:path';

import { listPackDirs, readPackSource, readVariantSources } from '../../src/content/fs.js';
import type { LoadedPack } from '../../src/content/loader.js';
import { loadPackOrThrow } from '../../src/content/loader.js';
import type { Rules } from '../../src/content/schema.js';
import type { ResolvedVariant } from '../../src/content/variants.js';
import { loadVariantsOrThrow } from '../../src/content/variants.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

let cachedPacks: Map<string, LoadedPack> | undefined;
let cachedVariants: readonly ResolvedVariant[] | undefined;

/** Every pack under `packs/`, keyed by id, as `src/main.ts` loads them. */
export function installedPacks(): ReadonlyMap<string, LoadedPack> {
  if (cachedPacks !== undefined) return cachedPacks;
  const packs = new Map<string, LoadedPack>();
  for (const dir of listPackDirs(resolve(REPO_ROOT, 'packs'))) {
    const { source, errors } = readPackSource(dir);
    if (source === undefined) {
      throw new Error(`could not read ${dir}: ${JSON.stringify(errors)}`);
    }
    const pack = loadPackOrThrow(source);
    packs.set(pack.id, pack);
  }
  cachedPacks = packs;
  return packs;
}

/** Every variant under `variants/`, resolved, in selector order. */
export function shippedVariants(): readonly ResolvedVariant[] {
  if (cachedVariants !== undefined) return cachedVariants;
  const { sources, errors } = readVariantSources(resolve(REPO_ROOT, 'variants'));
  if (errors.length > 0) throw new Error(`variants/ is unreadable: ${JSON.stringify(errors)}`);
  cachedVariants = loadVariantsOrThrow(sources, installedPacks());
  return cachedVariants;
}

/**
 * One installed pack by id, through the same loader {@link installedPacks} uses.
 *
 * Exists so a document's counters can be derived from a pack the fixtures in
 * `./rules.ts` know nothing about: those read the Classic pack directly because
 * almost every test needs it, and a second named fixture per forged pack would be
 * one edit per pack. Throws rather than returning `undefined`, because a counter
 * that quietly returned 0 would let a document keep claiming a pack that had gone.
 */
export function installedPack(id: string): LoadedPack {
  const pack = installedPacks().get(id);
  if (pack === undefined) {
    throw new Error(
      `no installed pack "${id}" — packs/ holds ${[...installedPacks().keys()].join(', ')}`,
    );
  }
  return pack;
}

/**
 * What of `own` is not `base`'s own object, with the ranks' stage sequences set
 * aside — empty when an overlay runs its base pack's rules document rather than a
 * copy of it.
 *
 * The sequences are set aside because an overlay that states a half of its own
 * supersedes every rank's override of that half (`composeRules`), so those are the
 * one part of the document it may legitimately not share. Everything else is
 * compared by identity, table by table.
 */
export function unsharedRules(own: Rules, base: Rules): string[] {
  const unshared: string[] = (Object.keys(base) as (keyof Rules)[]).filter(
    (key) => key !== 'difficulty' && own[key] !== base[key],
  );
  if (own.difficulty.defaultRank !== base.difficulty.defaultRank) {
    unshared.push('difficulty.defaultRank');
  }
  for (const [id, rank] of Object.entries(base.difficulty.ranks)) {
    const mine = own.difficulty.ranks[id];
    if (mine?.stageTable !== rank.stageTable) unshared.push(`difficulty.ranks.${id}.stageTable`);
    if (mine?.label !== rank.label) unshared.push(`difficulty.ranks.${id}.label`);
  }
  return unshared;
}
