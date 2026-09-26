import { describe, expect, it } from 'vitest';

import { waveSchema } from '../../src/content/schema.js';
import type { StageContent } from '../../src/content/stages.js';
import {
  createFleet,
  enemyScore,
  enemySprite,
  isTargetable,
  launchEnemy,
  stepFleet,
  StageContentError,
  waveLaunchFrames,
} from '../../src/sim/enemies.js';
import {
  completeEntry,
  createFormation,
  slotPosition,
  stepFormation,
} from '../../src/sim/formation.js';
import { classicPack, classicRules, stageSourceOf } from '../helpers/rules.js';

/**
 * Entry waves, the four-phase update and slot homing.
 *
 * `docs/reference/arcade-reference.md` section 5 is the authority on the
 * choreography: five waves of eight, mixed types within a wave, a per-alien
 * mirror flag and a per-pair trailing flag, and a `home` index that makes the
 * waves identity-addressed. Section 2 is the authority on the update cadence.
 */

const rules = classicRules();
const pack = classicPack();

function stageContent(stage: Record<string, unknown>): StageContent {
  const content = stageSourceOf(stage).stageFor(1);
  if (content === undefined) throw new Error('fixture resolved to nothing');
  return content;
}

/** Step a fleet and its formation together, exactly as the world does. */
function run(
  content: StageContent,
  frames: number,
  kind: 'normal' | 'challenge' = 'normal',
): {
  readonly fleet: ReturnType<typeof createFleet>;
  readonly state: ReturnType<typeof createFormation>;
  readonly launchedOn: Map<number, number>;
  readonly homedOn: Map<number, number>;
} {
  const state = createFormation(content.formation, rules, kind);
  const fleet = createFleet(content, rules);
  const launchedOn = new Map<number, number>();
  const homedOn = new Map<number, number>();

  for (let i = 0; i < frames; i += 1) {
    stepFormation(state, rules);
    const step = stepFleet(fleet, content, state, rules);
    for (const enemy of step.launched) launchedOn.set(enemy.id, fleet.frame);
    for (const enemy of step.homed) homedOn.set(enemy.id, fleet.frame);
  }
  return { fleet, state, launchedOn, homedOn };
}

/** One wave of eight drones on one path, for tests about scheduling alone. */
function eightDrones(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'fixture',
    formation: 'classic40',
    waves: [
      {
        at: 0,
        entryPath: 'entry-side-file',
        spacing: 10,
        slots: Array.from({ length: 8 }, () => ({ alien: 'drone' })),
        ...overrides,
      },
    ],
  };
}

describe('wave composition', () => {
  it('builds one enemy per slot, in the order the stage lists them', () => {
    const content = stageContent({
      id: 'mixed',
      formation: 'classic40',
      waves: [
        {
          at: 0,
          entryPath: 'entry-side-file',
          slots: [
            { alien: 'warden', home: 0 },
            { alien: 'wing', home: 4 },
            { alien: 'drone', home: 20 },
          ],
        },
      ],
    });
    const fleet = createFleet(content, rules);
    expect(fleet.enemies.map((enemy) => enemy.alienId)).toEqual(['warden', 'wing', 'drone']);
    expect(fleet.enemies.map((enemy) => enemy.role)).toEqual(['warden', 'wing', 'drone']);
    // A wave is a list of slots, not a type plus a count: the mix survives.
    expect(new Set(fleet.enemies.map((enemy) => enemy.role)).size).toBe(3);
  });

  it('carries each slot’s own mirror and trailing flags', () => {
    const content = stageContent({
      id: 'flags',
      formation: 'classic40',
      waves: [
        {
          at: 0,
          entryPath: 'entry-long-row',
          spacing: 10,
          slots: [
            { alien: 'drone' },
            { alien: 'drone', mirror: true },
            { alien: 'drone', trailing: true },
            { alien: 'drone', mirror: true, trailing: true },
          ],
        },
      ],
    });
    const fleet = createFleet(content, rules);
    expect(fleet.enemies.map((enemy) => enemy.mirror)).toEqual([false, true, false, true]);
    expect(fleet.enemies.map((enemy) => enemy.trailing)).toEqual([false, false, true, true]);
  });

  it('starts every enemy in standby: nothing is on the field until it launches', () => {
    const fleet = createFleet(stageContent(eightDrones()), rules);
    expect(fleet.enemies.every((enemy) => enemy.state === 'standby')).toBe(true);
    expect(fleet.enemies.every((enemy) => !isTargetable(enemy))).toBe(true);
    expect(fleet.entryComplete).toBe(false);
  });

  it('takes hp and the hit sprite from the alien, so a warden needs two hits', () => {
    const content = stageContent({
      id: 'warden',
      formation: 'classic40',
      waves: [{ at: 0, entryPath: 'entry-side-file', slots: [{ alien: 'warden', home: 0 }] }],
    });
    const enemy = createFleet(content, rules).enemies[0];
    expect(enemy?.hitsRemaining).toBe(2);
    expect(enemySprite(enemy!)).toBe('warden');
    enemy!.hitsRemaining = 1;
    expect(enemySprite(enemy!)).toBe('warden-hit');
  });
});

