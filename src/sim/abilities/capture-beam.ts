/**
 * The capture channel: the tractor beam, the captured fighter, the rogue, the
 * rescue and the dual fighter (`docs/DESIGN.md` section 4, "Capture and rescue";
 * `docs/reference/arcade-reference.md` section 7).
 *
 * It is the `captureBeam` module of the ability registry (`./registry.ts`), and
 * the one registered ability that is a **channel** rather than something an
 * enemy carries: `rules.capture` switches it on for the whole run, a path's
 * `trigger` naming `captureBeam` says where in the captor's dive the beam
 * opens, and the world steps it directly because a captured fighter outlives
 * the stage it was taken in. So it hands the registry no per-enemy hooks.
 *
 * This is the mechanic the original is remembered for, and five ideas hold it
 * together. Each is something a plausible implementation gets wrong, and the
 * first is the one everything else hangs off:
 *
 * 1. **There is exactly one captured fighter, ever, and it is a rule rather than
 *    a number.** One channel exists, and a captor may only be *chosen* while that
 *    channel is idle. A successful capture does **not** release it: it stays busy
 *    for as long as the fighter is held, including while the fighter is parked as
 *    a rogue and including while it is flying beside you as a dual. So no second
 *    beam ever appears until the channel is released, and a dual fighter is never
 *    targeted — not by a special case, but because the channel is not idle. The
 *    complete set of releases is {@link releaseCapture}'s callers, and the arcade
 *    ROM sites behind each are listed there.
 * 2. **A capture attempt is a dive with a beam on it.** It launches through the
 *    same director, the same credit and the same `beginDive` as every other dive
 *    (`src/sim/dive.ts` calls {@link beginCaptureDive} when a captor-role launch
 *    comes up), and it flies an ordinary pack-authored dive path. The beam comes
 *    out where that path says: at its `trigger` segment naming the `captureBeam`
 *    ability. So how far the captor descends before it opens the beam is authored
 *    content, not a threshold in the engine.
 * 3. **The beam's step period is a difficulty-row number.** Rank A runs 12 frames
 *    per step at stage 1 down to 3 late on, and the same countdown paces the
 *    extension, the hold, the retraction *and* the pull-in — so a late beam
 *    extends and pulls four times faster, which is what makes a late capture hard
 *    to escape. It is a speed, not a probability (report section 7.7, and the
 *    reference's parameter table).
 * 4. **The captured fighter is an enemy.** It sits in the formation, dives with
 *    its captor, can be shot for 500 standing or 1,000 attacking, and re-enters as
 *    the last ship of the next stage's wave while it is held. Everything on that
 *    list is enemy behaviour, so it *is* an {@link Enemy} — one whose home
 *    addresses the formation's captive slots rather than its alien slots.
 * 5. **Capture of the last fighter ends the game.** It is a loss condition in its
 *    own right, distinct from being shot, and the original's manual is explicit
 *    about it. The channel says the fighter was taken; `src/sim/world.ts` decides
 *    what that costs.
 *
 * No constants: every number arrives in the `Rules` value.
 */

import { allowsAttacks, resolveBeamStepFrames, resolveDifficultyRow } from '../../content/rules.js';
import type { AbilityType, HitWindow, Rules } from '../../content/schema.js';
import type { StageContent } from '../../content/stages.js';
import type { Rng } from '../../engine/rng.js';
import { withinWindow } from '../collision.js';
import type { Enemy, EnemyState, Fleet, ScriptedTrigger } from '../enemies.js';
import { addEnemy, beginDive, beginReturn, waveLaunchFrames } from '../enemies.js';
import type { FormationState } from '../formation.js';
import { captiveSlotOf, homePosition, isRightOfCentre } from '../formation.js';
import type { Vec2 } from '../paths.js';
import type { PlayerState } from '../player.js';
import { shipAnchors } from '../player.js';
import type { AbilityModule } from './registry.js';

/**
 * The engine ability a path's `trigger` segment names to open the beam.
 *
 * Typed against the fixed registry in `schema.ts`, so renaming the registry entry
 * is a build error here rather than a mechanic that silently stops happening.
 */
const BEAM_ABILITY: AbilityType = 'captureBeam';

/**
 * The registry's entry: a channel, so no hooks. Everything it does is the
 * exported functions below, which `src/sim/world.ts` and `src/sim/dive.ts` call.
 */
export const captureBeam: AbilityModule<'captureBeam'> = Object.freeze({ type: 'captureBeam' });

/**
 * Where the one channel is.
 *
 * The arcade keeps this in a single byte, and `cflag != 0` is every phase but
 * `idle` — which is the whole of rule 1 above.
 *
 * ```
 * idle ──(a captor launch, every nth, a captive slot free)──▶ diving
 * diving ──(the path's captureBeam trigger)──▶ beam
 * diving ──(captor killed, or its dive ended)──▶ idle
 * beam ──(captor shot)──▶ idle
 * beam ──(retracted without connecting)──▶ idle
 * beam ──(caught the fighter)──▶ carrying        [fire disabled; the stick is ignored]
 * carrying ──(captor shot: too late to rescue)──▶ idle, the fighter lost
 * carrying ──(parked in the captor's captive slot)──▶ held, the fighter lost
 * held ──(captor shot while the captive is attacking)──▶ docking ──▶ dual
 * held ──(captor shot while the captive is in formation)──▶ rogue
 * held | rogue ──(the captive is shot: 500 / 1,000)──▶ idle
 * dual ──(either half lost)──▶ idle
 * ```
 */
