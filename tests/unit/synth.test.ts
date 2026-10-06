import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ENVELOPE,
  DEFAULT_VOLUME,
  NOISE_Q,
  STOP_FADE_SECONDS,
  buildSoundPlan,
  createSynth,
  playPlan,
  pulseWaveCoefficients,
  scaleEnvelope,
  unlockOnFirstGesture,
} from '../../src/audio/synth.js';
import { soundSchema } from '../../src/content/schema.js';
import { fakeAudioContext, type FakeAudioContext } from './helpers/fake-audio-context.js';

/**
 * The synth is data-driven (`docs/DESIGN.md` sections 3 and 5), so what is worth
 * pinning is the translation: a sound definition in, a specific voice graph out.
 * `buildSoundPlan` is pure and gives the plan; `playPlan` against a recording
 * double gives the nodes actually built, on the Node test environment where
 * there is no Web Audio at all.
 */

const parse = (value: unknown) => soundSchema.parse(value);

describe('buildSoundPlan — a single tone', () => {
  it('is one voice whose length is its envelope', () => {
    const plan = buildSoundPlan(
      parse({ id: 'blip', wave: 'square', freq: 440, envelope: [0.01, 0.1, 0.2] }),
    );

    expect(plan.id).toBe('blip');
    expect(plan.duration).toBeCloseTo(0.31, 10);
    expect(plan.voices).toHaveLength(1);
    expect(plan.voices[0]).toMatchObject({ wave: 'square', source: 'oscillator', start: 0 });
    expect(plan.voices[0]?.stop).toBeCloseTo(0.31, 10);
  });

  it('falls back to the default envelope and volume', () => {
    const plan = buildSoundPlan(parse({ id: 'bare', wave: 'triangle', freq: 300 }));
    const [attack, hold, release] = DEFAULT_ENVELOPE;

    expect(plan.duration).toBeCloseTo(attack + hold + release, 10);
    expect(plan.voices[0]?.gain[1]?.value).toBe(DEFAULT_VOLUME);
  });

  it('holds a steady pitch with one set, and sweeps with an exponential ramp', () => {
    const steady = buildSoundPlan(parse({ id: 'steady', wave: 'sine', freq: 440 }));
    expect(steady.voices[0]?.frequency).toEqual([{ time: 0, value: 440, kind: 'set' }]);

    const swept = buildSoundPlan(
      parse({ id: 'swept', wave: 'square', freq: [440, 220], envelope: [0, 0.1, 0] }),
    );
    expect(swept.voices[0]?.frequency).toEqual([
      { time: 0, value: 440, kind: 'set' },
      { time: 0.1, value: 220, kind: 'exponential' },
    ]);
  });

  it('shapes the gain as silence, peak, peak, silence', () => {
    const plan = buildSoundPlan(
      parse({ id: 'shaped', wave: 'square', freq: 440, envelope: [0.01, 0.1, 0.2], volume: 0.5 }),
    );

    expect(plan.voices[0]?.gain).toEqual([
      { time: 0, value: 0, kind: 'set' },
      { time: 0.01, value: 0.5, kind: 'linear' },
      // Floating-point addition of the envelope, written the same way the code does it.
      { time: 0.01 + 0.1, value: 0.5, kind: 'linear' },
      { time: 0.01 + 0.1 + 0.2, value: 0, kind: 'linear' },
    ]);
  });

  it('carries vibrato as a peak deviation in hertz', () => {
    const plan = buildSoundPlan(
      parse({ id: 'wobble', wave: 'square', freq: 400, vibrato: { rate: 8, depth: 0.25 } }),
    );
    expect(plan.voices[0]?.vibrato).toEqual({ rate: 8, peak: 100 });
  });

  it('takes a swept voice’s vibrato depth from the middle of the sweep', () => {
    const plan = buildSoundPlan(
      parse({ id: 'swept', wave: 'square', freq: [100, 400], vibrato: { rate: 6, depth: 0.5 } }),
    );
    // The geometric middle of 100…400 is 200, so half of it is 100 Hz.
    expect(plan.voices[0]?.vibrato).toEqual({ rate: 6, peak: 100 });
  });

  it('builds the design plan’s own example', () => {
    const plan = buildSoundPlan(
      parse({
        id: 'wobble',
        wave: 'square',
        freq: [440, 220],
        vibrato: { rate: 8, depth: 0.3 },
        envelope: [0.01, 0.1, 0.2],
      }),
    );

    expect(plan.duration).toBeCloseTo(0.31, 10);
    expect(plan.voices[0]?.frequency.at(-1)).toMatchObject({ value: 220, kind: 'exponential' });
    expect(plan.voices[0]?.vibrato?.rate).toBe(8);
  });
});

