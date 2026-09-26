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
import {
  type Action,
  constantInput,
  frameOf,
  type InputFrame,
  type InputSource,
} from '../src/engine/input.js';
import { createLoop, STEP_MS } from '../src/engine/loop.js';
import type { Recorder } from '../src/engine/replay.js';
import { recordInput, serializeReplay } from '../src/engine/replay.js';
import { createRng } from '../src/engine/rng.js';
import { beamCaptor, capturedFighter, captorOfCaptive, holdsFighter } from '../src/sim/capture.js';
import { createWorld, fingerprintWorld, stepWorld, type World } from '../src/sim/world.js';

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

/** Fire held, sticks untouched: see {@link GoldenSpec.hold}. */
const FIRE_ONLY: InputFrame = frameOf('fire');

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

export interface RunOptions {
  readonly rules?: Rules;
  readonly stages?: StageSource;
  /** Stage to start on. A challenge-stage golden starts on one. */
  readonly stage?: number;
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
 * A pilot that gets itself captured on purpose and then shoots its way back out.
 *
 * It watches the world, which a golden is allowed to do: what gets recorded is the
 * frames it produced, and a replay feeds those exact frames back. So an adaptive
 * pilot at record time still leaves a plain, reproducible log — and it is the only
 * way to record a rescue, which needs a shot landed on one particular enemy inside
 * one particular window.
 *
 * It **holds its fire** until it has something to shoot for, and that is the whole
 * trick: a captor has to survive its descent for a beam to come out at all, and has
 * to survive being in formation for a rescue to be possible later. So:
 *
 * 1. **A beam is out, or a captor is on its way down: walk into it**, silently.
 *    Getting captured on purpose is the standard way to go after a dual fighter.
 * 2. **A fighter is held and the pair is attacking: line up under the captor and
 *    fire.** That is the manual's rescue condition, and firing only there is the
 *    difference between a rescue and a rogue.
 * 3. **A dual fighter: play.** Sweep with the button held, which is what puts the
 *    two-bullet spread and the two windows into the log.
 * 4. **Otherwise: sweep, silently.**
 */
export function capturePilot(world: World): InputSource {
  const sweep = sweepingPilot(90);

  /** Towards `x`, or nothing if we are already there. */
  const towards = (x: number, extra: Action[] = []): InputFrame => {
    const dx = x - world.player.x;
    const actions: Action[] = [...extra];
    if (dx > 1) actions.push('right');
    else if (dx < -1) actions.push('left');
    return frameOf(...actions);
  };

  return {
    sample(): InputFrame {
      const { capture, fleet } = world;

      if (capture.phase === 'diving' || capture.phase === 'beam') {
        const captor = beamCaptor(capture, fleet);
        if (captor !== undefined) return towards(captor.x);
      }

      if (holdsFighter(capture)) {
        const captor = captorOfCaptive(capture, fleet);
        const captive = capturedFighter(capture, fleet);
        if (captor !== undefined && captive?.state === 'diving' && captor.state === 'diving') {
          return towards(captor.x, ['fire']);
        }
      }

      const frame = sweep.sample();
      // The sweep holds fire, except once there are two ships to show off.
      return capture.phase === 'dual' ? frame : frame & ~frameOf('fire');
    },
  };
}

/** What one recorded or replayed run comes back as. */
export interface WorldRun {
  readonly fingerprint: string;
  readonly trace: string[];
}

/**
 * Run the world through the real fixed-step loop. Exported so the test drives
 * the simulation exactly as this recorder did — a replay proved against a
 * different harness proves nothing.
 *
 * `input` may be a source or a factory over the world, for a pilot that has to see
 * what it is shooting at. See {@link capturePilot}.
 */
export function runWorld(
  seed: string,
  input: InputSource | ((world: World) => InputSource),
  steps: number,
  rules: Rules = CLASSIC.rules,
  stages: StageSource = CLASSIC.stages,
  stage?: number,
): WorldRun {
  const world = createWorld({ seed, rules, stages, ...(stage !== undefined && { stage }) });
  const source = typeof input === 'function' ? input(world) : input;
  const trace: string[] = [];

  const loop = createLoop({
    update: () => {
      stepWorld(world, source.sample());
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
   * Hold this exact frame for the whole recording, instead of running the
   * scripted pilot.
   *
   * `hold: 0` is the empty log: nothing the player does can change where an entry
   * wave flies, so a golden of the choreography with the controls untouched is a
   * record of the fleet and the formation alone. `hold: frameOf('fire')` is the
   * other case this exists for — the acceptance test that the first two challenge
   * stages can be perfected **without moving**, from the exact centre of the
   * screen (`docs/DESIGN.md` section 11). A log that never sets a direction bit
   * is what makes "without moving" a property of the file rather than a claim.
   */
  readonly hold?: InputFrame;
  /**
   * Reverse every this many steps, with the button held, instead of playing the
   * scripted pilot. See {@link sweepingPilot}.
   */
  readonly sweepPeriod?: number;
  /**
   * Record with the capture pilot, which watches the world. See
   * {@link capturePilot}.
   */
  readonly capture?: boolean;
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

/**
 * A five-ship cabinet whose enemies drop no bombs: the global bullet cap at zero.
 *
 * Used by the capture goldens, and not for convenience. Enemy fire is the only thing
 * that can shoot the fighter down, and an idle-ish pilot in front of forty bombers
 * loses every ship inside half a minute — so a capture log recorded against the
 * shipped cap would be a record of being bombed, with the mechanic barely started.
 * Bombing has its own goldens (`player-core`, `player-survival`, `stage-dives`); these
 * record the channel, and the only thing that can cost a fighter in them is the beam.
 */
function unbombedCabinet(): Rules {
  const rules = fiveShipCabinet();
  return { ...rules, enemies: { ...rules.enemies, maxBullets: 0 } };
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
    hold: 0,
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
  // The capture mechanic: three goldens over one pilot and one seed, each cut a
  // little further along the same run (`capturePilot`, `unbombedCabinet`).
  //
  // Stage 20 rather than stage 1 because its row launches captors often and gives
  // the beam a 3-frame step period where stage 1's is 12 — the shipped row, not a
  // softened one, and the one that makes the whole channel fit in a recordable run.
  //
  // A capture: a captor descends, opens its beam, drags the fighter up the screen
  // and parks it in its own captive slot — which costs a fighter and leaves the
  // channel held, so no second beam can ever appear.
  {
    name: 'capture-beam',
    seed: 'golden-capture',
    inputSeed: 'capture',
    steps: 2_200,
    stage: 20,
    capture: true,
    rules: unbombedCabinet(),
  },
  // A rescue: the captor dives again with its captive beside it, is shot while they
  // are both attacking, and the freed ship spins and docks as a second fighter.
  {
    name: 'capture-rescue',
    seed: 'golden-capture',
    inputSeed: 'capture',
    steps: 3_400,
    stage: 20,
    capture: true,
    rules: unbombedCabinet(),
  },
  // And a dual fighter playing on: two ships, a two-bullet spread per shot with the
  // cap still at two logical shots, and still no capture attempt — a dual fighter is
  // never targeted.
  {
    name: 'dual-fighter',
    seed: 'golden-capture',
    inputSeed: 'capture',
    steps: 5_400,
    stage: 20,
    capture: true,
    rules: unbombedCabinet(),
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
  // `docs/DESIGN.md` section 11, twice over: a perfect run of the first two
  // challenge stages, achieved **without moving** from the exact centre of the
  // screen, and the 19,000 a perfect first challenge stage pays. The input log
  // holds fire and never touches a direction, which is the whole point — if the
  // challenge data or the flight paths stop allowing it, these fail rather than
  // quietly needing a nudge. Each starts on its own challenge stage because the
  // combat stages between them cannot be cleared from a standstill.
  {
    name: 'challenge-one-perfect',
    seed: 'golden-challenge-one',
    inputSeed: 'fire-only',
    // The exact step the stage ends on, so the golden is about that stage and
    // nothing else: one step more and the score carries kills from stage 4.
    steps: 1_582,
    stage: 3,
    hold: FIRE_ONLY,
  },
  {
    name: 'challenge-two-perfect',
    seed: 'golden-challenge-two',
    inputSeed: 'fire-only',
    steps: 1_574,
    stage: 7,
    hold: FIRE_ONLY,
  },
];

export function goldenPath(name: string): string {
  return join(GOLDEN_DIR, `${name}.replay.json`);
}

/**
 * The input a golden is recorded with: one held frame, the capture pilot, a
 * steady sweep, or the scripted pilot.
 *
 * The capture pilot is a *factory* over the world rather than a plain source —
 * see {@link capturePilot} for why a golden is allowed to watch the run it is
 * recording.
 */
export function pilotFor(spec: GoldenSpec): InputSource | ((world: World) => InputSource) {
  if (spec.hold !== undefined) return constantInput(spec.hold);
  if (spec.capture === true) return capturePilot;
  if (spec.sweepPeriod !== undefined) return sweepingPilot(spec.sweepPeriod);
  return scriptedPilot(spec.inputSeed);
}

/**
 * Play a golden's own pilot against a fresh world, recording as it goes.
 *
 * The one place a golden is *produced*, used both by the writer below and by the
 * test that checks the committed log is still the log this pilot produces. It has
 * to be one function because a pilot may be a plain source or a factory over the
 * world ({@link capturePilot}), and the recorder has to wrap whichever it is.
 */
export function playGolden(spec: GoldenSpec): {
  readonly recorder: Recorder;
  readonly run: WorldRun;
} {
  const pilot = pilotFor(spec);
  let recorder: Recorder | undefined;
  const source = (world: World): InputSource => {
    recorder = recordInput(typeof pilot === 'function' ? pilot(world) : pilot, spec.seed);
    return recorder.source;
  };
  const run = runWorld(
    spec.seed,
    source,
    spec.steps,
    spec.rules ?? CLASSIC.rules,
    CLASSIC.stages,
    spec.stage,
  );
  if (recorder === undefined) throw new Error(`golden "${spec.name}" never built its pilot`);
  return { recorder, run };
}

export function recordGolden(spec: GoldenSpec): string {
  const { recorder, run } = playGolden(spec);
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
