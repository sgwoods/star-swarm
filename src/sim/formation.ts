/**
 * The formation: where a settled enemy lives, and how the whole block moves
 * (`docs/DESIGN.md` section 4, "Enemies and formation").
 *
 * **Only the coordinates animate.** A formation is `N` column X values and `M`
 * row Y values — {@link formationAxes} derives them from the pack's slot table —
 * and every enemy addresses them by index. Sway and breathe move those `N + M`
 * numbers and nothing else, so forty enemies follow for free and a differently
 * shaped formation inherits both motions without a line of new code. Per-enemy
 * offsets would be forty times the work and would drift apart; this is both why
 * the arcade original can afford the motion and what makes it exact
 * (`docs/reference/arcade-reference.md` section 5).
 *
 * Two motions, and they never overlap:
 *
 * - **Sway**, while entry waves are still arriving: every column coordinate moves
 *   together, rows hold still, direction reverses at ±`amplitude`. It ends when
 *   the last wave has arrived *and* the offset passes back through zero, so
 *   whatever comes next starts from an exactly centred formation.
 * - **Breathe**, once the formation is full: an accordion that moves each
 *   coordinate by its own signed displacement, out and back.
 *
 * Every number comes from the rules the pack supplied. There are no constants
 * here, which is the rule `AGENTS.md` states: a number the simulation needs that
 * is not in `rules.json` is a number no pack can change.
 */

import type { Formation, Rules, StageKind } from '../content/schema.js';
import { DEFAULT_FORMATION_GRID, formationAxes } from '../content/schema.js';

/** Which motion, if any, a formation is running. */
export type FormationMotion = 'sway' | 'breathe' | 'still';

export interface FormationState {
  /** Column coordinate at rest, one per distinct column index, left to right. */
  readonly columnsAtRest: readonly number[];
  /** Row coordinate at rest, one per distinct row index, top to bottom. */
  readonly rowsAtRest: readonly number[];
  /** Slot index → index into {@link columnsAtRest}. */
  readonly slotColumn: readonly number[];
  /** Slot index → index into {@link rowsAtRest}. */
  readonly slotRow: readonly number[];
  /** Captive-slot index → the same two axes. */
  readonly captiveColumn: readonly number[];
  readonly captiveRow: readonly number[];

  /** Frames since the stage began. The only clock this module has. */
  frame: number;
  motion: FormationMotion;

  /** Pixels the columns are displaced by, and which way the sway is heading. */
  swayOffset: number;
  swayDirection: 1 | -1;
  /**
   * Set once every wave has arrived. The sway does not stop here — it stops the
   * next time the offset reaches zero, which is what guarantees a centred
   * formation rather than one frozen mid-swing.
   */
  entryComplete: boolean;

  /** Breathe phase, `0` at rest up to `breathe.steps` fully expanded. */
  breatheStep: number;
  breatheDirection: 1 | -1;
}

/** Nothing moves: a stage kind the rules exclude, or rules stating no motion. */
function motionAllowed(rules: Rules, kind: StageKind): boolean {
  return rules.formation.animatedStageKinds.includes(kind);
}

/**
 * Build the formation for one stage.
 *
 * `kind` decides whether it moves at all: the arcade runs neither motion on a
 * challenge stage, because nothing settles into formation there, and the Classic
 * rules say so by leaving `challenge` out of `animatedStageKinds`.
 */
