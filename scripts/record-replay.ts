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
import type { Rules } from '../src/content/schema.js';
import { frameOf, type InputFrame, type InputSource } from '../src/engine/input.js';
import { createLoop, STEP_MS } from '../src/engine/loop.js';
import { recordInput, serializeReplay } from '../src/engine/replay.js';
import { createRng } from '../src/engine/rng.js';
import { createWorld, fingerprintWorld, stepWorld } from '../src/sim/world.js';

const GOLDEN_DIR = resolve(import.meta.dirname, '..', 'tests', 'sim', 'golden');

/**
 * The rules a golden is recorded against: the shipped Classic pack, read
 * through the real loader. A golden proved against rules the game does not use
 * proves nothing, so this is the same path `src/main.ts` takes.
 */
export function classicRules(): Rules {
  const packDir = resolve(import.meta.dirname, '..', 'packs', 'classic');
  const { source, errors } = readPackSource(packDir);
  if (source === undefined) {
    throw new Error(`could not read ${packDir}: ${JSON.stringify(errors)}`);
  }
  const rules = loadPackOrThrow(source).rules;
  if (rules === undefined) throw new Error(`${packDir} has no rules.json`);
  return rules;
}

const CLASSIC_RULES = classicRules();

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
 * Run the world through the real fixed-step loop. Exported so the test drives
 * the simulation exactly as this recorder did — a replay proved against a
 * different harness proves nothing.
 */
export function runWorld(
  seed: string,
  input: InputSource,
  steps: number,
  rules: Rules = CLASSIC_RULES,
  standInFireRate?: number,
): { readonly fingerprint: string; readonly trace: string[] } {
  const world =
    standInFireRate === undefined
      ? createWorld({ seed, rules })
      : createWorld({ seed, rules, standInFireRate });
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
  /**
   * The stand-in formation's fire rate. `0` turns its guns off, so a run reaches
   * the end of a stage instead of ending in a game over — which is how a golden
   * covers the stage roll while the stand-in still exists.
   */
  readonly standInFireRate?: number;
}

export const GOLDENS: readonly GoldenSpec[] = [
  // Three minutes of ordinary play, ending the way ordinary play ends: three
  // fighters lost. Covers movement, the shot cap, both collision directions,
  // the respawn and game over.
  { name: 'player-core', seed: 'golden-player-core', inputSeed: 'pilot-1', steps: 10_800 },
  // Four minutes against a formation that does not shoot back, which is long
  // enough to clear one and roll on to the next stage.
  {
    name: 'player-survival',
    seed: 'golden-player-survival',
    inputSeed: 'pilot-2',
    steps: 14_400,
    standInFireRate: 0,
  },
];

export function goldenPath(name: string): string {
  return join(GOLDEN_DIR, `${name}.replay.json`);
}

export function recordGolden(spec: GoldenSpec): string {
  const recorder = recordInput(scriptedPilot(spec.inputSeed), spec.seed);
  const run = runWorld(
    spec.seed,
    recorder.source,
    spec.steps,
    spec.rules ?? CLASSIC_RULES,
    spec.standInFireRate,
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
