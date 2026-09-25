import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { createSfx, unresolvedBindings } from '../../src/audio/sfx.js';
import { buildSoundPlan, createSynth, type SoundPlan } from '../../src/audio/synth.js';
import { readPackSource } from '../../src/content/fs.js';
import type { LoadedPack } from '../../src/content/loader.js';
import { loadPack, packSourceFromRecord } from '../../src/content/loader.js';
import { fakeAudioContext, type FakeAudioContext } from './helpers/fake-audio-context.js';

/**
 * The Classic SFX set, as shipped. `tests/unit/classic-pack.test.ts` is the
 * third leg of the plan/reference/data stool for the numbers; this is the
 * equivalent for the sounds — every file the pack ships has to load, build a
 * plan the synth can realise, and be reachable from an event.
 *
 * Nothing here asserts what any effect sounds like. That is a judgement, and a
 * test that pinned frequencies would only make the set harder to tune.
 */

const PACK_DIR = resolve(import.meta.dirname, '..', '..', 'packs', 'classic');

/** The set `docs/DESIGN.md` sections 5 and 10 ask Milestone 1 to ship. */
const REQUIRED_SOUNDS = [
  'fire',
  'enemy-fire',
  'enemy-hit',
  'player-death',
  'dive',
  'capture-beam',
  'rescue',
  'extra-life',
  'stage-start',
  'challenge-bonus',
  'challenge-perfect',
  'game-over',
];

let pack: LoadedPack;

beforeAll(() => {
  const { source, errors } = readPackSource(PACK_DIR);
  expect(errors).toEqual([]);
  if (source === undefined) throw new Error('classic pack could not be read');
  const result = loadPack(source);
  if (!result.ok)
    throw new Error(`classic pack failed to load:\n${JSON.stringify(result.errors, null, 2)}`);
  pack = result.pack;
});

describe('the Classic sound set', () => {
  it('ships every effect Milestone 1 and 2 need', () => {
    expect([...pack.sounds.keys()].sort()).toEqual([...REQUIRED_SOUNDS].sort());
  });

  it('gives every sound a plan with at least one voice and a real length', () => {
    for (const [id, sound] of pack.sounds) {
      const plan = buildSoundPlan(sound);
      expect(plan.id, id).toBe(id);
      expect(plan.voices.length, id).toBeGreaterThan(0);
      expect(plan.duration, id).toBeGreaterThan(0);
      // A sound that outlasts a couple of seconds is a jingle that has run away.
      expect(plan.duration, id).toBeLessThan(2.5);
    }
  });

  it('keeps every voice inside its plan and every gain inside unity', () => {
    for (const [id, sound] of pack.sounds) {
      const plan: SoundPlan = buildSoundPlan(sound);
      for (const voice of plan.voices) {
        expect(voice.start, id).toBeGreaterThanOrEqual(0);
        expect(voice.stop, id).toBeLessThanOrEqual(plan.duration + 1e-9);
        for (const ramp of voice.gain) expect(ramp.value, id).toBeLessThanOrEqual(1);
        for (const ramp of voice.frequency) expect(ramp.value, id).toBeGreaterThan(0);
      }
    }
  });

  it('realises every sound against an audio context without throwing', () => {
    const context = fakeAudioContext();
    const synth = createSynth({
      createContext: () => context,
      onError: (error) => {
        throw error instanceof Error ? error : new Error(String(error));
      },
    });
    synth.unlock();

    for (const sound of pack.sounds.values()) synth.play(sound);

    expect(context.nodes.length).toBeGreaterThan(pack.sounds.size);
  });

  it('uses the chirpy square and noise voices of the house style', () => {
    const waves = new Set([...pack.sounds.values()].map((sound) => sound.wave));
    expect(waves.has('square')).toBe(true);
    expect(waves.has('noise')).toBe(true);
  });
});

describe('the manifest bindings', () => {
  it('names only sounds the pack defines', () => {
    expect(unresolvedBindings(pack.manifest.sounds, pack.sounds)).toEqual([]);
  });

  it('binds every sound the pack ships to some event', () => {
    const bound = new Set(Object.values(pack.manifest.sounds));
    expect([...pack.sounds.keys()].filter((id) => !bound.has(id))).toEqual([]);
  });

  it('plays the pack’s own sounds for the events Milestone 1 raises', () => {
    const played: string[] = [];
    const sfx = createSfx({
      player: { play: (sound) => played.push(sound.id) },
      sounds: pack.sounds,
      bindings: pack.manifest.sounds,
    });

    sfx.handle([
      { type: 'stage-started' },
      { type: 'shot-fired' },
      { type: 'enemy-fired' },
      { type: 'target-destroyed' },
      { type: 'extra-life' },
      { type: 'player-hit' },
      { type: 'game-over' },
    ]);

    expect(played).toEqual([
      'stage-start',
      'fire',
      'enemy-fire',
      'enemy-hit',
      'extra-life',
      'player-death',
      'game-over',
    ]);
  });
});

describe('a sound that is not valid never loads', () => {
  const minimalPack = {
    'pack.json': { id: 'probe', name: 'Probe' },
  };

  const load = (files: Record<string, unknown>) =>
    loadPack(packSourceFromRecord('probe', 'test:probe', { ...minimalPack, ...files }));

  it('rejects a misspelt field rather than ignoring it', () => {
    const result = load({
      'sounds/bad.json': { id: 'bad', wave: 'square', freq: 440, envelop: [0.01, 0.1, 0.2] },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.file).toBe('sounds/bad.json');
  });

  it('rejects a waveform the synth has no voice for', () => {
    const result = load({ 'sounds/bad.json': { id: 'bad', wave: 'supersaw', freq: 440 } });
    expect(result.ok).toBe(false);
  });

  it('rejects a sound with neither a pitch nor a sequence', () => {
    const result = load({ 'sounds/bad.json': { id: 'bad', wave: 'square' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain('"freq"');
  });

  it('rejects a binding to a sound that is not there', () => {
    const result = loadPack(
      packSourceFromRecord('probe', 'test:probe', {
        'pack.json': { id: 'probe', name: 'Probe', sounds: { 'shot-fired': 'nowhere' } },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      file: 'pack.json',
      field: 'sounds.shot-fired',
    });
  });

  it('accepts a pack that binds nothing, because sound is optional', () => {
    expect(load({}).ok).toBe(true);
  });
});

describe('the game runs silently when audio is unavailable', () => {
  it('plays the whole Classic set through a synth that never got a context', () => {
    const synth = createSynth({ createContext: () => undefined });
    const sfx = createSfx({
      player: synth,
      sounds: pack.sounds,
      bindings: pack.manifest.sounds,
    });

    expect(synth.unlock()).toBe(false);
    expect(() => {
      for (const type of Object.keys(pack.manifest.sounds)) sfx.handle([{ type }]);
    }).not.toThrow();
    expect(synth.available).toBe(false);
  });

  it('survives a context that throws on every node it is asked for', () => {
    const hostile: FakeAudioContext = fakeAudioContext();
    const errors: unknown[] = [];
    const synth = createSynth({
      createContext: () => hostile,
      onError: (error) => errors.push(error),
    });
    synth.unlock();

    for (const sound of pack.sounds.values()) {
      hostile.failNextOscillator = true;
      expect(() => {
        synth.play(sound);
      }).not.toThrow();
    }

    expect(errors.length).toBeGreaterThan(0);
  });
});
