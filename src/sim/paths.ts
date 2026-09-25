/**
 * The movement-path interpreter — `docs/DESIGN.md` sections 7.2 and 9.
 *
 * A path is a list of segments (`pathSegmentSchema` in `src/content/schema.ts`
 * is the authority on their shapes). This module turns one into a pure function
 * of *elapsed simulation frames* to a position and a facing. Nothing here
 * touches the DOM, Canvas or Web Audio, and nothing here imports from
 * `src/render/`, `src/audio/` or `src/ui/` — that is the section 9 rule that
 * keeps headless tests, the validator and replays possible.
 *
 * Three properties are load-bearing, and the shape of this file follows from
 * them:
 *
 * 1. **Determinism.** Same path, same environment, same frame → bit-identical
 *    position, every run. There is no clock, no RNG and no accumulated state:
 *    `samplePath` is a function of the frame number alone, so drift cannot
 *    build up the way it does when each step nudges a stored position.
 * 2. **Random access.** {@link compilePath} is *eager*: it walks the whole
 *    segment list once, resolving each segment's start pose and duration, so
 *    afterwards any frame can be sampled directly. Scrubbing backwards in
 *    `/lab`, or spot-checking frame 900 in a test, costs the same as frame 1.
 * 3. **Mirroring is a property of the evaluation, not a second copy of the
 *    data.** A slot's `mirror` flag reflects the path about the playfield's
 *    vertical centre line (`x → width − x`). Reflection is an isometry, so it
 *    is applied at the boundary — world targets are reflected *in*, sampled
 *    positions are reflected *out* — and every segment type inherits it for
 *    free, arcs and loops reversing their handedness because the reflection
 *    says so rather than because a branch in the arc code says so.
 *
 * ## Coordinates and angles
 *
 * Logical pixels on the 224×288 playfield, x right and y **down**. Headings are
 * degrees, clockwise positive, `0` pointing down the screen — the convention
 * `schema.ts` states. So a heading θ is the unit vector `(−sin θ, cos θ)`:
 *
 * | Heading | Direction |
 * | ------- | --------- |
 * | 0       | down      |
 * | 90      | left      |
 * | 180     | up        |
 * | 270     | right     |
 *
 * ## Floating point
 *
 * Segment durations are real-valued frames, not rounded up to whole ones: a
 * 100 px line at 1.6 px/frame lasts 62.5 frames, and the following segment
 * starts mid-frame. Rounding each segment instead would let error accumulate
 * across a thirteen-segment path. `Math.sqrt` is used in place of `Math.hypot`
 * throughout because `hypot` is free to be implemented differently by different
 * engines, and distances feed directly into positions.
 *
 * `Math.sin`, `Math.cos` and `Math.atan2` are the remaining engine-defined
 * functions here: the ECMAScript spec allows an implementation-dependent
 * approximation, so curved segments are reproducible on one engine but not
 * guaranteed identical across two. That is the same bargain `src/engine/rng.ts`
 * refuses to make, and it is deliberate — a path table of pre-rounded integers
 * would buy cross-engine equality at the cost of the smooth arcs the content
 * model is built around. If a golden replay ever needs to survive a change of
 * engine, this is the place to look first.
 */

import type { MovementPath, PathSegment } from '../content/schema.js';

/* -------------------------------------------------------------------------- */
/* Constants                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The playfield an environment gets if it does not name one.
 *
 * Deliberately a local copy of the render layer's `LOGICAL_WIDTH`/`_HEIGHT`
 * rather than an import: `src/sim/` may not reach into `src/render/`.
 */
export const DEFAULT_PLAYFIELD = { width: 224, height: 288 } as const;

/**
 * How far past an edge a flyer must be before `exitBottom` and an open-ended
 * `aimAtPlayer` consider it gone. One sprite's width (section 5), so the sprite
 * is fully clear of the screen and not half-drawn on the edge.
 */
export const OFF_SCREEN_MARGIN = 16;

/**
 * Subdivisions used to build a cubic bézier's arc-length table.
 *
 * A bézier's natural parameter is not proportional to distance, so a flyer
 * driven straight off `t` would speed up and slow down along the curve. The
 * table makes traversal constant-speed. A fixed count keeps it reproducible —
 * an adaptive subdivision would make the sampled positions depend on the
 * curve's shape in ways that are hard to hold still across a refactor.
 */
