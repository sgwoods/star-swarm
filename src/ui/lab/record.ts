/**
 * The record page: a person plays, and the run comes out as a log
 * (`docs/ROADMAP.md`, "Capturing gameplay video", phase 2).
 *
 * `npm run record` (`scripts/record.ts`) serves `record.html` and opens it. The
 * page plays the game at 60 Hz on the real `createLoop`, from the keyboard, and
 * puts `recordInput` between the two (`./recording.ts`), so every frame the world
 * is given is also logged. When a run ends — the world's own game over, or `X` —
 * the log is sealed with the world's final fingerprint and sent to the command,
 * which checks it replays and writes it under `.scratch/record/`. From there
 * `npm run capture` renders it like any other log.
 *
 * **What it plays is what `npm run capture` renders a log on**, and nothing else:
 * the shipped Classic pack and its own rules (`LOG_PACKS`), from `?stage=` or the
 * rules' first stage, built by `./game-run.ts` — the very function the capture page
 * builds its run with. So the canvas here after step _N_ is the frame a clip shows
 * at step _N_, starfield and all; `tests/e2e/record.spec.ts` holds the two to each
 * other pixel for pixel. The front end is not here, and neither is a choice of
 * game, difficulty or fighter count: a world built from any of those is one the
 * capture page would not build back.
 *
 * Sound plays, through the synth and the pack's own bindings, because a run is
 * played by ear as much as by eye. It is not recorded: a clip has no sound track.
 *
 * **Dev build only**, exactly as `/lab` and the capture page are: `record.html` is
 * not one of the build's inputs and nothing on the game's graph imports this
 * directory, which `tests/unit/lab-dev-only.test.ts` checks against a real build.
 * The game itself never records — there is no recorder in `src/main.ts`, armed or
 * not, so an ordinary session samples its keyboard exactly as it did before this
 * page existed.
 */

import { createMusic, createSfx, createSynth, type Music, type Sfx } from '../../audio/index.js';
import { createRegistry, themedSounds } from '../../content/index.js';
import { createKeyboardInput } from '../../engine/input.js';
import { createLoop } from '../../engine/loop.js';
import { createDisplay } from '../../render/canvas.js';
import { fingerprintWorld } from '../../sim/world.js';
import { DEFAULT_SETTINGS } from '../settings.js';
import { createGameRun, type GameRun, loadPacks } from './game-run.js';
import {
  createRecording,
  LOG_PACKS,
  RECORD_SINK,
  type RecordedRun,
  type RecordReceipt,
  type RecordingState,
} from './recording.js';

/** What a test, or the devtools console, can read off the page. */
export interface RecordPage {
  readonly state: RecordingState;
  readonly game: number;
  readonly seed: string | undefined;
  /** Steps the run on screen has taken. */
  readonly step: number;
  /** The most recent run to end, sealed. */
  readonly last: RecordedRun | undefined;
  /** What the command answered for it; `undefined` until it has. */
  readonly receipt: RecordReceipt | undefined;
  /** The stage every run here starts on, or `undefined` for the rules' first. */
  readonly stage: number | undefined;
  /** The run on screen drawn as it now stands, as a PNG data URL, with its step. */
  frame: () => { readonly step: number; readonly png: string } | undefined;
}

declare global {
  interface Window {
    starSwarmRecord?: RecordPage;
  }
}

/** `?stage=` as a whole number of at least 1, or `undefined` when absent. */
function stageParameter(search: string): number | undefined {
  const value = new URLSearchParams(search).get('stage');
  if (value === null) return undefined;
  const stage = Number(value);
  if (!Number.isInteger(stage) || stage < 1) {
    throw new Error(`?stage= needs a whole number of at least 1, got ${value}`);
  }
  return stage;
}

const stage = stageParameter(window.location.search);
const rules = createRegistry(loadPacks(LOG_PACKS)).rules;
if (rules === undefined) throw new Error(`${LOG_PACKS.join(', ')} ships no rules.json`);

const screenElement = document.getElementById('record');
const statusElement = document.getElementById('status');
if (screenElement === null || statusElement === null) {
  throw new Error('record.html is missing its elements');
}
const status: HTMLElement = statusElement;
const display = createDisplay({ container: screenElement });

