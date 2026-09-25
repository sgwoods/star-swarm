/**
 * Pack loading for `/lab`.
 *
 * The packs come from `src/content/bundle.ts` — the same bundler-side reader the
 * game entry point uses — and go through the same `loadPack` as the game and
 * `npm run validate-packs`. So a pack the previewer will show is a pack that
 * loads, and a pack that does not load shows its errors here instead of silently
 * half-appearing.
 *
 * Unlike the game, the lab layers *every* bundled pack: its job is to show what
 * is installed.
 */

import { bundledPackSources } from '../../content/bundle.js';
import type { ContentError, ContentRegistry, LoadedPack } from '../../content/index.js';
import { createRegistry, loadPack } from '../../content/index.js';

export type LabPacks =
  | { readonly ok: true; readonly registry: ContentRegistry }
  | { readonly ok: false; readonly errors: readonly ContentError[] };

/** Load and layer every bundled pack, in name order. */
export function loadLabPacks(): LabPacks {
  const packs: LoadedPack[] = [];
  const errors: ContentError[] = [];

  for (const source of bundledPackSources().values()) {
    const result = loadPack(source);
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