const BEZIER_SAMPLES = 64;

/**
 * Slack when comparing two exit distances. Both come out of the same trig, so a
 * heading that exits exactly at a corner must not be decided by the last bit.
 */
const EXIT_EPSILON = 1e-9;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const TAU = Math.PI * 2;

/* -------------------------------------------------------------------------- */
/* Public types                                                                 */
/* -------------------------------------------------------------------------- */

/** A point on the playfield, in the same `[x, y]` tuple form the schema uses. */
export type Vec2 = readonly [number, number];

export interface Playfield {
  readonly width: number;
  readonly height: number;
}

/** Everything a flyer is, as far as a path is concerned. */
export interface PathPose {
  readonly x: number;
  readonly y: number;
  /** Degrees, clockwise positive, 0 pointing down the screen. */
  readonly heading: number;
  /** Pixels per simulation frame. */
  readonly speed: number;
}

/**
 * Where a dynamic target is, resolved once during compilation.
 *
 * The frame is path-local — frames since this path began — and `at` is the pose
 * the flyer holds when the segment starts, both in **world** space. A constant
 * is the usual case (tests, `/lab`, the validator); the function form exists so
 * a live dive can aim at wherever the player actually is when the segment
 * begins rather than at where they stood when the path was compiled.
 */
export type TargetResolver = Vec2 | ((frame: number, at: PathPose) => Vec2);

/** What a path needs from the world around it. */
export interface PathEnvironment {
  readonly playfield?: Playfield;
  /**
   * Reflect the whole path about the playfield's vertical centre line. This is
   * the wave slot's `mirror` flag (`schema.ts`, `waveSlotSchema`).
   */
  readonly mirror?: boolean;
  /** This flyer's formation slot, in world coordinates. Required by `toSlot`. */
  readonly slot?: TargetResolver;
  /** The player, in world coordinates. Required by `aimAtPlayer`. */
  readonly player?: TargetResolver;
  /**
   * Where the flyer already is, in world coordinates, overriding the path's own
   * `start`. A path with neither is a compile error: there is nowhere to begin.
   */
  readonly start?: Vec2;
  /** Heading on entry, in world space. Defaults to 0 — straight down. */
  readonly heading?: number;
  /** Speed on entry, for a first segment that inherits rather than states one. */
  readonly speed?: number;
}

/** A `fire` or `trigger` segment, placed on the timeline. */
export type PathEvent =
  | {
      readonly kind: 'fire';
      readonly frame: number;
      readonly segment: number;
      readonly count: number;
      readonly sound: string | undefined;
    }
  | {
      readonly kind: 'trigger';
      readonly frame: number;
      readonly segment: number;
      readonly ability: string;
      readonly params: Readonly<Record<string, unknown>> | undefined;
    };

/** One compiled segment. Poses are world space; `frames` may be fractional. */
export interface CompiledSegment {
  /** Index into the source path's `segments`. */
  readonly index: number;
  readonly type: PathSegment['type'];
  /** Path-local frame at which this segment begins. */
  readonly startFrame: number;
  /** Duration in frames. Zero for `fire`, `trigger` and a zero-length move. */
  readonly frames: number;
  readonly from: PathPose;
  readonly to: PathPose;
}

export interface CompiledPath {
  readonly id: string;
  /** Total duration in frames. Sampling past it holds the final pose. */
  readonly totalFrames: number;
  readonly segments: readonly CompiledSegment[];
  /** Every `fire` and `trigger`, in frame order. */
  readonly events: readonly PathEvent[];
  readonly mirrored: boolean;
  readonly playfield: Playfield;
  readonly start: PathPose;
  readonly end: PathPose;
}

export interface PathSample extends PathPose {
  /** Index into the source path's `segments`. */
  readonly segment: number;
  /** True once the frame has reached or passed {@link CompiledPath.totalFrames}. */
  readonly done: boolean;
}

/** A content bug in a path, in the same shape `src/content/errors.ts` reports. */
export interface PathError {
  readonly path: string;
  /** Index into `segments`, when the problem belongs to one. */
  readonly segment?: number;
  readonly message: string;
}

