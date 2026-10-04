/**
 * The world: one simulation step, start to finish (docs/DESIGN.md sections 4, 9).
 *
 * Everything the game does happens here, in a fixed order, driven by exactly one
 * {@link InputFrame} per step and one seeded generator. No wall clock, no DOM, no
 * canvas, no audio — what happened comes out as a list of {@link SimEvent}s that
 * `src/render/`, `src/ui/` and `src/audio/` read. That is what makes `tests/sim/`
 * able to prove behaviour without a browser, and what makes a recorded run replay
 * to the same state every time.
 *
 * The world is handed two resolved values and loads nothing itself: a `Rules`, and
 * a {@link StageSource} that answers "what plays as stage *n*". Both come from
 * `src/content/`; neither is a pack, a registry or a file, which is what keeps the
 * simulation free of the content layer's plumbing.
 *
 * In scope: entry waves, formation sway and breathe, slot homing, dive attacks,
 * enemy fire and the difficulty ramp that drives both (`src/sim/dive.ts`), the
 * capture channel — beam, captured fighter, rogue, rescue and dual fighter
 * (`src/sim/abilities/capture-beam.ts`) — challenge stages and their three
 * awards (`src/sim/challenge.ts`), extra lives, and the per-enemy abilities a
 * pack switches on (`src/sim/abilities/registry.ts`). A captor's dive is an
 * ordinary dive with a beam on it, so it launches through the same director and
 * the same `beginDive`.
 *
 * **Three ways to lose a fighter, two events.** Being shot and being *flown into*
 * are the same loss — the arcade has one routine for every hit on the fighter — so
 * both raise `player-hit` ({@link resolveEnemyBullets},
 * {@link resolveBodyCollisions}). Being **captured** is not: it raises
 * `player-captured`, and on the last fighter it ends the game — a distinct loss
 * condition the design plan originally missed and the original's manual is
 * explicit about (`docs/reference/arcade-reference.md` section 7).
 */

import { allowsAttacks, extraLivesEarned, maxXFor, starfieldSpeedByte } from '../content/rules.js';
import type { Rules } from '../content/schema.js';
import type { StageContent, StageSource } from '../content/stages.js';
import { EMPTY_STAGE_SOURCE } from '../content/stages.js';
import { isDown, type InputFrame } from '../engine/input.js';
import { createRng, type Rng, type RngState } from '../engine/rng.js';
import type { AbilityContext, AbilityState } from './abilities/registry.js';
import {
  abilitiesAbsorbShot,
  abilitiesNoteDestroyed,
  abilityFingerprint,
  createAbilityState,
  shieldRemaining,
  stepAbilities,
} from './abilities/registry.js';
import type { CaptureState } from './abilities/capture-beam.js';
import {
  beamHasFighter,
  beamIsOut,
  captureAllowsFire,
  captureFingerprint,
  captureNoteDestroyed,
  captureNoteHalfLost,
  createCaptureState,
  enterStageCapture,
  stepCapture,
} from './abilities/capture-beam.js';
import type { ChallengeStage } from './challenge.js';
import { createChallengeStage, endChallengeStage, recordChallengeHit } from './challenge.js';
import { hitWindowIndex } from './collision.js';
import type { DiveState } from './dive.js';
import {
  armDives,
  createDiveState,
  diveFingerprint,
  noteDeparted,
  noteDestroyed,
  stepAttacks,
} from './dive.js';
import type { Enemy, Fleet } from './enemies.js';
import type { EnemyState, ScriptedTrigger } from './enemies.js';
import {
  aliveEnemies,
  createFleet,
  enemyScore,
  fleetEnemies,
  isTargetable,
  stepFleet,
} from './enemies.js';
import type { SimEvent } from './events.js';
import type { FormationState } from './formation.js';
import { createFormation, stepFormation } from './formation.js';
import { createLives, type LivesState } from './lives.js';
import type { Vec2 } from './paths.js';
import { createPlayer, type PlayerState, shipAnchors, startX, stepPlayer } from './player.js';
import {
  clearEnemyBullets,
  clearShots,
  createEnemyBullets,
  createShots,
  type EnemyBulletPool,
  fireShot,
  type ShotPool,
  stepEnemyBullets,
  stepShots,
} from './shots.js';

export type WorldStatus = 'playing' | 'game-over';

