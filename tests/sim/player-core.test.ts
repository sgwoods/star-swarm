import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolveDifficultyRow } from '../../src/content/rules.js';
import { EMPTY_FRAME, frameOf } from '../../src/engine/input.js';
import { createReplaySource, parseReplay, recordInput } from '../../src/engine/replay.js';
import { eventsOfType, type SimEvent } from '../../src/sim/events.js';
import type { World } from '../../src/sim/world.js';
import { createWorld, fingerprintWorld, stepWorld } from '../../src/sim/world.js';
import {
  classicStages,
  GOLDENS,
  goldenPath,
  pilotFor,
  runWorld,
} from '../../scripts/record-replay.js';
import { classicRules } from '../helpers/rules.js';

const rules = classicRules();
const stages = classicStages();

/**
 * Golden replays for the playable core (docs/DESIGN.md section 11).
 *
 * Each golden is a committed `(seed, input log, final state)` triple recorded by
 * `scripts/record-replay.ts`. Playing the log back has to land on the same final
 * state — which makes any change to movement, the shot cap, collision, the lives
 * logic, the entry choreography or the formation's motion show up here even when
 * nobody wrote an assertion for it. If a PR changes a golden file, that was either
 * deliberate or a regression; there is no third possibility, and the PR body has
 * to say which.
 *
 * These run on the Node project with no DOM. A simulation that reached for a
 * canvas would not survive the import, let alone the assertions.
 */
describe.each(GOLDENS)('golden replay: $name', (spec) => {
  const replay = parseReplay(readFileSync(goldenPath(spec.name), 'utf8'));
  const goldenRules = spec.rules ?? rules;

  it('lands on the recorded final state', () => {
    const run = runWorld(
      spec.seed,
      createReplaySource(replay, { onOverrun: 'throw' }),
      replay.steps,
      goldenRules,
      stages,
      spec.stage,
    );
    expect(run.fingerprint).toBe(replay.finalState);
  });

  it('passes through the same intermediate states, not just the same last one', () => {
    const play = () =>
      runWorld(
        spec.seed,
        createReplaySource(replay),
        replay.steps,
        goldenRules,
        stages,
        spec.stage,
      );
    expect(play().trace).toEqual(play().trace);
  });

  it('is the log the recorded pilot still produces', () => {
    // Guards the recorder itself: if the pilot or the input encoding changed,
    // the golden would still replay but would no longer be the run it claims.
    const recorder = recordInput(pilotFor(spec), spec.seed);
    runWorld(spec.seed, recorder.source, spec.steps, goldenRules, stages, spec.stage);
    expect(recorder.finish().runs).toEqual(replay.runs);
  });
});

