/**
 * The ability registry (`docs/DESIGN.md` section 7.5): one module per engine
 * ability, and the one place the world asks them anything.
 *
 * An ability is **engine behaviour that a pack switches on and tunes, never one
 * a pack defines**. That split is the whole design, and it is held in three
 * places at once:
 *
 * - `src/content/schema.ts` lists every id, validates each implemented one's
 *   parameters with a schema of its own, and keeps the rest in
 *   `RESERVED_ABILITY_TYPES`, where any parameters would validate and nothing
 *   would read them — an empty list today, because every id has a module.
 * - {@link ABILITY_REGISTRY} below is typed over exactly the implemented ids, so
 *   an id added to the schema without a module — or a module whose id the schema
 *   reserves — is a build error rather than a mechanic that silently never runs.
 * - Each module is a set of hooks the world calls at fixed points of a step.
 *   None of them reads a pack, an alien or a file: an enemy carries its alien's
 *   abilities with their parameters already validated (`Enemy.abilities`).
 *
 * Two kinds of module live here. `captureBeam` is a **channel**: one per run,
 * switched on by `rules.capture` rather than by an alien, stepped by the world
 * directly because a captured fighter outlives the stage it was taken in
 * (`./capture-beam.ts`). The rest act on the **enemy** that declares them, and
 * that is what {@link stepAbilities}, {@link abilitiesAbsorbShot} and
 * {@link abilitiesNoteDestroyed} dispatch over.
 *
 * Determinism: an ability that needs a random number draws it from the world's
 * own seeded generator, and only when it acts — so content without abilities
 * draws exactly what it always drew, and a seed still gives one world.
 */

import type {
  AbilityParams,
  AlienAbility,
  ImplementedAbilityType,
  Rules,
} from '../../content/schema.js';
import { isImplementedAbility } from '../../content/schema.js';
import type { StageContent } from '../../content/stages.js';
import type { Rng } from '../../engine/rng.js';
import type { Enemy, Fleet, ScriptedTrigger } from '../enemies.js';
import type { FormationState } from '../formation.js';
import type { Vec2 } from '../paths.js';
import { captureBeam } from './capture-beam.js';
import { type MirrorState, mirrorPlayer } from './mirror-player.js';
import { type ShieldState, shield } from './shield.js';
import { type SpawnState, spawnMinions } from './spawn-minions.js';
import { splitOnHit } from './split-on-hit.js';
import { type TeleportState, teleport } from './teleport.js';
import { type TransformState, transform } from './transform.js';

/* -------------------------------------------------------------------------- */
/* What a module is handed, and what it hands back                             */
/* -------------------------------------------------------------------------- */

/**
 * Everything an ability may ask of the world for one step.
 *
 * The same shape the attack director is handed, because an ability that puts
 * an enemy on the field does it through the same `spawnDiver` and the same
 * seeded generator.
 */
export interface AbilityContext {
  readonly fleet: Fleet;
  readonly content: StageContent;
  readonly formation: FormationState;
  readonly rules: Rules;
  readonly rng: Rng;
  /** The fighter's anchor, or `undefined` while it is off the field. */
  readonly playerAt: Vec2 | undefined;
  /**
   * Whether anything may attack on this stage (`allowsAttacks`).
   *
   * The registry is stepped outside the attack director, so the director's own
   * gate does not cover it — the same position the capture channel is in
   * (`AGENTS.md`). An ability that puts an attacker on the field asks this.
   */
  readonly attacks: boolean;
  /** Whether the formation has settled and the dives are armed. */
  readonly armed: boolean;
  /**
   * The enemy the capture channel has chosen for the attempt in progress, if any.
   *
   * The channel chose it for its role, and its dive is the channel's capture dive,
   * so an ability that would change what it *is* — `transform` — leaves it alone.
   */
  readonly captorId: number | undefined;
}

/**
 * Per-enemy ability state for the stage on the field.
 *
 * Keyed by enemy id, and **replaced every stage** because enemy ids are per
 * stage: the id an enemy had is some other enemy's next stage. Entries are made
 * lazily, the first time an ability acts, which is what lets
 * {@link abilityFingerprint} say nothing at all for a stage in which no ability
 * did anything.
 */
