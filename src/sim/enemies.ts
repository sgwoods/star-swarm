/**
 * Enemies: entry waves, the four-phase update, and slot homing
 * (`docs/DESIGN.md` section 4, "Enemies and formation").
 *
 * Four ideas hold this file together, and each of them is a thing a plausible
 * implementation gets wrong:
 *
 * 1. **A wave is an ordered list of slots, not a type plus a count.** The arcade
 *    waves are mixed — wave 2 is all four bosses plus four butterfly-role aliens
 *    — and each alien in a pair carries its own `mirror` and `trailing` flag
 *    (`docs/reference/arcade-reference.md` section 5). So {@link createFleet}
 *    walks the slots a stage document lists and builds one enemy per slot.
 * 2. **Waves are identity-addressed.** A slot's `home` names *which* formation
 *    slot that enemy owns, for the whole stage, rather than "the next free one".
 *    That is what makes a wave reproducible and what a capture or a rescue later
 *    depends on. A pack that omits `home` gets the next free slot of the alien's
 *    role, which is what a hand-written pack wants.
 * 3. **The update is a round robin.** The original advances enemy *state* on a
 *    four-frame rotation rather than every enemy every frame, and that cadence
 *    paces launches and later dives (`rules.enemies.updatePhases`). Positions
 *    still move every frame — it is the state machine that takes turns — because
 *    a position that only moved every fourth frame would visibly stutter.
 * 4. **Homing is the path interpreter's job, not a second implementation.** The
 *    `toSlot` segment already resolves the flyer's slot when the path compiles,
 *    so an entering enemy simply flies a path that ends in one. The only wrinkle
 *    is that the formation is swaying while it flies, which
 *    {@link slotPositionAhead} answers exactly rather than approximately.
 *
 * No constants: every number arrives in the `Rules` value or the stage document.
 */

import { resolveEscortBonus } from '../content/rules.js';
import type { Alien, AlienAbility, Rules, Wave } from '../content/schema.js';
import type { StageContent } from '../content/stages.js';
import type { Rng } from '../engine/rng.js';
import type { HitPadding } from './collision.js';
import type { FormationState } from './formation.js';
import { completeEntry, homePosition, homePositionAhead, isRightOfCentre } from './formation.js';
import type { CompiledPath, PathPose, PathSample, TargetResolver, Vec2 } from './paths.js';
import { compilePath, pathEventsBetween, samplePath } from './paths.js';

/**
 * Where an enemy is in its life, in the arcade's own terms.
 *
 * The distinction that matters for scoring is `home`/`returning` against
 * everything else: the original doubles a target's value unless it is at home in
 * the formation or rotating back into its slot, which is a test on the *state*
 * and not on whether the thing is visibly moving. So an enemy shot during the
 * entry wave scores the diving value, and one shot on its way back into its slot
 * scores the formation value.
 *
 * So the live states are: waiting to launch, flying in, sitting in the formation,
 * attacking, holding still with a tractor beam out, and rotating back into the
 * slot afterwards. Only the *last* of them scores the formation value while
 * visibly moving.
 *
 * `beaming` is a captor holding its beam: it has stopped flying its path but it is
 * still on the field, still shootable, and still worth the attacking value — which
 * is the whole reason it is a state rather than a flag. Its flight resumes from the
 * frame it paused on, because a `beaming` enemy is simply one `stepFleet` does not
 * advance (`src/sim/abilities/capture-beam.ts`).
 *
 * `dead` is the one terminal state, and it holds **two** endings: shot down, and
 * flown off the field alive — a diver that does not return, or a challenge-stage
 * flyer whose script never addressed a slot. They are told apart by the *events*
 * (`target-destroyed` against `enemy-departed`) rather than by the state, because
 * nothing downstream treats the two differently: neither is on the field, neither
 * is drawn, and both let the stage end. What does differ is the score and the
 * hit count, and both of those are counted from the events.
 */
export type EnemyState =
  'standby' | 'entering' | 'home' | 'diving' | 'beaming' | 'returning' | 'dead';

/** States that score the formation value rather than the doubled one. */
const AT_HOME_VALUE: ReadonlySet<EnemyState> = new Set<EnemyState>(['home', 'returning']);

