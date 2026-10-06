/**
 * The parametric synth — `docs/DESIGN.md` sections 3 and 5.
 *
 * A sound is **data** (`soundSchema` in `src/content/schema.ts`): a waveform, a
 * pitch or a sweep, an envelope, optional vibrato and duty, or a sequence of
 * steps for a jingle. Nothing about any particular effect lives here, because a
 * prompt generates sounds later (section 8) and a generator cannot add a branch
 * to this file.
 *
 * The file is in two halves, and the split is what makes it testable:
 *
 * 1. **`buildSoundPlan`** turns a `Sound` into a `SoundPlan` — the voices, their
 *    lifetimes and every scheduled parameter change, as plain numbers. Pure, and
 *    the half the tests assert against.
 * 2. **`playPlan` and `createSynth`** realise a plan as Web Audio nodes. They
 *    are typed against `SynthContext`, a structural subset of `BaseAudioContext`
 *    that a real `AudioContext` satisfies and a test double can implement, so
 *    the graph construction is checked on the Node test environment.
 *
 * Two rules from the plan are load-bearing here:
 *
 * - **Autoplay.** A context is never created at construction time. `unlock()`
 *   makes one, and it is meant to be called from a user gesture
 *   (`unlockOnFirstGesture`). Until then `play` is a no-op.
 * - **Never take the game down.** Every call into Web Audio is wrapped. If the
 *   browser has no audio, blocks it, or throws mid-schedule, the game runs on in
 *   silence.
 *
 * Audio is presentation: nothing here is on the fixed simulation step, nothing
 * here is read back by `src/sim/`, and durations are seconds rather than frames.
 */

import { createRng } from '../engine/rng.js';
import type { Sound, SoundStep } from '../content/schema.js';

/* -------------------------------------------------------------------------- */
/* The plan                                                                     */
/* -------------------------------------------------------------------------- */

export type Waveform = Sound['wave'];

/** One scheduled change to one parameter, in seconds from the sound's start. */
export interface ParamRamp {
  readonly time: number;
  readonly value: number;
  readonly kind: 'set' | 'linear' | 'exponential';
}

/** Fourier partials for a pulse wave whose duty cycle is not the default half. */
export interface PulseWave {
  readonly real: readonly number[];
  readonly imag: readonly number[];
}

export interface VibratoPlan {
  /** Hertz. */
  readonly rate: number;
  /** Peak pitch deviation in hertz — the sound's `depth` against its own pitch. */
  readonly peak: number;
}

/** One voice: an oscillator (or a noise burst) with its own envelope. */
export interface VoicePlan {
  readonly wave: Waveform;
  /** `noise` is a white-noise buffer through a band-pass; everything else oscillates. */
  readonly source: 'oscillator' | 'noise';
  /** Seconds from the sound's start. */
  readonly start: number;
  readonly stop: number;
  /** Oscillator pitch, or the band-pass centre frequency of a noise voice. */
  readonly frequency: readonly ParamRamp[];
  readonly gain: readonly ParamRamp[];
  readonly pulse?: PulseWave;
  readonly vibrato?: VibratoPlan;
  /** Band-pass resonance. Noise voices only. */
  readonly q?: number;
}

export interface SoundPlan {
  readonly id: string;
  /** Total length in seconds. */
  readonly duration: number;
  readonly voices: readonly VoicePlan[];
}

/**
 * Applied when a sound states no envelope: a click-free attack, a short hold and
 * a short tail. Short enough that a bare `{ freq }` sound reads as a blip rather
 * than a tone, which is what the arcade style wants.
 */
export const DEFAULT_ENVELOPE: readonly [number, number, number] = [0.004, 0.03, 0.06];

/** Applied when a sound or step states no volume. */
export const DEFAULT_VOLUME = 0.6;

/** Band-pass resonance for noise voices: wide enough to stay noisy, narrow enough to pitch. */
export const NOISE_Q = 1.4;

/** Partials used to build a pulse wave. Beyond this the harmonics alias more than they add. */
export const PULSE_HARMONICS = 24;

