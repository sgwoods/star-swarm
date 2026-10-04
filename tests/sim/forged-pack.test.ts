/**
 * The forged pack, played.
 *
 * `npm run validate-packs` now flies every stage of every variant
 * (`scripts/playability.ts`), and its checks are this file's, generalised: the
 * entry, the dives from every slot, a stage nothing can finish, determinism and the
 * persona ordering all run over Deep Sea there too. This file stays because it is
 * not the same claim. The gate is a floor any pack must clear, measured stage by
 * stage with lost fighters replaced; this holds **one pack** to the numbers it was
 * tuned against — whole games on the variant's own fighters, the strong persona
 * past stage 1 on three seeds in four — and to the rules-layer couplings the gate
 * does not judge (launchable roles, the breathe width, captive slots, wave lanes).
 * `docs/content-guide.md` section 10 points a generator at it as the worked example
 * of what a forge report measures.
 *
 * It lives in `tests/sim/` rather than `tests/unit/` for the reason
 * `./autoplay-personas.test.ts` does: the interesting questions are about whole
 * runs, and a single seed answers none of them. The five it asks are the five a
 * forge report has to carry:
 *
 * 1. does every enemy a stage launches reach its slot;
 * 2. does every dive stay on screen, flown from every slot its alien can occupy;
 * 3. is the stage clearable, by a pilot that is not cheating;
 * 4. does a run always end, rather than stalling until the clock runs out;
 * 5. is the same seed the same world.
 *
 * It is a test about **this pack**, deliberately not a validator pass: a number
 * here that every pack had to meet would belong in the gate's protocol instead.
 */

import { describe, expect, it } from 'vitest';

import type { Persona } from '../../src/content/personas.js';
import { formationAxes, type Formation, type Rules } from '../../src/content/schema.js';
import { resolveStageContent, type StageSource } from '../../src/content/stages.js';
import type { ResolvedVariant } from '../../src/content/variants.js';
import {
  compilePath,
  DEFAULT_PLAYFIELD,
  pathBounds,
  samplePath,
  type Vec2,
} from '../../src/sim/paths.js';
import { createWorld, fingerprintWorld, stepWorld } from '../../src/sim/world.js';
import { autopilotSource } from '../../src/ui/autoplay.js';
import { installedPack, shippedVariants, unsharedRules } from '../helpers/variants.js';

const PACK_ID = 'deep-sea';

/** The sprite is 16 px wide, so an anchor inside this keeps the whole of it on. */
const RIGHTMOST_ANCHOR = DEFAULT_PLAYFIELD.width - 16;

function variant(): ResolvedVariant {
  const found = shippedVariants().find((candidate) => candidate.id === PACK_ID);
  if (found === undefined) throw new Error(`no variants/${PACK_ID}.json`);
  return found;
}

function rules(): Rules {
  const value = variant().rules;
  if (value === undefined) throw new Error('the forged variant resolved no rules');
  return value;
}

/** The pack's own formation. It declares exactly one. */
function formation(): Formation {
  const formations = [...installedPack(PACK_ID).formations.values()];
  const only = formations[0];
  if (only === undefined || formations.length !== 1) {
    throw new Error(`expected one formation, found ${String(formations.length)}`);
  }
  return only;
}

/**
 * A stage source over one of the pack's own stages, resolved against the *layered*
 * content.
 *
 * Layered rather than the pack alone because that is how it is played: the aliens
 * and paths a stage names are its own, but the capture channel's `divePath` and
 * `captiveAlien` come from the rules, which come from the pack underneath. A source
 * built from the forged pack in isolation would make captures impossible and the
 * measurement would be of something nobody plays.
 */
function sourceOfStage(id: string): StageSource {
  const registry = variant().registry;
  const stage = registry.stages.get(id);
  if (stage === undefined) throw new Error(`no stage "${id}" in the layered registry`);
  const content = resolveStageContent(registry, stage);
  if (content === undefined) throw new Error(`stage "${id}" names no formation that resolves`);
  return { stageFor: () => content };
}

