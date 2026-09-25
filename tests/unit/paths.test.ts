import { describe, expect, it } from 'vitest';

import { pathSchema, type MovementPath } from '../../src/content/schema.js';
import type { PathEnvironment, Vec2 } from '../../src/sim/paths.js';
import {
  compilePath,
  DEFAULT_PLAYFIELD,
  headingToVector,
  mirrorHeading,
  normaliseHeading,
  OFF_SCREEN_MARGIN,
  PathCompileError,
  pathBounds,
  pathEventsBetween,
  samplePath,
  tryCompilePath,
  vectorToHeading,
} from '../../src/sim/paths.js';

/**
 * Paths go in through the real schema rather than as hand-built objects, so the
 * defaults the interpreter relies on (`mirror`, a `fire` segment's `count`) are
 * the ones a pack would actually get.
 */
function makePath(doc: Record<string, unknown>): MovementPath {
  return pathSchema.parse({ id: 'probe', ...doc });
}

/** Every whole frame of a path, as `[x, y, heading]` triples. */
type Triple = [number, number, number];

function sampleEveryFrame(path: MovementPath, env: PathEnvironment = {}): Triple[] {
  const compiled = compilePath(path, env);
  const out: Triple[] = [];
  for (let frame = 0; frame <= Math.ceil(compiled.totalFrames); frame += 1) {
    const sample = samplePath(compiled, frame);
    out.push([sample.x, sample.y, sample.heading]);
  }
  return out;
}

/** Stands in for a frame that does not exist, so a length mismatch fails loudly. */
const NO_SAMPLE: Triple = [Number.NaN, Number.NaN, Number.NaN];

describe('angles', () => {
  it('uses 0 for down and runs clockwise, as schema.ts states', () => {
    const cases: [number, [number, number]][] = [
      [0, [0, 1]],
      [90, [-1, 0]],
      [180, [0, -1]],
      [270, [1, 0]],
    ];
    for (const [heading, [dx, dy]] of cases) {
      const [x, y] = headingToVector(heading);
      expect(x).toBeCloseTo(dx, 12);
      expect(y).toBeCloseTo(dy, 12);
      expect(vectorToHeading(dx, dy)).toBeCloseTo(heading, 10);
    }
  });

  it('normalises into [0, 360), including negative zero', () => {
    expect(normaliseHeading(-90)).toBe(270);
    expect(normaliseHeading(450)).toBe(90);
    expect(Object.is(normaliseHeading(-0), 0)).toBe(true);
    expect(Object.is(mirrorHeading(0), 0)).toBe(true);
  });
});

describe('line', () => {
  const path = makePath({
    start: [10, 10],
    segments: [{ type: 'line', to: [10, 40], speed: 2 }],
  });

  it('takes distance / speed frames and interpolates along the way', () => {
    const compiled = compilePath(path);
    expect(compiled.totalFrames).toBe(15);
    expect(samplePath(compiled, 0)).toMatchObject({ x: 10, y: 10, heading: 0 });
    expect(samplePath(compiled, 7.5)).toMatchObject({ x: 10, y: 25 });
    expect(samplePath(compiled, 15)).toMatchObject({ x: 10, y: 40, done: true });
  });

  it('faces the way it is going', () => {
    const right = compilePath(
      makePath({ start: [0, 0], segments: [{ type: 'line', to: [30, 0], speed: 3 }] }),
    );
    expect(samplePath(right, 5).heading).toBeCloseTo(270, 10);
  });

  it('inherits the speed the previous segment left behind', () => {
    const compiled = compilePath(
      makePath({
        start: [0, 0],
        segments: [
          { type: 'line', to: [0, 20], speed: 4 },
          { type: 'line', to: [0, 60] },
        ],
      }),
    );
    expect(compiled.totalFrames).toBe(15);
  });

  it('holds the final pose past the end', () => {
    const compiled = compilePath(path);
    expect(samplePath(compiled, 1e6)).toMatchObject({ x: 10, y: 40, done: true });
  });
});

