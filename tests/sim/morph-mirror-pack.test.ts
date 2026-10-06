/**
 * `transform` and `mirrorPlayer` fly in a game somebody played.
 *
 * The companion of `tests/sim/ability-pack.test.ts`, for the two abilities that
 * were reserved until their definitions were settled. The pack below is **data
 * and nothing else** — documents in the shape a pack directory holds, read by the
 * real loader, layered over Classic by the real registry and handed to the real
 * world through the real stage source — and an autoplay persona, which sees only
 * what a player can, flies it. Nothing under `src/` names it, and no shipped
 * variant plays it: a game that switches the new abilities on is separate work.
 *
 * What a run is asked is whether each ability happened, whether it did what its
 * definition says while somebody was playing — a changed enemy scores as what it
 * became, a mirror's column is the fighter's reflected — and whether the stage
 * still ends.
 */

import { describe, expect, it } from 'vitest';

import type { Persona } from '../../src/content/personas.js';
import {
  loadPackOrThrow,
  packSourceFromRecord,
  type LoadedPack,
} from '../../src/content/loader.js';
import { createRegistry } from '../../src/content/registry.js';
import { resolveEscortBonus } from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { createStageSource, type StageSource } from '../../src/content/stages.js';
import type { SimEvent } from '../../src/sim/events.js';
import { createWorld, fingerprintWorld, stepWorld, type World } from '../../src/sim/world.js';
import { autopilotSource } from '../../src/ui/autoplay.js';
import { installedPack, shippedVariants } from '../helpers/variants.js';

const PACK_ID = 'morph-mirror-demo';

/** The reflection's tuning, which the in-game check below reads back. */
const REFLECTION_DELAY = 8;

const SPRITE = {
  id: 'mote',
  size: 8,
  palette: ['#0000', '#ffb347'],
  frames: [
    [
      '..1111..',
      '.111111.',
      '11111111',
      '11111111',
      '11111111',
      '11111111',
      '.111111.',
      '..1111..',
    ],
  ],
};

/**
 * The pack, as the files a directory would hold.
 *
 * Two aliens change type — one on a timer, one at a `trigger` on its own dive
 * path, and that one into an alien of another role — and two copy the fighter,
 * one each way. Roles are the three the Classic rules launch; the formation
 * states no captive slots, so the capture channel never picks a captor here.
 */
function demoPackFiles(): Record<string, unknown> {
  const slot = (row: number, column: number, role: string) => ({ row, column, role });
  return {
    'pack.json': {
      id: PACK_ID,
      name: 'Morph and Mirror Demo',
      description: 'Two engine abilities, switched on by data and nothing else.',
      palette: ['#ffb347'],
      roles: { drone: {}, wing: {}, warden: {} },
      formations: {
        demo12: {
          id: 'demo12',
          grid: { originX: 72, originY: 56, columnSpacing: 16, rowSpacing: 16 },
          slots: [
            slot(0, 1, 'warden'),
            slot(0, 3, 'warden'),
            ...[0, 1, 2, 3, 4].map((column) => slot(1, column, 'wing')),
            ...[0, 1, 2, 3, 4].map((column) => slot(2, column, 'drone')),
          ],
        },
      },
      stageSequence: { normal: { rows: ['demo-1'], repeatLast: 1 } },
    },
    'sprites/mote.json': SPRITE,
    'paths/entry-drop.json': {
      id: 'entry-drop',
      mirror: true,
      start: [-16, 40],
      segments: [
        { type: 'bezier', to: [112, 140], c1: [60, 40], c2: [40, 140], speed: 2 },
        { type: 'toSlot', speed: 2 },
      ],
    },
    'paths/dive-swoop.json': {
      id: 'dive-swoop',
      mirror: true,
      segments: [
        { type: 'arc', radius: 16, degrees: 120, dir: 'cw', speed: 1.8 },
        { type: 'aimAtPlayer', speed: 1.8, duration: 50 },
        { type: 'exitBottom', speed: 1.8 },
      ],
    },
    // The larva's own dive says where it changes: a trigger naming the ability by
    // id, exactly as Classic's capture dive names `captureBeam`.
    'paths/dive-molt.json': {
      id: 'dive-molt',
      mirror: true,
      segments: [
        { type: 'arc', radius: 16, degrees: 120, dir: 'cw', speed: 1.4 },
        { type: 'trigger', ability: 'transform' },
        { type: 'aimAtPlayer', speed: 1.8, duration: 40 },
        { type: 'exitBottom', speed: 1.8 },
      ],
    },
    'aliens/chrysalis.json': {
      id: 'chrysalis',
      role: 'wing',
      sprite: 'mote',
      score: { base: 80 },
      dive: { paths: ['dive-swoop'] },
      abilities: [{ type: 'transform', into: 'moth', afterFrames: 40 }],
    },
    'aliens/moth.json': {
      id: 'moth',
      role: 'wing',
      sprite: 'mote',
      score: { base: 120 },
      dive: { paths: ['dive-swoop'] },
    },
    'aliens/larva.json': {
      id: 'larva',
      role: 'drone',
      sprite: 'mote',
      score: { base: 50 },
      dive: { paths: ['dive-molt'] },
      abilities: [{ type: 'transform', into: 'hornet' }],
    },
    // A different role, and one that leaves: what it becomes decides both.
    'aliens/hornet.json': {
      id: 'hornet',
      role: 'warden',
      sprite: 'mote',
      score: { base: 100, movingMultiplier: 3 },
      dive: { paths: ['dive-swoop'], returns: false },
    },
    'aliens/shadow.json': {
      id: 'shadow',
      role: 'drone',
      sprite: 'mote',
      score: { base: 50 },
      dive: { paths: ['dive-swoop'] },
      abilities: [{ type: 'mirrorPlayer', mode: 'track', delayFrames: 15, strength: 0.15 }],
    },
    'aliens/reflection.json': {
      id: 'reflection',
      role: 'warden',
      sprite: 'mote',
      score: { base: 150 },
      dive: { paths: ['dive-swoop'] },
      abilities: [
        { type: 'mirrorPlayer', mode: 'opposite', delayFrames: REFLECTION_DELAY, strength: 1 },
      ],
    },
    'stages/demo-1.json': {
      id: 'demo-1',
      kind: 'normal',
      formation: 'demo12',
      waves: [
        {
          at: 0,
          entryPath: 'entry-drop',
          spacing: 10,
          slots: [
            { alien: 'reflection', home: 0 },
            { alien: 'reflection', home: 1, mirror: true },
            ...[2, 3, 4, 5, 6].map((home, index) => ({
              alien: 'chrysalis',
              home,
              mirror: index % 2 === 1,
              trailing: true,
            })),
          ],
        },
        {
          at: 120,
          entryPath: 'entry-drop',
          spacing: 10,
          slots: [7, 8, 9, 10, 11].map((home, index) => ({
            alien: index % 2 === 0 ? 'larva' : 'shadow',
            home,
            mirror: index % 2 === 0,
            trailing: true,
          })),
        },
      ],
    },
  };
}

