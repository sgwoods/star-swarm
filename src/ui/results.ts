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
   * The sim raises `extra-life` when its own rule fires, so this counts them and
   * the screens show them without anything here knowing the thresholds.
   */
  readonly extraLives: number;
  /** Challenge stages finished. */
  readonly challengeStages: number;
  /** Enemies destroyed across every challenge stage, and how many flew past. */
  readonly challengeHits: number;
  readonly challengeEnemies: number;
  /** Challenge stages cleared to the last enemy. */
  readonly perfectStages: number;
  /** Everything the challenge stages paid: impact, groups and the end awards. */
  readonly challengeScore: number;
  /**
   * The challenge stage that just finished, for the between-stage screen. Absent
   * until one has, and it stays put afterwards so the card can be re-drawn.
   */
  readonly challenge: ChallengeSummary | undefined;
}

/**
 * What one challenge stage amounted to — the `challenge-ended` event's payload.
 *
 * Declared here rather than imported so the screens depend on a value shape and
 * not on the simulation's event union; {@link countEvents} is the one place the
 * two meet.
 */
export interface ChallengeSummary {
  readonly stage: number;
  readonly ordinal: number;
  readonly hits: number;
  readonly total: number;
  readonly perfect: boolean;
  readonly impactScore: number;
  readonly groupBonus: number;
  readonly endBonus: number;
}

export const EMPTY_STATS: RunStats = Object.freeze({
  shotsFired: 0,
  hits: 0,
  destroyed: 0,
  score: 0,
  stage: 0,
  extraLives: 0,
  challengeStages: 0,
  challengeHits: 0,
  challengeEnemies: 0,
  perfectStages: 0,
  challengeScore: 0,
  challenge: undefined,
});

/**
 * Fold one step's events into the running totals.
 *
 * Pure, and returns a new value rather than mutating, so a test can hand it a
 * list of events and read the answer.
 */
export function countEvents(stats: RunStats, events: readonly SimEvent[]): RunStats {
  let { shotsFired, hits, destroyed, score, stage, extraLives } = stats;
  let { challengeStages, challengeHits, challengeEnemies, perfectStages, challengeScore } = stats;
  let challenge = stats.challenge;

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
      case 'challenge-ended': {
        const { type: _type, ...summary } = event;
        challenge = summary;
        challengeStages += 1;
        challengeHits += event.hits;
        challengeEnemies += event.total;
        if (event.perfect) perfectStages += 1;
        // One place the challenge money is totalled: the impact awards and the
        // group bonuses are already in `score`, and re-deriving them from a
        // per-hit value on a screen would get the ninth challenge stage wrong.
        challengeScore += event.impactScore + event.groupBonus + event.endBonus;
        break;
      }
      default:
        break;
    }
  }

  return {
    shotsFired,
    hits,
    destroyed,
    score,
    stage,
    extraLives,
    challengeStages,
    challengeHits,
    challengeEnemies,
    perfectStages,
    challengeScore,
    challenge,
  };
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
 * The rows every run shows, plus the challenge-stage tally when the run reached
 * one.
 *
 * The challenge rows are appended rather than built into the screen —
 * {@link drawResults} draws whatever rows it is given — so a run that never saw
 * a challenge stage shows the same three rows it always did.
 */
export function resultRows(stats: RunStats): ResultRow[] {
  const rows: ResultRow[] = [
    { label: 'SHOTS FIRED', value: String(stats.shotsFired) },
    { label: 'HITS', value: String(stats.hits) },
    { label: 'HIT RATIO', value: formatHitRatio(hitRatio(stats)), colour: '#ffd400' },
  ];
  if (stats.challengeStages > 0) {
    rows.push({
      label: 'CHALLENGE HITS',
      value: `${String(stats.challengeHits)}/${String(stats.challengeEnemies)}`,
    });
    rows.push({ label: 'CHALLENGE BONUS', value: String(stats.challengeScore) });
    if (stats.perfectStages > 0) {
      rows.push({
        label: 'PERFECT STAGES',
        value: String(stats.perfectStages),
        colour: PERFECT_COLOUR,
      });
    }
  }
  return rows;
}

