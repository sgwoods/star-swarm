/**
 * The scrolling starfield (docs/DESIGN.md sections 4 and 9).
 *
 * Presentation, not simulation: nothing the starfield does can change the
 * outcome of a step, so it lives here and reacts to simulation events rather
 * than being driven by them. The sim hands over one number — the hardware speed
 * register shadow — and this file decides what that looks like.
 *
 * **The speed is a function of the stage.** The ROM computes
 * `$40 + ((min(stage, 16) × 4) AND $70)` at the start of every stage, giving
 * five discrete values that step every four stages and plateau from stage 16.
 * That formula is verified and lives in the pack's `rules.json`, read through
 * `src/content/rules.ts`.
 *
 * **The conversion from that byte to pixels is the ROM's own arithmetic, not a
 * rate we chose.** `f_1D76` ramps a _current_ byte toward the stage's target one
 * unit per frame, adds it into a 6-bit phase accumulator and scrolls the
 * accumulator's overflow, which the 05XX's measured scroll table makes equal to
 * whole pixels. That is the whole of {@link advance}: the divisor is 64 because
 * the accumulator is six bits wide, so `byte / 64` is a consequence rather than a
 * constant, and the five bytes give 1.00, 1.25, 1.50, 1.75 and 2.00 px/frame —
 * dithered to whole pixels, 1,1,1,2 at 1.25 (`docs/reference/arcade-reference.md`
 * section 2, verified).
 *
 * **The dithering is the mechanism and not a rounding detail.** A float scroll
 * averaging 1.25 px/frame draws stars at fractional positions; the original never
 * does, and the stutter of three short frames and one long one is what the field
 * looks like at every rate but 1.00 and 2.00.
 *
 * Three more behaviours come out of the same routine, all verified:
 *
 * - the **ramp** above, so a stage that changes the byte eases into the new rate
 *   over as many frames as the byte moved units rather than jumping;
 * - a **reverse** at {@link REVERSE_PIXELS_PER_FRAME} px/frame while a tractor
 *   beam is out, which arrives here as `capture-started` and ends on
 *   `capture-failed` or `player-captured` — the renderer is told, it never reads
 *   the capture channel;
 * - the **twinkle**, which is not a per-star blink at all: `$A003`/`$A004` select
 *   which pair of the chip's four star banks is drawn, from bits 3 and 4 of the
 *   frame counter, so half the field swaps out every {@link TWINKLE_FRAMES}
 *   frames.
 *
 * The field also **pauses** during certain transitions, which is why `paused` is
 * separate from the speed rather than a rate of zero.
 */

import type { Rng } from '../engine/rng.js';
import type { SimEvent } from '../sim/events.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from './canvas.js';

/**
 * The 6-bit phase accumulator's modulus, and so the byte-to-pixels divisor.
 *
 * Verified: the ROM adds the speed byte into a six-bit accumulator each frame and
 * scrolls the overflow, which is why the rate is `byte / 64` and why a byte that
 * is not a multiple of 64 dithers instead of moving a fraction of a pixel.
 */
export const SPEED_BYTE_UNIT = 64;

/** Lowest speed byte the ROM's per-stage formula can produce (`$40`). */
const SPEED_BYTE_MIN = 0x40;
/** Highest speed byte the ROM's per-stage formula can produce (`$80`). */
const SPEED_BYTE_MAX = 0x80;

/**
 * Average pixels per frame for the five per-stage bytes `$40 $50 $60 $70 $80`.
 *
 * Derived from {@link SPEED_BYTE_UNIT} rather than written down, so the five
 * numbers cannot drift from the arithmetic that produces them.
 */
export const STAGE_SPEEDS: readonly number[] = Object.freeze(
  [0x40, 0x50, 0x60, 0x70, 0x80].map((byte) => byte / SPEED_BYTE_UNIT),
);

/**
 * Pixels per frame the field runs **backwards** while a tractor beam is out.
 *
 * Verified, and a whole number, so it needs no accumulator: the ROM writes the
 * reverse code straight to the chip.
 */
export const REVERSE_PIXELS_PER_FRAME = 3;

/** Star banks the 05XX holds. A pair of them is drawn at any moment. */
export const STAR_BANKS = 4;