/** Duty cycles at or past the ends are silent, so they are pulled just inside. */
const DUTY_LIMIT = 0.01;

/** How close to a half duty cycle still counts as a plain square wave. */
const DUTY_EPSILON = 1e-6;

type Pitch = NonNullable<Sound['freq']>;
type Envelope = readonly [number, number, number];

function isSweep(pitch: Pitch): pitch is [number, number] {
  return Array.isArray(pitch);
}

/** The pitch a vibrato depth is a fraction of: a sweep's geometric middle. */
function referencePitch(pitch: Pitch): number {
  return isSweep(pitch) ? Math.sqrt(pitch[0] * pitch[1]) : pitch;
}

/**
 * `[attack, hold, release]` fitted to a duration the sound states separately.
 *
 * Sequence steps carry their own `duration`, so the envelope is a *shape* there
 * rather than a length; scaling keeps the shape and honours the step. An
 * envelope of all zeroes would scale to nothing, so it falls back to a mostly
 * flat one.
 */
export function scaleEnvelope(envelope: Envelope, duration: number): Envelope {
  const total = envelope[0] + envelope[1] + envelope[2];
  if (total <= 0) return [0, duration * 0.75, duration * 0.25];
  const factor = duration / total;
  return [envelope[0] * factor, envelope[1] * factor, envelope[2] * factor];
}

/**
 * Fourier coefficients of a pulse wave of the given duty cycle, for
 * `createPeriodicWave`. A half duty reproduces the standard square — the odd
 * harmonics at `4/(nπ)` — which is the check the tests pin.
 */
export function pulseWaveCoefficients(duty: number, harmonics = PULSE_HARMONICS): PulseWave {
  const clamped = Math.min(1 - DUTY_LIMIT, Math.max(DUTY_LIMIT, duty));
  const real = [0];
  const imag = [0];
  for (let n = 1; n <= harmonics; n += 1) {
    const angle = 2 * Math.PI * n * clamped;
    real.push((2 * Math.sin(angle)) / (Math.PI * n));
    imag.push((2 * (1 - Math.cos(angle))) / (Math.PI * n));
  }
  return { real, imag };
}

function frequencyRamps(pitch: Pitch, start: number, duration: number): ParamRamp[] {
  if (!isSweep(pitch)) return [{ time: start, value: pitch, kind: 'set' }];
  return [
    { time: start, value: pitch[0], kind: 'set' },
    // Exponential, because a pitch sweep that is linear in hertz is not linear
    // to the ear. The schema makes both endpoints positive, which is exactly
    // what `exponentialRampToValueAtTime` requires.
    { time: start + duration, value: pitch[1], kind: 'exponential' },
  ];
}

/**
 * Attack to the peak, hold, release to nothing — always four points, so a
 * caller (and a test) can read the shape positionally.
 *
 * Linear rather than exponential: an exponential ramp cannot reach zero, and a
 * gain that never reaches zero leaves the voice audible until it is stopped.
 */
function gainRamps(envelope: Envelope, start: number, peak: number): ParamRamp[] {
  const [attack, hold, release] = envelope;
  return [
    { time: start, value: 0, kind: 'set' },
    { time: start + attack, value: peak, kind: 'linear' },
    { time: start + attack + hold, value: peak, kind: 'linear' },
    { time: start + attack + hold + release, value: 0, kind: 'linear' },
  ];
}

interface VoiceSpec {
  readonly wave: Waveform;
  readonly pitch: Pitch;
  readonly start: number;
  readonly duration: number;
  readonly envelope: Envelope;
  readonly volume: number;
  readonly duty: number | undefined;
  readonly vibrato: Sound['vibrato'];
}

