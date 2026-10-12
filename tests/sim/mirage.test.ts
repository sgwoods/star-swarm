/**
 * The game that uses the other two new abilities, played.
 *
 * `tests/sim/morph-mirror-pack.test.ts` proves a pack can switch on `transform`
 * and `mirrorPlayer` without an engine change, with a pack that exists only
 * inside that file. This file is about the game a player can actually start —
 * `variants/mirage.json` over `packs/mirage/` — and about the claim that game
 * makes: that both abilities are **readable**. A watcher has to see an alien
 * become a different alien, and see an alien move because the fighter moved. So
 * beside the shape checks Spore Storm's test also makes, it holds four things to
 * measurement:
 *
 * 1. one ability per alien, and the alien a shell becomes carries none;
 * 2. `enemy-morphed` is bound to a sound and an effect, centred and brief, and
 *    on the sound channel only — a change of type is an event, not a tune;
 * 3. the change cannot be mistaken for Classic's transform attack, which runs
 *    under these same rules from stage 4: different aliens, a different place
 *    and a different sound;
 * 4. on stage 1 alone, under the persona the attract demo flies first, a shell
 *    changes and both mirrors copy on every seed — and while a mirror copies, it
 *    moves the way its mode says on most of the frames the fighter moved.
 *
 * The gate (`npm run validate-packs`) flies this game's stages under its own
 * protocol, as it does every variant's; nothing here repeats that.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { Persona } from '../../src/content/personas.js';
import type { AlienAbility, Rules } from '../../src/content/schema.js';
import type { ResolvedVariant } from '../../src/content/variants.js';
import { findCouplings } from '../../src/content/couplings.js';
import { createEffects } from '../../src/render/effects.js';
import { createWorld, stepWorld } from '../../src/sim/world.js';
import { autopilotSource } from '../../src/ui/autoplay.js';
import { installedPack, shippedVariants, unsharedRules } from '../helpers/variants.js';

const PACK_ID = 'mirage';

/** The anchor every event reports is a 16 px sprite's corner. */
const ALIEN_SIZE = 16;

/** The longest the change's effect may run, in simulation steps — as Spore Storm's. */
const LONGEST_EFFECT = 20;

function variant(): ResolvedVariant {
  const found = shippedVariants().find((candidate) => candidate.id === PACK_ID);
  if (found === undefined) throw new Error(`no variants/${PACK_ID}.json`);
  return found;
}

function rules(): Rules {
  return variant().rules;
}

/** The aliens the game's own stages put in formation, with what each carries. */
function formationAliens(): ReadonlyMap<string, readonly AlienAbility[]> {
  const pack = installedPack(PACK_ID);
  const out = new Map<string, readonly AlienAbility[]>();
  for (const stage of pack.stages.values()) {
    for (const wave of stage.waves) {
      for (const slot of wave.slots) {
        out.set(slot.alien, pack.aliens.get(slot.alien)?.abilities ?? []);
      }
    }
  }
  return out;
}

/** Every ability of one type carried in formation, keyed by the alien carrying it. */
function carriers<T extends AlienAbility['type']>(
  type: T,
): ReadonlyMap<string, Extract<AlienAbility, { type: T }>> {
  const out = new Map<string, Extract<AlienAbility, { type: T }>>();
  for (const [id, abilities] of formationAliens()) {
    for (const ability of abilities) {
      if (ability.type === type) out.set(id, ability as Extract<AlienAbility, { type: T }>);
    }
  }
  return out;
}

describe('it is a game, layered over Classic’s rules', () => {
  it('is named by a variant over Classic, and runs Classic’s rules document itself', () => {
    expect(installedPack(PACK_ID).rules).toBeUndefined();
    expect(variant().packs).toEqual(['classic', PACK_ID]);
    const base = installedPack('classic').rules;
    if (base === undefined) throw new Error('the classic pack has no rules.json');
    expect(unsharedRules(rules(), base)).toEqual([]);
  });

  it('plays its own stages at every rank, and Classic’s challenge stages between them', () => {
    const own = new Set(installedPack(PACK_ID).manifest.stageSequence.normal.rows);
    for (const preset of variant().presets) {
      const stages = variant().stagesFor(preset.rank);
      for (const stage of [1, 2, 4, 5, 6, 8]) {
        const id = stages.stageFor(stage)?.stage.id ?? '';
        expect([preset.rank, stage, own.has(id)]).toEqual([preset.rank, stage, true]);
      }
      expect(stages.stageFor(3)?.stage.kind).toBe('challenge');
    }
  });

  it('meets exactly the two couplings its README states, and no others', () => {
    expect(findCouplings(variant().registry, rules()).map((coupling) => coupling.kind)).toEqual([
      'continuous-bombing',
      'no-capture',
    ]);
  });

  it('pairs its wave slots so no two fly one lane', () => {
    for (const stage of installedPack(PACK_ID).stages.values()) {
      for (const [index, wave] of stage.waves.entries()) {
        for (let slot = 1; slot < wave.slots.length; slot += 2) {
          const first = wave.slots[slot - 1];
          const second = wave.slots[slot];
          const distinct = second?.trailing === true || first?.mirror !== second?.mirror;
          expect([stage.id, index, slot, distinct]).toEqual([stage.id, index, slot, true]);
        }
      }
    }
  });
});

