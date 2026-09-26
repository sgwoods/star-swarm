/**
 * Record a golden replay (docs/DESIGN.md section 11).
 *
 * A golden replay is a committed `(seed, input log, final state)` triple. The
 * test in `tests/sim/` plays the log back and fails if the simulation lands
 * anywhere else, which is how a behaviour change gets noticed even when nobody
 * wrote an assertion for it. That also makes regenerating a golden a
 * **deliberate act**: if this script changes a committed file, either the change
 * was intended and the PR says why, or something broke.
 *
 *   npx tsx scripts/record-replay.ts            rewrite every golden
 *   npx tsx scripts/record-replay.ts --check    fail if any is out of date
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { readPackSource } from '../src/content/fs.js';
import { loadPackOrThrow } from '../src/content/loader.js';
import { createRegistry } from '../src/content/registry.js';
import type { Rules } from '../src/content/schema.js';
import type { StageSource } from '../src/content/stages.js';
import { createStageSource } from '../src/content/stages.js';
import { constantInput, frameOf, type InputFrame, type InputSource } from '../src/engine/input.js';
import { createLoop, STEP_MS } from '../src/engine/loop.js';
import { recordInput, serializeReplay } from '../src/engine/replay.js';
import { createRng } from '../src/engine/rng.js';
import { createWorld, fingerprintWorld, stepWorld } from '../src/sim/world.js';

const GOLDEN_DIR = resolve(import.meta.dirname, '..', 'tests', 'sim', 'golden');

/**
 * The pack a golden is recorded against: the shipped Classic pack, read through
 * the real loader. A golden proved against content the game does not use proves
 * nothing, so this is the same path `src/main.ts` takes — rules *and* stages.
 */
function classicPack() {
  const packDir = resolve(import.meta.dirname, '..', 'packs', 'classic');
  const { source, errors } = readPackSource(packDir);
  if (source === undefined) {
    throw new Error(`could not read ${packDir}: ${JSON.stringify(errors)}`);
  }
  const pack = loadPackOrThrow(source);
  if (pack.rules === undefined) throw new Error(`${packDir} has no rules.json`);
  return { rules: pack.rules, stages: createStageSource(createRegistry([pack])) };
}

const CLASSIC = classicPack();

export function classicRules(): Rules {
  return CLASSIC.rules;
}

export function classicStages(): StageSource {
  return CLASSIC.stages;
}

/**
 * A scripted pilot: seeded, so the log is reproducible, and varied enough to
 * exercise the movement cadence, the shot cap, collisions and being shot at.
 */
export function scriptedPilot(seed: string, holdSteps = 48): InputSource {
  const rng = createRng(seed);
  // Weighted towards sweeping with the button held, which is how the game is
  // actually played: auto-fire means there is no reason ever to let go.
  const choices: InputFrame[] = [
    frameOf('left', 'fire'),
    frameOf('right', 'fire'),
    frameOf('left', 'fire'),
    frameOf('right', 'fire'),
    frameOf('fire'),
    frameOf('left'),
    frameOf('right'),
    0,
  ];
  let frame: InputFrame = 0;
  let held = 0;
  return {
    sample(): InputFrame {
      if (held === 0) {
        frame = rng.pick(choices);
        held = rng.int(1, holdSteps + 1);
      }
      held -= 1;
      return frame;
    },
  };
}

/**
 * A pilot that sweeps the whole playfield with the button held, reversing on a
 * fixed period.
 *
 * The scripted pilot above plays like someone jabbing at the controls; this one
 * plays like someone covering the screen. The difference matters now that the
 * game shoots back: a pilot that sometimes stands still in front of a diver
 * cannot clear a stage, so the golden that has to reach stage 2 uses this one.
 */
export function sweepingPilot(period: number): InputSource {
  let step = 0;
  return {
    sample(): InputFrame {
      const rightwards = Math.floor(step / period) % 2 === 0;
      step += 1;
      return frameOf(rightwards ? 'right' : 'left', 'fire');
    },
  };
}

/**
 * Run the world through the real fixed-step loop. Exported so the test drives
 * the simulation exactly as this recorder did — a replay proved against a
 * different harness proves nothing.
 */
export function runWorld(
  seed: string,
  input: InputSource,
  steps: number,
  rules: Rules = CLASSIC.rules,
  stages: StageSource = CLASSIC.stages,
  stage?: number,
): { readonly fingerprint: string; readonly trace: string[] } {
  const world = createWorld({ seed, rules, stages, ...(stage !== undefined && { stage }) });
  const trace: string[] = [];

  const loop = createLoop({
    update: () => {
      stepWorld(world, input.sample());
      trace.push(fingerprintWorld(world));
    },
    render: () => {},
    requestFrame: () => 0,
    cancelFrame: () => {},
  });

  for (let i = 0; i < steps; i += 1) loop.advance(STEP_MS);
  return { fingerprint: fingerprintWorld(world), trace };
}