function buildVoice(spec: VoiceSpec): VoicePlan {
  const noise = spec.wave === 'noise';
  const voice: VoicePlan = {
    wave: spec.wave,
    source: noise ? 'noise' : 'oscillator',
    start: spec.start,
    stop: spec.start + spec.duration,
    frequency: frequencyRamps(spec.pitch, spec.start, spec.duration),
    gain: gainRamps(spec.envelope, spec.start, spec.volume),
  };

  // `duty` is documented as square-only, and a half duty is what a plain square
  // oscillator already is — so a periodic wave is built only when it would
  // sound different from the built-in one.
  const shaped =
    spec.wave === 'square' && spec.duty !== undefined && Math.abs(spec.duty - 0.5) > DUTY_EPSILON
      ? { ...voice, pulse: pulseWaveCoefficients(spec.duty) }
      : voice;

  // Vibrato is a wobble in pitch, and a noise voice has none — its `frequency`
  // is a filter's centre. Dropping it here rather than in `playPlan` keeps the
  // plan an honest description of the graph that gets built.
  const pitched =
    spec.vibrato === undefined || noise
      ? shaped
      : {
          ...shaped,
          vibrato: {
            rate: spec.vibrato.rate,
            peak: spec.vibrato.depth * referencePitch(spec.pitch),
          },
        };

  return noise ? { ...pitched, q: NOISE_Q } : pitched;
}

/** What a line of a jingle inherits from the sound it belongs to. */
interface LineDefaults {
  readonly wave: Waveform;
  readonly envelope: Envelope;
  readonly volume: number;
  readonly duty: number | undefined;
  readonly vibrato: Sound['vibrato'];
}

/**
 * One line of a jingle: one voice per note, laid end to end from the sound's
 * start, each note free to state its own wave and volume. A rest advances the
 * clock and builds nothing. Returns where the line ends.
 */
function sequenceVoices(
  steps: readonly SoundStep[],
  line: LineDefaults,
  voices: VoicePlan[],
): number {
  let start = 0;
  for (const step of steps) {
    if (!('rest' in step)) {
      voices.push(
        buildVoice({
          wave: step.wave ?? line.wave,
          pitch: step.freq,
          start,
          duration: step.duration,
          envelope: scaleEnvelope(line.envelope, step.duration),
          volume: step.volume ?? line.volume,
          duty: line.duty,
          vibrato: line.vibrato,
        }),
      );
    }
    start += step.duration;
  }
  return start;
}

/**
 * Turn a validated sound definition into the graph to build for it.
 *
 * A `sequence` is a jingle: one voice per note, laid end to end. Its `parts`
 * are further lines sounding at the same time, each starting with the sound and
 * taking its wave, envelope, volume and duty from the sound when it omits them. Without a sequence the
 * sound is a single voice whose length is its envelope.
 */
export function buildSoundPlan(sound: Sound): SoundPlan {
  const line: LineDefaults = {
    wave: sound.wave,
    envelope: sound.envelope ?? DEFAULT_ENVELOPE,
    volume: sound.volume ?? DEFAULT_VOLUME,
    duty: sound.duty,
    vibrato: sound.vibrato,
  };
  const voices: VoicePlan[] = [];
  let duration: number;

  if (sound.sequence !== undefined) {
    duration = sequenceVoices(sound.sequence, line, voices);
  } else {
    // The schema refuses a sound with neither `freq` nor `sequence`, so this is
    // the single-tone case and the pitch is there.
    const envelope = line.envelope;
    duration = envelope[0] + envelope[1] + envelope[2];
    voices.push(
      buildVoice({
        ...line,
        pitch: sound.freq ?? 440,
        start: 0,
        duration,
      }),
    );
  }

  for (const part of sound.parts ?? []) {
    const end = sequenceVoices(
      part.sequence,
      {
        wave: part.wave ?? line.wave,
        envelope: part.envelope ?? line.envelope,
        volume: part.volume ?? line.volume,
        duty: part.duty ?? line.duty,
        // Not inherited: a wobble is one line's character, and a part has no way
        // to say "none" — a bass that shook with its melody could not be written.
        vibrato: part.vibrato,
      },
      voices,
    );
    duration = Math.max(duration, end);
  }

  return { id: sound.id, duration, voices };
}

/* -------------------------------------------------------------------------- */
/* Realising a plan                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The slice of Web Audio the synth uses, named structurally.
 *
 * A real `AudioContext` satisfies this. So does a recording double, which is how
 * `tests/unit/synth.test.ts` inspects the graph on the Node environment where
 * there is no Web Audio at all.
 */
