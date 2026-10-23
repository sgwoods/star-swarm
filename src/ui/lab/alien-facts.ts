/**
 * What one alien is, in one game: its document, and what that game's rules give
 * it.
 *
 * Everything here is **read**, never restated. The document's own fields come off
 * the registry's alien as the loader produced it; what the rules give it comes
 * through the resolvers in `src/content/rules.ts` that the simulation itself
 * calls, so a launch rate shown here is the launch rate the attack director
 * reads; and the dives are compiled by the simulation's own path interpreter,
 * from a real formation slot, the way `checkDives` in `scripts/playability.ts`
 * flies them for the gate. A lab that kept a table of its own could disagree with
 * the game, and nobody would know.
 *
 * Couplings are not worked out here either: `findCouplings` is what the pack
 * manager shows, and an alien whose role or stage meets one gets the same finding.
 *
 * DOM-free, so the Node tests read it directly.
 */

import { type Coupling, findCouplings } from '../../content/couplings.js';
import type { ContentSource } from '../../content/registry.js';
import { launchRoles, resolveRank } from '../../content/rules.js';
import type { Alien, Formation, Stage } from '../../content/schema.js';
import type { ResolvedVariant } from '../../content/variants.js';
import { createFormation, isRightOfCentre, slotPosition } from '../../sim/formation.js';
import { type CompiledPath, type PathError, tryCompilePath, type Vec2 } from '../../sim/paths.js';
import { startX } from '../../sim/player.js';
import { stagePlays } from './stage-run.js';

/** Where a fact can take the reader: another of the lab's views, at one item. */
export interface LabLink {
  readonly view: 'paths' | 'aliens' | 'stages' | 'sounds';
  readonly id: string;
}

/** One line of a facts table. */
export interface Fact {
  readonly label: string;
  readonly value: string;
  readonly link?: LabLink;
}

export type AlienGame = Pick<ResolvedVariant, 'registry' | 'rules'>;

/** One stage document whose waves send this alien. */
export interface AlienStage {
  readonly stage: Stage;
  /** How many of it the stage's waves send. */
  readonly count: number;
  /** The stage numbers the document plays as at the rank asked about. Empty: never. */
  readonly numbers: readonly number[];
}

export interface AlienFacts {
  readonly alien: Alien;
  readonly source: ContentSource | undefined;
  /** The role's label from the composed manifest, or the role id. */
  readonly roleLabel: string;
  /** The alien's own sprite, then each `hitSprites` entry, as the document orders them. */
  readonly sprites: readonly string[];
  /** The document's fields, one line each. */
  readonly document: readonly Fact[];
  /** What the rules in force give this alien or its role. */
  readonly rules: readonly Fact[];
  /** Every dive it can fly: its own, then the capture dive when its role captures. */
  readonly dives: readonly { readonly path: string; readonly capture: boolean }[];
  readonly stages: readonly AlienStage[];
  /** The pack manager's findings that name this alien's role. */
  readonly couplings: readonly Coupling[];
}

/** `2nd`, `3rd`, `11th`. */
function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${String(n)}${suffix}`;
}

/** A compact list of a plateau table's values: `0 0 1 1 2 … (last 4 repeat)`. */
function rowList(values: readonly (number | undefined)[], repeatLast: number): string {
  const shown = values.map((value) => (value === undefined ? '—' : String(value))).join(' ');
  return `${shown}  (last ${String(repeatLast)} repeat)`;
}

/** Ability parameters as `key value` pairs, nested values as JSON. */
function paramsOf(ability: Readonly<Record<string, unknown>>): string {
  return Object.entries(ability)
    .filter(([key]) => key !== 'type')
    .map(([key, value]) => `${key} ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ');
}

/**
 * Everything the alien view shows about `alienId` in `game`, at `rank`.
 *
 * `undefined` for an id the game's registry does not hold.
 */