describe('bezier', () => {
  const path = makePath({
    start: [0, 0],
    segments: [{ type: 'bezier', to: [100, 0], c1: [0, 120], c2: [100, 120], speed: 2 }],
  });

  it('hits both endpoints exactly', () => {
    const compiled = compilePath(path);
    expect(samplePath(compiled, 0)).toMatchObject({ x: 0, y: 0 });
    const end = samplePath(compiled, compiled.totalFrames);
    expect(end.x).toBeCloseTo(100, 9);
    expect(end.y).toBeCloseTo(0, 9);
  });

  it('travels at a constant speed, not a constant parameter', () => {
    // The whole point of the arc-length table: `t` is not proportional to
    // distance, so driving the curve straight off `t` would visibly accelerate.
    const compiled = compilePath(path);
    const steps: number[] = [];
    for (let frame = 1; frame < Math.floor(compiled.totalFrames); frame += 1) {
      const a = samplePath(compiled, frame - 1);
      const b = samplePath(compiled, frame);
      steps.push(Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2));
    }
    for (const step of steps) expect(step).toBeCloseTo(2, 1);
  });
});

describe('arc and loop', () => {
  it('turns clockwise about a centre one radius to the turning side', () => {
    const compiled = compilePath(
      makePath({
        start: [100, 100],
        segments: [{ type: 'arc', radius: 10, degrees: 90, dir: 'cw', speed: 1 }],
      }),
    );
    // Facing down, a clockwise quarter-turn of radius 10 ends one radius left
    // and one radius further down, now facing left.
    expect(compiled.totalFrames).toBeCloseTo((10 * Math.PI) / 2, 9);
    const end = samplePath(compiled, compiled.totalFrames);
    expect(end.x).toBeCloseTo(90, 9);
    expect(end.y).toBeCloseTo(110, 9);
    expect(end.heading).toBeCloseTo(90, 9);
  });

  it('mirrors that in the other direction', () => {
    const compiled = compilePath(
      makePath({
        start: [100, 100],
        segments: [{ type: 'arc', radius: 10, degrees: 90, dir: 'ccw', speed: 1 }],
      }),
    );
    const end = samplePath(compiled, compiled.totalFrames);
    expect(end.x).toBeCloseTo(110, 9);
    expect(end.y).toBeCloseTo(110, 9);
    expect(end.heading).toBeCloseTo(270, 9);
  });

  it('stays exactly one radius from the centre throughout', () => {
    const compiled = compilePath(
      makePath({
        start: [100, 100],
        segments: [{ type: 'arc', radius: 24, degrees: 200, dir: 'cw', speed: 1.5 }],
      }),
    );
    for (let frame = 0; frame <= compiled.totalFrames; frame += 1) {
      const point = samplePath(compiled, frame);
      expect(Math.sqrt((point.x - 76) ** 2 + (point.y - 100) ** 2)).toBeCloseTo(24, 9);
    }
  });

  it('brings a whole loop back to where it started', () => {
    const compiled = compilePath(
      makePath({
        start: [60, 60],
        segments: [{ type: 'loop', radius: 12, turns: 1, dir: 'cw', speed: 2 }],
      }),
    );
    expect(compiled.totalFrames).toBeCloseTo((12 * 2 * Math.PI) / 2, 9);
    const end = samplePath(compiled, compiled.totalFrames);
    expect(end.x).toBeCloseTo(60, 9);
    expect(end.y).toBeCloseTo(60, 9);
    expect(end.heading).toBeCloseTo(0, 9);
  });
});

describe('lissajous', () => {
  it('oscillates about where the flyer already is', () => {
    const compiled = compilePath(
      makePath({
        start: [100, 100],
        segments: [{ type: 'lissajous', ax: 20, ay: 10, fx: 1, fy: 2, duration: 60 }],
      }),
    );
    expect(compiled.totalFrames).toBe(60);
    expect(samplePath(compiled, 0)).toMatchObject({ x: 100, y: 100 });
    const quarter = samplePath(compiled, 15);
    expect(quarter.x).toBeCloseTo(120, 9);
    expect(quarter.y).toBeCloseTo(100, 9);
  });

  it('does not teleport when a phase offset is given', () => {
    // Without anchoring, a phase of 90° would start the figure 20px away from
    // the flyer and jump it there on the first frame.
    const compiled = compilePath(
      makePath({
        start: [100, 100],
        segments: [{ type: 'lissajous', ax: 20, ay: 10, fx: 1, fy: 2, duration: 60, phase: 90 }],
      }),
    );
    expect(samplePath(compiled, 0)).toMatchObject({ x: 100, y: 100 });
  });
});

