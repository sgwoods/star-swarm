/**
 * A pack with new abilities plays without an engine change.
 *
 * That sentence is `docs/ROADMAP.md`'s exit check for the ability registry, and
 * this file is the proof of it rather than an assertion about the loader. The
 * pack below is **data and nothing else**: documents in the shape a pack
 * directory holds, read by the real loader, layered over Classic by the real
 * registry exactly as `packs/deep-sea/` is, and handed to the real world through
 * the real stage source. Nothing in it is code, and nothing under `src/` names
 * it. It switches on all four of the new abilities — `shield`, `splitOnHit`,
 * `teleport` and `spawnMinions` — and an autoplay persona, which sees only what a
 * player can, flies it.
 *
 * What a run is asked is what `tests/sim/forged-pack.test.ts` asks of a forged
 * pack, plus the one question that makes this file about abilities: did each of
 * them actually happen, in a game somebody played, and did the stage still end.
 *
 * It lives in `tests/sim/` for the reason the forged-pack test does: the
 * questions are about whole runs, and one seed answers none of them. It is a test
 * about **this** pack, deliberately not a playability pass — that is the
 * validator's work, being built separately.
 */

import { describe, expect, it } from 'vitest';

import type { Persona } from '../../src/content/personas.js';
import {
  loadPackOrThrow,
  packSourceFromRecord,
  type LoadedPack,
} from '../../src/content/loader.js';
import { createRegistry } from '../../src/content/registry.js';
import type { Rules } from '../../src/content/schema.js';
import { createStageSource, type StageSource } from '../../src/content/stages.js';
import type { SimEvent, SimEventType } from '../../src/sim/events.js';
import { createWorld, fingerprintWorld, stepWorld } from '../../src/sim/world.js';
import { autopilotSource } from '../../src/ui/autoplay.js';
import { installedPack, shippedVariants } from '../helpers/variants.js';

const PACK_ID = 'ability-demo';