export function alienFacts(
  game: AlienGame,
  alienId: string,
  rank: string | undefined,
): AlienFacts | undefined {
  const { registry, rules } = game;
  const alien = registry.aliens.get(alienId);
  if (alien === undefined) return undefined;
  const role = alien.role;
  const roleLabel = registry.manifest.roles[role]?.label ?? role;

  /* -- the document ------------------------------------------------------ */

  const document: Fact[] = [
    { label: 'role', value: roleLabel === role ? role : `${role} (${roleLabel})` },
    { label: 'hp', value: String(alien.hp) },
  ];
  const multiplier = alien.score.movingMultiplier ?? rules.scoring.movingMultiplier;
  document.push({
    label: 'score',
    value:
      `${String(alien.score.base)} at home, ${String(alien.score.base * multiplier)} moving ` +
      `(×${String(multiplier)} from the ${alien.score.movingMultiplier === undefined ? 'rules' : 'alien'})`,
  });
  if (alien.hitPadding.x > 0 || alien.hitPadding.y > 0) {
    document.push({
      label: 'hit padding',
      value: `${String(alien.hitPadding.x)} x, ${String(alien.hitPadding.y)} y`,
    });
  }
  if (alien.fire === undefined) {
    document.push({ label: 'fire', value: 'states none' });
  } else {
    const { pattern, shotsPerDive, cooldownFrames, spreadOffsets } = alien.fire;
    document.push({
      label: 'fire',
      value: [
        pattern,
        `${String(shotsPerDive)} per dive`,
        cooldownFrames === undefined ? undefined : `${String(cooldownFrames)} frames apart`,
        pattern === 'spread' ? `offsets ${spreadOffsets.join(', ')}°` : undefined,
      ]
        .filter((part) => part !== undefined)
        .join(', '),
    });
  }
  if (alien.dive === undefined) {
    document.push({ label: 'dive', value: 'states none: it never leaves its slot' });
  } else {
    document.push({ label: 'dive weight', value: String(alien.dive.weight) });
    document.push({
      label: 'leaves the bottom',
      value: alien.dive.returns ? 'comes back' : 'gone for good',
    });
    const escorts = alien.dive.escorts;
    if (escorts !== undefined) {
      document.push({
        label: 'escorts',
        value: `up to ${String(escorts.max)} of ${escorts.roles.join(', ')}`,
      });
    }
  }
  for (const ability of alien.abilities) {
    const params = paramsOf(ability);
    // An ability naming another alien — a split, a spawn — links to it.
    const named = Object.values(ability).find(
      (value): value is string =>
        typeof value === 'string' && value !== ability.type && registry.aliens.has(value),
    );
    document.push({
      label: `ability ${ability.type}`,
      value: params === '' ? '(no parameters)' : params,
      ...(named === undefined ? {} : { link: { view: 'aliens', id: named } }),
    });
  }

  /* -- what the rules give it -------------------------------------------- */

  const facts: Fact[] = [];
  const rankData = resolveRank(rules, rank);
  const rankId = rank ?? rules.difficulty.defaultRank;
  if (!launchRoles(rules).has(role)) {
    facts.push({
      label: 'launch rate',
      value: `no difficulty row of any rank names "${role}": it never attacks`,
    });
  } else if (rankData !== undefined) {
    const table = rankData.stageTable;
    facts.push({
      label: `launch rate, rank ${rankId}`,
      value: rowList(
        table.rows.map((row) => row.launchRates[role]),
        table.repeatLast,
      ),
    });
  }
  const timer = rules.enemies.bomberReadyTimers[role];
  if (timer !== undefined) {
    facts.push({ label: 'bomb timer at stage start', value: `${String(timer)} frames` });
  }
  if (alien.dive?.returns === true) {
    const back = rules.enemies.dive.returnPath;
    facts.push(
      back === undefined
        ? { label: 'return', value: 'the rules name no return path: gone for good' }
        : { label: 'return path', value: back, link: { view: 'paths', id: back } },
    );
  }
  const capture = rules.capture;
  if (capture.enabled && capture.captorRole === role) {
    facts.push({
      label: 'captor',
      value:
        capture.divePath === undefined
          ? 'its role captures, but the rules name no capture dive'
          : `every ${capture.everyNthLaunch === 1 ? '' : `${ordinal(capture.everyNthLaunch)} `}eligible launch may fly ${capture.divePath}`,
      ...(capture.divePath === undefined
        ? {}
        : { link: { view: 'paths', id: capture.divePath } as const }),
    });
  }
  if (capture.enabled && capture.captiveAlien === alien.id) {
    facts.push({ label: 'captive', value: 'a captured fighter becomes this alien' });
  }
  const escortBonus = rules.scoring.escortBonus;
  if (escortBonus.role === role && escortBonus.byEscortCount.length > 0) {
    facts.push({
      label: 'escort bonus',
      value: `by escorts launched: ${escortBonus.byEscortCount.join(', ')}`,
    });
  }
  const transform = rules.transform;
  if (transform?.enabled === true) {
    if (transform.types.includes(alien.id)) {
      facts.push({
        label: 'transform',
        value: `the rules' transform turns an enemy into ${String(transform.groupSize)} of these`,
      });
    }
    if (transform.fromRoles.length === 0 || transform.fromRoles.includes(role)) {
      facts.push({
        label: 'transforms',
        value: `from stage ${String(transform.fromStage)}, once fewer than ${String(transform.remainingThreshold)} remain`,
      });
    }
  }

  /* -- dives, stages, couplings ------------------------------------------- */

  const dives = (alien.dive?.paths ?? []).map((path) => ({ path, capture: false }));
  if (capture.enabled && capture.captorRole === role && capture.divePath !== undefined) {
    dives.push({ path: capture.divePath, capture: true });
  }

  const plays = stagePlays(game, rank).numbers;
  const stages: AlienStage[] = [];
  for (const stage of registry.stages.values()) {
    const count = stage.waves.reduce(
      (total, wave) => total + wave.slots.filter((slot) => slot.alien === alien.id).length,
      0,
    );
    if (count > 0) stages.push({ stage, count, numbers: plays.get(stage.id) ?? [] });
  }
  stages.sort((a, b) => (a.numbers[0] ?? Infinity) - (b.numbers[0] ?? Infinity));

  const couplings = findCouplings(registry, rules).filter(
    (coupling) =>
      (coupling.kind === 'silent-role' && coupling.role === role) ||
      (coupling.kind === 'no-capture' && capture.captorRole === role),
  );

  return {
    alien,
    source: registry.sourceOf('aliens', alien.id),
    roleLabel,
    sprites: [alien.sprite, ...alien.hitSprites],
    document,
    rules: facts,
    dives,
    stages,
    couplings,
  };
}