describe('sine', () => {
  it('runs along the current heading with a transverse wave', () => {
    const compiled = compilePath(
      makePath({
        start: [100, 100],
        segments: [{ type: 'sine', amplitude: 8, wavelength: 40, duration: 60, speed: 1 }],
      }),
    );
    expect(compiled.totalFrames).toBe(60);
    expect(samplePath(compiled, 0)).toMatchObject({ x: 100, y: 100 });
    // Facing down, a quarter wavelength in: 10px travelled, full amplitude out.
    const crest = samplePath(compiled, 10);
    expect(crest.x).toBeCloseTo(92, 9);
    expect(crest.y).toBeCloseTo(110, 9);
    // Half a wavelength further on it is back on the axis, going the other way.
    const zero = samplePath(compiled, 20);
    expect(zero.x).toBeCloseTo(100, 9);
    expect(zero.y).toBeCloseTo(120, 9);
  });
});

describe('wait', () => {
  it('holds the pose for exactly the stated frames', () => {
    const compiled = compilePath(
      makePath({
        start: [10, 10],
        segments: [
          { type: 'line', to: [10, 30], speed: 1 },
          { type: 'wait', frames: 20 },
          { type: 'line', to: [30, 30], speed: 1 },
        ],
      }),
    );
    expect(compiled.totalFrames).toBe(60);
    expect(samplePath(compiled, 20)).toMatchObject({ x: 10, y: 30 });
    expect(samplePath(compiled, 39)).toMatchObject({ x: 10, y: 30 });
    expect(samplePath(compiled, 50).x).toBeCloseTo(20, 9);
  });
});

describe('aimAtPlayer', () => {
  it('takes its heading once, at the frame the segment begins', () => {
    const player: Vec2 = [60, 264];
    const compiled = compilePath(
      makePath({
        start: [112, 40],
        segments: [{ type: 'aimAtPlayer', speed: 2, duration: 30 }],
      }),
      { player },
    );
    expect(compiled.totalFrames).toBe(30);
    const length = Math.sqrt((60 - 112) ** 2 + (264 - 40) ** 2);
    const end = samplePath(compiled, 30);
    expect(end.x).toBeCloseTo(112 + ((60 - 112) / length) * 60, 9);
    expect(end.y).toBeCloseTo(40 + ((264 - 40) / length) * 60, 9);
    // It commits: moving the player afterwards cannot bend a compiled path.
    expect(samplePath(compiled, 30).heading).toBeCloseTo(samplePath(compiled, 1).heading, 9);
  });

  it('terminates on its own when no duration is given', () => {
    const compiled = compilePath(
      makePath({ start: [112, 40], segments: [{ type: 'aimAtPlayer', speed: 2 }] }),
      { player: [112, 264] },
    );
    expect(Number.isFinite(compiled.totalFrames)).toBe(true);
    expect(compiled.end.y).toBeCloseTo(DEFAULT_PLAYFIELD.height + OFF_SCREEN_MARGIN, 9);
  });

  it('resolves a function target with the frame and pose it starts from', () => {
    const seen: { frame: number; y: number }[] = [];
    compilePath(
      makePath({
        start: [100, 10],
        segments: [
          { type: 'line', to: [100, 40], speed: 1 },
          { type: 'aimAtPlayer', speed: 2, duration: 5 },
        ],
      }),
      {
        player: (frame, at) => {
          seen.push({ frame, y: at.y });
          return [10, 250];
        },
      },
    );
    expect(seen).toEqual([{ frame: 30, y: 40 }]);
  });
});

describe('toSlot', () => {
  it('flies to the slot the environment supplies', () => {
    const compiled = compilePath(
      makePath({ start: [10, 10], segments: [{ type: 'toSlot', speed: 1 }] }),
      { slot: [50, 40] },
    );
    expect(compiled.totalFrames).toBeCloseTo(50, 9);
    expect(samplePath(compiled, compiled.totalFrames)).toMatchObject({ x: 50, y: 40 });
  });
});

