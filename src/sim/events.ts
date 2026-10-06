/**
 * Simulation events (docs/DESIGN.md section 9).
 *
 * The sim cannot draw a ship, flash a life away or play a sound — it has no DOM,
 * no Canvas and no Web Audio, by rule. What it does instead is say what
 * happened, as a plain value. `src/render/`, `src/ui/` and `src/audio/` read the
 * list after each step and react however they like.
 *
 * Events are values rather than callbacks on purpose: a callback would let the
 * subscriber reach back into the step that raised it, and a run that depends on
 * who was listening is no longer reproducible from (seed, inputs).
 */

export interface StageStartedEvent {
  readonly type: 'stage-started';
  readonly stage: number;
  /** Hardware starfield speed register shadow; see `starfieldSpeedByte`. */
  readonly starfieldSpeed: number;
}

export interface ShotFiredEvent {
  readonly type: 'shot-fired';
  /** Which of the two rocket slots; the ROM has exactly two and so do we. */
  readonly slot: number;
  readonly x: number;
  readonly y: number;
}

export interface EnemyFiredEvent {
  readonly type: 'enemy-fired';
  readonly targetId: number;
  readonly x: number;
  readonly y: number;
}

/**
 * An enemy left the formation to attack.
 *
 * Raised on the frame the dive path is compiled, which is also the frame the
 * arcade's dive sound starts — `packs/classic/pack.json` binds it to `dive`.
 */
export interface EnemyDivedEvent {
  readonly type: 'enemy-dived';
  readonly targetId: number;
  readonly alienId: string;
  readonly x: number;
  readonly y: number;
}

/**
 * An enemy finished a dive and left the field for good, undestroyed.
 *
 * Distinct from `target-destroyed` on purpose: nothing was shot, so nothing
 * scores. The arcade's transformed trio leaves this way; its bees and butterflies
 * re-enter from the top instead and raise nothing.
 */
export interface EnemyDepartedEvent {
  readonly type: 'enemy-departed';
  readonly targetId: number;
  readonly alienId: string;
  readonly x: number;
  readonly y: number;
}

/** An enemy began the pulse that warns it is about to become a group. */
export interface EnemyTransformingEvent {
  readonly type: 'enemy-transforming';
  readonly targetId: number;
  readonly x: number;
  readonly y: number;
}

/** One enemy became a group of another type, already diving. */
export interface EnemyTransformedEvent {
  readonly type: 'enemy-transformed';
  /** The enemy that was replaced. It is off the field from this frame. */
  readonly targetId: number;
  /** The alien the group is made of. */
  readonly alienId: string;
  /** The ids of the group, in the order they were spawned. */
  readonly group: readonly number[];
}

export interface TargetDestroyedEvent {
  readonly type: 'target-destroyed';
  readonly targetId: number;
  readonly x: number;
  readonly y: number;
  readonly score: number;
  /** Which alien died, so audio can pick its own death sound (`src/audio/sfx.ts`). */
  readonly alienId: string;
}

export interface TargetHitEvent {
  readonly type: 'target-hit';
  readonly targetId: number;
  readonly x: number;
  readonly y: number;
  readonly hitsRemaining: number;
  readonly alienId: string;
}