export type CapturePhase =
  'idle' | 'diving' | 'beam' | 'carrying' | 'held' | 'rogue' | 'docking' | 'dual';

/** Phases in which a fighter is held, one way or another. */
const HOLDING: ReadonlySet<CapturePhase> = new Set<CapturePhase>([
  'held',
  'rogue',
  'docking',
  'dual',
]);

/**
 * Everything the capture channel carries.
 *
 * A plain value with no closures, so a replay can fingerprint it — which matters
 * more here than almost anywhere else, because the launch counter and the phase
 * decide whether a beam ever appears again.
 */
export interface CaptureState {
  phase: CapturePhase;
  /**
   * Eligible captor launches so far, pre-incremented.
   *
   * Only advanced while the channel is idle, because that is where the arcade's
   * own counter sits — behind the flag test. With `everyNthLaunch` of 2 it is
   * what makes the *first* captor launch of a game never a capture attempt.
   */
  launches: number;
  /** The captor's enemy id while an attempt is live — the arcade's `cobj`. */
  captorId: number | undefined;
  /**
   * The captor's **formation slot**, from `held` onward.
   *
   * By slot rather than by enemy id on purpose: a held fighter outlives the stage
   * it was taken in, and every enemy is built anew each stage. The arcade
   * addresses the pair the same way round — the captive slot falls out of the
   * boss's object index arithmetically (reference section 7).
   */
  captorSlot: number | undefined;
  /** Index into the formation's captive slots: where the fighter parks. */
  captiveSlot: number | undefined;
  /** The captured fighter's enemy id, from `held` onward. */
  captiveId: number | undefined;

  /** Frames between beam steps, from the stage's difficulty row. */
  stepFrames: number;
  /** Frames until the next beam step. */
  stepTimer: number;
  /** Extension, 0 to `beam.steps`. */
  beamStep: number;
  /** Steps spent at full extension so far. */
  beamHeld: number;
  beamRetracting: boolean;

  /** Steps of the pull-in done so far, 0 to `carrySteps`. */
  carryStep: number;
  /** Where the fighter was when the beam caught it, so the drag is a straight line. */
  carryFrom: Vec2 | undefined;

  /** Frames the rogue has sat in its slot this stage. */
  rogueTimer: number;
  /** True once the rogue has taken its one dive this stage. */
  rogueDived: boolean;
  /** True while the captive is out attacking alongside its captor. */
  escorting: boolean;

  /**
   * Frames left of the freed fighter's spin, where it is right now, and where it
   * was freed.
   *
   * It is no longer an enemy from the moment it is freed — that is how "invulnerable
   * to your own shots while it spins" is implemented — so this pose is the only
   * thing left to draw it from, and it glides from one to the other as it docks.
   */
  dockTimer: number;
  freedAt: Vec2 | undefined;
  freedFrom: Vec2 | undefined;
}

/** Build the channel for a new game, on `stage`. */
export function createCaptureState(rules: Rules, stage: number, rank?: string): CaptureState {
  return {
    phase: 'idle',
    launches: 0,
    captorId: undefined,
    captorSlot: undefined,
    captiveSlot: undefined,
    captiveId: undefined,
    stepFrames: beamStepFramesFor(rules, stage, rank),
    stepTimer: 0,
    beamStep: 0,
    beamHeld: 0,
    beamRetracting: false,
    carryStep: 0,
    carryFrom: undefined,
    rogueTimer: 0,
    rogueDived: false,
    escorting: false,
    dockTimer: 0,
    freedAt: undefined,
    freedFrom: undefined,
  };
}

/**
 * The beam step period stage `n` resolves to.
 *
 * Read from the stage's difficulty row through `src/content/rules.ts`, like every
 * other number that varies by stage — this file interprets no row of its own.
 */
function beamStepFramesFor(rules: Rules, stage: number, rank?: string): number {
  return resolveBeamStepFrames(resolveDifficultyRow(rules, stage, rank));
}

/* -------------------------------------------------------------------------- */
/* What the rest of the simulation asks of the channel                          */
/* -------------------------------------------------------------------------- */

/** Is a fighter held — captured, parked as a rogue, spinning free, or dual? */
export function holdsFighter(state: CaptureState): boolean {
  return HOLDING.has(state.phase);
}

/**
 * Is the beam dragging the fighter?
 *
 * While it is, the stick does nothing: the ship is being pulled, not flown. The
 * world skips `stepPlayer` rather than this file overriding a movement it just
 * made.
 */
export function beamHasFighter(state: CaptureState): boolean {
  return state.phase === 'carrying';
}

