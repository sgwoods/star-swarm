import { describe, expect, it } from 'vitest';

import { pathSchema, type MovementPath } from '../../src/content/schema.js';
import { createLoop, STEP_MS } from '../../src/engine/loop.js';
import type { PathEnvironment } from '../../src/sim/paths.js';
import { compilePath, pathEventsBetween, samplePath } from '../../src/sim/paths.js';

/**
 * Paths inside the fixed-step loop (docs/DESIGN.md pillar 4).
 *
 * `tests/unit/paths.test.ts` proves the interpreter is a pure function of the
 * frame number. This file proves the property that actually matters at runtime:
 * a flyer driven by the real `createLoop`, fed ragged wall-clock deltas the way
 * a browser does, visits exactly the same positions as one evaluated straight
 * off the step index — no accumulation, no drift, no dependence on how the host
 * happened to schedule its frames.
 */

const PATH: MovementPath = pathSchema.parse({
  id: 'determinism-probe',
  mirror: true,
  start: [-16, 208],
  segments: [
    { type: 'bezier', to: [128, 128], c1: [32, 232], c2: [88, 160], speed: 1.7 },
    { type: 'arc', radius: 20, degrees: 135, dir: 'cw' },
    { type: 'loop', radius: 18, turns: 1, dir: 'ccw' },
    { type: 'sine', amplitude: 10, wavelength: 42, duration: 45 },
    { type: 'lissajous', ax: 16, ay: 8, fx: 2, fy: 1, duration: 60, phase: 30 },
    { type: 'fire', count: 2 },
    { type: 'aimAtPlayer', speed: 2.2, duration: 36 },
    { type: 'trigger', ability: 'splitOnHit' },
    { type: 'exitBottom' },
  ],
});

const ENV: PathEnvironment = { player: [112, 264], slot: [96, 72] };

/** Fly the path by draining a loop with the given wall-clock deltas. */
function flyWithDeltas(deltas: readonly number[], mirror: boolean): number[][] {
  const compiled = compilePath(PATH, { ...ENV, mirror });
  const visited: number[][] = [];
  const loop = createLoop({
    update(step) {
      const sample = samplePath(compiled, step);
      visited.push([sample.x, sample.y, sample.heading, sample.speed]);
    },
    render() {
      /* the sim never depends on rendering; nothing to do here */
    },
    // The loop is being driven by `advance`, so it never asks for a frame.
    requestFrame: () => 0,
    cancelFrame: () => undefined,
  });
  for (const delta of deltas) loop.advance(delta);
  return visited;
}

/** One step per frame, exactly. */
const STEADY = Array.from({ length: 400 }, () => STEP_MS);

/**
 * The same total time in uneven lumps: a frame that arrives early, one that
 * arrives late, and a stall that hands the loop several steps at once. A
 * position that depended on the pacing would come apart here.
 */
const RAGGED_PACING = [0.4, 1.6, 2.7, 1.3];
const RAGGED = Array.from(
  { length: 400 },
  (_, index) => STEP_MS * (RAGGED_PACING[index % RAGGED_PACING.length] ?? 1),
);

describe('paths under the fixed-step loop', () => {
  it('visits the same positions however the host paces its frames', () => {
    const steady = flyWithDeltas(STEADY, false);
    const ragged = flyWithDeltas(RAGGED, false);
    const shared = Math.min(steady.length, ragged.length);
    expect(shared).toBeGreaterThan(200);
    for (let step = 0; step < shared; step += 1) {
      expect(ragged[step]).toEqual(steady[step]);
    }
  });

  it('gives bit-identical results on a second run', () => {
    expect(flyWithDeltas(STEADY, false)).toEqual(flyWithDeltas(STEADY, false));
    expect(flyWithDeltas(STEADY, true)).toEqual(flyWithDeltas(STEADY, true));
  });

  it('reaches the end of the path and stops moving', () => {
    const compiled = compilePath(PATH, ENV);
    const flown = flyWithDeltas(STEADY, false);
    const last = flown[flown.length - 1];
    expect(compiled.totalFrames).toBeLessThan(STEADY.length);
    expect(last?.[0]).toBeCloseTo(compiled.end.x, 9);
    expect(last?.[1]).toBeCloseTo(compiled.end.y, 9);
  });

  it('drains fire and trigger events once each, in step order', () => {
    const compiled = compilePath(PATH, ENV);
    const drained: string[] = [];
    const loop = createLoop({
      update(step) {
        for (const event of pathEventsBetween(compiled, step - 1, step)) {
          drained.push(`${event.kind}@${String(step)}`);
        }
      },
      render: () => undefined,
      requestFrame: () => 0,
      cancelFrame: () => undefined,
    });
    for (const delta of RAGGED) loop.advance(delta);
    expect(drained).toHaveLength(2);
    expect(drained[0]).toMatch(/^fire@/);
    expect(drained[1]).toMatch(/^trigger@/);
  });

  it('holds the mirrored flight exactly opposite the authored one', () => {
    const plain = flyWithDeltas(STEADY, false);
    const mirrored = flyWithDeltas(STEADY, true);
    expect(mirrored).toHaveLength(plain.length);
    for (let step = 0; step < plain.length; step += 1) {
      const a = plain[step];
      const b = mirrored[step];
      if (a === undefined || b === undefined) throw new Error('length mismatch');
      // 224 is the playfield width; the reflection is exact, not approximate.
      expect(b[0]).toBe(224 - (a[0] ?? 0));
      expect(b[1]).toBe(a[1]);
    }
  });
});