describe('exitBottom', () => {
  it('runs straight off the bottom when facing down', () => {
    const compiled = compilePath(
      makePath({ start: [100, 100], segments: [{ type: 'exitBottom', speed: 2 }] }),
    );
    expect(compiled.totalFrames).toBeCloseTo(
      (DEFAULT_PLAYFIELD.height + OFF_SCREEN_MARGIN - 100) / 2,
      9,
    );
    expect(compiled.end.y).toBeCloseTo(DEFAULT_PLAYFIELD.height + OFF_SCREEN_MARGIN, 9);
  });

  it('keeps a steep heading so a diving arc runs out rather than snapping vertical', () => {
    const compiled = compilePath(
      makePath({
        start: [100, 100],
        segments: [
          { type: 'arc', radius: 20, degrees: 20, dir: 'ccw', speed: 2 },
          { type: 'exitBottom' },
        ],
      }),
    );
    const beforeExit = compiled.segments[1]?.from.heading ?? Number.NaN;
    expect(beforeExit).toBeCloseTo(340, 9);
    expect(compiled.segments[1]?.to.heading).toBeCloseTo(beforeExit, 9);
    expect(compiled.end.y).toBeCloseTo(DEFAULT_PLAYFIELD.height + OFF_SCREEN_MARGIN, 9);
    expect(compiled.end.x).toBeLessThan(DEFAULT_PLAYFIELD.width + OFF_SCREEN_MARGIN);
  });

  it('turns down when the heading would slide off the side first', () => {
    // A heading that is technically downwards but very shallow reaches the side
    // long before the bottom, and at exactly horizontal it never arrives at all.
    // `exitBottom` is named for where it leaves, so it takes over.
    const compiled = compilePath(
      makePath({
        start: [100, 100],
        segments: [
          { type: 'arc', radius: 20, degrees: 89.9, dir: 'ccw', speed: 2 },
          { type: 'exitBottom' },
        ],
      }),
    );
    expect(compiled.segments[1]?.from.heading).toBeCloseTo(270.1, 9);
    expect(compiled.segments[1]?.to.heading).toBeCloseTo(0, 9);
    expect(compiled.end.y).toBeCloseTo(DEFAULT_PLAYFIELD.height + OFF_SCREEN_MARGIN, 9);
  });

  it('leaves a flyer that is already past the bottom where it is', () => {
    const compiled = compilePath(
      makePath({
        start: [100, DEFAULT_PLAYFIELD.height + OFF_SCREEN_MARGIN + 40],
        segments: [{ type: 'exitBottom', speed: 2 }],
      }),
    );
    expect(compiled.totalFrames).toBe(0);
    expect(compiled.end.y).toBe(DEFAULT_PLAYFIELD.height + OFF_SCREEN_MARGIN + 40);
  });

  it('turns straight down when it is not already heading that way', () => {
    const compiled = compilePath(
      makePath({
        start: [100, 100],
        segments: [{ type: 'line', to: [100, 40], speed: 2 }, { type: 'exitBottom' }],
      }),
    );
    expect(compiled.segments[1]?.from.heading).toBeCloseTo(180, 9);
    expect(compiled.segments[1]?.to.heading).toBeCloseTo(0, 9);
    expect(compiled.end.y).toBeCloseTo(DEFAULT_PLAYFIELD.height + OFF_SCREEN_MARGIN, 9);
  });
});

describe('fire and trigger', () => {
  const path = makePath({
    start: [100, 10],
    segments: [
      { type: 'line', to: [100, 30], speed: 1 },
      { type: 'fire', count: 2 },
      { type: 'line', to: [100, 50], speed: 1 },
      { type: 'trigger', ability: 'captureBeam', params: { width: 24 } },
      { type: 'exitBottom' },
    ],
  });

  it('takes no time and leaves the pose alone', () => {
    const compiled = compilePath(path);
    expect(compiled.segments[1]?.frames).toBe(0);
    expect(compiled.segments[3]?.frames).toBe(0);
    expect(samplePath(compiled, 20)).toMatchObject({ x: 100, y: 30 });
  });

  it('lands on the timeline at the frame it is reached', () => {
    const compiled = compilePath(path);
    expect(compiled.events).toEqual([
      { kind: 'fire', frame: 20, segment: 1, count: 2, sound: undefined },
      { kind: 'trigger', frame: 40, segment: 3, ability: 'captureBeam', params: { width: 24 } },
    ]);
  });

  it('drains each event exactly once over a half-open window', () => {
    const compiled = compilePath(path);
    const drained: number[] = [];
    for (let step = 0; step <= Math.ceil(compiled.totalFrames); step += 1) {
      for (const event of pathEventsBetween(compiled, step - 1, step)) drained.push(event.frame);
    }
    expect(drained).toEqual([20, 40]);
  });
});