describe('per-slot addressing', () => {
  it('gives each enemy the home its slot names, not the next free one', () => {
    const content = stageContent({
      id: 'homes',
      formation: 'classic40',
      waves: [
        {
          at: 0,
          entryPath: 'entry-side-file',
          slots: [
            { alien: 'drone', home: 39 },
            { alien: 'drone', home: 20 },
            { alien: 'drone', home: 31 },
          ],
        },
      ],
    });
    expect(createFleet(content, rules).enemies.map((enemy) => enemy.home)).toEqual([39, 20, 31]);
  });

  it('falls back to the next free slot of the alien’s role when home is omitted', () => {
    const fleet = createFleet(stageContent(eightDrones()), rules);
    // Drone slots begin at 20 in `classic40`; nothing claimed one explicitly.
    expect(fleet.enemies.map((enemy) => enemy.home)).toEqual([20, 21, 22, 23, 24, 25, 26, 27]);
  });

  it('does not hand a fallback a slot another wave claimed by name', () => {
    const content = stageContent({
      id: 'mixedhomes',
      formation: 'classic40',
      waves: [
        { at: 0, entryPath: 'entry-side-file', slots: [{ alien: 'drone' }, { alien: 'drone' }] },
        { at: 60, entryPath: 'entry-side-file', slots: [{ alien: 'drone', home: 20 }] },
      ],
    });
    // Slot 20 is spoken for, so the two unnamed drones take 21 and 22.
    expect(createFleet(content, rules).enemies.map((enemy) => enemy.home)).toEqual([21, 22, 20]);
  });

  it('refuses a stage with more aliens of a role than the formation has slots', () => {
    const content = stageContent({
      id: 'toomany',
      formation: 'classic40',
      waves: [
        {
          at: 0,
          entryPath: 'entry-side-file',
          slots: Array.from({ length: 5 }, () => ({ alien: 'warden' })),
        },
      ],
    });
    expect(() => createFleet(content, rules)).toThrow(StageContentError);
  });

  it('names the missing alien rather than quietly dropping the slot', () => {
    const content: StageContent = {
      ...stageContent(eightDrones()),
      aliens: new Map(),
    };
    expect(() => createFleet(content, rules)).toThrow(/no alien "drone"/);
  });
});

describe('launch scheduling', () => {
  const parse = (wave: Record<string, unknown>) => waveSchema.parse(wave);

  it('launches four mirrored pairs one spacing apart', () => {
    const wave = parse({
      at: 100,
      entryPath: 'p',
      spacing: 12,
      slots: Array.from({ length: 8 }, (_unused, index) => ({
        alien: 'drone',
        mirror: index % 2 === 1,
      })),
    });
    expect(waveLaunchFrames(wave)).toEqual([100, 100, 112, 112, 124, 124, 136, 136]);
  });

  it('turns a wave of trailing seconds into one single file', () => {
    const wave = parse({
      at: 0,
      entryPath: 'p',
      spacing: 10,
      slots: Array.from({ length: 8 }, (_unused, index) => ({
        alien: 'drone',
        trailing: index % 2 === 1,
      })),
    });
    expect(waveLaunchFrames(wave)).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
  });

  it('ignores trailing on the first of a pair, as the ROM flag does', () => {
    const wave = parse({
      at: 0,
      entryPath: 'p',
      spacing: 10,
      slots: [
        { alien: 'drone', trailing: true },
        { alien: 'drone' },
        { alien: 'drone', trailing: true },
        { alien: 'drone' },
      ],
    });
    expect(waveLaunchFrames(wave)).toEqual([0, 0, 10, 10]);
  });
});

