/**
 * Sortie groups: enemies that fly together, and the three ways a score reads
 * them (`docs/ARCHITECTURE.md` §4.4).
 *
 * In both arcade lineages a score can depend on **which enemies flew together**,
 * and in neither does it depend on the order they died. So what is recorded here
 * is an identity — a leader and the members it launched with — and never a log of
 * kills. Three readings of that identity are the whole of what scoring needs:
 *
 * 1. **The members launched with the leader, latched.** Written onto the leader
 *    as it launches ({@link formSortie}) and never revised by an escort's death:
 *    a leader that launched with two escorts is worth the two-escort value even
 *    if both are shot first.
 * 2. **The members still in flight when the leader dies.** Read at the kill
 *    ({@link escortBonusAtKill}), for the pairs a pack lists in
 *    `scoring.escortBonus.atKill`. "In flight" means flying with the group: an
 *    escort that has reached its slot has left it exactly as surely as one that
 *    was destroyed, because the reading is of who is flying, not of who was
 *    killed.
 * 3. **The whole group destroyed, with none escaped.** Paid on the kill that
 *    completes it ({@link groupNoteDestroyed}). A member that reaches its slot or
 *    leaves the field alive ends that possibility for good.
 *
 * A group keeps its identity for the whole flight, **including the wrap-around**:
 * a diver that leaves the bottom and re-enters at the top on its way home is
 * still flying, and is still the group's. Its flight ends when it is home, gone
 * or destroyed.
 *
 * **Inert unless a pack declares a group.** Only an alien with `dive.escorts`
 * forms a group, and every other entry point here is a lookup that finds nothing
 * in a world with none. So a world whose pack declares no escorts behaves as it
 * did before groups existed, and {@link groupFingerprint} says nothing at all for
 * it — which is what let the capability land without a recorded replay changing,
 * before Classic's warden named its escorts.
 *
 * A sortie is the one way a group is born so far. The record does not know how
 * it was born, which is what lets a group from an entry wave, a split or a
 * transform be the same identity later rather than a second mechanism.
 */

import {
  resolveEscortBonus,
  resolveEscortBonusAtKill,
  resolveWholeGroupBonus,
} from '../content/rules.js';
import type { Rules } from '../content/schema.js';
import type { Enemy } from './enemies.js';

/** One group, for one stage. A plain value, so it serialises. */
export interface Group {
  /** Its place in the order groups were formed this stage. */
  readonly id: number;
  /** The enemy that led it out. */
  readonly leader: number;
  /** The enemies that launched with the leader, in the order they were chosen. */
  readonly members: readonly number[];
  /** Everyone still flying with the group, the leader included. */
  readonly inFlight: Set<number>;
  /** False once anyone in it ended its flight alive — home, or off the field. */
  intact: boolean;
}

/**
 * Every group formed this stage, in the order formed.
 *
 * Replaced every stage, like every other record keyed by enemy id, because ids
 * are per stage. A group whose flight is over stays in the list, so what a leader
 * launched with is part of the state a replay compares long after it landed.
 */
export interface GroupState {
  readonly groups: Group[];
}

export function createGroupState(): GroupState {
  return { groups: [] };
}

/**
 * Record a sortie and latch its leader's escort record — read 1.
 *
 * Every launch of a leader writes the record, a solo one included, so a leader
 * that launched with two escorts last time and goes alone this time is worth the
 * solo value again. The arcade writes its per-boss record at every launch, the
 * solo entry included (`docs/reference/arcade-reference.md` section 9).
 */
export function formSortie(
  state: GroupState,
  rules: Rules,
  leader: Enemy,
  members: readonly Enemy[],
): Group {
  const group: Group = {
    id: state.groups.length,
    leader: leader.id,
    members: members.map((member) => member.id),
    inFlight: new Set([leader.id, ...members.map((member) => member.id)]),
    intact: true,
  };
  state.groups.push(group);
  leader.escortBonus = resolveEscortBonus(rules, leader.role, members.length);
  return group;
}

/**
 * The group this enemy is flying with, if it is flying with one.
 *
 * At most one: an enemy joins a group only from its slot, and reaching its slot
 * is one of the ways its flight with the last group ended.
 */
function flyingWith(state: GroupState, id: number): Group | undefined {
  return state.groups.find((group) => group.inFlight.has(id));
}

/**
 * What this enemy's kill pays as its escort record — read 2, or the latch.
 *
 * A leader killed while its group still flies is looked up by the escorts it
 * launched with and those still flying with it, and the pack's `atKill` decides
 * whether that pair is worth anything other than the latch. Anything else — a
 * leader whose group has landed, an escort, an enemy in no group — is worth the
 * record it carries.
 */
export function escortBonusAtKill(state: GroupState, rules: Rules, enemy: Enemy): number {
  const group = flyingWith(state, enemy.id);
  if (group === undefined || group.leader !== enemy.id) return enemy.escortBonus;
  const stillFlying = group.members.filter((id) => group.inFlight.has(id)).length;
  return (
    resolveEscortBonusAtKill(rules, enemy.role, group.members.length, stillFlying) ??
    enemy.escortBonus
  );
}

/**
 * An enemy ended its flight alive: it reached its slot or left the field.
 *
 * Either way it escaped, so its group can no longer be destroyed whole.
 */
export function groupNoteSurvived(state: GroupState, enemy: Enemy): void {
  const group = flyingWith(state, enemy.id);
  if (group === undefined) return;
  group.inFlight.delete(enemy.id);
  group.intact = false;
}

/** A whole group destroyed, and what it pays. */
export interface GroupDestroyed {
  readonly group: Group;
  readonly bonus: number;
}

/**
 * An enemy was destroyed in flight. Returns the group if that kill completed
 * it — read 3 — with the bonus the leader's role and escort count resolve to.
 *
 * Who died last does not matter, and nor does the order: the test is that
 * nobody is left flying and nobody escaped. The bonus is read off the leader's
 * role as it is now, the same role {@link escortBonusAtKill} reads.
 */
export function groupNoteDestroyed(
  state: GroupState,
  rules: Rules,
  enemy: Enemy,
  enemies: readonly Enemy[],
): GroupDestroyed | undefined {
  const group = flyingWith(state, enemy.id);
  if (group === undefined) return undefined;
  group.inFlight.delete(enemy.id);
  if (group.inFlight.size > 0 || !group.intact) return undefined;
  // The leader is in the fleet still, dead or not: a stage never drops an enemy.
  const leader = enemies.find((each) => each.id === group.leader);
  const bonus =
    leader === undefined ? 0 : resolveWholeGroupBonus(rules, leader.role, group.members.length);
  return { group, bonus };
}

/**
 * A single comparable value for every group this stage, for the golden replays.
 *
 * **Absent, not empty, while no group has been formed**, so a world whose pack
 * declares none fingerprints exactly as it did before groups existed. That is
 * what lets the capability land without a single recorded replay changing.
 */
export function groupFingerprint(state: GroupState): readonly unknown[] | undefined {
  if (state.groups.length === 0) return undefined;
  return state.groups.map((group) => [
    group.id,
    group.leader,
    group.members,
    [...group.inFlight].sort((a, b) => a - b),
    group.intact,
  ]);
}
