/**
 * The autoplay pilot: the four rules its module header states, tested rather
 * than trusted.
 *
 * The one that needs saying out loud is **no cheating**. "A persona sees only what
 * a player sees" is not a property of a comment, it is a property of the seam:
 * `createAutopilot` takes a {@link PilotView} and never a `World`, and
 * `viewOfWorld` builds that view out of copied numbers. So there are two things to
 * check and both are checkable — that the view carries nothing a player could not
 * see, and that a whole run of sampling cannot move the world by one bit.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Persona } from '../../src/content/personas.js';
import { actionsOf, isDown } from '../../src/engine/input.js';
import { createWorld, fingerprintWorld, stepWorld } from '../../src/sim/world.js';
import {
  autopilotSource,
  createAutopilot,
  type PilotView,
  type Sighting,
  viewOfWorld,
} from '../../src/ui/autoplay.js';
import { classicRules, classicStages } from '../helpers/rules.js';
import { shippedVariants } from '../helpers/variants.js';

/** The shipped Classic personas, which are what a watcher actually gets. */
function personas(): readonly Persona[] {
  const classic = shippedVariants().find((variant) => variant.id === 'classic');
  if (classic === undefined) throw new Error('variants/classic.json did not load');
  return classic.personas;
}

function personaNamed(id: string): Persona {
  const found = personas().find((persona) => persona.id === id);
  if (found === undefined) throw new Error(`no shipped persona "${id}"`);
  return found;
}

function newWorld(seed = 'autoplay-test') {
  return createWorld({ seed, rules: classicRules(), stages: classicStages() });
}

/** Play `steps` of a real game with a real pilot, and report what happened. */
function play(
  persona: Persona,
  seed: string,
  steps: number,
): {
  readonly score: number;
  readonly steps: number;
  readonly stage: number;
  readonly moved: number;
  readonly fired: number;
  readonly fingerprint: string;
} {
  const world = newWorld(seed);
  const pilot = autopilotSource(world, { persona, seed: `pilot:${seed}` });
  let ran = 0;
  let stage = world.stage;
  let moved = 0;
  let fired = 0;
  let lastX = world.player.x;
  for (; ran < steps && world.status === 'playing'; ran += 1) {
    const frame = pilot.sample();
    if (isDown(frame, 'fire')) fired += 1;
    stepWorld(world, frame);
    if (world.player.x !== lastX) moved += 1;
    lastX = world.player.x;
    stage = Math.max(stage, world.stage);
  }
  return {
    score: world.score,
    steps: ran,
    stage,
    moved,
    fired,
    fingerprint: fingerprintWorld(world),
  };
}

/* -------------------------------------------------------------------------- */
/* The view is what a player sees, and nothing else                            */
/* -------------------------------------------------------------------------- */

