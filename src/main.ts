/**
 * Browser entry point.
 *
 * The four layers meet here and nowhere else: the fixed-step loop drives
 * `src/sim/`, and the events the sim raises are handed to `src/render/`,
 * `src/ui/` and `src/audio/`. The sim itself has no idea any of this exists — it
 * cannot import a canvas, and lint would stop it trying (see `eslint.config.js`).
 *
 * What runs each step is decided by the state machine in `src/ui/flow.ts`: this
 * file owns the display, the input device, the sprite sheet, the starfield and
 * the audio, and nothing else. Attract demo, play, the between-stage challenge
 * card, game over, results and high-score entry all arrive through one
 * `flow.step(frame)` call, which is why there are no phase flags here.
 */

import { createSfx, createSynth } from './audio/index.js';
import { bundledPackSource } from './content/bundle.js';
import { createRegistry, createStageSource, loadPackOrThrow } from './content/index.js';
import { createKeyboardInput, type InputFrame } from './engine/input.js';
import { createLoop, STEP_HZ } from './engine/loop.js';
import { createRng } from './engine/rng.js';
import { createDisplay, LOGICAL_HEIGHT, LOGICAL_WIDTH } from './render/canvas.js';
import { drawScene } from './render/scene.js';
import { createSpriteSheet } from './render/sprites.js';
import { createStarfield } from './render/starfield.js';
import { aliveEnemies } from './sim/enemies.js';
import type { SimEvent } from './sim/events.js';
import { drawAttract } from './ui/attract.js';
import {
  BUILD,
  type BuildComparison,
  createUpdateWatcher,
  fetchServedIdentity,
} from './ui/build-info.js';
import { drawBuildLine, drawBuildStamp } from './ui/build-stamp.js';
import { createGameFlow, type GamePhase } from './ui/flow.js';
import { createHighScoreBoard, createWebStorage, drawInitialsEntry } from './ui/highscores.js';
import { badgesForStage, drawHud } from './ui/hud.js';
import { CARD_TOP } from './ui/panel.js';
import { drawChallengeResults, drawGameOver, drawResults } from './ui/results.js';

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
// means something. The flow derives each game's seed, and the attract demo's,
// from this one.
const SEED = 'star-swarm-m2';

// The high-score table survives the tab if the browser lets it, and quietly
// becomes a session-only table if it does not (`src/ui/highscores.ts`).
const highScores = createHighScoreBoard({ storage: createWebStorage() });

/**
 * Is a newer build being served? Polled once a minute of *simulation* time, so a
 * hidden tab stops asking and resumes on return.
 *
 * Nothing it finds interrupts anything: `src/ui/build-stamp.ts` draws a blinking
 * line and that is all. A failed fetch — offline, or a host with no `build.json`
 * to serve — is silent by construction (`src/ui/build-info.ts`).
 */
const updates = createUpdateWatcher({
  local: BUILD,
  load: fetchServedIdentity(),
  everySteps: 60 * STEP_HZ,
});

// The flow builds every world the game runs — the attract demo's and each
// game's — so the rules and the stage source go to it rather than to a world
// this file keeps.
const flow = createGameFlow({
  rules,
  stages: createStageSource(registry),
  seed: SEED,
  highScores,
});

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

/** Render, UI and audio subscribe to the sim; they never call back into it. */
function applyEvents(events: readonly SimEvent[]): void {
  sfx.handle(events);
  for (const event of events) {
    switch (event.type) {
      case 'stage-started':
        starfield.setSpeedByte(event.starfieldSpeed);
        // A new stage — including the first of a new game or a restarted attract
        // demo — is what brings the stars back after a game over.
        starfield.paused = false;
        break;
      case 'game-over':
        starfield.paused = true;
        break;
      default:
        break;
    }
  }
}