export interface Enemy {
  readonly id: number;
  readonly alienId: string;
  readonly role: string;
  /** Sprite id, and what it becomes after each hit it survives. */
  readonly sprite: string;
  readonly hitSprites: readonly string[];
  /**
   * Index into the formation's slots: this enemy's own home, for the stage, or
   * {@link NO_SLOT} when its script never addresses one. Which slot *table* it
   * indexes is {@link Enemy.inCaptiveSlot}.
   */
  readonly home: number;
  /**
   * Whether `home` indexes the formation's **captive** slots rather than its
   * alien slots.
   *
   * True for exactly one thing: the player's captured fighter, which lives in the
   * row the arcade keeps above the captors. Everything else about it is an
   * ordinary enemy — it flies in, sits in its slot, dives, and can be shot for
   * points — so one flag on the home address is cheaper and truer than a second
   * kind of object (`src/sim/abilities/capture-beam.ts`).
   */
  readonly inCaptiveSlot: boolean;
  /** Which frame of the update round robin advances this enemy's state. */
  readonly phase: number;
  /** Frames after the stage began at which it is due to launch. */
  readonly launchFrame: number;
  /** The entry path it flies, and whether it flies the mirrored variant. */
  readonly path: string;
  readonly mirror: boolean;
  /**
   * Whether its entry path ends in its formation slot.
   *
   * **The path decides, not the stage.** A path that addresses a slot leaves the
   * flyer at home; one that does not — every challenge-stage script — has it
   * leave the field at the end, reported as a departure rather than a kill.
   * Reading it off the path keeps the one answer to "does this enemy join the
   * formation?" in the same place as the geometry that settles it, rather than in
   * a second test on the stage kind that could disagree with the data.
   */
  readonly homes: boolean;
  /** Launched behind its pair partner rather than alongside it. */
  readonly trailing: boolean;
  /** The wave it belongs to, zero-based. Reported in events. */
  readonly wave: number;

  readonly hp: number;
  /** Points before the moving multiplier; the alien's `score.base`. */
  readonly scoreBase: number;
  /** What a moving target's base value is multiplied by, for this alien. */
  readonly movingMultiplier: number;
  /**
   * Points this enemy's own kill pays on top of its doubled value — a captor's
   * escort bonus (`resolveEscortBonus`), and 0 for everything else.
   *
   * **Latched, and reset every stage**, which is what a flat score table cannot
   * express: the arcade writes one escort record per boss, resets all four to the
   * solo value at the *start of every stage* and overwrites one only when that
   * boss is launched by the bomber launcher. Nothing touches it when an escort
   * dies, so killing the escorts first does not reduce the captor's value, and a
   * captor that reaches a dive without having been launched is worth the solo
   * value (`docs/reference/arcade-reference.md` section 9).
   *
   * A fleet is built anew for every stage, so *this field being set here is the
   * per-stage reset*. Nothing overwrites it yet because nothing launches escorts:
   * Star Swarm's launcher sends one enemy of a role at a time, so the reachable
   * value is the solo one. When escorts arrive this stops being `readonly` and
   * `launchDive` in `./dive.js` is where the launch count is latched.
   */
  readonly escortBonus: number;
  readonly hitPadding: HitPadding;

  /** The attack paths this alien may dive along; empty for one that never dives. */
  readonly divePaths: readonly string[];
  /** This alien's share of the dive lottery within its role. */
  readonly diveWeight: number;
  /**
   * False for an alien that leaves for good after a dive instead of returning.
   *
   * Mutable for one case: a captured fighter returns to its slot while its captor
   * lives, and stops returning the moment it turns rogue. It is deliberately left
   * out of {@link enemyFingerprint} because it is derivable from the capture
   * channel's phase, which *is* fingerprinted.
   */
  returnsFromDive: boolean;
  /** How this alien bombs, or `undefined` for one that never does. */
  readonly fire: EnemyFire | undefined;
  /**
   * The engine abilities its alien switches on, with their parameters.
   *
   * Copied off the alien like everything else here, so the registry
   * (`./abilities/registry.ts`) works on the enemy and never looks an alien up.
   * Left out of {@link enemyFingerprint}: it never changes, and what an ability
   * *does* is carried in the world's ability state, which is fingerprinted.
   */
  readonly abilities: readonly AlienAbility[];

  state: EnemyState;
  /** Sprite anchor, matching every other anchor in the simulation. */
  x: number;
  y: number;
  /** Degrees, clockwise positive, 0 pointing down the screen. */
  heading: number;
  hitsRemaining: number;
  /** Frames into its current flight path; `-1` before it has launched. */
  pathFrame: number;
  /**
   * Frames until this enemy may drop its next bomb.
   *
   * **This is the per-enemy inter-shot delay** (`docs/DESIGN.md` section 4), and
   * it lives on the enemy rather than on a global timer for exactly the reason the
   * plan gives: forty enemies with one shared timer fire in lockstep. It is
   * loaded at stage start from `rules.enemies.bomberReadyTimers` for the enemy's
   * role and reloaded from the alien's own `fire.cooldownFrames` after each shot.
   */
  bombTimer: number;
  /** Bombs left in this attack run; reloaded when a dive or an entry begins. */
  bombsLeft: number;
}

/** What an alien's `fire` block resolves to on the enemy that carries it. */
export interface EnemyFire {
  readonly pattern: NonNullable<Alien['fire']>['pattern'];
  readonly shotsPerDive: number;
  readonly cooldownFrames: number;
  readonly spreadOffsets: readonly number[];
}

export interface Fleet {
  readonly enemies: Enemy[];
  /**
   * Compiled flight paths by enemy id.
   *
   * Kept beside the enemies rather than on them: a `CompiledPath` is backed by
   * closures, so an `Enemy` that held one would no longer be a plain value that
   * a fingerprint or a saved state can serialise.
   */
  readonly flights: Map<number, CompiledPath>;
  /** Frames since the stage began. The only clock the fleet has. */
  frame: number;
  /** True once no enemy is waiting to launch or still flying in. */
  entryComplete: boolean;
}

