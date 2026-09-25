import { describe, expect, it } from 'vitest';

import { formationAxes } from '../../src/content/schema.js';
import {
  captivePosition,
  completeEntry,
  createFormation,
  isFormationSettled,
  slotPosition,
  slotPositionAhead,
  stepFormation,
} from '../../src/sim/formation.js';
import { classicFormation, classicRules } from '../helpers/rules.js';

/**
 * The formation's motion, against the parameters
 * `docs/reference/arcade-reference.md` section 5 closed: a ±32 px triangle at
 * 1 px per 4 frames while the waves arrive, then a 256-frame accordion with a
 * different displacement per coordinate, and neither of them on a challenge
 * stage.
 *
 * These are the scout report's motion acceptance tests M1–M5. Every number comes
 * out of the shipped pack rather than being restated here, so a change to
 * `rules.json` shows up as a failure rather than as two numbers quietly agreeing
 * with each other.
 */

const rules = classicRules();
const formation = classicFormation();

/** Step `frames` frames, returning the frame the sway handed over on, or -1. */
function run(state: ReturnType<typeof createFormation>, frames: number): number {
  let settledOn = -1;
  for (let i = 0; i < frames; i += 1) {
    if (stepFormation(state, rules) && settledOn < 0) settledOn = state.frame;
  }
  return settledOn;
}

