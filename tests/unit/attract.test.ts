import { describe, expect, it } from 'vitest';

import { assertReplayCompatible, replayFrames } from '../../src/engine/replay.js';
import { STEP_HZ } from '../../src/engine/loop.js';
import type { Persona } from '../../src/content/personas.js';
import type { Rules } from '../../src/content/schema.js';
import {
  type AttractDemo,
  attractCard,
  CARD_STEPS,
  createAttractDemo,
  createAttractReplay,
  DEMO_SCRIPT,
  DEMO_TURN_STEPS,
  demoRota,
} from '../../src/ui/attract.js';
import { launchEnemyBullet } from '../../src/sim/shots.js';
import { fingerprintWorld } from '../../src/sim/world.js';
import { classicRules, classicStages, quickRunRules } from '../helpers/rules.js';
import { shippedVariants } from '../helpers/variants.js';

describe('the demo input log', () => {
  it('is a replay this build can play back', () => {
    const replay = createAttractReplay();
    expect(() => {
      assertReplayCompatible(replay);
    }).not.toThrow();
    expect(replay.stepHz).toBe(STEP_HZ);
    expect(replay.steps).toBe(replayFrames(replay).length);
  });

  it('runs long enough to be worth watching', () => {
    // Twenty seconds or more: shorter and the loop restarts before a passer-by
    // has seen the ship do anything.
    expect(createAttractReplay().steps).toBeGreaterThanOrEqual(20 * STEP_HZ);
    expect(DEMO_SCRIPT.every(([, count]) => count > 0)).toBe(true);
  });
});

/**
 * Everything below `the attract demo` that names no persona is about **the
 * script**: a demo built without personas is the variant-with-none case, which is
 * Swarm Remix's and a bare-rules flow's. The persona cycle has its own block.
 */
describe('the attract demo', () => {
  it('runs the real simulation, one step per advance', () => {
    const demo = createAttractDemo({ rules: classicRules(), stages: classicStages() });
    for (let i = 0; i < 300; i += 1) demo.advance();
    expect(demo.world.step).toBe(300);
    expect(demo.step).toBe(300);
  });

  it('plays the ship rather than animating it: the log moves it and fires', () => {
    const demo = createAttractDemo({ rules: classicRules(), stages: classicStages() });
    const startX = demo.world.player.x;
    let shots = 0;
    for (let i = 0; i < 300; i += 1) {
      shots += demo.advance().filter((event) => event.type === 'shot-fired').length;
    }
    expect(demo.world.player.x).not.toBe(startX);
    expect(shots).toBeGreaterThan(0);
  });

  it('loops back to the top when the log runs out', () => {
    const replay = { ...createAttractReplay(), steps: 30, runs: [[0, 30] as const] };
    const demo = createAttractDemo({ rules: classicRules(), stages: classicStages(), replay });
    for (let i = 0; i < 30; i += 1) demo.advance();
    expect(demo.loops).toBe(0);
    expect(demo.world.step).toBe(30);

    demo.advance();
    expect(demo.loops).toBe(1);
    expect(demo.world.step).toBe(0);
  });

  it('starts over rather than sitting on a dead ship', () => {
    // Nothing in the simulation shoots at the fighter yet — enemy fire is a
    // sibling's task — so the bomb comes from the test, exactly as it does in
    // `tests/unit/world.test.ts`. On `quickRunRules`' single fighter it ends the
    // demo's run, which is the case this is about.
    const demo = createAttractDemo({ rules: quickRunRules(), stages: classicStages() });
    for (let i = 0; i < 60; i += 1) demo.advance();

    const world = demo.world;
    launchEnemyBullet(world.enemyBullets, world.player.x, world.player.y - 2, 0, 2);
    demo.advance();
    expect(world.status).toBe('game-over');

    demo.advance();
    expect(demo.loops).toBe(1);
    expect(demo.world.status).toBe('playing');
    expect(demo.world.step).toBe(0);
  });

  it('is reproducible: the same seed replays to the same place', () => {
    const rules = classicRules();
    const a = createAttractDemo({ rules, stages: classicStages() });
    const b = createAttractDemo({ rules, stages: classicStages() });
    for (let i = 0; i < 600; i += 1) {
      a.advance();
      b.advance();
    }
    expect(a.world.player.x).toBe(b.world.player.x);
    expect(a.world.score).toBe(b.world.score);
  });
});

/** The shipped Classic personas, in menu order, and the one the document names first. */
function classic(): { readonly personas: readonly Persona[]; readonly first: Persona | undefined } {
  const variant = shippedVariants().find((candidate) => candidate.id === 'classic');
  if (variant === undefined) throw new Error('variants/classic.json did not load');
  return { personas: variant.personas, first: variant.defaultPersona };
}

/** The shipped rules on one fighter, so a persona's leg is one life long. */
function oneFighter(): Rules {
  const rules = structuredClone(classicRules());
  rules.lives.default = 1;
  return rules;
}

interface Leg {
  readonly persona: string;
  readonly steps: number;
  readonly fingerprint: string;
}