/** A formation slot an alien may dive from, at rest. */
export interface DiveSlot {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** Whether a dive from here flies mirrored, as the attack director decides it. */
  readonly mirror: boolean;
}

/** The formation an alien's dives are previewed in, and its role's slots there. */
export interface DiveSetting {
  readonly formation: Formation | undefined;
  readonly slots: readonly DiveSlot[];
  /** Every other slot of the formation, at rest, for drawing the formation around them. */
  readonly others: readonly Vec2[];
  /** Where `aimAtPlayer` aims: the fighter's start column, on its row. */
  readonly fighter: Vec2;
}

/**
 * The slots an alien would dive from: its role's slots in the formation of the
 * first stage that sends it, or — for an alien no stage sends, such as a split
 * or a transform's group — the first formation in the game holding its role.
 * Positions are at rest and mirroring is `isRightOfCentre`, which is how
 * `checkDives` flies a dive for the gate.
 */
export function diveSetting(game: AlienGame, facts: AlienFacts): DiveSetting {
  const { registry, rules } = game;
  const fighter: Vec2 = [startX(rules), rules.player.y];
  const role = facts.alien.role;
  const ownFormation = facts.stages
    .map((entry) => registry.formations.get(entry.stage.formation))
    .find((formation) => formation?.slots.some((slot) => slot.role === role));
  const formation =
    ownFormation ??
    [...registry.formations.values()].find((candidate) =>
      candidate.slots.some((slot) => slot.role === role),
    );
  if (formation === undefined) return { formation: undefined, slots: [], others: [], fighter };
  const state = createFormation(formation, rules, 'normal');
  const slots: DiveSlot[] = [];
  const others: Vec2[] = [];
  formation.slots.forEach((slot, index) => {
    const at = slotPosition(state, rules, index);
    if (slot.role !== role) others.push([at.x, at.y]);
    else slots.push({ index, x: at.x, y: at.y, mirror: isRightOfCentre(state, index) });
  });
  return { formation, slots, others, fighter };
}

export type DiveFlight =
  | { readonly path: string; readonly ok: true; readonly compiled: CompiledPath }
  | { readonly path: string; readonly ok: false; readonly errors: readonly PathError[] };

/** One dive path, compiled from `slot` by the simulation's own interpreter. */
export function flyDive(
  game: AlienGame,
  pathId: string,
  slot: Pick<DiveSlot, 'x' | 'y' | 'mirror'>,
  fighter: Vec2,
): DiveFlight {
  const path = game.registry.paths.get(pathId);
  if (path === undefined) {
    return { path: pathId, ok: false, errors: [{ path: pathId, message: 'no such path' }] };
  }
  const result = tryCompilePath(path, {
    mirror: slot.mirror,
    slot: [slot.x, slot.y],
    player: fighter,
    playfield: game.rules.playfield,
    start: [slot.x, slot.y],
    heading: 0,
  });
  return result.ok
    ? { path: pathId, ok: true, compiled: result.path }
    : { path: pathId, ok: false, errors: result.errors };
}