const input = createKeyboardInput();
input.attach(window);

const synth = createSynth({ volume: DEFAULT_SETTINGS.volume });
for (const gesture of ['keydown', 'pointerdown'] as const) {
  window.addEventListener(gesture, () => synth.unlock(), { once: true, passive: true });
}

let run: GameRun | undefined;
let sfx: Sfx | undefined;
let music: Music | undefined;
let receipt: RecordReceipt | undefined;

const recording = createRecording({
  ...(stage !== undefined && { stage }),
  begin(seed) {
    run = createGameRun({ seed, rules, packs: LOG_PACKS, ...(stage !== undefined && { stage }) });
    const sounds = themedSounds(run.registry, undefined);
    sfx = createSfx({ player: synth, sounds, bindings: run.registry.manifest.sounds });
    music?.stop();
    music = createMusic({ player: synth, sounds, cues: run.registry.manifest.music });
    const world = run.world;
    return {
      opening: run.opening,
      step: run.step,
      fingerprint: () => fingerprintWorld(world),
    };
  },
});

/** Hand a finished run to the command, and say what became of it. */
async function keep(finished: RecordedRun): Promise<void> {
  receipt = undefined;
  try {
    const response = await fetch(RECORD_SINK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finished),
    });
    if (response.status === 404) {
      receipt = {
        ok: false,
        error: 'NOT KEPT: only a page npm run record serves can keep a run',
      };
      return;
    }
    receipt = (await response.json()) as RecordReceipt;
  } catch (error) {
    receipt = { ok: false, error: `NOT KEPT: ${error instanceof Error ? error.message : 'error'}` };
  }
}

/** The line under the playfield: what the page is doing and which keys do what. */
function statusLine(): string {
  const where = stage === undefined ? '' : ` FROM STAGE ${String(stage)}`;
  switch (recording.state) {
    case 'ready':
      return `ENTER STARTS A RECORDED RUN${where}`;
    case 'playing':
      return `REC GAME ${String(recording.game)}  STEP ${String(recording.steps)}  P HOLDS  X ENDS`;
    case 'paused':
      return `HELD AT STEP ${String(recording.steps)}  P GOES ON  X ENDS`;
    case 'ended': {
      const ended = `GAME ${String(recording.game)} ENDED AT STEP ${String(recording.steps)}`;
      const kept =
        receipt === undefined ? 'KEEPING...' : receipt.ok ? `KEPT ${receipt.path}` : receipt.error;
      return `${ended}  ${kept}  ENTER RECORDS ANOTHER`;
    }
  }
}

const loop = createLoop({
  update() {
    // Exactly one keyboard sample per step, as `src/main.ts` takes one; what the
    // world is given of it is the recording's decision.
    const result = recording.step(input.sample());
    sfx?.handle(result.events);
    // A held run cuts its jingle, as a paused game does in `src/main.ts`.
    if (result.state === 'paused') music?.stop();
    else music?.handle(result.events);
    if (result.ended !== undefined) void keep(result.ended);
  },
  render() {
    // The world as it stands, every host frame: held or ended, it is simply not
    // stepped, so the canvas always shows the frame the capture page draws at
    // the run's current step.
    if (run !== undefined) run.draw(display.ctx);
    display.present();
    const line = statusLine();
    if (status.textContent !== line) status.textContent = line;
  },
});

loop.start();

window.starSwarmRecord = {
  get state(): RecordingState {
    return recording.state;
  },
  get game(): number {
    return recording.game;
  },
  get seed(): string | undefined {
    return recording.seed;
  },
  get step(): number {
    return run?.world.step ?? 0;
  },
  get last(): RecordedRun | undefined {
    return recording.last;
  },
  get receipt(): RecordReceipt | undefined {
    return receipt;
  },
  stage,
  frame() {
    if (run === undefined) return undefined;
    // Drawn again rather than read back from the last host frame: drawing reads
    // the run and changes nothing, so this is the frame at `step` exactly.
    run.draw(display.ctx);
    return { step: run.world.step, png: display.backbuffer.toDataURL('image/png') };
  },
};