export interface World {
  /**
   * The rules this run obeys, as the content loader resolved them from a pack.
   * The simulation never loads one: it is handed a value, which is what lets a
   * test swap a single field and watch behaviour follow.
   */
  readonly rules: Rules;
  /** What plays as each stage. Also a value: see the file header. */
  readonly stages: StageSource;
  /**
   * The difficulty rank this run is played at — the cabinet's DIP setting.
   *
   * Rank selects whole data sets rather than scaling one (`docs/DESIGN.md`
   * section 6), so it is carried here and handed to the rules layer on every
   * lookup rather than folded into the rules when they load.
   */
  readonly rank: string | undefined;
  /** Simulation steps run. The only notion of time the sim has. */
  step: number;
  stage: number;
  score: number;
  status: WorldStatus;
  /**
   * Fighters the run began on, including the one on the field.
   *
   * Part of the world because the extra-life thresholds depend on it: the arcade
   * offers a *different* set to a five-fighter cabinet, so a run that forgot what
   * it started with would award the wrong bonuses for its whole length
   * (`resolveExtraLifeAward` in `src/content/rules.ts`).
   */
  readonly startingLives: number;
  player: PlayerState;
  lives: LivesState;
  shots: ShotPool;
  enemyBullets: EnemyBulletPool;
  /** The stage on the field, or `undefined` when the pack has none for it. */
  content: StageContent | undefined;
  /** The formation's coordinates and their motion. `undefined` with no stage. */
  formation: FormationState | undefined;
  /**
   * The challenge stage in progress, or `undefined` on an ordinary stage. The
   * cadence in the rules decides which, never a stage number (`./challenge.js`).
   */
  challenge: ChallengeStage | undefined;
  fleet: Fleet;
  /** Dives, enemy fire and the difficulty row in force. Replaced every stage. */
  dive: DiveState;
  /**
   * The capture channel — one, globally, for the whole run.
   *
   * Carried across stages rather than rebuilt with the stage, because a captured
   * fighter stays with its captor for the rest of the game
   * (`src/sim/abilities/capture-beam.ts`).
   */
  capture: CaptureState;
  /**
   * What the enemies' own abilities are doing — shields, timers, minions.
   * Replaced every stage, because it is keyed by enemy id and ids are per stage.
   */
  abilities: AbilityState;
  rng: Rng;
  /** Events raised by the step just run. Replaced every step, never appended to across steps. */
  events: SimEvent[];
}

export interface WorldOptions {
  /** A loaded pack's rules. Required: the simulation has no rules of its own. */
  readonly rules: Rules;
  /**
   * What plays as each stage, from `createStageSource` in `src/content/`.
   * Omitted means a world with no enemies at all, which is what a test of the
   * player half on its own wants.
   */
  readonly stages?: StageSource;
  readonly seed?: number | string | RngState;
  readonly stage?: number;
  /** The difficulty rank. Omitted means the rules' own `defaultRank`. */
  readonly rank?: string;
  /**
   * Fighters to start with, including the one on the field. Defaults to
   * `rules.lives.default`. It is an option rather than always the default
   * because it selects which extra-life threshold set is in force, so a cabinet
   * set to five fighters is a different run and not just a longer one.
   */
  readonly lives?: number;
}

/** An empty fleet, for a stage the pack has no content for. */
const NO_FLEET: () => Fleet = () => ({
  enemies: [],
  flights: new Map(),
  frame: 0,
  entryComplete: true,
});

export function createWorld(options: WorldOptions): World {
  const { rules } = options;
  const rng = createRng(options.seed ?? 'star-swarm');
  const stage = options.stage ?? rules.stages.firstStage;
  const stages = options.stages ?? EMPTY_STAGE_SOURCE;
  const content = stages.stageFor(stage);
  const startingLives = options.lives ?? rules.lives.default;

  const world: World = {
    rules,
    stages,
    rank: options.rank,
    step: 0,
    stage,
    score: 0,
    status: 'playing',
    startingLives,
    player: createPlayer(rules),
    lives: createLives(rules, startingLives),
    shots: createShots(rules),
    enemyBullets: createEnemyBullets(rules),
    content,
    formation:
      content === undefined
        ? undefined
        : createFormation(content.formation, rules, content.stage.kind),
    challenge: createChallengeStage(rules, stage, content),
    fleet: content === undefined ? NO_FLEET() : createFleet(content, rules),
    dive: createDiveState(rules, stage, options.rank),
    capture: createCaptureState(rules, stage, options.rank),
    abilities: createAbilityState(),
    rng,
    events: [],
  };

  world.events = [
    { type: 'stage-started', stage, starfieldSpeed: starfieldSpeedByte(rules, stage) },
    { type: 'player-ready', x: world.player.x, y: world.player.y },
  ];
  return world;
}

/** Add to the score, raising the score event and any extra lives it earns. */
function addScore(world: World, delta: number): void {
  if (delta === 0) return;
  const previous = world.score;
  world.score += delta;
  world.events.push({ type: 'score-changed', score: world.score, delta });

  // Totals, not crossings: one bonus that carries the score past two thresholds
  // pays both, and the count is against the threshold set this run's starting
  // fighter count selects rather than against the rules' default.
  const awards = extraLivesEarned(world.rules, previous, world.score, world.startingLives);
  for (let i = 0; i < awards; i += 1) {
    world.lives.reserve += 1;
    world.lives.bonusesAwarded += 1;
    world.events.push({ type: 'extra-life', lives: world.lives.reserve, score: world.score });
  }
}

/**
 * What destroying this enemy pays, and whatever bonus it also triggers.
 *
 * Two rules, and which applies is the stage's business rather than the enemy's:
 *
 * - On an ordinary stage the value comes from the enemy's *state* — doubled
 *   unless it is at home or rotating back into its slot (see {@link enemyScore}).
 * - On a challenge stage it comes from the **stage**, because the original
 *   overwrites every enemy's score group at the start of one; a challenge flyer
 *   is worth 100 on the first challenge stage and 160 on the second whatever
 *   alien it is (`./challenge.js`).
 */