/**
 * The faster of the two frame-counter bits that select the visible pair.
 *
 * Verified as bit 3, with bit 4 giving the other half of the pair — which is why
 * the cycle is four pairs long rather than two, and why the field changes twice
 * as often as it repeats.
 */
const TWINKLE_BIT = 3;

/**
 * Frames each visible bank pair is held for: 8, because the selector is bit 3.
 * Derived from {@link TWINKLE_BIT} so the period cannot drift from the bit.
 */
export const TWINKLE_FRAMES = 2 ** TWINKLE_BIT;

/**
 * Convert a speed byte to its average scroll rate in pixels per frame.
 *
 * The **average**: what a frame actually moves is a whole number of pixels, and
 * {@link Starfield.lastStep} is that. A byte from outside the ROM's range is
 * clamped rather than turned into nonsense.
 */
export function speedForByte(byte: number): number {
  const clamped = Math.min(Math.max(byte, SPEED_BYTE_MIN), SPEED_BYTE_MAX);
  return clamped / SPEED_BYTE_UNIT;
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
  /** Whole pixels, always: the field scrolls by integers. */
  x: number;
  y: number;
  /** Index into {@link STAR_COLORS}. */
  readonly color: number;
  /**
   * Which of the chip's {@link STAR_BANKS} banks this star is in.
   *
   * Banks `0`/`1` are the pair one selector bit chooses between and `2`/`3` the
   * other, so exactly half the field is lit at any moment. Which bank number
   * belongs to which selector is our labelling; that there are four and a pair is
   * drawn is the verified part.
   */
  readonly bank: number;
}

export interface StarfieldOptions {
  readonly count?: number;
  readonly width?: number;
  readonly height?: number;
}

/**
 * How many stars a field holds when nobody says.
 *
 * **Twice what it was, so that the screen looks the same.** Only a pair of banks
 * is ever drawn, so half a field is lit at any moment; keeping the old 64 would
 * have halved the visible density as a side effect of the twinkle rather than as
 * a decision. 64 lit out of 128 is what was on screen before. Ours either way —
 * the reference settles the twinkle, not how many stars we draw, and for the
 * record the 05XX's own table is about twice as dense again.
 */
export const DEFAULT_STAR_COUNT = 128;

/**
 * Lay out a field. Seeded from `src/engine/rng.ts` rather than `Math.random`,
 * so a screenshot of stage 1 is the same screenshot every time — which is what
 * makes a visual diff in a PR mean something.
 */
export function createStars(rng: Rng, options: StarfieldOptions = {}): Star[] {
  const { count = DEFAULT_STAR_COUNT, width = LOGICAL_WIDTH, height = LOGICAL_HEIGHT } = options;

  return Array.from({ length: count }, () => ({
    x: rng.int(0, width),
    y: rng.int(0, height),
    color: rng.int(0, STAR_COLORS.length),
    bank: rng.int(0, STAR_BANKS),
  }));
}

/**
 * Bit `n` of the frame counter, as 0 or 1.
 *
 * Arithmetic rather than `>>`, which would wrap at 2^31 — reachable at 60 Hz, if
 * only after a year of uptime.
 */
function frameBit(frame: number, n: number): number {
  return Math.floor(Math.max(frame, 0) / 2 ** n) % 2;
}

/**
 * Which pair of banks is lit on a frame.
 *
 * One bit picks between banks 0 and 1 and the other between 2 and 3, so the pair
 * is always one from each half and the field never goes dark. The faster bit
 * turns over every {@link TWINKLE_FRAMES} frames.
 */
export function visibleBanks(frame: number): readonly [number, number] {
  return [frameBit(frame, TWINKLE_BIT), 2 + frameBit(frame, TWINKLE_BIT + 1)];
}

/** Is this star currently lit? Exactly the stars in the two visible banks are. */
export function starIsLit(star: Star, frame: number): boolean {
  const [a, b] = visibleBanks(frame);
  return star.bank === a || star.bank === b;
}

/**
 * Scroll the field by a whole number of pixels, positive down the screen.
 *
 * Whole pixels on purpose — see the note at the top of this file. `0` pauses,
 * which is what a transition does, and a negative count is the tractor beam's
 * reverse.
 */
export function advanceStars(stars: Star[], pixels: number, height = LOGICAL_HEIGHT): void {
  if (pixels === 0) return;
  for (const star of stars) {
    // Two moduli: the first can leave a negative value, which the reverse does.
    star.y = (((star.y + pixels) % height) + height) % height;
  }
}