/**
 * Refinement passes for the swaying-slot prediction.
 *
 * A `toSlot` segment's duration depends on where the slot is, and where the slot
 * will be depends on how long the flight takes — so the answer is a fixed point.
 * The sway moves at a fraction of an enemy's speed, so each pass cuts the error
 * by roughly that ratio and three passes land well inside a pixel.
 */
const SLOT_PREDICTION_PASSES = 3;

/** States in which the enemy is on the field and a shot can be tested against it. */
const TARGETABLE: ReadonlySet<EnemyState> = new Set<EnemyState>([
  'entering',
  'home',
  'diving',
  // A captor with its beam out is shootable, and shooting it is one of the ways
  // the capture channel is released (`docs/reference/arcade-reference.md` s7).
  'beaming',
  'returning',
]);

/**
 * `home` for an enemy that owns no formation slot.
 *
 * A challenge-stage flyer has no home: it flies its script and leaves, and the
 * forty of them would otherwise have to claim forty slots they never reach —
 * which a formation shaped for a different role mix cannot even supply. Negative
 * so that nothing can mistake it for slot 0.
 */
export const NO_SLOT = -1;

/** Everything on the field that a shot can be tested against. */
export function isTargetable(enemy: Enemy): boolean {
  return TARGETABLE.has(enemy.state);
}

/**
 * Does this path put the flyer in its formation slot?
 *
 * A `toSlot` segment is the only thing that addresses one, so its presence is
 * the whole test — and it is a property of the path rather than of the stage,
 * which is what stops a challenge script and a `kind: "challenge"` document from
 * having to agree. A path the stage does not carry is treated as homing, which
 * is what the entry paths are; {@link launchEnemy} is where the missing path
 * becomes an error, with the flyer's id in the message.
 */
function pathAddressesSlot(content: StageContent, path: string): boolean {
  // Spelled `movement`, not `document`: the boundary scan in
  // `tests/unit/sim-boundary.test.ts` is textual, so an identifier named after a
  // host global fails inside `src/sim/` even as a local (`AGENTS.md`).
  const movement = content.paths.get(path);
  if (movement === undefined) return true;
  return movement.segments.some((segment) => segment.type === 'toSlot');
}

/**
 * Enemies still on the field: everything that has not reached `dead`.
 *
 * Both ways off the field end there — shot down, and flown away alive — which is
 * what lets one test end a stage whether its enemies were destroyed or merely
 * sailed past. A challenge stage nobody fires a shot on ends on this.
 */
export function aliveEnemies(enemies: readonly Enemy[]): Enemy[] {
  return enemies.filter((enemy) => enemy.state !== 'dead');
}

/**
 * The enemies that count as "how many are left".
 *
 * The player's captured fighter does **not**: it stays with its captor for the
 * rest of the game rather than being something to clear
 * (`docs/reference/arcade-reference.md` section 7), so a stage that is otherwise
 * empty still ends, and the thresholds keyed on the live count — continuous
 * bombing, the transform — measure the fleet rather than the fleet plus your own
 * stolen ship.
 */
export function fleetEnemies(enemies: readonly Enemy[]): Enemy[] {
  return enemies.filter((enemy) => enemy.state !== 'dead' && !enemy.inCaptiveSlot);
}

/**
 * What destroying this enemy is worth, right now.
 *
 * The base value comes from the alien, the multiplier from the alien or the rules
 * layer, and which of the two applies from the enemy's *state* — see
 * {@link EnemyState}.
 *
 * A captor's latched {@link Enemy.escortBonus} is part of that value rather than a
 * separate award, which is the one place this differs from the transform trio and
 * the challenge group of eight. Those are bonuses for clearing a *set*, and the
 * original floats their own score tile beside the kill; a captor's escort record
 * carries the tile the boss itself shows, so a diving captor is one number — 400,
 * 800 or 1,600 — and not 300 with something else arriving alongside it (reference
 * section 9, `bmbr_boss_scode.b1` used as the floating score sprite). It rides the
 * doubled branch only: a captor shot **at home** is worth its plain 150, which is
 * the verified scoring table's other column.
 */
export function enemyScore(enemy: Enemy): number {
  return AT_HOME_VALUE.has(enemy.state)
    ? enemy.scoreBase
    : enemy.scoreBase * enemy.movingMultiplier + enemy.escortBonus;
}

/** The sprite an enemy shows, given the hits it has already survived. */
export function enemySprite(enemy: Enemy): string {
  const taken = enemy.hp - enemy.hitsRemaining;
  if (taken <= 0 || enemy.hitSprites.length === 0) return enemy.sprite;
  return enemy.hitSprites[Math.min(taken, enemy.hitSprites.length) - 1] ?? enemy.sprite;
}

