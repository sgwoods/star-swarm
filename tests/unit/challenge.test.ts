import { describe, expect, it } from 'vitest';

import {
  challengeEndBonus,
  challengeGroupBonus,
  challengeImpactAward,
  challengeOrdinal,
  isChallengeStage,
} from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { allowsEntryBombing } from '../../src/content/rules.js';
import { frameOf } from '../../src/engine/input.js';
import {
  createChallengeStage,
  endChallengeStage,
  recordChallengeHit,
} from '../../src/sim/challenge.js';
import { aliveEnemies, isTargetable, NO_SLOT } from '../../src/sim/enemies.js';
import { eventsOfType } from '../../src/sim/events.js';
import { bulletsInFlight } from '../../src/sim/shots.js';
import { createWorld, stepWorld, type World } from '../../src/sim/world.js';
import { classicRules, classicStages, quickRunRules, stageSourceOf } from '../helpers/rules.js';

/**
 * Challenge stages: the cadence, the three awards, and the ending.
 *
 * `docs/reference/arcade-reference.md` section 8 is the authority and it settles
 * the part most easily got wrong — scoring **on impact**, at a value that belongs
 * to the challenge stage rather than to the enemy, from a table that *cycles*
 * while the group bonus beside it *clamps*. The worked total the design plan
 * states is 19,000 for a perfect first challenge stage, and the golden replays in
 * `tests/sim/player-core.test.ts` prove it end to end from an input log that
 * never moves. This file is the unit half: each rule on its own, so a failure
 * says which one.
 */

const rules = classicRules();
const stages = classicStages();
const FIRE = frameOf('fire');

/** Stage numbers of the first nine challenge stages. */
const CHALLENGE_STAGES = [3, 7, 11, 15, 19, 23, 27, 31, 35] as const;