/**
 * Is a beam out over the playfield — extended, or already dragging the fighter?
 *
 * Asked by `resolveRespawn` in `src/sim/world.ts`, and the reason it has to be
 * asked at all is that a capture attempt is a **committed swoop**: the captor
 * takes its aim once, at the frame its `aimAtPlayer` segment begins, and opens
 * its beam where that aim pointed whatever has happened since. Destroy the
 * fighter in between — a bomb, a body, anything — and the beam still comes out
 * over the column the fighter died in, and holds there for the rest of its
 * extend/hold/retract cycle.
 *
 * The replacement fighter arrives at a *fixed* column (`startX`), so it can
 * materialise inside that window with no frame in which to move: the catch test
 * runs on the very step it arrives. The channel is right to still be busy — the
 * arcade's capture flag is not cleared by the player dying, and
 * `docs/reference/arcade-reference.md` section 7 enumerates every ROM write that
 * does clear it — so this is not a release. It is the *other* half: a fighter
 * does not walk onto the field underneath a beam that is already open.
 *
 * **Provisional.** The reference does not cover what a replacement fighter does
 * while a beam is out; this is the player-favourable reading, and it is bounded
 * because a beam that catches nothing always retracts and releases.
 */
export function beamIsOut(state: CaptureState): boolean {
  return state.phase === 'beam' || state.phase === 'carrying';
}

/**
 * May the player fire?
 *
 * "Once the boss has connected with your ship, your fire is disabled" — the
 * arcade has a routine whose name says exactly that (reference section 7). Small
 * detail, strongly felt: the moment you are caught you cannot shoot your way out.
 */
export function captureAllowsFire(state: CaptureState, rules: Rules): boolean {
  return !(rules.capture.disablesFireWhileBeamed && beamHasFighter(state));
}

/**
 * The beam's catch window right now, measured from the captor's anchor, or
 * `undefined` when no beam is out.
 *
 * The window is the pack's at full extension and its reach is scaled by how far
 * the beam has got, so a beam that has not reached the fighter's row cannot take
 * it — and the renderer draws the same shape it is tested against.
 */
export function beamWindow(state: CaptureState, rules: Rules): HitWindow | undefined {
  if (state.phase !== 'beam' && state.phase !== 'carrying') return undefined;
  const { steps, catchWindow: full } = rules.capture.beam;
  const extent = Math.min(1, Math.max(0, state.beamStep / Math.max(1, steps)));
  return { ...full, dyMax: full.dyMin + (full.dyMax - full.dyMin) * extent };
}

/** The captor holding the beam, or `undefined`. For the renderer and for tests. */
export function beamCaptor(state: CaptureState, fleet: Fleet): Enemy | undefined {
  if (state.captorId === undefined) return undefined;
  return fleet.enemies.find((enemy) => enemy.id === state.captorId && enemy.state !== 'dead');
}

/** The captured fighter on the field, or `undefined`. */
export function capturedFighter(state: CaptureState, fleet: Fleet): Enemy | undefined {
  if (state.captiveId === undefined) return undefined;
  return fleet.enemies.find((enemy) => enemy.id === state.captiveId && enemy.state !== 'dead');
}

/**
 * The enemy holding the captured fighter, or `undefined`.
 *
 * Addressed by **formation slot** rather than by enemy, because that is how the
 * pairing survives a stage change — see {@link CaptureState.captorSlot}. This is
 * the enemy to shoot for a rescue, so a renderer, a test or a recorded pilot all
 * need the same answer.
 */
export function captorOfCaptive(state: CaptureState, fleet: Fleet): Enemy | undefined {
  if (state.captorSlot === undefined) return undefined;
  return fleet.enemies.find(
    (enemy) => enemy.home === state.captorSlot && !enemy.inCaptiveSlot && enemy.state !== 'dead',
  );
}

/* -------------------------------------------------------------------------- */
/* Choosing a captor: the gate rule 1 is about                                  */
/* -------------------------------------------------------------------------- */

/**
 * Turn this captor-role launch into a capture attempt, or leave it an ordinary
 * dive. Returns the path the attempt flies, or `undefined`.
 *
 * Called by the attack director on every launch of the role the pack names as its
 * captor, and it is the only place a captor is chosen. Four gates, all the
 * arcade's:
 *
 * - the channel is **idle** — the flag, and therefore the whole of "no second
 *   capture while one is held, none while parked as a rogue, and never against a
 *   dual fighter";
 * - the pack's own cap on how many may be held at once;
 * - only every `everyNthLaunch`th eligible launch, pre-incremented, so the first
 *   captor launch of a game never carries a beam;
 * - the captor has a captive slot to park a fighter in.
 */
