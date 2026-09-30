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
 * the audio, and nothing else. Attract demo, play, the pause and its exit
 * confirmation, the between-stage challenge card, game over, results and
 * high-score entry all arrive through one `flow.step(frame)` call, which is why
 * there are no phase flags here — including no `paused` boolean, which is the
 * flag `src/ui/flow.ts` refuses on the same grounds as every other.
 */

import { createSfx, createSynth, type Sfx } from './audio/index.js';
import { bundledPackSources, bundledVariantSources } from './content/bundle.js';
import type { ContentError, LoadedPack } from './content/index.js';
import {
  ContentValidationError,
  loadPack,
  loadVariants,
  type ResolvedVariant,
} from './content/index.js';
import { createKeyboardInput, type InputFrame } from './engine/input.js';
import { createLoop, STEP_HZ } from './engine/loop.js';
import { createRng } from './engine/rng.js';
import { createDisplay, LOGICAL_HEIGHT, LOGICAL_WIDTH } from './render/canvas.js';
import { drawScene } from './render/scene.js';
import { createSpriteSheet, type SpriteSheet } from './render/sprites.js';
import { createStarfield } from './render/starfield.js';
import { beamCaptor, capturedFighter } from './sim/capture.js';
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
import { createGameFlow, type FlowVariant, type GamePhase } from './ui/flow.js';
import {
  createHighScoreBoard,
  drawInitialsEntry,
  HIGH_SCORE_STORAGE_KEY,
} from './ui/highscores.js';
import { badgesForStage, drawAutoplayLine, drawHud } from './ui/hud.js';
import { drawSettings, drawVariantSelect, SELECT_CARD_TOP, SETTINGS_CARD_TOP } from './ui/menus.js';
import { CARD_TOP } from './ui/panel.js';
import { drawExitConfirm, drawPaused, EXIT_CARD_TOP, PAUSE_CARD_TOP } from './ui/pause.js';
import { drawChallengeResults, drawGameOver, drawResults } from './ui/results.js';
import {
  bindingsFor,
  createSettingsStore,
  SETTINGS_STORAGE_KEY,
  type Settings,
} from './ui/settings.js';
import { createWebStorage } from './ui/storage.js';

const app = document.getElementById('app');
if (app === null) throw new Error('Missing #app container');
const container: HTMLElement = app;

const display = createDisplay({ container });

// The games this build offers come from `variants/`, and the content each one runs
// on comes from the packs it names — both bundled rather than fetched, and both
// through the same loaders the validation gate runs, so the game and the gate
// cannot disagree. Nothing here names a variant, a pack or a rank: adding a game
// is adding a document.
//
// Both readers glob their whole directory rather than naming the files somebody
// remembered: a manifest that references a sound, a path or a sprite has to be
// loaded *with* them, or the reference pass rejects it and the game will not boot.
// See `src/content/bundle.ts`.
const packs = new Map<string, LoadedPack>();
const packErrors: ContentError[] = [];
for (const [name, source] of bundledPackSources()) {
  const result = loadPack(source);
  if (result.ok) packs.set(name, result.pack);
  else packErrors.push(...result.errors);
}
if (packErrors.length > 0) throw new ContentValidationError(packErrors);

const loaded = loadVariants(bundledVariantSources(), packs);
if (!loaded.ok) throw new ContentValidationError(loaded.errors);
const variants = loaded.variants;
const firstVariant = variants[0];
if (firstVariant === undefined) {
  throw new Error('no variants are bundled: variants/ holds no document, so there is no game');
}
const byId = new Map(variants.map((entry) => [entry.id, entry]));

/** The variant in force. Replaced when the flow reports the player chose another. */
let variant: ResolvedVariant = firstVariant;

// Seeded from a constant so a session is reproducible and a recorded replay
// means something. The flow derives each game's seed, and the attract demo's,
// from this one.
const SEED = 'star-swarm-m2';

