/**
 * Browser entry point.
 *
 * The four layers meet here and nowhere else: the fixed-step loop drives
 * `src/sim/`, and the events the sim raises are handed to `src/render/`,
 * `src/ui/` and `src/audio/`. The sim itself has no idea any of this exists — it
 * cannot import a canvas, and lint would stop it trying (see `eslint.config.js`).
 */

import { bundledPackSource } from './content/bundle.js';
import { createRegistry, createStageSource, loadPackOrThrow } from './content/index.js';
import { createKeyboardInput, type InputFrame } from './engine/input.js';
import { createLoop, STEP_HZ } from './engine/loop.js';
import { createRng } from './engine/rng.js';
import { createSfx, createSynth } from './audio/index.js';
import { createDisplay, LOGICAL_HEIGHT, LOGICAL_WIDTH } from './render/canvas.js';
import { drawScene } from './render/scene.js';
import { createSpriteSheet } from './render/sprites.js';
import { createStarfield } from './render/starfield.js';
import type { SimEvent } from './sim/events.js';
import { createWorld, stepWorld } from './sim/world.js';
import { drawHud } from './ui/hud.js';

const container = document.getElementById('app');
if (container === null) throw new Error('Missing #app container');

const display = createDisplay({ container });
const input = createKeyboardInput();
input.attach(window);

// The rules and the content the simulation runs on come from a pack, through the
// same loader the pack-validation gate runs, so the game and the gate cannot
// disagree. The pack is bundled rather than fetched, and it is `loadPack` that
// turns the JSON into values the sim will accept — nothing hands the simulation
// raw data.
//
// `bundledPackSource` globs the whole pack directory rather than naming the files
// this once listed: a manifest that references a sound, a path or a sprite has to
// be loaded *with* them, or the loader's reference pass rejects it and the game
// will not boot. See `src/content/bundle.ts`.
const classicSource = bundledPackSource('classic');
if (classicSource === undefined) throw new Error('the classic pack is not bundled');
const pack = loadPackOrThrow(classicSource);
const rules = pack.rules;
if (rules === undefined) throw new Error('the bundled classic pack has no rules.json');
const registry = createRegistry([pack]);

// Seeded from a constant so a session is reproducible and a recorded replay
// means something. A real game seeds from the start-of-game state and records
// the seed alongside the input log (`src/engine/replay.ts`).
const SEED = 'star-swarm-m2';
const world = createWorld({ seed: SEED, rules, stages: createStageSource(registry) });

// Everything derived from pack data is built once, here, and never per frame:
// the sheet rasterises every sprite frame up front (`src/render/README.md`).
const sprites = createSpriteSheet({
  sprites: registry.sprites.values(),
  palette: registry.manifest.palette,
});

// The starfield gets its own generator: it is presentation, and pulling draws
// from the simulation's stream would make what the sim computes depend on how
// many stars happen to be on screen.
const starfield = createStarfield(createRng(`${SEED}:stars`));

// Audio subscribes to the same events the renderer does and never calls back in.
// No `AudioContext` exists until a user gesture unlocks one, and every call into
// Web Audio is wrapped, so a browser that blocks audio leaves the game running in
// silence. Which sound each event plays is the pack's `sounds` map, not a name in
// this file.
const synth = createSynth();
const sfx = createSfx({
  player: synth,
  sounds: registry.sounds,
  bindings: registry.manifest.sounds,
});

function unlockAudio(): void {
  synth.unlock();
}
for (const gesture of ['keydown', 'pointerdown'] as const) {
  window.addEventListener(gesture, unlockAudio, { once: true, passive: true });
}

let highScore = 0;

/** Render, UI and audio subscribe to the sim; they never call back into it. */
function applyEvents(events: readonly SimEvent[]): void {
  sfx.handle(events);
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
    drawScene(ctx, world, { sheet: sprites });
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
      /** Enemies still alive, and how many of them have reached their slot. */
      readonly enemiesAlive: number;
      readonly enemiesHome: number;
      /** Which motion the formation is running: sway, breathe or still. */
      readonly formationMotion: string;
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
  get enemiesAlive(): number {
    return world.fleet.enemies.filter((enemy) => enemy.state !== 'dead').length;
  },
  get enemiesHome(): number {
    return world.fleet.enemies.filter((enemy) => enemy.state === 'home').length;
  },
  get formationMotion(): string {
    return world.formation?.motion ?? 'none';
  },
  get layout(): ReturnType<typeof createDisplay>['layout'] {
    return display.layout;
  },
};