describe('mirroring', () => {
  const asymmetric = makePath({
    mirror: true,
    start: [-16, 176],
    segments: [
      { type: 'bezier', to: [136, 112], c1: [40, 184], c2: [104, 160], speed: 1.6 },
      { type: 'arc', radius: 18, degrees: 120, dir: 'cw' },
      { type: 'sine', amplitude: 9, wavelength: 36, duration: 40 },
      { type: 'lissajous', ax: 14, ay: 7, fx: 2, fy: 1, duration: 45, phase: 30 },
    ],
  });

  it('reflects about the playfield centre line, exactly', () => {
    const plain = sampleEveryFrame(asymmetric);
    const mirrored = sampleEveryFrame(asymmetric, { mirror: true });
    expect(mirrored).toHaveLength(plain.length);
    plain.forEach(([x, y, heading], index) => {
      const [mx, my, mheading] = mirrored[index] ?? NO_SAMPLE;
      expect(mx).toBe(DEFAULT_PLAYFIELD.width - x);
      expect(my).toBe(y);
      expect(mheading).toBeCloseTo(normaliseHeading(-heading), 9);
    });
  });

  it('is a reflection of the evaluation, not a second copy of the data', () => {
    // The hand-mirrored twin: every point reflected, every turn reversed. If
    // mirroring were duplication this file would have to exist in the pack; the
    // test proves the interpreter produces it from the original.
    const twin = makePath({
      start: [DEFAULT_PLAYFIELD.width + 16, 176],
      segments: [
        {
          type: 'bezier',
          to: [DEFAULT_PLAYFIELD.width - 136, 112],
          c1: [DEFAULT_PLAYFIELD.width - 40, 184],
          c2: [DEFAULT_PLAYFIELD.width - 104, 160],
          speed: 1.6,
        },
        { type: 'arc', radius: 18, degrees: 120, dir: 'ccw' },
        { type: 'sine', amplitude: -9, wavelength: 36, duration: 40 },
        { type: 'lissajous', ax: -14, ay: 7, fx: 2, fy: 1, duration: 45, phase: 30 },
      ],
    });
    const mirrored = sampleEveryFrame(asymmetric, { mirror: true });
    const handMirrored = sampleEveryFrame(twin);
    expect(mirrored).toHaveLength(handMirrored.length);
    mirrored.forEach(([x, y, heading], index) => {
      const [tx, ty, theading] = handMirrored[index] ?? NO_SAMPLE;
      expect(x).toBeCloseTo(tx, 9);
      expect(y).toBeCloseTo(ty, 9);
      expect(heading).toBeCloseTo(theading, 9);
    });
  });

  it('aims a mirrored path at the real player, not at the player s reflection', () => {
    // Targets are world-space, so they are reflected *in* before evaluation and
    // the sampled position reflects back out onto the real one.
    const compiled = compilePath(
      makePath({ start: [10, 10], segments: [{ type: 'toSlot', speed: 2 }] }),
      { mirror: true, slot: [40, 90] },
    );
    const end = samplePath(compiled, compiled.totalFrames);
    expect(end.x).toBeCloseTo(40, 9);
    expect(end.y).toBeCloseTo(90, 9);
  });
});