export interface EnemyLaunchedEvent {
  readonly type: 'enemy-launched';
  readonly targetId: number;
  readonly alienId: string;
  /** The entry wave it belongs to, zero-based. */
  readonly wave: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The formation has finished filling and is centred.
 *
 * Raised on the one frame the entry sway ends — which in the arcade is also the
 * frame the pulsing-formation sound starts and the breathe begins
 * (`docs/reference/arcade-reference.md` section 5). Emitting it makes that
 * coincidence something a test can assert rather than something to eyeball.
 */
export interface FormationSettledEvent {
  readonly type: 'formation-settled';
  readonly stage: number;
  /** Enemies still alive when it settled. */
  readonly enemies: number;
}

export interface ScoreChangedEvent {
  readonly type: 'score-changed';
  readonly score: number;
  readonly delta: number;
}

export interface ExtraLifeEvent {
  readonly type: 'extra-life';
  readonly lives: number;
  readonly score: number;
}

/**
 * A captor opened its tractor beam.
 *
 * Raised on the frame the beam appears, which is the frame the arcade's capture
 * tune starts — `packs/classic/pack.json` binds it to `capture-beam`.
 */
export interface CaptureStartedEvent {
  readonly type: 'capture-started';
  readonly targetId: number;
  readonly x: number;
  readonly y: number;
}

/**
 * A capture attempt ended with the fighter untouched.
 *
 * Its own event rather than silence because it is the moment the channel is free
 * again, and "does a second beam ever appear?" is the behaviour the whole mechanic
 * turns on. `targetId` is the captor when a shot ended the attempt and `-1` when
 * the beam simply retracted.
 */
export interface CaptureFailedEvent {
  readonly type: 'capture-failed';
  readonly targetId: number;
}

/**
 * The fighter was taken by a tractor beam.
 *
 * **A distinct loss condition from being shot**, which is why it is a distinct
 * event: on the last fighter it ends the game, and a subscriber that treated it as
 * a `player-hit` would lose both the sound and the reason
 * (`docs/reference/arcade-reference.md` section 7).
 */
export interface PlayerCapturedEvent {
  readonly type: 'player-captured';
  readonly x: number;
  readonly y: number;
  readonly livesRemaining: number;
}

/** The captured fighter's captor was destroyed in formation: it is a rogue now. */
export interface CaptiveRogueEvent {
  readonly type: 'captive-rogue';
  readonly targetId: number;
}

/** The captured fighter was freed. It spins where it was until it docks. */
export interface FighterRescuedEvent {
  readonly type: 'fighter-rescued';
  readonly x: number;
  readonly y: number;
}

/** The freed fighter finished docking: the fighter is dual from this frame. */
export interface FighterDockedEvent {
  readonly type: 'fighter-docked';
  readonly x: number;
  readonly y: number;
}

/** One half of a dual fighter was shot away, leaving a single ship flying. */
export interface DualHalfLostEvent {
  readonly type: 'dual-half-lost';
  readonly x: number;
  readonly y: number;
  readonly livesRemaining: number;
}

export interface PlayerHitEvent {
  readonly type: 'player-hit';
  readonly x: number;
  readonly y: number;
  readonly livesRemaining: number;
}

export interface PlayerReadyEvent {
  readonly type: 'player-ready';
  readonly x: number;
  readonly y: number;
}

export interface GameOverEvent {
  readonly type: 'game-over';
  readonly score: number;
}

export interface StageClearedEvent {
  readonly type: 'stage-cleared';
  readonly stage: number;
}

/**
 * Challenge-stage events.
 *
 * Four, because the original's challenge stage pays in four distinguishable
 * moments and the sounds differ: each group of eight cleared, then — mutually
 * exclusively — either the ordinary end-of-stage award or the perfect one, and
 * finally the summary the between-stage screen reads. `challenge-bonus` and
 * `challenge-perfect` are the ROM's own two branches (`cp #40`), which is why
 * they are separate types rather than one event with a flag: a pack binds a
 * different melody to each (`docs/reference/arcade-reference.md` section 8).
 *
 * Every one carries `ordinal` — the zero-based challenge-stage index — because
 * that, not the stage number, is what the award tables are keyed by.
 */
export interface ChallengeGroupClearedEvent {
  readonly type: 'challenge-group-cleared';
  readonly stage: number;
  readonly ordinal: number;
  /** Which group of eight, zero-based: the entry wave it was. */
  readonly group: number;
  readonly bonus: number;
}

/** The end-of-stage award on a stage that was not perfect: `perHit × hits`. */
export interface ChallengeBonusEvent {
  readonly type: 'challenge-bonus';
  readonly stage: number;
  readonly ordinal: number;
  readonly hits: number;
  readonly bonus: number;
}

/** The end-of-stage award on a perfect stage, which *replaces* the above. */
export interface ChallengePerfectEvent {
  readonly type: 'challenge-perfect';
  readonly stage: number;
  readonly ordinal: number;
  readonly hits: number;
  readonly bonus: number;
}

/**
 * A challenge stage is over — every enemy destroyed or flown away, and the
 * end-of-stage award already in the score.
 *
 * The numbers the original's between-stage screen shows, plus the two running
 * totals a results row wants, so the screen counts nothing itself.
 */
export interface ChallengeEndedEvent {
  readonly type: 'challenge-ended';
  readonly stage: number;
  readonly ordinal: number;
  /** Enemies destroyed, which is the "NUMBER OF HITS" the original displays. */
  readonly hits: number;
  /** Enemies the stage put on the field. 40 in the arcade. */
  readonly total: number;
  readonly perfect: boolean;
  /** Points scored at the moment of impact, across the whole stage. */
  readonly impactScore: number;
  /** Group bonuses awarded during the stage. */
  readonly groupBonus: number;
  /** The end-of-stage award: the perfect bonus, or `perHit × hits`. */
  readonly endBonus: number;
}

/**
 * A shot connected with an enemy's shield rather than with the enemy
 * (`src/sim/abilities/shield.ts`). Scores nothing and leaves its `hp` alone.
 */
export interface ShieldHitEvent {
  readonly type: 'shield-hit';
  readonly targetId: number;
  readonly alienId: string;
  readonly x: number;
  readonly y: number;
  /** Hits the shield will still take; 0 means the next shot reaches the enemy. */
  readonly shieldRemaining: number;
}

/** An enemy's shield went long enough unhit to be whole again. */
export interface ShieldRestoredEvent {
  readonly type: 'shield-restored';
  readonly targetId: number;
  readonly alienId: string;
  readonly x: number;
  readonly y: number;
}

/**
 * A destroyed enemy broke into fragments (`src/sim/abilities/split-on-hit.ts`).
 * Raised after the `target-destroyed` of the kill that split it.
 */
export interface EnemySplitEvent {
  readonly type: 'enemy-split';
  readonly targetId: number;
  readonly alienId: string;
  readonly x: number;
  readonly y: number;
  /** The fragments, already diving. */
  readonly group: readonly number[];
}

/** A diving enemy blinked to another column (`src/sim/abilities/teleport.ts`). */
export interface EnemyTeleportedEvent {
  readonly type: 'enemy-teleported';
  readonly targetId: number;
  readonly alienId: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly x: number;
  readonly y: number;
}

/** An enemy launched minions (`src/sim/abilities/spawn-minions.ts`). */
export interface MinionsSpawnedEvent {
  readonly type: 'minions-spawned';
  readonly targetId: number;
  readonly alienId: string;
  readonly x: number;
  readonly y: number;
  /** The minions, already diving. */
  readonly group: readonly number[];
}

/**
 * A diving enemy became another alien (`src/sim/abilities/transform.ts`).
 *
 * Not `enemy-transformed`, which is the arcade's transform attack turning one
 * enemy into a group: this is one enemy changing type and carrying on, with the
 * same id. Nothing is destroyed and nothing scores.
 */
export interface EnemyMorphedEvent {
  readonly type: 'enemy-morphed';
  readonly targetId: number;
  /** The alien it was. */
  readonly fromAlienId: string;
  /** The alien it is now. */
  readonly alienId: string;
  readonly x: number;
  readonly y: number;
}

export type SimEvent =
  | StageStartedEvent
  | ShotFiredEvent
  | EnemyFiredEvent
  | EnemyDivedEvent
  | EnemyDepartedEvent
  | EnemyTransformingEvent
  | EnemyTransformedEvent
  | EnemyLaunchedEvent
  | FormationSettledEvent
  | TargetDestroyedEvent
  | TargetHitEvent
  | ScoreChangedEvent
  | ExtraLifeEvent
  | CaptureStartedEvent
  | CaptureFailedEvent
  | PlayerCapturedEvent
  | CaptiveRogueEvent
  | FighterRescuedEvent
  | FighterDockedEvent
  | DualHalfLostEvent
  | PlayerHitEvent
  | PlayerReadyEvent
  | GameOverEvent
  | StageClearedEvent
  | ChallengeGroupClearedEvent
  | ChallengeBonusEvent
  | ChallengePerfectEvent
  | ChallengeEndedEvent
  | ShieldHitEvent
  | ShieldRestoredEvent
  | EnemySplitEvent
  | EnemyTeleportedEvent
  | MinionsSpawnedEvent
  | EnemyMorphedEvent;

export type SimEventType = SimEvent['type'];

/** Narrow a list of events to one type. Handy in tests and in subscribers. */
export function eventsOfType<T extends SimEventType>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);
}