function destroyAward(
  world: World,
  enemy: Enemy,
): { readonly score: number; readonly groupBonus: number } {
  const challenge = world.challenge;
  if (challenge === undefined) return { score: enemyScore(enemy), groupBonus: 0 };
  const hit = recordChallengeHit(challenge, enemy.wave);
  return { score: hit.impact, groupBonus: hit.groupBonus };
}

/**
 * Pay the group of eight that hit emptied.
 *
 * A separate award from the target's own value rather than folded into it: in
 * the original every bonus is the same channel of 100-point units arriving
 * beside the kill, and a `target-destroyed` claiming 1,100 would make the eighth
 * of a group look like a differently valuable enemy. It is also the only
 * challenge-stage award the original shows a score tile for.
 */
function payChallengeGroup(world: World, enemy: Enemy, bonus: number): void {
  const challenge = world.challenge;
  if (challenge === undefined || bonus <= 0) return;
  world.events.push({
    type: 'challenge-group-cleared',
    stage: challenge.stage,
    ordinal: challenge.ordinal,
    group: enemy.wave,
    bonus,
  });
  addScore(world, bonus);
}

/**
 * Player shots against the fleet.
 *
 * On an ordinary stage the score is read from the enemy's *state*, not from a
 * table: an enemy shot during its entry wave is worth the doubled value and one
 * shot while rotating back into its slot is worth the plain one. A challenge
 * stage overrides both. See {@link destroyAward}.
 */
function resolvePlayerShots(world: World): void {
  for (const shot of world.shots) {
    if (!shot.active) continue;
    for (const enemy of world.fleet.enemies) {
      if (!isTargetable(enemy)) continue;
      if (hitWindowIndex(shot, enemy, shot.windows, enemy.hitPadding) < 0) continue;

      shot.active = false;
      // An ability may take the hit instead — a shield — in which case the shot is
      // spent and the enemy is exactly as it was.
      if (abilitiesAbsorbShot(world.abilities, enemy) !== undefined) {
        world.events.push({
          type: 'shield-hit',
          targetId: enemy.id,
          alienId: enemy.alienId,
          x: enemy.x,
          y: enemy.y,
          shieldRemaining: shieldRemaining(world.abilities, enemy) ?? 0,
        });
        break;
      }
      enemy.hitsRemaining -= 1;
      if (enemy.hitsRemaining > 0) {
        // A two-hit enemy's first hit scores nothing and only changes its
        // colour; the whole value lands on the hit that destroys it.
        world.events.push({
          type: 'target-hit',
          targetId: enemy.id,
          alienId: enemy.alienId,
          x: enemy.x,
          y: enemy.y,
          hitsRemaining: enemy.hitsRemaining,
        });
      } else {
        const award = destroyAward(world, enemy);
        const transformBonus = noteDestroyed(world.dive, world.rules, world.stage, enemy);
        const priorState = enemy.state;
        enemy.state = 'dead';
        world.fleet.flights.delete(enemy.id);
        // What this kill meant to the capture channel, read before the score is
        // added so a rescue and its points land in the order they happened. Marked
        // dead first, and handed the state it *had*: a rescue recalls every diver,
        // and this one must not be recalled.
        resolveCaptureKill(world, enemy, priorState);
        world.events.push({
          type: 'target-destroyed',
          targetId: enemy.id,
          alienId: enemy.alienId,
          x: enemy.x,
          y: enemy.y,
          score: award.score,
        });
        // The kill and any bonus it completed are two channels, added in that
        // order: every bonus in the game is the same 100-points-per-unit
        // accumulator, and a group bonus is not part of the last member's value.
        // A transform trio and a challenge group of eight are the same mechanism
        // and only one of them can be in play, since neither exists on the
        // other's stage.
        addScore(world, award.score);
        addScore(world, transformBonus);
        payChallengeGroup(world, enemy, award.groupBonus);
        // Whatever the kill leaves behind arrives after it: a split's fragments.
        resolveAbilityKill(world, enemy);
      }
      break; // One shot, one target.
    }
  }
}

/**
 * Route a kill through the capture channel.
 *
 * Every arcade path out of the channel that is caused by a player shot comes
 * through here: an attempt lost, a fighter taken anyway because the shot was too
 * late, a rescue, and a captured fighter turning rogue. The channel decides; this
 * only turns the answer into events and a possible loss.
 */
function resolveCaptureKill(world: World, enemy: Enemy, priorState: EnemyState): void {
  const { content, formation } = world;
  if (content === undefined || formation === undefined) return;

  const kill = captureNoteDestroyed(
    world.capture,
    { fleet: world.fleet, content, formation, rules: world.rules, playerAt: playerTarget(world) },
    enemy,
    priorState,
  );
  if (kill.failed) world.events.push({ type: 'capture-failed', targetId: enemy.id });
  if (kill.rogue) {
    world.events.push({ type: 'captive-rogue', targetId: world.capture.captiveId ?? -1 });
  }
  if (kill.rescued !== undefined) {
    const [x, y] = kill.rescued;
    world.events.push({ type: 'fighter-rescued', x, y });
  }
  // Shot after the beam had the ship but before it was pulled in: the arcade does
  // not rescue, and the fighter is lost (report acceptance test R10).
  if (kill.captured) capturePlayer(world);
}

