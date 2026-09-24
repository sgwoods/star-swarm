/**
 * Browser entry point.
 *
 * Wires the Milestone 0 pieces together and nothing more: the display, the
 * keyboard, and the fixed-step loop. There is no simulation yet — `src/sim/`
 * arrives in Milestone 1 — so `update` only samples input and `render` draws the
 * placeholder test pattern.
 */

import { createKeyboardInput, EMPTY_FRAME, type InputFrame } from './engine/input.js';
import { createLoop, STEP_HZ } from './engine/loop.js';
import { createRng } from './engine/rng.js';
import { createDisplay } from './render/canvas.js';
import { drawTestPattern } from './render/testpattern.js';

const container = document.getElementById('app');
if (container === null) throw new Error('Missing #app container');

const display = createDisplay({ container });
const input = createKeyboardInput();
input.attach(window);

// Seeded from a constant for now: every run of Milestone 0 is identical, which
// is the property Milestone 1 onwards depends on. A real run seeds from the
// start-of-game state and records the seed into the replay.
const rng = createRng('star-swarm-m0');
const starterDraw = rng.nextUint32();

let sampledInput: InputFrame = EMPTY_FRAME;
let frame = 0;
let fps = 0;
let fpsWindowStart = 0;
let fpsWindowFrames = 0;

const loop = createLoop({
  update() {
    // Exactly one input sample per simulation step (docs/DESIGN.md pillar 4).
    sampledInput = input.sample();
  },
  render() {
    frame += 1;

    // FPS is a render-side diagnostic, so reading the clock here is fine; the
    // simulation never does (see eslint.config.js).
    const now = performance.now();
    if (fpsWindowStart === 0) fpsWindowStart = now;
    fpsWindowFrames += 1;
    if (now - fpsWindowStart >= 500) {
      fps = (fpsWindowFrames * 1000) / (now - fpsWindowStart);
      fpsWindowStart = now;
      fpsWindowFrames = 0;
    }

    drawTestPattern(display.ctx, {
      step: loop.step,
      frame,
      fps,
      input: sampledInput,
      layout: display.layout,
    });
    display.present();
  },
});

loop.start();

// Handy from the devtools console, and what the Playwright smoke test reads to
// confirm the loop and the display agree about the logical size.
declare global {
  interface Window {
    starSwarm?: {
      readonly stepHz: number;
      readonly step: number;
      readonly frame: number;
      readonly seedDraw: number;
      readonly layout: ReturnType<typeof createDisplay>['layout'];
    };
  }
}

window.starSwarm = {
  stepHz: STEP_HZ,
  get step(): number {
    return loop.step;
  },
  get frame(): number {
    return frame;
  },
  seedDraw: starterDraw,
  get layout(): ReturnType<typeof createDisplay>['layout'] {
    return display.layout;
  },
};
