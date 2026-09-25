/**
 * A recording stand-in for Web Audio.
 *
 * `src/audio/synth.ts` is typed against `SynthContext`, a structural subset of
 * `BaseAudioContext`, precisely so the graph it builds can be inspected on the
 * Node test environment — where there is no `AudioContext`, and deliberately so
 * (`vitest.config.ts`). Every node, connection and scheduled parameter change is
 * kept, and nothing makes a sound.
 */

import type {
  SynthBuffer,
  SynthBufferSource,
  SynthContext,
  SynthFilter,
  SynthGain,
  SynthNode,
  SynthOscillator,
  SynthParam,
  SynthPeriodicWave,
} from '../../../src/audio/synth.js';

export interface RecordedRamp {
  readonly kind: 'set' | 'linear' | 'exponential';
  readonly value: number;
  readonly time: number;
}

export class FakeParam implements SynthParam {
  value = 0;
  readonly ramps: RecordedRamp[] = [];

  setValueAtTime(value: number, time: number): this {
    this.ramps.push({ kind: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.ramps.push({ kind: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.ramps.push({ kind: 'exponential', value, time });
    return this;
  }
}

export type FakeNodeKind = 'destination' | 'gain' | 'oscillator' | 'bufferSource' | 'filter';

export class FakeNode implements SynthGain, SynthOscillator, SynthBufferSource, SynthFilter {
  readonly connectedTo: (SynthNode | SynthParam)[] = [];
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();

  type = '';
  loop = false;
  buffer: SynthBuffer | null = null;
  periodicWave: SynthPeriodicWave | undefined;
  started: number | undefined;
  stopped: number | undefined;
  disconnected = false;

  readonly kind: FakeNodeKind;

  constructor(kind: FakeNodeKind) {
    this.kind = kind;
  }

  /** The scheduled changes, grouped the way the tests want to read them. */
  get params(): {
    frequency: readonly RecordedRamp[];
    gain: readonly RecordedRamp[];
    q: readonly RecordedRamp[];
    frequencyParam: FakeParam;
  } {
    return {
      frequency: this.frequency.ramps,
      gain: this.gain.ramps,
      q: this.Q.ramps,
      frequencyParam: this.frequency,
    };
  }

  get gainValue(): number {
    return this.gain.value;
  }

  get frequencyValue(): number {
    return this.frequency.value;
  }

  connect(destination: SynthNode | SynthParam): this {
    this.connectedTo.push(destination);
    return this;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  setPeriodicWave(wave: SynthPeriodicWave): void {
    this.periodicWave = wave;
  }

  start(when: number): void {
    this.started = when;
  }

  stop(when: number): void {
    this.stopped = when;
  }
}

export class FakeBuffer implements SynthBuffer {
  private readonly channels: Float32Array[];

  constructor(channelCount: number, length: number) {
    this.channels = Array.from({ length: channelCount }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (data === undefined) throw new RangeError(`no channel ${String(channel)}`);
    return data;
  }
}

export interface FakeAudioContext extends SynthContext {
  readonly destination: FakeNode;
  /** Every node created, in creation order. The destination is not one of them. */
  readonly nodes: FakeNode[];
  readonly buffers: FakeBuffer[];
  readonly periodicWaves: SynthPeriodicWave[];
  resumeCalls: number;
  closed: boolean;
  /** Set to make the next `createOscillator` throw, as a hostile browser would. */
  failNextOscillator: boolean;
}

export function fakeAudioContext(sampleRate = 44100): FakeAudioContext {
  const nodes: FakeNode[] = [];
  const buffers: FakeBuffer[] = [];
  const periodicWaves: SynthPeriodicWave[] = [];

  const make = (kind: FakeNodeKind): FakeNode => {
    const node = new FakeNode(kind);
    nodes.push(node);
    return node;
  };

  const context: FakeAudioContext = {
    currentTime: 0,
    sampleRate,
    destination: new FakeNode('destination'),
    state: 'running',
    nodes,
    buffers,
    periodicWaves,
    resumeCalls: 0,
    closed: false,
    failNextOscillator: false,

    createGain: () => make('gain'),

    createOscillator: () => {
      if (context.failNextOscillator) {
        context.failNextOscillator = false;
        throw new Error('oscillator refused');
      }
      return make('oscillator');
    },

    createBufferSource: () => make('bufferSource'),

    createBiquadFilter: () => make('filter'),

    createBuffer: (channels: number, length: number) => {
      const buffer = new FakeBuffer(channels, length);
      buffers.push(buffer);
      return buffer;
    },

    createPeriodicWave: (real: Float32Array, imag: Float32Array) => {
      const wave = { real, imag };
      periodicWaves.push(wave);
      return wave;
    },

    resume: () => {
      context.resumeCalls += 1;
    },

    close: () => {
      context.closed = true;
    },
  };

  return context;
}