export function createFormation(
  formation: Formation,
  rules: Rules,
  kind: StageKind = 'normal',
): FormationState {
  const grid = formation.grid ?? DEFAULT_FORMATION_GRID;
  const axes = formationAxes(formation);

  const columnsAtRest = axes.columns.map((column) => grid.originX + column * grid.columnSpacing);
  const rowsAtRest = axes.rows.map((row) => grid.originY + row * grid.rowSpacing);
  const columnIndex = new Map(axes.columns.map((column, index) => [column, index]));
  const rowIndex = new Map(axes.rows.map((row, index) => [row, index]));

  // `formationAxes` collected these from the very slots being indexed, so every
  // lookup hits; the `?? 0` is for the type, not for a case that can happen.
  const at = (map: ReadonlyMap<number, number>, key: number): number => map.get(key) ?? 0;

  const sways = motionAllowed(rules, kind) && rules.formation.sway !== undefined;

  return {
    columnsAtRest,
    rowsAtRest,
    slotColumn: formation.slots.map((slot) => at(columnIndex, slot.column)),
    slotRow: formation.slots.map((slot) => at(rowIndex, slot.row)),
    captiveColumn: formation.captiveSlots.map((slot) => at(columnIndex, slot.column)),
    captiveRow: formation.captiveSlots.map((slot) => at(rowIndex, slot.row)),

    frame: 0,
    motion: sways ? 'sway' : 'still',
    swayOffset: 0,
    // The arcade seeds the direction from the flip-screen flag and so starts to
    // the right on an upright cabinet.
    swayDirection: 1,
    entryComplete: false,
    breatheStep: 0,
    breatheDirection: 1,
  };
}

/** How far the columns are displaced by the sway, `frames` frames from now. */
function swayOffsetAhead(state: FormationState, rules: Rules, frames: number): number {
  const sway = rules.formation.sway;
  if (sway === undefined || state.motion !== 'sway') return state.swayOffset;

  // Walk it rather than closing the form: the sway stops on a condition, and a
  // closed form would have to reproduce the stop test anyway. The look-ahead is
  // a fraction of a second, so the loop is a few dozen iterations.
  let offset = state.swayOffset;
  let direction = state.swayDirection;
  const steps =
    Math.floor((state.frame + frames) / sway.stepFrames) -
    Math.floor(state.frame / sway.stepFrames);
  for (let i = 0; i < steps; i += 1) {
    offset += direction * sway.stepPixels;
    if (offset >= sway.amplitude) direction = -1;
    else if (offset <= -sway.amplitude) direction = 1;
  }
  return offset;
}

/** The breathe displacement of one column coordinate at the current phase. */
function breatheColumn(state: FormationState, rules: Rules, index: number): number {
  const breathe = rules.formation.breathe;
  if (breathe === undefined || state.motion !== 'breathe') return 0;
  return scaled(breathe.columns[index] ?? 0, state.breatheStep, breathe.steps);
}

/** The breathe displacement of one row coordinate at the current phase. */
function breatheRow(state: FormationState, rules: Rules, index: number): number {
  const breathe = rules.formation.breathe;
  if (breathe === undefined || state.motion !== 'breathe') return 0;
  return scaled(breathe.rows[index] ?? 0, state.breatheStep, breathe.steps);
}

/**
 * A coordinate's share of its full displacement, in whole pixels.
 *
 * The arcade reaches each coordinate's total by moving it one pixel on the steps
 * a per-coordinate bitmap selects. The bitmaps are ROM data and
 * `docs/DESIGN.md` section 2 bars copying those, so the schedule here is a
 * straight ramp to the same verified total: identical at rest and at full
 * expansion, and evenly spaced in between, which is the property that makes the
 * expansion an accordion rather than a wobble.
 */
function scaled(total: number, step: number, steps: number): number {
  if (steps <= 0) return 0;
  return Math.round((total * step) / steps);
}

/** Where slot `index` is right now, as a sprite anchor. */
export function slotPosition(
  state: FormationState,
  rules: Rules,
  index: number,
): { readonly x: number; readonly y: number } {
  const column = state.slotColumn[index] ?? 0;
  const row = state.slotRow[index] ?? 0;
  return {
    x: (state.columnsAtRest[column] ?? 0) + state.swayOffset + breatheColumn(state, rules, column),
    y: (state.rowsAtRest[row] ?? 0) + breatheRow(state, rules, row),
  };
}

