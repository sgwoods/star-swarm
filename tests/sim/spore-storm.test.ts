/**
 * The game that uses four of the new abilities, played.
 *
 * `tests/sim/ability-pack.test.ts` proves a pack can switch on `splitOnHit`,
 * `shield`, `teleport` and `spawnMinions` without an engine change, with a pack
 * that exists only inside that file. This file is about the game a player can
 * actually start — `variants/spore-storm.json` over `packs/spore-storm/` — and
 * about the claim that game exists to make: that each ability is **readable**. A
 * watcher has to be able to say what each alien does without being told, and an
 * ability that acts but cannot be seen does not meet that. So beside the usual
 * shape checks, it holds three things to measurement:
 *
 * 1. one ability per alien, so what an alien does is a single thing to notice;
 * 2. every event the four raise is bound to a sound and to an effect, centred on
 *    the alien and over before the alien has flown out from under it;
 * 3. on stage 1 alone, under the persona the attract demo flies first, every one
 *    of the four happens — on every seed, not on average.
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
import type { SimEventType } from '../../src/sim/events.js';
import { createWorld, stepWorld } from '../../src/sim/world.js';
import { autopilotSource } from '../../src/ui/autoplay.js';
import { installedPack, shippedVariants, unsharedRules } from '../helpers/variants.js';

const PACK_ID = 'spore-storm';

/** What each of the four abilities raises, and so what a watcher has to see and hear. */
const ABILITY_EVENTS: Readonly<Record<string, readonly SimEventType[]>> = {
  splitOnHit: ['enemy-split'],
  shield: ['shield-hit', 'shield-restored'],
  teleport: ['enemy-teleported'],
  spawnMinions: ['minions-spawned'],
};

const EVENTS = Object.values(ABILITY_EVENTS).flat();

/** The anchor every event reports is a 16 px sprite's corner. */
const ALIEN_SIZE = 16;

/**
 * The longest an ability's effect may run, in simulation steps.
 *
 * An effect is drawn where the event happened and the alien keeps flying, so one
 * that outlasts a third of a second is left behind on empty sky — a ring around
 * nothing, which reads as a different thing happening.
 */
const LONGEST_EFFECT = 20;

function variant(): ResolvedVariant {
  const found = shippedVariants().find((candidate) => candidate.id === PACK_ID);
  if (found === undefined) throw new Error(`no variants/${PACK_ID}.json`);
  return found;
}

function rules(): Rules {
  return variant().rules;
}

/** The aliens the game's own stages put in formation. */
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
    // `docs/content-guide.md` section 7. A smaller fleet than Classic's under
    // Classic's absolute bombing threshold, and no captive slots — so no tractor
    // beam, on purpose. A third would be a coupling nobody has written down.
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
  it('gives every alien in formation exactly one of the four, and uses all four', () => {
    const carried = new Map<string, string>();
    for (const [id, abilities] of formationAliens()) {
      expect([id, abilities.length]).toEqual([id, 1]);
      const type = abilities[0]?.type ?? '';
      // One alien per ability, too: two aliens sharing one would be two things to
      // learn for a single behaviour.
      expect([type, carried.get(type)]).toEqual([type, undefined]);
      carried.set(type, id);
    }
    expect([...carried.keys()].sort()).toEqual(Object.keys(ABILITY_EVENTS).sort());
  });

  it('puts plain aliens on the field when an ability puts anything there', () => {
    // A fragment that split again, or a minion that spawned, would be a second
    // ability on screen the watcher had not been shown arriving.
    const pack = installedPack(PACK_ID);
    for (const abilities of formationAliens().values()) {
      for (const ability of abilities) {
        const offspring =
          ability.type === 'splitOnHit'
            ? ability.into
            : ability.type === 'spawnMinions'
              ? ability.alien
              : undefined;
        if (offspring === undefined) continue;
        expect([offspring, pack.aliens.get(offspring)?.abilities]).toEqual([offspring, []]);
      }
    }
  });

  it.each(EVENTS)('binds %s to a sound and an effect, and Classic binds it to neither', (type) => {
    const { manifest, sounds, sprites } = variant().registry;
    const sound = manifest.sounds[type];
    expect(sound).toBeDefined();
    expect(sounds.has(sound ?? '')).toBe(true);
    const effect = manifest.effects[type];
    expect(effect).toBeDefined();
    expect(sprites.has(effect?.sprite ?? '')).toBe(true);
    // The binding is this game's: the arcade game neither sounds nor shows one.
    const classic = installedPack('classic').manifest;
    expect(classic.sounds[type]).toBeUndefined();
    expect(classic.effects[type]).toBeUndefined();
  });

  it.each(EVENTS)('draws the effect for %s briefly, and where the alien is', (type) => {
    const { manifest, sprites } = variant().registry;
    const effects = createEffects({ bindings: manifest.effects, sprites });
    const duration = effects.durationOf(type) ?? 0;
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(LONGEST_EFFECT);

    const effect = manifest.effects[type];
    const sprite = sprites.get(effect?.sprite ?? '');
    if (effect === undefined || sprite === undefined) throw new Error(`nothing bound to ${type}`);
    // Wider than the alien, centred across it — a ring that sits to one side reads
    // as something happening next to the alien rather than to it.
    if (sprite.size > ALIEN_SIZE) {
      expect(effect.offsetX).toBe(-(sprite.size - ALIEN_SIZE) / 2);
    } else {
      expect(effect.offsetX).toBe(0);
    }
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

/** The ability events stage 1 raised, flown from the first step by the default persona. */
function stageOne(seed: string): ReadonlySet<SimEventType> {
  const world = createWorld({
    seed,
    rules: rules(),
    stages: variant().stagesFor(variant().defaultPreset.rank),
  });
  const pilot = autopilotSource(world, { persona: firstPersona(), seed: `pilot:${seed}` });
  const seen = new Set<SimEventType>();
  while (world.status === 'playing' && world.stage === 1 && world.step < STAGE_STEPS) {
    for (const event of stepWorld(world, pilot.sample())) {
      if (EVENTS.includes(event.type)) seen.add(event.type);
    }
  }
  return seen;
}

describe('a watcher sees all four on the first stage', () => {
  let runs: readonly ReadonlySet<SimEventType>[] = [];
  beforeAll(() => {
    runs = Array.from({ length: SEEDS }, (_unused, index) => stageOne(`watch-${String(index)}`));
  });

  it.each(['enemy-split', 'shield-hit', 'enemy-teleported', 'minions-spawned'] as const)(
    '%s happens on stage 1 of every seed',
    (type) => {
      expect(runs.filter((seen) => seen.has(type))).toHaveLength(SEEDS);
    },
  );

  it('lets a shield grow back on some of them', () => {
    // A recharge needs the pilot to leave a broken shield alone for fifteen
    // seconds, so it is the one that depends on how the stage went — but a binding
    // nothing ever raises would be a sound and an effect nobody can meet.
    expect(runs.some((seen) => seen.has('shield-restored'))).toBe(true);
  });
});