export interface AbilityState {
  readonly shield: Map<number, ShieldState>;
  readonly teleport: Map<number, TeleportState>;
  readonly spawnMinions: Map<number, SpawnState>;
  readonly transform: Map<number, TransformState>;
  readonly mirrorPlayer: Map<number, MirrorState>;
  /**
   * Every enemy that has changed type this stage, and the alien it is now.
   *
   * Not state any module reads: a record, because an enemy's alien is not part of
   * the per-enemy fingerprint, and a change of type must not be invisible to a
   * replay comparison. It outlives the change on purpose — unlike everything
   * else here, it is not the old type's to lose.
   */
  readonly transformed: Map<number, string>;
}

/** What one step of the registry did, for the world to turn into events. */
export interface AbilityStep {
  /** Enemies that blinked on this frame, and where from. */
  readonly teleported: { readonly enemy: Enemy; readonly from: Vec2 }[];
  /** Minions put on the field on this frame, by the enemy that launched them. */
  readonly spawned: { readonly parent: Enemy; readonly minions: readonly Enemy[] }[];
  /** Enemies whose shield was whole again on this frame. */
  readonly restored: Enemy[];
  /** Enemies that became another alien on this frame, and the alien each was. */
  readonly transformed: { readonly enemy: Enemy; readonly from: string }[];
}

/**
 * One ability, as the hooks the world calls.
 *
 * Every hook is optional because the points in a step where an ability can act
 * are fixed and few, and most abilities act at one of them. `params` is the
 * entry from the alien, already validated by that ability's own schema.
 */
export interface AbilityModule<T extends ImplementedAbilityType> {
  readonly type: T;
  /**
   * Once per frame, after the fleet has flown, for each enemy on the field that
   * carries it. `triggered` is true when the enemy's flight passed a `trigger`
   * segment naming this ability on this frame.
   */
  readonly step?: (
    state: AbilityState,
    ctx: AbilityContext,
    enemy: Enemy,
    params: AbilityParams<T>,
    triggered: boolean,
    out: AbilityStep,
  ) => void;
  /**
   * A player shot connected. Return `true` to take the hit instead of the enemy:
   * the shot is spent and the enemy's `hp` is untouched.
   */
  readonly absorbShot?: (state: AbilityState, enemy: Enemy, params: AbilityParams<T>) => boolean;
  /** Destroyed by a player shot. Returns the enemies it left on the field. */
  readonly destroyed?: (
    state: AbilityState,
    ctx: AbilityContext,
    enemy: Enemy,
    params: AbilityParams<T>,
  ) => readonly Enemy[];
}

/**
 * Every implemented ability, by id.
 *
 * The mapped type is the check: its keys are the schema's ids minus the
 * reserved ones, so this object cannot omit one or carry an extra.
 */
export const ABILITY_REGISTRY: { readonly [K in ImplementedAbilityType]: AbilityModule<K> } = {
  captureBeam,
  splitOnHit,
  transform,
  shield,
  teleport,
  spawnMinions,
  mirrorPlayer,
};

/**
 * Is this entry one a module implements? Narrows it to that module's parameters.
 *
 * A predicate rather than a cast at each call, so the dispatch below is checked in
 * both of the registry's states: with every id implemented, as now, and with an id
 * reserved again, when an entry may be one that no module reads.
 */
function isImplementedEntry(
  ability: AlienAbility,
): ability is AbilityParams<ImplementedAbilityType> {
  return isImplementedAbility(ability.type);
}

/** The module an implemented entry names. */
function moduleOf(
  ability: AbilityParams<ImplementedAbilityType>,
): AbilityModule<ImplementedAbilityType> {
  // One cast, here, rather than one per hook call: the registry is keyed so that
  // `ABILITY_REGISTRY[ability.type]` is the module for exactly this entry, which
  // the type system cannot correlate across a union on its own.
  return ABILITY_REGISTRY[ability.type] as AbilityModule<ImplementedAbilityType>;
}

/**
 * Which enemies the registry acts on.
 *
 * The player's captured fighter is excluded: it is drawn as an alien, but it is
 * the player's own ship held by the capture channel, and what it does is the
 * channel's business.
 */
function carriesAbilities(enemy: Enemy): boolean {
  return enemy.abilities.length > 0 && !enemy.inCaptiveSlot;
}

/* -------------------------------------------------------------------------- */
/* What the world calls                                                         */
/* -------------------------------------------------------------------------- */

/** Empty state, for a new stage. */
export function createAbilityState(): AbilityState {
  return {
    shield: new Map(),
    teleport: new Map(),
    spawnMinions: new Map(),
    transform: new Map(),
    mirrorPlayer: new Map(),
    transformed: new Map(),
  };
}