/**
 * When each slot of a wave launches, as frames after the stage began.
 *
 * The arcade launches a wave in **pairs**, and the per-alien `trailing` flag says
 * whether the second of a pair is delayed into single file rather than launching
 * alongside the first. So: the second of a pair launches with its partner unless
 * it is `trailing`, and everything else launches one `spacing` after whatever
 * went before it. Four non-trailing pairs is four mirrored twos; eight trailing
 * slots is one long file; and `trailing` on the *first* of a pair says nothing,
 * exactly as the ROM's flag lives on the second bug's byte only.
 *
 * Exported because it is the part of wave choreography most worth asserting
 * directly rather than inferring from positions.
 */
export function waveLaunchFrames(wave: Wave): number[] {
  const frames: number[] = [];
  let at = wave.at;
  wave.slots.forEach((slot, index) => {
    const pairedWithPrevious = index % 2 === 1 && !slot.trailing;
    if (index > 0 && !pairedWithPrevious) at += wave.spacing;
    frames.push(at);
  });
  return frames;
}

/** Thrown when a stage names content that is not in the bundle handed over. */
export class StageContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageContentError';
  }
}

/** What one enemy needs beyond its alien to exist: its identity in the stage. */
interface EnemySeed {
  readonly id: number;
  readonly home: number;
  readonly homes: boolean;
  readonly inCaptiveSlot?: boolean;
  readonly launchFrame: number;
  readonly path: string;
  readonly mirror: boolean;
  readonly trailing: boolean;
  readonly wave: number;
}

/**
 * One enemy, from an alien and its place in the stage.
 *
 * Everything the simulation needs is copied off the alien here rather than looked
 * up per frame, which is what lets `stepFleet` and the attack director work on
 * plain values — and what keeps an `Enemy` serialisable for a fingerprint.
 */
function createEnemy(alien: Alien, seed: EnemySeed, rules: Rules): Enemy {
  const fire = alien.fire;
  return {
    id: seed.id,
    alienId: alien.id,
    role: alien.role,
    sprite: alien.sprite,
    hitSprites: alien.hitSprites,
    home: seed.home,
    homes: seed.homes,
    inCaptiveSlot: seed.inCaptiveSlot ?? false,
    phase: seed.id % rules.enemies.updatePhases,
    launchFrame: seed.launchFrame,
    path: seed.path,
    mirror: seed.mirror,
    trailing: seed.trailing,
    wave: seed.wave,
    hp: alien.hp,
    scoreBase: alien.score.base,
    movingMultiplier: alien.score.movingMultiplier ?? rules.scoring.movingMultiplier,
    // Zero escorts: the value every stage start installs, and the only one the
    // launcher can produce. See {@link Enemy.escortBonus}.
    escortBonus: resolveEscortBonus(rules, alien.role, 0),
    hitPadding: alien.hitPadding,
    divePaths: alien.dive?.paths ?? [],
    diveWeight: alien.dive?.weight ?? 0,
    returnsFromDive: alien.dive?.returns ?? true,
    fire:
      fire === undefined
        ? undefined
        : {
            pattern: fire.pattern,
            shotsPerDive: fire.shotsPerDive,
            cooldownFrames: fire.cooldownFrames ?? 0,
            spreadOffsets: fire.spreadOffsets,
          },
    abilities: alien.abilities,
    state: 'standby',
    x: 0,
    y: 0,
    heading: 0,
    hitsRemaining: alien.hp,
    pathFrame: -1,
    // The stage-start bomb timer is per *role* and loaded unconditionally, which
    // is the arcade's own `16 02 02` init (reference section 6). An alien whose
    // role the rules say nothing about starts ready to fire.
    bombTimer: rules.enemies.bomberReadyTimers[alien.role] ?? 0,
    bombsLeft: 0,
  };
}

/**
 * Build every enemy a stage will put on the field, all in `standby`.
 *
 * Nothing flies yet and nothing is positioned: an enemy gets a position when it
 * launches, which is what keeps a `standby` enemy out of collision tests and off
 * the screen without a second "visible" flag.
 */
export function createFleet(content: StageContent, rules: Rules): Fleet {
  const { stage, formation, aliens } = content;
  const enemies: Enemy[] = [];

  /** Per-role cursor for a slot that does not name its own home. */
  const nextFree = new Map<string, number>();
  const taken = new Set<number>();
  for (const slot of stage.waves.flatMap((wave) => wave.slots)) {
    if (slot.home !== undefined) taken.add(slot.home);
  }

  const claimSlot = (role: string): number => {
    for (let index = nextFree.get(role) ?? 0; index < formation.slots.length; index += 1) {
      if (formation.slots[index]?.role !== role || taken.has(index)) continue;
      nextFree.set(role, index + 1);
      taken.add(index);
      return index;
    }
    throw new StageContentError(
      `stage "${stage.id}": formation "${stage.formation}" has no free slot left for role "${role}"`,
    );
  };

  stage.waves.forEach((wave, waveIndex) => {
    const launchFrames = waveLaunchFrames(wave);
    wave.slots.forEach((slot, slotIndex) => {
      const alien = aliens.get(slot.alien);
      if (alien === undefined) {
        throw new StageContentError(
          `stage "${stage.id}" wave ${String(waveIndex)} slot ${String(slotIndex)}: no alien "${slot.alien}"`,
        );
      }
      const path = slot.path ?? wave.entryPath;
      if (path === undefined) {
        throw new StageContentError(
          `stage "${stage.id}" wave ${String(waveIndex)} slot ${String(slotIndex)}: no entry path`,
        );
      }
      // A script that never addresses a slot claims none either: the forty
      // flyers of a challenge stage would otherwise have to reserve forty slots
      // they never reach.
      const homes = pathAddressesSlot(content, path);
      enemies.push(
        createEnemy(
          alien,
          {
            id: enemies.length,
            home: homes ? (slot.home ?? claimSlot(alien.role)) : NO_SLOT,
            homes,
            launchFrame: launchFrames[slotIndex] ?? wave.at,
            path,
            mirror: slot.mirror,
            trailing: slot.trailing,
            wave: waveIndex,
          },
          rules,
        ),
      );
    });
  });

  return { enemies, flights: new Map(), frame: 0, entryComplete: enemies.length === 0 };
}

