/**
 * Drawing one path onto the 224×288 backbuffer, for `/lab`.
 *
 * Everything here is render-side: it asks `src/sim/paths.ts` where the flyer is
 * and draws the answer. The interpreter knows nothing about this file, which is
 * the section 9 rule working in the direction that matters — the previewer is
 * built on the same evaluation the simulation runs, so what it shows is what the
 * game will fly.
 */

import type { CompiledPath, PathSample, Vec2 } from '../../sim/paths.js';
import { headingToVector, samplePath } from '../../sim/paths.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../render/canvas.js';

const COLOURS = {
  background: '#000000',
  border: '#232334',
  centreLine: '#2e2e46',
  ahead: '#2a5f6b',
  travelled: '#37e0e8',
  flyer: '#ffe95c',
  facing: '#ff7edb',
  slot: '#7cff7c',
  player: '#ff6060',
  event: '#ffa040',
  segmentTick: '#8888aa',
} as const;

export interface PreviewMarkers {
  /** Where `toSlot` is aiming, in world coordinates. */
  readonly slot: Vec2;
  /** Where `aimAtPlayer` is aiming, in world coordinates. */
  readonly player: Vec2;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
}

function cross(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
  const cx = Math.round(x);
  const cy = Math.round(y);
  ctx.fillStyle = colour;
  ctx.fillRect(cx - 3, cy, 7, 1);
  ctx.fillRect(cx, cy - 3, 1, 7);
}

/**
 * The whole curve, as world-space points at one sample per frame.
 *
 * Sampling rather than re-deriving the geometry is the point: the line drawn is
 * literally the positions the simulation would visit, so a bug in the
 * interpreter shows up as a bent line rather than hiding behind a second,
 * prettier implementation.
 */
export function tracePath(path: CompiledPath): PathSample[] {
  const points: PathSample[] = [];
  for (let frame = 0; frame <= path.totalFrames; frame += 1) {
    points.push(samplePath(path, Math.min(frame, path.totalFrames)));
  }
  if (points.length === 0) points.push(samplePath(path, 0));
  return points;
}

function strokePoints(
  ctx: CanvasRenderingContext2D,
  points: readonly PathSample[],
  from: number,
  to: number,
  colour: string,
): void {
  if (to <= from) return;
  ctx.beginPath();
  for (let i = from; i <= to; i += 1) {
    const point = points[i];
    if (point === undefined) continue;
    if (i === from) ctx.moveTo(point.x + 0.5, point.y + 0.5);
    else ctx.lineTo(point.x + 0.5, point.y + 0.5);
  }
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function drawPathPreview(
  ctx: CanvasRenderingContext2D,
  path: CompiledPath,
  points: readonly PathSample[],
  frame: number,
  markers: PreviewMarkers,
): void {
  ctx.fillStyle = COLOURS.background;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // The axis `mirror` reflects about, so a mirrored path visibly hinges on it.
  ctx.fillStyle = COLOURS.centreLine;
  for (let y = 0; y < LOGICAL_HEIGHT; y += 4) ctx.fillRect(LOGICAL_WIDTH / 2, y, 1, 2);

  ctx.strokeStyle = COLOURS.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, LOGICAL_WIDTH - 1, LOGICAL_HEIGHT - 1);

  const travelled = Math.max(0, Math.min(points.length - 1, Math.floor(frame)));
  strokePoints(ctx, points, 0, points.length - 1, COLOURS.ahead);
  strokePoints(ctx, points, 0, travelled, COLOURS.travelled);

  for (const segment of path.segments) {
    if (segment.startFrame === 0) continue;
    dot(ctx, segment.from.x, segment.from.y, COLOURS.segmentTick);
  }
  for (const event of path.events) {
    const at = samplePath(path, event.frame);
    cross(ctx, at.x, at.y, COLOURS.event);
  }

  cross(ctx, markers.slot[0], markers.slot[1], COLOURS.slot);
  cross(ctx, markers.player[0], markers.player[1], COLOURS.player);

  const here = samplePath(path, frame);
  const [dx, dy] = headingToVector(here.heading);
  ctx.strokeStyle = COLOURS.facing;
  ctx.beginPath();
  ctx.moveTo(here.x + 0.5, here.y + 0.5);
  ctx.lineTo(here.x + 0.5 + dx * 9, here.y + 0.5 + dy * 9);
  ctx.stroke();

  ctx.fillStyle = COLOURS.flyer;
  ctx.fillRect(Math.round(here.x) - 2, Math.round(here.y) - 2, 5, 5);
}