describe('the cadence', () => {
  it('comes from the rules, not from a stage number written down', () => {
    // `challengeStages` is `{ firstStage: 3, everyStages: 4 }` in the pack, so a
    // pack that moved either one moves the challenge stages with it. A hardcoded
    // `stage % 4 === 3` would not.
    expect(CHALLENGE_STAGES.every((stage) => isChallengeStage(rules, stage))).toBe(true);
    expect([1, 2, 4, 5, 6, 8, 12, 34, 36].some((stage) => isChallengeStage(rules, stage))).toBe(
      false,
    );

    const later: Rules = {
      ...rules,
      challengeStages: { enabled: true, firstStage: 5, everyStages: 3 },
    };
    expect([5, 8, 11, 14].every((stage) => isChallengeStage(later, stage))).toBe(true);
    expect(isChallengeStage(later, 3)).toBe(false);
  });

  it('numbers them from zero, which is what both award tables are keyed by', () => {
    expect(CHALLENGE_STAGES.map((stage) => challengeOrdinal(rules, stage))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('has none at all when a pack switches them off', () => {
    const none: Rules = { ...rules, challengeStages: { ...rules.challengeStages, enabled: false } };
    expect(CHALLENGE_STAGES.some((stage) => isChallengeStage(none, stage))).toBe(false);
  });
});

describe('the impact award', () => {
  it('is 100 on the first challenge stage and 160 on the second through eighth', () => {
    expect(CHALLENGE_STAGES.slice(0, 8).map((stage) => challengeImpactAward(rules, stage))).toEqual(
      [100, 160, 160, 160, 160, 160, 160, 160],
    );
  });

  it('cycles on the ninth while the group bonus stays clamped', () => {
    // Reference section 8: the sprite/score set is `(stage >> 2) AND 7` with no
    // clamp, the group bonus is `(stage >> 3) AND 3` clamped to 3 from stage 32.
    // Two fold rules over one stage counter — the trap this test exists for.
    expect(challengeImpactAward(rules, 35)).toBe(100);
    expect(challengeGroupBonus(rules, 35)).toBe(3_000);
    // And it keeps cycling: the tenth challenge stage is back to 160.
    expect(challengeImpactAward(rules, 39)).toBe(160);
    expect(challengeGroupBonus(rules, 39)).toBe(3_000);
  });

  it('steps the group bonus 1,000 / 1,500 / 2,000 / 3,000 by challenge-stage pairs', () => {
    expect(CHALLENGE_STAGES.map((stage) => challengeGroupBonus(rules, stage))).toEqual([
      1_000, 1_000, 1_500, 1_500, 2_000, 2_000, 3_000, 3_000, 3_000,
    ]);
  });

  it('awards nothing on impact when a pack states no table', () => {
    const silent: Rules = {
      ...rules,
      scoring: {
        ...rules.scoring,
        challenge: { ...rules.scoring.challenge!, impactAward: null },
      },
    };
    expect(challengeImpactAward(silent, 3)).toBeUndefined();
  });
});

describe('the end-of-stage award', () => {
  it('pays 100 per hit when the stage was not perfect', () => {
    expect(challengeEndBonus(rules, 39, 40)).toBe(3_900);
    expect(challengeEndBonus(rules, 0, 40)).toBe(0);
  });

  it('replaces the per-hit bonus with the perfect one rather than adding to it', () => {
    // Reference section 8: the two branches join the same adder and are mutually
    // exclusive. Adding them gives 14,000 and a 4,000-point error per stage.
    expect(challengeEndBonus(rules, 40, 40)).toBe(10_000);
  });

  it('adds them when a pack says the perfect bonus does not replace', () => {
    const additive: Rules = {
      ...rules,
      scoring: {
        ...rules.scoring,
        challenge: { ...rules.scoring.challenge!, perfectReplacesPerHit: false },
      },
    };
    expect(challengeEndBonus(additive, 40, 40)).toBe(14_000);
  });
});

/** Five groups of eight, which is what a challenge stage's waves amount to. */
function challengeState(): NonNullable<ReturnType<typeof createChallengeStage>> {
  const content = stages.stageFor(3);
  const state = createChallengeStage(rules, 3, content);
  if (state === undefined) throw new Error('stage 3 is not a challenge stage');
  return state;
}

describe('the running state', () => {
  it('is absent on an ordinary stage and present on a challenge one', () => {
    expect(createChallengeStage(rules, 2, stages.stageFor(2))).toBeUndefined();
    expect(challengeState()).toMatchObject({ ordinal: 0, total: 40, impactAward: 100 });
  });

  it('counts forty enemies in five groups of eight', () => {
    expect(challengeState().groupSize).toEqual([8, 8, 8, 8, 8]);
  });

  it('pays the group bonus on the eighth hit of a group, and only then', () => {
    const state = challengeState();
    const bonuses = Array.from({ length: 8 }, () => recordChallengeHit(state, 0).groupBonus);
    expect(bonuses).toEqual([0, 0, 0, 0, 0, 0, 0, 1_000]);
    expect(state.groupBonusPaid).toBe(1_000);
    // Acceptance test C3: eight at 100, plus the group bonus.
    expect(state.impactScore + state.groupBonusPaid).toBe(1_800);
  });

  it('never pays a group one enemy escaped, however many hits the stage took', () => {
    // Seven of each of the five groups is the most a stage can take without
    // completing one: no group bonus at all, and 100 x 35 at the end rather than
    // the perfect 10,000.
    //
    // (The scout report's test C5 asks for 39 hits "all five groups partially",
    // which cannot happen: 39 of 40 leaves exactly one group short, so four of
    // them do pay. The rule it was reaching for — the end award is 100 x hits and
    // not the perfect bonus — is what both halves of this test assert instead.)
    const partial = challengeState();
    for (let group = 0; group < 5; group += 1) {
      for (let hit = 0; hit < 7; hit += 1) recordChallengeHit(partial, group);
    }
    expect(partial.hits).toBe(35);
    expect(partial.groupBonusPaid).toBe(0);
    const partialEnd = endChallengeStage(partial, rules);
    expect(partialEnd).toMatchObject({ hits: 35, total: 40, perfect: false, endBonus: 3_500 });
    expect(partial.impactScore + partial.groupBonusPaid + partialEnd.endBonus).toBe(7_000);

    // One short of perfect: four groups pay, the fifth does not, and the end
    // award is 3,900 rather than 10,000 — a 6,100-point difference from perfect
    // for a single escaped enemy.
    const nearly = challengeState();
    for (let group = 0; group < 5; group += 1) {
      for (let hit = 0; hit < (group === 4 ? 7 : 8); hit += 1) recordChallengeHit(nearly, group);
    }
    expect(nearly.hits).toBe(39);
    expect(nearly.groupBonusPaid).toBe(4_000);
    const nearlyEnd = endChallengeStage(nearly, rules);
    expect(nearlyEnd).toMatchObject({ perfect: false, endBonus: 3_900 });
    expect(nearly.impactScore + nearly.groupBonusPaid + nearlyEnd.endBonus).toBe(11_800);
  });

  it('adds up to 19,000 for a perfect first challenge stage', () => {
    const state = challengeState();
    for (let group = 0; group < 5; group += 1) {
      for (let hit = 0; hit < 8; hit += 1) recordChallengeHit(state, group);
    }
    const end = endChallengeStage(state, rules);
    expect([state.impactScore, state.groupBonusPaid, end.endBonus]).toEqual([4_000, 5_000, 10_000]);
    expect(state.impactScore + state.groupBonusPaid + end.endBonus).toBe(19_000);
  });

  it('pays the end award once, however often the stage is closed', () => {
    const state = challengeState();
    for (let group = 0; group < 5; group += 1) {
      for (let hit = 0; hit < 8; hit += 1) recordChallengeHit(state, group);
    }
    expect(endChallengeStage(state, rules).endBonus).toBe(10_000);
    expect(endChallengeStage(state, rules).endBonus).toBe(0);
    expect(endChallengeStage(state, rules).perfect).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* In the world                                                                 */
/* -------------------------------------------------------------------------- */

/** Run a world to the end of its stage, or until `limit` steps have passed. */
function runToStageEnd(world: World, limit = 3_000): ReturnType<typeof eventsOfType> {
  const seen: ReturnType<typeof eventsOfType> = [];
  for (let i = 0; i < limit; i += 1) {
    const events = stepWorld(world, FIRE);
    seen.push(...events);
    if (events.some((event) => event.type === 'challenge-ended')) break;
  }
  return seen;
}

describe('a challenge stage in the world', () => {
  it('knows it is one from the cadence, on the stage the pack sequences', () => {
    expect(createWorld({ rules, stages, stage: 3 }).challenge?.ordinal).toBe(0);
    expect(createWorld({ rules, stages, stage: 4 }).challenge).toBeUndefined();
    expect(createWorld({ rules, stages, stage: 7 }).challenge?.ordinal).toBe(1);
  });

  it('runs neither formation motion, because nothing settles into one', () => {
    const world = createWorld({ rules, stages, stage: 3 });
    for (let i = 0; i < 600; i += 1) stepWorld(world, FIRE);
    expect(world.formation?.motion).toBe('still');
    expect(world.formation?.swayOffset).toBe(0);
    expect(world.formation?.breatheStep).toBe(0);
  });

  it('lets its enemies leave rather than take a formation slot', () => {
    // A challenge script ends off screen, so its flyers leave. They own no slot
    // either — forty of them would have to claim forty that no wave fills.
    const world = createWorld({ rules, stages, stage: 3 });
    expect(world.fleet.enemies.every((enemy) => !enemy.homes)).toBe(true);
    expect(world.fleet.enemies.every((enemy) => enemy.home === NO_SLOT)).toBe(true);

    const events = [];
    for (let i = 0; i < 500; i += 1) events.push(...stepWorld(world, 0));

    // Leaving is reported as a departure, never as a kill: nothing was shot, so
    // nothing scored and the hit count stays at zero.
    const departed = eventsOfType(events, 'enemy-departed');
    expect(departed).toHaveLength(8);
    expect(eventsOfType(events, 'target-destroyed')).toHaveLength(0);
    expect(world.score).toBe(0);
    expect(world.challenge?.hits).toBe(0);
    expect(world.fleet.enemies.some((enemy) => enemy.state === 'home')).toBe(false);

    // Gone means gone: off the field, out of reach of a shot, and drawn no more
    // than a `standby` one is (`src/render/scene.ts`).
    const gone = departed.map((event) => world.fleet.enemies[event.targetId]!);
    expect(gone.some(isTargetable)).toBe(false);
    expect(aliveEnemies(world.fleet.enemies)).toHaveLength(32);
  });

  it('ends once the last enemy is gone, even if none was ever hit', () => {
    // "Empty" is destroyed *or* flown away: forty enemies that sailed past are
    // alive somewhere off screen, and waiting for them to die waits for ever.
    const world = createWorld({ rules, stages, stage: 3 });
    const events = [];
    for (let i = 0; i < 3_000; i += 1) {
      events.push(...stepWorld(world, 0));
      if (events.some((event) => event.type === 'challenge-ended')) break;
    }
    const ended = eventsOfType(events, 'challenge-ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ hits: 0, total: 40, perfect: false, endBonus: 0 });
    expect(world.score).toBe(0);
    expect(world.stage).toBe(4);
  });

  it('raises the ordinary bonus branch, not the perfect one, when one escapes', () => {
    // The stage-3 script is clearable from a standstill, so to miss one the
    // fighter has to hold its fire for a while: the whole first group flies past
    // in the first 500 steps.
    const world = createWorld({ rules, stages, stage: 3 });
    const events = [];
    for (let i = 0; i < 3_000; i += 1) {
      events.push(...stepWorld(world, i < 500 ? 0 : FIRE));
      if (events.some((event) => event.type === 'challenge-ended')) break;
    }
    const ended = eventsOfType(events, 'challenge-ended')[0];
    expect(ended?.perfect).toBe(false);
    expect(ended?.hits).toBeLessThan(40);
    expect(eventsOfType(events, 'challenge-perfect')).toHaveLength(0);
    const bonus = eventsOfType(events, 'challenge-bonus');
    expect(bonus).toHaveLength(1);
    expect(bonus[0]?.bonus).toBe(100 * (ended?.hits ?? 0));
  });

  it('scores every kill at the stage’s own award, whatever alien it was', () => {
    // The stage mixes two aliens worth 50 and 80 elsewhere; on a challenge stage
    // the score group is the stage's, so both are worth 100 here and 160 on the
    // next challenge stage.
    for (const [stage, award] of [
      [3, 100],
      [7, 160],
    ] as const) {
      const world = createWorld({ rules, stages, stage });
      const events = runToStageEnd(world);
      const destroyed = eventsOfType(events, 'target-destroyed');
      expect(new Set(destroyed.map((event) => event.alienId)).size).toBeGreaterThan(1);
      expect(new Set(destroyed.map((event) => event.score))).toEqual(new Set([award]));
    }
  });

  it('keeps the group bonus a separate award from the kill that triggered it', () => {
    // Every bonus in the original is one channel of 100-point units arriving
    // beside the kill, so `target-destroyed` reports the enemy's value and the
    // group bonus is its own event and its own score delta.
    const world = createWorld({ rules, stages, stage: 3 });
    const events = runToStageEnd(world);
    const groups = eventsOfType(events, 'challenge-group-cleared');
    expect(groups.map((event) => event.group)).toEqual([0, 1, 2, 3, 4]);
    expect(groups.every((event) => event.bonus === 1_000)).toBe(true);
    const deltas = eventsOfType(events, 'score-changed').map((event) => event.delta);
    expect(deltas.filter((delta) => delta === 1_000)).toHaveLength(5);
  });
});

/**
 * The attack, on a stage that must not have one.
 *
 * `docs/DESIGN.md` section 4: the forty "fly scripted patterns and **never shoot
 * or attack**". Every assertion here is behavioural — what the simulation did
 * over a whole stage — because the failure this guards is not a wrong number but
 * a director that quietly starts working.
 */
describe('a challenge stage does not fight back', () => {
  it('says so once, when the stage is entered', () => {
    expect(createWorld({ rules, stages, stage: 3 }).dive.attacks).toBe(false);
    expect(createWorld({ rules, stages, stage: 4 }).dive.attacks).toBe(true);
  });

  it('never dives, bombs or transforms, for the whole stage', () => {
    const world = createWorld({ rules, stages, stage: 3 });
    const events = runToStageEnd(world);

    expect(eventsOfType(events, 'enemy-dived')).toHaveLength(0);
    expect(eventsOfType(events, 'enemy-fired')).toHaveLength(0);
    expect(eventsOfType(events, 'enemy-transformed')).toHaveLength(0);
    expect(eventsOfType(events, 'player-hit')).toHaveLength(0);
    // Nothing reached the eight-slot pool either, which is the test that would
    // still fail if a bomb were launched on a frame no event was raised for.
    expect(bulletsInFlight(world.enemyBullets)).toBe(0);
    // And the director never even started counting.
    expect(world.dive.armed).toBe(false);
    expect(world.dive.frame).toBe(0);
  });

  it('would bomb without the gate, which is why the gate is not the `armed` flag', () => {
    // The regression this guards, stated as the thing that would happen: a
    // challenge flyer is `entering` for its whole life, and entry bombing applies
    // to exactly that state from stage 2 on. Nothing arms the director on a
    // challenge stage — no `formation-settled`, because the formation never sways
    // — so dives are already impossible; bombing is not, and `armed` would never
    // have caught it.
    expect(allowsEntryBombing(rules, 2)).toBe(true);
    expect(rules.enemies.bombing.entryFromStage).toBeLessThanOrEqual(3);
    for (const stage of CHALLENGE_STAGES) {
      const world = createWorld({ rules, stages, stage });
      expect([stage, world.formation?.motion]).toEqual([stage, 'still']);
      expect([stage, allowsEntryBombing(rules, stage)]).toEqual([stage, false]);
    }
  });

  it('fires no bomb on the second challenge stage either, where the ramp is hotter', () => {
    // Stage 7's difficulty row is not stage 3's, and the aliens it flies are the
    // ones that bomb twice per dive. Same answer.
    const world = createWorld({ rules, stages, stage: 7 });
    const events = runToStageEnd(world);
    expect(eventsOfType(events, 'enemy-fired')).toHaveLength(0);
    expect(eventsOfType(events, 'enemy-dived')).toHaveLength(0);
    expect(bulletsInFlight(world.enemyBullets)).toBe(0);
  });
});

describe('extra lives in play', () => {
  it('awards against the threshold set the run’s starting fighters select', () => {
    // A five-fighter cabinet gets 30,000 / 120,000 / every 120,000, not the
    // three-fighter default. The world remembers what it started with precisely
    // so a whole run cannot be scored against the wrong table.
    const three = createWorld({ rules, stages });
    const five = createWorld({ rules, stages, lives: 5 });
    expect([three.startingLives, five.startingLives]).toEqual([3, 5]);
    expect([three.lives.reserve, five.lives.reserve]).toEqual([2, 4]);
  });

  it('pays both awards when one bonus crosses two thresholds', () => {
    // A perfect first challenge stage is 19,000 in one stage. On a cabinet whose
    // thresholds sit close together, the last award of it crosses two at once —
    // and a crossing test that fired once per step would swallow the second.
    const tight = structuredClone(quickRunRules());
    tight.extraLives.setting = undefined;
    tight.extraLives.award = { mode: 'thresholds', first: 100, second: 200, repeat: 100 };
    const world = createWorld({ rules: tight, stages, stage: 3 });
    const events = runToStageEnd(world);
    const awards = eventsOfType(events, 'extra-life');
    // 19,000 at one award per 100 points from 100: the arithmetic is the rules
    // layer's, and what this asserts is that the sim pays every one it earns.
    expect(awards).toHaveLength(190);
    expect(world.lives.reserve).toBe(tight.lives.default - 1 + 190);
    expect(world.lives.bonusesAwarded).toBe(190);
  });

  it('awards nothing on a cabinet set to no bonus at all', () => {
    const none = structuredClone(rules);
    none.extraLives.setting = undefined;
    none.extraLives.award = { mode: 'none' };
    const world = createWorld({ rules: none, stages, stage: 3 });
    const events = runToStageEnd(world);
    expect(eventsOfType(events, 'extra-life')).toHaveLength(0);
    expect(world.lives.reserve).toBe(rules.lives.default - 1);
  });
});

describe('a stage the pack sequences nowhere', () => {
  it('puts nothing on the field rather than falling back to a combat stage', () => {
    // The temporary bridge that played a normal stage on a challenge stage number
    // is gone. A pack with no challenge scripts now shows an empty stage 3, which
    // is loud; a combat stage quietly standing in for one was not.
    const bare = stageSourceOf({
      id: 'only',
      formation: 'classic40',
      waves: [{ at: 0, entryPath: 'entry-side-file', slots: [{ alien: 'drone', home: 0 }] }],
    });
    const world = createWorld({ rules, stages: bare, stage: 3 });
    // `stageSourceOf` answers every stage, so this is about the real source:
    expect(world.content).toBeDefined();
    const noChallenge = createWorld({ rules, stages: { stageFor: () => undefined }, stage: 3 });
    expect(noChallenge.content).toBeUndefined();
    expect(noChallenge.fleet.enemies).toHaveLength(0);
    for (let i = 0; i < 120; i += 1) stepWorld(noChallenge, FIRE);
    expect(noChallenge.stage).toBe(3);
  });
});
