import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveStageId } from '../../src/content/rules.js';
import { parseReplay } from '../../src/engine/replay.js';
import { eventsOfType } from '../../src/sim/events.js';
import { fingerprintWorld, stepWorld } from '../../src/sim/world.js';
import { loadLabGames } from '../../src/ui/lab/games.js';
import { createStageRun, stagePlays } from '../../src/ui/lab/stage-run.js';

/**
 * The stage preview in `/lab` is the game's own run, not a picture of one.
 *
 * `src/ui/lab/stage-run.ts` builds a world with the game's rules, rank, fighters
 * and stage source and steps it with the controls untouched — which is precisely
 * how the `stage-entry` golden was recorded. So the strongest statement the lab
 * can make about itself is checkable: run stage 1 of the shipped Classic game on
 * the golden's seed, and the world lands on the golden's recorded final state to
 * the last bit. If the lab ever previewed a stage differently from the game —
 * another rank, another fighter count, a schedule of its own — this is what fails.
 */

const loaded = loadLabGames();
if (!loaded.ok) throw new Error(`the lab's games do not load: ${JSON.stringify(loaded.errors)}`);
const games = loaded.games;
const classic = games.find((game) => game.id === 'classic');
if (classic === undefined) throw new Error('the build ships no classic game');

const GOLDEN = parseReplay(
  readFileSync(resolve(import.meta.dirname, 'golden', 'stage-entry.replay.json'), 'utf8'),
);

describe('the lab runs a stage as the game does', () => {
  const first = resolveStageId(classic.registry.manifest, classic.rules, 1);
  if (first === undefined) throw new Error('Classic plays nothing as stage 1');

  it('lands on the stage-entry golden, bit for bit', () => {
    const run = createStageRun(classic, { stageId: first, seed: String(GOLDEN.seed) });
    expect(run.number).toBe(1);
    expect(run.inSequence).toBe(true);
    run.seek(run.length);
    // The timeline stops a little after the settle; the golden runs on.
    const { world } = run;
    while (world.step < GOLDEN.steps) stepWorld(world, 0);
    expect(fingerprintWorld(world)).toBe(GOLDEN.finalState);
  });

  it('steps back to exactly the state it stepped forward through', () => {
    const run = createStageRun(classic, { stageId: first });
    run.seek(400);
    const forward = fingerprintWorld(run.world);
    run.seek(run.length);
    run.seek(400);
    expect(run.frame).toBe(400);
    expect(fingerprintWorld(run.world)).toBe(forward);
  });

  it("reads the schedule off the simulation's own fleet, and stops where the stage settles", () => {
    const run = createStageRun(classic, { stageId: first });
    const launched = run.events.filter((entry) => entry.event.type === 'enemy-launched');
    expect(run.launches).toHaveLength(launched.length);
    for (const launch of run.launches) {
      // The round robin may land a launch up to `updatePhases` frames late.
      expect(launch.launched).toBeGreaterThanOrEqual(launch.due);
      expect(launch.launched).toBeLessThanOrEqual(launch.due + classic.rules.enemies.updatePhases);
    }
    expect(run.waves.map((wave) => wave.at)).toEqual(
      classic.registry.stages.get(first)?.waves.map((wave) => wave.at),
    );
    expect(run.end).toBe('settled');
    expect(run.settledAt).toBeDefined();
    expect(
      eventsOfType(
        run.events.map((entry) => entry.event),
        'formation-settled',
      ),
    ).toHaveLength(1);
  });

  it('stops a challenge stage on the frame before it clears, so the next never shows', () => {
    const challenge = resolveStageId(
      classic.registry.manifest,
      classic.rules,
      classic.rules.challengeStages.firstStage,
    );
    if (challenge === undefined) throw new Error('Classic plays no challenge stage');
    const run = createStageRun(classic, { stageId: challenge });
    expect(run.end).toBe('cleared');
    run.seek(run.length);
    expect(run.world.stage).toBe(run.number);
    expect(run.world.fleet.enemies.every((enemy) => enemy.state !== 'home')).toBe(true);
  });
});

describe('which stage numbers a document plays as', () => {
  it.each(games.map((game) => [game.id, game] as const))(
    '%s: every number up to the horizon resolves to the document listed for it',
    (_id, game) => {
      for (const rank of Object.keys(game.rules.difficulty.ranks)) {
        const { numbers, horizon } = stagePlays(game, rank);
        for (let stage = 1; stage <= horizon; stage += 1) {
          const id = resolveStageId(game.registry.manifest, game.rules, stage, rank);
          if (id === undefined) continue;
          expect(numbers.get(id)).toContain(stage);
        }
      }
    },
  );

  it('previews a document the sequence never plays on its own, and says so', () => {
    const ranks = Object.keys(classic.rules.difficulty.ranks);
    // Classic's rank A never plays script row 5; another rank does.
    const unplayed = [...classic.registry.stages.keys()].find(
      (id) => !stagePlays(classic, 'A').numbers.has(id),
    );
    expect(unplayed).toBeDefined();
    if (unplayed === undefined) return;
    const run = createStageRun(classic, { stageId: unplayed, rank: 'A' });
    expect(run.inSequence).toBe(false);
    expect(run.world.content?.stage.id).toBe(unplayed);
    expect(ranks.some((rank) => stagePlays(classic, rank).numbers.has(unplayed))).toBe(true);
  });
});
