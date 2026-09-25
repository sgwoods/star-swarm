/**
 * Pack loading for `/lab`.
 *
 * The dev server has the whole `packs/` tree on disk, so the harness bundles it
 * with `import.meta.glob` rather than fetching. That deliberately goes through
 * the same `loadPack` the game and `npm run validate-packs` use: a pack the
 * previewer will show is a pack that loads, and a pack that does not load shows
 * its errors here instead of silently half-appearing.
 *
 * `src/content/fs.ts` is the Node-only reader and is not involved — importing it
 * would drag `node:fs` into the browser.
 */

import type { ContentError, ContentRegistry, LoadedPack } from '../../content/index.js';
import { createRegistry, loadPack, packSourceFromRecord } from '../../content/index.js';

export type LabPacks =
  | { readonly ok: true; readonly registry: ContentRegistry }
  | { readonly ok: false; readonly errors: readonly ContentError[] };

/** Every JSON file under `packs/`, keyed by its path from the project root. */
const PACK_FILES = import.meta.glob<unknown>('/packs/**/*.json', {
  eager: true,
  import: 'default',
});

/** `/packs/classic/paths/entry-side-file.json` → `classic` + the pack-relative path. */
function split(fullPath: string): { pack: string; file: string } | undefined {
  const parts = fullPath.split('/').filter((part) => part.length > 0);
  const [root, pack, ...rest] = parts;
  if (root !== 'packs' || pack === undefined || rest.length === 0) return undefined;
  return { pack, file: rest.join('/') };
}

/** Load and layer every pack in the tree, newest-listed winning. */
export function loadLabPacks(): LabPacks {
  const grouped = new Map<string, Record<string, unknown>>();
  for (const [fullPath, value] of Object.entries(PACK_FILES)) {
    const parts = split(fullPath);
    if (parts === undefined) continue;
    const files = grouped.get(parts.pack) ?? {};
    files[parts.file] = value;
    grouped.set(parts.pack, files);
  }

  const packs: LoadedPack[] = [];
  const errors: ContentError[] = [];
  for (const [name, files] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const result = loadPack(packSourceFromRecord(name, `bundled:${name}`, files));
    if (result.ok) packs.push(result.pack);
    else errors.push(...result.errors);
  }

  if (errors.length > 0) return { ok: false, errors };
  if (packs.length === 0) {
    return {
      ok: false,
      errors: [{ pack: 'packs', file: '.', message: 'no packs found under packs/' }],
    };
  }
  return { ok: true, registry: createRegistry(packs) };
}