export type CompileResult =
  | { readonly ok: true; readonly path: CompiledPath }
  | { readonly ok: false; readonly errors: readonly PathError[] };

/** Thrown by {@link compilePath}. Carries the same errors `tryCompilePath` returns. */
export class PathCompileError extends Error {
  readonly errors: readonly PathError[];

  constructor(errors: readonly PathError[]) {
    super(
      errors.length === 0
        ? 'path failed to compile'
        : errors
            .map((e) =>
              e.segment === undefined
                ? `${e.path}: ${e.message}`
                : `${e.path} segments[${String(e.segment)}]: ${e.message}`,
            )
            .join('; '),
    );
    this.name = 'PathCompileError';
    this.errors = errors;
  }
}

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Wrap to `[0, 360)`. Every heading this module hands out has been through it.
 *
 * The `+ 0` is not noise: `-0 % 360` is `-0`, and a heading of `-0` compares
 * equal to `0` but does not *serialise* the same, which would make an otherwise
 * identical mirrored path look different in a golden replay.
 */
export function normaliseHeading(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped + 0;
}

/** Unit vector for a heading: 0 is down, and the angle runs clockwise. */
export function headingToVector(degrees: number): readonly [number, number] {
  const r = degrees * DEG_TO_RAD;
  return [-Math.sin(r), Math.cos(r)];
}

/** Heading of a direction vector. A zero vector has no heading; callers keep theirs. */
export function vectorToHeading(dx: number, dy: number): number {
  return normaliseHeading(Math.atan2(-dx, dy) * RAD_TO_DEG);
}

/** Rotate clockwise-positive in screen space (x right, y down). */
function rotate(x: number, y: number, radians: number): readonly [number, number] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [x * c - y * s, x * s + y * c];
}

function distance(dx: number, dy: number): number {
  // Not Math.hypot: see the floating-point note at the top of the file.
  return Math.sqrt(dx * dx + dy * dy);
}

/* -------------------------------------------------------------------------- */
/* Mirroring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reflect a point about the playfield's vertical centre line.
 *
 * Its own inverse, which is why one function serves both directions: world
 * targets come *in* through it and sampled positions go *out* through it.
 */
export function mirrorX(x: number, playfield: Playfield): number {
  return playfield.width - x;
}

/** Reflect a heading about the vertical: `(−sin θ, cos θ)` → `(sin θ, cos θ)`. */
export function mirrorHeading(degrees: number): number {
  return normaliseHeading(-degrees);
}

/* -------------------------------------------------------------------------- */
/* Compilation                                                                  */
/* -------------------------------------------------------------------------- */

interface MutablePose {
  x: number;
  y: number;
  heading: number;
  speed: number;
}

/** Position and facing within a segment, at `local` frames into it. */
type Evaluator = (local: number) => { x: number; y: number; heading: number };

interface Timed {
  readonly compiled: CompiledSegment;
  readonly evaluate: Evaluator;
}

function freeze(pose: MutablePose): PathPose {
  return { x: pose.x, y: pose.y, heading: pose.heading, speed: pose.speed };
}

/**
 * Distance from `pose` to the first playfield edge along `heading`, allowing
 * {@link OFF_SCREEN_MARGIN} beyond it.
 *
 * Used by the two open-ended segments. It is why "fly until off screen"
 * terminates: the answer is closed-form, so an unbounded-looking segment still
 * has a known duration and the path as a whole still has a `totalFrames`.
 */
function distanceToExit(pose: MutablePose, heading: number, playfield: Playfield): number {
  const [dx, dy] = headingToVector(heading);
  const minX = -OFF_SCREEN_MARGIN;
  const maxX = playfield.width + OFF_SCREEN_MARGIN;
  const minY = -OFF_SCREEN_MARGIN;
  const maxY = playfield.height + OFF_SCREEN_MARGIN;

  if (pose.x < minX || pose.x > maxX || pose.y < minY || pose.y > maxY) return 0;

  let best = Number.POSITIVE_INFINITY;
  const consider = (t: number): void => {
    if (t >= 0 && t < best) best = t;
  };
  if (dx > 0) consider((maxX - pose.x) / dx);
  else if (dx < 0) consider((minX - pose.x) / dx);
  if (dy > 0) consider((maxY - pose.y) / dy);
  else if (dy < 0) consider((minY - pose.y) / dy);

  // A unit vector always has a non-zero component, so `best` is always finite.
  return Number.isFinite(best) ? best : 0;
}