export function beginCaptureDive(
  state: CaptureState,
  rules: Rules,
  formation: FormationState,
  enemy: Enemy,
): string | undefined {
  const { capture } = rules;
  if (!capture.enabled) return undefined;
  // The arcade's `cflag`: while it is set, no capture boss is ever selected.
  if (state.phase !== 'idle') return undefined;
  // And the pack's cap, which for this one channel is 0 (never) or 1.
  if (capture.maxHeldTotal === 0) return undefined;

  const { captorRole, divePath } = capture;
  if (captorRole === undefined || divePath === undefined) return undefined;
  if (enemy.role !== captorRole || enemy.inCaptiveSlot) return undefined;

  const captiveSlot = captiveSlotOf(formation, enemy.home);
  if (captiveSlot === undefined) return undefined;

  state.launches += 1;
  if (state.launches % capture.everyNthLaunch !== 0) return undefined;

  state.phase = 'diving';
  state.captorId = enemy.id;
  state.captiveSlot = captiveSlot;
  return divePath;
}

/* -------------------------------------------------------------------------- */
/* Stepping the channel                                                         */
/* -------------------------------------------------------------------------- */

export interface CaptureContext {
  readonly fleet: Fleet;
  readonly content: StageContent;
  readonly formation: FormationState;
  readonly rules: Rules;
  /** Which stage is playing. Read only to ask whether anything may attack on it. */
  readonly stage: number;
  readonly player: PlayerState;
  readonly rng: Rng;
  /** `trigger` segments the fleet's flights passed through on this frame. */
  readonly triggered: readonly ScriptedTrigger[];
  /** The fighter's anchor, or `undefined` while it is off the field. */
  readonly playerAt: Vec2 | undefined;
}

/** What one step of the channel did, for the world to turn into events. */
export interface CaptureStep {
  /** The captor that opened its beam on this frame. */
  readonly beamStarted: Enemy | undefined;
  /** An attempt ended on this frame with the fighter untouched. */
  readonly failed: boolean;
  /** The fighter was taken on this frame. The world decides what it costs. */
  readonly captured: boolean;
  /** The captured fighter was freed on this frame, at this position. */
  readonly rescued: Vec2 | undefined;
  /** The freed fighter docked on this frame; the fighter is dual from here. */
  readonly docked: boolean;
  /** The captive began a dive on this frame — escorting its captor, or as a rogue. */
  readonly dived: Enemy | undefined;
}

const NOTHING_HAPPENED: CaptureStep = Object.freeze({
  beamStarted: undefined,
  failed: false,
  captured: false,
  rescued: undefined,
  docked: false,
  dived: undefined,
});

/**
 * Advance the channel by one frame.
 *
 * Stepped after the fleet, because everything here is measured from where the
 * captor has just flown to: the beam's origin, the catch test and the drag all
 * read the captor's current anchor.
 */
export function stepCapture(state: CaptureState, ctx: CaptureContext): CaptureStep {
  switch (state.phase) {
    case 'diving':
      return stepDiving(state, ctx);
    case 'beam':
      return stepBeam(state, ctx);
    case 'carrying':
      return stepCarry(state, ctx);
    case 'held':
      return stepHeld(state, ctx);
    case 'rogue':
      return stepRogue(state, ctx);
    case 'docking':
      return stepDocking(state, ctx);
    default:
      return NOTHING_HAPPENED;
  }
}

/**
 * The captor is on its way down, beam not yet out.
 *
 * Two exits: the path's `captureBeam` trigger, or the attempt falling apart. The
 * second is the arcade's "the capture boss stops diving before reaching beam
 * position" release, and it covers being shot, the dive ending, and the captor
 * having somehow left the field.
 */
function stepDiving(state: CaptureState, ctx: CaptureContext): CaptureStep {
  const captor = beamCaptor(state, ctx.fleet);
  if (captor === undefined || captor.state !== 'diving') {
    releaseCapture(state);
    return { ...NOTHING_HAPPENED, failed: true };
  }

  const trigger = ctx.triggered.find(
    (event) => event.enemy.id === captor.id && event.ability === BEAM_ABILITY,
  );
  if (trigger === undefined) return NOTHING_HAPPENED;

  state.phase = 'beam';
  state.beamStep = 0;
  state.beamHeld = 0;
  state.beamRetracting = false;
  state.stepTimer = state.stepFrames;
  // The captor holds position for as long as the beam is out. `beaming` is a
  // state `stepFleet` does not advance, so its flight resumes from this frame.
  captor.state = 'beaming';
  return { ...NOTHING_HAPPENED, beamStarted: captor };
}

/**
 * The beam is out: extend, hold, retract — one step per period — and test for the
 * fighter every frame.
 *
 * The catch test comes after the step so a beam that reaches full extension on
 * this frame can take the fighter on this frame.
 */