export interface SynthParam {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}

export interface SynthNode {
  connect(destination: SynthNode | SynthParam): unknown;
  disconnect(): unknown;
}

export interface SynthGain extends SynthNode {
  readonly gain: SynthParam;
}

export interface SynthOscillator extends SynthNode {
  type: string;
  readonly frequency: SynthParam;
  setPeriodicWave(wave: SynthPeriodicWave): unknown;
  start(when: number): unknown;
  stop(when: number): unknown;
}

export interface SynthBuffer {
  getChannelData(channel: number): Float32Array;
}

export interface SynthBufferSource extends SynthNode {
  buffer: SynthBuffer | null;
  loop: boolean;
  start(when: number): unknown;
  stop(when: number): unknown;
}

export interface SynthFilter extends SynthNode {
  type: string;
  readonly frequency: SynthParam;
  readonly Q: SynthParam;
}

export type SynthPeriodicWave = object;

/** A node `playPlan` started, and can therefore be stopped early. */
export interface SynthSource {
  stop(when: number): unknown;
}

export interface SynthContext {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: SynthNode;
  readonly state?: string;
  createGain(): SynthGain;
  createOscillator(): SynthOscillator;
  createBufferSource(): SynthBufferSource;
  createBuffer(channels: number, length: number, sampleRate: number): SynthBuffer;
  createBiquadFilter(): SynthFilter;
  createPeriodicWave(real: Float32Array, imag: Float32Array): SynthPeriodicWave;
  resume?: () => unknown;
  close?: () => unknown;
}

/** Oscillator types the platform provides directly; `noise` is built by hand. */
const OSCILLATOR_TYPES: Partial<Record<Waveform, string>> = {
  square: 'square',
  triangle: 'triangle',
  sine: 'sine',
  sawtooth: 'sawtooth',
};

/** Seconds of white noise generated per context, looped for longer bursts. */
const NOISE_BUFFER_SECONDS = 1;

/**
 * The noise buffer is drawn from a seeded generator rather than `Math.random`.
 * Nothing forces that on the audio side, but it costs nothing and it means two
 * runs of the same build hiss identically — useful when comparing recordings.
 */
const NOISE_SEED = 'star-swarm-noise';

const noiseBuffers = new WeakMap<SynthContext, SynthBuffer>();

function noiseBuffer(context: SynthContext): SynthBuffer {
  const cached = noiseBuffers.get(context);
  if (cached !== undefined) return cached;

  const length = Math.max(1, Math.floor(context.sampleRate * NOISE_BUFFER_SECONDS));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = createRng(NOISE_SEED);
  for (let i = 0; i < data.length; i += 1) data[i] = rng.float(-1, 1);
  noiseBuffers.set(context, buffer);
  return buffer;
}

function applyRamps(param: SynthParam, ramps: readonly ParamRamp[], at: number): void {
  for (const ramp of ramps) {
    const time = at + ramp.time;
    if (ramp.kind === 'set') param.setValueAtTime(ramp.value, time);
    else if (ramp.kind === 'linear') param.linearRampToValueAtTime(ramp.value, time);
    else param.exponentialRampToValueAtTime(ramp.value, time);
  }
}

/**
 * Build and start the nodes for one plan, at `at` on the context's own clock.
 *
 * Every voice is `source → [filter] → gain → destination`, with vibrato as a
 * sine oscillator through its own gain into the pitch parameter. Nodes are
 * started and stopped explicitly, so they are collected when the voice ends.
 *
 * Returns every source it started, so a caller that has to end the sound early
 * — the music channel cutting one jingle for the next — can stop them.
 */