/** Draw the field onto the 224x288 backbuffer. `frame` picks the lit banks. */
export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  stars: readonly Star[],
  frame: number,
): void {
  const [a, b] = visibleBanks(frame);
  for (const star of stars) {
    if (star.bank !== a && star.bank !== b) continue;
    ctx.fillStyle = STAR_COLORS[star.color] ?? '#fff';
    ctx.fillRect(star.x, star.y, 1, 1);
  }
}

/** Everything the renderer needs to keep a field running. */
export interface Starfield {
  readonly stars: Star[];
  /**
   * The ROM's current speed byte — the register shadow, not the stage's target.
   * It ramps toward {@link targetByte} one unit per frame.
   */
  readonly speedByte: number;
  /** The byte the stage asked for. {@link speedByte} is on its way here. */
  readonly targetByte: number;
  /** Average pixels per frame the current byte gives; see {@link speedForByte}. */
  readonly speed: number;
  /** Whole pixels the last {@link advance} moved the field. Negative reversing. */
  readonly lastStep: number;
  /** Frames advanced, which is what drives the twinkle. */
  readonly frame: number;
  /** Set the stage's target from a sim `stage-started` event. */
  setSpeedByte: (byte: number) => void;
  /** Stop and start the scroll, for transitions. */
  paused: boolean;
  /** A tractor beam is out: the field runs backwards while it is. */
  reversing: boolean;
  /**
   * React to a step's events. The only way the field learns anything: it reads
   * no simulation state, which is what keeps `src/sim/` free of a subscriber.
   */
  handle: (events: readonly SimEvent[]) => void;
  advance: () => void;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

export function createStarfield(rng: Rng, options: StarfieldOptions = {}): Starfield {
  const stars = createStars(rng, options);
  const height = options.height ?? LOGICAL_HEIGHT;

  let speedByte = SPEED_BYTE_MIN;
  let targetByte = SPEED_BYTE_MIN;
  /** The 6-bit phase accumulator. Its overflow is the pixels to scroll. */
  let accumulator = 0;
  let lastStep = 0;
  let frame = 0;

  const field: Starfield = {
    stars,
    get speedByte(): number {
      return speedByte;
    },
    get targetByte(): number {
      return targetByte;
    },
    get speed(): number {
      return speedForByte(speedByte);
    },
    get lastStep(): number {
      return lastStep;
    },
    get frame(): number {
      return frame;
    },
    paused: false,
    reversing: false,
    setSpeedByte(byte: number): void {
      targetByte = Math.min(Math.max(Math.trunc(byte), SPEED_BYTE_MIN), SPEED_BYTE_MAX);
    },
    handle(events: readonly SimEvent[]): void {
      for (const event of events) {
        switch (event.type) {
          case 'stage-started':
            field.setSpeedByte(event.starfieldSpeed);
            // A new stage — including the first of a new game or a restarted
            // attract demo — is what brings the stars back after a game over.
            // No beam survives a stage boundary, so the reverse ends here too.
            field.paused = false;
            field.reversing = false;
            break;
          case 'capture-started':
            field.reversing = true;
            break;
          // Every exit from the beam is one of these two: the attempt ended with
          // the fighter untouched, or it ended with the fighter taken.
          case 'capture-failed':
          case 'player-captured':
            field.reversing = false;
            break;
          case 'game-over':
            field.paused = true;
            break;
          default:
            break;
        }
      }
    },
    advance(): void {
      // The frame counter is the hardware's and never stops, so the twinkle
      // carries on through a pause — which is what a game-over screen shows.
      frame += 1;
      // The register ramp is its own routine and runs whatever the scroll does.
      if (speedByte < targetByte) speedByte += 1;
      else if (speedByte > targetByte) speedByte -= 1;

      if (field.paused) {
        lastStep = 0;
        return;
      }
      if (field.reversing) {
        lastStep = -REVERSE_PIXELS_PER_FRAME;
      } else {
        accumulator += speedByte;
        lastStep = Math.floor(accumulator / SPEED_BYTE_UNIT);
        accumulator %= SPEED_BYTE_UNIT;
      }
      advanceStars(stars, lastStep, height);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      drawStarfield(ctx, stars, frame);
    },
  };

  return field;
}