describe('each alien does one thing, and the game says so', () => {
  it('gives every alien in formation exactly one ability, and uses only the two', () => {
    for (const [id, abilities] of formationAliens()) {
      expect([id, abilities.map((ability) => ability.type)]).toEqual([
        id,
        [expect.stringMatching(/^(transform|mirrorPlayer)$/)],
      ]);
    }
    expect(carriers('transform').size).toBe(1);
    // One mirror each way: the same ability, two aliens, because the two modes are
    // two different things to watch — one follows, one moves against you.
    expect([...carriers('mirrorPlayer').values()].map((ability) => ability.mode).sort()).toEqual([
      'opposite',
      'track',
    ]);
  });

  it('changes a shell into an alien that carries no ability of its own', () => {
    // A stinger that changed again would be a second behaviour arriving unannounced.
    const pack = installedPack(PACK_ID);
    for (const ability of carriers('transform').values()) {
      expect([ability.into, pack.aliens.get(ability.into)?.abilities]).toEqual([ability.into, []]);
    }
  });

  it('changes at a trigger its dive path states, not on a clock', () => {
    // A timed change lands anywhere in a dive and reads as a glitch; a scripted
    // hover before and after reads as the alien doing it.
    const pack = installedPack(PACK_ID);
    for (const [id, ability] of carriers('transform')) {
      expect(ability.afterFrames).toBeUndefined();
      for (const pathId of pack.aliens.get(id)?.dive?.paths ?? []) {
        const segments = pack.paths.get(pathId)?.segments ?? [];
        const at = segments.findIndex(
          (segment) => segment.type === 'trigger' && segment.ability === 'transform',
        );
        expect([pathId, at > 0]).toEqual([pathId, true]);
        // A hover either side of it.
        expect([segments[at - 1]?.type, segments[at + 1]?.type]).toEqual(['wait', 'wait']);
      }
    }
  });

  it('binds enemy-morphed to a sound and an effect, and Classic binds it to neither', () => {
    const { manifest, sounds, sprites } = variant().registry;
    const sound = manifest.sounds['enemy-morphed'];
    expect(sound).toBeDefined();
    expect(sounds.has(sound ?? '')).toBe(true);
    const effect = manifest.effects['enemy-morphed'];
    expect(sprites.has(effect?.sprite ?? '')).toBe(true);
    const classic = installedPack('classic').manifest;
    expect(classic.sounds['enemy-morphed']).toBeUndefined();
    expect(classic.effects['enemy-morphed']).toBeUndefined();
    // An event, not a tune: nothing on the music channel answers it.
    expect(manifest.music.filter((cue) => cue.event === 'enemy-morphed')).toEqual([]);
  });

  it('draws the change briefly, and where the alien is', () => {
    const { manifest, sprites } = variant().registry;
    const effects = createEffects({ bindings: manifest.effects, sprites });
    const duration = effects.durationOf('enemy-morphed') ?? 0;
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(LONGEST_EFFECT);
    const effect = manifest.effects['enemy-morphed'];
    const sprite = sprites.get(effect?.sprite ?? '');
    if (effect === undefined || sprite === undefined) throw new Error('nothing bound');
    expect(effect.offsetX).toBe(-(sprite.size - ALIEN_SIZE) / 2);
    expect(effect.offsetY).toBe(-(sprite.size - ALIEN_SIZE) / 2);
  });
});