let cachedPack: LoadedPack | undefined;

function demoPack(): LoadedPack {
  cachedPack ??= loadPackOrThrow(
    packSourceFromRecord(PACK_ID, 'test:morph-mirror-demo', demoPackFiles()),
  );
  return cachedPack;
}

function layered() {
  return createRegistry([installedPack('classic'), demoPack()]);
}

function rules(): Rules {
  const value = layered().rules;
  if (value === undefined) throw new Error('the layered registry resolved no rules');
  return value;
}

/** Stage 1 only: the run is measured until the demo stage is cleared, and no further. */
function stageOne(): StageSource {
  const all = createStageSource(layered());
  return { stageFor: (stage) => (stage === 1 ? all.stageFor(1) : undefined) };
}

function persona(id: string): Persona {
  const classic = shippedVariants().find((variant) => variant.id === 'classic');
  const found = classic?.personas.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`variants/classic.json declares no "${id}" persona`);
  return found;
}

const STEPS = 2 * 60 * 60;
const SEEDS = 6;

interface Run {
  readonly cleared: boolean;
  readonly ended: boolean;
  readonly events: readonly SimEvent[];
  /** Steps on which a reflection was copying, and how far off its mirrored column it was. */
  readonly reflections: readonly number[];
  /** Steps on which a shadow had seen enough of the fighter to copy it. */
  readonly shadowing: number;
}

/** After a step: each reflection's distance from the fighter's column, mirrored, `delay` ago. */
function reflectionErrors(world: World, playerXs: readonly number[]): number[] {
  const errors: number[] = [];
  for (const enemy of world.fleet.enemies) {
    if (enemy.alienId !== 'reflection' || enemy.state !== 'diving') continue;
    // A full memory is `delay + 1` consecutive frames of this dive with a fighter
    // on the field, and is what it holds on a frame it copied: the reading it
    // copied is the oldest, from `delay` steps ago.
    if (world.abilities.mirrorPlayer.get(enemy.id)?.seen.length !== REFLECTION_DELAY + 1) continue;
    const seen = playerXs[playerXs.length - 1 - REFLECTION_DELAY];
    if (seen === undefined) continue;
    errors.push(Math.abs(enemy.x - (world.rules.playfield.width - seen)));
  }
  return errors;
}

