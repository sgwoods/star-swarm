/**
 * Browser entry point.
 *
 * The three layers meet here and nowhere else: the fixed-step loop drives
 * `src/sim/`, and the events the sim raises are handed to `src/render/` and
 * `src/ui/`. The sim itself has no idea any of this exists — it cannot import a
 * canvas, and lint would stop it trying (see `eslint.config.js`).
 */

import { createKeyboardInput, type InputFrame } from './engine/input.js';
import { createLoop, STEP_HZ } from './engine/loop.js';
import { createRng } from './engine/rng.js';
import { createDisplay, LOGICAL_HEIGHT, LOGICAL_WIDTH } from './render/canvas.js';
import { drawScene } from './render/scene.js';
import { createStarfield } from './render/starfield.js';
import type { SimEvent } from './sim/events.js';
import { createWorld, stepWorld } from './sim/world.js';
import { drawHud } from './ui/hud.js';

const container = document.getElementById('app');
if (container === null) throw new Error('Missing #app container');

const display = createDisplay({ container });
const input = createKeyboardInput();
input.attach(window);

// Seeded from a constant so a session is reproducible and a recorded replay
// means something. A real game seeds from the start-of-game state and records
// the seed alongside the input log (`src/engine/replay.ts`).
const SEED = 'star-swarm-m1';
const world = createWorld({ seed: SEED });

// The starfield gets its own generator: it is presentation, and pulling draws
// from the simulation's stream would make what the sim computes depend on how
// many stars happen to be on screen.
const starfield = createStarfield(createRng(`${SEED}:stars`));

let highScore = 0;

/** Render and UI subscribe to the sim; they never call back into it. */
function applyEvents(events: readonly SimEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case 'stage-started':
        starfield.setSpeedByte(event.starfieldSpeed);
        break;
      case 'score-changed':
        if (event.score > highScore) highScore = event.score;
        break;
      case 'game-over':
        starfield.paused = true;
        break;
      default:
        break;
    }
  }
}

applyEvents(world.events);

const loop = createLoop({
  update() {
    // Exactly one input sample per simulation step (docs/DESIGN.md pillar 4).
    const frame: InputFrame = input.sample();
    applyEvents(stepWorld(world, frame));
  },
  render() {
    starfield.advance();

    const { ctx } = display;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    starfield.draw(ctx);
    drawScene(ctx, world);
    drawHud(ctx, {
      score: world.score,
      highScore,
      lives: world.lives.reserve,
      stage: world.stage,
      gameOver: world.status === 'game-over',
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
      readonly score: number;
      readonly stage: number;
      readonly lives: number;
      readonly playerX: number;
      readonly layout: ReturnType<typeof createDisplay>['layout'];
    };
  }
}

window.starSwarm = {
  stepHz: STEP_HZ,
  get step(): number {
    return world.step;
  },
  get score(): number {
    return world.score;
  },
  get stage(): number {
    return world.stage;
  },
  get lives(): number {
    return world.lives.reserve;
  },
  get playerX(): number {
    return world.player.x;
  },
  get layout(): ReturnType<typeof createDisplay>['layout'] {
    return display.layout;
  },
};