function stepBeam(state: CaptureState, ctx: CaptureContext): CaptureStep {
  const captor = beamCaptor(state, ctx.fleet);
  if (captor === undefined || captor.state !== 'beaming') {
    // Shot while the beam was out — one of the arcade's three failure exits.
    releaseCapture(state);
    return { ...NOTHING_HAPPENED, failed: true };
  }

  const { steps, holdSteps } = ctx.rules.capture.beam;
  state.stepTimer -= 1;
  if (state.stepTimer <= 0) {
    state.stepTimer = state.stepFrames;
    if (state.beamRetracting) {
      state.beamStep -= 1;
      if (state.beamStep <= 0) {
        // Retracted without connecting. The captor flies on, and the channel is
        // free for another attempt.
        captor.state = 'diving';
        releaseCapture(state);
        return { ...NOTHING_HAPPENED, failed: true };
      }
    } else if (state.beamStep < steps) {
      state.beamStep += 1;
    } else if (state.beamHeld < holdSteps) {
      state.beamHeld += 1;
    } else {
      state.beamRetracting = true;
    }
  }

  if (!caught(state, ctx, captor)) return NOTHING_HAPPENED;

  state.phase = 'carrying';
  state.carryStep = 0;
  state.carryFrom = [ctx.player.x, ctx.player.y];
  state.stepTimer = state.stepFrames;
  return NOTHING_HAPPENED;
}

/** Is the fighter inside the beam? */
function caught(state: CaptureState, ctx: CaptureContext, captor: Enemy): boolean {
  if (!ctx.player.alive) return false;
  const beam = beamWindow(state, ctx.rules);
  if (beam === undefined) return false;
  return shipAnchors(ctx.player, ctx.rules).some((anchor) => withinWindow(captor, anchor, beam));
}

/**
 * The beam has the fighter and is dragging it to the captive slot.
 *
 * The drag is paced by the same countdown as the extension — the arcade reuses
 * the one byte for both, which is why a late beam pulls as much faster as it
 * extends. Killing the captor here is **too late to rescue**: the arcade's own
 * comment says the captured-ship object is not yet in a rescuable state, so the
 * fighter is simply lost (report acceptance test R10).
 */
function stepCarry(state: CaptureState, ctx: CaptureContext): CaptureStep {
  const captor = beamCaptor(state, ctx.fleet);
  const target = captiveTarget(state, ctx);
  if (captor === undefined || target === undefined) {
    releaseCapture(state);
    return { ...NOTHING_HAPPENED, captured: true };
  }

  const { carrySteps } = ctx.rules.capture;
  state.stepTimer -= 1;
  if (state.stepTimer <= 0) {
    state.stepTimer = state.stepFrames;
    state.carryStep += 1;
  }

  const from = state.carryFrom ?? [ctx.player.x, ctx.player.y];
  const travelled = Math.min(1, state.carryStep / carrySteps);
  ctx.player.x = Math.round(from[0] + (target.x - from[0]) * travelled);
  ctx.player.y = Math.round(from[1] + (target.y - from[1]) * travelled);

  if (state.carryStep < carrySteps) return NOTHING_HAPPENED;

  park(state, ctx, captor);
  return { ...NOTHING_HAPPENED, captured: true };
}

/** Where the captive slot is right now. */
function captiveTarget(
  state: CaptureState,
  ctx: CaptureContext,
): { readonly x: number; readonly y: number } | undefined {
  if (state.captiveSlot === undefined) return undefined;
  return homePosition(ctx.formation, ctx.rules, state.captiveSlot, true);
}

/**
 * The fighter arrives in the captive slot and becomes the captured fighter: an
 * enemy in the formation, in the row above its captor.
 *
 * The captor stops holding and flies the rest of its dive from here — its flight
 * was paused, not thrown away.
 */
function park(state: CaptureState, ctx: CaptureContext, captor: Enemy): void {
  captor.state = 'diving';
  state.phase = 'held';
  state.captorSlot = captor.home;
  state.captorId = undefined;
  state.carryFrom = undefined;
  state.beamStep = 0;
  // Counted as already escorting the dive it was taken on: a fighter that has this
  // instant been dragged into the formation does not turn round and follow its
  // captor back down. It escorts the captor's *next* dive.
  state.escorting = true;

  const alien = captiveAlien(ctx.rules, ctx.content);
  if (alien === undefined || state.captiveSlot === undefined) return;
  const at = homePosition(ctx.formation, ctx.rules, state.captiveSlot, true);
  const captive = addEnemy(ctx.fleet, alien, ctx.rules, {
    home: state.captiveSlot,
    inCaptiveSlot: true,
    at: [at.x, at.y],
    state: 'home',
  });
  state.captiveId = captive.id;
}

/** The alien a captured fighter becomes, from the pack. */
function captiveAlien(rules: Rules, content: StageContent) {
  const id = rules.capture.captiveAlien;
  return id === undefined ? undefined : content.aliens.get(id);
}

/**
 * A fighter is held: it sits in its captive slot, and it attacks **with its
 * captor**.
 *
 * That pairing is what makes the manual's rescue condition — "destroy the boss
 * while they are both attacking your current fighter" — reachable at all, and it
 * is what the rescue test reads (`src/sim/world.ts` calls
 * {@link captureNoteDestroyed}).
 */
function stepHeld(state: CaptureState, ctx: CaptureContext): CaptureStep {
  const captive = capturedFighter(state, ctx.fleet);
  const captor = captorOfCaptive(state, ctx.fleet);
  if (captive === undefined || captor === undefined) return NOTHING_HAPPENED;

  const captorAttacking = captor.state === 'diving' || captor.state === 'beaming';
  if (!captorAttacking) state.escorting = false;
  if (!captorAttacking || state.escorting || captive.state !== 'home') return NOTHING_HAPPENED;

  const dived = launchCaptive(ctx, captive);
  if (dived === undefined) return NOTHING_HAPPENED;
  state.escorting = true;
  return { ...NOTHING_HAPPENED, dived };
}