function play(who: Persona, seed: string): Run {
  const world = createWorld({ seed, rules: rules(), stages: stageOne() });
  const pilot = autopilotSource(world, { persona: who, seed: `pilot:${seed}` });
  const events: SimEvent[] = [...world.events];
  const playerXs: number[] = [];
  const reflections: number[] = [];
  let shadowing = 0;
  let cleared = false;
  for (let steps = 0; steps < STEPS && world.status === 'playing' && !cleared; steps += 1) {
    const stepped = stepWorld(world, pilot.sample());
    events.push(...stepped);
    playerXs.push(world.player.x);
    reflections.push(...reflectionErrors(world, playerXs));
    shadowing += world.fleet.enemies.filter(
      (enemy) =>
        enemy.alienId === 'shadow' &&
        world.abilities.mirrorPlayer.get(enemy.id)?.seen.length === 16,
    ).length;
    cleared = stepped.some((event) => event.type === 'stage-cleared');
  }
  return {
    cleared,
    ended: cleared || world.status === 'game-over',
    events,
    reflections,
    shadowing,
  };
}

const runs = new Map<string, readonly Run[]>();
function runsOf(id: string): readonly Run[] {
  let found = runs.get(id);
  if (found === undefined) {
    const who = persona(id);
    found = Array.from({ length: SEEDS }, (_unused, index) => play(who, `morph-mirror-${index}`));
    runs.set(id, found);
  }
  return found;
}

describe('a pack that switches on transform and mirrorPlayer is only data', () => {
  it('loads through the real loader, each ability validated by its own schema', () => {
    const aliens = demoPack().aliens;
    expect(aliens.get('chrysalis')?.abilities).toEqual([
      { type: 'transform', into: 'moth', afterFrames: 40 },
    ]);
    expect(aliens.get('larva')?.abilities).toEqual([{ type: 'transform', into: 'hornet' }]);
    expect(aliens.get('reflection')?.abilities).toEqual([
      { type: 'mirrorPlayer', mode: 'opposite', delayFrames: REFLECTION_DELAY, strength: 1 },
    ]);
    expect(demoPack().rules).toBeUndefined();
    expect(stageOne().stageFor(1)?.stage.id).toBe('demo-1');
  });
});

describe('an autoplay persona plays it, and both abilities happen', () => {
  it('changes type on a timer and at a trigger, and scores a changed enemy as what it became', () => {
    const played = runsOf('astronaut');
    const morphs = played.flatMap((run) =>
      run.events.flatMap((event) => (event.type === 'enemy-morphed' ? [event] : [])),
    );
    const pairs = new Set(morphs.map((event) => `${event.fromAlienId}→${event.alienId}`));
    expect([...pairs].sort()).toEqual(['chrysalis→moth', 'larva→hornet']);

    // Every kill of an enemy that had changed is the new alien's, at its own
    // value — the base at home, the base times its multiplier anywhere else, plus
    // whatever its role's solo escort record is on the doubled branch, exactly as
    // for an enemy that had been a hornet all along.
    const escort = resolveEscortBonus(rules(), 'warden', 0);
    const value: Record<string, readonly number[]> = {
      moth: [120, 240],
      hornet: [100, 100 * 3 + escort],
    };
    let checked = 0;
    for (const run of played) {
      const became = new Map<number, string>();
      for (const event of run.events) {
        if (event.type === 'enemy-morphed') became.set(event.targetId, event.alienId);
        if (event.type !== 'target-destroyed') continue;
        const alien = became.get(event.targetId);
        if (alien === undefined) continue;
        expect(event.alienId).toBe(alien);
        expect(value[alien]).toContain(event.score);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('copies the fighter: a reflection’s column is the fighter’s, mirrored, as it was', () => {
    const played = runsOf('astronaut');
    const errors = played.flatMap((run) => run.reflections);
    // It copied, on many frames of many dives, and on every one of them its
    // column was the mirror of where the fighter stood `delayFrames` before.
    expect(errors.length).toBeGreaterThan(100);
    expect(Math.max(...errors)).toBeLessThan(1e-9);
    // And the shadow, which eases in, had the fighter to copy too.
    expect(played.reduce((sum, run) => sum + run.shadowing, 0)).toBeGreaterThan(100);
  });

  it('is clearable: the strong persona clears the stage on most seeds', () => {
    const cleared = runsOf('astronaut').filter((run) => run.cleared).length;
    expect(cleared).toBeGreaterThanOrEqual(SEEDS - 1);
  });

  it('always ends: no run reaches the step limit still playing', () => {
    for (const id of ['astronaut', 'normal']) {
      const stalled = runsOf(id).filter((run) => !run.ended).length;
      expect([id, stalled]).toEqual([id, 0]);
    }
  });

  it('is deterministic: the same seed and persona give the same world', () => {
    const fingerprints = (): string[] => {
      const world = createWorld({ seed: 'morph-mirror-det', rules: rules(), stages: stageOne() });
      const pilot = autopilotSource(world, { persona: persona('astronaut'), seed: 'pilot:det' });
      const out: string[] = [];
      for (let step = 1; step <= 1_200; step += 1) {
        stepWorld(world, pilot.sample());
        if (step % 100 === 0) out.push(fingerprintWorld(world));
      }
      return out;
    };
    const first = fingerprints();
    expect(fingerprints()).toEqual(first);
    expect(first.some((print) => 'abilities' in (JSON.parse(print) as object))).toBe(true);
  });
});