describe('buildSoundPlan — noise', () => {
  it('is a band-passed burst rather than an oscillator', () => {
    const plan = buildSoundPlan(parse({ id: 'hit', wave: 'noise', freq: [3000, 400] }));

    expect(plan.voices[0]).toMatchObject({ source: 'noise', q: NOISE_Q });
    expect(plan.voices[0]?.frequency.at(-1)?.value).toBe(400);
  });

  it('drops vibrato, because a noise voice has no pitch to wobble', () => {
    const plan = buildSoundPlan(
      parse({ id: 'hit', wave: 'noise', freq: 800, vibrato: { rate: 10, depth: 0.5 } }),
    );
    expect(plan.voices[0]?.vibrato).toBeUndefined();
  });
});

describe('buildSoundPlan — a sequence', () => {
  const jingle = parse({
    id: 'jingle',
    wave: 'square',
    volume: 0.4,
    envelope: [0.01, 0.05, 0.04],
    sequence: [
      { freq: 523.25, duration: 0.1 },
      { freq: 659.25, duration: 0.1, volume: 0.6 },
      { freq: [783.99, 1046.5], duration: 0.2, wave: 'triangle' },
    ],
  });

  it('lays one voice per step end to end', () => {
    const plan = buildSoundPlan(jingle);

    expect(plan.voices).toHaveLength(3);
    expect(plan.voices.map((voice) => voice.start)).toEqual([0, 0.1, 0.2]);
    expect(plan.duration).toBeCloseTo(0.4, 10);
  });

  it('lets a step state its own wave and volume', () => {
    const plan = buildSoundPlan(jingle);

    expect(plan.voices.map((voice) => voice.wave)).toEqual(['square', 'square', 'triangle']);
    expect(plan.voices[0]?.gain[1]?.value).toBe(0.4);
    expect(plan.voices[1]?.gain[1]?.value).toBe(0.6);
  });

  it('fits the envelope to each step’s own duration', () => {
    const plan = buildSoundPlan(jingle);
    const third = plan.voices[2];

    // The step lasts 0.2s, so the whole [0.01, 0.05, 0.04] shape is scaled to it.
    expect(third?.gain[0]?.time).toBeCloseTo(0.2, 10);
    expect(third?.gain.at(-1)?.time).toBeCloseTo(0.4, 10);
    expect(third?.stop).toBeCloseTo(0.4, 10);
  });
});