/** Cubic bézier point and derivative at parameter `t`. */
function bezierAt(
  p0: Vec2,
  c1: Vec2,
  c2: Vec2,
  p3: Vec2,
  t: number,
): { x: number; y: number; dx: number; dy: number } {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  const da = 3 * u * u;
  const db = 6 * u * t;
  const dc = 3 * t * t;
  return {
    x: a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0],
    y: a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1],
    dx: da * (c1[0] - p0[0]) + db * (c2[0] - c1[0]) + dc * (p3[0] - c2[0]),
    dy: da * (c1[1] - p0[1]) + db * (c2[1] - c1[1]) + dc * (p3[1] - c2[1]),
  };
}

/** Cumulative arc lengths at `BEZIER_SAMPLES + 1` evenly spaced parameters. */
function bezierLengthTable(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2): number[] {
  const table = [0];
  let previous = bezierAt(p0, c1, c2, p3, 0);
  let total = 0;
  for (let i = 1; i <= BEZIER_SAMPLES; i += 1) {
    const point = bezierAt(p0, c1, c2, p3, i / BEZIER_SAMPLES);
    total += distance(point.x - previous.x, point.y - previous.y);
    table.push(total);
    previous = point;
  }
  return table;
}

/** Invert the table: the parameter at which `s` pixels have been travelled. */
function bezierParamAt(table: readonly number[], s: number): number {
  const total = table[table.length - 1] ?? 0;
  if (total <= 0) return 0;
  if (s <= 0) return 0;
  if (s >= total) return 1;

  let low = 0;
  let high = table.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((table[mid] ?? 0) <= s) low = mid;
    else high = mid;
  }
  const a = table[low] ?? 0;
  const b = table[high] ?? a;
  const span = b - a;
  const withinSpan = span > 0 ? (s - a) / span : 0;
  return (low + withinSpan) / BEZIER_SAMPLES;
}

/**
 * Evaluators, kept beside the plain-data {@link CompiledPath} rather than on it.
 *
 * A `CompiledPath` is then structurally comparable and safe to log or snapshot
 * in a test, which a record full of closures would not be.
 */
const COMPILED = new WeakMap<
  CompiledPath,
  { timeline: readonly Timed[]; mirrored: boolean; playfield: Playfield }
>();

function resolveTarget(
  resolver: TargetResolver | undefined,
  frame: number,
  worldPose: PathPose,
): Vec2 | undefined {
  if (resolver === undefined) return undefined;
  return typeof resolver === 'function' ? resolver(frame, worldPose) : resolver;
}

/**
 * Compile a path, collecting content bugs rather than throwing.
 *
 * Eager by design (see the file header): every segment's start pose and
 * duration is resolved here, once, so sampling afterwards is random access.
 */
