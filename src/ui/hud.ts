/**
 * The HUD: score, lives and the stage badges (docs/DESIGN.md section 4).
 *
 * `src/ui/` is a subscriber, like `src/render/`: it reads simulation state and
 * events and draws. It never writes back, and the simulation never knows it is
 * here.
 *
 * The layout is the arcade one — score along the top, reserve fighters along the
 * bottom-left, stage badges along the bottom-right — because the playfield is
 * 224x288 and that is where the space is.
 *
 * Text is drawn with the host's monospace font for now. The original 8x8 pixel
 * font arrives with Milestone 1's sprite-pipeline task; when it does, only
 * {@link drawText} changes.
 */

import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';

/**
 * Stage badge denominations, largest first (docs/DESIGN.md section 4:
 * "denominations 1, 5, 10, 20, 30, 50").
 */
export const BADGE_DENOMINATIONS: readonly number[] = Object.freeze([50, 30, 20, 10, 5, 1]);

/**
 * The badges shown for a stage number, largest first.
 *
 * Greedy over the denominations, which is what the original does and why stage
 * 31 shows a 30 and a 1 rather than three 10s and a 1.
 */
export function badgesForStage(stage: number): number[] {
  let remaining = Math.max(0, Math.trunc(stage));
  const badges: number[] = [];
  for (const denomination of BADGE_DENOMINATIONS) {
    while (remaining >= denomination) {
      badges.push(denomination);
      remaining -= denomination;
    }
  }
  return badges;
}

/** Colour per denomination. Placeholder art until the sprite pipeline lands. */
const BADGE_COLORS: Readonly<Record<number, string>> = Object.freeze({
  1: '#ffd24a',
  5: '#ff7043',
  10: '#42a5f5',
  20: '#ef5350',
  30: '#ab47bc',
  50: '#66bb6a',
});

export interface HudState {
  readonly score: number;
  readonly highScore: number;
  /** Fighters in reserve — the one on the field is not drawn down here. */
  readonly lives: number;
  readonly stage: number;
  readonly gameOver: boolean;
}

const TEXT_COLOR = '#ffffff';
const LABEL_COLOR = '#ff4d4d';
const HUD_FONT = '8px monospace';

/** Height of the top band, in logical rows. */
export const TOP_BAND_HEIGHT = 16;
/** Height of the bottom band, in logical rows. */
export const BOTTOM_BAND_HEIGHT = 16;

/** Badge box size and spacing, in logical pixels. */
const BADGE_SIZE = 8;
const BADGE_GAP = 2;
/** Most badges that fit along the bottom-right before they are dropped. */
const MAX_BADGES = 8;

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign = 'left',
): void {
  ctx.font = HUD_FONT;
  ctx.textBaseline = 'top';
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

/**
 * Six digits, as the original's player-1 display has. Scores below 10 show as
 * `    00`, which is the arcade's leading-blank convention rather than `000000`.
 */
export function formatScore(score: number): string {
  const clamped = Math.max(0, Math.trunc(score));
  if (clamped === 0) return '    00';
  return String(clamped).padStart(6, ' ');
}

/** One reserve-fighter glyph. Placeholder until the sprite pipeline lands. */
function drawLifeGlyph(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#e8eaff';
  ctx.fillRect(x + 5, y, 2, 4);
  ctx.fillRect(x + 3, y + 4, 6, 3);
  ctx.fillRect(x, y + 7, 12, 3);
  ctx.fillRect(x, y + 10, 3, 2);
  ctx.fillRect(x + 9, y + 10, 3, 2);
}

/** Draw the whole HUD onto the 224x288 backbuffer. */
export function drawHud(ctx: CanvasRenderingContext2D, state: HudState): void {
  // Top band: score labels and values.
  drawText(ctx, '1UP', 16, 0, LABEL_COLOR);
  drawText(ctx, 'HIGH SCORE', 72, 0, LABEL_COLOR);
  drawText(ctx, formatScore(state.score), 8, 8, TEXT_COLOR);
  drawText(ctx, formatScore(state.highScore), 88, 8, TEXT_COLOR);

  if (state.gameOver) {
    drawText(ctx, 'GAME OVER', LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 - 4, LABEL_COLOR, 'center');
  }

  // Bottom-left: one glyph per fighter in reserve.
  const glyphY = LOGICAL_HEIGHT - 14;
  const shown = Math.min(state.lives, 5);
  for (let i = 0; i < shown; i += 1) {
    drawLifeGlyph(ctx, 2 + i * 14, glyphY);
  }

  // Bottom-right: stage badges, largest first, laid out right to left.
  const badges = badgesForStage(state.stage).slice(0, MAX_BADGES);
  badges.forEach((denomination, index) => {
    const x = LOGICAL_WIDTH - 2 - (index + 1) * (BADGE_SIZE + BADGE_GAP);
    ctx.fillStyle = BADGE_COLORS[denomination] ?? '#ffffff';
    ctx.fillRect(x, LOGICAL_HEIGHT - 12, BADGE_SIZE, BADGE_SIZE);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 2, LOGICAL_HEIGHT - 10, BADGE_SIZE - 4, BADGE_SIZE - 4);
  });
}
