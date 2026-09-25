import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { frameOf } from '../../src/engine/input.js';
import { createReplaySource, parseReplay, recordInput } from '../../src/engine/replay.js';
import { eventsOfType, type SimEvent } from '../../src/sim/events.js';
import { createWorld, fingerprintWorld, stepWorld } from '../../src/sim/world.js';
import { GOLDENS, goldenPath, runWorld, scriptedPilot } from '../../scripts/record-replay.js';

/**
 * Golden replays for the playable core (docs/DESIGN.md section 11).
 *
 * Each golden is a committed `(seed, input log, final state)` triple recorded by
 * `scripts/record-replay.ts`. Playing the log back has to land on the same final
 * state — which makes any change to movement, the shot cap, collision or the
 * lives logic show up here even when nobody wrote an assertion for it. If a PR
 * changes a golden file, that was either deliberate or a regression; there is no
 * third possibility, and the PR body has to say which.
 *
 * These run on the Node project with no DOM. A simulation that reached for a
 * canvas would not survive the import, let alone the assertions.
 */
describe.each(GOLDENS)('golden replay: $name', (spec) => {
  const replay = parseReplay(readFileSync(goldenPath(spec.name), 'utf8'));
  const rules = spec.rules;

  it('lands on the recorded final state', () => {
    const run = runWorld(
      spec.seed,
      createReplaySource(replay, { onOverrun: 'throw' }),
      replay.steps,
      rules,
    );
    expect(run.fingerprint).toBe(replay.finalState);
  });

  it('passes through the same intermediate states, not just the same last one', () => {
    const a = runWorld(spec.seed, createReplaySource(replay), replay.steps, rules);
    const b = runWorld(spec.seed, createReplaySource(replay), replay.steps, rules);
    expect(b.trace).toEqual(a.trace);
  });

  it('is the log the scripted pilot still produces', () => {
    // Guards the recorder itself: if the pilot or the input encoding changed,
    // the golden would still replay but would no longer be the run it claims.
    const recorder = recordInput(scriptedPilot(spec.inputSeed), spec.seed);
    runWorld(spec.seed, recorder.source, spec.steps, rules);
    expect(recorder.finish().runs).toEqual(replay.runs);
  });

  it('ends somewhere else on a different seed', () => {
    const elsewhere = runWorld(
      `${spec.seed}-other`,
      createReplaySource(replay),
      replay.steps,
      rules,
    );
    expect(elsewhere.fingerprint).not.toBe(replay.finalState);
  });
});

describe('what the goldens actually cover', () => {
  it('plays a fighter all the way to game over', () => {
    const core = GOLDENS.find((golden) => golden.name === 'player-core');
    expect(core).toBeDefined();
    if (core === undefined) return;

    const replay = parseReplay(readFileSync(goldenPath(core.name), 'utf8'));
    const source = createReplaySource(replay);
    const world = createWorld({ seed: core.seed });
    const events: SimEvent[] = [];
    for (let i = 0; i < replay.steps; i += 1) events.push(...stepWorld(world, source.sample()));

    expect(eventsOfType(events, 'target-destroyed').length).toBeGreaterThan(20);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(3);
    // Two of the three hits bring another fighter out; the third ends the game.
    expect(eventsOfType(events, 'player-ready')).toHaveLength(2);
    expect(eventsOfType(events, 'stage-cleared').length).toBeGreaterThanOrEqual(1);
    expect(eventsOfType(events, 'game-over')).toHaveLength(1);
  });

  it('clears a stage and picks up the faster starfield with it', () => {
    const survival = GOLDENS.find((golden) => golden.name === 'player-survival');
    expect(survival).toBeDefined();
    if (survival === undefined) return;

    const replay = parseReplay(readFileSync(goldenPath(survival.name), 'utf8'));
    const source = createReplaySource(replay);
    const world = createWorld({
      seed: survival.seed,
      ...(survival.rules && { rules: survival.rules }),
    });
    const events: SimEvent[] = [...world.events];
    for (let i = 0; i < replay.steps; i += 1) events.push(...stepWorld(world, source.sample()));

    const started = eventsOfType(events, 'stage-started');
    expect(started.length).toBeGreaterThanOrEqual(2);
    expect(started.map((event) => event.stage)).toEqual([1, 2]);
    // Stages 1 and 2 share a speed tier; the byte is still reported per stage.
    expect(started.every((event) => event.starfieldSpeed === 0x40)).toBe(true);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(0);
  });
});

describe('determinism of the world itself', () => {
  it('is a pure function of seed and input frames', () => {
    const fire = frameOf('fire', 'right');
    const run = (seed: string): string => {
      const world = createWorld({ seed });
      for (let i = 0; i < 1_200; i += 1) stepWorld(world, fire);
      return fingerprintWorld(world);
    };
    expect(run('same')).toBe(run('same'));
    expect(run('same')).not.toBe(run('different'));
  });

  it('draws from the seeded stream, and carries its position in the fingerprint', () => {
    // The stand-in formation's firing stagger is drawn from the sim's own
    // generator, so the seed reaches the simulation rather than only the
    // presentation — and the generator's position rides along in the
    // fingerprint, which is what catches a change that only diverges later.
    const timers = (seed: string): number[] =>
      createWorld({ seed }).targets.map((target) => target.fireTimer);
    expect(timers('stream')).toEqual(timers('stream'));
    expect(timers('stream')).not.toEqual(timers('other-stream'));

    const world = createWorld({ seed: 'stream' });
    expect(fingerprintWorld(world)).toContain(JSON.stringify(world.rng.getState()));
  });
});
