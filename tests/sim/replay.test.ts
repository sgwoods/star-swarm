import { describe, expect, it } from 'vitest';

import {
  type Action,
  constantInput,
  frameOf,
  type InputFrame,
  type InputSource,
  isDown,
} from '../../src/engine/input.js';
import { createLoop, STEP_MS } from '../../src/engine/loop.js';
import { createRng, type Rng } from '../../src/engine/rng.js';
import {
  assertReplayCompatible,
  createReplaySource,
  parseReplay,
  recordInput,
  type Replay,
  replayFrames,
  REPLAY_VERSION,
  serializeReplay,
} from '../../src/engine/replay.js';

/**
 * Determinism proof (docs/DESIGN.md pillar 4, section 11).
 *
 * `src/sim/` arrives in Milestone 1, so this file carries its own toy model: a
 * ship that moves, a two-shot cap, and a score that consumes seeded random
 * draws. It is deliberately tiny, but it has the two properties that matter —
 * it is driven only by (seed, input frames), and its state is a value that can
 * be compared exactly. That is enough to prove the engine round-trip: record a
 * run, replay the log against the same seed, land in the same place.
 *
 * Note what is absent: no DOM, no canvas, no audio, no wall clock. This test
 * runs on the Node project, so it would fail to even import a sim that reached
 * for any of them.
 */

interface ToyState {
  step: number;
  x: number;
  shotsInFlight: number;
  shotsFired: number;
  score: number;
}

const START_X = 112;
const PLAYER_SPEED = 2;
const SHOT_CAP = 2;
const SHOT_LIFETIME = 15;
const PLAYFIELD_WIDTH = 224;

function newToyState(): ToyState {
  return { step: 0, x: START_X, shotsInFlight: 0, shotsFired: 0, score: 0 };
}

/** One simulation step. Pure apart from the RNG it is handed. */
function stepToy(state: ToyState, frame: InputFrame, rng: Rng): void {
  if (isDown(frame, 'left')) state.x -= PLAYER_SPEED;
  if (isDown(frame, 'right')) state.x += PLAYER_SPEED;
  state.x = Math.max(8, Math.min(PLAYFIELD_WIDTH - 8, state.x));

  if (isDown(frame, 'fire') && state.shotsInFlight < SHOT_CAP) {
    state.shotsInFlight += 1;
    state.shotsFired += 1;
    // A seeded draw, so the RNG stream is part of what a replay must reproduce.
    state.score += rng.int(50, 161);
  }

  if (state.step % SHOT_LIFETIME === 0 && state.shotsInFlight > 0) {
    state.shotsInFlight -= 1;
  }

  state.step += 1;
}

/** A single comparable value for the whole simulation state. */
function fingerprint(state: ToyState): string {
  return JSON.stringify(state);
}

/** Run the toy sim through the real fixed-step loop for `steps` steps. */
function runToy(
  seed: number | string,
  input: InputSource,
  steps: number,
): { state: ToyState; trace: string[] } {
  const rng = createRng(seed);
  const state = newToyState();
  const trace: string[] = [];

  const loop = createLoop({
    update: () => {
      stepToy(state, input.sample(), rng);
      trace.push(fingerprint(state));
    },
    render: () => {},
    requestFrame: () => 0,
    cancelFrame: () => {},
  });

  for (let i = 0; i < steps; i += 1) loop.advance(STEP_MS);
  return { state, trace };
}

/**
 * A scripted "player": seeded so the input itself is reproducible, but varied
 * enough that the log is a real run-length-encoded sequence rather than one
 * constant frame.
 */
function scriptedPlayer(seed: string, holdSteps = 7): InputSource {
  const rng = createRng(seed);
  const choices: Action[][] = [
    ['left'],
    ['right'],
    ['fire'],
    ['left', 'fire'],
    ['right', 'fire'],
    [],
    ['start'],
  ];
  let frame: InputFrame = 0;
  let held = 0;
  return {
    sample(): InputFrame {
      if (held === 0) {
        frame = frameOf(...rng.pick(choices));
        held = rng.int(1, holdSteps + 1);
      }
      held -= 1;
      return frame;
    },
  };
}

const STEPS = 600; // ten seconds at 60 Hz

