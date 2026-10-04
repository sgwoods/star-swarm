/**
 * The ability registry, one module at a time (`src/sim/abilities/`).
 *
 * Each ability is flown through a real world over a probe pack loaded by the real
 * loader, so what is measured is what a pack would get: a document switches the
 * ability on, and the world does the rest. Whole-run behaviour — a persona
 * playing a pack that uses all four — is `tests/sim/ability-pack.test.ts`; this
 * file pins what each one does, frame by frame, and what the loader refuses.
 *
 * The capture beam is the registry's first module and has its own suite
 * (`./capture.test.ts`) and its own goldens; what is pinned here is that moving it
 * into the registry changed nothing a pack can see.
 */

import { describe, expect, it } from 'vitest';

import {
  loadPack,
  loadPackOrThrow,
  packSourceFromRecord,
  type LoadedPack,
} from '../../src/content/loader.js';
import {
  ABILITY_TYPES,
  isImplementedAbility,
  RESERVED_ABILITY_TYPES,
  type Rules,
} from '../../src/content/schema.js';
import { resolveStageContent, type StageContent } from '../../src/content/stages.js';
import { EMPTY_FRAME, frameOf } from '../../src/engine/input.js';
import { ABILITY_REGISTRY } from '../../src/sim/abilities/registry.js';
import { beginDive, type Enemy } from '../../src/sim/enemies.js';
import { eventsOfType, type SimEvent } from '../../src/sim/events.js';
import { createWorld, fingerprintWorld, stepWorld, type World } from '../../src/sim/world.js';
import { classicRules, classicStages, quickRunRules } from '../helpers/rules.js';

const FIRE = frameOf('fire');

/* -------------------------------------------------------------------------- */
/* A probe pack                                                                */
/* -------------------------------------------------------------------------- */

const DOT = { id: 'dot', size: 1, palette: ['#0000', '#ffffff'], frames: [['1']] };

/** A plain alien that can dive and does nothing else; abilities put these on the field. */
const SHARD = {
  id: 'shard',
  role: 'drone',
  sprite: 'dot',
  score: { base: 10 },
  dive: { paths: ['dive'] },
} as const;

function probeFiles(
  probe: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    'pack.json': {
      id: 'probe',
      name: 'Probe',
      palette: ['#0000', '#ffffff'],
      roles: { drone: {} },
      formations: {
        one: {
          id: 'one',
          grid: { originX: 104, originY: 80, columnSpacing: 16, rowSpacing: 16 },
          slots: [{ row: 0, column: 0, role: 'drone' }],
        },
      },
    },
    'sprites/dot.json': DOT,
    'paths/entry.json': { id: 'entry', start: [-16, 80], segments: [{ type: 'toSlot', speed: 3 }] },
    'paths/dive.json': {
      id: 'dive',
      segments: [
        { type: 'aimAtPlayer', speed: 1, duration: 120 },
        { type: 'exitBottom', speed: 1 },
      ],
    },
    'paths/dive-trigger.json': {
      id: 'dive-trigger',
      segments: [
        { type: 'aimAtPlayer', speed: 1, duration: 10 },
        { type: 'trigger', ability: 'teleport' },
        { type: 'trigger', ability: 'spawnMinions' },
        { type: 'exitBottom', speed: 1 },
      ],
    },
    'aliens/probe.json': {
      id: 'probe',
      role: 'drone',
      sprite: 'dot',
      score: { base: 100 },
      dive: { paths: ['dive'] },
      ...probe,
    },
    'aliens/shard.json': SHARD,
    'stages/probe.json': {
      id: 'probe',
      kind: 'normal',
      formation: 'one',
      waves: [{ at: 0, entryPath: 'entry', slots: [{ alien: 'probe', home: 0 }] }],
    },
    ...extra,
  };
}

function probePack(probe: Record<string, unknown>, extra?: Record<string, unknown>): LoadedPack {
  return loadPackOrThrow(packSourceFromRecord('probe', 'test:probe', probeFiles(probe, extra)));
}

/** Every loader message for a probe pack, or `[]` if it loaded. */
function refusals(probe: Record<string, unknown>, extra?: Record<string, unknown>): string[] {
  const result = loadPack(packSourceFromRecord('probe', 'test:probe', probeFiles(probe, extra)));
  return result.ok ? [] : result.errors.map((error) => `${error.field}: ${error.message}`);
}

