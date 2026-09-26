/**
 * Game over and the results screen (docs/DESIGN.md section 4, "Game flow": "a
 * game-over results screen showing shots fired, hits and hit ratio").
 *
 * The arithmetic is counted from simulation events and nothing else. `src/sim/`
 * already says when a shot leaves the ship (`shot-fired`) and when one connects
 * (`target-hit`, `target-destroyed`); a shot deactivates on its first hit
 * (`resolvePlayerShots` in `src/sim/world.ts`), so hits can never exceed shots
 * and the ratio needs no clamping. Adding a counter to the simulation for a
 * screen would put presentation inside the deterministic half for no gain.
 *
 * {@link RunStats} is accumulated by `src/ui/flow.ts`; this module only turns it
 * into numbers and pixels, which is why the arithmetic is unit-testable with no
 * DOM in sight.
 */

import { LOGICAL_WIDTH } from '../render/canvas.js';
import { drawText, measureText } from '../render/text.js';
import type { SimEvent } from '../sim/events.js';
import { CARD_TOP, drawCentredPanel } from './panel.js';

/** What one run amounted to. Grown by the flow, read by the screens. */
export interface RunStats {
  /** Shots that left the ship. A dual fighter's two-bullet spread is one shot. */
  readonly shotsFired: number;
  /** Shots that connected, including the first hit on a two-hit target. */
  readonly hits: number;
  /** Targets destroyed. Not the same as hits: a Warden takes two. */
  readonly destroyed: number;
  readonly score: number;
  /** Highest stage reached. */
  readonly stage: number;
  /**
   * Extra lives awarded during the run.
   *
   * Seam: the extra-life rule itself is a sibling's task. The sim already raises
   * `extra-life`, so this counts them and the screens can show them without
   * anything here knowing the thresholds.
   */
  readonly extraLives: number;
}

export const EMPTY_STATS: RunStats = Object.freeze({
  shotsFired: 0,
  hits: 0,
  destroyed: 0,
  score: 0,
  stage: 0,
  extraLives: 0,
});

/**
 * Fold one step's events into the running totals.
 *
 * Pure, and returns a new value rather than mutating, so a test can hand it a
 * list of events and read the answer.
 */
export function countEvents(stats: RunStats, events: readonly SimEvent[]): RunStats {
  let { shotsFired, hits, destroyed, score, stage, extraLives } = stats;

  for (const event of events) {
    switch (event.type) {
      case 'shot-fired':
        shotsFired += 1;
        break;
      case 'target-hit':
        hits += 1;
        break;
      case 'target-destroyed':
        hits += 1;
        destroyed += 1;
        break;
      case 'score-changed':
        score = event.score;
        break;
      case 'stage-started':
        stage = Math.max(stage, event.stage);
        break;
      case 'extra-life':
        extraLives += 1;
        break;
      default:
        break;
    }
  }

  return { shotsFired, hits, destroyed, score, stage, extraLives };
}

/** Hits per shot, 0..1. A run that never fired is 0, not a division by zero. */
export function hitRatio(stats: Pick<RunStats, 'shotsFired' | 'hits'>): number {
  if (stats.shotsFired <= 0) return 0;
  return stats.hits / stats.shotsFired;
}

/**
 * One decimal place, as the original's results screen shows: `36.5%`.
 *
 * Truncated rather than rounded, so a run that missed once never reads 100.0%.
 * The epsilon is there because `hits / shots * 1000` lands a few parts in 10^13
 * either side of a whole number — without it, 999 hits from 1,000 shots floors
 * to 99.8%.
 */
export function formatHitRatio(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, ratio));
  const tenths = Math.floor(clamped * 1000 + 1e-9) / 10;
  return `${tenths.toFixed(1)}%`;
}

/** A labelled row on the results screen. */
export interface ResultRow {
  readonly label: string;
  readonly value: string;
  readonly colour?: string;
}

/**
 * The rows every run shows.
 *
 * Seam: challenge-stage results (enemies hit, group bonuses, the perfect bonus)
 * are a sibling's task. That work appends its rows to this list rather than
 * editing the screen — {@link drawResults} draws whatever rows it is given.
 */
export function resultRows(stats: RunStats): ResultRow[] {
  return [
    { label: 'SHOTS FIRED', value: String(stats.shotsFired) },
    { label: 'HITS', value: String(stats.hits) },
    { label: 'HIT RATIO', value: formatHitRatio(hitRatio(stats)), colour: '#ffd400' },
  ];
}

const HEADING_COLOUR = '#ff2b2b';
const LABEL_COLOUR = '#ffffff';
const VALUE_COLOUR = '#00d8ff';

/** Row pitch, in logical pixels. */
const ROW_PITCH = 12;
/** Width of the label/value block, in logical pixels. */
const BLOCK_WIDTH = 176;
/** The plate the block sits on. Wider than the block, by a margin each side. */
const CARD_WIDTH = BLOCK_WIDTH + 16;

export interface ResultsOptions {
  readonly stats: RunStats;
  /** Rows to draw. Defaults to {@link resultRows}. */
  readonly rows?: readonly ResultRow[];
  readonly heading?: string;
  /** Top of the card. Defaults to the clear band under the formation. */
  readonly y?: number;
}

/**
 * Draw the results screen over whatever is already on the backbuffer.
 *
 * The card grows with the rows it is given, so the challenge-stage rows a
 * sibling adds need no second layout.
 */
export function drawResults(ctx: CanvasRenderingContext2D, options: ResultsOptions): void {
  const { stats, rows = resultRows(stats), heading = 'RESULTS', y = CARD_TOP } = options;
  const centre = LOGICAL_WIDTH / 2;
  const left = Math.round(centre - BLOCK_WIDTH / 2);
  const right = left + BLOCK_WIDTH;

  const footerY = y + 24 + rows.length * ROW_PITCH + 10;
  drawCentredPanel(ctx, centre, y - 6, CARD_WIDTH, footerY + 14 - y);

  drawText(ctx, heading, centre, y + 4, { colour: HEADING_COLOUR, align: 'center' });

  rows.forEach((row, index) => {
    const rowY = y + 24 + index * ROW_PITCH;
    drawText(ctx, row.label, left, rowY, { colour: LABEL_COLOUR });
    drawText(ctx, row.value, right, rowY, { colour: row.colour ?? VALUE_COLOUR, align: 'right' });
  });

  drawText(ctx, `STAGE ${String(stats.stage)}   SCORE ${String(stats.score)}`, centre, footerY, {
    colour: '#b9c9ff',
    align: 'center',
  });
}

/** Blink period of the game-over banner, in simulation steps. */
export const BANNER_BLINK_STEPS = 24;

/**
 * The GAME OVER banner, blinking as the cabinet's does.
 *
 * `steps` is the flow's step counter — simulation steps, not the wall clock, so
 * the same screen at the same step looks the same every run.
 */
export function drawGameOver(ctx: CanvasRenderingContext2D, steps: number): void {
  if (Math.floor(steps / BANNER_BLINK_STEPS) % 2 !== 0) return;
  const text = 'GAME OVER';
  const centre = LOGICAL_WIDTH / 2;
  const y = CARD_TOP + 24;

  drawCentredPanel(ctx, centre, y - 6, measureText(text) + 16, 20);
  drawText(ctx, text, centre, y, { colour: HEADING_COLOUR, align: 'center' });
}
