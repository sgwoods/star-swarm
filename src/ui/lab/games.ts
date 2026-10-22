/**
 * The games `/lab` previews, loaded exactly as the game loads them.
 *
 * The packs come from `src/content/bundle.ts` — the same bundler-side reader
 * `src/main.ts` uses — through the same `loadPack`, and the games from
 * `variants/` through the same `loadVariants`. So a preview is always of one
 * **game**: its packs layered in its own order, its rules, its stage sequence and
 * its audio themes, which is the registry the game would run. A pack on its own
 * is not what plays — an overlay leans on its base, and the rules are the last
 * pack's that ships any — so previewing one would be previewing something no
 * player ever sees.
 *
 * A pack or a variant that does not load shows its errors here instead of
 * silently half-appearing, because the game would refuse to boot on it too.
 */

import { bundledPackSources, bundledVariantSources } from '../../content/bundle.js';
import type { ContentError, LoadedPack, ResolvedVariant } from '../../content/index.js';
import { loadPack, loadVariants } from '../../content/index.js';

export type LabGames =
  | { readonly ok: true; readonly games: readonly ResolvedVariant[] }
  | { readonly ok: false; readonly errors: readonly ContentError[] };

/** Every game this build offers, in the order the start-up selector lists them. */
export function loadLabGames(): LabGames {
  const packs = new Map<string, LoadedPack>();
  const errors: ContentError[] = [];
  for (const [name, source] of bundledPackSources()) {
    const result = loadPack(source);
    if (result.ok) packs.set(name, result.pack);
    else errors.push(...result.errors);
  }
  if (errors.length > 0) return { ok: false, errors };

  const loaded = loadVariants(bundledVariantSources(), packs);
  if (!loaded.ok) return { ok: false, errors: loaded.errors };
  if (loaded.variants.length === 0) {
    return {
      ok: false,
      errors: [{ pack: 'variants', file: '.', message: 'no game is declared under variants/' }],
    };
  }
  return { ok: true, games: loaded.variants };
}
