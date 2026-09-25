/**
 * Reading a pack off disk. **Node only** — this is the one file in
 * `src/content/` that imports `node:fs`, so the browser build can take
 * `loader.ts` without dragging the filesystem in with it.
 *
 * Used by `scripts/validate-packs.ts` and by tests. The browser gets its packs
 * through `packSourceFromRecord` over a bundled `import.meta.glob` instead.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { ContentError } from './errors.js';
import type { PackDocument, PackSource } from './loader.js';
import { CONTENT_DIRS } from './schema.js';

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