/**
 * Where this enemy's slot will be when it gets there.
 *
 * `toSlot` resolves its target once, when the path compiles — which is right, and
 * is why homing costs nothing per frame — so the target it is given has to be the
 * slot's position at *arrival*, not at launch. The formation is swaying by up to
 * 64 px peak to peak while the enemy flies, so handing over today's position
 * leaves it parked beside its slot.
 *
 * Both motions are deterministic, so this is exact rather than approximate: solve
 * the fixed point (target ⇄ flight time) by refining a few times. The breathe
 * never runs while anything is still homing — the arcade only starts it once the
 * whole formation has settled — so the sway is the only motion in play.
 */
function slotResolver(
  formation: FormationState,
  rules: Rules,
  enemy: Enemy,
  fallbackSpeed: number,
): TargetResolver {
  const { home, inCaptiveSlot } = enemy;
  return (frame: number, at: PathPose): Vec2 => {
    const speed = at.speed > 0 ? at.speed : fallbackSpeed;
    let target = homePositionAhead(formation, rules, home, frame, inCaptiveSlot);
    for (let pass = 0; pass < SLOT_PREDICTION_PASSES; pass += 1) {
      const dx = target.x - at.x;
      const dy = target.y - at.y;
      const travel = speed > 0 ? Math.sqrt(dx * dx + dy * dy) / speed : 0;
      target = homePositionAhead(formation, rules, home, frame + travel, inCaptiveSlot);
    }
    return [target.x, target.y];
  };
}

/**
 * Compile and begin one enemy's entry flight.
 *
 * Exported so the slot-homing behaviour can be tested from an arbitrary starting
 * position — hand it a `from` and it flies its path from there instead of from
 * the path's own `start`.
 */
export function launchEnemy(
  fleet: Fleet,
  enemy: Enemy,
  content: StageContent,
  formation: FormationState,
  rules: Rules,
  from?: Vec2,
): void {
  const path = content.paths.get(enemy.path);
  if (path === undefined) {
    throw new StageContentError(`enemy ${String(enemy.id)}: no path "${enemy.path}"`);
  }

  const compiled = compilePath(path, {
    playfield: rules.playfield,
    mirror: enemy.mirror,
    slot: slotResolver(formation, rules, enemy, 1),
    ...(from !== undefined && { start: from }),
  });

  beginFlight(fleet, enemy, compiled, 'entering');
}

/** Put a compiled flight on an enemy and start it flying, in `state`. */
function beginFlight(fleet: Fleet, enemy: Enemy, compiled: CompiledPath, state: EnemyState): void {
  fleet.flights.set(enemy.id, compiled);
  enemy.state = state;
  enemy.pathFrame = 0;
  enemy.x = compiled.start.x;
  enemy.y = compiled.start.y;
  enemy.heading = compiled.start.heading;
  // A fresh flight is a fresh attack run: the arcade reloads the bomb allowance
  // when an object starts moving, not when the stage starts.
  enemy.bombsLeft = enemy.fire?.shotsPerDive ?? 0;
}

/**
 * Compile and begin one enemy's dive.
 *
 * The attack path is flown **from wherever the enemy is**, which is why a dive
 * path states no `start` and is built out of the segment types that are relative
 * to the flyer's pose — `arc`, `loop`, `sine`, `aimAtPlayer`, `exitBottom`. A
 * dive authored with absolute `line` or `bezier` targets would drag all forty
 * enemies through the same piece of screen whatever slot they left.
 *
 * `mirror` reflects the evaluation rather than naming a second path, so one
 * authored dive serves both halves of the formation: the enemies on the right
 * sweep right and the ones on the left sweep left
 * (`docs/reference/arcade-reference.md` section 5, and `paths.ts`).
 */
export function beginDive(
  fleet: Fleet,
  enemy: Enemy,
  content: StageContent,
  formation: FormationState,
  rules: Rules,
  pathId: string,
  mirror: boolean,
  playerAt?: Vec2,
): void {
  const path = content.paths.get(pathId);
  if (path === undefined) {
    throw new StageContentError(`enemy ${String(enemy.id)}: no dive path "${pathId}"`);
  }
  const compiled = compilePath(path, {
    playfield: rules.playfield,
    mirror,
    slot: slotResolver(formation, rules, enemy, 1),
    player: playerTarget(rules, playerAt),
    start: [enemy.x, enemy.y],
    heading: enemy.heading,
  });
  beginFlight(fleet, enemy, compiled, 'diving');
}