describe('the view a pilot is handed', () => {
  it('carries exactly the fields a player can see', () => {
    // A guard, like `tests/unit/settings.test.ts`'s on the settings shape. A field
    // added here that the simulation knows and the screen does not is a persona
    // reading the stage script, so this list is the review.
    expect(Object.keys(viewOfWorld(newWorld())).sort()).toEqual([
      'beam',
      'bombs',
      'enemies',
      'fighter',
      'maxX',
      'minX',
      'shotSpeed',
      'shotsFree',
      'step',
      'strikeDepth',
      'strikeWidth',
    ]);
  });

  it('describes a sighting by what is drawn, not by what the fleet knows', () => {
    const world = newWorld();
    // Far enough in that the entry is under way and there is something on screen.
    for (let i = 0; i < 300; i += 1) stepWorld(world, 0);
    const view = viewOfWorld(world);
    expect(view.enemies.length).toBeGreaterThan(0);
    for (const sighting of view.enemies) {
      expect(Object.keys(sighting).sort()).toEqual(['captured', 'flying', 'id', 'x', 'y']);
    }
  });

  it('shows the enemies the renderer draws and no others', () => {
    const world = newWorld();
    for (let i = 0; i < 300; i += 1) stepWorld(world, 0);
    // `standby` has not launched and `dead` is off the field: `src/render/scene.ts`
    // draws neither, so neither may be visible to a pilot.
    const drawn = world.fleet.enemies.filter(
      (enemy) => enemy.state !== 'standby' && enemy.state !== 'dead',
    );
    expect(
      viewOfWorld(world)
        .enemies.map((sighting) => sighting.id)
        .sort(),
    ).toEqual(drawn.map((enemy) => enemy.id).sort());
    expect(drawn.length).toBeLessThan(world.fleet.enemies.length);
  });

  it('hides the fighter while it is off the field', () => {
    const world = newWorld();
    world.player.alive = false;
    expect(viewOfWorld(world).fighter).toBeUndefined();
  });

  it('shares no object with the world, so a pilot has nothing to write to', () => {
    const world = newWorld();
    for (let i = 0; i < 300; i += 1) stepWorld(world, 0);
    const view = viewOfWorld(world);
    const sighting = view.enemies[0];
    expect(sighting).toBeDefined();
    // Not the enemy itself, and not a proxy for it: a copy. Moving the copy must
    // leave the fleet where it was.
    const enemy = world.fleet.enemies.find((candidate) => candidate.id === sighting?.id);
    expect(enemy).toBeDefined();
    expect<unknown>(sighting).not.toBe(enemy);
    const before = enemy?.x ?? 0;
    (sighting as { x: number }).x = before + 1000;
    expect(enemy?.x).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* No cheating                                                                 */
/* -------------------------------------------------------------------------- */

describe('a persona plays without cheating', () => {
  it('cannot move the world by sampling it, over a whole stage', () => {
    // The strongest form of the claim: build the view and run the pilot 1,200 times
    // against a world nobody is stepping, and the world must be bit-for-bit where
    // it started. A pilot that reached through the projection would show up here.
    const world = newWorld();
    for (let i = 0; i < 900; i += 1) stepWorld(world, 0);
    const before = fingerprintWorld(world);
    const pilot = createAutopilot({ persona: personaNamed('astronaut'), seed: 'probe' });
    for (let i = 0; i < 1_200; i += 1) pilot.sample(viewOfWorld(world));
    expect(fingerprintWorld(world)).toBe(before);
  });

  it('presses only the buttons a cabinet has under the fighter', () => {
    // Move and fire. Never `start`, which is a screen's, and never `menu`, which is
    // the front end's own service button — a persona that could press either would
    // be driving the flow rather than playing the game.
    for (const persona of personas()) {
      const world = newWorld(`buttons-${persona.id}`);
      const pilot = autopilotSource(world, { persona, seed: `buttons:${persona.id}` });
      for (let i = 0; i < 1_500 && world.status === 'playing'; i += 1) {
        const frame = pilot.sample();
        for (const action of actionsOf(frame)) {
          expect(['left', 'right', 'fire']).toContain(action);
        }
        stepWorld(world, frame);
      }
    }
  });

  it('never asks for left and right at once, which a stick cannot do', () => {
    const world = newWorld('stick');
    const pilot = autopilotSource(world, { persona: personaNamed('beginner'), seed: 'stick' });
    for (let i = 0; i < 1_500 && world.status === 'playing'; i += 1) {
      const frame = pilot.sample();
      expect(isDown(frame, 'left') && isDown(frame, 'right')).toBe(false);
      stepWorld(world, frame);
    }
  });

  it('is a pure function of the views it is given', () => {
    // Two pilots on the same seed, fed the *same* recorded views, must agree
    // exactly — which is what says the pilot holds no hidden channel to the world
    // and no source of chance outside its own generator.
    const world = newWorld('replayed-views');
    const recorded: PilotView[] = [];
    const source = autopilotSource(world, { persona: personaNamed('normal'), seed: 'pure' });
    for (let i = 0; i < 600; i += 1) {
      recorded.push(viewOfWorld(world));
      stepWorld(world, source.sample());
    }

    const first = createAutopilot({ persona: personaNamed('normal'), seed: 'pure' });
    const second = createAutopilot({ persona: personaNamed('normal'), seed: 'pure' });
    for (const view of recorded) {
      expect(first.sample(view)).toBe(second.sample(view));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Determinism                                                                 */
/* -------------------------------------------------------------------------- */

describe('determinism survives', () => {
  it('plays the same run twice from the same seed and persona', () => {
    for (const persona of personas()) {
      const a = play(persona, 'determinism', 2_400);
      const b = play(persona, 'determinism', 2_400);
      expect(b).toEqual(a);
    }
  });

  it('plays a different run from a different pilot seed', () => {
    // The pilot's own stream is a real input to the run: if it were not, the seed
    // would be decoration and "reproducible" would mean nothing.
    const persona = personaNamed('normal');
    const world = newWorld('same-world');
    const other = newWorld('same-world');
    const one = autopilotSource(world, { persona, seed: 'pilot-a' });
    const two = autopilotSource(other, { persona, seed: 'pilot-b' });
    for (let i = 0; i < 2_400; i += 1) {
      stepWorld(world, one.sample());
      stepWorld(other, two.sample());
    }
    expect(fingerprintWorld(other)).not.toBe(fingerprintWorld(world));
  });

  it('reads no clock and no unseeded generator', () => {
    // Lint bans `Math.random`, `Date` and `performance` in this module
    // (`eslint.config.js`), and `tests/unit/sim-boundary.test.ts` proves those rules
    // cannot be silently deleted. This is the textual backstop for the same claim,
    // in the same spirit as that file's tree scan.
    const source = readFileSync(
      resolve(import.meta.dirname, '..', '..', 'src', 'ui', 'autoplay.ts'),
      'utf8',
    );
    // Comments stripped first: the module header *names* `Math.random` in order to
    // say it does not use it, and a scan that could not tell the two apart would
    // punish the file for documenting the rule.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of ['Math.random', 'Date.now', 'performance.now', 'new Date']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Every persona plays                                                         */
/* -------------------------------------------------------------------------- */

describe('every shipped persona plays a stage', () => {
  it.each(personas().map((persona) => [persona.id, persona] as const))(
    '%s moves, shoots and scores',
    (_id, persona) => {
      const run = play(persona, 'plays-a-stage', 3_600);
      // Not stalled: it works the stick and the button rather than standing still
      // with the trigger down, which is what a broken pilot looks like.
      expect(run.moved).toBeGreaterThan(200);
      // Deliberately a floor and not a target. A rocket takes about 33 steps to
      // leave the screen and there are two slots, so **no** pilot can usefully hold
      // the button for more than about one step in sixteen; the accurate personas
      // come in just under that ceiling and the sloppy ones far over it, and both are
      // correct behaviour for what they are.
      expect(run.fired).toBeGreaterThan(60);
      // Not dead on arrival: a whole stage-1 entry is about 1,024 steps, and every
      // persona has to be alive well past it and have hit things on the way.
      expect(run.steps).toBeGreaterThan(1_100);
      expect(run.score).toBeGreaterThan(500);
    },
  );
});

/* -------------------------------------------------------------------------- */
/* Getting out of the way                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A screen with the fighter on it and only what a test puts there, in the shipped
 * fighter's own numbers — its row, its hit window, its rocket speed and its walls.
 *
 * Hand-built rather than reached in a run because what these pin is a few frames
 * of one body's flight, and a whole run reaches them only by luck: the defect the
 * first of them pins stalled the astronaut on one Swarm Remix run in a few hundred.
 */
function sceneOf(step: number, enemies: readonly Sighting[]): PilotView {
  const shipped = viewOfWorld(newWorld());
  const row = shipped.fighter?.y ?? 0;
  return {
    ...shipped,
    step,
    fighter: { x: 100, y: row, dual: false },
    shotsFree: 2,
    bombs: [],
    enemies: enemies.map((enemy) => ({ ...enemy, y: row + enemy.y })),
    beam: undefined,
  };
}

/** What the astronaut does with each of `steps` consecutive scenes, one frame each. */
function movesThrough(scene: (step: number) => PilotView, steps: number): string[] {
  const pilot = createAutopilot({ persona: personaNamed('astronaut'), seed: 'scene' });
  return Array.from({ length: steps }, (_unused, step) => {
    const frame = pilot.sample(scene(step));
    return isDown(frame, 'left') ? 'left' : isDown(frame, 'right') ? 'right' : 'still';
  });
}

describe('a pilot gets out of the way', () => {
  it('walks away from a body sweeping along its row, not through it to the clear side', () => {
    // A diver level with the fighter, drifting towards it a pixel a step. Every
    // column it has already passed is clear, and the clear column nearest anything
    // worth shooting is the one just behind it — on the far side of it. A pilot that
    // asked only whether a column was safe to stand in walked through the diver to
    // get there; Swarm Remix's drone dive flattens into exactly this pass, and the
    // astronaut lost a fighter to it on every pass until one run in a few hundred
    // stalled with one drone left. The first frame has nothing to measure the drift
    // from; from the second, it must never step towards the sweeper.
    const sweeper = (step: number): PilotView =>
      sceneOf(step, [{ id: 7, x: 120 - step, y: -4, flying: true, captured: false }]);
    const moves = movesThrough(sweeper, 5);
    expect(moves.slice(1)).not.toContain('right');
    expect(moves).toContain('left');
  });

  it('walks past a diver that has gone under its row and is falling away', () => {
    // Under the row and still descending, so it can never come back up to strike —
    // and between the fighter and the one enemy left in the formation. Treated as
    // level with the fighter on every frame, it read as a wall the fighter could not
    // walk past, and one Deep Sea run stood beside one in a corner for two and a half
    // minutes without a shot.
    const below = (step: number): PilotView =>
      sceneOf(step, [
        { id: 7, x: 108, y: 8 + 2 * step, flying: true, captured: false },
        { id: 8, x: 140, y: -188, flying: false, captured: false },
      ]);
    expect(movesThrough(below, 5).slice(1)).toEqual(['right', 'right', 'right', 'right']);
  });
});
