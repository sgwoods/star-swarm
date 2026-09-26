import { describe, expect, it } from 'vitest';

import { createRegistry } from '../../src/content/registry.js';
import type { StageSource } from '../../src/content/stages.js';
import { resolveStageContent } from '../../src/content/stages.js';
import { EMPTY_FRAME } from '../../src/engine/input.js';
import { eventsOfType, type SimEvent } from '../../src/sim/events.js';
import { createWorld, stepWorld } from '../../src/sim/world.js';
import { classicPack, classicRules } from '../helpers/rules.js';

/**
 * Every normal stage the Classic pack ships, flown end to end with the controls
 * untouched.
 *
 * `tests/unit/classic-content.test.ts` checks each stage document against
 * `docs/reference/arcade-reference.md` section 5 — the composition, the homes, the
 * roles. That is not the same as checking it *plays*: a stage can be perfectly
 * composed and still strand an enemy, because whether a wave arrives depends on its
 * launch frames, its path and the sway it is homing into, none of which the schema
 * sees. `tests/sim/golden/stage-entry` covers stage 1 to the byte; this covers the
 * rest to the property, which is the part that generalises to stage 9 and beyond.
 *
 * Everything here is measured **on the frame the formation settles**, not at the end
 * of the run. Diving begins from that frame, so after it an enemy being away from
 * its slot is the dive task working correctly rather than an entry that stranded
 * one.
 *
 * The one golden and this file divide the work on purpose. Recording a golden per
 * stage would make every choreography tweak a nine-file diff and say nothing extra.
 */

const pack = classicPack();
const rules = classicRules();
const registry = createRegistry([pack]);

/** Long enough for the slowest entry plus its sway-to-zero exit, with room over. */
const STEPS = 2_000;

/** One stage source per stage document, so a case is one stage and nothing else. */
const cases = [...new Set(pack.manifest.stageSequence.normal.rows)].map((id) => {
  const document = pack.stages.get(id);
  if (document === undefined) throw new Error(`the classic pack has no ${id}`);
  const content = resolveStageContent(registry, document);
  if (content === undefined) throw new Error(`${id} names a formation the pack does not have`);
  const stages: StageSource = { stageFor: () => content };
  return { id, stages };
});

describe.each(cases)('normal stage $id', ({ id, stages }) => {
  const world = createWorld({ seed: `entry-${id}`, rules, stages });
  const events: SimEvent[] = [...world.events];
  /**
   * The fleet on the frame the sway settles, which is the frame this file is
   * about. Everything after it belongs to the dive task: enemies leave the
   * formation, so "all forty are home" is only ever true up to here.
   */
  let settled: { readonly state: string; readonly home: number }[] | undefined;
  for (let step = 0; step < STEPS; step += 1) {
    const raised = stepWorld(world, EMPTY_FRAME);
    events.push(...raised);
    if (settled === undefined && eventsOfType(raised, 'formation-settled').length > 0) {
      settled = world.fleet.enemies.map((enemy) => ({ state: enemy.state, home: enemy.home }));
    }
  }

  it('launches all forty and lands each one in its own slot', () => {
    expect(eventsOfType(events, 'enemy-launched')).toHaveLength(40);
    expect(settled).toBeDefined();
    expect(settled?.every((enemy) => enemy.state === 'home')).toBe(true);
    expect(new Set(settled?.map((enemy) => enemy.home)).size).toBe(40);
  });

  it('settles once, centred, and hands over to the breathe', () => {
    // The sway's exit is two-part: it stops the next time the offset passes through
    // zero *after* the last wave arrives, which is what leaves the formation exactly
    // centred before anything dives. A stage whose last wave never arrives never
    // raises this, so the count is the real assertion.
    expect(eventsOfType(events, 'formation-settled')).toHaveLength(1);
  });

  it('puts all four wardens on the field together', () => {
    const wardens = eventsOfType(events, 'enemy-launched').filter(
      (event) => event.alienId === 'warden',
    );
    expect(wardens).toHaveLength(4);
    // `db_attk_wav_IDs` puts them in wave 2 on every stage, so they launch from one
    // wave however the stage choreographs it.
    expect(new Set(wardens.map((event) => event.wave)).size).toBe(1);
  });
});