/**
 * Route a kill through the ability registry, and report what it left.
 *
 * Content that declares no ability gets here and leaves nothing, which is the
 * guarantee that every recorded replay still plays as it was recorded.
 */
function resolveAbilityKill(world: World, enemy: Enemy): void {
  const ctx = abilityContext(world);
  if (ctx === undefined) return;
  const left = abilitiesNoteDestroyed(world.abilities, ctx, enemy);
  if (left.length === 0) return;
  world.events.push({
    type: 'enemy-split',
    targetId: enemy.id,
    alienId: enemy.alienId,
    x: enemy.x,
    y: enemy.y,
    group: left.map((fragment) => fragment.id),
  });
}

/** What the registry is handed for one step, or `undefined` with no stage on. */
function abilityContext(world: World): AbilityContext | undefined {
  const { content, formation } = world;
  if (content === undefined || formation === undefined) return undefined;
  return {
    fleet: world.fleet,
    content,
    formation,
    rules: world.rules,
    rng: world.rng,
    playerAt: playerTarget(world),
    attacks: world.dive.attacks,
    armed: world.dive.armed,
  };
}

/**
 * The fighter is lost to a tractor beam.
 *
 * A loss condition of its own: it raises `player-captured` rather than
 * `player-hit`, and **being captured on the last fighter ends the game**, which
 * `capture.lastFighterCaptureEndsGame` states so a pack that wants a gentler beam
 * can say so.
 */
function capturePlayer(world: World): void {
  const x = world.player.x;
  const y = world.player.y;
  world.player.alive = false;
  world.player.respawnTimer = world.rules.player.respawnFrames;
  world.player.stepFlag = 0;
  world.player.mode = 'single';
  clearShots(world.shots);

  const endsGame = world.rules.capture.lastFighterCaptureEndsGame;
  if (world.lives.reserve <= 0 && endsGame) {
    world.status = 'game-over';
    world.events.push({ type: 'player-captured', x, y, livesRemaining: 0 });
    world.events.push({ type: 'game-over', score: world.score });
    return;
  }

  if (world.lives.reserve > 0) world.lives.reserve -= 1;
  world.events.push({ type: 'player-captured', x, y, livesRemaining: world.lives.reserve });
}

/** Take a life, and end the game if that was the last one. */
function killPlayer(world: World, x: number, y: number): void {
  world.player.alive = false;
  world.player.respawnTimer = world.rules.player.respawnFrames;
  world.player.stepFlag = 0;
  clearShots(world.shots);
  clearEnemyBullets(world.enemyBullets);

  if (world.lives.reserve <= 0) {
    world.status = 'game-over';
    world.events.push({ type: 'player-hit', x, y, livesRemaining: 0 });
    world.events.push({ type: 'game-over', score: world.score });
    return;
  }

  world.lives.reserve -= 1;
  world.events.push({ type: 'player-hit', x, y, livesRemaining: world.lives.reserve });
}

/**
 * Enemy bullets against the fighter — one test per ship, so a dual has two.
 *
 * A dual fighter hit **loses that half**, not the ship in play: the survivor keeps
 * flying and the reserve is untouched, so a rescue is worth having. Which half was
 * hit decides where the survivor is, because the second ship is drawn to the right
 * of the anchor and the remaining one has to become the anchor. The rules state
 * whether the loss costs a fighter (`dualFighter.losingHalfCostsLife`); the arcade
 * says it does not.
 *
 * Nothing can hit the fighter while a beam is dragging it — it is already lost to
 * the beam, and killing it here would swallow the capture.
 */
function resolveEnemyBullets(world: World): void {
  if (!world.player.alive || beamHasFighter(world.capture)) return;
  const hitWindow = world.rules.player.hitWindow;
  const anchors = shipAnchors(world.player, world.rules);

  for (const bullet of world.enemyBullets) {
    if (!bullet.active) continue;
    for (const [index, anchor] of anchors.entries()) {
      if (hitWindowIndex(bullet, anchor, [hitWindow]) < 0) continue;
      bullet.active = false;
      if (world.player.mode === 'dual') loseDualHalf(world, index, anchor.x, anchor.y);
      else killPlayer(world, anchor.x, anchor.y);
      return;
    }
  }
}