export function tryCompilePath(path: MovementPath, env: PathEnvironment = {}): CompileResult {
  const errors: PathError[] = [];
  const playfield = env.playfield ?? DEFAULT_PLAYFIELD;
  const mirrored = env.mirror ?? false;

  const fail = (message: string, segment?: number): void => {
    errors.push(
      segment === undefined ? { path: path.id, message } : { path: path.id, segment, message },
    );
  };

  /** World → authored space. Identity unless this evaluation is mirrored. */
  const toAuthored = (point: Vec2): Vec2 =>
    mirrored ? [mirrorX(point[0], playfield), point[1]] : point;
  /** Authored → world. The same reflection, applied on the way out. */
  const toWorldPose = (pose: MutablePose): PathPose =>
    mirrored
      ? {
          x: mirrorX(pose.x, playfield),
          y: pose.y,
          heading: mirrorHeading(pose.heading),
          speed: pose.speed,
        }
      : freeze(pose);

  const startWorld = env.start;
  const authoredStart: Vec2 | undefined =
    startWorld !== undefined ? toAuthored(startWorld) : path.start;
  if (authoredStart === undefined) {
    fail('no start: the path has no "start" and the caller supplied none');
    return { ok: false, errors };
  }

  const pose: MutablePose = {
    x: authoredStart[0],
    y: authoredStart[1],
    heading: mirrored ? mirrorHeading(env.heading ?? 0) : (env.heading ?? 0),
    speed: env.speed ?? 0,
  };

  const startPose = toWorldPose(pose);
  const timeline: Timed[] = [];
  const events: PathEvent[] = [];
  let frame = 0;

  /** The speed a segment runs at: its own, or the one the last segment left. */
  const speedFor = (index: number, own: number | undefined): number | undefined => {
    if (own !== undefined) return own;
    if (Number.isFinite(pose.speed) && pose.speed > 0) return pose.speed;
    fail(
      'no speed: this segment inherits its speed, but no earlier segment set one ' +
        'and the caller supplied none',
      index,
    );
    return undefined;
  };

  const push = (
    index: number,
    type: PathSegment['type'],
    frames: number,
    evaluate: Evaluator,
    next: MutablePose,
  ): void => {
    const from = toWorldPose(pose);
    pose.x = next.x;
    pose.y = next.y;
    pose.heading = normaliseHeading(next.heading);
    pose.speed = next.speed;
    const safeFrames = Number.isFinite(frames) && frames > 0 ? frames : 0;
    timeline.push({
      compiled: {
        index,
        type,
        startFrame: frame,
        frames: safeFrames,
        from,
        to: toWorldPose(pose),
      },
      evaluate,
    });
    frame += safeFrames;
  };

  /**
   * A straight run from the current pose to an explicit endpoint.
   *
   * Interpolating between the two endpoints rather than stepping
   * `origin + direction × speed × frame` is what makes the arrival exact: a
   * heading of 270° is a `cos` away from being exactly horizontal, and stepping
   * along it leaves a flyer that should land on y = 20 at y = 19.999999999999986.
   * Over a `toSlot` that is the difference between sitting in the formation slot
   * and sitting a hair beside it.
   */
  const straight = (
    index: number,
    type: PathSegment['type'],
    heading: number,
    endX: number,
    endY: number,
    frames: number,
    speed: number,
  ): void => {
    const originX = pose.x;
    const originY = pose.y;
    push(
      index,
      type,
      frames,
      (local) => {
        const t = frames > 0 ? local / frames : 1;
        return { x: originX + (endX - originX) * t, y: originY + (endY - originY) * t, heading };
      },
      { x: endX, y: endY, heading, speed },
    );
  };

  path.segments.forEach((segment, index) => {
    switch (segment.type) {
      case 'line':
      case 'toSlot': {
        let target: Vec2;
        if (segment.type === 'line') {
          target = segment.to;
        } else {
          const world = resolveTarget(env.slot, frame, toWorldPose(pose));
          if (world === undefined) {
            fail('"toSlot" needs the flyer\'s formation slot; none was supplied', index);
            return;
          }
          target = toAuthored(world);
        }
        const speed = speedFor(index, segment.speed);
        if (speed === undefined) return;
        const dx = target[0] - pose.x;
        const dy = target[1] - pose.y;
        const length = distance(dx, dy);
        const heading = length > 0 ? vectorToHeading(dx, dy) : pose.heading;
        const frames = speed > 0 ? length / speed : 0;
        straight(index, segment.type, heading, target[0], target[1], frames, speed);
        return;
      }

      case 'bezier': {
        const speed = speedFor(index, segment.speed);
        if (speed === undefined) return;
        const p0: Vec2 = [pose.x, pose.y];
        const { c1, c2, to } = segment;
        const table = bezierLengthTable(p0, c1, c2, to);
        const total = table[table.length - 1] ?? 0;
        const frames = speed > 0 ? total / speed : 0;
        const entryHeading = pose.heading;
        const evaluate: Evaluator = (local) => {
          const point = bezierAt(p0, c1, c2, to, bezierParamAt(table, local * speed));
          const moving = point.dx !== 0 || point.dy !== 0;
          return {
            x: point.x,
            y: point.y,
            heading: moving ? vectorToHeading(point.dx, point.dy) : entryHeading,
          };
        };
        const end = evaluate(frames);
        push(index, 'bezier', frames, evaluate, {
          x: to[0],
          y: to[1],
          heading: end.heading,
          speed,
        });
        return;
      }

      case 'arc':
      case 'loop': {
        const speed = speedFor(index, segment.speed);
        if (speed === undefined) return;
        const degrees = segment.type === 'arc' ? segment.degrees : segment.turns * 360;
        const { radius, dir } = segment;
        const sign = dir === 'cw' ? 1 : -1;
        const arcLength = radius * degrees * DEG_TO_RAD;
        const frames = speed > 0 ? arcLength / speed : 0;

        // The centre sits one radius to the side the flyer is turning towards:
        // rotating the heading by +90° for a clockwise turn, −90° otherwise.
        const [dx, dy] = headingToVector(pose.heading);
        const nx = sign > 0 ? -dy : dy;
        const ny = sign > 0 ? dx : -dx;
        const cx = pose.x + radius * nx;
        const cy = pose.y + radius * ny;
        const startX = pose.x - cx;
        const startY = pose.y - cy;
        const entryHeading = pose.heading;

        const evaluate: Evaluator = (local) => {
          const swept = frames > 0 ? (local / frames) * degrees * sign : 0;
          const radians = swept * DEG_TO_RAD;
          const [rx, ry] = rotate(startX, startY, radians);
          return { x: cx + rx, y: cy + ry, heading: normaliseHeading(entryHeading + swept) };
        };
        const end = evaluate(frames);
        push(index, segment.type, frames, evaluate, { ...end, speed });
        return;
      }

      case 'lissajous': {
        const { ax, ay, fx, fy, duration } = segment;
        const phase = (segment.phase ?? 0) * DEG_TO_RAD;
        const frames = duration;
        // Anchored so the figure starts exactly where the flyer already is,
        // whatever the phase offset — otherwise a phased lissajous teleports.
        const offsetX = (u: number): number => ax * Math.sin(TAU * fx * u + phase);
        const offsetY = (u: number): number => ay * Math.sin(TAU * fy * u);
        const anchorX = pose.x - offsetX(0);
        const anchorY = pose.y - offsetY(0);
        const entryHeading = pose.heading;
        const evaluate: Evaluator = (local) => {
          const u = frames > 0 ? local / frames : 0;
          const vx = frames > 0 ? (ax * TAU * fx * Math.cos(TAU * fx * u + phase)) / frames : 0;
          const vy = frames > 0 ? (ay * TAU * fy * Math.cos(TAU * fy * u)) / frames : 0;
          return {
            x: anchorX + offsetX(u),
            y: anchorY + offsetY(u),
            heading: vx !== 0 || vy !== 0 ? vectorToHeading(vx, vy) : entryHeading,
          };
        };
        const end = evaluate(frames);
        push(index, 'lissajous', frames, evaluate, { ...end, speed: pose.speed });
        return;
      }

      case 'sine': {
        const speed = speedFor(index, segment.speed);
        if (speed === undefined) return;
        const { amplitude, wavelength, duration } = segment;
        const frames = duration;
        const heading = pose.heading;
        const [fwdX, fwdY] = headingToVector(heading);
        // Transverse axis, 90° clockwise of travel: at heading 0 (down) a
        // positive amplitude bulges towards the left of the screen.
        const perpX = -fwdY;
        const perpY = fwdX;
        const originX = pose.x;
        const originY = pose.y;
        const k = TAU / wavelength;
        const evaluate: Evaluator = (local) => {
          const along = speed * local;
          const lateral = amplitude * Math.sin(k * along);
          const vAlong = speed;
          const vLateral = amplitude * k * speed * Math.cos(k * along);
          const vx = fwdX * vAlong + perpX * vLateral;
          const vy = fwdY * vAlong + perpY * vLateral;
          return {
            x: originX + fwdX * along + perpX * lateral,
            y: originY + fwdY * along + perpY * lateral,
            heading: vx !== 0 || vy !== 0 ? vectorToHeading(vx, vy) : heading,
          };
        };
        const end = evaluate(frames);
        push(index, 'sine', frames, evaluate, { ...end, speed });
        return;
      }

      case 'wait': {
        const held = { x: pose.x, y: pose.y, heading: pose.heading };
        push(index, 'wait', segment.frames, () => held, { ...held, speed: pose.speed });
        return;
      }

      case 'aimAtPlayer': {
        const world = resolveTarget(env.player, frame, toWorldPose(pose));
        if (world === undefined) {
          fail('"aimAtPlayer" needs the player\'s position; none was supplied', index);
          return;
        }
        const target = toAuthored(world);
        const dx = target[0] - pose.x;
        const dy = target[1] - pose.y;
        // The heading is taken once, at the frame the segment begins, and then
        // held: this is a committed swoop, not a homing missile.
        const heading = dx !== 0 || dy !== 0 ? vectorToHeading(dx, dy) : pose.heading;
        const { speed } = segment;
        const length =
          segment.duration === undefined
            ? distanceToExit(pose, heading, playfield)
            : segment.duration * speed;
        const [dirX, dirY] = headingToVector(heading);
        straight(
          index,
          'aimAtPlayer',
          heading,
          pose.x + dirX * length,
          pose.y + dirY * length,
          speed > 0 ? length / speed : 0,
          speed,
        );
        return;
      }

      case 'exitBottom': {
        const speed = speedFor(index, segment.speed);
        if (speed === undefined) return;

        // Keep the current heading when it genuinely leaves by the bottom, so a
        // steep dive runs out the way it was going instead of snapping vertical.
        // "Heading downwards" is not enough of a test: a heading a hair below
        // horizontal points down too, and would slide off the side — or, at
        // exactly 90°, travel some 10^16 pixels to reach the bottom edge. So the
        // condition is that the bottom is the nearest edge along that heading.
        const bottom = playfield.height + OFF_SCREEN_MARGIN;
        const [currentX, currentY] = headingToVector(pose.heading);
        const alongCurrent = currentY > 0 ? (bottom - pose.y) / currentY : Number.POSITIVE_INFINITY;
        const keepsHeading =
          Number.isFinite(alongCurrent) &&
          alongCurrent <= distanceToExit(pose, pose.heading, playfield) + EXIT_EPSILON;

        const heading = keepsHeading ? pose.heading : 0;
        const [unitX, unitY] = keepsHeading ? [currentX, currentY] : headingToVector(0);
        const remaining = bottom - pose.y;
        const length = remaining > 0 ? remaining / unitY : 0;
        // The exit y is stated rather than derived, so `exitBottom` finishes
        // exactly on the line it is named after — and a flyer already past it
        // stays where it is rather than being dragged back up to it.
        straight(
          index,
          'exitBottom',
          heading,
          pose.x + unitX * length,
          remaining > 0 ? bottom : pose.y,
          length / speed,
          speed,
        );
        return;
      }

      case 'fire': {
        events.push({
          kind: 'fire',
          frame,
          segment: index,
          count: segment.count,
          sound: segment.sound,
        });
        const held = { x: pose.x, y: pose.y, heading: pose.heading };
        push(index, 'fire', 0, () => held, { ...held, speed: pose.speed });
        return;
      }

      case 'trigger': {
        events.push({
          kind: 'trigger',
          frame,
          segment: index,
          ability: segment.ability,
          params: segment.params,
        });
        const held = { x: pose.x, y: pose.y, heading: pose.heading };
        push(index, 'trigger', 0, () => held, { ...held, speed: pose.speed });
        return;
      }
    }
  });

  if (errors.length > 0) return { ok: false, errors };

  const compiled: CompiledPath = {
    id: path.id,
    totalFrames: frame,
    segments: timeline.map((entry) => entry.compiled),
    events,
    mirrored,
    playfield,
    start: startPose,
    end: toWorldPose(pose),
  };

  COMPILED.set(compiled, { timeline, mirrored, playfield });
  return { ok: true, path: compiled };
}