/**
 * Is slot `index` in the right-hand half of the formation?
 *
 * Answered from the slot's **column index** rather than from its pixel x, so the
 * answer cannot flip while the formation sways or breathes — a dive that mirrored
 * one way at launch and the other way a frame later would be a bug nobody could
 * see in a screenshot. With an even number of columns the two halves are equal;
 * with an odd number the middle column counts as the right.
 */
export function isRightOfCentre(state: FormationState, index: number): boolean {
  const column = state.slotColumn[index] ?? 0;
  return column * 2 >= state.columnsAtRest.length - 1;
}

/** Where captive slot `index` is right now. The arcade's row never breathes. */
export function captivePosition(
  state: FormationState,
  rules: Rules,
  index: number,
): { readonly x: number; readonly y: number } {
  const column = state.captiveColumn[index] ?? 0;
  const row = state.captiveRow[index] ?? 0;
  return {
    x: (state.columnsAtRest[column] ?? 0) + state.swayOffset + breatheColumn(state, rules, column),
    y: (state.rowsAtRest[row] ?? 0) + breatheRow(state, rules, row),
  };
}

/**
 * Where slot `index` will be in `frames` frames' time.
 *
 * Used by slot homing: a `toSlot` segment resolves its target when the path
 * compiles, so an enemy homing into a swaying formation has to be told where the
 * slot *will* be when it arrives rather than where it is now. Both motions are
 * deterministic, so this is an answer rather than a guess — and the breathe never
 * runs while anything is still homing, so only the sway is ever in play.
 */
export function slotPositionAhead(
  state: FormationState,
  rules: Rules,
  index: number,
  frames: number,
): { readonly x: number; readonly y: number } {
  const column = state.slotColumn[index] ?? 0;
  const row = state.slotRow[index] ?? 0;
  return {
    x:
      (state.columnsAtRest[column] ?? 0) +
      swayOffsetAhead(state, rules, frames) +
      breatheColumn(state, rules, column),
    y: (state.rowsAtRest[row] ?? 0) + breatheRow(state, rules, row),
  };
}

/**
 * Tell the formation the last wave has arrived.
 *
 * It keeps swaying until the offset next passes through zero — the arcade's own
 * two-part exit, and the reason diving always begins from a centred formation.
 */
export function completeEntry(state: FormationState): void {
  state.entryComplete = true;
}

/** True once the sway has finished and the formation is centred and breathing. */
export function isFormationSettled(state: FormationState): boolean {
  return state.motion !== 'sway';
}

/**
 * Advance the formation by one frame. Returns true on the frame the sway ends,
 * which is the frame the breathe begins and the pulsing-formation sound starts.
 */
export function stepFormation(state: FormationState, rules: Rules): boolean {
  state.frame += 1;

  if (state.motion === 'sway') {
    const sway = rules.formation.sway;
    if (sway === undefined) {
      state.motion = 'still';
      return false;
    }
    if (state.frame % sway.stepFrames !== 0) return false;

    state.swayOffset += state.swayDirection * sway.stepPixels;
    if (state.swayOffset >= sway.amplitude) state.swayDirection = -1;
    else if (state.swayOffset <= -sway.amplitude) state.swayDirection = 1;

    // The arcade's `l_2ADA_done`: the waves are all in *and* the offset is back
    // at zero. Only then does the formation hand over to the breathe.
    if (state.entryComplete && state.swayOffset === 0) {
      state.motion = rules.formation.breathe === undefined ? 'still' : 'breathe';
      return true;
    }
    return false;
  }

  if (state.motion === 'breathe') {
    const breathe = rules.formation.breathe;
    if (breathe === undefined) {
      state.motion = 'still';
      return false;
    }
    if (state.frame % breathe.stepFrames !== 0) return false;
    state.breatheStep += state.breatheDirection;
    if (state.breatheStep >= breathe.steps) state.breatheDirection = -1;
    else if (state.breatheStep <= 0) state.breatheDirection = 1;
  }

  return false;
}
