/**
 * What a pack mix is coupled to — the places a set of layered packs meets a
 * rules document it cannot change.
 *
 * `docs/content-guide.md` section 7 lists them for an author; this finds them in
 * a composed registry so the pack manager can show them to a player. They are
 * **not** load errors and not playability failures: every one of them loads,
 * passes `npm run validate-packs` and plays. They are what the game will do that
 * the packs on their own would not have led anyone to expect, and the point of
 * finding them is that a free mix of packs meets all of them
 * (`docs/ROADMAP.md`).
 *
 * Four of the guide's six are findable from the documents alone:
 *
 * | Kind                 | Section | What it means                                                 |
 * | -------------------- | ------- | ------------------------------------------------------------- |
 * | `silent-role`        | 7.1     | a role no difficulty row names never attacks                  |
 * | `breathe`            | 7.2     | a formation's axes do not match the breathe table's lengths   |
 * | `continuous-bombing` | 7.3     | a fleet smaller than the rules' own bombs nonstop sooner      |
 * | `no-capture`         | 7.4     | a formation with captors and no captive slots never captures  |
 *
 * 7.5 is a fact about numbering rather than about a mix — the stage editor says
 * which stage number each row plays as instead — and 7.6 is about a pilot, which
 * no document states.
 *
 * Content-only: nothing here starts the simulation, so it costs a walk over the
 * stage documents and is cheap enough to run on every keypress.
 */

import type { ContentRegistry } from './registry.js';
import { continuousBombingCounts, launchRoles, resolveStageSequence } from './rules.js';
import { formationAxes, type Rules, type Stage } from './schema.js';

/** The four kinds, in the content guide's order. */
export const COUPLING_KINDS = [
  'silent-role',
  'breathe',
  'continuous-bombing',
  'no-capture',
] as const;

export type CouplingKind = (typeof COUPLING_KINDS)[number];

export type Coupling =
  | {
      readonly kind: 'silent-role';
      /** The role id, and the label the composed manifest gives it. */
      readonly role: string;
      readonly label: string;
      readonly stages: readonly string[];
    }
  | {
      readonly kind: 'breathe';
      readonly formation: string;
      readonly columns: number;
      readonly rows: number;
      /** The breathe table's own lengths. */
      readonly tableColumns: number;
      readonly tableRows: number;
      readonly stages: readonly string[];
    }
  | {
      readonly kind: 'continuous-bombing';
      /** The smallest fleet a played stage launches. */
      readonly fleet: number;
      /** The largest formation the pack shipping the rules declares. */
      readonly reference: number;
      /** The live-enemy counts at which the rows turn bombing continuous. */
      readonly min: number;
      readonly max: number;
      readonly stages: readonly string[];
    }
  | {
      readonly kind: 'no-capture';
      readonly formation: string;
      readonly stages: readonly string[];
    };

/**
 * Every combat stage the composed packs play, at any rank, in first-played order.
 *
 * Every rank's sequence, because the difficulty preset can be changed after the
 * packs are chosen and a coupling that only shows at one rank is still the mix's.
 */