/**
 * A rogue fighter: its captor was destroyed while in formation, so nothing holds
 * it in place any more.
 *
 * It takes **one** dive per stage and then leaves the bottom for good, re-entering
 * as the last ship of the next stage's wave (reference section 7). The delay
 * before it goes is what makes parking a rogue a technique rather than a
 * punishment: there is time to shoot it in formation for the standing value.
 */
function stepRogue(state: CaptureState, ctx: CaptureContext): CaptureStep {
  const captive = capturedFighter(state, ctx.fleet);
  if (captive === undefined || state.rogueDived) return NOTHING_HAPPENED;

  state.rogueTimer += 1;
  if (state.rogueTimer < ctx.rules.capture.rogueDelayFrames) return NOTHING_HAPPENED;
  if (captive.state !== 'home') return NOTHING_HAPPENED;

  const dived = launchCaptive(ctx, captive);
  if (dived === undefined) return NOTHING_HAPPENED;
  state.rogueDived = true;
  // A rogue does not come back: it leaves the bottom and is gone for the stage.
  captive.returnsFromDive = false;
  return { ...NOTHING_HAPPENED, dived };
}

/**
 * Send the captured fighter down one of its own dive paths.
 *
 * On a frame the launcher runs, like every other launch: the beam's own countdown
 * ticks every frame, but a *dive* may only begin on the round robin, which is the
 * arcade's cadence and an invariant `tests/unit/dive.test.ts` asserts over the
 * whole attack rather than over the director alone.
 */
function launchCaptive(ctx: CaptureContext, captive: Enemy): Enemy | undefined {
  // Nothing attacks on a challenge stage, and a captured fighter is no exception:
  // it is the one attacker that does not come from the attack director, so the
  // director's own gate does not cover it (`allowsAttacks`).
  if (!allowsAttacks(ctx.rules, ctx.stage)) return undefined;
  if (ctx.fleet.frame % ctx.rules.enemies.updatePhases !== 0) return undefined;
  if (captive.divePaths.length === 0) return undefined;
  const path = ctx.rng.pick(captive.divePaths);
  const mirror = isRightOfCentre(ctx.formation, captive.home, true);
  beginDive(ctx.fleet, captive, ctx.content, ctx.formation, ctx.rules, path, mirror, ctx.playerAt);
  return captive;
}

/**
 * The freed fighter spins where it was released and slides in to join the player.
 *
 * It "is suspended in mid-space spinning … and cannot be destroyed until it joins
 * you" — so it is not an enemy while it travels, and the fighter does not become
 * dual until it arrives (reference section 7). Where it is going is where the
 * second ship is drawn, so it lands exactly where it will sit.
 */
function stepDocking(state: CaptureState, ctx: CaptureContext): CaptureStep {
  const total = Math.max(1, ctx.rules.rescue.dockFrames);
  state.dockTimer -= 1;

  const from = state.freedFrom;
  if (from !== undefined) {
    const travelled = Math.min(1, Math.max(0, (total - state.dockTimer) / total));
    const toX = ctx.player.x + ctx.rules.player.secondShipOffsetX;
    state.freedAt = [
      Math.round(from[0] + (toX - from[0]) * travelled),
      Math.round(from[1] + (ctx.player.y - from[1]) * travelled),
    ];
  }

  if (state.dockTimer > 0) return NOTHING_HAPPENED;
  state.phase = 'dual';
  state.dockTimer = 0;
  state.freedAt = undefined;
  state.freedFrom = undefined;
  ctx.player.mode = 'dual';
  return { ...NOTHING_HAPPENED, docked: true };
}

/* -------------------------------------------------------------------------- */
/* What a kill means to the channel                                             */
/* -------------------------------------------------------------------------- */

/** What destroying an enemy did to the capture channel. */
export interface CaptureKill {
  /** An attempt ended with the fighter untouched. */
  readonly failed: boolean;
  /** The fighter was lost: shot down mid-carry is still a capture. */
  readonly captured: boolean;
  /** The captured fighter was freed, at this position. */
  readonly rescued: Vec2 | undefined;
  /** The captured fighter turned rogue. */
  readonly rogue: boolean;
}

const NO_KILL: CaptureKill = Object.freeze({
  failed: false,
  captured: false,
  rescued: undefined,
  rogue: false,
});

/**
 * Tell the channel an enemy was destroyed by a player shot.
 *
 * Four of the arcade's release sites live here, and they are the interesting ones:
 * shooting the captor before or during the beam (an attempt lost), shooting it
 * mid-carry (too late — the fighter is lost anyway), shooting the **captured
 * fighter** itself (the channel is free again, and the shot scores 500 or 1,000
 * by the ordinary doubling rule), and shooting the captor of a held fighter —
 * which is a rescue if the captive is attacking and creates a rogue if it is not.
 *
 * `priorState` is the state the enemy was in *before* it was marked dead. The
 * caller marks it first on purpose, so a rescue's recall loop cannot drag the
 * captor back into formation, and the rescue condition needs the state it had.
 */
