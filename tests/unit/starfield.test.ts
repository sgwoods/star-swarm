import { describe, expect, it } from 'vitest';

import { starfieldSpeedByte } from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { EMPTY_FRAME } from '../../src/engine/input.js';
import { createRng } from '../../src/engine/rng.js';
import { armDives } from '../../src/sim/dive.js';
import type { SimEvent } from '../../src/sim/events.js';
import { createWorld, stepWorld } from '../../src/sim/world.js';
import {
  advanceStars,
  createStarfield,
  createStars,
  DEFAULT_STAR_COUNT,
  drawStarfield,
  REVERSE_PIXELS_PER_FRAME,
  SPEED_BYTE_UNIT,
  STAGE_SPEEDS,
  STAR_BANKS,
  starIsLit,
  speedForByte,
  TWINKLE_FRAMES,
  visibleBanks,
  type Starfield,
} from '../../src/render/starfield.js';
import { classicRules, classicStages } from '../helpers/rules.js';

/**
 * The starfield — `src/render/starfield.ts`.
 *
 * **The scout report's motion acceptance tests M6, M7 and M8.** They are the
 * three the audit in #21 recorded as not built, because the field scrolled at
 * half the reference's rate with parallax layers of our own and neither the
 * inter-stage ramp, the tractor-beam reverse nor the star-bank twinkle existed.
 * Every number below comes from `docs/reference/arcade-reference.md` section 2,
 * which closes all four as **verified**, and from the restatement in
 * `docs/DESIGN.md` section 4.
 *
 * The report itself is not in this repository, so the split of four behaviours
 * across three ids is taken from the sentence in `docs/ARCHITECTURE.md` section 5
 * that named them together: **M6** the rate and the dithering that realises it,
 * including the register ramp it shares a routine with; **M7** the reverse while a
 * tractor beam is out; **M8** the twinkle. What each one asserts is the
 * reference's, whatever the numbering.
 *
 * These assert the property and not the setup, which for a starfield means two
 * habits: a rate is measured by summing the pixels the field actually moved over
 * a whole accumulator cycle rather than by reading the rate back off the field,
 * and the reverse is reached by **playing** a real capture and feeding the
 * renderer the events the simulation raised — never by setting `reversing` by
 * hand, which would prove this file's own flag.
 *
 * Node environment, no DOM.
 */

const rules = classicRules();
const stages = classicStages();

/** The speed byte the Classic pack's formula gives for a stage. */
const byteFor = (stage: number): number => starfieldSpeedByte(rules, stage);

/** A `stage-started` event carrying the byte the simulation would carry. */
const stageStarted = (stage: number): SimEvent => ({
  type: 'stage-started',
  stage,
  starfieldSpeed: byteFor(stage),
});

/**
 * A field on a stage, with the register ramp already finished.
 *
 * The ramp is M7's subject and is asserted there; everything measuring a *rate*
 * has to be past it, because a byte still climbing is not yet the stage's byte.
 */
function fieldOnStage(stage: number, options: { count?: number } = {}): Starfield {
  const field = createStarfield(createRng(`stage-${stage}`), {
    count: options.count ?? 40,
    // Tall enough that nothing wraps in the windows these tests measure, so a
    // displacement can be read straight off a star.
    height: 1_000_000,
  });
  field.handle([stageStarted(stage)]);
  // One frame per byte-unit at most, and the ramp is one unit per frame.
  for (let i = 0; i < SPEED_BYTE_UNIT * 2; i += 1) {
    if (field.speedByte === field.targetByte) break;
    field.advance();
  }
  expect(field.speedByte).toBe(byteFor(stage));
  return field;
}