export function playedCombatStages(registry: ContentRegistry, rules: Rules): readonly Stage[] {
  const ids: string[] = [];
  const ranks = [undefined, ...Object.keys(rules.difficulty.ranks)];
  for (const rank of ranks) {
    for (const id of resolveStageSequence(registry.manifest, rules, rank).normal.rows) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids
    .map((id) => registry.stages.get(id))
    .filter((stage): stage is Stage => stage !== undefined && stage.kind !== 'challenge');
}

/** How many enemies a stage launches: one per slot its waves fill. */
function fleetOf(stage: Stage): number {
  return stage.waves.reduce((total, wave) => total + wave.slots.length, 0);
}

/**
 * The couplings of a composed registry under its rules, over the combat stages it
 * plays.
 *
 * Not empty for every shipped game: the forged Deep Sea game launches a
 * twenty-six-enemy fleet under rules written for Classic's forty, and
 * `packs/deep-sea/README.md` records what that cost it. A coupling is a fact about
 * a mix, not a fault in one.
 */
export function findCouplings(registry: ContentRegistry, rules: Rules): readonly Coupling[] {
  const stages = playedCombatStages(registry, rules);
  const couplings: Coupling[] = [];

  // 7.1 — roles that never get a launch credit.
  const named = launchRoles(rules);
  const silent = new Map<string, string[]>();
  for (const stage of stages) {
    for (const wave of stage.waves) {
      for (const slot of wave.slots) {
        const role = registry.aliens.get(slot.alien)?.role;
        if (role === undefined || named.has(role)) continue;
        const at = silent.get(role) ?? [];
        if (!at.includes(stage.id)) at.push(stage.id);
        silent.set(role, at);
      }
    }
  }
  for (const [role, at] of silent) {
    couplings.push({
      kind: 'silent-role',
      role,
      label: registry.manifest.roles[role]?.label ?? role,
      stages: at,
    });
  }

  // 7.2 — a formation whose axes do not match the breathe table. Ten columns
  // breathe evenly under a ten-column table; fewer take the first few
  // displacements and breathe lopsidedly, more leave the extras still. Rows may
  // be fewer than the table — the guide's "no more than" — but not more.
  const breathe = rules.formation.breathe;
  const animated = new Set<string>(rules.formation.animatedStageKinds);
  if (breathe !== undefined && breathe.columns.length + breathe.rows.length > 0) {
    const lopsided = new Map<string, { columns: number; rows: number; stages: string[] }>();
    for (const stage of stages) {
      if (!animated.has(stage.kind)) continue;
      const formation = registry.formations.get(stage.formation);
      if (formation === undefined) continue;
      const axes = formationAxes(formation);
      const columnsOff =
        breathe.columns.length > 0 && axes.columns.length !== breathe.columns.length;
      const rowsOff = axes.rows.length > breathe.rows.length;
      if (!columnsOff && !rowsOff) continue;
      const seen = lopsided.get(formation.id) ?? {
        columns: axes.columns.length,
        rows: axes.rows.length,
        stages: [],
      };
      seen.stages.push(stage.id);
      lopsided.set(formation.id, seen);
    }
    for (const [formation, { columns, rows, stages: at }] of lopsided) {
      couplings.push({
        kind: 'breathe',
        formation,
        columns,
        rows,
        tableColumns: breathe.columns.length,
        tableRows: breathe.rows.length,
        stages: at,
      });
    }
  }

  // 7.3 — continuous bombing, by absolute count, against the fleet the rules
  // were written for: the largest formation the pack shipping them declares.
  const counts = continuousBombingCounts(rules);
  const owner = [...registry.packs].reverse().find((pack) => pack.rules !== undefined);
  const reference = Math.max(
    0,
    ...Object.values(owner?.manifest.formations ?? {}).map((formation) => formation.slots.length),
  );
  if (counts !== undefined && reference > 0) {
    const smaller = stages.filter((stage) => fleetOf(stage) > 0 && fleetOf(stage) < reference);
    if (smaller.length > 0) {
      couplings.push({
        kind: 'continuous-bombing',
        fleet: Math.min(...smaller.map(fleetOf)),
        reference,
        min: counts.min,
        max: counts.max,
        stages: smaller.map((stage) => stage.id),
      });
    }
  }

  // 7.4 — captors in a formation that has nowhere to park a captured fighter.
  const capture = rules.capture;
  if (capture?.enabled === true && capture.captorRole !== undefined) {
    const captorRole = capture.captorRole;
    const stranded = new Map<string, string[]>();
    for (const stage of stages) {
      const formation = registry.formations.get(stage.formation);
      if (formation === undefined || formation.captiveSlots.length > 0) continue;
      const hasCaptor = stage.waves.some((wave) =>
        wave.slots.some((slot) => registry.aliens.get(slot.alien)?.role === captorRole),
      );
      if (!hasCaptor) continue;
      const at = stranded.get(formation.id) ?? [];
      at.push(stage.id);
      stranded.set(formation.id, at);
    }
    for (const [formation, at] of stranded) {
      couplings.push({ kind: 'no-capture', formation, stages: at });
    }
  }

  return couplings;
}

/** The union's kinds and {@link COUPLING_KINDS} are one list: a compile error if not. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const kindsAgree: Same<Coupling['kind'], CouplingKind> = true;
void kindsAgree;
