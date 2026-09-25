import { describe, expect, it, vi } from 'vitest';

import { createSfx, unresolvedBindings, type SfxEvent } from '../../src/audio/sfx.js';
import { createSynth } from '../../src/audio/synth.js';
import type { Sound } from '../../src/content/schema.js';
import { soundSchema } from '../../src/content/schema.js';
import { fakeAudioContext, type FakeAudioContext } from './helpers/fake-audio-context.js';

/**
 * The sim-to-audio subscription (`docs/DESIGN.md` section 9). Two things are
 * being pinned: the right event plays the right sound, and audio can neither
 * reach back into the simulation nor take a frame down with it.
 */

const sound = (id: string, wave: Sound['wave'] = 'square'): Sound =>
  soundSchema.parse({ id, wave, freq: 440 });

const sounds = new Map<string, Sound>([
  ['fire', sound('fire')],
  ['enemy-hit', sound('enemy-hit', 'noise')],
  ['stage-start', sound('stage-start')],
]);

const bindings = {
  'shot-fired': 'fire',
  'target-destroyed': 'enemy-hit',
  'stage-started': 'stage-start',
};

function recordingPlayer() {
  const played: string[] = [];
  return { played, play: (value: Sound) => played.push(value.id) };
}

describe('createSfx', () => {
  it('plays the sound its pack binds to the event', () => {
    const player = recordingPlayer();
    const sfx = createSfx({ player, sounds, bindings });

    sfx.handle([{ type: 'stage-started' }, { type: 'shot-fired' }, { type: 'target-destroyed' }]);

    expect(player.played).toEqual(['stage-start', 'fire', 'enemy-hit']);
  });

  it('ignores an event nothing is bound to', () => {
    const player = recordingPlayer();
    const sfx = createSfx({ player, sounds, bindings });

    sfx.handle([{ type: 'score-changed' }, { type: 'player-ready' }]);

    expect(player.played).toEqual([]);
  });

  it('ignores a binding whose sound no pack defines', () => {
    const player = recordingPlayer();
    const sfx = createSfx({ player, sounds, bindings: { 'shot-fired': 'nowhere' } });

    sfx.handle([{ type: 'shot-fired' }]);

    expect(player.played).toEqual([]);
  });

  it('plays each sound once per batch, however many events ask for it', () => {
    const player = recordingPlayer();
    const sfx = createSfx({ player, sounds, bindings });

    // One shot through a group: eight kills and two shots in a single step.
    sfx.handle([
      { type: 'shot-fired' },
      { type: 'shot-fired' },
      ...Array.from({ length: 8 }, () => ({ type: 'target-destroyed' })),
    ]);
    expect(player.played).toEqual(['fire', 'enemy-hit']);

    // The next batch starts again.
    sfx.handle([{ type: 'shot-fired' }]);
    expect(player.played).toEqual(['fire', 'enemy-hit', 'fire']);
  });

  it('lets a resolver have the last word, and falls through to the bindings', () => {
    const player = recordingPlayer();
    const sfx = createSfx({
      player,
      sounds,
      bindings,
      resolve: (event) => (event.type === 'target-destroyed' ? 'stage-start' : undefined),
    });

    sfx.handle([{ type: 'target-destroyed' }, { type: 'shot-fired' }]);

    expect(player.played).toEqual(['stage-start', 'fire']);
  });

  it('reports which sound an event would play without playing it', () => {
    const player = recordingPlayer();
    const sfx = createSfx({ player, sounds, bindings });

    expect(sfx.soundIdFor({ type: 'shot-fired' })).toBe('fire');
    expect(sfx.soundFor({ type: 'shot-fired' })?.id).toBe('fire');
    expect(sfx.soundFor({ type: 'nothing' })).toBeUndefined();
    expect(player.played).toEqual([]);
  });

  it('does nothing at all with an empty batch', () => {
    const play = vi.fn();
    createSfx({ player: { play }, sounds, bindings }).handle([]);
    expect(play).not.toHaveBeenCalled();
  });
});