/** Advance `frames` frames, returning the whole pixels moved on each. */
function stepsOver(field: Starfield, frames: number): number[] {
  return Array.from({ length: frames }, () => {
    field.advance();
    return field.lastStep;
  });
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/* -------------------------------------------------------------------------- */
/* M6 — the rate, and the dithering that realises it                          */
/* -------------------------------------------------------------------------- */

describe('M6: the scroll rate is the ROM’s byte / 64, dithered to whole pixels', () => {
  it('converts the five per-stage bytes to 1.00, 1.25, 1.50, 1.75 and 2.00 px/frame', () => {
    // The reference's closed value, and the doubling this task is: the field used
    // to run 0.50 to 1.50. Read through the pack's own formula, so a pack that
    // changed the bytes would move these with it.
    expect([1, 4, 8, 12, 16].map((stage) => speedForByte(byteFor(stage)))).toEqual([
      1, 1.25, 1.5, 1.75, 2,
    ]);
    expect([...STAGE_SPEEDS]).toEqual([1, 1.25, 1.5, 1.75, 2]);
    // The divisor is the accumulator's width, not a number anyone chose.
    expect(SPEED_BYTE_UNIT).toBe(64);
    expect(byteFor(1) / SPEED_BYTE_UNIT).toBe(1);
  });

  it('plateaus from stage 16 and is monotonic up to it', () => {
    const byStage = [1, 4, 8, 12, 16, 30].map((stage) => speedForByte(byteFor(stage)));
    expect(byStage[4]).toBe(byStage[5]);
    for (let i = 1; i < 5; i += 1) {
      expect(byStage[i] ?? 0).toBeGreaterThan(byStage[i - 1] ?? 0);
    }
  });

  it('moves exactly byte pixels every 64 frames, which is what the rate means', () => {
    // 64 frames is one whole turn of the accumulator at any byte — 64 × byte is a
    // multiple of 64 whatever the byte — so this is exact rather than approximate,
    // and it is measured from the pixels moved rather than read off the field.
    for (const [stage, expected] of [
      [1, 64],
      [4, 80],
      [8, 96],
      [12, 112],
      [16, 128],
    ] as const) {
      const field = fieldOnStage(stage);
      const before = field.stars[0]?.y ?? 0;
      const steps = stepsOver(field, 64);
      expect(sum(steps)).toBe(expected);
      // And the stars went with it, rather than the counter moving alone.
      expect((field.stars[0]?.y ?? 0) - before).toBe(expected);
    }
  });

  it('moves whole pixels only — the dither is the mechanism, not rounding', () => {
    for (const stage of [1, 4, 8, 12, 16]) {
      const field = fieldOnStage(stage);
      for (const step of stepsOver(field, 256)) {
        expect(Number.isInteger(step)).toBe(true);
      }
      for (const star of field.stars) expect(Number.isInteger(star.y)).toBe(true);
    }
  });

  it('dithers 1.25 as three short frames and one long one, never 1.25 of a pixel', () => {
    const field = fieldOnStage(4);
    const steps = stepsOver(field, 64);
    // Exactly the reference's "1,1,1,2 at 1.25": every step is a 1 or a 2, the
    // 2s are a quarter of them, and any four consecutive frames sum to 5. The
    // phase is not asserted — where in the cycle the ramp left the accumulator is
    // not a claim the reference makes.
    expect(new Set(steps)).toEqual(new Set([1, 2]));
    expect(steps.filter((step) => step === 2)).toHaveLength(16);
    for (let i = 0; i + 4 <= steps.length; i += 1) {
      expect(sum(steps.slice(i, i + 4))).toBe(5);
    }
  });

  it('runs at a flat 1 and a flat 2 at the ends, where nothing needs dithering', () => {
    expect(new Set(stepsOver(fieldOnStage(1), 64))).toEqual(new Set([1]));
    expect(new Set(stepsOver(fieldOnStage(16), 64))).toEqual(new Set([2]));
  });

  it('takes the byte from the simulation, and the simulation alone', () => {
    const field = createStarfield(createRng('wiring'), { count: 8 });
    expect(field.targetByte).toBe(byteFor(1));
    field.handle([stageStarted(16)]);
    expect(field.targetByte).toBe(byteFor(16));
    // Nothing else in an event list moves it.
    field.handle([{ type: 'stage-cleared', stage: 16 }]);
    expect(field.targetByte).toBe(byteFor(16));
  });

  it('scrolls as one sheet: every star moves the same whole pixels', () => {
    // The parallax layers this replaced gave three rates at once. The 05XX has
    // one — "Galaga only scrolls in X direction", one register, one field.
    const field = fieldOnStage(8, { count: 60 });
    const before = field.stars.map((star) => star.y);
    stepsOver(field, 40);
    const moved = field.stars.map((star, i) => star.y - (before[i] ?? 0));
    expect(new Set(moved).size).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* M7 — the ramp, and the reverse while a tractor beam is out                 */
/* -------------------------------------------------------------------------- */

describe('M7: the register ramps one unit per frame between stages', () => {
  it('eases from stage 1 to stage 16 over exactly 64 frames, one unit each', () => {
    const field = createStarfield(createRng('ramp'), { count: 8 });
    field.handle([stageStarted(16)]);
    const from = byteFor(1);
    const to = byteFor(16);
    expect(to - from).toBe(64);

    const seen: number[] = [];
    for (let i = 0; i < 64; i += 1) {
      field.advance();
      seen.push(field.speedByte);
    }
    // One unit per frame, and there on the 64th — not the 63rd, not the 65th.
    expect(seen).toEqual(Array.from({ length: 64 }, (_, i) => from + i + 1));
    expect(field.speedByte).toBe(to);
    field.advance();
    expect(field.speedByte).toBe(to);
  });

  it('ramps down again, and the rate passes through the values between', () => {
    const field = fieldOnStage(16);
    field.handle([stageStarted(1)]);
    const rates: number[] = [];
    for (let i = 0; i < 64; i += 1) {
      field.advance();
      rates.push(field.speed);
    }
    expect(field.speedByte).toBe(byteFor(1));
    expect(rates[0]).toBeLessThan(2);
    expect(rates[0]).toBeGreaterThan(1);
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i] ?? 0).toBeLessThan(rates[i - 1] ?? 0);
    }
  });

  it('does not ramp at all across stages that share a byte', () => {
    // Stages 1, 2 and 3 are all $40, so there is nothing to ease into and the
    // rate must not wobble. A ramp keyed to the stage number rather than the byte
    // would fail here.
    const field = fieldOnStage(1);
    for (const stage of [2, 3]) {
      field.handle([stageStarted(stage)]);
      expect(field.speedByte).toBe(byteFor(1));
      expect(new Set(stepsOver(field, 32))).toEqual(new Set([1]));
    }
  });
});

describe('M7: the field reverses at 3 px/frame while a tractor beam is out', () => {
  /**
   * The shipped rules with nothing shooting back and a deep reserve, on the stage
   * `tests/unit/capture.test.ts` uses for the same reason: stage 20's row launches
   * captors often and gives the beam a 3-frame step period, so a whole attempt
   * fits inside a test.
   */
  function beamRules(): Rules {
    return {
      ...rules,
      lives: { ...rules.lives, default: 400 },
      enemies: { ...rules.enemies, maxBullets: 0, collision: { enabled: false } },
    };
  }

  /**
   * Play a real run until a beam has been out and finished, driving a real field
   * off the events each step raised — which is the only way this asserts that the
   * simulation *tells* the renderer rather than that the flag works.
   */
  function playedBeam(): {
    readonly reversingOn: readonly number[];
    readonly beamFrames: readonly number[];
    readonly steps: readonly number[];
  } {
    const world = createWorld({ seed: 'beam-stars', rules: beamRules(), stages, stage: 20 });
    for (const enemy of world.fleet.enemies) {
      enemy.state = 'home';
      enemy.pathFrame = 0;
    }
    world.fleet.entryComplete = true;
    if (world.formation !== undefined) {
      world.formation.entryComplete = true;
      world.formation.motion = 'breathe';
    }
    armDives(world.dive);

    const field = createStarfield(createRng('beam-stars'), { count: 24, height: 1_000_000 });
    field.handle([stageStarted(20)]);
    const reversingOn: number[] = [];
    const beamFrames: number[] = [];
    const steps: number[] = [];
    let beamOut = false;
    let seenBeam = false;

    for (let frame = 0; frame < 6_000; frame += 1) {
      const events = stepWorld(world, EMPTY_FRAME);
      // An independent oracle, walked in the same order the renderer walks the
      // list: "is a beam out?" worked out from the events here rather than read
      // back off the field, which is the whole point of the comparison below.
      for (const event of events) {
        if (event.type === 'capture-started') {
          beamOut = true;
          seenBeam = true;
        } else if (
          event.type === 'capture-failed' ||
          event.type === 'player-captured' ||
          event.type === 'stage-started'
        ) {
          beamOut = false;
        }
      }
      field.handle(events);
      if (beamOut) beamFrames.push(frame);
      field.advance();
      if (field.reversing) reversingOn.push(frame);
      steps.push(field.lastStep);
      // Stop a couple of frames after the first attempt resolves, so the window
      // measured is one beam's and not a stage's worth of them.
      if (seenBeam && !beamOut && reversingOn.length > 0 && frame > (reversingOn.at(-1) ?? 0) + 2) {
        break;
      }
    }

    expect(seenBeam).toBe(true);
    expect(reversingOn.length).toBeGreaterThan(0);
    return { reversingOn, beamFrames, steps };
  }

  it('reverses on exactly the frames a played beam is out, and nowhere else', () => {
    const { reversingOn, beamFrames } = playedBeam();
    expect([...reversingOn]).toEqual([...beamFrames]);
  });

  it('runs backwards at exactly 3 px/frame on those frames, forwards on the rest', () => {
    const { reversingOn, steps } = playedBeam();
    const reversed = new Set(reversingOn);
    steps.forEach((step, frame) => {
      if (reversed.has(frame)) expect(step).toBe(-REVERSE_PIXELS_PER_FRAME);
      else expect(step).toBeGreaterThan(0);
    });
    expect(REVERSE_PIXELS_PER_FRAME).toBe(3);
  });

  it('reverses at the same 3 px/frame whatever the stage rate is', () => {
    // A reverse scaled by the stage byte would be 3 at one end and 6 at the other.
    for (const stage of [1, 16]) {
      const field = fieldOnStage(stage);
      const before = field.stars[0]?.y ?? 0;
      field.handle([{ type: 'capture-started', targetId: 1, x: 0, y: 0 }]);
      expect(new Set(stepsOver(field, 10))).toEqual(new Set([-3]));
      expect((field.stars[0]?.y ?? 0) - before).toBe(-30);
    }
  });

  it('goes forward again when the beam retracts, and when it takes the fighter', () => {
    for (const ended of [
      { type: 'capture-failed', targetId: -1 },
      { type: 'player-captured', x: 0, y: 0, livesRemaining: 2 },
    ] as const satisfies readonly SimEvent[]) {
      const field = fieldOnStage(1);
      field.handle([{ type: 'capture-started', targetId: 1, x: 0, y: 0 }]);
      expect(stepsOver(field, 4)).toEqual([-3, -3, -3, -3]);
      field.handle([ended]);
      expect(field.reversing).toBe(false);
      expect(new Set(stepsOver(field, 4))).toEqual(new Set([1]));
    }
  });

  it('keeps the accumulator across a reverse, so the rate is unchanged either side', () => {
    // The dither remainder is the ROM's register and a beam does not clear it: 64
    // forward frames at $50 are 80 pixels whether or not a reverse interrupted
    // them. Restarting the accumulator would lose up to a pixel each time.
    const field = fieldOnStage(4);
    const forward: number[] = [];
    for (let i = 0; i < 32; i += 1) {
      field.advance();
      forward.push(field.lastStep);
    }
    field.handle([{ type: 'capture-started', targetId: 1, x: 0, y: 0 }]);
    stepsOver(field, 17);
    field.handle([{ type: 'capture-failed', targetId: -1 }]);
    for (let i = 0; i < 32; i += 1) {
      field.advance();
      forward.push(field.lastStep);
    }
    expect(sum(forward)).toBe(80);
  });

  it('is beaten by a pause, and a stage start ends it', () => {
    const field = fieldOnStage(1);
    field.handle([{ type: 'capture-started', targetId: 1, x: 0, y: 0 }]);
    field.paused = true;
    expect(new Set(stepsOver(field, 5))).toEqual(new Set([0]));

    field.handle([stageStarted(1)]);
    expect(field.reversing).toBe(false);
    expect(field.paused).toBe(false);
    expect(new Set(stepsOver(field, 5))).toEqual(new Set([1]));
  });

  it('ignores an attempt ending that no beam started', () => {
    // `capture-failed` is also raised when a captor dies before its beam is out.
    const field = fieldOnStage(1);
    field.handle([{ type: 'capture-failed', targetId: 7 }]);
    expect(field.reversing).toBe(false);
    expect(new Set(stepsOver(field, 8))).toEqual(new Set([1]));
  });
});

/* -------------------------------------------------------------------------- */
/* M8 — the twinkle                                                           */
/* -------------------------------------------------------------------------- */

describe('M8: the twinkle swaps which pair of four star banks is drawn', () => {
  it('lays stars into four banks', () => {
    const stars = createStars(createRng('banks'), { count: 400 });
    expect(new Set(stars.map((star) => star.bank))).toEqual(new Set([0, 1, 2, 3]));
    expect(STAR_BANKS).toBe(4);
  });

  it('lights exactly two of the four banks on any frame', () => {
    for (let frame = 0; frame < 200; frame += 1) {
      const [a, b] = visibleBanks(frame);
      expect(new Set([a, b]).size).toBe(2);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(STAR_BANKS);
    }
  });

  it('holds a pair for 8 frames and then changes it', () => {
    expect(TWINKLE_FRAMES).toBe(8);
    for (let frame = 0; frame < 256; frame += 1) {
      const block = frame - (frame % TWINKLE_FRAMES);
      // Constant inside a block...
      expect(visibleBanks(frame)).toEqual(visibleBanks(block));
      // ...and different from the block before it, so the field visibly changes
      // every 8 frames rather than every 16.
      if (block > 0) {
        expect(visibleBanks(block)).not.toEqual(visibleBanks(block - TWINKLE_FRAMES));
      }
    }
  });

  it('cycles through four distinct pairs and repeats every 32 frames', () => {
    const cycle = TWINKLE_FRAMES * 2 * 2;
    const pairs = Array.from({ length: cycle / TWINKLE_FRAMES }, (_, i) =>
      visibleBanks(i * TWINKLE_FRAMES).join(','),
    );
    expect(new Set(pairs).size).toBe(4);
    for (let frame = 0; frame < 200; frame += 1) {
      expect(visibleBanks(frame)).toEqual(visibleBanks(frame + cycle));
    }
  });

  it('lights every star for exactly half the cycle, and none for ever or never', () => {
    // Each bank is in two of the four pairs, so each star is lit 16 frames in 32.
    // A star that was always lit would not twinkle; one that was never lit would
    // be a hole in the field.
    const stars = createStars(createRng('lit'), { count: 200 });
    for (const star of stars) {
      let lit = 0;
      for (let frame = 0; frame < 32; frame += 1) if (starIsLit(star, frame)) lit += 1;
      expect(lit).toBe(16);
    }
  });

  it('holds twice as many stars as it lights, so the screen is no emptier', () => {
    // Drawing a pair of four banks lights half a field, so the default doubled
    // with the twinkle: 64 lit out of 128 is the density that was on screen when
    // all 64 were drawn. Exact rather than sampled — every star is lit for half
    // of the 32-frame cycle, so the mean over one cycle is half the field.
    const stars = createStars(createRng('density'));
    expect(stars).toHaveLength(DEFAULT_STAR_COUNT);
    let litFrames = 0;
    for (let frame = 0; frame < 32; frame += 1) {
      litFrames += stars.filter((star) => starIsLit(star, frame)).length;
    }
    expect(litFrames / 32).toBe(DEFAULT_STAR_COUNT / 2);
  });

  it('never leaves the field dark', () => {
    const stars = createStars(createRng('dark'), { count: 200 });
    for (let frame = 0; frame < 64; frame += 1) {
      expect(stars.filter((star) => starIsLit(star, frame)).length).toBeGreaterThan(0);
    }
  });

  it('draws exactly the lit stars, and at whole pixels', () => {
    const fills: number[][] = [];
    const ctx = {
      fillStyle: '',
      fillRect(...args: number[]) {
        fills.push(args);
      },
    } as unknown as CanvasRenderingContext2D;

    const stars = Array.from({ length: STAR_BANKS }, (_, bank) => ({
      x: 10 + bank,
      y: 20 + bank,
      color: 0,
      bank,
    }));
    drawStarfield(ctx, stars, 0);
    const [a, b] = visibleBanks(0);
    expect(fills).toEqual([
      [10 + a, 20 + a, 1, 1],
      [10 + b, 20 + b, 1, 1],
    ]);

    fills.length = 0;
    drawStarfield(ctx, stars, TWINKLE_FRAMES);
    const [c, d] = visibleBanks(TWINKLE_FRAMES);
    expect(fills).toEqual([
      [10 + c, 20 + c, 1, 1],
      [10 + d, 20 + d, 1, 1],
    ]);
  });

  it('runs off a frame counter the scroll cannot stop', () => {
    // The hardware counter is not the scroll register: a paused field still
    // twinkles, which is what a game-over screen shows.
    const field = createStarfield(createRng('twinkle'), { count: 8 });
    field.paused = true;
    const before = visibleBanks(field.frame);
    for (let i = 0; i < TWINKLE_FRAMES; i += 1) field.advance();
    expect(field.lastStep).toBe(0);
    expect(visibleBanks(field.frame)).not.toEqual(before);
  });

  it('twinkles at the same 8 frames whatever the scroll rate is', () => {
    const at = (stage: number): string[] => {
      const field = fieldOnStage(stage);
      const start = field.frame;
      return Array.from({ length: 64 }, (_, i) => visibleBanks(start + i).join(','));
    };
    // Same sequence shape, not the same phase: the ramp leaves the two fields on
    // different frames, and the twinkle is a function of the frame.
    expect(new Set(at(1)).size).toBe(new Set(at(16)).size);
    expect(new Set(at(1)).size).toBe(4);
  });
});

/* -------------------------------------------------------------------------- */
/* The field itself                                                           */
/* -------------------------------------------------------------------------- */

describe('the field', () => {
  it('is laid out from a seed, so a screenshot is reproducible', () => {
    const a = createStars(createRng('stars'), { count: 20 });
    const b = createStars(createRng('stars'), { count: 20 });
    expect(a).toEqual(b);
    expect(createStars(createRng('other'), { count: 20 })).not.toEqual(a);
  });

  it('starts on whole pixels, which is all the scroll ever moves it by', () => {
    for (const star of createStars(createRng('whole'), { count: 60 })) {
      expect(Number.isInteger(star.x)).toBe(true);
      expect(Number.isInteger(star.y)).toBe(true);
    }
  });

  it('stays on screen, wrapping at the bottom', () => {
    const stars = createStars(createRng('wrap'), { count: 40, height: 288 });
    for (let frame = 0; frame < 2000; frame += 1) advanceStars(stars, 2, 288);
    for (const star of stars) {
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(288);
    }
  });

  it('wraps at the top too, which is where a reverse takes it', () => {
    const stars = createStars(createRng('wrap-up'), { count: 40, height: 288 });
    for (let frame = 0; frame < 2000; frame += 1) {
      advanceStars(stars, -REVERSE_PIXELS_PER_FRAME, 288);
    }
    for (const star of stars) {
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(288);
    }
  });

  it('pauses when the pixel count is zero — what a transition does', () => {
    const stars = createStars(createRng('pause'), { count: 10 });
    const before = stars.map((star) => star.y);
    advanceStars(stars, 0);
    expect(stars.map((star) => star.y)).toEqual(before);
  });

  it('clamps a byte from outside the ROM range rather than producing nonsense', () => {
    expect(speedForByte(0x00)).toBe(STAGE_SPEEDS[0]);
    expect(speedForByte(0xff)).toBe(STAGE_SPEEDS[STAGE_SPEEDS.length - 1]);
  });

  it('holds still while paused, and comes back on the next stage', () => {
    const field = createStarfield(createRng('field'), { count: 10 });
    field.handle([{ type: 'game-over', score: 0 }]);
    expect(field.paused).toBe(true);
    const before = field.stars.map((star) => star.y);
    for (let i = 0; i < 30; i += 1) field.advance();
    expect(field.stars.map((star) => star.y)).toEqual(before);

    field.handle([stageStarted(1)]);
    field.advance();
    expect(field.lastStep).toBe(1);
  });
});