function contentOf(pack: LoadedPack): StageContent {
  const stage = pack.stages.get('probe');
  const content = stage === undefined ? undefined : resolveStageContent(pack, stage);
  if (content === undefined) throw new Error('the probe stage resolved to nothing');
  return content;
}

/** A world playing the probe stage on every stage number. */
function probeWorld(
  probe: Record<string, unknown>,
  options: { readonly rules?: Rules; readonly seed?: string; readonly stage?: number } = {},
): World {
  const content = contentOf(probePack(probe));
  return createWorld({
    seed: options.seed ?? 'abilities',
    rules: options.rules ?? quickRunRules(),
    stages: { stageFor: () => content },
    ...(options.stage !== undefined && { stage: options.stage }),
  });
}

/** Step until `done` holds, collecting every event. Throws rather than looping for ever. */
function stepUntil(
  world: World,
  done: (world: World) => boolean,
  frame = EMPTY_FRAME,
  limit = 2_000,
): SimEvent[] {
  const events: SimEvent[] = [];
  for (let step = 0; step < limit; step += 1) {
    if (done(world)) return events;
    events.push(...stepWorld(world, frame));
  }
  throw new Error(`still waiting after ${String(limit)} steps`);
}

/** The probe, held by reference: a split or a stage roll puts other enemies in the fleet. */
function probeOf(world: World): Enemy {
  const enemy = world.fleet.enemies.find((candidate) => candidate.alienId === 'probe');
  if (enemy === undefined) throw new Error('no probe on the field');
  return enemy;
}

/**
 * Shoot the probe dead, one shot at a time.
 *
 * Fire is held only once the probe is on the field: shots fired while it waits to
 * launch are still in the air when it arrives, and the spare one would take a
 * fragment on the very frame of the split.
 */
function shootProbe(world: World): SimEvent[] {
  const probe = probeOf(world);
  const before = stepUntil(world, () => probe.state !== 'standby');
  return [...before, ...stepUntil(world, () => probe.state === 'dead', FIRE)];
}

/** Park the probe in its slot with the attack director off, then send it down `path`. */
function diving(world: World, path = 'dive'): Enemy {
  const probe = probeOf(world);
  stepUntil(world, () => probe.state === 'home');
  world.dive.armed = false;
  const { content, formation } = world;
  if (content === undefined || formation === undefined) throw new Error('no stage on');
  beginDive(world.fleet, probe, content, formation, world.rules, path, false, [103, 248]);
  return probe;
}

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

describe('the registry', () => {
  it('holds a module for every implemented id and none for a reserved one', () => {
    expect(Object.keys(ABILITY_REGISTRY).sort()).toEqual(
      ABILITY_TYPES.filter(isImplementedAbility).sort(),
    );
    for (const reserved of RESERVED_ABILITY_TYPES) {
      expect(Object.keys(ABILITY_REGISTRY)).not.toContain(reserved);
    }
    for (const [type, module] of Object.entries(ABILITY_REGISTRY)) {
      expect(module.type).toBe(type);
    }
  });

  it('registers the capture beam as a channel, with no per-enemy hooks', () => {
    // The beam is stepped by the world directly, because a captured fighter
    // outlives the stage it was taken in; the registry entry is the switch's name,
    // not a second way in.
    const { captureBeam } = ABILITY_REGISTRY;
    expect(captureBeam.step).toBeUndefined();
    expect(captureBeam.absorbShot).toBeUndefined();
    expect(captureBeam.destroyed).toBeUndefined();
  });

  it('leaves Classic exactly as it was: no alien declares an ability, and no run records one', () => {
    // The guarantee every golden in `tests/sim/golden/` rests on. A Classic run that
    // fingerprinted an `abilities` field would rewrite all of them.
    const rules = classicRules();
    const world = createWorld({ seed: 'abilities-classic', rules, stages: classicStages() });
    for (const enemy of world.fleet.enemies) expect(enemy.abilities).toEqual([]);
    for (let step = 0; step < 3_000; step += 1) stepWorld(world, step % 3 === 0 ? FIRE : 0);
    expect(JSON.parse(fingerprintWorld(world))).not.toHaveProperty('abilities');
  });
});

/* -------------------------------------------------------------------------- */
/* shield                                                                       */
/* -------------------------------------------------------------------------- */