/** One sprite for everything: the simulation never draws, and this is a simulation test. */
const SPRITE = {
  id: 'mote',
  size: 8,
  palette: ['#0000', '#7fffd4'],
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
 * Every ability is switched on and tuned in an alien document, and the one path
 * trigger names an ability by its registry id — which is the whole of what a pack
 * may say about an ability. Roles are the three the Classic rules launch, so every
 * alien in the formation attacks; the formation states no captive slots, so the
 * capture channel the Classic rules switch on never picks a captor here.
 */
function demoPackFiles(): Record<string, unknown> {
  const slot = (row: number, column: number, role: string) => ({ row, column, role });
  return {
    'pack.json': {
      id: PACK_ID,
      name: 'Ability Demo',
      description: 'Four engine abilities, switched on by data and nothing else.',
      palette: ['#7fffd4'],
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
    // The hive's own dive opens the hatch half way down: a trigger naming the
    // ability by id, exactly as Classic's capture dive names `captureBeam`.
    'paths/dive-hatch.json': {
      id: 'dive-hatch',
      mirror: true,
      segments: [
        { type: 'arc', radius: 16, degrees: 120, dir: 'cw', speed: 1.4 },
        { type: 'aimAtPlayer', speed: 1.4, duration: 40 },
        { type: 'trigger', ability: 'spawnMinions' },
        { type: 'exitBottom', speed: 1.4 },
      ],
    },
    'aliens/bulwark.json': {
      id: 'bulwark',
      role: 'warden',
      sprite: 'mote',
      score: { base: 150 },
      dive: { paths: ['dive-swoop'] },
      // No recharge, measured rather than chosen: with one, the mid-tier persona —
      // which can go thousands of frames without hitting a lone diver — never
      // breaks it, and the stage never ends (`docs/content-guide.md` section 7).
      abilities: [{ type: 'shield', hits: 2 }],
    },
    'aliens/hive.json': {
      id: 'hive',
      role: 'warden',
      sprite: 'mote',
      score: { base: 150 },
      dive: { paths: ['dive-hatch'] },
      abilities: [{ type: 'spawnMinions', alien: 'mite', everyFrames: 240, maxAlive: 2 }],
    },
    'aliens/splitter.json': {
      id: 'splitter',
      role: 'wing',
      sprite: 'mote',
      score: { base: 80 },
      dive: { paths: ['dive-swoop'] },
      abilities: [{ type: 'splitOnHit', into: 'shard', count: 2, spacing: 10 }],
    },
    'aliens/blinker.json': {
      id: 'blinker',
      role: 'drone',
      sprite: 'mote',
      score: { base: 50 },
      dive: { paths: ['dive-swoop'] },
      abilities: [{ type: 'teleport', everyFrames: 45, margin: 24 }],
    },
    'aliens/shard.json': {
      id: 'shard',
      role: 'drone',
      sprite: 'mote',
      score: { base: 30 },
      dive: { paths: ['dive-swoop'] },
    },
    'aliens/mite.json': {
      id: 'mite',
      role: 'drone',
      sprite: 'mote',
      score: { base: 20 },
      dive: { paths: ['dive-swoop'] },
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
            { alien: 'hive', home: 0 },
            { alien: 'bulwark', home: 1, mirror: true },
            ...[2, 3, 4, 5, 6].map((home, index) => ({
              alien: 'splitter',
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
            alien: 'blinker',
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

/** The pack, through the real loader. Throws, with every error, if it did not load. */
function demoPack(): LoadedPack {
  cachedPack ??= loadPackOrThrow(
    packSourceFromRecord(PACK_ID, 'test:ability-demo', demoPackFiles()),
  );
  return cachedPack;
}

/** Layered over Classic, as a variant naming `["classic", "ability-demo"]` would be. */
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

/** Long past any run recorded here, so reaching it is a stall rather than a slow game. */
const STEPS = 2 * 60 * 60;
const SEEDS = 6;

interface Run {
  readonly cleared: boolean;
  readonly ended: boolean;
  readonly steps: number;
  readonly counts: ReadonlyMap<SimEventType, number>;
}

function play(who: Persona, seed: string): Run {
  const world = createWorld({ seed, rules: rules(), stages: stageOne() });
  const pilot = autopilotSource(world, { persona: who, seed: `pilot:${seed}` });
  const counts = new Map<SimEventType, number>();
  const note = (events: readonly SimEvent[]) => {
    for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  };
  note(world.events);
  let cleared = false;
  let steps = 0;
  for (; steps < STEPS && world.status === 'playing' && !cleared; steps += 1) {
    const events = stepWorld(world, pilot.sample());
    note(events);
    cleared = events.some((event) => event.type === 'stage-cleared');
  }
  return { cleared, ended: cleared || world.status === 'game-over', steps, counts };
}

const runs = new Map<string, readonly Run[]>();
function runsOf(id: string): readonly Run[] {
  let found = runs.get(id);
  if (found === undefined) {
    const who = persona(id);
    found = Array.from({ length: SEEDS }, (_unused, index) => play(who, `abilities-${index}`));
    runs.set(id, found);
  }
  return found;
}

const total = (list: readonly Run[], type: SimEventType): number =>
  list.reduce((sum, run) => sum + (run.counts.get(type) ?? 0), 0);

describe('a pack that switches on new abilities is only data', () => {
  it('loads through the real loader, each ability validated by its own schema', () => {
    const aliens = demoPack().aliens;
    // Defaults filled in by the ability's own schema, which is what "validated"
    // means here: a parameter the pack left out has the value the engine uses.
    expect(aliens.get('splitter')?.abilities).toEqual([
      { type: 'splitOnHit', into: 'shard', count: 2, spacing: 10 },
    ]);
    expect(aliens.get('blinker')?.abilities).toEqual([
      { type: 'teleport', everyFrames: 45, margin: 24 },
    ]);
    expect(aliens.get('hive')?.abilities).toEqual([
      { type: 'spawnMinions', alien: 'mite', count: 1, everyFrames: 240, maxAlive: 2, spacing: 8 },
    ]);
    expect(aliens.get('bulwark')?.abilities).toEqual([{ type: 'shield', hits: 2 }]);
  });

  it('plays under the base pack’s rules document itself, not a copy', () => {
    expect(demoPack().rules).toBeUndefined();
    expect(rules()).toBe(installedPack('classic').rules);
    expect(stageOne().stageFor(1)?.stage.id).toBe('demo-1');
  });
});

describe('an autoplay persona plays it, and every ability happens', () => {
  it('splits, shields, teleports and spawns in games a player could have played', () => {
    const played = runsOf('astronaut');
    // Each of the four, across the seeds. A count of zero for any of them would be
    // the registry silently not acting — the failure `/forge` refuses to risk.
    for (const type of [
      'enemy-split',
      'shield-hit',
      'enemy-teleported',
      'minions-spawned',
    ] as const) {
      expect([type, total(played, type) > 0]).toEqual([type, true]);
    }
    // A split is a kill that leaves fragments, so there are more kills than the
    // twelve enemies the stage launched.
    const kills = played.map((run) => run.counts.get('target-destroyed') ?? 0);
    expect(Math.max(...kills)).toBeGreaterThan(12);
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
    // Sampled through the stage rather than once at the end: the ability state is
    // per stage, so a single fingerprint taken after the clear would compare
    // everything except the thing under test.
    const fingerprints = (): string[] => {
      const world = createWorld({ seed: 'abilities-det', rules: rules(), stages: stageOne() });
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
    // And the abilities are part of what was compared, not beside it.
    expect(first.some((print) => 'abilities' in (JSON.parse(print) as object))).toBe(true);
  });
});
