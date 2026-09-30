/**
 * The claim the four persona names make: **beginner, normal, expert, astronaut is
 * an ordering, and it is an ordering of outcomes.**
 *
 * This lives in `tests/sim/` rather than `tests/unit/` because it is the one
 * autoplay test that has to play whole games: a persona's quality is not visible
 * in a frame or a hundred, and a single seed says nothing at all — the astronaut
 * loses a run to a bad dive and the beginner has a lucky one, and any pair of
 * single runs can come out either way round. So this plays every persona over a
 * block of seeds and compares the distributions, which is the only honest form of
 * the claim.
 *
 * It is also the test that would catch a persona tuned into the ground, which is
 * the most likely way for these four documents to rot: they are numbers in a JSON
 * file and nothing else holds them to their labels.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { Persona } from '../../src/content/personas.js';
import { createWorld, stepWorld } from '../../src/sim/world.js';
import { autopilotSource } from '../../src/ui/autoplay.js';
import { classicRules, classicStages } from '../helpers/rules.js';
import { shippedVariants } from '../helpers/variants.js';

/**
 * How long a run is given, in simulation steps, and how many seeds each persona
 * plays.
 *
 * Three minutes is long enough for every persona to lose its three fighters —
 * measured, the longest average is under a minute — so a run almost always ends by
 * game over rather than by the clock, and the score is the whole run's rather than
 * a slice of one.
 *
 * Thirty-two seeds because **sixteen is not enough**: at sixteen, on this seed
 * family, the expert's median run came out forty points under the normal's and this
 * file failed — correctly, because at that sample size the ordering genuinely is not
 * there to be seen. The whole suite of four orderings holds from twenty-four seeds
 * up and was checked at forty-eight; thirty-two is the middle of that with room
 * either side, and the four personas together cost about two seconds.
 */
const STEPS = 3 * 60 * 60;
const SEEDS = 32;

function personas(): readonly Persona[] {
  const classic = shippedVariants().find((variant) => variant.id === 'classic');
  if (classic === undefined) throw new Error('variants/classic.json did not load');
  return classic.personas;
}

interface Run {
  readonly score: number;
  readonly steps: number;
  readonly stage: number;
}

/** One whole game, played by one persona, on the shipped Classic content. */
function play(persona: Persona, seed: string): Run {
  const world = createWorld({ seed, rules: classicRules(), stages: classicStages() });
  const pilot = autopilotSource(world, { persona, seed: `pilot:${seed}` });
  let steps = 0;
  let stage = world.stage;
  for (; steps < STEPS && world.status === 'playing'; steps += 1) {
    stepWorld(world, pilot.sample());
    stage = Math.max(stage, world.stage);
  }
  return { score: world.score, steps, stage };
}

interface Outcome {
  readonly id: string;
  readonly mean: number;
  readonly median: number;
  readonly worst: number;
  readonly survived: number;
  readonly bestStage: number;
}

function outcomeOf(persona: Persona): Outcome {
  const runs = Array.from({ length: SEEDS }, (_unused, index) => play(persona, `persona-${index}`));
  const scores = runs.map((run) => run.score).sort((a, b) => a - b);
  const mean = scores.reduce((total, score) => total + score, 0) / scores.length;
  return {
    id: persona.id,
    mean,
    median: scores[Math.floor(scores.length / 2)] ?? 0,
    worst: scores[0] ?? 0,
    survived: runs.reduce((total, run) => total + run.steps, 0) / runs.length,
    bestStage: Math.max(...runs.map((run) => run.stage)),
  };
}

/**
 * Measured once and shared, because each of these is {@link SEEDS} whole games and
 * the assertions below are several readings of one experiment rather than several
 * experiments.
 *
 * In `beforeAll` rather than memoised behind the first assertion that asks, with a
 * timeout of its own: a hundred and twenty-eight three-minute games is a few seconds
 * of work, and charged to whichever `it` happened to run first it blew the default
 * five-second budget as soon as the rest of the suite was running beside it.
 */
let measured: readonly Outcome[] = [];
function outcomes(): readonly Outcome[] {
  return measured;
}

describe('the four personas are ordered by outcome', () => {
  beforeAll(() => {
    measured = personas().map(outcomeOf);
  }, 120_000);

  it('ships them in the order their names claim', () => {
    // The order in the document *is* the claim: the settings row walks this list, so
    // a reordered document would offer a ladder that does not climb.
    expect(personas().map((persona) => persona.id)).toEqual([
      'beginner',
      'normal',
      'expert',
      'astronaut',
    ]);
  });

  it('scores higher on average at each step up the ladder', () => {
    const means = outcomes().map((outcome) => outcome.mean);
    for (let i = 1; i < means.length; i += 1) {
      expect(means[i]).toBeGreaterThan(means[i - 1] ?? 0);
    }
  });

  it('scores higher in the median run too, not only on average', () => {
    // A mean can be carried by one long run. The median is the claim a watcher
    // actually experiences: pick a persona, watch one game, and the better name
    // should usually do better.
    const medians = outcomes().map((outcome) => outcome.median);
    for (let i = 1; i < medians.length; i += 1) {
      expect(medians[i]).toBeGreaterThan(medians[i - 1] ?? 0);
    }
  });

  it('survives longer at each step up the ladder', () => {
    // The second half of what the names promise, and the one that is visible without
    // reading the score: a better pilot keeps its three fighters longer.
    const survived = outcomes().map((outcome) => outcome.survived);
    for (let i = 1; i < survived.length; i += 1) {
      expect(survived[i]).toBeGreaterThan(survived[i - 1] ?? 0);
    }
  });

  it('is clearly, not marginally, a ladder from end to end', () => {
    const first = outcomes()[0];
    const last = outcomes()[outcomes().length - 1];
    expect(first?.id).toBe('beginner');
    expect(last?.id).toBe('astronaut');
    // Half again as much, at least. A ladder whose ends are ten percent apart is
    // four tunings of one pilot with four labels on it.
    expect(last?.mean ?? 0).toBeGreaterThan((first?.mean ?? 0) * 1.5);
  });

  it('gets the astronaut further into the game than anyone else', () => {
    // The difference a watcher sees rather than reads: the astronaut clears stage 1
    // and goes on, and the beginner does not get out of it.
    const beginner = outcomes().find((outcome) => outcome.id === 'beginner');
    const astronaut = outcomes().find((outcome) => outcome.id === 'astronaut');
    expect(beginner?.bestStage).toBe(1);
    expect(astronaut?.bestStage ?? 0).toBeGreaterThan(1);
  });

  it('gives even the beginner a real game rather than an instant loss', () => {
    // The other half of "ordered": the bottom of the ladder still has to be worth
    // watching. Every persona scores on every seed and survives the stage-1 entry,
    // which is about 1,024 steps.
    for (const outcome of outcomes()) {
      expect(outcome.worst).toBeGreaterThan(0);
      expect(outcome.survived).toBeGreaterThan(1_100);
    }
  });
});