describe('shield', () => {
  it('takes the first `hits` shots, scoring nothing and leaving the enemy untouched', () => {
    const world = probeWorld({ abilities: [{ type: 'shield', hits: 2 }] });
    const probe = probeOf(world);
    const events = stepUntil(world, () => probe.state === 'dead', FIRE);

    const shielded = eventsOfType(events, 'shield-hit');
    expect(shielded.map((event) => event.shieldRemaining)).toEqual([1, 0]);
    expect(eventsOfType(events, 'target-destroyed')).toHaveLength(1);
    // The shield hits came first, and paid nothing.
    const order = events
      .filter((event) => event.type === 'shield-hit' || event.type === 'target-destroyed')
      .map((event) => event.type);
    expect(order).toEqual(['shield-hit', 'shield-hit', 'target-destroyed']);
    expect(eventsOfType(events, 'score-changed').map((event) => event.delta)).toEqual([200]);
  });

  it('sits in front of `hp`: a two-hit enemy still takes two hits once the shield is down', () => {
    const world = probeWorld({ hp: 2, abilities: [{ type: 'shield', hits: 1 }] });
    const probe = probeOf(world);
    const events = stepUntil(world, () => probe.state === 'dead', FIRE);
    expect(
      events
        .filter((event) => ['shield-hit', 'target-hit', 'target-destroyed'].includes(event.type))
        .map((event) => event.type),
    ).toEqual(['shield-hit', 'target-hit', 'target-destroyed']);
  });

  it('is whole again after `rechargeFrames` unhit, and not a frame before', () => {
    const world = probeWorld({
      hp: 3,
      abilities: [{ type: 'shield', hits: 2, rechargeFrames: 30 }],
    });
    const probe = probeOf(world);
    const hits = stepUntil(
      world,
      () => world.abilities.shield.get(probe.id)?.remaining === 0,
      FIRE,
    );
    expect(eventsOfType(hits, 'shield-hit')).toHaveLength(2);

    const quiet: SimEvent[] = [];
    for (let step = 0; step < 29; step += 1) quiet.push(...stepWorld(world, EMPTY_FRAME));
    expect(eventsOfType(quiet, 'shield-restored')).toEqual([]);
    expect(eventsOfType(stepWorld(world, EMPTY_FRAME), 'shield-restored')).toHaveLength(1);
    expect(world.abilities.shield.get(probe.id)?.remaining).toBe(2);
  });

  it('never recharges without `rechargeFrames`', () => {
    const world = probeWorld({ hp: 3, abilities: [{ type: 'shield', hits: 1 }] });
    const probe = probeOf(world);
    stepUntil(world, () => world.abilities.shield.get(probe.id)?.remaining === 0, FIRE);
    const later: SimEvent[] = [];
    for (let step = 0; step < 600; step += 1) later.push(...stepWorld(world, EMPTY_FRAME));
    expect(eventsOfType(later, 'shield-restored')).toEqual([]);
    expect(world.abilities.shield.get(probe.id)?.remaining).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* splitOnHit                                                                   */
/* -------------------------------------------------------------------------- */

describe('splitOnHit', () => {
  const SPLITS = { abilities: [{ type: 'splitOnHit', into: 'shard', count: 3, spacing: 6 }] };

  it('leaves `count` fragments diving, abreast of the kill, after it is scored', () => {
    const world = probeWorld(SPLITS);
    const events = shootProbe(world);

    const destroyed = eventsOfType(events, 'target-destroyed');
    const split = eventsOfType(events, 'enemy-split');
    expect(destroyed).toHaveLength(1);
    expect(split).toHaveLength(1);
    expect(events.indexOf(split[0]!)).toBeGreaterThan(events.indexOf(destroyed[0]!));

    const fragments = world.fleet.enemies.filter((enemy) => split[0]!.group.includes(enemy.id));
    expect(fragments.map((enemy) => enemy.alienId)).toEqual(['shard', 'shard', 'shard']);
    for (const fragment of fragments) {
      expect(fragment.state).toBe('diving');
      // It owns no slot to come back to.
      expect(fragment.returnsFromDive).toBe(false);
    }
  });

  it('holds the stage open until the fragments are gone, then rolls on', () => {
    const world = probeWorld(SPLITS);
    const kill = shootProbe(world);
    expect(eventsOfType(kill, 'stage-cleared')).toEqual([]);
    const rest = stepUntil(world, () => world.stage === 2, FIRE);
    expect(eventsOfType(rest, 'stage-cleared')).toHaveLength(1);
    expect(eventsOfType(rest, 'target-destroyed').length).toBeGreaterThanOrEqual(1);
  });

  it('leaves nothing on a stage where nothing may attack', () => {
    // Stage 3 is Classic's first challenge stage; the probe plays it here as an
    // ordinary document, so the only thing that differs is `allowsAttacks`.
    const world = probeWorld(SPLITS, { stage: 3 });
    expect(world.dive.attacks).toBe(false);
    const probe = probeOf(world);
    const events = stepUntil(world, () => probe.state === 'dead', FIRE);
    expect(eventsOfType(events, 'enemy-split')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* teleport                                                                     */
/* -------------------------------------------------------------------------- */

describe('teleport', () => {
  it('blinks a diver to another column every `everyFrames`, keeping its row', () => {
    const world = probeWorld({ abilities: [{ type: 'teleport', everyFrames: 20, margin: 24 }] });
    const probe = diving(world);

    const quiet: SimEvent[] = [];
    for (let step = 0; step < 19; step += 1) quiet.push(...stepWorld(world, EMPTY_FRAME));
    expect(eventsOfType(quiet, 'enemy-teleported')).toEqual([]);

    const [blink] = eventsOfType(stepWorld(world, EMPTY_FRAME), 'enemy-teleported');
    expect(blink).toBeDefined();
    expect(blink!.y).toBe(blink!.fromY);
    expect(blink!.x).not.toBe(blink!.fromX);
    expect(blink!.x).toBeGreaterThanOrEqual(24);
    expect(blink!.x).toBeLessThanOrEqual(world.rules.playfield.width - 24);
    expect(probe.x).toBe(blink!.x);
  });

  it('carries on the same flight from where it lands, rather than starting a new one', () => {
    const world = probeWorld({ abilities: [{ type: 'teleport', everyFrames: 20 }] });
    const twin = probeWorld({});
    const probe = diving(world);
    const plain = diving(twin);
    for (let step = 0; step < 25; step += 1) {
      stepWorld(world, EMPTY_FRAME);
      stepWorld(twin, EMPTY_FRAME);
    }
    // Same frame of the same path, displaced sideways by the blink and nothing else.
    expect(probe.pathFrame).toBe(plain.pathFrame);
    expect(probe.y).toBeCloseTo(plain.y, 9);
    expect(probe.x - plain.x).not.toBeCloseTo(0, 3);
    const before = probe.x - plain.x;
    stepWorld(world, EMPTY_FRAME);
    stepWorld(twin, EMPTY_FRAME);
    expect(probe.x - plain.x).toBeCloseTo(before, 9);
  });

  it('never blinks out of the formation', () => {
    const world = probeWorld({ abilities: [{ type: 'teleport', everyFrames: 5 }] });
    const probe = probeOf(world);
    stepUntil(world, () => probe.state === 'home');
    world.dive.armed = false;
    const events: SimEvent[] = [];
    for (let step = 0; step < 100; step += 1) events.push(...stepWorld(world, EMPTY_FRAME));
    expect(eventsOfType(events, 'enemy-teleported')).toEqual([]);
  });

  it('blinks at a path trigger naming it, with no timer at all', () => {
    const world = probeWorld({
      dive: { paths: ['dive-trigger'] },
      abilities: [{ type: 'teleport' }],
    });
    diving(world, 'dive-trigger');
    const events: SimEvent[] = [];
    for (let step = 0; step < 30; step += 1) events.push(...stepWorld(world, EMPTY_FRAME));
    expect(eventsOfType(events, 'enemy-teleported')).toHaveLength(1);
  });

  it('draws where it lands from the world’s seed', () => {
    const land = (seed: string): number => {
      const world = probeWorld({ abilities: [{ type: 'teleport', everyFrames: 10 }] }, { seed });
      diving(world);
      const events: SimEvent[] = [];
      for (let step = 0; step < 10; step += 1) events.push(...stepWorld(world, EMPTY_FRAME));
      const [blink] = eventsOfType(events, 'enemy-teleported');
      if (blink === undefined) throw new Error('no blink in the first ten frames of the dive');
      return blink.x;
    };
    expect(land('one')).toBe(land('one'));
    expect(land('one')).not.toBe(land('two'));
  });
});

/* -------------------------------------------------------------------------- */
/* spawnMinions                                                                 */
/* -------------------------------------------------------------------------- */

describe('spawnMinions', () => {
  const SPAWNS = {
    abilities: [{ type: 'spawnMinions', alien: 'shard', count: 2, everyFrames: 30, maxAlive: 3 }],
  };

  it('launches nothing until the formation has settled and armed the dives', () => {
    const world = probeWorld(SPAWNS);
    const events = stepUntil(world, () => world.dive.armed);
    expect(eventsOfType(events, 'minions-spawned')).toEqual([]);
  });

  it('launches `count` every `everyFrames`, and never more than `maxAlive` at once', () => {
    const world = probeWorld(SPAWNS, { rules: classicRules() });
    const probe = probeOf(world);
    stepUntil(world, () => world.dive.armed);
    const spawned: SimEvent[] = [];
    for (let step = 0; step < 30 * 6; step += 1) {
      const events = stepWorld(world, EMPTY_FRAME);
      spawned.push(...events);
      const minions = world.fleet.enemies.filter(
        (enemy) => enemy.alienId === 'shard' && enemy.state !== 'dead',
      );
      expect(minions.length).toBeLessThanOrEqual(3);
    }
    const launches = eventsOfType(spawned, 'minions-spawned');
    expect(launches.length).toBeGreaterThanOrEqual(2);
    expect(launches[0]!.group).toHaveLength(2);
    expect(launches[0]!.targetId).toBe(probe.id);
    for (const minion of world.fleet.enemies.filter((enemy) => enemy.alienId === 'shard')) {
      expect(minion.returnsFromDive).toBe(false);
    }
  });

  it('launches at a path trigger naming it, with no timer at all', () => {
    const world = probeWorld(
      {
        dive: { paths: ['dive-trigger'] },
        abilities: [{ type: 'spawnMinions', alien: 'shard', maxAlive: 1 }],
      },
      { rules: classicRules() },
    );
    stepUntil(world, () => world.dive.armed);
    diving(world, 'dive-trigger');
    // `diving` disarms the director so nothing else launches; the spawner asks
    // for an armed formation, so it is put back.
    world.dive.armed = true;
    const events: SimEvent[] = [];
    for (let step = 0; step < 30; step += 1) events.push(...stepWorld(world, EMPTY_FRAME));
    expect(eventsOfType(events, 'minions-spawned')).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* What the loader refuses                                                      */
/* -------------------------------------------------------------------------- */

describe('the loader holds each ability to doing something', () => {
  it('refuses a split chain that never ends', () => {
    expect(
      refusals(
        { abilities: [{ type: 'splitOnHit', into: 'shard', count: 2 }] },
        {
          'aliens/shard.json': {
            ...SHARD,
            abilities: [{ type: 'splitOnHit', into: 'probe', count: 2 }],
          },
        },
      ).some((message) => message.includes('splitOnHit never ends')),
    ).toBe(true);
  });

  it('refuses an ability that would put an alien on the field with nothing to fly', () => {
    const grounded = { ...SHARD, dive: undefined };
    for (const ability of [
      { type: 'splitOnHit', into: 'shard', count: 2 },
      { type: 'spawnMinions', alien: 'shard', everyFrames: 30, maxAlive: 1 },
    ]) {
      expect(
        refusals({ abilities: [ability] }, { 'aliens/shard.json': grounded }).some((message) =>
          message.includes('has no dive paths'),
        ),
      ).toBe(true);
    }
  });

  it('refuses a timed ability with no timer and no trigger to fire it', () => {
    expect(refusals({ abilities: [{ type: 'teleport' }] })).toEqual([
      expect.stringContaining('teleport never fires'),
    ]);
    expect(
      refusals({ abilities: [{ type: 'spawnMinions', alien: 'shard', maxAlive: 1 }] }),
    ).toEqual([expect.stringContaining('spawnMinions never fires')]);
    // A trigger on one of its own dive paths is enough.
    expect(
      refusals({ dive: { paths: ['dive-trigger'] }, abilities: [{ type: 'teleport' }] }),
    ).toEqual([]);
  });

  it('refuses a reference to an alien the pack does not have', () => {
    expect(refusals({ abilities: [{ type: 'splitOnHit', into: 'ghost', count: 2 }] })).toEqual([
      expect.stringContaining('no alien with id "ghost"'),
    ]);
  });
});