/**
 * Enemy **bodies** against the fighter — the arcade's other way to die.
 *
 * [MANUAL] is explicit that it is a way to die and not an accident: "if they
 * can’t bomb you, they’ll ram you in the rear. That’s one of their favorite
 * tricks, to fly in a circle and come up behind you"
 * (`docs/reference/arcade-reference.md` section 5). So this is the same test the
 * bullets get, with the enemy on the other side of it: the fighter's own
 * `player.hitWindow`, widened by the *enemy's* `hitPadding` exactly as a player
 * shot is. There is no second window and no second idea of overlap, which is
 * what stops a fat alien being easy to shoot and impossible to fly past.
 *
 * Three things the reference settles, and one it does not:
 *
 * - **It costs a fighter, and it is the same loss as being shot.** One routine
 *   handles every hit on the fighter (`hitd_det_fghtr` → `hitd_fghtr_hit`), so it
 *   raises `player-hit` rather than an event of its own — unlike being captured,
 *   which really is a separate condition in the ROM.
 * - **It scores nothing, and the enemy flies on.** Every kill and every point in
 *   the reference reaches the accumulator through `hitd_dspchr`, the *rocket* hit
 *   dispatcher, and the report traces that path link by link as the only one
 *   there is (section 3.1). Nothing puts an enemy's destruction on the
 *   fighter-hit path. That the reference does not state the negative outright is
 *   recorded as an open item in its section 11; this is the reading consistent
 *   with the rest of it, and the cautious one — a ram that also killed the enemy
 *   would hand out free kills nothing traced.
 * - **A diver and a formation enemy are not different cases.** The fighter-hit
 *   path carries no state test, unlike the *scoring* path, which carries one. So
 *   the rule is "any enemy on the field", which is the set a shot may hit
 *   ({@link isTargetable}) and needs no set of its own. On the shipped formation
 *   nothing at home can reach the fighter's row even at full breathe, so the
 *   generality costs nothing and invents nothing;
 *   `tests/unit/world.test.ts` pins both halves of that.
 *
 * Two gates, neither of them new. **Nothing attacks on a challenge stage** and a
 * body is an attack, so `allowsAttacks` refuses it there — the same answer
 * `stepAttacks` and the capture channel's attacking parts give. And nothing can
 * hit the fighter while a beam is dragging it: it is already lost to the beam.
 */
function resolveBodyCollisions(world: World): void {
  if (!world.rules.enemies.collision.enabled) return;
  if (!world.player.alive || beamHasFighter(world.capture)) return;
  if (!allowsAttacks(world.rules, world.stage)) return;

  const hitWindow = world.rules.player.hitWindow;
  const anchors = shipAnchors(world.player, world.rules);

  for (const enemy of world.fleet.enemies) {
    if (!isTargetable(enemy)) continue;
    for (const [index, anchor] of anchors.entries()) {
      // Measured ship → enemy, so the padding widening the window is the
      // enemy's, which is the only way round that composes with a dual
      // fighter's two anchors.
      if (hitWindowIndex(anchor, enemy, [hitWindow], enemy.hitPadding) < 0) continue;
      if (world.player.mode === 'dual') loseDualHalf(world, index, anchor.x, anchor.y);
      else killPlayer(world, anchor.x, anchor.y);
      return;
    }
  }
}

/**
 * One half of a dual fighter is lost — shot away, or flown into.
 *
 * Releases the capture channel, which is the last of the arcade's ways back to
 * idle: beams resume once you are a single fighter again (report acceptance test
 * R6).
 */
function loseDualHalf(world: World, index: number, x: number, y: number): void {
  const { player, rules } = world;
  player.mode = 'single';
  // Losing the left ship promotes the right one, which was drawn at the offset.
  if (index === 0) player.x += rules.player.secondShipOffsetX;
  player.x = Math.min(maxXFor(rules, 'single'), Math.max(rules.player.minX, player.x));
  captureNoteHalfLost(world.capture);
  world.events.push({ type: 'dual-half-lost', x, y, livesRemaining: world.lives.reserve });
  if (rules.dualFighter.losingHalfCostsLife) killPlayer(world, x, y);
}

/** Bring the next fighter on after a hit. */
function resolveRespawn(world: World): void {
  if (world.player.alive || world.status === 'game-over') return;
  // A beam still dragging the ship has not finished taking it.
  if (beamHasFighter(world.capture)) return;
  world.player.respawnTimer -= 1;
  if (world.player.respawnTimer > 0) return;
  world.player.respawnTimer = 0;
  // The wait is served, but the field may not be safe to step onto: a beam still
  // out is aimed at the column the last fighter died in, and the next one always
  // arrives at the same column. Put it there now and the catch test takes it on
  // the frame it appears, with no frame in which to move — see {@link beamIsOut}.
  // The hold is bounded: a beam that catches nothing retracts and releases.
  if (beamIsOut(world.capture)) return;
  world.player.alive = true;
  world.player.x = startX(world.rules, world.player.mode);
  // And back onto its own row: a tractor beam is the one thing that moves the
  // fighter off it, so the next one has to be put back.
  world.player.y = world.rules.player.y;
  world.events.push({ type: 'player-ready', x: world.player.x, y: world.player.y });
}

/** Load the stage content for `stage`, replacing the formation and the fleet. */
function enterStage(world: World, stage: number): void {
  world.stage = stage;
  world.content = world.stages.stageFor(stage);
  world.formation =
    world.content === undefined
      ? undefined
      : createFormation(world.content.formation, world.rules, world.content.stage.kind);
  world.challenge = createChallengeStage(world.rules, stage, world.content);
  world.fleet = world.content === undefined ? NO_FLEET() : createFleet(world.content, world.rules);
  world.dive = createDiveState(world.rules, stage, world.rank);
  world.abilities = createAbilityState();
  // The capture channel is *not* replaced: a captured fighter stays with its
  // captor for the rest of the game, and re-enters as the last ship of this
  // stage's wave.
  if (world.content !== undefined && world.formation !== undefined) {
    enterStageCapture(
      world.capture,
      {
        fleet: world.fleet,
        content: world.content,
        formation: world.formation,
        rules: world.rules,
      },
      stage,
      world.rank,
    );
  }
  world.events.push({
    type: 'stage-started',
    stage,
    starfieldSpeed: starfieldSpeedByte(world.rules, stage),
  });
}