describe('the coordinate axes', () => {
  it('is ten column values and six row values, as the reference states', () => {
    const axes = formationAxes(formation);
    expect(axes.columns).toHaveLength(10);
    // Six rows, the first of them the captured-fighter row.
    expect(axes.rows).toHaveLength(6);
    expect(axes.rows[0]).toBe(formation.captiveSlots[0]?.row);
  });

  it('lands the columns on the verified 32…176 at a pitch of 16', () => {
    const state = createFormation(formation, rules);
    expect([...state.columnsAtRest]).toEqual([32, 48, 64, 80, 96, 112, 128, 144, 160, 176]);
  });

  it('gives every slot an index into those axes rather than a position of its own', () => {
    const state = createFormation(formation, rules);
    expect(state.slotColumn).toHaveLength(formation.slots.length);
    expect(state.slotRow).toHaveLength(formation.slots.length);
    // The four wardens are the top enemy row; the last drone row is the bottom.
    expect(state.slotRow.slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(state.slotRow[39]).toBe(5);
  });
});

describe('M1 — the entry sway', () => {
  it('is a ±32 px triangle of 1 px every 4 frames, period 512', () => {
    const state = createFormation(formation, rules);
    const offsets: number[] = [];
    for (let i = 0; i < 512; i += 1) {
      stepFormation(state, rules);
      offsets.push(state.swayOffset);
    }

    // 1 px every 4 frames: the offset only changes on a multiple of 4.
    expect(offsets[0]).toBe(0);
    expect(offsets[3]).toBe(1);
    expect(offsets[7]).toBe(2);

    // ±32 and no further, and back where it started after a full period.
    expect(Math.max(...offsets)).toBe(32);
    expect(Math.min(...offsets)).toBe(-32);
    expect(offsets[127]).toBe(32);
    expect(offsets[383]).toBe(-32);
    expect(offsets[511]).toBe(0);

    // A triangle: every step is exactly one pixel, in one direction at a time.
    const steps = new Set(offsets.slice(1).map((value, i) => value - (offsets[i] ?? 0)));
    expect([...steps].sort()).toEqual([-1, 0, 1]);
  });

  it('moves the columns rigidly and leaves the rows alone', () => {
    const state = createFormation(formation, rules);
    const restY = state.rowsAtRest.map((_row, index) => index);
    const before = state.slotRow.map((row) => state.rowsAtRest[row]);
    run(state, 40);

    expect(state.swayOffset).toBe(10);
    // Every column shifted by the same amount…
    for (let slot = 0; slot < formation.slots.length; slot += 1) {
      const column = state.slotColumn[slot] ?? 0;
      expect(slotPosition(state, rules, slot).x).toBe((state.columnsAtRest[column] ?? 0) + 10);
    }
    // …and not one row moved.
    expect(state.slotRow.map((row) => state.rowsAtRest[row])).toEqual(before);
    expect(restY).toHaveLength(6);
  });

  it('carries the captive row with it, since it is one of the columns', () => {
    const state = createFormation(formation, rules);
    const before = captivePosition(state, rules, 0);
    run(state, 40);
    expect(captivePosition(state, rules, 0).x).toBe(before.x + 10);
    expect(captivePosition(state, rules, 0).y).toBe(before.y);
  });
});

describe('M2 — the sway ends centred, and hands over to the breathe', () => {
  it('keeps swaying after the last wave arrives, until the offset passes zero', () => {
    const state = createFormation(formation, rules);
    run(state, 300); // mid-swing
    expect(state.swayOffset).not.toBe(0);

    completeEntry(state);
    expect(isFormationSettled(state)).toBe(false);

    const settledOn = run(state, 600);
    expect(state.swayOffset).toBe(0);
    expect(isFormationSettled(state)).toBe(true);
    // It stops the first time the offset reaches zero, not the first frame after
    // the waves are in: the whole point is a formation that is exactly centred.
    expect(settledOn).toBe(512);
  });

  it('starts the breathe on the very frame the sway ends, from rest', () => {
    const state = createFormation(formation, rules);
    completeEntry(state);
    let settledOn = -1;
    while (settledOn < 0) {
      if (stepFormation(state, rules)) settledOn = state.frame;
    }
    // The offset reaches zero for the first time a half period in.
    expect(settledOn).toBe(256);
    expect(state.motion).toBe('breathe');
    expect(state.swayOffset).toBe(0);
    expect(state.breatheStep).toBe(0);
  });
});

describe('M3 and M4 — the breathe', () => {
  /** A formation already settled and breathing, plus its resting coordinates. */
  function breathing(): ReturnType<typeof createFormation> {
    const state = createFormation(formation, rules);
    completeEntry(state);
    run(state, 256);
    expect(state.motion).toBe('breathe');
    return state;
  }

  it('is a 256-frame cycle of 32 steps out and 32 back', () => {
    const state = breathing();
    const steps: number[] = [];
    for (let i = 0; i < 256; i += 1) {
      stepFormation(state, rules);
      steps.push(state.breatheStep);
    }
    expect(Math.max(...steps)).toBe(32);
    // Fully expanded exactly halfway through, and back at rest at the end.
    expect(steps[127]).toBe(32);
    expect(steps[255]).toBe(0);
    // It never contracts inside the home positions.
    expect(Math.min(...steps)).toBe(0);
  });

  it('takes the outermost columns to the screen edges and back, never inside', () => {
    const state = breathing();
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 256; i += 1) {
      stepFormation(state, rules);
      for (let slot = 0; slot < formation.slots.length; slot += 1) {
        const { x } = slotPosition(state, rules, slot);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    // 32 px each way from 32…176: a 16 px sprite touching both screen edges.
    expect(minX).toBe(0);
    expect(maxX).toBe(rules.playfield.width - 16);
  });

  it('spaces the ten columns evenly at 23 px when fully expanded', () => {
    const state = breathing();
    while (state.breatheStep < 32) stepFormation(state, rules);

    const columns = state.columnsAtRest.map((_value, index) => {
      const slot = state.slotColumn.indexOf(index);
      return slot < 0 ? undefined : slotPosition(state, rules, slot).x;
    });
    // Every column is occupied by a drone row, so all ten resolve.
    expect(columns.every((value) => value !== undefined)).toBe(true);
    const gaps = columns.slice(1).map((value, i) => (value ?? 0) - (columns[i] ?? 0));
    // Pitch 16 becomes 23 — every gap grew by the same 7 px, which is what makes
    // this an accordion rather than a wobble. The centre pair grows by 8.
    expect(gaps).toEqual([23, 23, 23, 23, 24, 23, 23, 23, 23]);
  });

  it('pushes the bottom enemy row down 32 px and never moves the captive row', () => {
    const state = breathing();
    const captiveAtRest = captivePosition(state, rules, 0).y;
    const bottomSlot = 39;
    const bottomAtRest = slotPosition(state, rules, bottomSlot).y;

    while (state.breatheStep < 32) stepFormation(state, rules);

    expect(slotPosition(state, rules, bottomSlot).y).toBe(bottomAtRest + 32);
    expect(captivePosition(state, rules, 0).y).toBe(captiveAtRest);
  });
});

describe('M5 — a challenge stage', () => {
  it('runs neither motion, because the rules leave the kind out', () => {
    expect(rules.formation.animatedStageKinds).not.toContain('challenge');

    const state = createFormation(formation, rules, 'challenge');
    expect(state.motion).toBe('still');
    completeEntry(state);
    const before = slotPosition(state, rules, 0);
    run(state, 600);
    expect(state.swayOffset).toBe(0);
    expect(state.breatheStep).toBe(0);
    expect(slotPosition(state, rules, 0)).toEqual(before);
  });
});

describe('looking ahead, for slot homing', () => {
  it('predicts the sway a flight will arrive into', () => {
    const state = createFormation(formation, rules);
    run(state, 37);

    for (const frames of [1, 4, 17, 60, 200]) {
      const predicted = slotPositionAhead(state, rules, 0, frames);
      const future = createFormation(formation, rules);
      run(future, 37 + frames);
      expect(predicted).toEqual(slotPosition(future, rules, 0));
    }
  });

  it('answers with the position it holds once the sway has stopped', () => {
    const state = createFormation(formation, rules);
    completeEntry(state);
    run(state, 256);
    expect(slotPositionAhead(state, rules, 3, 90)).toEqual(slotPosition(state, rules, 3));
  });
});
