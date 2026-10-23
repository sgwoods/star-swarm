import { describe, expect, it } from 'vitest';

import { frameOf, type InputFrame } from '../../src/engine/input.js';
import { createReplaySource, replayFrames } from '../../src/engine/replay.js';
import type { SimEvent } from '../../src/sim/events.js';
import { createWorld, fingerprintWorld, stepWorld, type World } from '../../src/sim/world.js';
import {
  createRecording,
  RECORD_SEED_ROOT,
  type RunPlayer,
  runSeed,
} from '../../src/ui/lab/recording.js';
import { classicRules, classicStages } from '../helpers/rules.js';

/**
 * The record page's decisions (`src/ui/lab/recording.ts`), driven against a real
 * Classic world: when a run starts, what a hold does, when a run ends, and — the
 * property everything else serves — that the log is exactly the frames the world
 * was given, so it plays back to the state it was sealed with.
 *
 * Node environment, no DOM: the page is a keyboard and a canvas around this.
 */

const rules = classicRules();
const stages = classicStages();

const START = frameOf('start');
const PAUSE = frameOf('pause');
const EXIT = frameOf('exit');
const FIRE = frameOf('fire');
const LEFT_FIRE = frameOf('left', 'fire');
const RIGHT_FIRE = frameOf('right', 'fire');

interface Played extends RunPlayer {
  readonly world: World;
  /** Every frame the world was stepped on, in order. */
  readonly seen: InputFrame[];
}

/** A run's world exactly as the page builds one, minus the drawing. */
function playerFor(seed: string, stage?: number): Played {
  const world = createWorld({ seed, rules, stages, ...(stage !== undefined && { stage }) });
  const seen: InputFrame[] = [];
  return {
    world,
    seen,
    opening: [...world.events],
    step(frame) {
      seen.push(frame);
      return stepWorld(world, frame);
    },
    fingerprint: () => fingerprintWorld(world),
  };
}

/** A recording whose runs are kept, so a test can look at the worlds it drove. */
function recordingOf(stage?: number) {
  const runs: Played[] = [];
  const recording = createRecording({
    ...(stage !== undefined && { stage }),
    begin(seed) {
      const played = playerFor(seed, stage);
      runs.push(played);
      return played;
    },
  });
  const feed = (...frames: InputFrame[]) => frames.map((frame) => recording.step(frame));
  return { recording, runs, feed };
}

/** `count` copies of `frame`. */
function hold(frame: InputFrame, count: number): InputFrame[] {
  return Array.from({ length: count }, () => frame);
}

describe('starting a run', () => {
  it('steps nothing until start is pressed, and never gives the world that frame', () => {
    const { recording, runs, feed } = recordingOf();
    feed(FIRE, LEFT_FIRE, 0);
    expect(recording.state).toBe('ready');
    expect(runs).toHaveLength(0);

    const [started] = feed(START);
    expect(started?.state).toBe('playing');
    const run = runs[0];
    if (run === undefined) throw new Error('no run began');
    // The start frame starts the run; the world is first stepped on the next.
    expect(run.world.step).toBe(0);
    expect(started?.events.map((event) => event.type)).toEqual(['stage-started', 'player-ready']);

    feed(RIGHT_FIRE, FIRE, 0);
    expect(run.seen).toEqual([RIGHT_FIRE, FIRE, 0]);
    expect(recording.steps).toBe(3);
  });

  it('seeds each run from the session root and its index, as the game seeds a game', () => {
    const { recording, feed } = recordingOf();
    feed(START);
    expect(recording.seed).toBe(`${RECORD_SEED_ROOT}:game-1`);
    expect(runSeed('star-swarm-m2', 4)).toBe('star-swarm-m2:game-4');
    feed(0, EXIT, 0, START);
    expect(recording.game).toBe(2);
    expect(recording.seed).toBe('record:game-2');
  });
});

describe('holding a run', () => {
  it('records the frame that held it and nothing until the press that lets go', () => {
    const { recording, runs, feed } = recordingOf();
    feed(START, 0, FIRE);
    const [held] = feed(PAUSE | FIRE);
    expect(held?.state).toBe('paused');
    // Held: the keyboard goes on being read, and the world goes on not hearing it.
    feed(LEFT_FIRE, 0, FIRE, ...hold(RIGHT_FIRE, 40), 0);
    expect(recording.state).toBe('paused');
    const [resumed] = feed(PAUSE);
    expect(resumed?.state).toBe('playing');
    feed(0, LEFT_FIRE);

    const run = runs[0];
    expect(run?.seen).toEqual([0, FIRE, PAUSE | FIRE, 0, LEFT_FIRE]);
    expect(run?.world.step).toBe(5);
  });
});