describe('createSfx — audio must never take the game down', () => {
  it('keeps going when the synth throws, and still plays the rest', () => {
    const played: string[] = [];
    const onError = vi.fn();
    const sfx = createSfx({
      player: {
        play(value) {
          if (value.id === 'fire') throw new Error('audio hardware went away');
          played.push(value.id);
        },
      },
      sounds,
      bindings,
      onError,
    });

    expect(() => {
      sfx.handle([{ type: 'shot-fired' }, { type: 'target-destroyed' }]);
    }).not.toThrow();

    expect(played).toEqual(['enemy-hit']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('keeps going when a resolver throws', () => {
    const player = recordingPlayer();
    const onError = vi.fn();
    const sfx = createSfx({
      player,
      sounds,
      bindings,
      resolve: (event) => {
        if (event.type === 'shot-fired') throw new Error('bad resolver');
        return undefined;
      },
      onError,
    });

    expect(() => {
      sfx.handle([{ type: 'shot-fired' }, { type: 'target-destroyed' }]);
    }).not.toThrow();

    expect(player.played).toEqual(['enemy-hit']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('runs against a locked synth, which is the state before the first gesture', () => {
    const synth = createSynth({ createContext: () => fakeAudioContext() });
    const sfx = createSfx({ player: synth, sounds, bindings });

    expect(synth.available).toBe(false);
    expect(() => {
      sfx.handle([{ type: 'shot-fired' }]);
    }).not.toThrow();

    synth.unlock();
    sfx.handle([{ type: 'shot-fired' }]);
    expect((synth.context as FakeAudioContext | undefined)?.nodes.length).toBeGreaterThan(0);
  });
});

describe('createSfx — audio cannot affect the simulation', () => {
  /**
   * The sim hands its events over and carries on; if audio could write to them
   * or hand something back, a run with sound would not be the run a replay
   * reproduces (`docs/DESIGN.md` pillar 4). Frozen events are the cheap proof:
   * any write at all would throw in strict mode, which modules are.
   */
  it('neither mutates the events it is given nor returns anything', () => {
    const player = recordingPlayer();
    const sfx = createSfx({ player, sounds, bindings });

    const events = Object.freeze([
      Object.freeze({ type: 'shot-fired', slot: 0, x: 100, y: 200 }),
      Object.freeze({ type: 'target-destroyed', targetId: 7, score: 50 }),
    ]);
    const before = JSON.stringify(events);

    expect(sfx.handle(events)).toBeUndefined();
    expect(JSON.stringify(events)).toBe(before);
    expect(player.played).toEqual(['fire', 'enemy-hit']);
  });

  /**
   * A stand-in for a step loop: a pure reducer that emits events, driven twice
   * over the same inputs — once with audio attached and once without. The
   * fixture is not the real simulation (that lands with a sibling task), but the
   * property it checks is the one that matters here: `handle` is a sink.
   */
  it('leaves the stepping state identical whether or not audio is attached', () => {
    interface State {
      readonly step: number;
      readonly score: number;
    }

    const step = (state: State): { state: State; events: SfxEvent[] } => {
      const events: SfxEvent[] = [{ type: 'shot-fired' }];
      const hit = state.step % 3 === 0;
      if (hit) events.push({ type: 'target-destroyed' });
      return { state: { step: state.step + 1, score: state.score + (hit ? 50 : 0) }, events };
    };

    const run = (sink: ((events: readonly SfxEvent[]) => void) | undefined): State => {
      let state: State = { step: 0, score: 0 };
      for (let i = 0; i < 600; i += 1) {
        const next = step(state);
        state = next.state;
        sink?.(next.events);
      }
      return state;
    };

    const silent = run(undefined);

    const synth = createSynth({ createContext: () => fakeAudioContext() });
    synth.unlock();
    const sfx = createSfx({ player: synth, sounds, bindings });
    const sounded = run((events) => {
      sfx.handle(events);
    });

    expect(sounded).toEqual(silent);
    expect((synth.context as FakeAudioContext | undefined)?.nodes.length).toBeGreaterThan(0);
  });
});

describe('unresolvedBindings', () => {
  it('is empty when every bound sound exists', () => {
    expect(unresolvedBindings(bindings, sounds)).toEqual([]);
  });

  it('names the sounds that do not', () => {
    expect(unresolvedBindings({ a: 'fire', b: 'missing' }, sounds)).toEqual(['missing']);
  });
});