const loop = createLoop({
  update() {
    // Exactly one input sample per simulation step (docs/DESIGN.md pillar 4).
    const frame: InputFrame = input.sample();
    applyEvents(flow.step(frame).events);
    // Outside the simulation on purpose: the poll is a host concern counted in
    // simulation steps, and nothing it learns reaches the world.
    updates.step();
  },
  render() {
    starfield.advance();

    const { ctx } = display;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    starfield.draw(ctx);

    const world = flow.world;
    drawScene(ctx, world, { sheet: sprites });
    drawHud(ctx, {
      score: world.score,
      highScore: Math.max(flow.highScores.best(), world.score),
      lives: world.lives.reserve,
      stage: world.stage,
      // The badge denominations and their art are the pack's, not the HUD's.
      badges: registry.manifest.stageBadges,
      sheet: sprites,
    });
    // The top HUD band, never the playfield. Every phase, so "what is running?"
    // is answerable without leaving the game.
    drawBuildStamp(ctx, { build: BUILD, comparison: updates.comparison, steps: flow.steps });

    switch (flow.phase) {
      case 'attract':
        drawAttract(ctx, {
          steps: flow.phaseSteps,
          highScores: flow.highScores.entries(),
          persistent: flow.highScores.persistent,
        });
        drawBuildLine(ctx, {
          build: BUILD,
          comparison: updates.comparison,
          steps: flow.steps,
        });
        break;
      case 'game-over':
        drawGameOver(ctx, flow.phaseSteps);
        break;
      case 'results':
        drawResults(ctx, { stats: flow.stats, rows: flow.resultRows() });
        break;
      case 'challenge-results': {
        const summary = flow.stats.challenge;
        if (summary !== undefined) {
          drawChallengeResults(ctx, { stats: flow.stats, summary, steps: flow.phaseSteps });
        }
        break;
      }
      case 'high-score-entry': {
        const entry = flow.entry;
        if (entry !== undefined) {
          drawInitialsEntry(ctx, {
            entry,
            rank: flow.entryRank ?? 0,
            score: flow.stats.score,
            steps: flow.phaseSteps,
            x: LOGICAL_WIDTH / 2,
            y: CARD_TOP,
          });
        }
        break;
      }
      case 'playing':
        break;
    }

    display.present();
  },
});

loop.start();

// Handy from the devtools console, and what the Playwright smoke test reads to
// confirm the loop, the display and the game flow agree.
declare global {
  interface Window {
    starSwarm?: {
      readonly stepHz: number;
      readonly step: number;
      readonly phase: GamePhase;
      readonly score: number;
      readonly stage: number;
      readonly lives: number;
      readonly playerX: number;
      /** Enemies still on the field, and how many of them have reached their slot. */
      readonly enemiesAlive: number;
      readonly enemiesHome: number;
      /** Challenge-stage totals for the run: enemies destroyed and perfect stages. */
      readonly challengeHits: number;
      readonly perfectStages: number;
      /** The badge denominations on screen, which come from the pack. */
      readonly badges: readonly number[];
      /** Which motion the formation is running: sway, breathe or still. */
      readonly formationMotion: string;
      readonly shotsFired: number;
      readonly hits: number;
      readonly highScore: number;
      readonly layout: ReturnType<typeof createDisplay>['layout'];
      /** What build this page is running, as `src/ui/build-info.ts` derived it. */
      readonly build: typeof BUILD;
      /** The update poller: its last verdict, and how many polls have settled. */
      readonly buildComparison: BuildComparison;
      readonly buildUpdateAvailable: boolean;
      readonly buildChecks: number;
      readonly buildCheckFailures: number;
      /**
       * Poll now rather than waiting for the next due step. Here so
       * `tests/e2e/build-identity.spec.ts` can test the detector without sitting
       * out a minute of simulation, and handy from the console for the same
       * reason. It never rejects.
       */
      readonly checkBuild: () => Promise<BuildComparison>;
    };
  }
}

window.starSwarm = {
  stepHz: STEP_HZ,
  get step(): number {
    // The flow's own counter, not the world's: a world is replaced whenever a
    // game starts or the attract demo loops, and this must only ever go up.
    return flow.steps;
  },
  get phase(): GamePhase {
    return flow.phase;
  },
  get score(): number {
    return flow.world.score;
  },
  get stage(): number {
    return flow.world.stage;
  },
  get lives(): number {
    return flow.world.lives.reserve;
  },
  get playerX(): number {
    return flow.world.player.x;
  },
  get enemiesAlive(): number {
    return aliveEnemies(flow.world.fleet.enemies).length;
  },
  get enemiesHome(): number {
    return flow.world.fleet.enemies.filter((enemy) => enemy.state === 'home').length;
  },
  get challengeHits(): number {
    return flow.stats.challengeHits;
  },
  get perfectStages(): number {
    return flow.stats.perfectStages;
  },
  get badges(): readonly number[] {
    return badgesForStage(flow.world.stage, registry.manifest.stageBadges).map(
      (badge) => badge.value,
    );
  },
  get formationMotion(): string {
    return flow.world.formation?.motion ?? 'none';
  },
  get shotsFired(): number {
    return flow.stats.shotsFired;
  },
  get hits(): number {
    return flow.stats.hits;
  },
  get highScore(): number {
    return flow.highScores.best();
  },
  get layout(): ReturnType<typeof createDisplay>['layout'] {
    return display.layout;
  },
  build: BUILD,
  get buildComparison(): BuildComparison {
    return updates.comparison;
  },
  get buildUpdateAvailable(): boolean {
    return updates.available;
  },
  get buildChecks(): number {
    return updates.checks;
  },
  get buildCheckFailures(): number {
    return updates.failures;
  },
  checkBuild: updates.check,
};
