import { describe, expect, it } from 'vitest';

import { createMusic } from '../../src/audio/music.js';
import { createSfx } from '../../src/audio/sfx.js';
import { loadPack, loadPackOrThrow, packSourceFromRecord } from '../../src/content/loader.js';
import { createRegistry } from '../../src/content/registry.js';
import type { Sound } from '../../src/content/schema.js';
import { themedSounds, themeIn, themesOf } from '../../src/content/themes.js';
import { type ResolvedVariant, resolveVariant } from '../../src/content/variants.js';
import { minimalRules } from '../helpers/rules.js';
import { installedPack, installedPacks, shippedVariants } from '../helpers/variants.js';

/**
 * Audio themes: a pack declares alternatives to its own sound, a variant chooses
 * one, and nothing else changes.
 *
 * The first describe is the one that matters most. The captain's verdict on the
 * shipped sound was that it is fine, so it is the baseline to preserve: every
 * shipped game, with no theme chosen, has to hand the audio layer exactly what it
 * did before themes existed. Nothing here asserts what any theme sounds like — that
 * is a judgement no test can make — only what its values are.
 */

/** Every event any shipped manifest binds or cues, as an event the audio layer hears. */
function everyEvent(): { readonly type: string }[] {
  const types = new Set<string>();
  for (const variant of shippedVariants()) {
    for (const event of Object.keys(variant.registry.manifest.sounds)) types.add(event);
    for (const cue of variant.registry.manifest.music) types.add(cue.event);
  }
  return [...types].map((type) => ({ type }));
}

/** What the effect and music channels play for each event, one event at a time. */
function heard(
  sounds: ReadonlyMap<string, Sound>,
  variant: ResolvedVariant,
): (Sound | undefined)[] {
  const { manifest } = variant.registry;
  const sfx = createSfx({ player: { play: () => undefined }, sounds, bindings: manifest.sounds });
  const out: (Sound | undefined)[] = [];
  for (const event of everyEvent()) {
    out.push(sfx.soundFor(event));
    const cue = createMusic({
      player: { start: () => undefined },
      sounds,
      cues: manifest.music,
    }).cueFor([event]);
    out.push(cue === undefined ? undefined : sounds.get(cue.sound));
  }
  return out;
}

describe('the shipped sound is the default, exactly', () => {
  it('hands every shipped game its registry’s own sound map, the same object', () => {
    for (const variant of shippedVariants()) {
      expect(themedSounds(variant.registry, variant.theme), variant.id).toBe(
        variant.registry.sounds,
      );
    }
  });

  it('plays the very same sound documents for every event, theme or no theme', () => {
    for (const variant of shippedVariants()) {
      const themed = heard(themedSounds(variant.registry, variant.theme), variant);
      const unthemed = heard(variant.registry.sounds, variant);
      expect(themed.length, variant.id).toBeGreaterThan(0);
      themed.forEach((sound, index) => expect(sound, variant.id).toBe(unthemed[index]));
    }
  });

  it('declares a default that substitutes nothing, wherever a pack declares themes', () => {
    for (const pack of installedPacks().values()) {
      const { defaultTheme, themes } = pack.manifest;
      if (defaultTheme === undefined) continue;
      expect(themes[defaultTheme]?.sounds, pack.id).toEqual({});
    }
  });
});

describe('Classic’s themes', () => {
  const classic = installedPack('classic');

  it('are ARCADE, its default, and DUSK', () => {
    expect(themesOf(classic.manifest).map((theme) => theme.name)).toEqual(['ARCADE', 'DUSK']);
    expect(classic.manifest.defaultTheme).toBe('arcade');
  });

  it('has DUSK stand in for every sound Classic binds or cues, with a document of its own', () => {
    const played = new Set([
      ...Object.values(classic.manifest.sounds),
      ...classic.manifest.music.map((cue) => cue.sound),
    ]);
    const dusk = classic.manifest.themes.dusk?.sounds ?? {};
    expect(Object.keys(dusk).sort()).toEqual([...played].sort());
    for (const [from, to] of Object.entries(dusk)) {
      expect(classic.sounds.get(to), from).toBeDefined();
      expect(classic.sounds.get(to), from).not.toEqual(classic.sounds.get(from));
    }
  });

  it('gives DUSK no square voice, where ARCADE’s melodies are square', () => {
    // The theme's character stated as values, which is all a test can see.
    const waves = (sound: Sound | undefined): string[] => [
      sound?.wave ?? '',
      ...(sound?.parts ?? []).map((part) => part.wave ?? sound?.wave ?? ''),
    ];
    const dusk = Object.values(classic.manifest.themes.dusk?.sounds ?? {});
    for (const id of dusk) expect(waves(classic.sounds.get(id)), id).not.toContain('square');
    expect(classic.sounds.get('fire')?.wave).toBe('square');
  });
});