describe('the four-phase update', () => {
  it('gives each enemy one phase of the round robin, in creation order', () => {
    expect(rules.enemies.updatePhases).toBe(4);
    const fleet = createFleet(stageContent(eightDrones()), rules);
    expect(fleet.enemies.map((enemy) => enemy.phase)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });

  it('advances state only on an enemy’s own phase, so a launch lands on it', () => {
    const content = stageContent(eightDrones({ at: 0, spacing: 0 }));
    const { launchedOn } = run(content, 20);
    // All eight were due at frame 0; each waited for its own phase to come round.
    expect([...launchedOn.values()].sort((a, b) => a - b)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    for (const [id, frame] of launchedOn) {
      const enemy = content.stage.waves[0]?.slots[id];
      expect(enemy).toBeDefined();
      expect(frame % rules.enemies.updatePhases).toBe(id % rules.enemies.updatePhases);
    }
  });

  it('never advances an enemy’s state twice in one turn of the robin', () => {
    const content = stageContent(eightDrones({ at: 0, spacing: 0 }));
    const state = createFormation(content.formation, rules);
    const fleet = createFleet(content, rules);
    const advances = new Map<number, number>();
    for (let i = 0; i < rules.enemies.updatePhases; i += 1) {
      stepFormation(state, rules);
      for (const enemy of stepFleet(fleet, content, state, rules).launched) {
        advances.set(enemy.id, (advances.get(enemy.id) ?? 0) + 1);
      }
    }
    expect([...advances.values()].every((count) => count === 1)).toBe(true);
    expect(advances.size).toBe(fleet.enemies.length);
  });

  it('moves positions every frame even though state waits its turn', () => {
    const content = stageContent(eightDrones({ at: 0, spacing: 0 }));
    const state = createFormation(content.formation, rules);
    const fleet = createFleet(content, rules);
    for (let i = 0; i < 6; i += 1) {
      stepFormation(state, rules);
      stepFleet(fleet, content, state, rules);
    }
    const flying = fleet.enemies.filter((enemy) => enemy.state === 'entering');
    expect(flying.length).toBeGreaterThan(0);

    const before = flying.map((enemy) => `${String(enemy.x)},${String(enemy.y)}`);
    stepFormation(state, rules);
    stepFleet(fleet, content, state, rules);
    const after = flying.map((enemy) => `${String(enemy.x)},${String(enemy.y)}`);
    // Every one of them moved, not a quarter of them.
    expect(after.every((value, index) => value !== before[index])).toBe(true);
  });
});

describe('slot homing', () => {
  it('flies the whole stage in and parks all forty enemies on their own slots', () => {
    const content = stageContent({ id: 'stage-1', formation: 'classic40', waves: [] });
    const real = pack.stages.get('stage-1');
    expect(real).toBeDefined();
    const stage: StageContent = { ...content, stage: real! };

    const { fleet, state, homedOn } = run(stage, 1_100);
    expect(fleet.enemies).toHaveLength(40);
    expect(homedOn.size).toBe(40);
    expect(fleet.entryComplete).toBe(true);

    for (const enemy of fleet.enemies) {
      const slot = slotPosition(state, rules, enemy.home);
      expect(enemy.x).toBeCloseTo(slot.x, 6);
      expect(enemy.y).toBeCloseTo(slot.y, 6);
    }
    // Every home is used once: the waves cover the formation exactly.
    expect(new Set(fleet.enemies.map((enemy) => enemy.home)).size).toBe(40);
  });

  it('arrives on its slot while the formation is still swaying', () => {
    const content = stageContent(eightDrones());
    // Stopping before frame 256 keeps the sway mid-swing: the wave is in, but the
    // offset has not passed back through zero yet.
    const { fleet, state, homedOn } = run(content, 240);
    expect(state.motion).toBe('sway');
    expect(state.swayOffset).not.toBe(0);
    expect(homedOn.size).toBe(8);

    for (const enemy of fleet.enemies) {
      expect(enemy.state).toBe('home');
      expect(enemy.x).toBeCloseTo(slotPosition(state, rules, enemy.home).x, 6);
    }
  });

  it('finds its slot from an arbitrary starting position', () => {
    const content = stageContent(eightDrones());
    const state = createFormation(content.formation, rules);
    const fleet = createFleet(content, rules);

    // Nowhere near the path's own start, and different for each.
    const starts: [number, number][] = [
      [8, 24],
      [200, 260],
      [112, 8],
      [0, 144],
      [223, 40],
      [16, 200],
      [180, 120],
      [96, 287],
    ];
    fleet.enemies.forEach((enemy, index) => {
      launchEnemy(fleet, enemy, content, state, rules, starts[index]);
      expect(enemy.x).toBe(starts[index]?.[0]);
      expect(enemy.y).toBe(starts[index]?.[1]);
    });

    for (let i = 0; i < 400; i += 1) {
      stepFormation(state, rules);
      stepFleet(fleet, content, state, rules);
    }
    for (const enemy of fleet.enemies) {
      expect(enemy.state).toBe('home');
      expect(enemy.x).toBeCloseTo(slotPosition(state, rules, enemy.home).x, 6);
      expect(enemy.y).toBeCloseTo(slotPosition(state, rules, enemy.home).y, 6);
    }
  });

  it('tells the formation the entry is over, so the sway can wind down', () => {
    const content = stageContent(eightDrones());
    const { state } = run(content, 240);
    expect(state.entryComplete).toBe(true);
    // Still swaying, because the offset has not passed zero yet: that is the
    // arcade's two-part exit, not a missed transition.
    expect(state.motion).toBe('sway');
  });

  it('follows its slot once home rather than holding a position of its own', () => {
    const content = stageContent(eightDrones());
    const { fleet, state } = run(content, 240);
    const enemy = fleet.enemies[0];
    expect(enemy?.state).toBe('home');

    // The fleet already reported the entry complete; run on until the sway hands
    // over and the breathe is moving the coordinates under the enemy.
    completeEntry(state);
    for (let i = 0; i < 300; i += 1) {
      stepFormation(state, rules);
      stepFleet(fleet, content, state, rules);
    }
    expect(state.motion).toBe('breathe');
    expect(enemy?.x).toBeCloseTo(slotPosition(state, rules, enemy?.home ?? 0).x, 6);
    expect(enemy?.y).toBeCloseTo(slotPosition(state, rules, enemy?.home ?? 0).y, 6);
  });
});

describe('what an enemy is worth', () => {
  /** One drone, launched, so its state can be set by hand. */
  function drone() {
    const content = stageContent(eightDrones());
    const fleet = createFleet(content, rules);
    const enemy = fleet.enemies[0];
    if (enemy === undefined) throw new Error('no enemy');
    return enemy;
  }

  it('doubles the base value unless the enemy is at home or returning', () => {
    const enemy = drone();
    expect(enemy.scoreBase).toBe(50);
    expect(rules.scoring.movingMultiplier).toBe(2);

    enemy.state = 'home';
    expect(enemyScore(enemy)).toBe(50);
    // S3: shot during the entry wave, a drone is 100 — not 50.
    enemy.state = 'entering';
    expect(enemyScore(enemy)).toBe(100);
    // S4: rotating back into its slot, it is 50 again, though visibly moving.
    enemy.state = 'returning';
    expect(enemyScore(enemy)).toBe(50);
  });

  it('reads the base from the alien, so a wing is 80 and 160', () => {
    const content = stageContent({
      id: 'wing',
      formation: 'classic40',
      waves: [{ at: 0, entryPath: 'entry-side-file', slots: [{ alien: 'wing', home: 4 }] }],
    });
    const enemy = createFleet(content, rules).enemies[0];
    if (enemy === undefined) throw new Error('no enemy');
    enemy.state = 'home';
    expect(enemyScore(enemy)).toBe(80);
    enemy.state = 'entering';
    expect(enemyScore(enemy)).toBe(160);
  });
});