/** {@link tryCompilePath}, for callers that would rather have an exception. */
export function compilePath(path: MovementPath, env: PathEnvironment = {}): CompiledPath {
  const result = tryCompilePath(path, env);
  if (!result.ok) throw new PathCompileError(result.errors);
  return result.path;
}

/* -------------------------------------------------------------------------- */
/* Sampling                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where the flyer is `frame` frames into the path.
 *
 * `frame` may be fractional — `/lab`'s scrubber uses that — and is clamped at
 * both ends: before the start the flyer waits at the start pose, past the end it
 * holds the final one, with `done` set. There is no hidden state, so calling
 * this with frames 0, 1, 2… and calling it with frame 900 alone give the same
 * answer for frame 900.
 */
export function samplePath(path: CompiledPath, frame: number): PathSample {
  const entry = COMPILED.get(path);
  const timeline = entry?.timeline ?? [];
  const last = timeline[timeline.length - 1];

  if (!Number.isFinite(frame) || frame <= 0) {
    const first = timeline[0];
    // `path.start` carries the speed the flyer arrived with, which is 0 when no
    // caller supplied one. At frame 0 the useful answer is the speed it is about
    // to fly at, so the first segment's speed wins.
    return {
      ...path.start,
      speed: first?.compiled.to.speed ?? path.start.speed,
      segment: first?.compiled.index ?? 0,
      done: path.totalFrames <= 0,
    };
  }
  if (frame >= path.totalFrames) {
    return { ...path.end, segment: last?.compiled.index ?? 0, done: true };
  }

  // Binary search for the segment owning this frame. Zero-length segments own no
  // frames, so `frames > 0` is the predicate that matters, and the search is on
  // `startFrame` alone because the timeline is contiguous.
  let low = 0;
  let high = timeline.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    const candidate = timeline[mid];
    if (candidate !== undefined && candidate.compiled.startFrame <= frame) low = mid;
    else high = mid - 1;
  }
  // `low` is the last segment starting at or before this frame. It always has a
  // duration: an instant shares its `startFrame` with the segment after it, and
  // the search prefers the later index, so a `fire` never wins the lookup.
  const found = timeline[low];
  if (found === undefined) {
    return { ...path.end, segment: last?.compiled.index ?? 0, done: true };
  }

  const elapsed = frame - found.compiled.startFrame;
  const point = found.evaluate(elapsed > 0 ? elapsed : 0);
  const mirrored = entry?.mirrored ?? false;
  const playfield = entry?.playfield ?? path.playfield;

  return {
    x: mirrored ? mirrorX(point.x, playfield) : point.x,
    y: point.y,
    heading: mirrored ? mirrorHeading(point.heading) : normaliseHeading(point.heading),
    speed: found.compiled.to.speed,
    segment: found.compiled.index,
    done: false,
  };
}

