/**
 * Content fixtures for the tests.
 *
 * Three kinds, and the differences matter:
 *
 * - {@link classicRules} and {@link classicStages} are the *shipped* pack, read
 *   off disk through the real loader. Anything asserting arcade behaviour uses
 *   them, because a test that builds its own rules object proves the test's
 *   numbers rather than the pack's.
 * - {@link minimalRules} is the least a `rules.json` can say and still load. It
 *   exists so a schema or loader test can state one field and leave everything
 *   else alone, and so adding a required field is one edit rather than five.
 * - {@link classicStagesWith} is the shipped content resolved against rules a test
 *   has bent, which is what a test that moves the challenge cadence needs: the
 *   stage source reads rules too, and two sets silently disagree.
 * - {@link stageSourceOf} wraps a hand-written stage in a {@link StageSource}, for
 *   a test that needs a shape the Classic pack does not ship — a challenge stage,
 *   a one-enemy wave, a formation with no grid.
 * - {@link quickRunRules} is the Classic rules bent so a whole run fits in a test:
 *   one fighter, and a shot that hits whatever is on the field. The front-end
 *   tests need a game that scores and then *ends*, not a realistic one.
 */

import { resolve } from 'node:path';

import { readPackSource } from '../../src/content/fs.js';
import type { LoadedPack } from '../../src/content/loader.js';
import { loadPackOrThrow } from '../../src/content/loader.js';
import { createRegistry } from '../../src/content/registry.js';
import type { Formation, Rules, Stage } from '../../src/content/schema.js';
import { formationSchema, stageSchema } from '../../src/content/schema.js';
import type { StageSource } from '../../src/content/stages.js';
import { createStageSource, resolveStageContent } from '../../src/content/stages.js';

const CLASSIC_DIR = resolve(import.meta.dirname, '..', '..', 'packs', 'classic');

let cachedPack: LoadedPack | undefined;

/** The shipped Classic pack, loaded once per test process. */
export function classicPack(): LoadedPack {
  if (cachedPack !== undefined) return cachedPack;
  const { source, errors } = readPackSource(CLASSIC_DIR);
  if (source === undefined) {
    throw new Error(`could not read ${CLASSIC_DIR}: ${JSON.stringify(errors)}`);
  }
  cachedPack = loadPackOrThrow(source);
  return cachedPack;
}

/** The shipped Classic rules. */
export function classicRules(): Rules {
  const rules = classicPack().rules;
  if (rules === undefined) throw new Error('the classic pack has no rules.json');
  return rules;
}

/** What plays as each stage in the shipped Classic pack. */
export function classicStages(): StageSource {
  return createStageSource(createRegistry([classicPack()]));
}

/**
 * The shipped content, resolved against rules a test has bent.
 *
 * A stage *number* means nothing without rules — the challenge cadence decides
 * which half of the sequence it reads — so a test that moves the cadence has to
 * move it for the stage source too. {@link classicStages} reads the pack's own
 * rules, and handing the world one set while the source uses another silently
 * plays a combat stage where a challenge stage was asked for.
 */
export function classicStagesWith(rules: Rules): StageSource {
  const registry = createRegistry([classicPack()]);
  return createStageSource({
    manifest: registry.manifest,
    rules,
    stages: registry.stages,
    formations: registry.formations,
    aliens: registry.aliens,
    paths: registry.paths,
  });
}

/** The shipped `classic40` formation. */
export function classicFormation(): Formation {
  const formation = classicPack().formations.get('classic40');
  if (formation === undefined) throw new Error('the classic pack has no classic40 formation');
  return formation;
}

/**
 * A stage source over one hand-written stage, using the Classic pack's aliens and
 * paths unless the caller supplies its own.
 *
 * Takes the documents as plain JSON and parses them, so a fixture states only the
 * fields it cares about and picks up every schema default — the same reason
 * {@link minimalRules} is JSON rather than a parsed value.
 */
export function stageSourceOf(
  stage: Record<string, unknown>,
  formation?: Record<string, unknown>,
): StageSource {
  const pack = classicPack();
  const parsed: Stage = stageSchema.parse(stage);
  const formations = new Map(pack.formations);
  if (formation !== undefined) {
    const value = formationSchema.parse(formation);
    formations.set(value.id, value);
  }
  const content = resolveStageContent({ ...pack, formations }, parsed);
  if (content === undefined) throw new Error(`no formation "${parsed.formation}"`);
  return { stageFor: () => content };
}

/**
 * The smallest document `rulesSchema` accepts, as plain JSON — not parsed, so a
 * test can hand it straight to the schema, to the loader, or to a file on disk.
 */
export function minimalRules(id = 'r'): Record<string, unknown> {
  return {
    id,
    playfield: { width: 224, height: 288 },
    lives: { default: 3 },
    extraLives: { award: { mode: 'none' } },
    player: {
      stepPattern: [1, 2],
      maxShots: 2,
      y: 248,
      width: 16,
      height: 16,
      minX: 0,
      maxX: 207,
      hitWindow: { dxMin: -6, dxMax: 6, dyMin: -6, dyMax: 6 },
      respawnFrames: 90,
      shot: {
        speed: 6,
        width: 1,
        height: 4,
        windows: {
          single: [{ dxMin: -5, dxMax: 5, dyMin: -6, dyMax: 6 }],
          dual: [{ dxMin: -6, dxMax: 4, dyMin: -6, dyMax: 6 }],
        },
      },
    },
    enemies: { maxBullets: 8, bullet: { speed: 2, width: 1, height: 3 } },
    challengeStages: { firstStage: 3, everyStages: 4 },
    difficulty: { defaultRank: 'A', ranks: { A: { stageTable: { rows: [] } } } },
  };
}

/**
 * Classic rules bent so a whole run fits inside a test: **one** fighter, and a
 * shot whose hit window covers the playfield, so anything targetable on the
 * field dies to the next shot fired.
 *
 * A world on these rules scores within a few dozen steps of the first wave
 * launching. Ending it is the caller's job and takes one line — nothing in the
 * simulation fires at the player yet, so `tests/unit/flow.test.ts` launches an
 * enemy bullet into `world.enemyBullets` the way `tests/unit/world.test.ts`
 * does, and with one fighter that bullet is the game over.
 *
 * Deliberately not a hand-written rules object: it is the shipped pack with
 * three fields moved, so a schema change still reaches it.
 */
export function quickRunRules(): Rules {
  const rules = structuredClone(classicRules());
  const everywhere = { dxMin: -224, dxMax: 224, dyMin: -288, dyMax: 288 };
  rules.lives.default = 1;
  rules.player.shot.windows.single = [{ ...everywhere }];
  rules.player.shot.windows.dual = [{ ...everywhere }];
  return rules;
}