describe('buildSoundPlan — rests and parts, which make a jingle music', () => {
  const tune = parse({
    id: 'tune',
    wave: 'square',
    duty: 0.25,
    volume: 0.3,
    envelope: [0.01, 0.05, 0.04],
    vibrato: { rate: 6, depth: 0.01 },
    sequence: [
      { freq: 784, duration: 0.1 },
      { rest: true, duration: 0.1 },
      { freq: 587, duration: 0.2 },
    ],
    parts: [
      { wave: 'triangle', volume: 0.4, sequence: [{ freq: 98, duration: 0.4 }] },
      {
        sequence: [
          { rest: true, duration: 0.2 },
          { freq: 494, duration: 0.3 },
        ],
      },
    ],
  });

  it('builds no voice for a rest, and still advances the clock past it', () => {
    const plan = buildSoundPlan(tune);
    const melody = plan.voices.filter((voice) => voice.wave === 'square' && voice.start < 0.2);

    expect(melody.map((voice) => voice.start)).toEqual([0]);
    expect(
      plan.voices.some((voice) => voice.start === 0.2 && voice.frequency[0]?.value === 587),
    ).toBe(true);
  });

  it('starts every part with the sound, so the lines sound together', () => {
    const plan = buildSoundPlan(tune);
    const bass = plan.voices.find((voice) => voice.wave === 'triangle');
    const harmony = plan.voices.find((voice) => voice.frequency[0]?.value === 494);

    expect(bass?.start).toBe(0);
    expect(harmony?.start).toBeCloseTo(0.2, 10);
  });

  it('lasts as long as its longest line', () => {
    // The melody ends at 0.4 s, the bass at 0.4 s, the harmony at 0.5 s.
    expect(buildSoundPlan(tune).duration).toBeCloseTo(0.5, 10);
  });

  it('gives a part the sound’s wave, volume and duty when it states none of its own', () => {
    const plan = buildSoundPlan(tune);
    const harmony = plan.voices.find((voice) => voice.frequency[0]?.value === 494);
    const bass = plan.voices.find((voice) => voice.wave === 'triangle');

    expect(harmony?.wave).toBe('square');
    expect(harmony?.gain[1]?.value).toBe(0.3);
    expect(harmony?.pulse).toBeDefined();
    expect(bass?.gain[1]?.value).toBe(0.4);
  });

  it('never hands a part the melody’s vibrato, which a part could not switch off', () => {
    const plan = buildSoundPlan(tune);

    expect(plan.voices.find((voice) => voice.frequency[0]?.value === 784)?.vibrato).toBeDefined();
    expect(plan.voices.find((voice) => voice.wave === 'triangle')?.vibrato).toBeUndefined();
    expect(plan.voices.find((voice) => voice.frequency[0]?.value === 494)?.vibrato).toBeUndefined();
  });

  it('refuses a sequence that is nothing but rests', () => {
    expect(
      soundSchema.safeParse({
        id: 'hush',
        wave: 'square',
        sequence: [{ rest: true, duration: 0.1 }],
      }).success,
    ).toBe(false);
  });

  it('refuses a rest that also states a pitch, rather than guessing which was meant', () => {
    expect(
      soundSchema.safeParse({
        id: 'which',
        wave: 'square',
        sequence: [{ rest: true, freq: 440, duration: 0.1 }],
      }).success,
    ).toBe(false);
  });
});

describe('scaleEnvelope', () => {
  it('keeps the shape and takes the duration', () => {
    expect(scaleEnvelope([0.01, 0.05, 0.04], 0.2)).toEqual([0.02, 0.1, 0.08]);
  });

  it('falls back to a mostly flat shape when the envelope is all zeroes', () => {
    expect(scaleEnvelope([0, 0, 0], 0.4)).toEqual([0, 0.30000000000000004, 0.1]);
  });
});

describe('pulseWaveCoefficients', () => {
  it('reproduces the standard square at a half duty', () => {
    const { real, imag } = pulseWaveCoefficients(0.5, 5);

    // Odd sine harmonics at 4/(nπ), no cosine content, no DC.
    expect(real.every((value) => Math.abs(value) < 1e-12)).toBe(true);
    expect(imag[0]).toBe(0);
    expect(imag[1]).toBeCloseTo(4 / Math.PI, 10);
    expect(imag[2]).toBeCloseTo(0, 10);
    expect(imag[3]).toBeCloseTo(4 / (3 * Math.PI), 10);
  });

  it('gives a narrow duty its even harmonics', () => {
    const { imag } = pulseWaveCoefficients(0.25, 4);
    expect(Math.abs(imag[2] ?? 0)).toBeGreaterThan(0.1);
  });

  it('never goes silent at the extremes', () => {
    for (const duty of [0, 1]) {
      const { imag } = pulseWaveCoefficients(duty, 4);
      expect(imag.some((value) => Math.abs(value) > 1e-6)).toBe(true);
    }
  });
});

