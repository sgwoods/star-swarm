/**
 * The parts of the playability pass (`scripts/playability.ts`) that can be pinned
 * without flying a whole pack: the bullet-wall sweep, the thresholds, which
 * personas fly which variant and which stages get flown.
 *
 * The pass over real packs — every shipped variant passing, and a deliberately
 * unplayable fixture failing — is `tests/sim/validate-packs-playability.test.ts`,
 * because it flies every stage and takes seconds rather than milliseconds.
 *
 * Every threshold here is pinned from **both** edges. A test that only proved the
 * shipped packs pass would still pass with the threshold loosened to nothing; a
 * test that only proved the fixture fails would still pass with it tightened past
 * what any real pack can meet.
 */

import { describe, expect, it } from 'vitest';

import type { Rules } from '../../src/content/schema.js';
import type { ResolvedVariant } from '../../src/content/variants.js';
import { maxXFor } from '../../src/content/rules.js';
import type { EnemyBullet } from '../../src/sim/shots.js';
import {
  clearsEnough,
  findBulletWall,
  flyStage,
  pilotsFor,
  PROTOCOL,
  stageFlights,
} from '../../scripts/playability.js';
import { classicRules } from '../helpers/rules.js';
import { shippedVariants } from '../helpers/variants.js';

function variant(id: string): ResolvedVariant {
  const found = shippedVariants().find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no variants/${id}.json`);
  return found;
}

/** A falling bullet whose y puts it `stepsAway` steps from entering the fighter's hit window. */
function falling(rules: Rules, x: number, stepsAway: number, slot = 0): EnemyBullet {
  return {
    slot,
    active: true,
    x,
    // The window is entered on the step `row − y` falls to `dyMax`.
    y: rules.player.y - rules.player.hitWindow.dyMax - stepsAway,
    vx: 0,
    vy: 1,
  };
}

/** A row of falling bullets, one every `spacing` px from `first`, all `stepsAway` from the row. */
function row(rules: Rules, first: number, count: number, spacing: number, stepsAway: number) {
  return Array.from({ length: count }, (_unused, index) =>
    falling(rules, first + index * spacing, stepsAway, index),
  );
}

describe('the bullet-wall sweep', () => {
  const rules = classicRules();
  const { dxMin, dxMax } = rules.player.hitWindow;
  /** Columns one bullet's window covers. Classic's ±6 is 13. */
  const width = dxMax - dxMin + 1;
  const lastColumn = maxXFor(rules, 'single');

  it('states the geometry it is measured against, so the numbers below can be read', () => {
    expect([rules.player.minX, lastColumn, width, Math.max(...rules.player.stepPattern)]).toEqual([
      0, 207, 13, 2,
    ]);
  });

  it('calls a row that covers every column a wall', () => {
    // Sixteen windows of thirteen tile 0…207 exactly.
    const bullets = row(rules, -dxMin, 16, width, 1);
    expect(findBulletWall(bullets, rules)).toBe(1);
  });

  it('does not, with a single column left open — the other edge of the same row', () => {
    // The same row with its last bullet moved one pixel right: column 195 is in
    // nobody's window any more, and one column is enough for a fighter that can
    // stand anywhere.
    const bullets = row(rules, -dxMin, 16, width, 1);
    const last = bullets[15];
    if (last === undefined) throw new Error('no last bullet');
    last.x += 1;
    expect(findBulletWall(bullets, rules)).toBeUndefined();
  });

  it('holds the fighter to its own speed: a gap it cannot cross in time is a wall, one it can is not', () => {
    // Row A leaves only column 0, so after it the fighter can only be at the left
    // edge. Row B leaves only column 207, `delay` steps later. The fighter gets one
    // move of up to 2 px per step from step 14 (A's last) to B's first, so it
    // escapes exactly when 2 × (delay − 12) ≥ 207 — at a delay of 116, and not 115.
    const both = (delay: number) => [
      ...row(rules, 1 - dxMin, 16, width, 1),
      ...row(rules, -1 - dxMin, 16, width, 1 + delay),
    ];
    expect(findBulletWall(both(116), rules)).toBeUndefined();
    expect(findBulletWall(both(115), rules)).toBe(116);
  });

  it('ignores bullets that are not in flight, and an empty sky', () => {
    const bullets = row(rules, -dxMin, 16, width, 1).map((bullet) => ({
      ...bullet,
      active: false,
    }));
    expect(findBulletWall(bullets, rules)).toBeUndefined();
    expect(findBulletWall([], rules)).toBeUndefined();
  });
});

describe('the thresholds', () => {
  it('clearable: exactly the protocol count of mid-tier clears passes, one fewer fails', () => {
    expect(clearsEnough(PROTOCOL.midClears)).toBe(true);
    expect(clearsEnough(PROTOCOL.midClears - 1)).toBe(false);
    // And the count is a real fraction of the seeds: neither "any" nor "all".
    expect(PROTOCOL.midClears).toBeGreaterThan(1);
    expect(PROTOCOL.midClears).toBeLessThan(PROTOCOL.seeds);
  });

  it('the time limit: a run given exactly the steps it clears in clears, one fewer does not', () => {
    // A challenge stage, because it ends on its own schedule and so measures the
    // limit rather than the pilot.
    const classic = variant('classic');
    const flight = stageFlights(classic).find((candidate) => candidate.stage.kind === 'challenge');
    if (flight === undefined) throw new Error('Classic plays no challenge stage');
    const pilots = pilotsFor(classic, shippedVariants());
    if (pilots === undefined) throw new Error('Classic has no personas');

    const free = flyStage(classic, flight, pilots.strong, 'limit');
    expect(free.cleared).toBe(true);
    expect(flyStage(classic, flight, pilots.strong, 'limit', free.steps).cleared).toBe(true);
    expect(flyStage(classic, flight, pilots.strong, 'limit', free.steps - 1).cleared).toBe(false);
  });
});

describe('which personas fly a variant', () => {
  it('takes the last declared persona as strong and the middle one as mid-tier', () => {
    const pilots = pilotsFor(variant('classic'), shippedVariants());
    expect([pilots?.strong.id, pilots?.mid.id, pilots?.borrowed]).toEqual([
      'astronaut',
      'normal',
      false,
    ]);
    const deepSea = pilotsFor(variant('deep-sea'), shippedVariants());
    expect([deepSea?.strong.id, deepSea?.mid.id]).toEqual(['astronaut', 'normal']);
  });

  it('borrows them from a variant running the same rules document when it declares none', () => {
    const remix = variant('swarm-remix');
    expect(remix.personas).toEqual([]);
    const pilots = pilotsFor(remix, shippedVariants());
    expect([pilots?.from, pilots?.borrowed, pilots?.strong.id]).toEqual([
      'classic',
      true,
      'astronaut',
    ]);
  });

  it('has none to offer a variant whose rules nobody with personas shares', () => {
    // An equal copy is not the same document, and identity is the claim: a
    // persona's units are the pixels and steps of the rules it was written for.
    const orphan: ResolvedVariant = {
      ...variant('swarm-remix'),
      rules: structuredClone(classicRules()),
    };
    expect(pilotsFor(orphan, [...shippedVariants(), orphan])).toBeUndefined();
  });
});

describe('which stages are flown', () => {
  it('flies each stage document once, at the first number that plays it', () => {
    const flights = stageFlights(variant('classic'));
    const ids = flights.map((flight) => flight.stage.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Stage 8 plays `stage-4` again; it is flown once, as stage 4.
    expect(flights.find((flight) => flight.stage.id === 'stage-4')?.number).toBe(4);
    expect(flights.find((flight) => flight.stage.id === 'challenge-1')?.number).toBe(3);
    // Every document the pack's sequence names, and nothing else.
    const { normal, challenge } = variant('classic').registry.manifest.stageSequence;
    expect(new Set(ids)).toEqual(new Set([...normal.rows, ...challenge.rows]));
  });
});

describe('a flight reports a wall when there is one', () => {
  it('sees the first bullet under rules whose fighter window covers the whole field', () => {
    // Wiring, not geometry: with a hit window wider than the playfield, any bullet
    // near the row is a wall, so a flight that never reported one would mean the
    // sweep is not being asked.
    const classic = variant('classic');
    const bent: Rules = structuredClone(classic.rules);
    bent.player.hitWindow = { dxMin: -400, dxMax: 400, dyMin: -6, dyMax: 6 };
    const flight = stageFlights(classic)[0];
    const pilots = pilotsFor(classic, shippedVariants());
    if (flight === undefined || pilots === undefined) throw new Error('nothing to fly');
    const run = flyStage({ ...classic, rules: bent }, flight, pilots.strong, 'wall', 3_000);
    expect(run.wall).toBeDefined();
    expect(flyStage(classic, flight, pilots.strong, 'wall', 3_000).wall).toBeUndefined();
  });
});