export function playPlan(
  context: SynthContext,
  plan: SoundPlan,
  destination: SynthNode,
  at: number = context.currentTime,
): SynthSource[] {
  const sources: SynthSource[] = [];
  for (const voice of plan.voices) {
    const amp = context.createGain();
    amp.gain.value = 0;
    applyRamps(amp.gain, voice.gain, at);
    amp.connect(destination);

    if (voice.source === 'noise') {
      const source = context.createBufferSource();
      source.buffer = noiseBuffer(context);
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = voice.q ?? NOISE_Q;
      applyRamps(filter.frequency, voice.frequency, at);
      source.connect(filter);
      filter.connect(amp);
      source.start(at + voice.start);
      source.stop(at + voice.stop);
      sources.push(source);
      continue;
    }

    const oscillator = context.createOscillator();
    if (voice.pulse === undefined) {
      oscillator.type = OSCILLATOR_TYPES[voice.wave] ?? 'square';
    } else {
      oscillator.setPeriodicWave(
        context.createPeriodicWave(
          Float32Array.from(voice.pulse.real),
          Float32Array.from(voice.pulse.imag),
        ),
      );
    }
    applyRamps(oscillator.frequency, voice.frequency, at);

    if (voice.vibrato !== undefined) {
      const lfo = context.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = voice.vibrato.rate;
      const depth = context.createGain();
      depth.gain.value = voice.vibrato.peak;
      lfo.connect(depth);
      depth.connect(oscillator.frequency);
      lfo.start(at + voice.start);
      lfo.stop(at + voice.stop);
      sources.push(lfo);
    }

    oscillator.connect(amp);
    oscillator.start(at + voice.start);
    oscillator.stop(at + voice.stop);
    sources.push(oscillator);
  }
  return sources;
}

/* -------------------------------------------------------------------------- */
/* The synth                                                                    */
/* -------------------------------------------------------------------------- */

export interface Synth {
  /** True once there is a context to play through. */
  readonly available: boolean;
  readonly muted: boolean;
  readonly volume: number;
  /** The context, once unlocked. For diagnostics and tests. */
  readonly context: SynthContext | undefined;
  /**
   * Create (or resume) the audio context. Browsers only allow this from a user
   * gesture, so call it from one — see `unlockOnFirstGesture`. Safe to call
   * repeatedly, and never throws.
   */
  unlock(): boolean;
  /** Play a sound definition. A no-op while locked, muted or unavailable. */
  play(sound: Sound): void;
  /**
   * Play a sound that may have to end before it finishes — the music channel's
   * jingles. `undefined` wherever `play` would have been a no-op. It goes
   * through the same master gain, so volume and mute reach it exactly as they
   * reach an effect.
   */
  start(sound: Sound): Playback | undefined;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Release the context. The synth can be unlocked again afterwards. */
  close(): void;
}

/** A sound started by `Synth.start`. */
export interface Playback {
  /**
   * Fade it out over {@link STOP_FADE_SECONDS} and stop every voice, including
   * notes not yet reached. Safe to call twice, after the sound has ended, and
   * after the synth has closed.
   */
  stop(): void;
}

/** Long enough that cutting a held note does not click, short enough to read as a cut. */
export const STOP_FADE_SECONDS = 0.03;

export interface SynthOptions {
  /** Master volume, 0…1. */
  readonly volume?: number;
  readonly muted?: boolean;
  /**
   * Make the context. Defaults to the platform's `AudioContext` when there is
   * one. Returning `undefined` — or throwing — leaves the game silent.
   */
  readonly createContext?: () => SynthContext | undefined;
  /** Where a swallowed audio failure goes. Nothing is reported by default. */
  readonly onError?: (error: unknown) => void;
}

interface AudioContextGlobals {
  AudioContext?: new () => SynthContext;
  webkitAudioContext?: new () => SynthContext;
}

/** The platform's audio context constructor, if this host has one at all. */
function defaultContextFactory(): SynthContext | undefined {
  const globals = globalThis as AudioContextGlobals;
  const Ctor = globals.AudioContext ?? globals.webkitAudioContext;
  return Ctor === undefined ? undefined : new Ctor();
}

/**
 * A synth that is silent until unlocked and silent if audio is unavailable.
 *
 * No context is created here: browsers reject one made outside a user gesture,
 * and a game that needs audio to start is a game that does not start.
 */