/**
 * Send a diver that has left the bottom back into its slot from the top.
 *
 * The return leg is a path the pack names (`enemies.dive.returnPath`) and it
 * homes with `toSlot` and nothing else — the same segment the entry uses, so
 * there is exactly one homing implementation in the simulation. Returns `false`
 * when the pack has no return path, which means the diver is gone for good.
 */
export function beginReturn(
  fleet: Fleet,
  enemy: Enemy,
  content: StageContent,
  formation: FormationState,
  rules: Rules,
  playerAt?: Vec2,
  options: { readonly fromHere?: boolean } = {},
): boolean {
  const { returnPath, reentryY } = rules.enemies.dive;
  if (returnPath === undefined) return false;
  const path = content.paths.get(returnPath);
  if (path === undefined) {
    throw new StageContentError(`no return path "${returnPath}"`);
  }
  const compiled = compilePath(path, {
    playfield: rules.playfield,
    slot: slotResolver(formation, rules, enemy, 1),
    player: playerTarget(rules, playerAt),
    // Re-entry is at the x it left by and a row above the top of the screen: the
    // arcade's divers reappear at the top rather than flying back up the field.
    // `fromHere` starts the same path where the enemy already is instead, which is
    // what a rescue does to the divers it recalls — they turn round mid-dive
    // rather than leaving and coming back.
    start: options.fromHere === true ? [enemy.x, enemy.y] : [enemy.x, reentryY],
    heading: options.fromHere === true ? enemy.heading : 0,
  });
  beginFlight(fleet, enemy, compiled, 'returning');
  return true;
}

/** Where and how a mid-stage arrival starts flying. */
export interface SpawnOptions {
  /** Its anchor on the frame it appears. */
  readonly at: Vec2;
  /** Degrees, clockwise positive, 0 down the screen. Defaults to straight down. */
  readonly heading?: number;
  /** The formation slot it owns. A spawn that never returns never uses it. */
  readonly home: number;
  /** The wave it is reported as belonging to. Defaults to 0. */
  readonly wave?: number;
  readonly pathId: string;
  readonly mirror?: boolean;
  readonly playerAt?: Vec2 | undefined;
  /**
   * Whether it comes back to `home` once its dive ends. Defaults to what its alien
   * says. An ability's fragment or minion borrows its parent's slot only so that a
   * `toSlot` in its dive has somewhere to aim, and says `false` here: it owns no
   * slot to rejoin.
   */
  readonly returns?: boolean;
}

/** Where and how an enemy joins a fleet that is already running. */
export interface AddOptions {
  /** The slot it owns, in whichever of the two slot tables `inCaptiveSlot` names. */
  readonly home: number;
  readonly inCaptiveSlot?: boolean;
  /**
   * Whether it takes that slot at the end of its flight, or simply leaves.
   *
   * Everything added this way so far does home — a transform group returns to the
   * slot it inherited, a captured fighter to its captive slot — but it is stated
   * rather than assumed, because {@link NO_SLOT} exists for flyers that never
   * address one and a caller that forgets would strand one at slot 0.
   */
  readonly homes?: boolean;
  /** Its anchor on the frame it appears. Omitted leaves it at the origin. */
  readonly at?: Vec2;
  /** Degrees, clockwise positive, 0 down the screen. */
  readonly heading?: number;
  /** The path it will fly. An enemy placed straight into its slot needs none. */
  readonly pathId?: string;
  readonly mirror?: boolean;
  /** The frame it is due to launch on, for one that arrives in `standby`. */
  readonly launchFrame?: number;
  /** The wave it is reported as belonging to. Defaults to 0. */
  readonly wave?: number;
  /** Where it starts: waiting to launch, or already sitting in its slot. */
  readonly state?: Extract<EnemyState, 'standby' | 'home'>;
}

/**
 * Add one enemy to a fleet mid-stage, without a wave to have come from.
 *
 * The one creation path for anything that is not in a stage's entry waves — a
 * transform group, and the captured fighter the capture channel puts in the
 * formation. It only *places* the enemy; starting it flying is the caller's next
 * call, because a transform group is already diving while a captured fighter is
 * standing still in its slot.
 */
export function addEnemy(fleet: Fleet, alien: Alien, rules: Rules, options: AddOptions): Enemy {
  const enemy = createEnemy(
    alien,
    {
      id: nextEnemyId(fleet),
      home: options.home,
      homes: options.homes ?? true,
      ...(options.inCaptiveSlot !== undefined && { inCaptiveSlot: options.inCaptiveSlot }),
      launchFrame: options.launchFrame ?? fleet.frame,
      path: options.pathId ?? '',
      mirror: options.mirror ?? false,
      trailing: false,
      wave: options.wave ?? 0,
    },
    rules,
  );
  enemy.x = options.at?.[0] ?? 0;
  enemy.y = options.at?.[1] ?? 0;
  enemy.heading = options.heading ?? 0;
  enemy.state = options.state ?? 'standby';
  fleet.enemies.push(enemy);
  // A fleet that had finished arriving has not, if this one is still to launch.
  if (enemy.state === 'standby') fleet.entryComplete = false;
  return enemy;
}

