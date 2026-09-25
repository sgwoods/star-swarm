/**
 * Rules fixtures for the tests.
 *
 * Two of them, and the difference matters:
 *
 * - {@link classicRules} is the *shipped* pack, read off disk through the real
 *   loader. Anything asserting arcade behaviour uses it, because a test that
 *   builds its own rules object proves the test's numbers rather than the
 *   pack's.
 * - {@link minimalRules} is the least a `rules.json` can say and still load. It
 *   exists so a schema or loader test can state one field and leave everything
 *   else alone, and so adding a required field is one edit rather than five.
 */

import { resolve } from 'node:path';

import { readPackSource } from '../../src/content/fs.js';
import { loadPackOrThrow } from '../../src/content/loader.js';
import type { Rules } from '../../src/content/schema.js';

const CLASSIC_DIR = resolve(import.meta.dirname, '..', '..', 'packs', 'classic');

let cached: Rules | undefined;

/** The shipped Classic rules, loaded once per test process. */
export function classicRules(): Rules {
  if (cached !== undefined) return cached;
  const { source, errors } = readPackSource(CLASSIC_DIR);
  if (source === undefined) {
    throw new Error(`could not read ${CLASSIC_DIR}: ${JSON.stringify(errors)}`);
  }
  const rules = loadPackOrThrow(source).rules;
  if (rules === undefined) throw new Error('the classic pack has no rules.json');
  cached = rules;
  return rules;
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