export function captureNoteDestroyed(
  state: CaptureState,
  ctx: Pick<CaptureContext, 'fleet' | 'content' | 'formation' | 'rules' | 'playerAt'>,
  enemy: Enemy,
  priorState: EnemyState,
): CaptureKill {
  if (enemy.id === state.captiveId) {
    // The red captured fighter, shot by its own player. The channel is released,
    // and capture attempts resume.
    releaseCapture(state);
    return NO_KILL;
  }

  const attempting = state.captorId !== undefined && enemy.id === state.captorId;
  if (attempting && (state.phase === 'diving' || state.phase === 'beam')) {
    releaseCapture(state);
    return { ...NO_KILL, failed: true };
  }
  if (attempting && state.phase === 'carrying') {
    releaseCapture(state);
    return { ...NO_KILL, captured: true };
  }

  const holding = state.phase === 'held' || state.phase === 'rogue';
  if (!holding || enemy.inCaptiveSlot || enemy.home !== state.captorSlot) return NO_KILL;

  const captive = capturedFighter(state, ctx.fleet);
  if (captive === undefined) {
    // Its captive already left the field; there is nothing to free.
    state.captorSlot = undefined;
    return NO_KILL;
  }

  const { rescue } = ctx.rules;
  const attacking = captive.state === 'diving';
  // `priorState`, not `enemy.state`: by the time a kill is reported the enemy has
  // already been marked dead, and "was it attacking when it died" is the whole of
  // the rescue condition. Reading the current state here makes a rescue impossible
  // and silently turns every one of them into a rogue.
  const captorAttacking = priorState === 'diving' || priorState === 'beaming';
  const releases =
    rescue.enabled && attacking && (!rescue.requiresCaptorAttacking || captorAttacking);

  if (!releases) {
    // "Destroying the boss while it is in formation turns the captured ship into
    // a rogue fighter." The channel stays busy: parking a rogue does not re-enable
    // capture, which is the arcade behaviour and the point of the technique.
    state.phase = 'rogue';
    state.rogueTimer = 0;
    state.rogueDived = false;
    state.escorting = false;
    return { ...NO_KILL, rogue: true };
  }

  return { ...NO_KILL, rescued: freeCaptive(state, ctx, captive) };
}

/**
 * Free the captured fighter.
 *
 * It leaves the fleet on the spot rather than lingering as a harmless enemy: "it
 * is invulnerable to your shots at this point and cannot be destroyed until it
 * joins you" is exactly a ship that is no longer a target, and holding its pose
 * here is what lets the renderer draw it spinning. Enemies already mid-dive turn
 * round and head back to the formation, which the rules state as a flag because a
 * sibling game's rescue need not be so generous.
 */
function freeCaptive(
  state: CaptureState,
  ctx: Pick<CaptureContext, 'fleet' | 'content' | 'formation' | 'rules' | 'playerAt'>,
  captive: Enemy,
): Vec2 {
  const at: Vec2 = [captive.x, captive.y];
  captive.state = 'dead';
  ctx.fleet.flights.delete(captive.id);

  state.phase = 'docking';
  state.dockTimer = Math.max(1, ctx.rules.rescue.dockFrames);
  state.freedAt = at;
  state.freedFrom = at;
  state.captiveId = undefined;
  state.captorSlot = undefined;
  state.escorting = false;

  if (ctx.rules.rescue.divingEnemiesReturnToFormation) {
    for (const enemy of ctx.fleet.enemies) {
      if (enemy.state !== 'diving' || enemy.inCaptiveSlot) continue;
      // The one homing implementation, started from where the diver is rather
      // than from the top of the screen.
      beginReturn(ctx.fleet, enemy, ctx.content, ctx.formation, ctx.rules, ctx.playerAt, {
        fromHere: true,
      });
    }
  }
  return at;
}

/**
 * Tell the channel a dual fighter lost one of its halves.
 *
 * The last of the arcade's release sites, and the only one that is not a kill: a
 * dual fighter going back to a single one frees the channel, so beams resume
 * (report acceptance test R6).
 */
export function captureNoteHalfLost(state: CaptureState): void {
  if (state.phase === 'dual' || state.phase === 'docking') releaseCapture(state);
}

/**
 * Release the channel — the arcade's `cflag = 0`.
 *
 * The complete set of callers *is* the rule, and it is the list report section 3.2
 * closed by enumerating every write to the flag's byte:
 *
 * | Release | Where |
 * | ------- | ----- |
 * | A new game | {@link createCaptureState} |
 * | The captor killed or its dive ended before the beam | {@link stepDiving}, {@link captureNoteDestroyed} |
 * | The captor shot while the beam is out | {@link stepBeam}, {@link captureNoteDestroyed} |
 * | The beam retracted without connecting | {@link stepBeam} |
 * | The captor shot while carrying the fighter | {@link stepCarry}, {@link captureNoteDestroyed} |
 * | The captured fighter shot | {@link captureNoteDestroyed} |
 * | A dual fighter losing either half | {@link captureNoteHalfLost} |
 *
 * A successful capture is **not** on that list, which is the whole of rule 1. One
 * further arcade release — the rescue landing's "wings closed" sub-case — is
 * deliberately not modelled: report section 3.2 could not construct a state that
 * reaches it, and it is a rescue-timing corner rather than a second channel.
 */
