/**
 * Audio themes — the sounds a game plays, as one of the alternatives its packs
 * declare (`audioThemeSchema` in `./schema.ts`).
 *
 * A theme is a **substitution of sound documents**, never a second engine: the
 * manifest's `sounds` bindings and `music` cues stand as they are, and wherever
 * one names a sound the theme replaces, the replacement is what the synth is
 * handed. That keeps the audio layer ignorant of themes altogether —
 * `src/audio/sfx.ts` and `src/audio/music.ts` take a sound map, and this module
 * is the one place a map is made for a theme.
 *
 * **The default is the pack's own sound, exactly.** A game whose packs declare no
 * theme, or whose default theme substitutes nothing, gets the registry's own
 * `sounds` map back — the same object, not a copy — so a game nobody chose a
 * theme for cannot sound any different for this module existing.
 */

import type { ContentRegistry } from './registry.js';
import type { PackManifest, Sound } from './schema.js';

/** One theme on offer, as the options card shows it. */
export interface ThemeChoice {
  readonly id: string;
  readonly name: string;
  readonly description: string | undefined;
}

/** The themes a composed manifest offers, in declaration order. Empty when it declares none. */
export function themesOf(manifest: PackManifest): readonly ThemeChoice[] {
  return Object.entries(manifest.themes).map(([id, theme]) => ({
    id,
    name: theme.name,
    description: theme.description,
  }));
}

/**
 * The theme a game plays: the one it names when its packs declare it, else the
 * packs' default. `undefined` for a game whose packs declare no themes.
 */
export function themeIn(manifest: PackManifest, named: string | undefined): string | undefined {
  if (named !== undefined && Object.hasOwn(manifest.themes, named)) return named;
  return manifest.defaultTheme;
}

/**
 * Sound id → definition, as `theme` plays it: the registry's own map with each
 * substitution the theme states put in place. Bindings and cues look sounds up
 * by the ids they already name, so this map is the whole of what a theme changes.
 *
 * `theme` is resolved by {@link themeIn}, so a name the packs do not declare plays
 * the default rather than nothing — the loader refuses such a document, and this
 * is only reachable for one assembled by hand.
 */
export function themedSounds(
  registry: Pick<ContentRegistry, 'manifest' | 'sounds'>,
  theme: string | undefined,
): ReadonlyMap<string, Sound> {
  const id = themeIn(registry.manifest, theme);
  const substitutions = id === undefined ? undefined : registry.manifest.themes[id]?.sounds;
  if (substitutions === undefined || Object.keys(substitutions).length === 0) {
    return registry.sounds;
  }
  const sounds = new Map(registry.sounds);
  for (const [from, to] of Object.entries(substitutions)) {
    const replacement = registry.sounds.get(to);
    if (replacement !== undefined) sounds.set(from, replacement);
  }
  return sounds;
}
