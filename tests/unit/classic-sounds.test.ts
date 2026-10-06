import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { createMusic, unresolvedCues } from '../../src/audio/music.js';
import { createSfx, unresolvedBindings } from '../../src/audio/sfx.js';
import { buildSoundPlan, createSynth, type SoundPlan } from '../../src/audio/synth.js';
import { readPackSource } from '../../src/content/fs.js';
import type { LoadedPack } from '../../src/content/loader.js';
import { loadPack, packSourceFromRecord } from '../../src/content/loader.js';
import { createWorld } from '../../src/sim/world.js';
import { classicRules, classicStages } from '../helpers/rules.js';
import { shippedVariants } from '../helpers/variants.js';
import { fakeAudioContext, type FakeAudioContext } from './helpers/fake-audio-context.js';

/**
 * The Classic SFX set, as shipped. `tests/unit/classic-pack.test.ts` is the
 * third leg of the plan/reference/data stool for the numbers; this is the
 * equivalent for the sounds — every file the pack ships has to load, build a
 * plan the synth can realise, and be reachable from an event, as an effect or
 * as a jingle on the music channel.
 *
 * Nothing here asserts what any effect sounds like. That is a judgement, and a
 * test that pinned frequencies would only make the set harder to tune.
 */

const PACK_DIR = resolve(import.meta.dirname, '..', '..', 'packs', 'classic');

/** The set `docs/DESIGN.md` sections 5 and 10 ask for: the effects and the jingles. */
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
  'game-start',
  'captured',
  'challenge-results',
];

/** The five jingles `docs/DESIGN.md` section 5 names, plus the perfect variant of the last. */
const JINGLES = [
  'game-start',
  'stage-start',
  'captured',
  'rescue',
  'challenge-results',
  'challenge-perfect',
];

/** An effect that outlasts this is a jingle that has run away. */
const EFFECT_SECONDS = 2.5;
/** A jingle longer than this holds up the game it is announcing. */
const JINGLE_SECONDS = 4;

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
    const music = new Set(pack.manifest.music.map((cue) => cue.sound));
    for (const [id, sound] of pack.sounds) {
      const plan = buildSoundPlan(sound);
      expect(plan.id, id).toBe(id);
      expect(plan.voices.length, id).toBeGreaterThan(0);
      expect(plan.duration, id).toBeGreaterThan(0);
      expect(plan.duration, id).toBeLessThan(music.has(id) ? JINGLE_SECONDS : EFFECT_SECONDS);
    }
  });

  it('writes each named jingle as music — a melody with lines under it', () => {
    for (const id of JINGLES) {
      const sound = pack.sounds.get(id);
      expect(sound?.sequence, id).toBeDefined();
      expect(sound?.parts?.length, id).toBeGreaterThanOrEqual(1);
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

  it('binds every sound the pack ships to some event, as an effect or a jingle', () => {
    const bound = new Set([
      ...Object.values(pack.manifest.sounds),
      ...pack.manifest.music.map((cue) => cue.sound),
    ]);
    expect([...pack.sounds.keys()].filter((id) => !bound.has(id))).toEqual([]);
  });

  it('never plays one event as both an effect and a jingle, in any shipped game', () => {
    // Every game, because an overlay's `sounds` merge into the base's per key
    // while the base's `music` carries on underneath: a pack binding an effect to
    // an event Classic cues would play it over its own jingle.
    for (const variant of shippedVariants()) {
      const { manifest } = variant.registry;
      const cued = new Set(manifest.music.map((cue) => cue.event));
      expect(
        Object.keys(manifest.sounds).filter((event) => cued.has(event)),
        variant.id,
      ).toEqual([]);
    }
  });

  it('plays the pack’s own sounds for the events Milestone 1 raises', () => {
    const played: string[] = [];
    const sfx = createSfx({
      player: { play: (sound) => played.push(sound.id) },
      sounds: pack.sounds,
      bindings: pack.manifest.sounds,
    });

    sfx.handle([
      { type: 'shot-fired' },
      { type: 'enemy-fired' },
      { type: 'target-destroyed' },
      { type: 'extra-life' },
      { type: 'player-hit' },
    ]);

    expect(played).toEqual(['fire', 'enemy-fire', 'enemy-hit', 'extra-life', 'player-death']);
  });
});

describe('the music cues', () => {
  const cueFor = (events: readonly { readonly type: string }[]): string | undefined =>
    createMusic({
      player: { start: () => undefined },
      sounds: pack.sounds,
      cues: pack.manifest.music,
    }).cueFor(events)?.sound;

  it('names only sounds the pack defines', () => {
    expect(unresolvedCues(pack.manifest.music, pack.sounds)).toEqual([]);
  });

  it('opens a new game with the start jingle, not the stage one', () => {
    const world = createWorld({ rules: classicRules(), stages: classicStages() });
    expect(cueFor(world.events)).toBe('game-start');
  });

  it('plays the stage jingle for every stage after the first', () => {
    const world = createWorld({ rules: classicRules(), stages: classicStages(), stage: 2 });
    expect(cueFor(world.events)).toBe('stage-start');
  });

  it('plays the capture and rescue jingles for their own moments', () => {
    expect(cueFor([{ type: 'player-captured' }])).toBe('captured');
    expect(cueFor([{ type: 'fighter-rescued' }])).toBe('rescue');
  });

  it('lets game over win when the last fighter is captured on the same step', () => {
    expect(cueFor([{ type: 'player-captured' }, { type: 'game-over' }])).toBe('game-over');
  });

  it('plays the results over the next stage’s start and the last group’s bonus', () => {
    // A challenge stage's last kill can clear a group, end the stage and roll the
    // next one on, all in one step.
    const ending = (perfect: boolean) => [
      { type: 'challenge-group-cleared' },
      { type: perfect ? 'challenge-perfect' : 'challenge-bonus' },
      { type: 'challenge-ended', perfect },
      { type: 'stage-cleared' },
      { type: 'stage-started', stage: 4 },
    ];

    expect(cueFor(ending(true))).toBe('challenge-perfect');
    expect(cueFor(ending(false))).toBe('challenge-results');
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

  it('rejects a music cue naming a sound that is not there', () => {
    const result = loadPack(
      packSourceFromRecord('probe', 'test:probe', {
        'pack.json': {
          id: 'probe',
          name: 'Probe',
          music: [{ event: 'stage-started', sound: 'nowhere' }],
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ file: 'pack.json', field: 'music[0].sound' });
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

    const music = createMusic({ player: synth, sounds: pack.sounds, cues: pack.manifest.music });

    expect(synth.unlock()).toBe(false);
    expect(() => {
      for (const type of Object.keys(pack.manifest.sounds)) sfx.handle([{ type }]);
      for (const cue of pack.manifest.music) music.handle([{ type: cue.event, ...cue.when }]);
      music.stop();
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