describe('ending a run', () => {
  it('steps the frame that carries exit, then seals', () => {
    const { recording, runs, feed } = recordingOf();
    feed(START, FIRE, FIRE);
    const [ended] = feed(EXIT | FIRE);
    expect(ended?.state).toBe('ended');
    expect(runs[0]?.seen).toEqual([FIRE, FIRE, EXIT | FIRE]);
    expect(ended?.ended?.replay.steps).toBe(3);
    expect(ended?.ended?.replay.finalState).toBe(fingerprintWorld(runs[0]?.world as World));
    // Ended is ended: nothing more reaches that world.
    feed(...hold(FIRE, 10));
    expect(runs[0]?.world.step).toBe(3);
    expect(recording.last).toBe(ended?.ended);
  });

  it('ends from a hold without another step', () => {
    const { runs, feed } = recordingOf();
    feed(START, FIRE, PAUSE, 0);
    const [ended] = feed(EXIT);
    expect(ended?.ended?.replay.steps).toBe(2);
    expect(runs[0]?.seen).toEqual([FIRE, PAUSE]);
  });

  it("ends on the step the world's game over is raised", () => {
    let steps = 0;
    const gameOver: SimEvent = { type: 'game-over', score: 0 };
    const recording = createRecording({
      begin: () => ({
        opening: [],
        step: () => {
          steps += 1;
          return steps === 5 ? [gameOver] : [];
        },
        fingerprint: () => `step ${String(steps)}`,
      }),
    });
    recording.step(START);
    const results = hold(FIRE, 8).map((frame) => recording.step(frame));
    expect(results.findIndex((result) => result.ended !== undefined)).toBe(4);
    expect(steps).toBe(5);
    expect(recording.last?.replay).toMatchObject({ steps: 5, finalState: 'step 5' });
  });

  it('carries the starting stage, the one thing the log itself does not say', () => {
    const { feed } = recordingOf(3);
    const [, , ended] = feed(START, FIRE, EXIT);
    expect(ended?.ended?.stage).toBe(3);
    const { feed: fromFirst } = recordingOf();
    expect(fromFirst(START, EXIT)[1]?.ended).not.toHaveProperty('stage');
  });
});

describe('the sealed log', () => {
  /** Something like a person: sweeps of uneven length, fire mostly held, two holds. */
  const played: InputFrame[] = [
    START,
    ...hold(0, 30),
    ...hold(RIGHT_FIRE, 70),
    ...hold(FIRE, 12),
    ...hold(LEFT_FIRE, 160),
    PAUSE | LEFT_FIRE,
    ...hold(0, 50),
    PAUSE,
    ...hold(RIGHT_FIRE, 45),
    ...hold(0, 8),
    ...hold(LEFT_FIRE, 90),
    PAUSE,
    0,
    PAUSE,
    ...hold(RIGHT_FIRE, 200),
    EXIT,
  ];

  it('is the frames the world was given, and nothing else', () => {
    const { recording, runs, feed } = recordingOf();
    feed(...played);
    const replay = recording.last?.replay;
    if (replay === undefined) throw new Error('the run did not end');
    expect(replayFrames(replay)).toEqual(runs[0]?.seen);
    // Fewer than the keyboard produced: the start frame and both holds are not in it.
    expect(replay.steps).toBeLessThan(played.length - 50);
  });

  it('plays back in a fresh world to the state it was sealed with', () => {
    const { recording, feed } = recordingOf(2);
    feed(...played);
    const last = recording.last;
    if (last === undefined) throw new Error('the run did not end');
    const { replay } = last;

    const world = createWorld({ seed: replay.seed, rules, stages, stage: 2 });
    const input = createReplaySource(replay, { onOverrun: 'throw' });
    for (let step = 0; step < replay.steps; step += 1) stepWorld(world, input.sample());
    expect(fingerprintWorld(world)).toBe(replay.finalState);
  });
});