/**
 * Forget everything the modules held for one enemy.
 *
 * What a change of type costs it: shield charges, timers, a spawner's count of
 * its minions and a mirror's memory all belong to the alien it was. The record
 * of what it became is kept — see {@link AbilityState.transformed}.
 */
function forgetType(state: AbilityState, id: number): void {
  state.shield.delete(id);
  state.teleport.delete(id);
  state.spawnMinions.delete(id);
  state.transform.delete(id);
  state.mirrorPlayer.delete(id);
}

/**
 * Advance every enemy's abilities by one frame.
 *
 * Stepped after the fleet, the attack director and the capture channel, so an
 * ability reads where its enemy has just flown to — and so content that declares
 * no ability reaches here and does nothing at all.
 */
export function stepAbilities(
  state: AbilityState,
  ctx: AbilityContext,
  triggered: readonly ScriptedTrigger[],
): AbilityStep {
  const out: AbilityStep = { teleported: [], spawned: [], restored: [], transformed: [] };
  // A snapshot: a minion launched on this frame acts from the next one.
  for (const enemy of [...ctx.fleet.enemies]) {
    if (enemy.state === 'dead' || !carriesAbilities(enemy)) continue;
    for (const ability of enemy.abilities) {
      if (!isImplementedEntry(ability)) continue;
      const module = moduleOf(ability);
      if (module.step === undefined) continue;
      const fired = triggered.some(
        (event) => event.enemy.id === enemy.id && event.ability === ability.type,
      );
      const changes = out.transformed.length;
      module.step(state, ctx, enemy, ability, fired, out);
      if (out.transformed.length > changes) {
        // It became another alien on this frame. What the old one's abilities
        // held goes with it, the rest of the old list does not act, and the new
        // alien's abilities act from the next frame.
        forgetType(state, enemy.id);
        break;
      }
    }
  }
  return out;
}

/**
 * Offer a shot that has connected to the enemy's abilities first.
 *
 * Returns the ability that took it, or `undefined` when the hit lands on the
 * enemy as it always has.
 */
export function abilitiesAbsorbShot(
  state: AbilityState,
  enemy: Enemy,
): ImplementedAbilityType | undefined {
  if (!carriesAbilities(enemy)) return undefined;
  for (const ability of enemy.abilities) {
    if (!isImplementedEntry(ability)) continue;
    const module = moduleOf(ability);
    if (module.absorbShot === undefined) continue;
    if (module.absorbShot(state, enemy, ability)) return module.type;
  }
  return undefined;
}

/**
 * Tell the registry an enemy was destroyed by a shot, and collect what it left.
 *
 * Called after the kill is scored and reported, so whatever it leaves arrives
 * after the `target-destroyed` it came from.
 */
export function abilitiesNoteDestroyed(
  state: AbilityState,
  ctx: AbilityContext,
  enemy: Enemy,
): readonly Enemy[] {
  if (!carriesAbilities(enemy)) return [];
  const left: Enemy[] = [];
  for (const ability of enemy.abilities) {
    if (!isImplementedEntry(ability)) continue;
    const module = moduleOf(ability);
    if (module.destroyed === undefined) continue;
    left.push(...module.destroyed(state, ctx, enemy, ability));
  }
  return left;
}

/** Hits left on an enemy's shield, or `undefined` if it has none in play. */
export function shieldRemaining(state: AbilityState, enemy: Enemy): number | undefined {
  return state.shield.get(enemy.id)?.remaining;
}

/**
 * A single comparable value for the registry, for the golden replays — or
 * `undefined` when no ability has acted on this stage.
 *
 * `undefined` rather than an empty list on purpose: `fingerprintWorld` drops an
 * undefined field from its JSON, so a run through content with no abilities
 * fingerprints byte for byte as it did before the registry existed, and every
 * golden in `tests/sim/golden/` still reproduces.
 */
export function abilityFingerprint(state: AbilityState): readonly unknown[] | undefined {
  const maps = [
    state.shield,
    state.teleport,
    state.spawnMinions,
    state.transform,
    state.mirrorPlayer,
    state.transformed,
  ] as const;
  if (maps.every((map) => map.size === 0)) return undefined;
  const sorted = <T>(map: ReadonlyMap<number, T>): [number, T][] =>
    [...map].sort(([a], [b]) => a - b);
  return maps.map((map) => sorted<unknown>(map));
}
