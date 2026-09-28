/**
 * Reading a pack off disk. **Node only** — this is the one file in
 * `src/content/` that imports `node:fs`, so the browser build can take
 * `loader.ts` without dragging the filesystem in with it.
 *
 * Used by `scripts/validate-packs.ts` and by tests. The browser gets its packs
 * through `packSourceFromRecord` over a bundled `import.meta.glob` instead.
 *
 * It reads `variants/` too ({@link readVariantSources}), for the same reason and
 * with the same twin in `./bundle.ts`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { ContentError } from './errors.js';
import type { PackDocument, PackSource } from './loader.js';
import { CONTENT_DIRS } from './schema.js';
import { VARIANTS_GROUP, type VariantSource } from './variants.js';

/** Files that are bookkeeping rather than content. */
const IGNORED_FILES = new Set(['.gitkeep', '.DS_Store', 'README.md']);

export interface ReadPackResult {
  readonly source: PackSource | undefined;
  /** JSON that would not parse, or a missing manifest. Reported before schemas run. */
  readonly errors: readonly ContentError[];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listDir(path: string): string[] {
  return readdirSync(path)
    .filter((name) => !IGNORED_FILES.has(name))
    .sort();
}

/** Every `*.json` beneath `dir`, as paths relative to `relativeTo`. */
function jsonFilesUnder(dir: string, relativeTo: string): string[] {
  const out: string[] = [];
  for (const name of listDir(dir)) {
    const path = join(dir, name);
    if (isDirectory(path)) out.push(...jsonFilesUnder(path, relativeTo));
    else if (name.endsWith('.json')) out.push(path.slice(relativeTo.length + 1));
  }
  return out;
}

/**
 * Read a pack directory into a `PackSource`. Parse failures come back as errors
 * rather than exceptions, so one unparseable file does not hide the rest.
 */
export function readPackSource(packDir: string): ReadPackResult {
  const name = basename(packDir);
  const errors: ContentError[] = [];

  const readJson = (relativePath: string): { found: boolean; value: unknown } => {
    const path = join(packDir, relativePath);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return { found: false, value: undefined };
    }
    try {
      return { found: true, value: JSON.parse(text) };
    } catch (error) {
      errors.push({
        pack: name,
        file: relativePath,
        message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      return { found: true, value: undefined };
    }
  };

  const manifest = readJson('pack.json');
  if (!manifest.found) {
    errors.push({ pack: name, file: 'pack.json', message: 'pack has no pack.json' });
  }

  const rules = readJson('rules.json');

  const documents: PackDocument[] = [];
  for (const kind of CONTENT_DIRS) {
    const dir = join(packDir, kind);
    if (!isDirectory(dir)) continue;
    for (const file of jsonFilesUnder(dir, packDir)) {
      const parsed = readJson(file);
      if (parsed.value === undefined) continue;
      documents.push({ kind, file, value: parsed.value });
    }
  }

  if (errors.length > 0) return { source: undefined, errors };

  const source: PackSource = rules.found
    ? { name, origin: packDir, manifest: manifest.value, rules: rules.value, documents }
    : { name, origin: packDir, manifest: manifest.value, documents };
  return { source, errors };
}

/** The pack directories directly under `packsRoot`, in name order. */
export function listPackDirs(packsRoot: string): string[] {
  if (!isDirectory(packsRoot)) return [];
  return listDir(packsRoot)
    .map((name) => join(packsRoot, name))
    .filter(isDirectory);
}

/* -------------------------------------------------------------------------- */
/* Variants                                                                    */
/* -------------------------------------------------------------------------- */

export interface ReadVariantsResult {
  readonly sources: readonly VariantSource[];
  /** JSON that would not parse. Reported before schemas run, as for a pack. */
  readonly errors: readonly ContentError[];
}

/**
 * Read every `variants/*.json` into the shape `loadVariants` takes.
 *
 * An absent or empty directory is not an error here: a repository with no
 * variant documents has no games to offer, which `scripts/validate-packs.ts`
 * reports and `src/main.ts` refuses to boot on — but it is not a *malformed*
 * tree, and this reader only reads.
 */
export function readVariantSources(variantsRoot: string): ReadVariantsResult {
  if (!isDirectory(variantsRoot)) return { sources: [], errors: [] };

  const sources: VariantSource[] = [];
  const errors: ContentError[] = [];

  for (const name of listDir(variantsRoot)) {
    const path = join(variantsRoot, name);
    if (isDirectory(path) || !name.endsWith('.json')) continue;
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      errors.push({
        pack: VARIANTS_GROUP,
        file: name,
        message: `could not be read: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    try {
      sources.push({ file: name, value: JSON.parse(text) });
    } catch (error) {
      errors.push({
        pack: VARIANTS_GROUP,
        file: name,
        message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return { sources, errors };
}
