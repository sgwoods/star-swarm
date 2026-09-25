/**
 * Reading packs from the **bundler**. The browser-side twin of `./fs.js`.
 *
 * `fs.ts` walks a pack directory with `node:fs` for the validator and for tests;
 * this walks the same tree at build time with Vite's `import.meta.glob`, so the
 * browser gets its packs without a filesystem and without a fetch. Both hand
 * back a `PackSource`, and both are consumed by the one `loadPack` — the game,
 * the previewer and the gate cannot disagree about what a pack contains.
 *
 * **Every document the tree holds, not a list of the ones we remembered.** The
 * literal list this replaces named `pack.json` and `rules.json` only, so the
 * moment `pack.json` referenced a sound the reference pass could not resolve it,
 * and the game refused to boot while every from-disk test still passed. A glob
 * cannot fall behind the tree that way. `tests/unit/bundled-packs.test.ts` holds
 * the two sides to each other.
 *
 * Like `fs.ts`, this is deliberately **not** re-exported from `./index.js`:
 * `import.meta.glob` is a Vite transform, so a plain Node process — `tsx
 * scripts/validate-packs.ts`, say — would import a module whose glob never ran.
 */

import type { PackDocument, PackSource } from './loader.js';
import { CONTENT_DIRS } from './schema.js';

/**
 * Every JSON file under `packs/`, keyed by its path from the project root.
 *
 * Eager, because a pack is small, the game needs it before the first frame and
 * a lazily-imported pack would make `loadPack` async for no gain.
 */
const PACK_FILES = import.meta.glob<unknown>('/packs/**/*.json', {
  eager: true,
  import: 'default',
});

const MANIFEST_FILE = 'pack.json';
const RULES_FILE = 'rules.json';

/** `/packs/classic/paths/entry-side-file.json` → pack `classic`, file `paths/…`. */
function split(fullPath: string): { pack: string; file: string } | undefined {
  const parts = fullPath.split('/').filter((part) => part.length > 0);
  const [root, pack, ...rest] = parts;
  if (root !== 'packs' || pack === undefined || rest.length === 0) return undefined;
  return { pack, file: rest.join('/') };
}

/** Group the glob's flat output into one `PackSource` per pack directory. */
function collect(): Map<string, PackSource> {
  const grouped = new Map<string, Record<string, unknown>>();
  for (const [fullPath, value] of Object.entries(PACK_FILES)) {
    const parts = split(fullPath);
    if (parts === undefined) continue;
    const files = grouped.get(parts.pack) ?? {};
    files[parts.file] = value;
    grouped.set(parts.pack, files);
  }

  const sources = new Map<string, PackSource>();
  for (const [name, files] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const documents: PackDocument[] = [];
    let manifest: unknown;
    let rules: unknown;

    for (const [file, value] of Object.entries(files)) {
      if (file === MANIFEST_FILE) {
        manifest = value;
        continue;
      }
      if (file === RULES_FILE) {
        rules = value;
        continue;
      }
      const kind = CONTENT_DIRS.find((dir) => file.startsWith(`${dir}/`));
      if (kind !== undefined) documents.push({ kind, file, value });
    }

    const origin = `bundled:${name}`;
    sources.set(
      name,
      rules === undefined
        ? { name, origin, manifest, documents }
        : { name, origin, manifest, rules, documents },
    );
  }
  return sources;
}

/** Every bundled pack, in name order. Nothing is validated yet — that is `loadPack`. */
export function bundledPackSources(): Map<string, PackSource> {
  return collect();
}

/** One bundled pack by directory name, or `undefined` if it is not in the tree. */
export function bundledPackSource(name: string): PackSource | undefined {
  return collect().get(name);
}
