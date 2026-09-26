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

import type { Alien, Rules, Wave } from '../content/schema.js';
import type { StageContent } from '../content/stages.js';
import type { HitPadding } from './collision.js';
import type { FormationState } from './formation.js';
import { completeEntry, slotPosition, slotPositionAhead } from './formation.js';
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
 * So the five live states are: waiting to launch, flying in, sitting in the
 * formation, attacking, and rotating back into the slot afterwards. Only the last
 * two of those are new to the dive task, and only the *last* of them scores the
 * formation value while visibly moving.
 */
export type EnemyState = 'standby' | 'entering' | 'home' | 'diving' | 'returning' | 'dead';

/** States that score the formation value rather than the doubled one. */
const AT_HOME_VALUE: ReadonlySet<EnemyState> = new Set<EnemyState>(['home', 'returning']);

export interface Enemy {
  readonly id: number;
  readonly alienId: string;
  readonly role: string;
  /** Sprite id, and what it becomes after each hit it survives. */
  readonly sprite: string;
  readonly hitSprites: readonly string[];
  /** Index into the formation's `slots`: this enemy's own home, for the stage. */
  readonly home: number;
  /** Which frame of the update round robin advances this enemy's state. */
  readonly phase: number;
  /** Frames after the stage began at which it is due to launch. */
  readonly launchFrame: number;
  /** The entry path it flies, and whether it flies the mirrored variant. */
  readonly path: string;
  readonly mirror: boolean;
  /** Launched behind its pair partner rather than alongside it. */
  readonly trailing: boolean;
  /** The wave it belongs to, zero-based. Reported in events. */
  readonly wave: number;

  readonly hp: number;
  /** Points before the moving multiplier; the alien's `score.base`. */
  readonly scoreBase: number;
  /** What a moving target's base value is multiplied by, for this alien. */
  readonly movingMultiplier: number;
  readonly hitPadding: HitPadding;

  /** The attack paths this alien may dive along; empty for one that never dives. */
  readonly divePaths: readonly string[];
  /** This alien's share of the dive lottery within its role. */
  readonly diveWeight: number;
  /** False for an alien that leaves for good after a dive instead of returning. */
  readonly returnsFromDive: boolean;
  /** How this alien bombs, or `undefined` for one that never does. */
  readonly fire: EnemyFire | undefined;

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
  'returning',
]);

/** Everything on the field that a shot can be tested against. */
export function isTargetable(enemy: Enemy): boolean {
  return TARGETABLE.has(enemy.state);
}

export function aliveEnemies(enemies: readonly Enemy[]): Enemy[] {
  return enemies.filter((enemy) => enemy.state !== 'dead');
}

/**
 * What destroying this enemy is worth, right now.
 *
 * The base value comes from the alien, the multiplier from the alien or the rules
 * layer, and which of the two applies from the enemy's *state* — see
 * {@link EnemyState}. Bonuses (a captor's escorts, a challenge group) are a
 * separate channel and are not this function's business.
 */
export function enemyScore(enemy: Enemy): number {
  return AT_HOME_VALUE.has(enemy.state)
    ? enemy.scoreBase
    : enemy.scoreBase * enemy.movingMultiplier;
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
    phase: seed.id % rules.enemies.updatePhases,
    launchFrame: seed.launchFrame,
    path: seed.path,
    mirror: seed.mirror,
    trailing: seed.trailing,
    wave: seed.wave,
    hp: alien.hp,
    scoreBase: alien.score.base,
    movingMultiplier: alien.score.movingMultiplier ?? rules.scoring.movingMultiplier,
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
      enemies.push(
        createEnemy(
          alien,
          {
            id: enemies.length,
            home: slot.home ?? claimSlot(alien.role),
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
  home: number,
  fallbackSpeed: number,
): TargetResolver {
  return (frame: number, at: PathPose): Vec2 => {
    const speed = at.speed > 0 ? at.speed : fallbackSpeed;
    let target = slotPositionAhead(formation, rules, home, frame);
    for (let pass = 0; pass < SLOT_PREDICTION_PASSES; pass += 1) {
      const dx = target.x - at.x;
      const dy = target.y - at.y;
      const travel = speed > 0 ? Math.sqrt(dx * dx + dy * dy) / speed : 0;
      target = slotPositionAhead(formation, rules, home, frame + travel);
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
    slot: slotResolver(formation, rules, enemy.home, 1),
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
    slot: slotResolver(formation, rules, enemy.home, 1),
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
): boolean {
  const { returnPath, reentryY } = rules.enemies.dive;
  if (returnPath === undefined) return false;
  const path = content.paths.get(returnPath);
  if (path === undefined) {
    throw new StageContentError(`no return path "${returnPath}"`);
  }
  const compiled = compilePath(path, {
    playfield: rules.playfield,
    slot: slotResolver(formation, rules, enemy.home, 1),
    player: playerTarget(rules, playerAt),
    // Re-entry is at the x it left by and a row above the top of the screen: the
    // arcade's divers reappear at the top rather than flying back up the field.
    start: [enemy.x, reentryY],
    heading: 0,
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
  const enemy = createEnemy(
    alien,
    {
      id: nextEnemyId(fleet),
      home: options.home,
      launchFrame: fleet.frame,
      path: options.pathId,
      mirror: options.mirror ?? false,
      trailing: false,
      wave: options.wave ?? 0,
    },
    rules,
  );
  enemy.x = options.at[0];
  enemy.y = options.at[1];
  enemy.heading = options.heading ?? 0;
  fleet.enemies.push(enemy);
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

/** What one step of the fleet did, for the world to turn into events. */
export interface FleetStep {
  /** Enemies that began their entry flight on this frame. */
  readonly launched: readonly Enemy[];
  /** Enemies that reached their slot on this frame, entering or returning. */
  readonly homed: readonly Enemy[];
  /** Enemies that finished a dive and left the field for good on this frame. */
  readonly departed: readonly Enemy[];
  /** `fire` segments a flight passed through on this frame. */
  readonly fired: readonly ScriptedFire[];
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

  /** Fly one frame of the enemy's current path, collecting any scripted fire. */
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
          enemy.state = 'home';
          fleet.flights.delete(enemy.id);
          homed.push(enemy);
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
        const position = slotPosition(formation, rules, enemy.home);
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

  return { launched, homed, departed, fired, entryFinished };
}

function isStillArriving(enemy: Enemy): boolean {
  return enemy.state === 'standby' || enemy.state === 'entering';
}