/** Play the demo through `count` legs and say who flew each and how it ended. */
function legs(demo: AttractDemo, count: number, limit = 40_000): Leg[] {
  const out: Leg[] = [];
  for (let guard = 0; out.length < count && guard < limit; guard += 1) {
    const persona = demo.persona?.id ?? '(script)';
    const { world, step, loops } = demo;
    demo.advance();
    if (demo.loops !== loops)
      out.push({ persona, steps: step, fingerprint: fingerprintWorld(world) });
  }
  return out;
}

describe('the attract demo, flown by personas', () => {
  it('takes turns in menu order, starting from the default and wrapping round', () => {
    const { personas, first } = classic();
    expect(first?.id).toBe('normal');
    expect(demoRota(personas, first).map((persona) => persona.id)).toEqual([
      'normal',
      'expert',
      'astronaut',
      'beginner',
    ]);
  });

  it('starts from the top when no default is named, or the default is not on the list', () => {
    const { personas } = classic();
    const ids = personas.map((persona) => persona.id);
    expect(demoRota(personas, undefined).map((persona) => persona.id)).toEqual(ids);
    const stranger = { ...personas[1], id: 'nobody' } as Persona;
    expect(demoRota(personas, stranger).map((persona) => persona.id)).toEqual(ids);
    expect(demoRota([], undefined)).toEqual([]);
  });

  it('is flown by the default persona first, through the real simulation', () => {
    const { personas, first } = classic();
    const demo = createAttractDemo({
      rules: classicRules(),
      stages: classicStages(),
      personas,
      first,
    });
    expect(demo.persona?.id).toBe('normal');
    const startX = demo.world.player.x;
    let shots = 0;
    for (let i = 0; i < 300; i += 1) {
      shots += demo.advance().filter((event) => event.type === 'shot-fired').length;
    }
    // One `stepWorld` per advance, and a ship that moves and fires: the pilot
    // presses buttons, the simulation does the rest.
    expect(demo.world.step).toBe(300);
    expect(demo.step).toBe(300);
    expect(demo.world.player.x).not.toBe(startX);
    expect(shots).toBeGreaterThan(0);
  });

  it('hands over to the next persona when a run ends, and comes round again', () => {
    const { personas, first } = classic();
    const demo = createAttractDemo({
      rules: oneFighter(),
      stages: classicStages(),
      personas,
      first,
    });
    const played = legs(demo, 5);
    expect(played.map((leg) => leg.persona)).toEqual([
      'normal',
      'expert',
      'astronaut',
      'beginner',
      'normal',
    ]);
    // Every leg ended the honest way — a game over, long before the ceiling.
    expect(played.every((leg) => leg.steps < DEMO_TURN_STEPS)).toBe(true);
  });

  it('repeats exactly: a leg plays the same run every time it comes round', () => {
    // The same world seed for every leg and a pilot seed the cycle never advances,
    // so the whole cycle is a pure function of the variant — the property
    // `DEMO_SEED` was fixed for.
    const personas = classic().personas.slice(0, 2);
    const demo = createAttractDemo({ rules: oneFighter(), stages: classicStages(), personas });
    const [a, b, againA, againB] = legs(demo, 4);
    expect(againA).toEqual(a);
    expect(againB).toEqual(b);
    // And the two personas really did play differently on the same fleet.
    expect(a?.fingerprint).not.toBe(b?.fingerprint);
  });

  it('cuts a persona off at the ceiling, so one that never dies cannot hold the screen', () => {
    const personas = classic().personas.slice(0, 2);
    const demo = createAttractDemo({
      rules: classicRules(),
      stages: classicStages(),
      personas,
      turnSteps: 50,
    });
    for (let i = 0; i < 50; i += 1) demo.advance();
    expect(demo.loops).toBe(0);
    demo.advance();
    expect(demo.loops).toBe(1);
    expect(demo.persona?.id).toBe(personas[1]?.id);
    expect(demo.world.step).toBe(0);
  });

  it('runs at the rank it is given, as a game would', () => {
    const demo = createAttractDemo({ rules: classicRules(), stages: classicStages(), rank: 'D' });
    expect(demo.world.rank).toBe('D');
  });

  it('falls back to the script, and names nobody, when there are no personas', () => {
    const scripted = createAttractDemo({ rules: classicRules(), stages: classicStages() });
    const empty = createAttractDemo({
      rules: classicRules(),
      stages: classicStages(),
      personas: [],
    });
    expect(scripted.persona).toBeUndefined();
    expect(empty.persona).toBeUndefined();
    for (let i = 0; i < 600; i += 1) {
      scripted.advance();
      empty.advance();
    }
    expect(fingerprintWorld(empty.world)).toBe(fingerprintWorld(scripted.world));
  });
});

describe('the attract cards', () => {
  it('alternates title and high scores on a fixed period', () => {
    expect(attractCard(0)).toBe('title');
    expect(attractCard(CARD_STEPS - 1)).toBe('title');
    expect(attractCard(CARD_STEPS)).toBe('scores');
    expect(attractCard(2 * CARD_STEPS)).toBe('title');
  });

  it('never divides by zero, whatever it is handed', () => {
    expect(attractCard(-10)).toBe('title');
    expect(attractCard(5, 0)).toBe('scores');
  });
});
