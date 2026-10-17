/**
 * The second lineage's game, played.
 *
 * Every other shipped game layers over Classic and runs Classic's rules. This one
 * — `variants/convoy.json` over `packs/convoy/` — layers over nothing: its own
 * roles, formation, art, sound and `rules.json`. So it is the test of the claim
 * `docs/ARCHITECTURE.md` §4.4 makes, that a sibling game is a pack, a rules
 * document and a variant and nothing under `src/` changes. This file holds it to
 * four things:
 *
 * 1. it stands alone, and nothing under `src/` names it;
 * 2. what the lineage leaves out is left out by the documents, not by code — no
 *    capture, no dual fighter, no challenge stages, one shot in flight;
 * 3. played, its divers leave by the bottom and come back in at the top, and the
 *    fighter never has a second shot in flight;
 * 4. the one thing the lineage has that this pack does not declare — a flagship
 *    diving with escorts, worth more for the company it keeps — is absent in the
 *    way `packs/convoy/README.md` says: a flagship is only ever worth its value in
 *    the convoy or its value diving alone.
 *
 * The gate (`npm run validate-packs`) flies the game's stage under its own
 * protocol, as it does every variant's; nothing here repeats that.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { Persona } from '../../src/content/personas.js';
import type { Rules } from '../../src/content/schema.js';
import type { ResolvedVariant } from '../../src/content/variants.js';
import { findCouplings } from '../../src/content/couplings.js';
import { createWorld, stepWorld } from '../../src/sim/world.js';
import { autopilotSource } from '../../src/ui/autoplay.js';
import { installedPack, shippedVariants } from '../helpers/variants.js';

const PACK_ID = 'convoy';

function variant(): ResolvedVariant {
  const found = shippedVariants().find((candidate) => candidate.id === PACK_ID);
  if (found === undefined) throw new Error(`no variants/${PACK_ID}.json`);
  return found;
}

function rules(): Rules {
  return variant().rules;
}

/** Every source file under `src/`, as text. */
function sourceFiles(dir = join(import.meta.dirname, '../../src')): [string, string][] {
  return readdirSync(dir).flatMap((name): [string, string][] => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return [[path, readFileSync(path, 'utf8')]];
  });
}

describe('it is a game of its own, and the engine does not know it', () => {
  it('layers over nothing and ships its own rules', () => {
    expect(variant().packs).toEqual([PACK_ID]);
    expect(installedPack(PACK_ID).rules).toBeDefined();
    expect(rules().id).toBe(PACK_ID);
  });

  it('is named nowhere under src/', () => {
    // The claim failing would look exactly like this: the game's id, its name or
    // one of its role or alien ids written into the engine to make it work.
    // `escort` is left out because it is an ordinary English word the engine
    // already uses for Classic's escort bonus, which predates this game.
    const pack = installedPack(PACK_ID);
    const names = [
      PACK_ID,
      variant().name.toLowerCase(),
      ...[...pack.aliens.keys()].filter((id) => id !== 'escort'),
    ];
    const found = sourceFiles().flatMap(([path, text]) =>
      names
        .filter((name) => new RegExp(`\\b${name}\\b`, 'i').test(text))
        .map((name) => ({ path, name })),
    );
    expect(found).toEqual([]);
  });

  it('meets none of the couplings a pack layered over another game’s rules meets', () => {
    expect(findCouplings(variant().registry, rules())).toEqual([]);
  });
});

