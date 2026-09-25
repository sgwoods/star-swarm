/**
 * A static formation stand-in — Milestone 1 scaffolding, and nothing more.
 *
 * The playable core needs *something* for the player's shots to hit and
 * something to shoot back, but real enemies are Milestone 2: entry waves, slot
 * homing, sway and breathe, dive attacks, capture. So this file provides a grid
 * of motionless targets that hold still, absorb hits and fire on a fixed
 * cadence. It deliberately does not model any of the behaviour Milestone 2 owns.
 *
 * What it *does* get right is the shape of the data, so replacing it is a
 * substitution rather than a rewrite: every target carries its own hit padding,
 * its own score value and its own inter-shot delay, and the collision code reads
 * those rather than constants.
 *
 * The column layout follows the original's home-slot table (bosses at columns
 * 6, 8, 10, 12; butterfly-role rows inset one column position from the bee-role
 * rows), so the stand-in occupies roughly the right part of the screen and the
 * hit windows are exercised at realistic spacings.
 */

import type { Rng } from '../engine/rng.js';
import type { HitPadding } from './collision.js';

/** The three classic roles, under the project's own naming (section 2). */
export type TargetRole = 'drone' | 'wing' | 'warden';

export interface Target {
  readonly id: number;
  readonly role: TargetRole;
  x: number;
  y: number;
  /** Hits left before it dies. Wardens take two, as bosses do. */
  hitsRemaining: number;
  alive: boolean;
  /** Points for destroying it, from the target's data rather than a table. */
  readonly score: number;
  /** How much this target widens the shot window tested against it. */
  readonly hitPadding: HitPadding;
  /** Steps between this target's shots; `0` means it never fires. */
  readonly fireIntervalSteps: number;
  /** Counts down to the next shot. Seeded, so the cadence is reproducible. */
  fireTimer: number;
}

export interface FormationLayout {
  /** Playfield column of grid column 0. */
  readonly originX: number;
  /** Playfield row of the top grid row. */
  readonly originY: number;
  /** Pixels per grid column position. */
  readonly columnPitch: number;
  /** Pixels per grid row. */
  readonly rowPitch: number;
}

/** Roughly the original's home-slot geometry, scaled to the 224-px playfield. */
export const STAND_IN_LAYOUT: FormationLayout = Object.freeze({
  originX: 16,
  originY: 40,
  columnPitch: 10,
  rowPitch: 16,
});

/** Per-role stand-in data. Milestone 2 reads the real thing from a pack. */
interface RoleSpec {
  readonly role: TargetRole;
  readonly hits: number;
  readonly score: number;
  readonly hitPadding: HitPadding;
  readonly fireIntervalSteps: number;
}

const ROLE_SPECS: Readonly<Record<TargetRole, RoleSpec>> = Object.freeze({
  // Formation scores, per the verified table: bee-role 50, butterfly-role 80,
  // boss 150. Diving doubles them, and diving is Milestone 2's problem.
  drone: {
    role: 'drone',
    hits: 1,
    score: 50,
    hitPadding: { x: 0, y: 0 },
    fireIntervalSteps: 240,
  },
  wing: {
    role: 'wing',
    hits: 1,
    score: 80,
    hitPadding: { x: 0, y: 0 },
    fireIntervalSteps: 300,
  },
  warden: {
    role: 'warden',
    hits: 2,
    score: 150,
    // A warden is the boss role, and a shade larger than the rest.
    hitPadding: { x: 1, y: 1 },
    fireIntervalSteps: 420,
  },
});

/** Grid column positions per row, from the original's home-slot table. */
const ROWS: readonly { readonly role: TargetRole; readonly columns: readonly number[] }[] =
  Object.freeze([
    { role: 'warden', columns: [6, 8, 10, 12] },
    { role: 'wing', columns: [2, 4, 6, 8, 10, 12, 14, 16] },
    { role: 'wing', columns: [2, 4, 6, 8, 10, 12, 14, 16] },
    { role: 'drone', columns: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18] },
    { role: 'drone', columns: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18] },
  ]);

export interface StandInOptions {
  readonly layout?: FormationLayout;
  /** Scales every target's inter-shot delay; `0` disables enemy fire entirely. */
  readonly fireRate?: number;
}

/**
 * The stand-in's default fire-rate scale.
 *
 * It is a constant here rather than a rule because the stand-in is not a game:
 * all 40 targets sit still and fire straight down, which at their nominal rates
 * is far deadlier than the real thing, so the default holds them well back.
 * Milestone 2 deletes the stand-in and drives enemy fire from the per-stage
 * difficulty table the pack already carries, and this goes with it.
 */
export const STAND_IN_FIRE_RATE = 0.1;

/**
 * Build the stand-in formation.
 *
 * `rng` staggers the initial fire timers. It is a seeded generator from
 * `src/engine/rng.ts`, so the whole formation — including who shoots when — is
 * part of what a replay reproduces.
 */
export function createStandInFormation(rng: Rng, options: StandInOptions = {}): Target[] {
  const layout = options.layout ?? STAND_IN_LAYOUT;
  const fireRate = options.fireRate ?? 1;
  const targets: Target[] = [];
  let id = 0;

  ROWS.forEach((row, rowIndex) => {
    const spec = ROLE_SPECS[row.role];
    for (const column of row.columns) {
      const interval =
        fireRate <= 0 ? 0 : Math.max(1, Math.round(spec.fireIntervalSteps / fireRate));
      targets.push({
        id: id++,
        role: spec.role,
        x: layout.originX + column * layout.columnPitch,
        y: layout.originY + rowIndex * layout.rowPitch,
        hitsRemaining: spec.hits,
        alive: true,
        score: spec.score,
        hitPadding: spec.hitPadding,
        fireIntervalSteps: interval,
        // A seeded stagger, so the formation does not fire in one volley.
        fireTimer: interval === 0 ? 0 : rng.int(1, interval + 1),
      });
    }
  });

  return targets;
}

export function aliveTargets(targets: readonly Target[]): Target[] {
  return targets.filter((target) => target.alive);
}