describe('Convoy’s themes', () => {
  const convoy = installedPack('convoy');

  it('are CONVOY, its default, and GRIT, standing in for every sound it binds or cues', () => {
    expect(themesOf(convoy.manifest).map((theme) => theme.name)).toEqual(['CONVOY', 'GRIT']);
    expect(convoy.manifest.defaultTheme).toBe('convoy');
    const played = new Set([
      ...Object.values(convoy.manifest.sounds),
      ...convoy.manifest.music.map((cue) => cue.sound),
    ]);
    const grit = convoy.manifest.themes.grit?.sounds ?? {};
    expect(Object.keys(grit).sort()).toEqual([...played].sort());
  });

  it('gives GRIT sawtooth voices wherever CONVOY’s are pitched', () => {
    for (const [from, to] of Object.entries(convoy.manifest.themes.grit?.sounds ?? {})) {
      const own = convoy.sounds.get(from);
      const theirs = convoy.sounds.get(to);
      if (own?.wave === 'noise') expect(theirs?.wave, from).toBe('noise');
      else expect(theirs?.wave, from).toBe('sawtooth');
    }
  });
});

describe('a variant choosing a theme', () => {
  const documentWith = (theme: unknown) => ({
    file: 'mine.json',
    value: { id: 'mine', name: 'Mine', packs: ['classic'], theme },
  });

  it('plays the theme it names, sound id by sound id', () => {
    const result = resolveVariant(documentWith('dusk'), installedPacks());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variant.theme).toBe('dusk');
    const sounds = themedSounds(result.variant.registry, result.variant.theme);
    expect(sounds.get('fire')?.id).toBe('dusk-fire');
    expect(sounds.get('game-start')?.id).toBe('dusk-game-start');
    // The bindings and cues are the pack's own either way.
    const sfx = createSfx({
      player: { play: () => undefined },
      sounds,
      bindings: result.variant.registry.manifest.sounds,
    });
    expect(sfx.soundFor({ type: 'shot-fired' })?.id).toBe('dusk-fire');
  });

  it('is refused a theme its packs do not declare', () => {
    const result = resolveVariant(documentWith('opera'), installedPacks());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ field: 'theme' });
    expect(result.errors[0]?.message).toContain('arcade, dusk');
  });

  it('is refused any theme over packs that declare none', () => {
    const bare = loadPackOrThrow(
      packSourceFromRecord('bare', 'test:bare', {
        'pack.json': { id: 'bare', name: 'Bare' },
        'rules.json': minimalRules(),
      }),
    );
    const result = resolveVariant(
      { file: 'mine.json', value: { id: 'mine', name: 'Mine', packs: ['bare'], theme: 'dusk' } },
      new Map([['bare', bare]]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain('they declare none');
  });

  it('carries the base’s themes through an overlay layered over it', () => {
    const remix = shippedVariants().find((variant) => variant.packs.length > 1);
    expect(remix).toBeDefined();
    if (remix === undefined) return;
    expect(remix.themes.map((theme) => theme.id)).toEqual(['arcade', 'dusk']);
    expect(remix.theme).toBe('arcade');
  });
});

describe('a pack declaring themes is checked like every other reference', () => {
  const sound = (id: string) => ({ id, wave: 'square', freq: 440 });
  const load = (manifest: Record<string, unknown>) =>
    loadPack(
      packSourceFromRecord('probe', 'test:probe', {
        'pack.json': { id: 'probe', name: 'Probe', ...manifest },
        'sounds/beep.json': sound('beep'),
        'sounds/boop.json': sound('boop'),
      }),
    );

  it('loads a default and a substitution between sounds it ships', () => {
    const result = load({
      themes: { own: { name: 'OWN' }, alt: { name: 'ALT', sounds: { beep: 'boop' } } },
      defaultTheme: 'own',
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a substitution naming a sound it does not ship, on either side', () => {
    for (const sounds of [{ beep: 'nowhere' }, { nowhere: 'boop' }]) {
      const result = load({ themes: { alt: { name: 'ALT', sounds } }, defaultTheme: 'alt' });
      expect(result.ok, JSON.stringify(sounds)).toBe(false);
    }
  });

  it('refuses themes with no default, and a default naming no theme', () => {
    const none = load({ themes: { alt: { name: 'ALT' } } });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors[0]?.field).toBe('defaultTheme');
    const stray = load({ defaultTheme: 'alt' });
    expect(stray.ok).toBe(false);
    if (!stray.ok) expect(stray.errors[0]?.field).toBe('defaultTheme');
  });

  it('plays the default when a hand-assembled registry names a theme it lacks', () => {
    const pack = loadPackOrThrow(
      packSourceFromRecord('probe', 'test:probe', {
        'pack.json': {
          id: 'probe',
          name: 'Probe',
          themes: { own: { name: 'OWN' }, alt: { name: 'ALT', sounds: { beep: 'boop' } } },
          defaultTheme: 'alt',
        },
        'sounds/beep.json': sound('beep'),
        'sounds/boop.json': sound('boop'),
      }),
    );
    const registry = createRegistry([pack]);
    expect(themeIn(registry.manifest, 'missing')).toBe('alt');
    expect(themedSounds(registry, 'missing').get('beep')?.id).toBe('boop');
    expect(themedSounds(registry, 'own')).toBe(registry.sounds);
  });
});