describe('determinism', () => {
  const path = makePath({
    start: [-16, 200],
    segments: [
      { type: 'bezier', to: [120, 120], c1: [30, 230], c2: [80, 150], speed: 1.7 },
      { type: 'loop', radius: 22, turns: 1.5, dir: 'cw' },
      { type: 'sine', amplitude: 12, wavelength: 44, duration: 50 },
      { type: 'aimAtPlayer', speed: 2.2, duration: 24 },
      { type: 'exitBottom' },
    ],
  });
  const env: PathEnvironment = { player: [112, 264] };

  it('gives bit-identical samples on a second compilation', () => {
    const a = compilePath(path, env);
    const b = compilePath(path, env);
    expect(a.totalFrames).toBe(b.totalFrames);
    for (let frame = 0; frame <= Math.ceil(a.totalFrames); frame += 1) {
      const sa = samplePath(a, frame);
      const sb = samplePath(b, frame);
      expect(Object.is(sa.x, sb.x)).toBe(true);
      expect(Object.is(sa.y, sb.y)).toBe(true);
      expect(Object.is(sa.heading, sb.heading)).toBe(true);
    }
  });

  it('answers an arbitrary frame without replaying from zero', () => {
    const sequential = compilePath(path, env);
    const seen: number[][] = [];
    for (let frame = 0; frame <= Math.ceil(sequential.totalFrames); frame += 1) {
      const sample = samplePath(sequential, frame);
      seen.push([sample.x, sample.y, sample.heading]);
    }

    const random = compilePath(path, env);
    // Out of order, and backwards, which is what `/lab`'s scrubber does.
    for (let frame = Math.ceil(random.totalFrames); frame >= 0; frame -= 1) {
      const sample = samplePath(random, frame);
      const expected = seen[frame] ?? [];
      expect(Object.is(sample.x, expected[0])).toBe(true);
      expect(Object.is(sample.y, expected[1])).toBe(true);
      expect(Object.is(sample.heading, expected[2])).toBe(true);
    }
  });

  it('does not drift: sampling never accumulates state', () => {
    const compiled = compilePath(path, env);
    const first = samplePath(compiled, 97);
    for (let i = 0; i < 500; i += 1) samplePath(compiled, i % 40);
    const again = samplePath(compiled, 97);
    expect(Object.is(again.x, first.x)).toBe(true);
    expect(Object.is(again.y, first.y)).toBe(true);
  });
});

describe('what a playability check will need', () => {
  it('reports the box a path sweeps through', () => {
    const compiled = compilePath(
      makePath({
        start: [10, 20],
        segments: [
          { type: 'line', to: [90, 20], speed: 1 },
          { type: 'line', to: [90, 200], speed: 1 },
        ],
      }),
    );
    expect(pathBounds(compiled)).toEqual({ minX: 10, minY: 20, maxX: 90, maxY: 200 });
  });

  it('gives every path a finite duration, even the open-ended segments', () => {
    const compiled = compilePath(
      makePath({
        start: [112, 10],
        segments: [
          { type: 'aimAtPlayer', speed: 1.5 },
          { type: 'exitBottom', speed: 1.5 },
        ],
      }),
      { player: [40, 264] },
    );
    expect(compiled.totalFrames).toBeGreaterThan(0);
    expect(Number.isFinite(compiled.totalFrames)).toBe(true);
  });

  it('shows a path that wanders off the playfield in its bounds', () => {
    const compiled = compilePath(
      makePath({ start: [10, 10], segments: [{ type: 'line', to: [-400, 10], speed: 2 }] }),
    );
    expect(pathBounds(compiled).minX).toBe(-400);
  });
});

describe('content bugs', () => {
  it('rejects a path with nowhere to start', () => {
    const result = tryCompilePath(makePath({ segments: [{ type: 'exitBottom', speed: 1 }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/no start/);
  });

  it('rejects a segment that inherits a speed nobody set', () => {
    const result = tryCompilePath(
      makePath({ start: [0, 0], segments: [{ type: 'line', to: [0, 10] }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.segment).toBe(0);
      expect(result.errors[0]?.message).toMatch(/no speed/);
    }
  });

  it('rejects toSlot and aimAtPlayer without their targets', () => {
    const slot = tryCompilePath(
      makePath({ start: [0, 0], segments: [{ type: 'toSlot', speed: 1 }] }),
    );
    const aim = tryCompilePath(
      makePath({ start: [0, 0], segments: [{ type: 'aimAtPlayer', speed: 1 }] }),
    );
    expect(slot.ok).toBe(false);
    expect(aim.ok).toBe(false);
  });

  it('throws from compilePath, carrying the same errors', () => {
    expect(() => compilePath(makePath({ start: [0, 0], segments: [{ type: 'toSlot' }] }))).toThrow(
      PathCompileError,
    );
  });

  it('takes an initial speed from the caller instead', () => {
    const compiled = compilePath(
      makePath({ start: [0, 0], segments: [{ type: 'line', to: [0, 10] }] }),
      {
        speed: 2,
      },
    );
    expect(compiled.totalFrames).toBe(5);
  });
});