// The high-score table and the player's settings survive the tab if the browser
// lets them, and quietly become session-only if it does not. One storage
// implementation, two keys (`src/ui/storage.ts`): blocked site data must never
// take the game down, so both degrade to defaults rather than throwing.
const highScores = createHighScoreBoard({
  storage: createWebStorage({ key: HIGH_SCORE_STORAGE_KEY }),
});
const settings = createSettingsStore({
  storage: createWebStorage({ key: SETTINGS_STORAGE_KEY }),
});

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

/**
 * The keyboard, on whichever scheme the player chose.
 *
 * Rebuilt rather than remapped when the setting changes: `createKeyboardInput`
 * closes over its bindings, and an input device that could be re-bound mid-flight
 * is a device that can be holding a key nothing will ever release.
 */
let input = createKeyboardInput({ bindings: bindingsFor(settings.value.controls) });
let detachInput = input.attach(window);

// The starfield gets its own generator: it is presentation, and pulling draws
// from the simulation's stream would make what the sim computes depend on how
// many stars happen to be on screen.
const starfield = createStarfield(createRng(`${SEED}:stars`));

// Audio subscribes to the same events the renderer does and never calls back in.
// No `AudioContext` exists until a user gesture unlocks one, and every call into
// Web Audio is wrapped, so a browser that blocks audio leaves the game running in
// silence. Which sound each event plays is the pack's `sounds` map, not a name in
// this file.
const synth = createSynth({
  volume: settings.value.volume,
  muted: settings.value.muted,
});

/**
 * Everything derived from pack data, built when a variant comes into force and
 * never per frame: the sheet rasterises every sprite frame up front
 * (`src/render/README.md`), and the effect map is the variant's own `sounds`.
 *
 * These are `let` rather than `const` because a variant is chosen at run time. A
 * variant change is the *only* thing that rebuilds them — nothing here is per
 * frame, which is the contract `src/render/README.md` states.
 */
let sprites: SpriteSheet = createSpriteSheet({
  sprites: variant.registry.sprites.values(),
  palette: variant.registry.manifest.palette,
});
let sfx: Sfx = createSfx({
  player: synth,
  sounds: variant.registry.sounds,
  bindings: variant.registry.manifest.sounds,
});

/**
 * Take on the variant the flow says is now in force.
 *
 * The flow rebuilds the rules, the stage source and the attract demo itself; this
 * is the other half — the things a variant decides that live on this side of the
 * boundary. Called from `onVariantChange` and nowhere else, so there is one place
 * a variant's presentation is assembled.
 */
function applyVariant(chosen: FlowVariant): void {
  variant = byId.get(chosen.id) ?? variant;
  sprites = createSpriteSheet({
    sprites: variant.registry.sprites.values(),
    palette: variant.registry.manifest.palette,
  });
  sfx = createSfx({
    player: synth,
    sounds: variant.registry.sounds,
    bindings: variant.registry.manifest.sounds,
  });
}

/** Apply the settings that live outside the flow: audio, controls, the CRT flag. */
function applySettings(value: Settings): void {
  synth.setVolume(value.volume);
  synth.setMuted(value.muted);
  if (value.controls !== controls) {
    controls = value.controls;
    detachInput();
    input = createKeyboardInput({ bindings: bindingsFor(controls) });
    detachInput = input.attach(window);
  }
  // The option is stored and reported; `src/render/crt.ts` is not written yet, so
  // this is where the filter will read it from and nothing reads it today.
  container.dataset.crt = value.crt ? 'on' : 'off';
}

let controls = settings.value.controls;

// The flow builds every world the game runs — the attract demo's and each game's —
// so the variants go to it rather than to a world this file keeps. It owns which
// game is in force; this file hears about a change and rebuilds what it owns.
const flow = createGameFlow({
  variants,
  seed: SEED,
  highScores,
  settings,
  onVariantChange: applyVariant,
});

applySettings(settings.value);

function unlockAudio(): void {
  synth.unlock();
}
for (const gesture of ['keydown', 'pointerdown'] as const) {
  window.addEventListener(gesture, unlockAudio, { once: true, passive: true });
}