/**
 * Pay the end-of-stage award and report what the stage amounted to.
 *
 * Raised before `stage-cleared`, because these numbers belong to the stage that
 * just finished. The perfect branch and the ordinary one are separate events
 * because they are separate branches in the original and a pack binds a
 * different melody to each — and because they are mutually exclusive: the
 * perfect bonus *replaces* `perHit × hits`, it is not added to it.
 */
function resolveChallengeEnd(world: World): void {
  const challenge = world.challenge;
  if (challenge === undefined || challenge.ended) return;

  const end = endChallengeStage(challenge, world.rules);
  const award = {
    stage: challenge.stage,
    ordinal: challenge.ordinal,
    hits: end.hits,
    bonus: end.endBonus,
  } as const;
  world.events.push(
    end.perfect ? { type: 'challenge-perfect', ...award } : { type: 'challenge-bonus', ...award },
  );
  addScore(world, end.endBonus);

  world.events.push({
    type: 'challenge-ended',
    stage: challenge.stage,
    ordinal: challenge.ordinal,
    hits: end.hits,
    total: end.total,
    perfect: end.perfect,
    impactScore: end.impactScore,
    groupBonus: end.groupBonus,
    endBonus: end.endBonus,
  });
}

/**
 * Emptying the field rolls on to the next stage.
 *
 * "Empty" is destroyed **or flown away**: both ways off the field reach `dead`,
 * so a challenge stage whose forty enemies sailed past untouched ends on the
 * same test a combat stage does (`aliveEnemies` in `./enemies.js`).
 *
 * A stage the pack has no content for puts no enemies on the field, and the world
 * sits on it rather than rolling forward every frame — "the sequence ran out" is a
 * halt, not an infinite stage counter.
 */
function resolveStageEnd(world: World): void {
  if (world.fleet.enemies.length === 0) return;
  // Your own captured fighter is not something to clear: it stays with its captor
  // for the rest of the game, so a stage holding nothing else still ends.
  if (fleetEnemies(world.fleet.enemies).length > 0) return;

  resolveChallengeEnd(world);
  world.events.push({ type: 'stage-cleared', stage: world.stage });
  clearShots(world.shots);
  clearEnemyBullets(world.enemyBullets);
  enterStage(world, world.stage + 1);
}

/**
 * Where a dive aims: the fighter's anchor, or nothing while it is off the field.
 *
 * A dual fighter aims at the anchor rather than at either ship, which is the one
 * the arcade's bomb vectors are measured from too.
 */
function playerTarget(world: World): Vec2 | undefined {
  return world.player.alive ? [world.player.x, world.player.y] : undefined;
}

/**
 * The formation's coordinates, then every enemy that addresses them, then the
 * attack the difficulty row asks for.
 *
 * The order is load-bearing three times over. The formation moves first, so an
 * enemy launching this frame predicts its slot from the offset the formation has
 * *now*. The fleet flies next, so a dive launched below is compiled from where
 * the enemy has just arrived. And `formation-settled` arms the dives on its own
 * frame, so nothing peels off a formation that is not yet centred.
 */
function stepEnemies(world: World): void {
  const { content, formation } = world;
  if (content === undefined || formation === undefined) return;

  const settled = stepFormation(formation, world.rules);
  if (settled) {
    world.events.push({
      type: 'formation-settled',
      stage: world.stage,
      enemies: aliveEnemies(world.fleet.enemies).length,
    });
    // Diving begins here — on the frame the sway passes back through zero — and
    // not on the frame the last wave arrived. See `armDives`.
    armDives(world.dive);
  }

  const playerAt = playerTarget(world);
  const step = stepFleet(world.fleet, content, formation, world.rules, playerAt);
  for (const enemy of step.launched) {
    world.events.push({
      type: 'enemy-launched',
      targetId: enemy.id,
      alienId: enemy.alienId,
      wave: enemy.wave,
      x: enemy.x,
      y: enemy.y,
    });
  }
  for (const enemy of step.departed) {
    noteDeparted(world.dive, enemy);
    world.events.push({
      type: 'enemy-departed',
      targetId: enemy.id,
      alienId: enemy.alienId,
      x: enemy.x,
      y: enemy.y,
    });
  }

  const attack = stepAttacks(world.dive, {
    fleet: world.fleet,
    content,
    formation,
    rules: world.rules,
    stage: world.stage,
    rng: world.rng,
    bullets: world.enemyBullets,
    capture: world.capture,
    playerAt,
    scripted: step.fired,
  });

  for (const enemy of attack.dived) {
    world.events.push({
      type: 'enemy-dived',
      targetId: enemy.id,
      alienId: enemy.alienId,
      x: enemy.x,
      y: enemy.y,
    });
  }
  for (const enemy of attack.fired) {
    world.events.push({ type: 'enemy-fired', targetId: enemy.id, x: enemy.x, y: enemy.y });
  }
  if (attack.transforming !== undefined) {
    const enemy = attack.transforming;
    world.events.push({
      type: 'enemy-transforming',
      targetId: enemy.id,
      x: enemy.x,
      y: enemy.y,
    });
  }
  if (attack.transformed.length > 0) {
    const first = attack.transformed[0];
    world.events.push({
      type: 'enemy-transformed',
      targetId: attack.transformedFrom ?? -1,
      alienId: first?.alienId ?? '',
      group: attack.transformed.map((enemy) => enemy.id),
    });
  }

  resolveCapture(world, content, formation, step.triggered, playerAt);
  resolveAbilities(world, step.triggered);
}