/** The pack's own stage ids, in the order its sequence plays them. */
function forgedStageIds(): readonly string[] {
  return installedPack(PACK_ID).manifest.stageSequence.normal.rows;
}

/* -------------------------------------------------------------------------- */
/* It is a pack, and it is a game                                              */
/* -------------------------------------------------------------------------- */

describe('the forged pack loads and is reachable', () => {
  it('is installed, and is named by a variant that layers it over a pack with rules', () => {
    const pack = installedPack(PACK_ID);
    expect(pack.rules).toBeUndefined();
    expect(variant().packs).toEqual(['classic', PACK_ID]);
    // Identity: the forged pack runs the base pack's rules document rather than a
    // copy of it, which is what makes it an addition instead of a fork. The one
    // thing it does not inherit is the ranks' own normal sequences, which name
    // Classic's combat scripts: its own normal half supersedes them at every rank
    // (`composeRules`), and everything else is still Classic's object.
    const own = variant().rules;
    const base = installedPack('classic').rules;
    if (base === undefined) throw new Error('the classic pack has no rules.json');
    expect(unsharedRules(own, base)).toEqual([]);
    for (const rank of Object.values(own.difficulty.ranks)) {
      expect(rank.stageSequence?.normal).toBeUndefined();
    }
  });

  it('plays its own stages at every rank, not the base pack’s', () => {
    // Classic's ranks B, C and D each select their own sequence of Classic's
    // combat scripts. Without the rule above, choosing HARD in the forged game
    // would put Classic's fleet on the field.
    const own = new Set(forgedStageIds());
    for (const preset of variant().presets) {
      const stages = variant().stagesFor(preset.rank);
      for (const stage of [1, 2, 4, 5, 6, 8, 9, 10, 12]) {
        const id = stages.stageFor(stage)?.stage.id ?? '';
        expect([preset.rank, stage, own.has(id)]).toEqual([preset.rank, stage, true]);
      }
    }
  });

  it('states the normal half of the sequence and inherits the challenge half', () => {
    const own = installedPack(PACK_ID).manifest.stageSequence;
    expect(own.normal.rows.length).toBeGreaterThan(0);
    expect(own.challenge.rows).toEqual([]);

    // Composed, the two halves come from different packs — which is the claim
    // "each half of the sequence moves separately" cashed out in a run: an early
    // stage number plays a forged document and the first challenge stage plays the
    // base pack's.
    const stages = variant().stagesFor(variant().defaultPreset.rank);
    expect(stages.stageFor(1)?.stage.id).toBe(own.normal.rows[0]);
    const challenge = installedPack('classic').manifest.stageSequence.challenge.rows[0];
    const third = stages.stageFor(3);
    expect(third?.stage.kind).toBe('challenge');
    expect(third?.stage.id).toBe(challenge);
  });

  it('gives every alien a role the difficulty rows can launch', () => {
    // `docs/content-guide.md` section 7.1: a role no row names never attacks, and
    // nothing reports it. A forged alien in such a role is a decoration.
    const launchable = new Set(
      Object.values(rules().difficulty.ranks).flatMap((rank) =>
        rank.stageTable.rows.flatMap((row) => Object.keys(row.launchRates)),
      ),
    );
    for (const [id, alien] of installedPack(PACK_ID).aliens) {
      expect([id, launchable.has(alien.role)]).toEqual([id, true]);
    }
  });

  it('shapes its formation to the breathe table it will run under', () => {
    // Section 7.2: the displacements are applied by position in the axis, so a
    // formation with fewer columns than the table has breathes lopsidedly and
    // cannot fix it from inside the pack.
    const breathe = rules().formation.breathe;
    expect(breathe).toBeDefined();
    const axes = formationAxes(formation());
    expect(axes.columns.length).toBe(breathe?.columns.length);
    expect(axes.rows.length).toBeLessThanOrEqual(breathe?.rows.length ?? 0);
  });

  it('declares one captive slot per captor, or capture would silently never happen', () => {
    // Section 7.4. The sentence this pack was forged from promises the top pair
    // will try to take the fighter, and a formation with no captive slots makes
    // every captor ineligible without an error.
    const captorRole = rules().capture.captorRole;
    expect(captorRole).toBeDefined();
    const captors = formation().slots.filter((slot) => slot.role === captorRole);
    expect(captors.length).toBeGreaterThan(0);
    expect(formation().captiveSlots.length).toBe(captors.length);
    for (const captive of formation().captiveSlots) {
      expect(formation().slots[captive.captor]?.role).toBe(captorRole);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 1. Every enemy reaches its slot                                             */
/* -------------------------------------------------------------------------- */

describe.each(forgedStageIds())('%s puts its whole fleet into formation', (id) => {
  it('leaves nothing stranded, and hands over to the breathe', () => {
    // No input and the dives held off, so what is measured is the entry
    // choreography alone: every slot claimed, every flyer home, the sway finished.
    // `armed` is cleared either side of the step because `formation-settled` arms
    // it, and a dive mid-measurement would move an enemy out of its slot.
    const world = createWorld({ seed: `entry:${id}`, rules: rules(), stages: sourceOfStage(id) });
    const expected = world.fleet.enemies.length;
    expect(expected).toBe(formation().slots.length);

    for (let step = 0; step < 1_600; step += 1) {
      world.dive.armed = false;
      stepWorld(world, 0);
      world.dive.armed = false;
    }

    expect(world.fleet.enemies.filter((enemy) => enemy.state === 'home')).toHaveLength(expected);
    expect(world.fleet.entryComplete).toBe(true);
    expect(world.formation?.motion).toBe('breathe');
    // Every slot exactly once: a claimed-slot collision would park two enemies in
    // one place and no position assertion would notice.
    expect(new Set(world.fleet.enemies.map((enemy) => enemy.home)).size).toBe(expected);
  });

  it('pairs its wave slots so no two fly one lane', () => {
    // Slots pair up two at a time and a pair launches on one frame, so a pair that
    // agreed on `mirror` would fly as a single sprite unless the second trails.
    const stage = installedPack(PACK_ID).stages.get(id);
    if (stage === undefined) throw new Error(`no stage "${id}"`);
    for (const [waveIndex, wave] of stage.waves.entries()) {
      for (let slot = 1; slot < wave.slots.length; slot += 2) {
        const first = wave.slots[slot - 1];
        const second = wave.slots[slot];
        const distinct = second?.trailing === true || first?.mirror !== second?.mirror;
        expect([id, waveIndex, slot, distinct]).toEqual([id, waveIndex, slot, true]);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Every dive stays on screen                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every slot an alien of this role can be sitting in when it launches, as pixels.
 *
 * The formation's slots are logical `(row, column)` pairs, so this is the grid
 * applied to them — at rest, which is where the classic path test takes its
 * positions too. The outermost columns are the whole point: a dive fans *outwards*,
 * so the widest excursion is the one an enemy in the first or last column makes.
 */
function launchPositions(
  role: string,
): ReadonlyArray<{ readonly at: Vec2; readonly mirror: boolean }> {
  const shape = formation();
  const grid = shape.grid;
  if (grid === undefined) throw new Error('the forged formation states no grid');
  const axes = formationAxes(shape);
  return shape.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.role === role)
    .map(({ slot }) => {
      const column = axes.columns.indexOf(slot.column);
      return {
        at: [
          grid.originX + slot.column * grid.columnSpacing,
          grid.originY + slot.row * grid.rowSpacing,
        ] as Vec2,
        // The flag the formation itself would pick: the right-hand half flies the
        // reflection, which is what makes a dive fan outwards.
        mirror: column * 2 >= axes.columns.length - 1,
      };
    });
}

/** Which dive paths an alien of each role flies, from the pack's own aliens. */
function divePathsByRole(): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const alien of installedPack(PACK_ID).aliens.values()) {
    const paths = alien.dive?.paths ?? [];
    out.set(alien.role, [...(out.get(alien.role) ?? []), ...paths]);
  }
  return out;
}

describe('every forged dive is flyable from every slot its alien can occupy', () => {
  /** Segment types whose geometry is relative to where the flyer already is. */
  const RELATIVE = new Set([
    'arc',
    'loop',
    'lissajous',
    'sine',
    'wait',
    'aimAtPlayer',
    'toSlot',
    'exitBottom',
    'fire',
    'trigger',
  ]);

  it('states no start and uses only pose-relative segments', () => {
    for (const [, paths] of divePathsByRole()) {
      for (const id of paths) {
        const path = installedPack(PACK_ID).paths.get(id);
        if (path === undefined) throw new Error(`no path "${id}" in the forged pack`);
        expect([id, path.start]).toEqual([id, undefined]);
        expect([id, path.mirror]).toEqual([id, true]);
        for (const segment of path.segments) {
          expect([id, segment.type, RELATIVE.has(segment.type)]).toEqual([id, segment.type, true]);
        }
      }
    }
  });

  it('leaves the bottom of the screen without leaving the sides', () => {
    // The check `docs/DESIGN.md` section 8 step 2 will make formal, done here for
    // one pack. Flown from every slot of the role and in the mirror sense the
    // formation would pick, because one starting position proves nothing about a
    // path whose geometry is relative to where it began.
    let flown = 0;
    for (const [role, paths] of divePathsByRole()) {
      for (const id of paths) {
        const path = installedPack(PACK_ID).paths.get(id);
        if (path === undefined) throw new Error(`no path "${id}"`);
        for (const { at, mirror } of launchPositions(role)) {
          const compiled = compilePath(path, {
            mirror,
            slot: at,
            player: [103, rules().player.y],
            playfield: DEFAULT_PLAYFIELD,
            start: at,
            heading: 0,
          });
          const where = `${id} from ${at.join(',')}${mirror ? ' mirrored' : ''}`;
          const end = samplePath(compiled, compiled.totalFrames);
          const bounds = pathBounds(compiled);

          expect([where, Number.isFinite(compiled.totalFrames)]).toEqual([where, true]);
          expect([where, end.done]).toEqual([where, true]);
          expect([where, end.y >= DEFAULT_PLAYFIELD.height]).toEqual([where, true]);
          expect([where, bounds.minX >= 0]).toEqual([where, true]);
          expect([where, bounds.maxX <= RIGHTMOST_ANCHOR]).toEqual([where, true]);
          flown += 1;
        }
      }
    }
    // A loop that silently flew nothing would pass every assertion above.
    expect(flown).toBeGreaterThan(20);
  });
});

/* -------------------------------------------------------------------------- */
/* 3–5. It plays                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How long a run is given and how many seeds each persona plays.
 *
 * Three minutes is well past the longest run either persona has recorded here, so
 * a run that reaches the limit is a **stall** — a stage that cannot be finished —
 * rather than a long game cut short, which is what makes the stall count worth
 * asserting on. Sixteen seeds is where the clear rates below were measured and
 * costs about three seconds for the pair.
 */
const STEPS = 3 * 60 * 60;
const SEEDS = 16;

type Outcome = 'cleared-and-then-lost' | 'lost-on-the-first-stage' | 'stalled';

interface Run {
  readonly outcome: Outcome;
  readonly score: number;
  readonly stage: number;
  readonly steps: number;
}

function play(persona: Persona, seed: string): Run {
  const stages = variant().stagesFor(variant().defaultPreset.rank);
  const world = createWorld({ seed, rules: rules(), stages });
  const pilot = autopilotSource(world, { persona, seed: `pilot:${seed}` });
  let steps = 0;
  for (; steps < STEPS && world.status === 'playing'; steps += 1) stepWorld(world, pilot.sample());
  const outcome: Outcome =
    world.status === 'playing'
      ? 'stalled'
      : world.stage > 1
        ? 'cleared-and-then-lost'
        : 'lost-on-the-first-stage';
  return { outcome, score: world.score, stage: world.stage, steps };
}

function runsOf(id: string): readonly Run[] {
  const persona = variant().personas.find((candidate) => candidate.id === id);
  if (persona === undefined) throw new Error(`variants/${PACK_ID}.json declares no "${id}"`);
  return Array.from({ length: SEEDS }, (_unused, index) => play(persona, `forge-${index}`));
}

function meanScore(runs: readonly Run[]): number {
  return runs.reduce((total, run) => total + run.score, 0) / runs.length;
}

describe('an autoplay persona plays the forged pack', () => {
  it('declares the personas it is measured with, so the measurement is reproducible', () => {
    // A variant with no `autoplay` block cannot be watched and cannot be measured,
    // which for a forged pack means the honest substitute for the playability
    // checks is unavailable. Naming them here is what makes the README's table
    // something somebody can re-run.
    expect(variant().personas.map((persona) => persona.id)).toEqual(['normal', 'astronaut']);
  });

  it('is clearable: the strong persona gets past the first stage on almost every seed', () => {
    // This is the whole substitute for "the stage is clearable". A stage nothing can
    // clear passes `npm run validate-packs` without a murmur. Measured at 14 of 16
    // and asserted at three quarters, which leaves room for a bad dive without
    // leaving room for a stage that has stopped being finishable.
    const runs = runsOf('astronaut');
    const cleared = runs.filter((run) => run.stage > 1).length;
    expect(cleared).toBeGreaterThanOrEqual(Math.ceil(SEEDS * 0.75));
    // And it gets past the inherited challenge stage, so the composed sequence is
    // reached in play rather than only in the lookup asserted above.
    expect(Math.max(...runs.map((run) => run.stage))).toBeGreaterThan(3);
  });

  it('is clearable by a mid-tier persona too, on a real fraction of seeds', () => {
    // The other half of clearable: a stage only a perfect pilot can finish is a
    // stage that is not calibrated. Measured at 3 of 16; asserted at 1, which is
    // well inside the noise and still fails a stage that has become unclearable
    // for anyone but the ceiling.
    const cleared = runsOf('normal').filter((run) => run.stage > 1).length;
    expect(cleared).toBeGreaterThanOrEqual(1);
  });

  it('always ends: no run of either persona reaches the step limit still playing', () => {
    // A stage that cannot finish — an enemy nothing can reach, a wave that never
    // launches — shows up here and nowhere else in the suite.
    for (const id of ['normal', 'astronaut']) {
      const stalled = runsOf(id).filter((run) => run.outcome === 'stalled');
      expect([id, stalled.length]).toEqual([id, 0]);
    }
  });

  it('is ordered: the strong persona outscores the mid-tier one', () => {
    // The pack declares two personas of its own, and nothing else holds them to
    // being a ladder — `tests/sim/autoplay-personas.test.ts` holds the base pack's
    // four. A forged pack whose personas did not climb would be offering a choice
    // with no meaning.
    expect(meanScore(runsOf('astronaut'))).toBeGreaterThan(meanScore(runsOf('normal')));
  });

  it('is deterministic: the same seed and persona give the same world', () => {
    // Pillar 4 reaches forged content too. Nothing in a pack can read a clock or
    // draw an unseeded number, and this is the end-to-end form of that claim.
    const persona = variant().personas.find((candidate) => candidate.id === 'astronaut');
    if (persona === undefined) throw new Error('no astronaut persona');
    const once = (): string => {
      const stages = variant().stagesFor(variant().defaultPreset.rank);
      const world = createWorld({ seed: 'determinism', rules: rules(), stages });
      const pilot = autopilotSource(world, { persona, seed: 'pilot:determinism' });
      for (let step = 0; step < 4_000; step += 1) stepWorld(world, pilot.sample());
      return fingerprintWorld(world);
    };
    expect(once()).toBe(once());
  });
});