/**
 * Render, UI and audio subscribe to the sim; they never call back into it.
 *
 * Both subscribers own their own mapping from event to behaviour, so this file
 * names neither a sound nor a scroll rate.
 */
function applyEvents(events: readonly SimEvent[]): void {
  sfx.handle(events);
  starfield.handle(events);
}

const loop = createLoop({
  update() {
    // Exactly one input sample per simulation step (docs/DESIGN.md pillar 4).
    const frame: InputFrame = input.sample();
    applyEvents(flow.step(frame).events);
    // The menu writes settings; this is where they reach the things outside the
    // flow. Cheap and idempotent, so it runs every step rather than needing a
    // change notification the menu would have to remember to send.
    applySettings(flow.settings);
    // Outside the simulation on purpose: the poll is a host concern counted in
    // simulation steps, and nothing it learns reaches the world.
    updates.step();
  },
  render() {
    // The backdrop is the one thing on screen that is not driven by a step, so
    // it is the one thing that would carry on scrolling behind a held game.
    // A pause that leaves the stars moving reads as a game still running.
    if (flow.phase !== 'paused' && flow.phase !== 'exit-confirm') starfield.advance();

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
      badges: variant.registry.manifest.stageBadges,
      sheet: sprites,
    });
    // The top HUD band, never the playfield. Every phase, so "what is running?"
    // is answerable without leaving the game.
    drawBuildStamp(ctx, { build: BUILD, comparison: updates.comparison, steps: flow.steps });

    // Who is flying, when it is not the person in front of the cabinet. Off the two
    // menu screens, which have a row that says it already and a card in the way.
    const persona = flow.autoplay;
    if (persona !== undefined && flow.phase !== 'settings' && flow.phase !== 'variant-select') {
      drawAutoplayLine(ctx, persona.label);
    }

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
      case 'variant-select': {
        const menu = flow.variantMenu;
        if (menu !== undefined) {
          drawVariantSelect(ctx, {
            menu,
            steps: flow.phaseSteps,
            x: LOGICAL_WIDTH / 2,
            y: SELECT_CARD_TOP,
          });
        }
        break;
      }
      case 'settings': {
        const menu = flow.settingsMenu;
        if (menu !== undefined) {
          drawSettings(ctx, {
            menu,
            steps: flow.phaseSteps,
            x: LOGICAL_WIDTH / 2,
            y: SETTINGS_CARD_TOP,
            persistent: settings.persistent,
          });
        }
        break;
      }
      case 'paused':
        drawPaused(ctx, { steps: flow.phaseSteps, x: LOGICAL_WIDTH / 2, y: PAUSE_CARD_TOP });
        break;
      case 'exit-confirm': {
        const confirm = flow.exitConfirm;
        if (confirm !== undefined) {
          // The rank the run *would* have taken, asked of the same table the
          // results screen asks. `undefined` means it would not have placed, and
          // the card leaves the line out.
          drawExitConfirm(ctx, {
            confirm,
            steps: flow.phaseSteps,
            x: LOGICAL_WIDTH / 2,
            y: EXIT_CARD_TOP,
            score: flow.world.score,
            rank: flow.highScores.rankFor(flow.world.score),
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
      /**
       * Steps the **world on screen** has run.
       *
       * Distinct from `step`, which is the flow's and never stops: this one is
       * the simulation's own counter, so it is what a test watches to see that a
       * paused game really is not being stepped.
       */
      readonly simStep: number;
      readonly phase: GamePhase;
      readonly score: number;
      readonly stage: number;
      readonly lives: number;
      readonly playerX: number;
      readonly playerY: number;
      readonly playerAlive: boolean;
      readonly playerMode: string;
      /**
       * The capture channel, flattened: which phase it is in, where the captor
       * holding a beam is, and whether a captured fighter is on the field.
       *
       * Here because the capture goldens run headlessly and the browser is the
       * path they cannot see — `tests/e2e/capture.spec.ts` plays a whole capture
       * through this page and needs somewhere to aim.
       */
      readonly capture: {
        readonly phase: string;
        readonly beamStep: number;
        readonly captorX: number | undefined;
        readonly captorY: number | undefined;
        readonly captiveId: number | undefined;
        readonly captiveOnField: boolean;
      };
      /** Enemies still on the field, and how many of them have reached their slot. */
      readonly enemiesAlive: number;
      readonly enemiesHome: number;
      /** Challenge-stage totals for the run: enemies destroyed and perfect stages. */
      readonly challengeHits: number;
      readonly perfectStages: number;
      /** The badge denominations on screen, which come from the pack. */
      readonly badges: readonly number[];
      /** The variant in force, the list on offer, and the rank the preset chose. */
      readonly variant: string;
      readonly variantName: string;
      readonly variants: readonly string[];
      readonly rank: string;
      readonly difficulty: string;
      /**
       * The autoplay persona flying, or `''` for a human — and the personas this
       * variant offers. `tests/e2e/autoplay.spec.ts` drives the real page through
       * the real keyboard path and needs to be able to see which.
       */
      readonly autoplay: string;
      readonly personas: readonly string[];
      /** The player's settings, as the menu has them. */
      readonly settings: Settings;
      readonly settingsPersistent: boolean;
      /** The settings rows on screen, as `label=value`. Empty off that phase. */
      readonly settingsRows: readonly string[];
      /** The id of the settings row under the cursor. Empty off that phase. */
      readonly settingsMenuRow: string;
      /** The note drawn under the list — the live row's. Empty off that phase. */
      readonly settingsMenuNote: string;
      /** The variant under the selector's cursor. Empty off that phase. */
      readonly selecting: string;
      /** The exit confirmation's choice — `resume` or `exit`. Empty off that phase. */
      readonly exitChoice: string;
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
  get simStep(): number {
    return flow.world.step;
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
  get playerY(): number {
    return flow.world.player.y;
  },
  get playerAlive(): boolean {
    return flow.world.player.alive;
  },
  get playerMode(): string {
    return flow.world.player.mode;
  },
  get capture(): {
    phase: string;
    beamStep: number;
    captorX: number | undefined;
    captorY: number | undefined;
    captiveId: number | undefined;
    captiveOnField: boolean;
  } {
    const world = flow.world;
    const captor = beamCaptor(world.capture, world.fleet);
    return {
      phase: world.capture.phase,
      beamStep: world.capture.beamStep,
      captorX: captor?.x,
      captorY: captor?.y,
      captiveId: world.capture.captiveId,
      captiveOnField: capturedFighter(world.capture, world.fleet) !== undefined,
    };
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
    return badgesForStage(flow.world.stage, variant.registry.manifest.stageBadges).map(
      (badge) => badge.value,
    );
  },
  get variant(): string {
    return flow.variant.id;
  },
  get variantName(): string {
    return flow.variant.name;
  },
  get variants(): readonly string[] {
    return flow.variants.map((entry) => entry.id);
  },
  get rank(): string {
    return flow.rank;
  },
  get autoplay(): string {
    return flow.autoplay?.id ?? '';
  },
  get personas(): readonly string[] {
    return flow.variant.personas.map((persona) => persona.id);
  },
  get difficulty(): string {
    return flow.settings.difficulty ?? flow.variant.defaultPreset.id;
  },
  get settings(): Settings {
    return flow.settings;
  },
  get settingsPersistent(): boolean {
    return settings.persistent;
  },
  get settingsRows(): readonly string[] {
    return (flow.settingsMenu?.rows ?? []).map((row) => `${row.label}=${row.value}`);
  },
  get settingsMenuRow(): string {
    return flow.settingsMenu?.row.id ?? '';
  },
  get settingsMenuNote(): string {
    return flow.settingsMenu?.row.note ?? '';
  },
  get selecting(): string {
    return flow.variantMenu?.chosen.id ?? '';
  },
  get exitChoice(): string {
    return flow.exitConfirm?.choice ?? '';
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