export interface GoldenSpec {
  readonly name: string;
  readonly seed: string;
  readonly inputSeed: string;
  readonly steps: number;
  readonly rules?: Rules;
  /** The stage to start on. Omitted means the rules' own `firstStage`. */
  readonly stage?: number;
  /**
   * `true` records with the sticks and the button untouched. A golden of the
   * entry choreography wants exactly that: nothing the player does can change
   * where a wave flies, so an empty log makes the file a record of the fleet and
   * the formation alone.
   */
  readonly idle?: boolean;
  /**
   * Reverse every this many steps, with the button held, instead of playing the
   * scripted pilot. See {@link sweepingPilot}.
   */
  readonly sweepPeriod?: number;
}

/**
 * A cabinet started on five fighters — one of the four settings
 * `rules.lives.options` offers.
 *
 * Used by the goldens that have to survive long enough to clear a stage. It is
 * the shipped pack with one switch thrown, not a softened rules file, and it
 * covers a second thing for free: five starting ships resolve a *different* set
 * of extra-life thresholds (`resolveExtraLifeAward`).
 */
function fiveShipCabinet(): Rules {
  return { ...CLASSIC.rules, lives: { ...CLASSIC.rules.lives, default: 5 } };
}

export const GOLDENS: readonly GoldenSpec[] = [
  // A whole stage-1 entry with the controls untouched: five waves of eight along
  // the entry paths, forty enemies taking their own slots, the sway running
  // throughout and ending centred, and the breathe starting. The formation settles
  // on frame 1024, so 1,400 steps carry it past a further full breathe cycle —
  // and, since the dive task landed, past the first dives, which begin from that
  // same settle frame against a fighter that never moves or fires.
  {
    name: 'stage-entry',
    seed: 'golden-stage-entry',
    inputSeed: 'idle',
    steps: 1_400,
    idle: true,
  },
  // Three minutes of ordinary play. Covers movement, the shot cap, collisions and
  // the score rule against enemy state — and now dives, bombing and losing the
  // last fighter, because a pilot that jabs at the controls in front of a diver
  // does not survive three minutes. The frozen tail after game over is part of
  // what it locks: the world must do nothing at all once the run is over.
  { name: 'player-core', seed: 'golden-player-core', inputSeed: 'pilot-1', steps: 10_800 },
  // A five-ship cabinet with a pilot that keeps moving: far enough in to clear
  // stage 1 with dives and bombs in play and roll on to stage 2, which is the
  // first stage on which an entering enemy may bomb.
  {
    name: 'player-survival',
    seed: 'golden-player-survival',
    inputSeed: 'pilot-2',
    steps: 5_400,
    sweepPeriod: 100,
    rules: fiveShipCabinet(),
  },
  // Stage 20 from the start: the difficulty ramp selecting a *different* row.
  // Four divers rising to six, launch counters of 8 where stage 1 has 0, the
  // alternative bombing-vector table that row's `reloadBombVectors` swaps in, and
  // enough bombs in the air to reach the eight-slot cap.
  //
  // The sweep period is 110 rather than 90 because the stages task changed what
  // plays as stage 20: the normal sequence used to hold one row, so every stage
  // past 1 replayed stage 1's choreography, and now the plateau rests on
  // `stage-4`. Against that entry the 90-frame sweeper died 120 frames after the
  // transform fired, which cost this golden the one thing only it covers — the
  // trio leaving the screen instead of rejoining. 110 keeps the fighter alive
  // through it (game over at 2,452 against 1,634), departs three of them and
  // lands 178 bombs against 113. The number is the test pilot's, not the game's;
  // the difficulty row is untouched.
  {
    name: 'stage-dives',
    seed: 'golden-stage-dives',
    inputSeed: 'pilot-dive',
    steps: 5_400,
    stage: 20,
    sweepPeriod: 110,
    rules: fiveShipCabinet(),
  },
];

export function goldenPath(name: string): string {
  return join(GOLDEN_DIR, `${name}.replay.json`);
}

/** The input a golden is recorded with: nothing, a steady sweep, or the pilot. */
export function pilotFor(spec: GoldenSpec): InputSource {
  if (spec.idle === true) return constantInput(0);
  if (spec.sweepPeriod !== undefined) return sweepingPilot(spec.sweepPeriod);
  return scriptedPilot(spec.inputSeed);
}

export function recordGolden(spec: GoldenSpec): string {
  const recorder = recordInput(pilotFor(spec), spec.seed);
  const run = runWorld(
    spec.seed,
    recorder.source,
    spec.steps,
    spec.rules ?? CLASSIC.rules,
    CLASSIC.stages,
    spec.stage,
  );
  return `${serializeReplay(recorder.finish(run.fingerprint))}\n`;
}

function main(): void {
  const check = process.argv.includes('--check');
  let stale = 0;

  for (const spec of GOLDENS) {
    const path = goldenPath(spec.name);
    const next = recordGolden(spec);

    let current: string | null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      current = null;
    }

    if (current === next) {
      console.log(`ok       ${spec.name}`);
      continue;
    }
    if (check) {
      console.error(`stale    ${spec.name} - run: npx tsx scripts/record-replay.ts`);
      stale += 1;
      continue;
    }

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next, 'utf8');
    console.log(`${current === null ? 'created' : 'updated'}  ${spec.name}`);
  }

  if (stale > 0) process.exitCode = 1;
}

// Importing this module (the test does) must not rewrite anything; only running
// it as a script does.
if (process.argv[1]?.endsWith('record-replay.ts') === true) main();
