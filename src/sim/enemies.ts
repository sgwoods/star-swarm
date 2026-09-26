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

import type { Rules, Wave } from '../content/schema.js';
import type { StageContent } from '../content/stages.js';
import type { HitPadding } from './collision.js';
import type { FormationState } from './formation.js';
import { completeEntry, slotPosition, slotPositionAhead } from './formation.js';
import type { CompiledPath, PathPose, TargetResolver, Vec2 } from './paths.js';
import { compilePath, samplePath } from './paths.js';

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
 * `returning` is unreachable until the dive task lands; it is named here because
 * the scoring rule is meaningless without it.
 */
export type EnemyState = 'standby' | 'entering' | 'home' | 'returning' | 'dead';

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

  state: EnemyState;
  /** Sprite anchor, matching every other anchor in the simulation. */
  x: number;
  y: number;
  /** Degrees, clockwise positive, 0 pointing down the screen. */
  heading: number;
  hitsRemaining: number;
  /** Frames into its current flight path; `-1` before it has launched. */
  pathFrame: number;
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

/** Everything on the field that a shot can be tested against. */
export function isTargetable(enemy: Enemy): boolean {
  return enemy.state === 'entering' || enemy.state === 'home' || enemy.state === 'returning';
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

/**
 * Build every enemy a stage will put on the field, all in `standby`.
 *
 * Nothing flies yet and nothing is positioned: an enemy gets a position when it
 * launches, which is what keeps a `standby` enemy out of collision tests and off
 * the screen without a second "visible" flag.
 */
export function createFleet(content: StageContent, rules: Rules): Fleet {
  const { stage, formation, aliens } = content;
  const phases = rules.enemies.updatePhases;
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
      const id = enemies.length;
      enemies.push({
        id,
        alienId: alien.id,
        role: alien.role,
        sprite: alien.sprite,
        hitSprites: alien.hitSprites,
        home: slot.home ?? claimSlot(alien.role),
        phase: id % phases,
        launchFrame: launchFrames[slotIndex] ?? wave.at,
        path,
        mirror: slot.mirror,
        trailing: slot.trailing,
        wave: waveIndex,
        hp: alien.hp,
        scoreBase: alien.score.base,
        movingMultiplier: alien.score.movingMultiplier ?? rules.scoring.movingMultiplier,
        hitPadding: alien.hitPadding,
        state: 'standby',
        x: 0,
        y: 0,
        heading: 0,
        hitsRemaining: alien.hp,
        pathFrame: -1,
      });
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

  fleet.flights.set(enemy.id, compiled);
  enemy.state = 'entering';
  enemy.pathFrame = 0;
  enemy.x = compiled.start.x;
  enemy.y = compiled.start.y;
  enemy.heading = compiled.start.heading;
}

/** What one step of the fleet did, for the world to turn into events. */
export interface FleetStep {
  /** Enemies that began their entry flight on this frame. */
  readonly launched: readonly Enemy[];
  /** Enemies that reached their slot on this frame. */
  readonly homed: readonly Enemy[];
  /** True on the frame the last of them arrived. */
  readonly entryFinished: boolean;
}

/**
 * Advance every enemy by one frame.
 *
 * Positions move every frame; **state advances only on the enemy's own phase of
 * the round robin**, which is the arcade's cadence and the reason a launch lands
 * within `updatePhases` frames of when it was due rather than exactly on it.
 */
export function stepFleet(
  fleet: Fleet,
  content: StageContent,
  formation: FormationState,
  rules: Rules,
): FleetStep {
  fleet.frame += 1;
  const phase = fleet.frame % rules.enemies.updatePhases;

  const launched: Enemy[] = [];
  const homed: Enemy[] = [];

  for (const enemy of fleet.enemies) {
    const onPhase = enemy.phase === phase;

    switch (enemy.state) {
      case 'standby': {
        if (onPhase && fleet.frame >= enemy.launchFrame) {
          launchEnemy(fleet, enemy, content, formation, rules);
          launched.push(enemy);
        }
        break;
      }

      case 'entering': {
        const flight = fleet.flights.get(enemy.id);
        if (flight === undefined) break;
        enemy.pathFrame += 1;
        const sample = samplePath(flight, enemy.pathFrame);
        enemy.x = sample.x;
        enemy.y = sample.y;
        enemy.heading = sample.heading;
        if (onPhase && sample.done) {
          enemy.state = 'home';
          fleet.flights.delete(enemy.id);
          homed.push(enemy);
        }
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

  return { launched, homed, entryFinished };
}

function isStillArriving(enemy: Enemy): boolean {
  return enemy.state === 'standby' || enemy.state === 'entering';
}
