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
 * Text is the pack's 8x8 pixel font (`src/render/text.ts`), which is why every
 * label here is upper case and inside the font's 0x20–0x5F range.
 *
 * The GAME OVER banner is **not** here: it belongs to the game-over screen in
 * `results.ts`, which the state machine in `flow.ts` decides to draw.
 */

import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';
import type { SpriteSheet } from '../render/sprites.js';
import { drawSprite } from '../render/sprites.js';
import { drawText } from '../render/text.js';

/**
 * One badge denomination and the sprite that draws it.
 *
 * Structural rather than the manifest's own type: the HUD needs a value and a
 * sprite id and nothing else, which keeps `src/ui/` from importing the content
 * schema for a drawing decision.
 */
export interface StageBadge {
  readonly value: number;
  readonly sprite: string;
}

/**
 * The badges shown for a stage number, largest first.
 *
 * Greedy over the denominations the pack declares (`docs/DESIGN.md` section 4:
 * "denominations 1, 5, 10, 20, 30, 50"), which is what the original does and why
 * stage 31 shows a 30 and a 1 rather than three 10s and a 1. Greedy is only
 * correct largest-first, so the list is sorted here rather than trusted — the
 * order a pack happens to write its badges in is not a rule.
 */
export function badgesForStage(stage: number, badges: readonly StageBadge[]): StageBadge[] {
  let remaining = Math.max(0, Math.trunc(stage));
  const shown: StageBadge[] = [];
  for (const badge of [...badges].sort((a, b) => b.value - a.value)) {
    while (remaining >= badge.value) {
      shown.push(badge);
      remaining -= badge.value;
    }
  }
  return shown;
}

export interface HudState {
  readonly score: number;
  readonly highScore: number;
  /** Fighters in reserve — the one on the field is not drawn down here. */
  readonly lives: number;
  readonly stage: number;
  /** The pack's badge denominations. Empty or absent is a game with no badge row. */
  readonly badges?: readonly StageBadge[];
  /** Where the badge art comes from. Absent draws no badges. */
  readonly sheet?: SpriteSheet;
}

const TEXT_COLOR = '#ffffff';
const LABEL_COLOR = '#ff2b2b';

/** Height of the top band, in logical rows. */
export const TOP_BAND_HEIGHT = 16;
/** Height of the bottom band, in logical rows. */
export const BOTTOM_BAND_HEIGHT = 16;

/** Badge box size and spacing, in logical pixels. */
const BADGE_SIZE = 8;
const BADGE_GAP = 2;
/** Most badges that fit along the bottom-right before they are dropped. */
const MAX_BADGES = 8;

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
  drawText(ctx, '1UP', 16, 0, { colour: LABEL_COLOR });
  drawText(ctx, 'HIGH SCORE', 72, 0, { colour: LABEL_COLOR });
  drawText(ctx, formatScore(state.score), 8, 8, { colour: TEXT_COLOR });
  drawText(ctx, formatScore(state.highScore), 88, 8, { colour: TEXT_COLOR });

  // Bottom-left: one glyph per fighter in reserve.
  const glyphY = LOGICAL_HEIGHT - 14;
  const shown = Math.min(state.lives, 5);
  for (let i = 0; i < shown; i += 1) {
    drawLifeGlyph(ctx, 2 + i * 14, glyphY);
  }

  drawStageBadges(ctx, state, LOGICAL_WIDTH - 2, LOGICAL_HEIGHT - 12);
}

/**
 * The badge row, laid out right to left from `right` so the largest badge ends
 * up furthest from the edge — the original's order.
 *
 * Exported because the between-stage screen shows the row too, and a second
 * layout would be a second thing to get wrong.
 */
export function drawStageBadges(
  ctx: CanvasRenderingContext2D,
  state: Pick<HudState, 'stage' | 'badges' | 'sheet'>,
  right: number,
  y: number,
): void {
  const { sheet, badges } = state;
  if (sheet === undefined || badges === undefined || badges.length === 0) return;
  // Past the row's width the original's badges overlap the reserve fighters; we
  // drop the overflow instead, which is cosmetic either way (reference section 10).
  const shown = badgesForStage(state.stage, badges).slice(0, MAX_BADGES);
  shown.forEach((badge, index) => {
    drawSprite(ctx, sheet, badge.sprite, right - (index + 1) * (BADGE_SIZE + BADGE_GAP), y);
  });
}