export function createSynth(options: SynthOptions = {}): Synth {
  const createContext = options.createContext ?? defaultContextFactory;
  const onError = options.onError;

  let context: SynthContext | undefined;
  let master: SynthGain | undefined;
  let volume = clampVolume(options.volume ?? 1);
  let muted = options.muted ?? false;
  const plans = new WeakMap<Sound, SoundPlan>();

  const report = (error: unknown): void => {
    // A synth that throws is a synth that takes the frame down with it. Report
    // if anyone is listening, then carry on in silence (docs/DESIGN.md §5).
    if (onError !== undefined) onError(error);
  };

  const planFor = (sound: Sound): SoundPlan => {
    const cached = plans.get(sound);
    if (cached !== undefined) return cached;
    const plan = buildSoundPlan(sound);
    plans.set(sound, plan);
    return plan;
  };

  const synth: Synth = {
    get available(): boolean {
      return context !== undefined && master !== undefined;
    },
    get muted(): boolean {
      return muted;
    },
    get volume(): number {
      return volume;
    },
    get context(): SynthContext | undefined {
      return context;
    },

    unlock(): boolean {
      try {
        if (context === undefined) {
          const created = createContext();
          if (created === undefined) return false;
          context = created;
          master = context.createGain();
          master.gain.value = muted ? 0 : volume;
          master.connect(context.destination);
        }
        // Suspended is the normal state for a context made before the gesture
        // landed, and for a tab that was backgrounded.
        context.resume?.();
        return true;
      } catch (error) {
        report(error);
        context = undefined;
        master = undefined;
        return false;
      }
    },

    play(sound: Sound): void {
      if (muted || context === undefined || master === undefined) return;
      try {
        playPlan(context, planFor(sound), master);
      } catch (error) {
        report(error);
      }
    },

    start(sound: Sound): Playback | undefined {
      if (muted || context === undefined || master === undefined) return undefined;
      const owner = context;
      try {
        // Its own gain stage under the master, so a cut can fade this sound
        // alone without touching the master the settings own.
        const bus = owner.createGain();
        bus.gain.value = 1;
        bus.connect(master);
        const sources = playPlan(owner, planFor(sound), bus);
        let stopped = false;
        return {
          stop(): void {
            if (stopped) return;
            stopped = true;
            try {
              const now = owner.currentTime;
              bus.gain.setValueAtTime(1, now);
              bus.gain.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS);
              for (const source of sources) source.stop(now + STOP_FADE_SECONDS);
            } catch (error) {
              report(error);
            }
          },
        };
      } catch (error) {
        report(error);
        return undefined;
      }
    },

    setVolume(next: number): void {
      volume = clampVolume(next);
      try {
        if (master !== undefined && !muted) master.gain.value = volume;
      } catch (error) {
        report(error);
      }
    },

    setMuted(next: boolean): void {
      muted = next;
      try {
        if (master !== undefined) master.gain.value = muted ? 0 : volume;
      } catch (error) {
        report(error);
      }
    },

    close(): void {
      try {
        master?.disconnect();
        context?.close?.();
      } catch (error) {
        report(error);
      } finally {
        master = undefined;
        context = undefined;
      }
    },
  };

  return synth;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
}

/** The gestures a browser accepts as permission to start audio. */
export const UNLOCK_GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;

/** The bit of an `EventTarget` this needs, so a test can pass a plain object. */
export interface GestureTarget {
  addEventListener(type: string, listener: () => void): unknown;
  removeEventListener(type: string, listener: () => void): unknown;
}

/**
 * Unlock the synth on the first user gesture, then stop listening.
 *
 * This is the whole of the autoplay policy from the game's side: nothing else
 * creates a context. Returns a detach function, and passing no target (a host
 * with no DOM) is a no-op rather than an error.
 */
export function unlockOnFirstGesture(
  synth: Synth,
  target: GestureTarget | undefined,
  gestures: readonly string[] = UNLOCK_GESTURES,
): () => void {
  if (target === undefined) return () => undefined;

  let detached = false;
  const detach = (): void => {
    if (detached) return;
    detached = true;
    for (const gesture of gestures) target.removeEventListener(gesture, onGesture);
  };

  function onGesture(): void {
    synth.unlock();
    detach();
  }

  for (const gesture of gestures) target.addEventListener(gesture, onGesture);
  return detach;
}
