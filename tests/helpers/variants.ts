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
