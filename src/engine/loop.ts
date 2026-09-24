/**
 * Fixed-step simulation loop (docs/DESIGN.md pillar 4).
 *
 * The simulation advances in whole steps of exactly 1/{@link STEP_HZ} seconds;
 * rendering is decoupled and happens once per host frame with an interpolation
 * alpha, so a slow or fast display never changes what the simulation computes.
 * Feed the same inputs and the same seed and you get the same run, which is what
 * makes the replay tests in `tests/sim/` possible.
 */

/** Simulation rate in hertz. The arcade original runs at 60 Hz. */
export const STEP_HZ = 60;

/** Milliseconds per simulation step. Derived — never write 16.67 anywhere. */
export const STEP_MS = 1000 / STEP_HZ;

/**
 * Upper bound on simulation steps drained per host frame. Without it, a long
 * stall (a backgrounded tab, a breakpoint) hands the loop a huge delta and the
 * catch-up work makes the stall worse. Past this we drop the excess time.
 */
export const MAX_STEPS_PER_FRAME = 5;

/**
 * Slack, in steps, when deciding whether a whole step has accumulated.
 *
 * A step is 1/60 s, which is not representable in binary floating point, so
 * exactly one step's worth of elapsed time can land a few parts in 10^16 short
 * and the step silently does not happen. Over a minute of play that is a handful
 * of lost steps and a run that no longer matches its replay. This tolerance is
 * ~17 picoseconds of wall clock — far below any clock the host can offer, and
 * far above the error it absorbs.
 */
const STEP_EPSILON = 1e-9;

export interface LoopCallbacks {
  /** Advance the simulation by exactly one step. Receives the step index. */
  update: (step: number) => void;
  /**
   * Draw one host frame. `alpha` is the fraction of a step left in the
   * accumulator (0..1), for interpolating positions between two sim states.
   */
  render: (alpha: number) => void;
}

export interface LoopOptions extends LoopCallbacks {
  /** Schedules the next frame; returns a handle. Defaults to rAF. */
  requestFrame?: (cb: (nowMs: number) => void) => number;
  /** Cancels a handle from `requestFrame`. Defaults to cancelAnimationFrame. */
  cancelFrame?: (handle: number) => void;
  /** Simulation rate in hertz. Defaults to {@link STEP_HZ}. */
  stepHz?: number;
  /** Steps drained per frame before excess time is dropped. */
  maxStepsPerFrame?: number;
}

export interface Loop {
  start: () => void;
  stop: () => void;
  readonly running: boolean;
  /** Simulation steps run since construction. */
  readonly step: number;
  /** Milliseconds per simulation step for this loop. */
  readonly stepMs: number;
  /**
   * Advance by a wall-clock delta without a host frame scheduler. Exposed for
   * tests and headless runs; returns how many steps were taken.
   */
  advance: (deltaMs: number) => number;
}

/**
 * Accumulator loop. `advance` is the whole algorithm; `start`/`stop` only wire
 * it to a frame scheduler.
 *
 * The accumulator counts *steps*, not milliseconds: `deltaMs * stepHz / 1000`
 * keeps the arithmetic on whole numbers for as long as possible, where
 * `deltaMs / stepMs` would divide by an inexact 16.666… every frame.
 */
export function createLoop(options: LoopOptions): Loop {
  const {
    update,
    render,
    stepHz = STEP_HZ,
    maxStepsPerFrame = MAX_STEPS_PER_FRAME,
    requestFrame = (cb) => requestAnimationFrame(cb),
    cancelFrame = (handle) => {
      cancelAnimationFrame(handle);
    },
  } = options;

  if (!Number.isFinite(stepHz) || stepHz <= 0) throw new RangeError('stepHz must be positive');
  if (maxStepsPerFrame < 1) throw new RangeError('maxStepsPerFrame must be at least 1');

  const stepMs = 1000 / stepHz;

  /** Accumulated time, measured in simulation steps. */
  let accumulator = 0;
  let step = 0;
  let running = false;
  let frameHandle: number | null = null;
  let lastNowMs: number | null = null;

  /** Alpha for interpolation, clamped: the epsilon can leave a hair below zero. */
  function alpha(): number {
    return Math.min(1, Math.max(0, accumulator));
  }

  function advance(deltaMs: number): number {
    // A negative or non-finite delta means the clock did something we cannot
    // interpret; treat it as no elapsed time rather than stepping backwards.
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      render(alpha());
      return 0;
    }

    accumulator += (deltaMs * stepHz) / 1000;

    let steps = 0;
    while (accumulator >= 1 - STEP_EPSILON && steps < maxStepsPerFrame) {
      accumulator -= 1;
      update(step);
      step += 1;
      steps += 1;
    }

    // Still behind after the cap: discard the backlog so the next frame starts
    // level instead of inheriting an ever-growing debt.
    if (accumulator >= 1) accumulator %= 1;

    render(alpha());
    return steps;
  }

  function onFrame(nowMs: number): void {
    if (!running) return;
    const deltaMs = lastNowMs === null ? stepMs : nowMs - lastNowMs;
    lastNowMs = nowMs;
    advance(deltaMs);
    frameHandle = requestFrame(onFrame);
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      lastNowMs = null;
      frameHandle = requestFrame(onFrame);
    },
    stop(): void {
      if (!running) return;
      running = false;
      if (frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }
      lastNowMs = null;
      accumulator = 0;
    },
    get running(): boolean {
      return running;
    },
    get step(): number {
      return step;
    },
    stepMs,
    advance,
  };
}
