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

export interface TargetDestroyedEvent {
  readonly type: 'target-destroyed';
  readonly targetId: number;
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

export interface TargetHitEvent {
  readonly type: 'target-hit';
  readonly targetId: number;
  readonly x: number;
  readonly y: number;
  readonly hitsRemaining: number;
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

export type SimEvent =
  | StageStartedEvent
  | ShotFiredEvent
  | EnemyFiredEvent
  | TargetDestroyedEvent
  | TargetHitEvent
  | ScoreChangedEvent
  | ExtraLifeEvent
  | PlayerHitEvent
  | PlayerReadyEvent
  | GameOverEvent
  | StageClearedEvent;

export type SimEventType = SimEvent['type'];

/** Narrow a list of events to one type. Handy in tests and in subscribers. */
export function eventsOfType<T extends SimEventType>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);
}