/**
 * Add an enemy to a fleet mid-stage, already flying an attack path.
 *
 * This is what a transform produces: the group is in no entry wave, so it has no
 * launch frame and no slot of its own — it borrows `home` from the enemy it
 * replaced and, being an alien that does not return, never uses it.
 */
export function spawnDiver(
  fleet: Fleet,
  alien: Alien,
  content: StageContent,
  formation: FormationState,
  rules: Rules,
  options: SpawnOptions,
): Enemy {
  const enemy = addEnemy(fleet, alien, rules, {
    home: options.home,
    // A spawned diver owns a slot and returns to it, so it homes like any
    // other enemy; the transform group is the only caller and its members do.
    homes: true,
    at: options.at,
    ...(options.heading !== undefined && { heading: options.heading }),
    pathId: options.pathId,
    mirror: options.mirror ?? false,
    ...(options.wave !== undefined && { wave: options.wave }),
    state: 'home',
  });
  if (options.returns !== undefined) enemy.returnsFromDive = options.returns;
  beginDive(
    fleet,
    enemy,
    content,
    formation,
    rules,
    options.pathId,
    options.mirror ?? false,
    options.playerAt,
  );
  return enemy;
}

/**
 * Put `count` of one alien on the field abreast of `parent`, each diving along
 * one of its own dive paths, and none of them ever returning.
 *
 * What an ability leaves behind — a split's fragments, a spawner's minions. They
 * appear where the parent is, `spacing` pixels apart and centred on it, and fan
 * the way a dive from the parent's side of the formation does. Which path each
 * flies is a draw from the world's seeded generator. They borrow the parent's
 * slot so that a `toSlot` inside their dive has somewhere to aim, and own no slot
 * to come back to: a fragment or a minion leaves at the end of its dive.
 */
export function spawnAbreast(
  fleet: Fleet,
  alien: Alien,
  content: StageContent,
  formation: FormationState,
  rules: Rules,
  rng: Rng,
  parent: Enemy,
  count: number,
  spacing: number,
  playerAt: Vec2 | undefined,
): Enemy[] {
  const paths = alien.dive?.paths ?? [];
  if (paths.length === 0) return [];
  // A parent with no slot of its own cannot ask the formation which side it is
  // on, so it asks the playfield instead.
  const mirror =
    parent.home === NO_SLOT
      ? parent.x * 2 >= rules.playfield.width
      : isRightOfCentre(formation, parent.home);
  const middle = (count - 1) / 2;
  const spawned: Enemy[] = [];
  for (let index = 0; index < count; index += 1) {
    spawned.push(
      spawnDiver(fleet, alien, content, formation, rules, {
        at: [parent.x + (index - middle) * spacing, parent.y],
        heading: parent.heading,
        home: parent.home,
        wave: parent.wave,
        pathId: rng.pick(paths),
        mirror,
        playerAt,
        returns: false,
      }),
    );
  }
  return spawned;
}

/**
 * The next free enemy id.
 *
 * Ids are dense and never reused while the stage runs, because they are what
 * events and the compiled-flight map address an enemy by; a recycled id would
 * hand a new enemy an old one's flight.
 */
function nextEnemyId(fleet: Fleet): number {
  let next = 0;
  for (const enemy of fleet.enemies) {
    if (enemy.id >= next) next = enemy.id + 1;
  }
  return next;
}

/**
 * Where `aimAtPlayer` aims: the fighter, or the bottom centre of the playfield.
 *
 * The fallback is what lets a test — or `/lab` — compile a dive with no world
 * around it and still get a path that points down the screen rather than a
 * compile error. It is a *position*, passed in per call rather than held
 * anywhere, because two worlds stepped in one process must not be able to aim
 * each other's dives.
 */
function playerTarget(rules: Rules, playerAt: Vec2 | undefined): TargetResolver {
  return playerAt ?? [rules.playfield.width / 2, rules.playfield.height];
}

/** One scripted `fire` reached on the timeline, for the world to turn into bullets. */
export interface ScriptedFire {
  readonly enemy: Enemy;
  readonly count: number;
}

/**
 * One scripted `trigger` reached on the timeline: a path asking for an engine
 * ability at a point in the flight.
 *
 * Surfaced rather than acted on here, because an ability is not the fleet's
 * business. It is how a pack says *where* in a dive something happens — the
 * tractor beam comes out at the `captureBeam` trigger in the captor's own path
 * (`src/sim/abilities/capture-beam.ts`), so the descent depth is authored content rather than a
 * threshold in the engine.
 */
export interface ScriptedTrigger {
  readonly enemy: Enemy;
  readonly ability: string;
  readonly params: Readonly<Record<string, unknown>> | undefined;
}

