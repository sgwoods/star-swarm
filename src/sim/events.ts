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
  | PlayerHitEvent
  | PlayerReadyEvent
  | GameOverEvent
  | StageClearedEvent
  | ChallengeGroupClearedEvent
  | ChallengeBonusEvent
  | ChallengePerfectEvent
  | ChallengeEndedEvent;

export type SimEventType = SimEvent['type'];

/** Narrow a list of events to one type. Handy in tests and in subscribers. */
export function eventsOfType<T extends SimEventType>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);
}