describe('the change cannot be mistaken for Classic’s transform attack', () => {
  // These rules run the arcade's attack too — one settled enemy pulsing, then
  // becoming three of Classic's aliens, from stage 4. This game's change is one
  // alien becoming one alien mid-dive, and the three tests below are what keep a
  // player able to tell them apart.
  const attack = () => {
    const value = rules().transform;
    if (value === undefined) throw new Error('the rules have no transform attack');
    return value;
  };

  it('changes only aliens the attack never picks', () => {
    const pack = installedPack(PACK_ID);
    for (const id of carriers('transform').keys()) {
      expect([id, attack().fromRoles.includes(pack.aliens.get(id)?.role ?? '')]).toEqual([
        id,
        false,
      ]);
    }
  });

  it('changes into its own alien, never one of the attack’s', () => {
    for (const ability of carriers('transform').values()) {
      expect(attack().types).not.toContain(ability.into);
    }
  });

  it('sounds unlike the attack', () => {
    const { manifest } = variant().registry;
    expect(manifest.sounds['enemy-morphed']).not.toBe(manifest.sounds['enemy-transformed']);
  });
});

/**
 * The variant's default persona: the attract demo flies it first, so it is the
 * one a watcher meets (`docs/ARCHITECTURE.md` §7).
 */
function firstPersona(): Persona {
  const persona = variant().defaultPersona;
  if (persona === undefined) throw new Error('the variant names no default persona');
  return persona;
}

const SEEDS = 8;
/** Three minutes: long past any stage 1 measured here, so reaching it is a stall. */
const STAGE_STEPS = 3 * 60 * 60;

interface StageOne {
  readonly morphs: number;
  /** Per mode: steps a mirror copied while the fighter it copies had moved. */
  readonly moved: Readonly<Record<'track' | 'opposite', number>>;
  /** Per mode: of those, the steps on which the mirror moved the way its mode says. */
  readonly agreed: Readonly<Record<'track' | 'opposite', number>>;
}

/** Stage 1, flown from the first step by the default persona, and what both abilities did. */
function stageOne(seed: string): StageOne {
  const world = createWorld({
    seed,
    rules: rules(),
    stages: variant().stagesFor(variant().defaultPreset.rank),
  });
  const pilot = autopilotSource(world, { persona: firstPersona(), seed: `pilot:${seed}` });
  const mirrors = carriers('mirrorPlayer');
  const fighter: number[] = [];
  const lastX = new Map<number, number>();
  const moved = { track: 0, opposite: 0 };
  const agreed = { track: 0, opposite: 0 };
  let morphs = 0;
  while (world.status === 'playing' && world.stage === 1 && world.step < STAGE_STEPS) {
    for (const event of stepWorld(world, pilot.sample())) {
      if (event.type === 'enemy-morphed') morphs += 1;
    }
    fighter.push(world.player.alive ? world.player.x : Number.NaN);
    for (const enemy of world.fleet.enemies) {
      const previous = lastX.get(enemy.id);
      lastX.set(enemy.id, enemy.x);
      const mirror = mirrors.get(enemy.alienId);
      // Copying is a full memory: `delayFrames + 1` readings of the fighter.
      const memory = world.abilities.mirrorPlayer.get(enemy.id);
      if (mirror === undefined || enemy.state !== 'diving' || previous === undefined) continue;
      if (memory?.seen.length !== mirror.delayFrames + 1) continue;
      const at = fighter.length - 1 - mirror.delayFrames;
      const copied = (fighter[at] ?? Number.NaN) - (fighter[at - 1] ?? Number.NaN);
      if (!Number.isFinite(copied) || copied === 0) continue;
      moved[mirror.mode] += 1;
      const want = mirror.mode === 'track' ? Math.sign(copied) : -Math.sign(copied);
      if (Math.sign(enemy.x - previous) === want) agreed[mirror.mode] += 1;
    }
  }
  return { morphs, moved, agreed };
}

describe('a watcher sees both on the first stage', () => {
  let runs: readonly StageOne[] = [];
  beforeAll(() => {
    runs = Array.from({ length: SEEDS }, (_unused, index) => stageOne(`watch-${String(index)}`));
  });

  it('changes a shell on stage 1 of every seed', () => {
    expect(runs.filter((run) => run.morphs > 0)).toHaveLength(SEEDS);
  });

  it.each(['track', 'opposite'] as const)('has a %s mirror copying on every seed', (mode) => {
    expect(runs.filter((run) => run.moved[mode] > 0)).toHaveLength(SEEDS);
  });

  it.each(['track', 'opposite'] as const)(
    'moves a %s mirror the way the fighter’s move says, on most frames it copies one',
    (mode) => {
      // Measured at 87% and 93% over twenty-four seeds. Below four in five, the
      // path's own motion is showing through enough to read as drift.
      const moved = runs.reduce((sum, run) => sum + run.moved[mode], 0);
      const agreed = runs.reduce((sum, run) => sum + run.agreed[mode], 0);
      expect(agreed / moved).toBeGreaterThan(0.8);
    },
  );
});