describe('what the lineage leaves out is left out by the documents', () => {
  it('declares no capture, no rescue, no dual fighter and no transform attack', () => {
    expect(rules().capture.enabled).toBe(false);
    expect(rules().rescue.enabled).toBe(false);
    expect(rules().dualFighter.enabled).toBe(false);
    expect(rules().transform).toBeUndefined();
    const pack = installedPack(PACK_ID);
    expect(pack.formations.get('convoy46')?.captiveSlots).toEqual([]);
    for (const path of pack.paths.values()) {
      expect(path.segments.filter((segment) => segment.type === 'trigger')).toEqual([]);
    }
  });

  it('has no challenge stages, at any rank', () => {
    expect(rules().challengeStages.enabled).toBe(false);
    expect(installedPack(PACK_ID).manifest.stageSequence.challenge.rows).toEqual([]);
    for (const preset of variant().presets) {
      const stages = variant().stagesFor(preset.rank);
      for (let stage = 1; stage <= 12; stage += 1) {
        expect([stage, stages.stageFor(stage)?.stage.kind]).toEqual([stage, 'normal']);
      }
    }
  });

  it('allows one shot in flight', () => {
    expect(rules().player.maxShots).toBe(1);
  });

  it('brings every diver back from the top, by a path that only homes', () => {
    const pack = installedPack(PACK_ID);
    for (const alien of pack.aliens.values()) {
      expect([alien.id, alien.dive?.returns]).toEqual([alien.id, true]);
    }
    const back = pack.paths.get(rules().enemies.dive.returnPath ?? '');
    expect(back?.segments.map((segment) => segment.type)).toEqual(['toSlot']);
    expect(rules().enemies.dive.reentryY).toBeLessThan(0);
  });
});

/** The variant's default persona: the attract demo flies it first. */
function firstPersona(): Persona {
  const persona = variant().defaultPersona;
  if (persona === undefined) throw new Error('the variant names no default persona');
  return persona;
}

const SEEDS = 8;
/** Three minutes of stage 1, long past any clear measured here. */
const STAGE_STEPS = 3 * 60 * 60;

interface StageOne {
  /** Divers seen to come back in above the top of the playfield after diving. */
  readonly reentries: number;
  /** The most player shots in flight on any one step. */
  readonly mostShots: number;
  /** What each flagship kill paid. */
  readonly flagshipScores: readonly number[];
}

function stageOne(seed: string): StageOne {
  const world = createWorld({
    seed,
    rules: rules(),
    stages: variant().stagesFor(variant().defaultPreset.rank),
  });
  const pilot = autopilotSource(world, { persona: firstPersona(), seed: `pilot:${seed}` });
  const was = new Map<number, string>();
  const flagshipScores: number[] = [];
  let reentries = 0;
  let mostShots = 0;
  while (world.status === 'playing' && world.stage === 1 && world.step < STAGE_STEPS) {
    for (const event of stepWorld(world, pilot.sample())) {
      if (event.type === 'target-destroyed' && event.alienId === 'flagship') {
        flagshipScores.push(event.score);
      }
    }
    mostShots = Math.max(mostShots, world.shots.filter((shot) => shot.active).length);
    for (const enemy of world.fleet.enemies) {
      if (was.get(enemy.id) === 'diving' && enemy.state === 'returning' && enemy.y < 0) {
        reentries += 1;
      }
      was.set(enemy.id, enemy.state);
    }
  }
  return { reentries, mostShots, flagshipScores };
}

describe('played, it behaves like its lineage', () => {
  let runs: readonly StageOne[] = [];
  beforeAll(() => {
    runs = Array.from({ length: SEEDS }, (_unused, index) => stageOne(`convoy-${String(index)}`));
  });

  it('sends a diver out of the bottom and back in at the top on every seed', () => {
    expect(runs.filter((run) => run.reentries > 0)).toHaveLength(SEEDS);
  });

  it('never has two shots in flight', () => {
    expect(Math.max(...runs.map((run) => run.mostShots))).toBe(1);
  });

  it('pays a flagship its convoy value or its lone-dive value, and nothing else', () => {
    // The lineage pays more for a flagship shot while its escorts fly with it.
    // The pack names no escorts for it — the gap the pack README names — so a
    // flagship is worth 60 at home and 150 diving alone, and never anything a
    // sortie group would pay.
    const paid = new Set(runs.flatMap((run) => run.flagshipScores));
    expect([...paid].sort((a, b) => a - b)).toEqual([60, 150]);
  });
});