describe('what the goldens actually cover', () => {
  /** Replay a golden and collect every event it raised, the first one included. */
  function replayEvents(name: string): { readonly events: SimEvent[]; readonly world: World } {
    const spec = GOLDENS.find((golden) => golden.name === name);
    if (spec === undefined) throw new Error(`no golden named ${name}`);
    const replay = parseReplay(readFileSync(goldenPath(name), 'utf8'));
    const source = createReplaySource(replay);
    const world = createWorld({
      seed: spec.seed,
      rules: spec.rules ?? rules,
      stages,
      ...(spec.stage !== undefined && { stage: spec.stage }),
    });
    const events: SimEvent[] = [...world.events];
    for (let i = 0; i < replay.steps; i += 1) events.push(...stepWorld(world, source.sample()));
    return { events, world };
  }

  it('flies a whole stage-1 entry, hands out all forty slots and settles centred', () => {
    const { events, world } = replayEvents('stage-entry');

    // Five waves of eight, and nothing the player did could change it: the log is
    // empty, so this golden is a record of the choreography alone.
    const launched = eventsOfType(events, 'enemy-launched');
    expect(launched).toHaveLength(40);
    expect(launched.filter((event) => event.wave === 1).map((event) => event.alienId)).toEqual([
      'warden',
      'warden',
      'warden',
      'warden',
      'wing',
      'wing',
      'wing',
      'wing',
    ]);

    // Every one of them took its own slot, and the formation settled exactly once.
    expect(new Set(world.fleet.enemies.map((enemy) => enemy.home)).size).toBe(40);
    const settled = eventsOfType(events, 'formation-settled');
    expect(settled).toHaveLength(1);
    expect(settled[0]?.enemies).toBe(40);
    expect(world.formation?.swayOffset).toBe(0);
    expect(world.formation?.motion).toBe('breathe');

    // Nothing was shot at, so nothing died and nothing scored — the fighter never
    // fires in this log. It is shot *at*, though: diving begins from the settle
    // and a fighter that never moves is hit.
    expect(eventsOfType(events, 'target-destroyed')).toHaveLength(0);
    expect(world.score).toBe(0);
    expect(eventsOfType(events, 'enemy-dived').length).toBeGreaterThan(0);
    expect(eventsOfType(events, 'player-hit').length).toBeGreaterThan(0);
  });

  it('never dives before the formation has settled', () => {
    // The gate this exists to protect: diving begins from `formation-settled` —
    // the frame the entry sway passes back through zero — and not from the last
    // wave arriving, which is some sixty frames earlier. A golden with no input at
    // all is the cleanest possible place to assert it.
    const spec = GOLDENS.find((golden) => golden.name === 'stage-entry');
    if (spec === undefined) throw new Error('no golden named stage-entry');
    const replay = parseReplay(readFileSync(goldenPath('stage-entry'), 'utf8'));
    const source = createReplaySource(replay);
    const world = createWorld({ seed: spec.seed, rules, stages });

    let settledAt = -1;
    let firstDiveAt = -1;
    let entryCompleteAt = -1;
    for (let i = 0; i < replay.steps; i += 1) {
      const step = stepWorld(world, source.sample());
      if (entryCompleteAt < 0 && world.fleet.entryComplete) entryCompleteAt = i;
      if (settledAt < 0 && eventsOfType(step, 'formation-settled').length > 0) settledAt = i;
      if (firstDiveAt < 0 && eventsOfType(step, 'enemy-dived').length > 0) firstDiveAt = i;
    }
    expect(entryCompleteAt).toBeGreaterThan(0);
    expect(settledAt).toBeGreaterThan(entryCompleteAt);
    expect(firstDiveAt).toBeGreaterThan(settledAt);
  });

  it('plays a fighter through a stage until the last ship is lost', () => {
    const { events, world } = replayEvents('player-core');

    expect(eventsOfType(events, 'enemy-launched')).toHaveLength(40);
    expect(eventsOfType(events, 'target-destroyed').length).toBeGreaterThan(10);
    // Wardens take two hits, so a run this long has plenty of non-fatal ones.
    expect(eventsOfType(events, 'target-hit').length).toBeGreaterThan(0);
    // The game fights back now, and a pilot that jabs at the controls in front of
    // a diver loses all three ships. The frozen tail is the point: once the run is
    // over the world does nothing at all.
    expect(eventsOfType(events, 'enemy-dived').length).toBeGreaterThan(0);
    expect(eventsOfType(events, 'enemy-fired').length).toBeGreaterThan(0);
    expect(eventsOfType(events, 'game-over')).toHaveLength(1);
    expect(world.status).toBe('game-over');

    const started = eventsOfType(events, 'stage-started');
    expect(started.map((event) => event.stage)).toEqual([1]);
    expect(started.every((event) => event.starfieldSpeed === 0x40)).toBe(true);
  });

  it('clears stage 1 on a five-ship cabinet and rolls on to stage 2', () => {
    const { events } = replayEvents('player-survival');
    expect(eventsOfType(events, 'stage-cleared').map((event) => event.stage)).toEqual([1]);
    expect(eventsOfType(events, 'stage-started').map((event) => event.stage)).toEqual([1, 2]);
    expect(eventsOfType(events, 'formation-settled').length).toBeGreaterThanOrEqual(1);
    // Five ships, so more player-hits than a three-ship cabinet survives.
    expect(eventsOfType(events, 'player-hit').length).toBeGreaterThan(3);
  });

  it('plays the ramp’s stage-20 row, bump, alternative bomb vectors and transform', () => {
    const { events, world } = replayEvents('stage-dives');

    // The ramp *selects*: stage 20's row raises the diver limit well past stage
    // 1's two, and the later bump raises it again. Read from the rules rather than
    // from the world, which has already rolled on to stage 21 by the end.
    const row = resolveDifficultyRow(rules, 20);
    expect([row?.maxDivers, row?.maxDiversBump]).toEqual([4, 6]);
    expect(row?.reloadBombVectors).toBe(true);
    expect(resolveDifficultyRow(rules, 1)?.maxDivers).toBe(2);
    // And the world moved on to the *next* row when the stage changed.
    expect(world.dive.row).toEqual(resolveDifficultyRow(rules, world.stage));

    // Enough bombs in the air to reach the eight-slot global cap, which stage 1
    // never gets near.
    expect(eventsOfType(events, 'enemy-fired').length).toBeGreaterThan(50);

    // And the transform: once per stage, from stage 4, once fewer than ten remain.
    const transformed = eventsOfType(events, 'enemy-transformed');
    expect(transformed).toHaveLength(1);
    expect(transformed[0]?.group).toHaveLength(rules.transform?.groupSize ?? 0);
    expect(rules.transform?.types).toContain(transformed[0]?.alienId);
    // The trio leaves the screen rather than rejoining the formation.
    expect(eventsOfType(events, 'enemy-departed').length).toBeGreaterThan(0);
  });
});

describe('determinism of the world itself', () => {
  it('is a pure function of seed and input frames', () => {
    const fire = frameOf('fire', 'right');
    const run = (seed: string): string => {
      const world = createWorld({ seed, rules, stages });
      for (let i = 0; i < 1_200; i += 1) stepWorld(world, fire);
      return fingerprintWorld(world);
    };
    expect(run('same')).toBe(run('same'));
    expect(run('same')).not.toBe(run('different'));
  });

  it('carries the generator’s position in the fingerprint', () => {
    const world = createWorld({ seed: 'stream', rules, stages });
    expect(fingerprintWorld(world)).toContain(JSON.stringify(world.rng.getState()));
  });

  it('scripts the entry rather than rolling for it, but rolls for the dives', () => {
    // Two halves of one claim. Entry choreography is a stage document, not a roll,
    // so two seeds fly identical waves right up to the settle — which is what
    // makes a wave reproducible from the pack alone. Dive selection is the first
    // real consumer of the generator, so past the settle the two diverge.
    const fleet = (seed: string, steps: number): string => {
      const world = createWorld({ seed, rules, stages });
      for (let i = 0; i < steps; i += 1) stepWorld(world, EMPTY_FRAME);
      return JSON.stringify(
        world.fleet.enemies.map((enemy) => [enemy.id, enemy.state, enemy.x, enemy.y]),
      );
    };
    expect(fleet('one', 900)).toBe(fleet('two', 900));
    expect(fleet('one', 1_400)).not.toBe(fleet('two', 1_400));
  });
});
