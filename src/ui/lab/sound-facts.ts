/**
 * Which sounds a game plays when, and what an audio theme changes about it.
 *
 * The answers come from the composed manifest's `sounds` bindings and `music`
 * cues, and from `themedSounds` in `src/content/themes.ts` — the one function the
 * game itself asks for "sound id → document, as this theme plays it". So the
 * audition plays exactly the document the game would hand the synth for that
 * event in that theme, and nothing here has an opinion of its own about which.
 *
 * DOM-free, so the Node tests read it directly.
 */

import type { MusicCue, Sound } from '../../content/schema.js';
import { themedSounds, themeIn } from '../../content/themes.js';
import type { ResolvedVariant } from '../../content/variants.js';
import type { Fact } from './alien-facts.js';

export type SoundGame = Pick<ResolvedVariant, 'registry'>;

/** A cue's `when`, as `stage 1` or `perfect true`. Empty for a cue with none. */
export function whenOf(cue: MusicCue): string {
  return Object.entries(cue.when ?? {})
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(', ');
}

/** Every place the game's manifest names `soundId`, and every theme that swaps it. */
export function soundUses(game: SoundGame, soundId: string): readonly Fact[] {
  const { manifest } = game.registry;
  const uses: Fact[] = [];
  for (const [event, id] of Object.entries(manifest.sounds)) {
    if (id === soundId) uses.push({ label: 'effect', value: `on ${event}` });
  }
  for (const cue of manifest.music) {
    if (cue.sound !== soundId) continue;
    const when = whenOf(cue);
    uses.push({ label: 'music', value: `on ${cue.event}${when === '' ? '' : ` when ${when}`}` });
  }
  for (const theme of Object.values(manifest.themes)) {
    for (const [from, to] of Object.entries(theme.sounds)) {
      if (to === soundId) {
        uses.push({
          label: `theme ${theme.name}`,
          value: `plays it in place of ${from}`,
          link: { view: 'sounds', id: from },
        });
      }
      if (from === soundId) {
        uses.push({
          label: `theme ${theme.name}`,
          value: `plays ${to} in its place`,
          link: { view: 'sounds', id: to },
        });
      }
    }
  }
  return uses;
}

/** One thing a theme plays: an effect bound to an event, or a jingle cued by one. */
export interface AuditionRow {
  readonly channel: 'effect' | 'music';
  readonly event: string;
  /** A cue's narrowing, as {@link whenOf} writes it; empty for an effect. */
  readonly when: string;
  /** The id the manifest binds. */
  readonly bound: string;
  /** The id the theme plays for it: `bound`, or what the theme puts in its place. */
  readonly plays: string;
  /** The document the synth is handed. `undefined` only for a hand-built registry. */
  readonly sound: Sound | undefined;
}

/**
 * Everything `theme` plays, effects first and then the jingles, in the
 * manifest's own order. `theme` is resolved as the game resolves it, so a name
 * the packs do not declare is their default.
 */
export function auditionOf(game: SoundGame, theme: string | undefined): readonly AuditionRow[] {
  const { registry } = game;
  const { manifest } = registry;
  const sounds = themedSounds(registry, theme);
  const resolved = themeIn(manifest, theme);
  const swaps = resolved === undefined ? {} : (manifest.themes[resolved]?.sounds ?? {});
  const row = (
    channel: AuditionRow['channel'],
    event: string,
    when: string,
    bound: string,
  ): AuditionRow => ({
    channel,
    event,
    when,
    bound,
    plays: swaps[bound] ?? bound,
    sound: sounds.get(bound),
  });
  return [
    ...Object.entries(manifest.sounds).map(([event, bound]) => row('effect', event, '', bound)),
    ...manifest.music.map((cue) => row('music', cue.event, whenOf(cue), cue.sound)),
  ];
}