describe('playPlan — the graph that gets built', () => {
  function play(sound: unknown, context: FakeAudioContext = fakeAudioContext()): FakeAudioContext {
    playPlan(context, buildSoundPlan(parse(sound)), context.destination, 0);
    return context;
  }

  it('wires an oscillator through its own gain to the destination', () => {
    const context = play({ id: 'blip', wave: 'triangle', freq: 440 });

    expect(context.nodes.map((node) => node.kind)).toEqual(['gain', 'oscillator']);
    const [gain, oscillator] = context.nodes;
    expect(oscillator?.type).toBe('triangle');
    expect(oscillator?.connectedTo).toContain(gain);
    expect(gain?.connectedTo).toContain(context.destination);
  });

  it('starts and stops every voice, so nothing is left running', () => {
    const context = play({
      id: 'jingle',
      wave: 'square',
      sequence: [
        { freq: 440, duration: 0.1 },
        { freq: 880, duration: 0.1 },
      ],
    });

    const sources = context.nodes.filter((node) => node.kind === 'oscillator');
    expect(sources).toHaveLength(2);
    expect(sources.map((node) => node.started)).toEqual([0, 0.1]);
    expect(sources.map((node) => node.stopped)).toEqual([0.1, 0.2]);
  });

  it('schedules the pitch sweep as an exponential ramp on the oscillator', () => {
    const context = play({
      id: 'swept',
      wave: 'square',
      freq: [440, 220],
      envelope: [0, 0.1, 0],
    });

    const oscillator = context.nodes.find((node) => node.kind === 'oscillator');
    expect(oscillator?.params.frequency).toEqual([
      { kind: 'set', value: 440, time: 0 },
      { kind: 'exponential', value: 220, time: 0.1 },
    ]);
  });

  it('builds a periodic wave only when the duty cycle is not a plain square', () => {
    expect(play({ id: 'a', wave: 'square', freq: 440, duty: 0.5 }).periodicWaves).toHaveLength(0);
    expect(play({ id: 'b', wave: 'square', freq: 440 }).periodicWaves).toHaveLength(0);
    // A duty cycle on a wave that has none is data the synth is right to ignore.
    expect(play({ id: 'c', wave: 'triangle', freq: 440, duty: 0.2 }).periodicWaves).toHaveLength(0);

    const shaped = play({ id: 'd', wave: 'square', freq: 440, duty: 0.2 });
    expect(shaped.periodicWaves).toHaveLength(1);
    const oscillator = shaped.nodes.find((node) => node.kind === 'oscillator');
    expect(oscillator?.periodicWave).toBe(shaped.periodicWaves[0]);
  });

  it('builds noise as a looped buffer through a band-pass', () => {
    const context = play({ id: 'hit', wave: 'noise', freq: [3000, 400] });

    expect(context.nodes.map((node) => node.kind)).toEqual(['gain', 'bufferSource', 'filter']);
    const [gain, source, filter] = context.nodes;
    expect(source?.loop).toBe(true);
    expect(source?.buffer).not.toBeNull();
    expect(filter?.type).toBe('bandpass');
    expect(source?.connectedTo).toContain(filter);
    expect(filter?.connectedTo).toContain(gain);
    expect(filter?.params.frequency.at(-1)).toMatchObject({ value: 400, kind: 'exponential' });
  });

  it('fills the noise buffer once per context, deterministically', () => {
    const context = fakeAudioContext();
    play({ id: 'hit', wave: 'noise', freq: 800 }, context);
    play({ id: 'hit2', wave: 'noise', freq: 900 }, context);

    expect(context.buffers).toHaveLength(1);
    const data = context.buffers[0]?.getChannelData(0);
    expect(data?.some((sample) => sample !== 0)).toBe(true);

    const other = fakeAudioContext();
    play({ id: 'hit', wave: 'noise', freq: 800 }, other);
    expect([...(other.buffers[0]?.getChannelData(0) ?? [])]).toEqual([...(data ?? [])]);
  });

  it('adds an LFO through a depth gain into the pitch for vibrato', () => {
    const context = play({
      id: 'wobble',
      wave: 'square',
      freq: 400,
      vibrato: { rate: 8, depth: 0.25 },
    });

    const oscillators = context.nodes.filter((node) => node.kind === 'oscillator');
    expect(oscillators).toHaveLength(2);
    const [voice, lfo] = oscillators;
    expect(lfo?.type).toBe('sine');
    expect(lfo?.params.frequency).toEqual([]);
    expect(lfo?.frequencyValue).toBe(8);

    const depth = context.nodes.filter((node) => node.kind === 'gain').at(-1);
    expect(depth?.gainValue).toBe(100);
    expect(lfo?.connectedTo).toContain(depth);
    expect(depth?.connectedTo).toContain(voice?.params.frequencyParam);
  });

  it('offsets everything by the start time it is given', () => {
    const context = fakeAudioContext();
    playPlan(
      context,
      buildSoundPlan(parse({ id: 'blip', wave: 'square', freq: 440 })),
      context.destination,
      2.5,
    );

    const oscillator = context.nodes.find((node) => node.kind === 'oscillator');
    expect(oscillator?.started).toBe(2.5);
    expect(oscillator?.params.frequency[0]?.time).toBe(2.5);
  });
});