/**
 * The enemies' own abilities, stepped last.
 *
 * Last so that each reads where its enemy has just flown to and what the
 * director and the capture channel have already done this frame — and so that a
 * stage whose aliens declare nothing passes through here untouched.
 */
function resolveAbilities(world: World, triggered: readonly ScriptedTrigger[]): void {
  const ctx = abilityContext(world);
  if (ctx === undefined) return;
  const step = stepAbilities(world.abilities, ctx, triggered);

  for (const { enemy, from } of step.teleported) {
    world.events.push({
      type: 'enemy-teleported',
      targetId: enemy.id,
      alienId: enemy.alienId,
      fromX: from[0],
      fromY: from[1],
      x: enemy.x,
      y: enemy.y,
    });
  }
  for (const { parent, minions } of step.spawned) {
    world.events.push({
      type: 'minions-spawned',
      targetId: parent.id,
      alienId: parent.alienId,
      x: parent.x,
      y: parent.y,
      group: minions.map((minion) => minion.id),
    });
  }
  for (const enemy of step.restored) {
    world.events.push({
      type: 'shield-restored',
      targetId: enemy.id,
      alienId: enemy.alienId,
      x: enemy.x,
      y: enemy.y,
    });
  }
}

/**
 * The capture channel, stepped after the fleet.
 *
 * After, because everything it measures is taken from where the captor has just
 * flown to: the beam's origin, the catch test and the drag all read the captor's
 * current anchor. It is also where the beam's `trigger` from a path lands, which is
 * the only thing that opens a beam.
 */
function resolveCapture(
  world: World,
  content: StageContent,
  formation: FormationState,
  triggered: readonly ScriptedTrigger[],
  playerAt: Vec2 | undefined,
): void {
  const step = stepCapture(world.capture, {
    fleet: world.fleet,
    content,
    formation,
    rules: world.rules,
    stage: world.stage,
    player: world.player,
    rng: world.rng,
    triggered,
    playerAt,
  });

  if (step.beamStarted !== undefined) {
    const captor = step.beamStarted;
    world.events.push({
      type: 'capture-started',
      targetId: captor.id,
      x: captor.x,
      y: captor.y,
    });
  }
  if (step.failed) world.events.push({ type: 'capture-failed', targetId: -1 });
  if (step.dived !== undefined) {
    const captive = step.dived;
    world.events.push({
      type: 'enemy-dived',
      targetId: captive.id,
      alienId: captive.alienId,
      x: captive.x,
      y: captive.y,
    });
  }
  if (step.captured) capturePlayer(world);
  if (step.docked) {
    world.events.push({ type: 'fighter-docked', x: world.player.x, y: world.player.y });
  }
}

/**
 * Advance the world by exactly one step and return what happened.
 *
 * The returned array is `world.events`; it is replaced on the next step, so a
 * subscriber that wants to keep events must copy them.
 */
export function stepWorld(world: World, frame: InputFrame): readonly SimEvent[] {
  world.events = [];
  if (world.status === 'game-over') {
    world.step += 1;
    return world.events;
  }

  resolveRespawn(world);
  // A beam dragging the ship flies it; the stick does nothing until it lets go.
  if (!beamHasFighter(world.capture)) stepPlayer(world.player, frame, world.rules);

  // No edge detection: holding fire fires whenever a slot is free. The cap and
  // the flight time are the whole of the fire rate. Fire is disabled outright once
  // a captor has connected — "disables your rockets when the boss has finally
  // connected" (`docs/reference/arcade-reference.md` section 7).
  if (
    world.player.alive &&
    captureAllowsFire(world.capture, world.rules) &&
    isDown(frame, 'fire')
  ) {
    const shot = fireShot(
      world.shots,
      world.player.x,
      world.player.y,
      world.player.mode,
      world.rules,
    );
    if (shot !== null) {
      world.events.push({ type: 'shot-fired', slot: shot.slot, x: shot.x, y: shot.y });
    }
  }

  stepEnemies(world);

  stepShots(world.shots, world.rules);
  resolvePlayerShots(world);

  // Bodies before bullets, and after the shots: an enemy destroyed on this frame
  // cannot also ram you, which is the player-favourable reading of an order the
  // arcade's single dispatcher pass does not settle — and the one that avoids
  // dying to something that is no longer on the screen.
  resolveBodyCollisions(world);

  stepEnemyBullets(world.enemyBullets, world.rules);
  resolveEnemyBullets(world);

  resolveStageEnd(world);

  world.step += 1;
  return world.events;
}