function releaseCapture(state: CaptureState): void {
  state.phase = 'idle';
  state.captorId = undefined;
  state.captorSlot = undefined;
  state.captiveSlot = undefined;
  state.captiveId = undefined;
  state.beamStep = 0;
  state.beamHeld = 0;
  state.beamRetracting = false;
  state.stepTimer = 0;
  state.carryStep = 0;
  state.carryFrom = undefined;
  state.rogueTimer = 0;
  state.rogueDived = false;
  state.escorting = false;
  state.dockTimer = 0;
  state.freedAt = undefined;
  state.freedFrom = undefined;
}

/* -------------------------------------------------------------------------- */
/* Crossing a stage boundary                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Carry the channel into a new stage, re-inserting a held fighter.
 *
 * "A captured fighter stays with that particular enemy COMMAND SHIP for the rest
 * of the game" — it is not released at stage end. It comes back as the **last**
 * ship of the new stage's entry wave and takes its place at the top of the
 * formation, which is both the arcade behaviour and the reason parking a rogue
 * works across stages. The captor is addressed by slot, so the new stage's enemy
 * in that slot inherits the pairing.
 *
 * An attempt still in the air cannot outlive the stage that started it: a stage
 * only ends when the fleet is clear, and an attempt implies a live captor.
 */
export function enterStageCapture(
  state: CaptureState,
  ctx: Pick<CaptureContext, 'fleet' | 'content' | 'formation' | 'rules'>,
  stage: number,
  rank?: string,
): void {
  state.stepFrames = beamStepFramesFor(ctx.rules, stage, rank);
  if (state.phase === 'diving' || state.phase === 'beam' || state.phase === 'carrying') {
    releaseCapture(state);
    return;
  }
  if (state.phase !== 'held' && state.phase !== 'rogue') return;

  state.rogueTimer = 0;
  state.rogueDived = false;
  state.escorting = false;
  // Enemy ids are per stage: every stage builds its fleet anew, so the id the
  // captive had is now some other enemy's. Cleared before anything can look it
  // up, and set again below only if a captive is actually put on the field —
  // otherwise a challenge flyer that inherited the number would answer to
  // {@link capturedFighter}, and shooting it would release the channel.
  state.captiveId = undefined;

  // **It sits out a challenge stage.** Nothing settles into formation there and
  // nothing attacks, so a stolen fighter joining the wave would be the one enemy
  // on screen that does both. It is still held — the channel does not move — and
  // it comes back with the next stage that has a formation to come back to.
  if (!allowsAttacks(ctx.rules, stage)) return;

  const alien = captiveAlien(ctx.rules, ctx.content);
  const { captiveSlot } = state;
  if (alien === undefined || captiveSlot === undefined) return;

  const last = lastEntry(ctx.content);
  if (last === undefined) return;
  const captive = addEnemy(ctx.fleet, alien, ctx.rules, {
    home: captiveSlot,
    inCaptiveSlot: true,
    pathId: last.path,
    launchFrame: last.frame,
    state: 'standby',
  });
  state.captiveId = captive.id;
}

/**
 * The entry path and launch frame one step behind the last ship of the stage.
 *
 * Read off the stage's own waves so the captive arrives the way everything else
 * does, rather than on a schedule invented here.
 */
function lastEntry(
  content: StageContent,
): { readonly path: string; readonly frame: number } | undefined {
  let best: { path: string; frame: number } | undefined;
  for (const wave of content.stage.waves) {
    const frames = waveLaunchFrames(wave);
    wave.slots.forEach((slot, index) => {
      const frame = (frames[index] ?? wave.at) + wave.spacing;
      const path = slot.path ?? wave.entryPath;
      if (path === undefined) return;
      if (best === undefined || frame > best.frame) best = { path, frame };
    });
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Fingerprint                                                                  */
/* -------------------------------------------------------------------------- */

/** A single comparable value for the channel, for the golden replays. */
export function captureFingerprint(state: CaptureState): readonly unknown[] {
  return [
    state.phase,
    state.launches,
    state.captorId ?? -1,
    state.captorSlot ?? -1,
    state.captiveSlot ?? -1,
    state.captiveId ?? -1,
    state.stepFrames,
    state.stepTimer,
    state.beamStep,
    state.beamHeld,
    state.beamRetracting,
    state.carryStep,
    state.carryFrom ?? null,
    state.rogueTimer,
    state.rogueDived,
    state.escorting,
    state.dockTimer,
    state.freedAt ?? null,
    state.freedFrom ?? null,
  ];
}