describe('createSynth — the autoplay rule', () => {
  const blip = parse({ id: 'blip', wave: 'square', freq: 440 });

  it('makes no context until it is unlocked', () => {
    const createContext = vi.fn(() => fakeAudioContext());
    const synth = createSynth({ createContext });

    expect(createContext).not.toHaveBeenCalled();
    expect(synth.available).toBe(false);

    // Playing while locked is silent, not an error.
    expect(() => {
      synth.play(blip);
    }).not.toThrow();
    expect(createContext).not.toHaveBeenCalled();

    expect(synth.unlock()).toBe(true);
    expect(synth.available).toBe(true);
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it('reuses the context and resumes it on a second unlock', () => {
    const context = fakeAudioContext();
    const createContext = vi.fn(() => context);
    const synth = createSynth({ createContext });

    synth.unlock();
    synth.unlock();
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(context.resumeCalls).toBe(2);
  });

  it('stays silent and keeps going when there is no audio at all', () => {
    const onError = vi.fn();
    const synth = createSynth({ createContext: () => undefined, onError });

    expect(synth.unlock()).toBe(false);
    expect(synth.available).toBe(false);
    expect(() => {
      synth.play(blip);
    }).not.toThrow();
    expect(onError).not.toHaveBeenCalled();
  });

  it('swallows a context that throws on creation', () => {
    const onError = vi.fn();
    const synth = createSynth({
      createContext: () => {
        throw new Error('blocked by autoplay policy');
      },
      onError,
    });

    expect(synth.unlock()).toBe(false);
    expect(synth.available).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('swallows a failure part-way through scheduling', () => {
    const context = fakeAudioContext();
    const onError = vi.fn();
    const synth = createSynth({ createContext: () => context, onError });
    synth.unlock();

    context.failNextOscillator = true;
    expect(() => {
      synth.play(blip);
    }).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);

    // And the next sound still plays.
    synth.play(blip);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('plays nothing while muted, and puts the master gain back afterwards', () => {
    const context = fakeAudioContext();
    const synth = createSynth({ createContext: () => context, volume: 0.8 });
    synth.unlock();

    const master = context.nodes[0];
    expect(master?.gainValue).toBe(0.8);

    synth.setMuted(true);
    const before = context.nodes.length;
    synth.play(blip);
    expect(context.nodes).toHaveLength(before);
    expect(master?.gainValue).toBe(0);

    synth.setMuted(false);
    expect(master?.gainValue).toBe(0.8);
    synth.play(blip);
    expect(context.nodes.length).toBeGreaterThan(before);
  });

  it('clamps the volume to 0…1', () => {
    const synth = createSynth({ createContext: () => fakeAudioContext() });
    synth.setVolume(4);
    expect(synth.volume).toBe(1);
    synth.setVolume(-1);
    expect(synth.volume).toBe(0);
    synth.setVolume(Number.NaN);
    expect(synth.volume).toBe(0);
  });

  it('can be closed and unlocked again', () => {
    const synth = createSynth({ createContext: () => fakeAudioContext() });
    synth.unlock();
    synth.close();
    expect(synth.available).toBe(false);
    expect(synth.unlock()).toBe(true);
  });
});

describe('createSynth — a sound that may have to stop early', () => {
  const tune = parse({
    id: 'tune',
    wave: 'square',
    sequence: [
      { freq: 523, duration: 0.2 },
      { freq: 659, duration: 0.2 },
    ],
    parts: [{ wave: 'triangle', sequence: [{ freq: 131, duration: 0.4 }] }],
  });

  it('plays through its own gain under the master, so a cut touches nothing else', () => {
    const context = fakeAudioContext();
    const synth = createSynth({ createContext: () => context });
    synth.unlock();
    const master = context.nodes[0];

    expect(synth.start(tune)).toBeDefined();

    const bus = context.nodes[1];
    expect(bus?.kind).toBe('gain');
    expect(bus?.connectedTo).toEqual([master]);
    expect(context.nodes.filter((node) => node.kind === 'oscillator')).toHaveLength(3);
  });

  it('fades the gain out and stops every voice, the notes not yet reached included', () => {
    const context = fakeAudioContext();
    const synth = createSynth({ createContext: () => context });
    synth.unlock();
    const playback = synth.start(tune);
    (context as { currentTime: number }).currentTime = 0.1;

    playback?.stop();

    const bus = context.nodes[1];
    expect(bus?.params.gain).toEqual([
      { kind: 'set', value: 1, time: 0.1 },
      { kind: 'linear', value: 0, time: 0.1 + STOP_FADE_SECONDS },
    ]);
    const oscillators = context.nodes.filter((node) => node.kind === 'oscillator');
    // The second melody note starts at 0.2: stopping it before then means it never sounds.
    for (const oscillator of oscillators) {
      expect(oscillator.stopped).toBeCloseTo(0.1 + STOP_FADE_SECONDS, 10);
    }
  });

  it('can be stopped twice without scheduling a second fade', () => {
    const context = fakeAudioContext();
    const synth = createSynth({ createContext: () => context });
    synth.unlock();
    const playback = synth.start(tune);

    playback?.stop();
    playback?.stop();

    expect(context.nodes[1]?.params.gain).toHaveLength(2);
  });

  it('obeys mute and volume through the same master as every effect', () => {
    const context = fakeAudioContext();
    const synth = createSynth({ createContext: () => context, volume: 0.5 });
    synth.unlock();
    const master = context.nodes[0];

    synth.setMuted(true);
    const before = context.nodes.length;
    expect(synth.start(tune)).toBeUndefined();
    expect(context.nodes).toHaveLength(before);

    synth.setMuted(false);
    synth.start(tune);
    synth.setVolume(0.2);
    expect(master?.gainValue).toBe(0.2);
  });

  it('is silent and harmless before it is unlocked, and with no audio at all', () => {
    expect(createSynth({ createContext: () => fakeAudioContext() }).start(tune)).toBeUndefined();

    const none = createSynth({ createContext: () => undefined });
    none.unlock();
    expect(none.start(tune)).toBeUndefined();
  });

  it('swallows a failure, reporting it, rather than taking the frame down', () => {
    const context = fakeAudioContext();
    const errors: unknown[] = [];
    const synth = createSynth({ createContext: () => context, onError: (e) => errors.push(e) });
    synth.unlock();
    context.failNextOscillator = true;

    expect(() => synth.start(tune)).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});

describe('unlockOnFirstGesture', () => {
  function fakeTarget() {
    const listeners = new Map<string, () => void>();
    return {
      listeners,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string, listener: () => void) => {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };
  }

  it('unlocks once, then stops listening', () => {
    const target = fakeTarget();
    const createContext = vi.fn(() => fakeAudioContext());
    const synth = createSynth({ createContext });

    unlockOnFirstGesture(synth, target);
    expect(target.listeners.size).toBeGreaterThan(0);

    target.listeners.get('keydown')?.();
    expect(synth.available).toBe(true);
    expect(target.listeners.size).toBe(0);
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it('can be detached before any gesture arrives', () => {
    const target = fakeTarget();
    const synth = createSynth({ createContext: () => fakeAudioContext() });

    unlockOnFirstGesture(synth, target)();
    expect(target.listeners.size).toBe(0);
    expect(synth.available).toBe(false);
  });

  it('is a no-op on a host with nothing to listen to', () => {
    const synth = createSynth({ createContext: () => fakeAudioContext() });
    expect(() => {
      unlockOnFirstGesture(synth, undefined)();
    }).not.toThrow();
  });
});