/** One enemy, reduced to the numbers a golden replay has to agree on. */
function enemyFingerprint(enemy: Enemy): readonly (string | number)[] {
  return [
    enemy.id,
    enemy.state,
    enemy.home,
    enemy.hitsRemaining,
    enemy.x,
    enemy.y,
    enemy.pathFrame,
    // The bomb delay and the per-run allowance are the whole of enemy fire, so a
    // run that agreed on positions but not on these would diverge a second later.
    enemy.bombTimer,
    enemy.bombsLeft,
  ];
}

/**
 * Decimal places a fingerprinted number is compared to.
 *
 * The exact-float comparison this replaces was specified far tighter than
 * anything the game can show. Two bounds fix the useful range:
 *
 * - **Below**, the noise floor. `Math.sin`, `Math.cos` and `Math.atan2` are
 *   engine-defined (see the note at the top of `./paths.ts`) and can land one ULP
 *   apart on different CPU architectures. The largest ULP among the numbers the
 *   shipped goldens actually record is 5.7e-14, at a y near the bottom of the
 *   playfield. A golden recorded on one machine has already failed on another by
 *   exactly that much, in one enemy's frozen x, with every other value identical.
 * - **Above**, the observation floor. Positions are drawn to whole pixels, so the
 *   finest difference anyone could ever see is one crossing a half-pixel boundary:
 *   0.5.
 *
 * Six places sits between them with room either way — 1e-6 is 1.8e7 times the
 * noise and 5e5 times finer than the half pixel — and the bias towards the loose
 * end is deliberate, because no behaviour exists between 1e-14 and 1e-6 and a CI
 * failure that reproduces on no developer's machine costs more than it catches.
 *
 * This narrows what a golden detects and is **not** a claim that the simulation is
 * bit-identical across machines. It is not; this only stops that mattering to the
 * test suite. Rounding is also discontinuous, so two values straddling a grid line
 * still differ — measured at roughly 1e-5 odds across a whole fingerprint, against
 * the near-certainty this replaces. `tests/unit/world.test.ts` pins both halves:
 * that a one-ULP nudge is absorbed, and that a thousandth of a pixel is not.
 */
const FINGERPRINT_DP = 6;
const FINGERPRINT_GRID = 10 ** FINGERPRINT_DP;

/**
 * Round one fingerprinted number, leaving integers exactly as they are.
 *
 * The integer guard is not an optimisation: `rng.getState()` is four uint32s and
 * `AGENTS.md` calls the RNG stream part of the on-disk contract, so the safest
 * thing is for no integer to go near the arithmetic at all.
 */
function quantise(value: number): number {
  if (Number.isInteger(value) || !Number.isFinite(value)) return value;
  return Math.round(value * FINGERPRINT_GRID) / FINGERPRINT_GRID;
}

/**
 * A single comparable value for the whole simulation state.
 *
 * Used by the golden replay tests: two runs that agree on this agree on
 * everything the simulation carries, including the RNG's position, which is what
 * catches a change that only shows up several thousand draws later.
 *
 * Every number is quantised on the way out — see {@link FINGERPRINT_DP}. It is
 * done with a `JSON.stringify` replacer rather than field by field on purpose:
 * the replacer sees every number in the structure, so a float added here later
 * cannot quietly reintroduce the cross-machine failure, and nothing the
 * simulation holds is touched, only the copy being serialised.
 */
export function fingerprintWorld(world: World): string {
  return JSON.stringify(
    {
      step: world.step,
      stage: world.stage,
      score: world.score,
      status: world.status,
      player: world.player,
      lives: world.lives,
      shots: world.shots.map(({ slot, active, x, y }) => [slot, active, x, y]),
      bullets: world.enemyBullets.map(({ slot, active, x, y, vx, vy }) => [
        slot,
        active,
        x,
        y,
        vx,
        vy,
      ]),
      dive: diveFingerprint(world.dive),
      capture: captureFingerprint(world.capture),
      // Absent, not empty, while no ability has acted: see `abilityFingerprint`.
      abilities: abilityFingerprint(world.abilities),
      formation: world.formation && [
        world.formation.frame,
        world.formation.motion,
        world.formation.swayOffset,
        world.formation.swayDirection,
        world.formation.breatheStep,
        world.formation.breatheDirection,
        world.formation.entryComplete,
      ],
      challenge: world.challenge && [
        world.challenge.ordinal,
        world.challenge.hits,
        world.challenge.impactScore,
        world.challenge.groupBonusPaid,
        world.challenge.groupHits,
        world.challenge.ended,
      ],
      fleet: [world.fleet.frame, world.fleet.entryComplete],
      enemies: world.fleet.enemies.map(enemyFingerprint),
      rng: world.rng.getState(),
    },
    (_key, value: unknown) => (typeof value === 'number' ? quantise(value) : value),
  );
}
