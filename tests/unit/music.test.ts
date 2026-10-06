import { describe, expect, it } from 'vitest';

import {
  createMusic,
  cueMatches,
  unresolvedCues,
  type MusicPlayer,
} from '../../src/audio/music.js';
import type { SfxEvent } from '../../src/audio/sfx.js';
import {
  musicCueSchema,
  soundSchema,
  type MusicCue,
  type Sound,
} from '../../src/content/schema.js';

/**
 * The music channel (`src/audio/music.ts`): which jingle a step starts, and that
 * there is only ever one. What a jingle sounds like is the synth's business and
 * `tests/unit/synth.test.ts`'s; this pins the channel.
 */

const sound = (id: string): Sound =>
  soundSchema.parse({ id, wave: 'square', sequence: [{ freq: 440, duration: 0.1 }] });

const SOUNDS = new Map(
  ['opening', 'stage', 'lost', 'perfect', 'results'].map((id) => [id, sound(id)]),
);

const cue = (value: unknown): MusicCue => musicCueSchema.parse(value);

/** An event with fields beyond its type, as the simulation raises them. */
const event = (type: string, fields: Record<string, unknown>): SfxEvent => ({ type, ...fields });

const CUES: readonly MusicCue[] = [
  cue({ event: 'challenge-ended', when: { perfect: true }, sound: 'perfect' }),
  cue({ event: 'challenge-ended', sound: 'results' }),
  cue({ event: 'stage-started', when: { stage: 1 }, sound: 'opening' }),
  cue({ event: 'stage-started', sound: 'stage' }),
  cue({ event: 'player-captured', sound: 'lost' }),
];

/** A player that records what it was asked to start and what it was asked to stop. */
function recordingPlayer(): MusicPlayer & { started: string[]; stopped: string[] } {
  const started: string[] = [];
  const stopped: string[] = [];
  return {
    started,
    stopped,
    start(played: Sound) {
      started.push(played.id);
      return {
        stop: () => {
          stopped.push(played.id);
        },
      };
    },
  };
}

describe('cueMatches', () => {
  it('matches on the event type alone when the cue states no fields', () => {
    expect(
      cueMatches(cue({ event: 'stage-started', sound: 'stage' }), { type: 'stage-started' }),
    ).toBe(true);
    expect(
      cueMatches(cue({ event: 'stage-started', sound: 'stage' }), { type: 'stage-cleared' }),
    ).toBe(false);
  });

  it('narrows on every field `when` states, compared exactly', () => {
    const first = cue({ event: 'stage-started', when: { stage: 1 }, sound: 'opening' });
    const stage = (n: unknown) => event('stage-started', { stage: n });

    expect(cueMatches(first, stage(1))).toBe(true);
    expect(cueMatches(first, stage(2))).toBe(false);
    expect(cueMatches(first, stage('1'))).toBe(false);
    expect(cueMatches(first, { type: 'stage-started' })).toBe(false);
  });
});

describe('the music channel', () => {
  it('starts the jingle a step calls for', () => {
    const player = recordingPlayer();
    const music = createMusic({ player, sounds: SOUNDS, cues: CUES });

    music.handle([{ type: 'player-captured' }]);

    expect(player.started).toEqual(['lost']);
  });

  it('plays one jingle per step, the earliest cue in the list that matches anything', () => {
    const player = recordingPlayer();
    const music = createMusic({ player, sounds: SOUNDS, cues: CUES });

    // A challenge stage ending rolls the next stage on in the same step.
    music.handle([
      event('stage-started', { stage: 4 }),
      event('challenge-ended', { perfect: true }),
    ]);

    expect(player.started).toEqual(['perfect']);
  });

  it('tells a game’s first stage from every other by the cue’s fields', () => {
    const player = recordingPlayer();
    const music = createMusic({ player, sounds: SOUNDS, cues: CUES });

    music.handle([event('stage-started', { stage: 1 })]);
    music.handle([event('stage-started', { stage: 2 })]);

    expect(player.started).toEqual(['opening', 'stage']);
  });

  it('cuts the jingle still playing when the next one starts', () => {
    const player = recordingPlayer();
    const music = createMusic({ player, sounds: SOUNDS, cues: CUES });

    music.handle([event('stage-started', { stage: 2 })]);
    music.handle([{ type: 'player-captured' }]);

    expect(player.stopped).toEqual(['stage']);
    expect(player.started).toEqual(['stage', 'lost']);
  });

  it('leaves the current jingle alone on a step no cue answers', () => {
    const player = recordingPlayer();
    const music = createMusic({ player, sounds: SOUNDS, cues: CUES });

    music.handle([{ type: 'player-captured' }]);
    music.handle([]);
    music.handle([{ type: 'shot-fired' }, { type: 'target-destroyed' }]);

    expect(player.stopped).toEqual([]);
  });

  it('stops on request, and stopping twice or with nothing playing is harmless', () => {
    const player = recordingPlayer();
    const music = createMusic({ player, sounds: SOUNDS, cues: CUES });

    music.stop();
    music.handle([{ type: 'player-captured' }]);
    music.stop();
    music.stop();

    expect(player.stopped).toEqual(['lost']);
  });

  it('stays quiet for a cue naming a sound nobody defined', () => {
    const player = recordingPlayer();
    const music = createMusic({
      player,
      sounds: SOUNDS,
      cues: [cue({ event: 'stage-started', sound: 'nowhere' })],
    });

    music.handle([{ type: 'stage-started' }]);

    expect(player.started).toEqual([]);
    expect(unresolvedCues([cue({ event: 'x', sound: 'nowhere' })], SOUNDS)).toEqual(['nowhere']);
  });

  it('reports a player that throws instead of letting it reach the loop', () => {
    const errors: unknown[] = [];
    const music = createMusic({
      player: {
        start() {
          throw new Error('no audio here');
        },
      },
      sounds: SOUNDS,
      cues: CUES,
      onError: (error) => errors.push(error),
    });

    expect(() => {
      music.handle([{ type: 'player-captured' }]);
    }).not.toThrow();
    expect(errors).toHaveLength(1);
  });

  it('carries on through a synth that is locked or muted, which starts nothing', () => {
    const music = createMusic({ player: { start: () => undefined }, sounds: SOUNDS, cues: CUES });

    expect(() => {
      music.handle([{ type: 'player-captured' }]);
      music.stop();
    }).not.toThrow();
  });

  it('only reads the events it is handed', () => {
    const music = createMusic({ player: recordingPlayer(), sounds: SOUNDS, cues: CUES });
    const events = Object.freeze([
      Object.freeze(event('challenge-ended', { perfect: false })),
      Object.freeze(event('stage-started', { stage: 1 })),
    ]);

    expect(() => {
      music.handle(events);
    }).not.toThrow();
    expect(music.cueFor(events)?.sound).toBe('results');
  });
});
