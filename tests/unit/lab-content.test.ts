import { describe, expect, it } from 'vitest';

import type { ParamRamp } from '../../src/audio/synth.js';
import { buildSoundPlan } from '../../src/audio/synth.js';
import { findCouplings } from '../../src/content/couplings.js';
import { resolveLaunchRate } from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import { themedSounds } from '../../src/content/themes.js';
import { alienFacts, diveSetting, flyDive } from '../../src/ui/lab/alien-facts.js';
import { loadLabGames } from '../../src/ui/lab/games.js';
import { auditionOf, soundUses } from '../../src/ui/lab/sound-facts.js';
import { paramAt, pitchRange } from '../../src/ui/lab/sound-preview.js';

/**
 * `/lab` shows what a pack declares and what the game will do with it, and the
 * one thing it must never do is say something of its own. These tests hold the
 * alien and sound views' facts to the game's own answers — the registry's
 * documents by identity, the rules' own resolvers, `themedSounds` — so a lab that
 * started keeping a table, a default or a reading of its own would disagree with
 * one of them here rather than silently on screen. The stage view is held to a
 * golden replay in `tests/sim/lab-stages.test.ts`.
 */

const loaded = loadLabGames();
if (!loaded.ok) throw new Error(`the lab's games do not load: ${JSON.stringify(loaded.errors)}`);
const games = loaded.games;
const classic = games.find((game) => game.id === 'classic');
if (classic === undefined) throw new Error('the build ships no classic game');

describe('the games the lab previews', () => {
  it('are the games the build offers, each with the packs its variant layers', () => {
    expect(games.length).toBeGreaterThan(1);
    for (const game of games) {
      expect(game.registry.packs.map((pack) => pack.id)).toEqual(game.packs);
    }
  });
});

describe('an alien, as the lab describes it', () => {
  const everyAlien = games.flatMap((game) =>
    [...game.registry.aliens.keys()].map((id) => [`${game.id}/${id}`, game, id] as const),
  );

  it.each(everyAlien)('%s: the sprites and dives are the document’s own', (_name, game, id) => {
    const facts = alienFacts(game, id, undefined);
    const alien = game.registry.aliens.get(id);
    expect(facts?.alien).toBe(alien);
    expect(facts?.sprites).toEqual([alien?.sprite, ...(alien?.hitSprites ?? [])]);
    const own = (alien?.dive?.paths ?? []).map((path) => ({ path, capture: false }));
    const capture = game.rules.capture;
    const captures =
      capture.enabled && capture.captorRole === alien?.role && capture.divePath !== undefined;
    expect(facts?.dives).toEqual(
      captures ? [...own, { path: capture.divePath, capture: true }] : own,
    );
  });

  it.each(everyAlien)(
    '%s: every dive compiles from every slot of its role, as the gate flies it',
    (_name, game, id) => {
      const facts = alienFacts(game, id, undefined);
      if (facts === undefined) throw new Error(`no facts for ${id}`);
      const setting = diveSetting(game, facts);
      for (const slot of setting.slots) {
        expect(setting.formation?.slots[slot.index]?.role).toBe(facts.alien.role);
        for (const dive of facts.dives) {
          const flight = flyDive(game, dive.path, slot, setting.fighter);
          expect(flight.ok, `${dive.path} from slot ${String(slot.index)}`).toBe(true);
        }
      }
    },
  );

  it("reads the launch rate through the rules' own resolver, stage by stage", () => {
    for (const rank of Object.keys(classic.rules.difficulty.ranks)) {
      const facts = alienFacts(classic, 'drone', rank);
      const line = facts?.rules.find((fact) => fact.label.startsWith('launch rate'));
      const values = line?.value.split('  (')[0]?.split(' ') ?? [];
      const rows = classic.rules.difficulty.ranks[rank]?.stageTable.rows ?? [];
      expect(values).toHaveLength(rows.length);
      values.forEach((value, index) => {
        const resolved = resolveLaunchRate(classic.rules, index + 1, 'drone', rank);
        expect(value === '—' ? 0 : Number(value)).toBe(resolved);
      });
    }
  });

  it('names the stages that send it, at the numbers they play as', () => {
    const facts = alienFacts(classic, 'warden', 'A');
    const first = facts?.stages[0];
    expect(first?.numbers[0]).toBe(1);
    for (const entry of facts?.stages ?? []) {
      expect(entry.stage.waves.some((wave) => wave.slots.some((s) => s.alien === 'warden'))).toBe(
        true,
      );
    }
  });

  it('surfaces a role the rules never launch exactly as the pack manager finds it', () => {
    // Classic with the drone role struck from every difficulty row: the coupling
    // `findCouplings` reports for the pack manager, met from the alien's side.
    const ranks = Object.fromEntries(
      Object.entries(classic.rules.difficulty.ranks).map(([id, rank]) => [
        id,
        {
          ...rank,
          stageTable: {
            ...rank.stageTable,
            rows: rank.stageTable.rows.map((row) => {
              const { drone: _dropped, ...rest } = row.launchRates;
              return { ...row, launchRates: rest };
            }),
          },
        },
      ]),
    );
    const rules: Rules = { ...classic.rules, difficulty: { ...classic.rules.difficulty, ranks } };
    const game = { registry: classic.registry, rules };
    const found = findCouplings(classic.registry, rules).filter(
      (coupling) => coupling.kind === 'silent-role' && coupling.role === 'drone',
    );
    expect(found).toHaveLength(1);
    const facts = alienFacts(game, 'drone', undefined);
    expect(facts?.couplings).toEqual(found);
    expect(facts?.rules.find((fact) => fact.label === 'launch rate')?.value).toMatch(
      /never attacks/,
    );
    expect(alienFacts(game, 'warden', undefined)?.couplings).toEqual([]);
  });
});