/**
 * The `fire` and `trigger` events in `(after, through]`.
 *
 * Half-open at the start so a sim draining one step at a time — `(step − 1,
 * step]` — sees every event exactly once, and an event at frame 0 is picked up
 * by passing `after = −1`.
 */
export function pathEventsBetween(
  path: CompiledPath,
  after: number,
  through: number,
): readonly PathEvent[] {
  return path.events.filter((event) => event.frame > after && event.frame <= through);
}

/* -------------------------------------------------------------------------- */
/* What a playability check needs                                               */
/* -------------------------------------------------------------------------- */

export interface PathBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * The box a path sweeps through, in world coordinates.
 *
 * Section 8 step 2's playability checks ("paths stay on screen", "a path that
 * never terminates is a content bug") are Milestone 3 work and are **not** built
 * here. This, plus {@link CompiledPath.totalFrames} and {@link samplePath}, is
 * what such a check needs from the interpreter: compilation already proves the
 * path terminates, because every segment resolves to a finite duration — even
 * the two open-ended ones, which close over the playfield edge — and the bounds
 * answer "does it leave the screen, and by how much".
 *
 * Sampled at whole frames (what the sim will actually visit) plus every segment
 * boundary, so a one-frame path is still measured at both ends.
 */
export function pathBounds(path: CompiledPath, step = 1): PathBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const include = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  const stride = step > 0 ? step : 1;
  for (let frame = 0; frame < path.totalFrames; frame += stride) {
    const sample = samplePath(path, frame);
    include(sample.x, sample.y);
  }
  for (const segment of path.segments) {
    include(segment.from.x, segment.from.y);
    include(segment.to.x, segment.to.y);
  }
  include(path.end.x, path.end.y);

  return { minX, minY, maxX, maxY };
}