describe('record and replay', () => {
  it('reproduces the same final state from the same seed and log', () => {
    const seed = 'replay-round-trip';
    const recorder = recordInput(scriptedPlayer('player-a'), seed);
    const live = runToy(seed, recorder.source, STEPS);
    const replay = recorder.finish(fingerprint(live.state));

    const replayed = runToy(seed, createReplaySource(replay), STEPS);

    expect(fingerprint(replayed.state)).toBe(replay.finalState);
    expect(fingerprint(replayed.state)).toBe(fingerprint(live.state));
  });

  it('reproduces every intermediate state, not just the last one', () => {
    const seed = 42;
    const recorder = recordInput(scriptedPlayer('player-b'), seed);
    const live = runToy(seed, recorder.source, STEPS);
    const replay = recorder.finish();

    const replayed = runToy(seed, createReplaySource(replay), STEPS);
    expect(replayed.trace).toEqual(live.trace);
  });

  it('records exactly one frame per simulation step', () => {
    const recorder = recordInput(scriptedPlayer('player-c'), 'count');
    runToy('count', recorder.source, STEPS);
    const replay = recorder.finish();
    expect(replay.steps).toBe(STEPS);
    expect(replayFrames(replay)).toHaveLength(STEPS);
  });

  it('records the frames the simulation actually saw', () => {
    const seen: InputFrame[] = [];
    const recorder = recordInput(scriptedPlayer('player-d'), 'frames');
    const spy: InputSource = {
      sample: () => {
        const frame = recorder.source.sample();
        seen.push(frame);
        return frame;
      },
    };
    runToy('frames', spy, 120);
    expect(replayFrames(recorder.finish())).toEqual(seen);
  });

  it('run-length encodes, so a held direction is one run and not sixty', () => {
    const recorder = recordInput(constantInput(frameOf('right')), 'held');
    runToy('held', recorder.source, 300);
    const replay = recorder.finish();
    expect(replay.runs).toEqual([[frameOf('right'), 300]]);
  });

  it('survives a serialise/parse round trip', () => {
    const seed = 'serialised';
    const recorder = recordInput(scriptedPlayer('player-e'), seed);
    const live = runToy(seed, recorder.source, STEPS);
    const replay = recorder.finish(fingerprint(live.state));

    const restored = parseReplay(serializeReplay(replay));
    const replayed = runToy(restored.seed, createReplaySource(restored), STEPS);

    expect(fingerprint(replayed.state)).toBe(restored.finalState);
  });
});

describe('the seed is load-bearing', () => {
  it('lands somewhere else when only the seed changes', () => {
    const recorder = recordInput(scriptedPlayer('player-f'), 'seed-one');
    const live = runToy('seed-one', recorder.source, STEPS);
    const replay = recorder.finish();

    const sameSeed = runToy('seed-one', createReplaySource(replay), STEPS);
    const otherSeed = runToy('seed-two', createReplaySource(replay), STEPS);

    expect(fingerprint(sameSeed.state)).toBe(fingerprint(live.state));
    expect(fingerprint(otherSeed.state)).not.toBe(fingerprint(live.state));
    // The seed must change the score, not where the ship ended up.
    expect(otherSeed.state.x).toBe(live.state.x);
    expect(otherSeed.state.shotsFired).toBe(live.state.shotsFired);
    expect(otherSeed.state.score).not.toBe(live.state.score);
  });

  it('lands somewhere else when only the input changes', () => {
    const seed = 'same-seed';
    const a = recordInput(scriptedPlayer('player-g'), seed);
    runToy(seed, a.source, STEPS);
    const b = recordInput(scriptedPlayer('player-h'), seed);
    runToy(seed, b.source, STEPS);

    const left = runToy(seed, createReplaySource(a.finish()), STEPS);
    const right = runToy(seed, createReplaySource(b.finish()), STEPS);
    expect(fingerprint(left.state)).not.toBe(fingerprint(right.state));
  });
});

describe('replay source behaviour', () => {
  it('tracks progress and reports when it is spent', () => {
    const recorder = recordInput(constantInput(frameOf('fire')), 'progress');
    runToy('progress', recorder.source, 10);
    const source = createReplaySource(recorder.finish());

    expect(source.step).toBe(0);
    expect(source.done).toBe(false);
    for (let i = 0; i < 10; i += 1) source.sample();
    expect(source.step).toBe(10);
    expect(source.done).toBe(true);
  });

  it('hands out empty frames past the end by default', () => {
    const recorder = recordInput(constantInput(frameOf('fire')), 'overrun');
    runToy('overrun', recorder.source, 5);
    const source = createReplaySource(recorder.finish());
    for (let i = 0; i < 5; i += 1) source.sample();
    expect(source.sample()).toBe(0);
  });

  it('can be made to throw past the end, for tests that expect full coverage', () => {
    const recorder = recordInput(constantInput(frameOf('fire')), 'strict');
    runToy('strict', recorder.source, 5);
    const source = createReplaySource(recorder.finish(), { onOverrun: 'throw' });
    for (let i = 0; i < 5; i += 1) source.sample();
    expect(() => source.sample()).toThrow(RangeError);
  });

  it('rewinds to the start', () => {
    const recorder = recordInput(scriptedPlayer('player-i'), 'rewind');
    runToy('rewind', recorder.source, 60);
    const replay = recorder.finish();
    const source = createReplaySource(replay);

    const first = Array.from({ length: 60 }, () => source.sample());
    source.reset();
    const second = Array.from({ length: 60 }, () => source.sample());
    expect(second).toEqual(first);
  });
});

describe('replay compatibility', () => {
  const base: Replay = {
    version: REPLAY_VERSION,
    seed: 'compat',
    stepHz: 60,
    steps: 3,
    runs: [[frameOf('left'), 3]],
  };

  it('accepts a well-formed replay', () => {
    expect(() => assertReplayCompatible(base)).not.toThrow();
  });

  it('rejects a replay from a future format version', () => {
    expect(() => assertReplayCompatible({ ...base, version: REPLAY_VERSION + 1 })).toThrow(
      /version/,
    );
  });

  it('rejects a replay recorded at a different step rate', () => {
    expect(() => assertReplayCompatible({ ...base, stepHz: 50 })).toThrow(/Hz/);
  });

  it('rejects a replay whose runs do not add up', () => {
    expect(() => assertReplayCompatible({ ...base, steps: 99 })).toThrow(/corrupt/);
  });
});
