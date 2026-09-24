/**
 * Milestone 0 placeholder: enough drawing to prove the pipeline is real.
 *
 * It exists to show four things at a glance — the backbuffer is exactly
 * 224x288, the integer scale and letterboxing are right, the fixed-step loop is
 * running, and keyboard input reaches the simulation. Milestone 1 replaces it
 * with the starfield, sprites and HUD; nothing here is game logic.
 */

import { actionsOf, type InputFrame } from '../engine/input.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, type Layout } from './canvas.js';

export interface TestPatternState {
  /** Simulation steps run so far. */
  readonly step: number;
  /** Rendered frames so far. */
  readonly frame: number;
  /** Measured render frames per second. */
  readonly fps: number;
  /** Input sampled on the most recent simulation step. */
  readonly input: InputFrame;
  /** Current display layout, so the scale factor can be shown on screen. */
  readonly layout: Layout;
}

const EDGE_COLOR = '#2b6cff';
const GRID_COLOR = '#101a33';
const TEXT_COLOR = '#f4f4f4';
const ACCENT_COLOR = '#ffd24a';

/** Draw one placeholder frame onto the 224x288 backbuffer. */
export function drawTestPattern(ctx: CanvasRenderingContext2D, state: TestPatternState): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // 16px grid: the sprite size from section 5, so alignment is eyeballable.
  ctx.fillStyle = GRID_COLOR;
  for (let x = 16; x < LOGICAL_WIDTH; x += 16) ctx.fillRect(x, 0, 1, LOGICAL_HEIGHT);
  for (let y = 16; y < LOGICAL_HEIGHT; y += 16) ctx.fillRect(0, y, LOGICAL_WIDTH, 1);

  // One-pixel border. If any edge looks thicker or softer than the others, the
  // scale is not a whole number or smoothing crept back in.
  ctx.fillStyle = EDGE_COLOR;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, 1);
  ctx.fillRect(0, LOGICAL_HEIGHT - 1, LOGICAL_WIDTH, 1);
  ctx.fillRect(0, 0, 1, LOGICAL_HEIGHT);
  ctx.fillRect(LOGICAL_WIDTH - 1, 0, 1, LOGICAL_HEIGHT);

  // Single-pixel corner dots, the harshest test of nearest-neighbour scaling.
  ctx.fillStyle = ACCENT_COLOR;
  for (const [x, y] of [
    [2, 2],
    [LOGICAL_WIDTH - 3, 2],
    [2, LOGICAL_HEIGHT - 3],
    [LOGICAL_WIDTH - 3, LOGICAL_HEIGHT - 3],
  ] as const) {
    ctx.fillRect(x, y, 1, 1);
  }

  // A marker that advances once per simulation step, so a stalled loop is
  // obvious and a loop running at the wrong rate is measurable.
  const sweepY = 24 + (state.step % (LOGICAL_HEIGHT - 48));
  ctx.fillStyle = ACCENT_COLOR;
  ctx.fillRect(4, sweepY, 6, 2);
  ctx.fillRect(LOGICAL_WIDTH - 10, sweepY, 6, 2);

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';

  const held = actionsOf(state.input);
  const lines = [
    'STAR SWARM',
    'MILESTONE 0',
    '',
    `${String(LOGICAL_WIDTH)}x${String(LOGICAL_HEIGHT)}  scale ${String(state.layout.scale)}x`,
    `step ${String(state.step)}`,
    `frame ${String(state.frame)}`,
    `fps ${state.fps.toFixed(1)}`,
    `input ${held.length === 0 ? '-' : held.join(' ')}`,
  ];
  lines.forEach((line, index) => {
    ctx.fillText(line, 16, 24 + index * 10);
  });
}
