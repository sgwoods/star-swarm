/**
 * The scrolling starfield (docs/DESIGN.md sections 4 and 9).
 *
 * Presentation, not simulation: nothing the starfield does can change the
 * outcome of a step, so it lives here and reacts to the sim's `stage-started`
 * event rather than being driven by it. The sim hands over one number — the
 * hardware speed register shadow — and this file decides what that looks like.
 *
 * **The speed is a function of the stage.** The ROM computes
 * `$40 + ((min(stage, 16) × 4) AND $70)` at the start of every stage, giving
 * five discrete values that step every four stages and plateau from stage 16.
 * That formula is verified and lives in the pack's `rules.json`, read through
 * `src/content/rules.ts`.
 *
 * **The conversion from the byte to a visible pixel rate is now verified too, and
 * {@link SPEED_TIERS} is not it.** A second pass traced the write path into the
 * Namco 05XX generator's 3-bit scroll fields and closed what was unresolved item
 * 4: the rate is `byte / 64`, so the five bytes are 1.00, 1.25, 1.50, 1.75 and
 * 2.00 px/frame, dithered to whole pixels each frame
 * (`docs/reference/arcade-reference.md` section 2). The tiers below are half that
 * and have parallax layers of their own, and the same routine's ramp between
 * stages, its 3 px/frame reverse under a tractor beam and its star-bank twinkle
 * are absent. Moving to the verified numbers doubles the visible scroll rate, so
 * it is a deliberate change to how the game looks rather than a correction to
 * make in passing; `docs/ARCHITECTURE.md` section 5 records it as not built.
 *
 * The field also **pauses** during certain transitions, which is why
 * {@link advanceStars} takes the speed each frame rather than owning it.
 */

import type { Rng } from '../engine/rng.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from './canvas.js';

/**
 * Pixels per frame for each of the five speed bytes `$40 $50 $60 $70 $80`.
 * **Ours, not the arcade's** — the verified rates are `byte / 64`, twice these.
 * See the note above.
 */
export const SPEED_TIERS: readonly number[] = Object.freeze([0.5, 0.75, 1, 1.25, 1.5]);

/** Lowest speed byte the sim can emit. */
const SPEED_BYTE_BASE = 0x40;
/** Distance between adjacent speed bytes. */
const SPEED_BYTE_STEP = 0x10;

/** Convert a sim speed byte to a scroll rate in pixels per frame. */
export function speedForByte(byte: number): number {
  const tier = Math.round((byte - SPEED_BYTE_BASE) / SPEED_BYTE_STEP);
  const clamped = Math.min(Math.max(tier, 0), SPEED_TIERS.length - 1);
  return SPEED_TIERS[clamped] ?? SPEED_TIERS[0] ?? 1;
}

/**
 * The multi-colour palette. Bright, saturated, a handful of hues — the look the
 * 05XX generator produces, drawn with our own colours (section 2).
 */
export const STAR_COLORS: readonly string[] = Object.freeze([
  '#ffffff',
  '#ff6b6b',
  '#6bd0ff',
  '#ffe066',
  '#8affc1',
  '#c69bff',
]);

export interface Star {
  x: number;
  y: number;
  /** Index into {@link STAR_COLORS}. */
  readonly color: number;
  /** Relative rate, so the field has depth instead of moving as one sheet. */
  readonly depth: number;
  /** Frames into this star's blink cycle. */
  blink: number;
  /** Length of this star's blink cycle, in frames; `0` never blinks. */
  readonly blinkPeriod: number;
}

export interface StarfieldOptions {
  readonly count?: number;
  readonly width?: number;
  readonly height?: number;
}

/**
 * Lay out a field. Seeded from `src/engine/rng.ts` rather than `Math.random`,
 * so a screenshot of stage 1 is the same screenshot every time — which is what
 * makes a visual diff in a PR mean something.
 */
export function createStars(rng: Rng, options: StarfieldOptions = {}): Star[] {
  const { count = 64, width = LOGICAL_WIDTH, height = LOGICAL_HEIGHT } = options;

  return Array.from({ length: count }, () => ({
    x: rng.int(0, width),
    y: rng.int(0, height),
    color: rng.int(0, STAR_COLORS.length),
    // Three depths, so nearer stars pull ahead of further ones.
    depth: [0.5, 0.75, 1][rng.int(0, 3)] ?? 1,
    blink: rng.int(0, 120),
    blinkPeriod: rng.chance(0.35) ? rng.int(40, 140) : 0,
  }));
}

/**
 * Scroll the field by one frame. `speed` is pixels per frame for the fastest
 * layer; pass `0` to pause, which is what a transition does.
 */
export function advanceStars(stars: Star[], speed: number, height = LOGICAL_HEIGHT): void {
  for (const star of stars) {
    star.y += speed * star.depth;
    if (star.y >= height) star.y -= height;
    if (star.blinkPeriod > 0) star.blink = (star.blink + 1) % star.blinkPeriod;
  }
}

/** Is this star currently lit? Blinking stars are dark for a third of a cycle. */
export function starIsLit(star: Star): boolean {
  if (star.blinkPeriod === 0) return true;
  return star.blink * 3 >= star.blinkPeriod;
}

/** Draw the field onto the 224x288 backbuffer. */
export function drawStarfield(ctx: CanvasRenderingContext2D, stars: readonly Star[]): void {
  for (const star of stars) {
    if (!starIsLit(star)) continue;
    ctx.fillStyle = STAR_COLORS[star.color] ?? '#fff';
    // Whole pixels: a star at x.5 would be drawn as two half-lit pixels and the
    // integer-scaled presentation would make that obvious.
    ctx.fillRect(Math.floor(star.x), Math.floor(star.y), 1, 1);
  }
}

/** Everything the renderer needs to keep a field running. */
export interface Starfield {
  readonly stars: Star[];
  /** Current scroll rate in pixels per frame. */
  speed: number;
  /** Set the rate from a sim `stage-started` event. */
  setSpeedByte: (byte: number) => void;
  /** Stop and start the scroll, for transitions. */
  paused: boolean;
  advance: () => void;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

export function createStarfield(rng: Rng, options: StarfieldOptions = {}): Starfield {
  const stars = createStars(rng, options);
  const height = options.height ?? LOGICAL_HEIGHT;

  const field: Starfield = {
    stars,
    speed: speedForByte(SPEED_BYTE_BASE),
    paused: false,
    setSpeedByte(byte: number): void {
      field.speed = speedForByte(byte);
    },
    advance(): void {
      advanceStars(stars, field.paused ? 0 : field.speed, height);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      drawStarfield(ctx, stars);
    },
  };

  return field;
}