/** What one step of the fleet did, for the world to turn into events. */
export interface FleetStep {
  /** Enemies that began their entry flight on this frame. */
  readonly launched: readonly Enemy[];
  /** Enemies that reached their slot on this frame, entering or returning. */
  readonly homed: readonly Enemy[];
  /**
   * Enemies that left the field alive on this frame: a dive that did not return,
   * or an entry script that never addressed a slot. Not a kill, and not a hit.
   */
  readonly departed: readonly Enemy[];
  /** `fire` segments a flight passed through on this frame. */
  readonly fired: readonly ScriptedFire[];
  /** `trigger` segments a flight passed through on this frame. */
  readonly triggered: readonly ScriptedTrigger[];
  /** True on the frame the last of the entry waves arrived. */
  readonly entryFinished: boolean;
}

/**
 * Advance every enemy by one frame.
 *
 * Positions move every frame; **state advances only on the enemy's own phase of
 * the round robin**, which is the arcade's cadence and the reason a launch — or
 * the end of a dive — lands within `updatePhases` frames of when it was due
 * rather than exactly on it.
 *
 * `playerAt` is where a dive that ends in `aimAtPlayer` aims when it compiles a
 * return leg; the world passes the fighter's anchor.
 */
export function stepFleet(
  fleet: Fleet,
  content: StageContent,
  formation: FormationState,
  rules: Rules,
  playerAt?: Vec2,
): FleetStep {
  fleet.frame += 1;
  const phase = fleet.frame % rules.enemies.updatePhases;

  const launched: Enemy[] = [];
  const homed: Enemy[] = [];
  const departed: Enemy[] = [];
  const fired: ScriptedFire[] = [];
  const triggered: ScriptedTrigger[] = [];

  /** Fly one frame of the enemy's current path, collecting what it passed through. */
  const advanceFlight = (enemy: Enemy): PathSample | undefined => {
    const flight = fleet.flights.get(enemy.id);
    if (flight === undefined) return undefined;
    enemy.pathFrame += 1;
    const sample = samplePath(flight, enemy.pathFrame);
    enemy.x = sample.x;
    enemy.y = sample.y;
    enemy.heading = sample.heading;
    // Half-open at the start, so a `fire` segment on the timeline is drained
    // exactly once however many frames a caller steps.
    for (const event of pathEventsBetween(flight, enemy.pathFrame - 1, enemy.pathFrame)) {
      if (event.kind === 'fire') fired.push({ enemy, count: event.count });
      else triggered.push({ enemy, ability: event.ability, params: event.params });
    }
    return sample;
  };

  for (const enemy of fleet.enemies) {
    const onPhase = enemy.phase === phase;
    // The bomb delay is frames, so it counts down every frame; whether the enemy
    // may *act* on it is the attack director's decision, on this enemy's phase.
    if (enemy.bombTimer > 0) enemy.bombTimer -= 1;

    switch (enemy.state) {
      case 'standby': {
        if (onPhase && fleet.frame >= enemy.launchFrame) {
          launchEnemy(fleet, enemy, content, formation, rules);
          launched.push(enemy);
        }
        break;
      }

      case 'entering':
      case 'returning': {
        const sample = advanceFlight(enemy);
        if (sample === undefined) break;
        if (onPhase && sample.done) {
          fleet.flights.delete(enemy.id);
          if (enemy.homes) {
            enemy.state = 'home';
            homed.push(enemy);
          } else {
            // Its script is over and it never addressed a slot, so it is gone —
            // the same ending a diver that does not return reaches below, and
            // reported the same way: a departure, not a kill.
            enemy.state = 'dead';
            departed.push(enemy);
          }
        }
        break;
      }

      case 'diving': {
        const sample = advanceFlight(enemy);
        if (sample === undefined) break;
        if (!onPhase || !sample.done) break;
        fleet.flights.delete(enemy.id);
        // The dive is over. An alien that returns re-enters from the top and
        // homes; one that does not is simply gone, with no score and no kill —
        // leaving the screen is not the same event as being destroyed.
        if (enemy.returnsFromDive && beginReturn(fleet, enemy, content, formation, rules, playerAt))
          break;
        enemy.state = 'dead';
        departed.push(enemy);
        break;
      }

      case 'home': {
        // An enemy at home *is* its slot: the formation moves, it follows, and it
        // holds no offset of its own. That is the whole trick of section 5.
        const position = homePosition(formation, rules, enemy.home, enemy.inCaptiveSlot);
        enemy.x = position.x;
        enemy.y = position.y;
        enemy.heading = 0;
        break;
      }

      default:
        break;
    }
  }

  let entryFinished = false;
  if (!fleet.entryComplete && !fleet.enemies.some(isStillArriving)) {
    fleet.entryComplete = true;
    entryFinished = true;
    // The formation keeps swaying from here until it passes back through centre.
    completeEntry(formation);
  }

  return { launched, homed, departed, fired, triggered, entryFinished };
}

function isStillArriving(enemy: Enemy): boolean {
  return enemy.state === 'standby' || enemy.state === 'entering';
}
