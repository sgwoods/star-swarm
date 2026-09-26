import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

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
    );
    expect(run.fingerprint).toBe(replay.finalState);
  });

  it('passes through the same intermediate states, not just the same last one', () => {
    const a = runWorld(spec.seed, createReplaySource(replay), replay.steps, goldenRules);
    const b = runWorld(spec.seed, createReplaySource(replay), replay.steps, goldenRules);
    expect(b.trace).toEqual(a.trace);
  });

  it('is the log the recorded pilot still produces', () => {
    // Guards the recorder itself: if the pilot or the input encoding changed,
    // the golden would still replay but would no longer be the run it claims.
    const recorder = recordInput(pilotFor(spec), spec.seed);
    runWorld(spec.seed, recorder.source, spec.steps, rules);
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
    const world = createWorld({ seed: spec.seed, rules: spec.rules ?? rules, stages });
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
    expect(world.fleet.enemies.every((enemy) => enemy.state === 'home')).toBe(true);
    expect(new Set(world.fleet.enemies.map((enemy) => enemy.home)).size).toBe(40);
    expect(eventsOfType(events, 'formation-settled')).toHaveLength(1);
    expect(world.formation?.swayOffset).toBe(0);
    expect(world.formation?.motion).toBe('breathe');

    // Nothing was shot at, so nothing died and nothing scored.
    expect(eventsOfType(events, 'target-destroyed')).toHaveLength(0);
    expect(world.score).toBe(0);
  });

  it('plays a fighter through a stage, clears it and rolls on', () => {
    const { events } = replayEvents('player-core');

    expect(eventsOfType(events, 'enemy-launched').length).toBeGreaterThan(40);
    expect(eventsOfType(events, 'target-destroyed').length).toBeGreaterThan(20);
    // Wardens take two hits, so a run this long has plenty of non-fatal ones.
    expect(eventsOfType(events, 'target-hit').length).toBeGreaterThan(0);
    expect(eventsOfType(events, 'stage-cleared').length).toBeGreaterThanOrEqual(1);
    const started = eventsOfType(events, 'stage-started');
    expect(started.map((event) => event.stage)).toEqual([1, 2]);
    // Stages 1 and 2 share a speed tier; the byte is still reported per stage.
    expect(started.every((event) => event.starfieldSpeed === 0x40)).toBe(true);
  });

  it('covers a second, longer run on another seed', () => {
    const { events } = replayEvents('player-survival');
    expect(eventsOfType(events, 'stage-cleared').length).toBeGreaterThanOrEqual(1);
    expect(eventsOfType(events, 'formation-settled').length).toBeGreaterThanOrEqual(2);
    // Nothing shoots back yet — enemy fire and dives are the sibling tasks — so a
    // fighter that is never rammed survives the whole run. This assertion is what
    // will notice when that stops being true.
    expect(eventsOfType(events, 'player-hit')).toHaveLength(0);
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

  it('scripts the entry rather than rolling for it, so the seed does not move a wave', () => {
    // Worth stating rather than assuming: nothing the simulation does yet draws
    // from the generator. Entry choreography is a stage document, not a roll, so
    // two seeds fly identical waves. Dive selection is the first real consumer,
    // and when it lands this assertion is the one that should change.
    const fleet = (seed: string): string => {
      const world = createWorld({ seed, rules, stages });
      for (let i = 0; i < 900; i += 1) stepWorld(world, EMPTY_FRAME);
      return JSON.stringify(
        world.fleet.enemies.map((enemy) => [enemy.id, enemy.state, enemy.x, enemy.y]),
      );
    };
    expect(fleet('one')).toBe(fleet('two'));
  });
});