/**
 * The between-stage rows the original shows after a challenge stage: "NUMBER OF
 * HITS", then either "BONUS" or, for all forty, "SPECIAL BONUS".
 *
 * The bonus shown is the end-of-stage award alone, because that is the one the
 * original displays — the impact awards and the group bonuses have already
 * ticked the counter during the stage. The label changes with the branch since
 * the perfect bonus **replaces** the per-hit one rather than adding to it, and a
 * row reading "BONUS 10000" would suggest otherwise.
 */
export function challengeResultRows(summary: ChallengeSummary): ResultRow[] {
  return [
    { label: 'NUMBER OF HITS', value: `${String(summary.hits)}/${String(summary.total)}` },
    {
      label: summary.perfect ? 'SPECIAL BONUS' : 'BONUS',
      value: String(summary.endBonus),
      ...(summary.perfect && { colour: PERFECT_COLOUR }),
    },
  ];
}

/** The heading the between-stage card carries: which challenge stage it was. */
export function challengeHeading(summary: ChallengeSummary): string {
  return `CHALLENGE ${String(summary.ordinal + 1)}`;
}

const HEADING_COLOUR = '#ff2b2b';
const LABEL_COLOUR = '#ffffff';
const VALUE_COLOUR = '#00d8ff';
/** What a perfect challenge stage is picked out in. */
const PERFECT_COLOUR = '#c6ff2e';

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
  /** The line under the rows. Defaults to the run's stage and score. */
  readonly footer?: string;
  /** Top of the card. Defaults to the clear band under the formation. */
  readonly y?: number;
}

/**
 * Draw the results screen over whatever is already on the backbuffer.
 *
 * The card grows with the rows it is given, which is what lets the between-stage
 * challenge card ({@link drawChallengeResults}) share this layout rather than
 * having one of its own.
 */
export function drawResults(ctx: CanvasRenderingContext2D, options: ResultsOptions): void {
  const { stats, rows = resultRows(stats), heading = 'RESULTS', y = CARD_TOP } = options;
  const footer = options.footer ?? `STAGE ${String(stats.stage)}   SCORE ${String(stats.score)}`;
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

  drawText(ctx, footer, centre, footerY, { colour: '#b9c9ff', align: 'center' });
}

export interface ChallengeResultsOptions {
  readonly stats: RunStats;
  readonly summary: ChallengeSummary;
  /** The flow's phase step counter, which is what makes "PERFECT !" flash. */
  readonly steps: number;
  readonly y?: number;
}

/**
 * The between-stage card the original shows after a challenge stage.
 *
 * "PERFECT !" flashes above the card on the perfect branch, as the original's
 * does, on the same blink the game-over banner uses — and on **simulation
 * steps**, so the screen looks the same at the same step on any machine.
 */
export function drawChallengeResults(
  ctx: CanvasRenderingContext2D,
  options: ChallengeResultsOptions,
): void {
  const { stats, summary, steps, y = CARD_TOP } = options;
  drawResults(ctx, {
    stats,
    rows: challengeResultRows(summary),
    heading: challengeHeading(summary),
    footer: `STAGE ${String(summary.stage)}   SCORE ${String(stats.score)}`,
    y,
  });

  if (!summary.perfect) return;
  if (Math.floor(steps / BANNER_BLINK_STEPS) % 2 !== 0) return;
  const text = 'PERFECT !';
  const centre = LOGICAL_WIDTH / 2;
  const bannerY = y - 28;
  drawCentredPanel(ctx, centre, bannerY - 6, measureText(text) + 16, 20);
  drawText(ctx, text, centre, bannerY, { colour: PERFECT_COLOUR, align: 'center' });
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