describe('a theme, as the lab auditions it', () => {
  const themed = games.flatMap((game) =>
    [undefined, ...Object.keys(game.registry.manifest.themes)].map(
      (theme) => [`${game.id}/${theme ?? 'own'}`, game, theme] as const,
    ),
  );

  it.each(themed)('%s: plays the document the game would hand the synth', (_name, game, theme) => {
    const { manifest } = game.registry;
    const rows = auditionOf(game, theme);
    expect(rows).toHaveLength(Object.keys(manifest.sounds).length + manifest.music.length);
    const sounds = themedSounds(game.registry, theme);
    for (const row of rows) {
      expect(row.sound).toBe(sounds.get(row.bound));
      expect(game.registry.sounds.get(row.plays)).toBe(row.sound);
    }
  });

  it("swaps every sound Classic's DUSK names, and nothing it does not", () => {
    const dusk = classic.registry.manifest.themes.dusk?.sounds ?? {};
    for (const row of auditionOf(classic, 'dusk')) {
      expect(row.plays).toBe(dusk[row.bound] ?? row.bound);
    }
  });

  it('says where the game plays a sound, and which theme swaps it', () => {
    const uses = soundUses(classic, 'fire');
    expect(uses).toContainEqual({ label: 'effect', value: 'on shot-fired' });
    expect(uses).toContainEqual({
      label: 'theme DUSK',
      value: 'plays dusk-fire in its place',
      link: { view: 'sounds', id: 'dusk-fire' },
    });
    expect(soundUses(classic, 'game-start')).toContainEqual({
      label: 'music',
      value: 'on stage-started when stage 1',
    });
  });
});

describe('a sound plan, as the lab draws it', () => {
  const ramps: ParamRamp[] = [
    { time: 0, value: 100, kind: 'set' },
    { time: 1, value: 200, kind: 'linear' },
    { time: 2, value: 800, kind: 'exponential' },
    { time: 3, value: 50, kind: 'set' },
  ];

  it('evaluates automation as Web Audio does', () => {
    expect(paramAt(ramps, -1)).toBe(100);
    expect(paramAt(ramps, 0.5)).toBe(150);
    expect(paramAt(ramps, 1.5)).toBeCloseTo(400);
    // A `set` holds the previous value until its own time.
    expect(paramAt(ramps, 2.9)).toBe(800);
    expect(paramAt(ramps, 3)).toBe(50);
    expect(paramAt(ramps, 9)).toBe(50);
  });

  it('spans every pitch a shipped sound reaches', () => {
    for (const sound of classic.registry.sounds.values()) {
      const plan = buildSoundPlan(sound);
      const { low, high } = pitchRange(plan);
      for (const voice of plan.voices) {
        for (const ramp of voice.frequency) {
          expect(ramp.value).toBeGreaterThanOrEqual(low);
          expect(ramp.value).toBeLessThanOrEqual(high);
        }
      }
    }
  });
});
