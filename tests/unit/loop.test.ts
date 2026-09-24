import { describe, expect, it } from 'vitest';

import { createLoop, MAX_STEPS_PER_FRAME, STEP_HZ, STEP_MS } from '../../src/engine/loop.js';

/** A loop wired to manual frame delivery, with the calls it made recorded. */
function harness(options: { stepHz?: number; maxStepsPerFrame?: number } = {}) {
  const updates: number[] = [];
  const alphas: number[] = [];
  const loop = createLoop({
    update: (step) => updates.push(step),
    render: (alpha) => alphas.push(alpha),
    requestFrame: () => 0,
    cancelFrame: () => {},
    ...options,
  });
  return { loop, updates, alphas };
}

describe('step rate', () => {
  it('runs at 60 Hz', () => {
    expect(STEP_HZ).toBe(60);
    expect(STEP_MS).toBeCloseTo(16.6667, 4);
  });

  it('exposes the derived step length instead of making callers recompute it', () => {
    expect(harness().loop.stepMs).toBe(STEP_MS);
    expect(harness({ stepHz: 50 }).loop.stepMs).toBe(20);
  });
});

describe('fixed-step advance', () => {
  it('takes exactly one step per step-worth of time', () => {
    const { loop, updates } = harness();
    expect(loop.advance(STEP_MS)).toBe(1);
    expect(updates).toEqual([0]);
  });

  it('takes no step when less than a step has elapsed, but still renders', () => {
    const { loop, updates, alphas } = harness();
    expect(loop.advance(STEP_MS / 2)).toBe(0);
    expect(updates).toEqual([]);
    expect(alphas).toHaveLength(1);
    expect(alphas[0]).toBeCloseTo(0.5, 6);
  });

  it('carries the remainder across frames instead of dropping it', () => {
    const { loop, updates } = harness();
    // Two three-quarter frames make one and a half steps: one step, half left.
    loop.advance(STEP_MS * 0.75);
    loop.advance(STEP_MS * 0.75);
    expect(updates).toEqual([0]);
    loop.advance(STEP_MS * 0.75);
    expect(updates).toEqual([0, 1]);
  });

  it('drains a backlog in whole steps', () => {
    const { loop, updates } = harness();
    expect(loop.advance(STEP_MS * 3)).toBe(3);
    expect(updates).toEqual([0, 1, 2]);
  });

  it('takes exactly N steps for N steps of elapsed time', () => {
    // 1/60 s is not representable in binary floating point, so naive repeated
    // subtraction of 16.666… loses a step here. Losing one step per burst is
    // enough to desync a run from its replay.
    for (const n of [1, 2, 3, 6, 10, 30, 60]) {
      const { loop, updates } = harness({ maxStepsPerFrame: n });
      expect(loop.advance(STEP_MS * n)).toBe(n);
      expect(updates).toHaveLength(n);
    }
  });

  it('does not drift over a long run delivered one step at a time', () => {
    const { loop } = harness();
    for (let i = 0; i < 3600; i += 1) loop.advance(STEP_MS);
    // A minute of play: exactly 3,600 steps, not 3,599 or 3,601.
    expect(loop.step).toBe(3600);
  });

  it('renders exactly once per advance regardless of how many steps ran', () => {
    const { loop, alphas } = harness();
    loop.advance(STEP_MS * 3);
    loop.advance(STEP_MS / 4);
    expect(alphas).toHaveLength(2);
  });

  it('numbers steps monotonically and exposes the count', () => {
    const { loop } = harness();
    loop.advance(STEP_MS * 2);
    loop.advance(STEP_MS);
    expect(loop.step).toBe(3);
  });
});

describe('determinism under variable frame times', () => {
  it('produces the same step count for the same total time, however it is sliced', () => {
    const steady = harness();
    for (let i = 0; i < 60; i += 1) steady.loop.advance(STEP_MS);

    const jittery = harness();
    // 60 steps' worth of time delivered in uneven chunks that never exceed the
    // per-frame cap, so nothing is dropped.
    const chunks = [1.4, 0.3, 0.9, 2.1, 0.7, 1.6];
    let delivered = 0;
    let i = 0;
    while (delivered < 60) {
      const chunk = Math.min(chunks[i % chunks.length] as number, 60 - delivered);
      jittery.loop.advance(STEP_MS * chunk);
      delivered += chunk;
      i += 1;
    }

    expect(jittery.updates).toEqual(steady.updates);
  });
});

describe('stall protection', () => {
  it('caps steps per frame', () => {
    const { loop } = harness();
    expect(loop.advance(STEP_MS * 100)).toBe(MAX_STEPS_PER_FRAME);
  });

  it('drops the backlog rather than inheriting a growing debt', () => {
    const { loop, updates } = harness({ maxStepsPerFrame: 2 });
    loop.advance(STEP_MS * 10);
    expect(updates).toEqual([0, 1]);
    // The 8 dropped steps must not reappear on the next ordinary frame.
    loop.advance(STEP_MS);
    expect(updates).toEqual([0, 1, 2]);
  });
});

describe('degenerate deltas', () => {
  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('ignores a delta of %p', (delta) => {
    const { loop, updates, alphas } = harness();
    expect(loop.advance(delta)).toBe(0);
    expect(updates).toEqual([]);
    expect(alphas).toHaveLength(1);
  });

  it('rejects an impossible configuration', () => {
    expect(() => harness({ stepHz: 0 })).toThrow(RangeError);
    expect(() => harness({ stepHz: Number.NaN })).toThrow(RangeError);
    expect(() => harness({ maxStepsPerFrame: 0 })).toThrow(RangeError);
  });
});

describe('start and stop', () => {
  it('drives itself from the injected scheduler and stops cleanly', () => {
    const pending: ((now: number) => void)[] = [];
    const cancelled: number[] = [];
    const updates: number[] = [];

    const loop = createLoop({
      update: (step) => updates.push(step),
      render: () => {},
      requestFrame: (cb) => {
        pending.push(cb);
        return pending.length;
      },
      cancelFrame: (handle) => cancelled.push(handle),
    });

    loop.start();
    expect(loop.running).toBe(true);

    // First frame has no previous timestamp, so it is treated as one step.
    let now = 1000;
    for (let i = 0; i < 4; i += 1) {
      const next = pending.shift();
      expect(next).toBeTypeOf('function');
      next?.(now);
      now += STEP_MS;
    }
    expect(updates).toEqual([0, 1, 2, 3]);

    loop.stop();
    expect(loop.running).toBe(false);
    expect(cancelled).toHaveLength(1);

    // A frame already in flight must not sneak a step in after stop().
    pending.shift()?.(now);
    expect(updates).toEqual([0, 1, 2, 3]);
  });

  it('is idempotent', () => {
    const loop = createLoop({
      update: () => {},
      render: () => {},
      requestFrame: () => 1,
      cancelFrame: () => {},
    });
    loop.start();
    loop.start();
    loop.stop();
    loop.stop();
    expect(loop.running).toBe(false);
  });
});
