import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listPackDirs, readPackSource, readVariantSources } from '../../src/content/fs.js';
import type { LoadedPack } from '../../src/content/loader.js';
import { loadPackOrThrow, packSourceFromRecord } from '../../src/content/loader.js';
import { personaOf, personaSchema } from '../../src/content/personas.js';
import { resolveDifficultyRow } from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import type { ResolvedVariant, VariantSource } from '../../src/content/variants.js';
import {
  loadVariants,
  presetOf,
  presetsForRules,
  rankFor,
  variantSchema,
} from '../../src/content/variants.js';
import { classicPack, minimalRules } from '../helpers/rules.js';

/**
 * A variant is one game on the platform, declared as data
 * (`src/content/variants.ts`).
 *
 * Three things are being tested, and the third is the point of the whole feature:
 *
 * 1. The schema accepts a legal document and rejects an illegal one, naming the
 *    file and the field — the same contract a pack has.
 * 2. Selection starts the right rules and the right packs.
 * 3. **A difficulty preset resolves to a rank and scales nothing.** Section 6 of
 *    `docs/DESIGN.md` is explicit that rank selects whole data tables rather than
 *    multiplying one, so the test asserts the resolved row is *identical* to the
 *    rank's own row rather than merely different between presets.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/** Every pack that actually ships, keyed by id, as the game loads them. */
function installedPacks(): Map<string, LoadedPack> {
  const packs = new Map<string, LoadedPack>();
  const classic = classicPack();
  packs.set(classic.id, classic);
  return packs;
}

/** A tiny pack with two ranks, so rank selection is visible without the shipped 26 rows. */
function twoRankPack(id = 'two'): LoadedPack {
  const rules = minimalRules(`${id}-rules`);
  rules.difficulty = {
    defaultRank: 'easy',
    ranks: {
      easy: { label: 'the gentle one', stageTable: { rows: [{ maxDivers: 1 }, { maxDivers: 2 }] } },
      hard: { label: 'the other one', stageTable: { rows: [{ maxDivers: 7 }, { maxDivers: 9 }] } },
    },
  };
  return loadPackOrThrow(
    packSourceFromRecord(id, `test:${id}`, {
      'pack.json': { id, name: id },
      'rules.json': rules,
    }),
  );
}

function sourceOf(file: string, value: unknown): VariantSource {
  return { file, value };
}

/** Load one variant document, expecting it to succeed. */
function loadOne(
  value: Record<string, unknown>,
  packs: ReadonlyMap<string, LoadedPack> = installedPacks(),
  file = `${String(value.id)}.json`,
): ResolvedVariant {
  const result = loadVariants([sourceOf(file, value)], packs);
  if (!result.ok) throw new Error(`expected it to load: ${JSON.stringify(result.errors)}`);
  const variant = result.variants[0];
  if (variant === undefined) throw new Error('no variant came back');
  return variant;
}

/** Load one variant document, expecting it to fail, and return its errors. */
function refuse(
  value: unknown,
  packs: ReadonlyMap<string, LoadedPack> = installedPacks(),
  file = 'x.json',
) {
  const result = loadVariants([sourceOf(file, value)], packs);
  if (result.ok) throw new Error('expected it to fail');
  return result.errors;
}

describe('the variant schema', () => {
  it('accepts the least a document can say', () => {
    const parsed = variantSchema.parse({ id: 'x', name: 'X', packs: ['classic'] });
    expect(parsed.order).toBe(0);
    expect(parsed.demonstration).toBe(false);
    expect(parsed.difficulty.presets).toEqual([]);
  });

  it('rejects a misspelt field rather than ignoring it', () => {
    // Strict objects, for the reason `schema.ts` gives: the commonest failure in
    // authored content is a field that silently does nothing.
    const errors = refuse({ id: 'x', name: 'X', packs: ['classic'], demonstartion: true });
    expect(errors.some((error) => /unrecognized|unknown/i.test(error.message))).toBe(true);
  });

  it('rejects a document with no packs at all', () => {
    expect(refuse({ id: 'x', name: 'X', packs: [] })[0]?.field).toBe('packs');
  });

  it('names the file and the field on every failure', () => {
    const errors = refuse(
      { id: 'x', name: '', packs: ['classic'] },
      installedPacks(),
      'broken.json',
    );
    expect(errors[0]?.pack).toBe('variants');
    expect(errors[0]?.file).toBe('broken.json');
    expect(errors[0]?.field).toBe('name');
  });

  it('requires the id to match the document name, as a pack matches its directory', () => {
    const errors = refuse(
      { id: 'other', name: 'X', packs: ['classic'] },
      installedPacks(),
      'x.json',
    );
    expect(errors[0]?.field).toBe('id');
    expect(errors[0]?.message).toContain('x.json');
  });
});

describe('a variant’s references', () => {
  it('rejects a pack that is not installed, naming which entry', () => {
    const errors = refuse({ id: 'x', name: 'X', packs: ['classic', 'nope'] });
    expect(errors[0]?.field).toBe('packs[1]');
    expect(errors[0]?.message).toContain('"nope"');
  });

  it('rejects the same pack listed twice', () => {
    expect(refuse({ id: 'x', name: 'X', packs: ['classic', 'classic'] })[0]?.field).toBe(
      'packs[1]',
    );
  });

  it('rejects a variant whose packs ship no rules at all', () => {
    const artOnly = loadPackOrThrow(
      packSourceFromRecord('art', 'test:art', { 'pack.json': { id: 'art', name: 'Art' } }),
    );
    const errors = refuse({ id: 'x', name: 'X', packs: ['art'] }, new Map([['art', artOnly]]));
    expect(errors[0]?.field).toBe('packs');
    expect(errors[0]?.message).toContain('rules.json');
  });

  it('rejects a preset naming a rank the rules do not declare', () => {
    const errors = refuse(
      {
        id: 'x',
        name: 'X',
        packs: ['classic'],
        difficulty: { presets: [{ id: 'silly', label: 'SILLY', rank: 'Z' }] },
      },
      installedPacks(),
    );
    expect(errors[0]?.field).toBe('difficulty.presets[0].rank');
    expect(errors[0]?.message).toContain('"Z"');
  });

  it('rejects two presets with one id, and a default naming none', () => {
    const duplicate = refuse({
      id: 'x',
      name: 'X',
      packs: ['classic'],
      difficulty: {
        presets: [
          { id: 'a', label: 'A', rank: 'A' },
          { id: 'a', label: 'B', rank: 'B' },
        ],
      },
    });
    expect(duplicate[0]?.field).toBe('difficulty.presets[1].id');

    const missing = refuse({
      id: 'x',
      name: 'X',
      packs: ['classic'],
      difficulty: { presets: [{ id: 'a', label: 'A', rank: 'A' }], defaultPreset: 'ghost' },
    });
    expect(missing[0]?.field).toBe('difficulty.defaultPreset');
  });

  it('rejects two documents claiming one id', () => {
    const result = loadVariants(
      [
        sourceOf('a.json', { id: 'a', name: 'A', packs: ['classic'] }),
        sourceOf('a.json', { id: 'a', name: 'A again', packs: ['classic'] }),
      ],
      installedPacks(),
    );
    expect(result.ok).toBe(false);
  });

  it('reports every bad document rather than stopping at the first', () => {
    const result = loadVariants(
      [
        sourceOf('one.json', { id: 'one', name: 'One', packs: ['ghost'] }),
        sourceOf('two.json', { id: 'two', name: 'Two', packs: ['phantom'] }),
      ],
      installedPacks(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.file).sort()).toEqual(['one.json', 'two.json']);
  });

  it('lets nothing partial escape: errors or variants, never both', () => {
    const result = loadVariants(
      [
        sourceOf('good.json', { id: 'good', name: 'Good', packs: ['classic'] }),
        sourceOf('bad.json', { id: 'bad', name: 'Bad', packs: ['ghost'] }),
      ],
      installedPacks(),
    );
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('variants');
  });
});

describe('a resolved variant', () => {
  it('layers the packs it names, in order', () => {
    const packs = installedPacks();
    const extra = loadPackOrThrow(
      packSourceFromRecord('extra', 'test:extra', {
        'pack.json': { id: 'extra', name: 'Extra' },
        'sounds/fire.json': { id: 'fire', wave: 'sine', freq: 200 },
      }),
    );
    packs.set('extra', extra);
    const variant = loadOne({ id: 'x', name: 'X', packs: ['classic', 'extra'] }, packs);
    expect(variant.packs).toEqual(['classic', 'extra']);
    expect(variant.registry.sound('fire')?.wave).toBe('sine');
    // And the base pack's content is all still there.
    expect(variant.registry.aliens.size).toBe(classicPack().aliens.size);
  });

  it('derives one preset per declared rank when it states none', () => {
    const variant = loadOne(
      { id: 'x', name: 'X', packs: ['two'] },
      new Map([['two', twoRankPack()]]),
    );
    expect(variant.presets.map((preset) => preset.id)).toEqual(['easy', 'hard']);
    // The rank id is the label because it has to fit a menu row, and a derived
    // preset carries no description: a rank's own `label` is prose for a reader of
    // the pack, and the menu's "RANK <id>" fallback is what a row can draw.
    expect(variant.presets[0]?.label).toBe('easy');
    expect(variant.presets[0]?.description).toBeUndefined();
    expect(variant.defaultPreset.id).toBe('easy');
  });

  it('derives presets the same way `presetsForRules` does', () => {
    const rules = twoRankPack().rules as Rules;
    expect(presetsForRules(rules)).toEqual(presetsForRules(rules));
    expect(presetsForRules(rules).map((preset) => preset.rank)).toEqual(['easy', 'hard']);
  });

  it('defaults to the preset whose rank is the rules’ own default rank', () => {
    const variant = loadOne(
      {
        id: 'x',
        name: 'X',
        packs: ['two'],
        difficulty: {
          presets: [
            { id: 'brutal', label: 'BRUTAL', rank: 'hard' },
            { id: 'gentle', label: 'GENTLE', rank: 'easy' },
          ],
        },
      },
      new Map([['two', twoRankPack()]]),
    );
    // `defaultRank` is `easy`, and the preset list does not put it first.
    expect(variant.defaultPreset.id).toBe('gentle');
  });

  it('sorts the selector by order, then id', () => {
    const result = loadVariants(
      [
        sourceOf('zz.json', { id: 'zz', name: 'ZZ', packs: ['classic'], order: 1 }),
        sourceOf('aa.json', { id: 'aa', name: 'AA', packs: ['classic'], order: 9 }),
        sourceOf('mm.json', { id: 'mm', name: 'MM', packs: ['classic'], order: 1 }),
      ],
      installedPacks(),
    );
    if (!result.ok) throw new Error('expected it to load');
    expect(result.variants.map((variant) => variant.id)).toEqual(['mm', 'zz', 'aa']);
  });
});

describe('the difficulty preset', () => {
  const packs = new Map([['two', twoRankPack()]]);
  const variant = (): ResolvedVariant =>
    loadOne(
      {
        id: 'x',
        name: 'X',
        packs: ['two'],
        difficulty: {
          presets: [
            { id: 'gentle', label: 'GENTLE', rank: 'easy' },
            { id: 'brutal', label: 'BRUTAL', rank: 'hard' },
          ],
        },
      },
      packs,
    );

  it('resolves to a rank id and nothing else', () => {
    expect(rankFor(variant(), 'gentle')).toBe('easy');
    expect(rankFor(variant(), 'brutal')).toBe('hard');
  });

  it('selects a whole table rather than scaling one', () => {
    const rules = twoRankPack().rules as Rules;
    const gentle = resolveDifficultyRow(rules, 1, rankFor(variant(), 'gentle'));
    const brutal = resolveDifficultyRow(rules, 1, rankFor(variant(), 'brutal'));

    // The rows a preset resolves to are *identical* to the rank's own rows —
    // `toEqual` against the table, not merely "different from each other", which
    // a multiplier would also satisfy.
    expect(gentle).toEqual(rules.difficulty.ranks.easy?.stageTable.rows[0]);
    expect(brutal).toEqual(rules.difficulty.ranks.hard?.stageTable.rows[0]);
    expect(gentle?.maxDivers).toBe(1);
    expect(brutal?.maxDivers).toBe(7);

    // And no ratio between the two rows is constant, so no scalar could produce
    // one table from the other. Stage 2 is 2 against 9, stage 1 is 1 against 7.
    const second = {
      gentle: resolveDifficultyRow(rules, 2, 'easy')?.maxDivers,
      brutal: resolveDifficultyRow(rules, 2, 'hard')?.maxDivers,
    };
    expect(second.gentle).toBe(2);
    expect(second.brutal).toBe(9);
    expect(7 / 1).not.toBe(9 / 2);
  });

  it('falls back to the variant’s default for a preset it does not offer', () => {
    // A settings document outlives the build it was written against, so a preset
    // id from another variant must read as "the default" rather than as a failure.
    expect(rankFor(variant(), 'expert-from-some-other-game')).toBe('easy');
    expect(presetOf(variant(), undefined).id).toBe('gentle');
  });

  it('is the only thing a preset does: it carries no number of its own', () => {
    // A guard on the shape rather than on a value: if a preset ever grows a
    // scalar, this is where it will be noticed.
    for (const preset of variant().presets) {
      expect(Object.keys(preset).sort()).toEqual(['id', 'label', 'rank']);
    }
  });
});

describe('autoplay personas', () => {
  /** A complete persona, so a test can vary one field and mean it. */
  const persona = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    label: id.toUpperCase(),
    reactionSteps: 4,
    aimTolerance: 4,
    threatHorizon: 200,
    dodgeMargin: 16,
    shotDiscipline: 0.5,
    panic: 0.1,
    engage: 0.5,
    ...over,
  });

  const withPersonas = (personas: unknown[], defaultPersona?: string) => ({
    id: 'x',
    name: 'X',
    packs: ['classic'],
    autoplay: defaultPersona === undefined ? { personas } : { personas, defaultPersona },
  });

  it('offers none by default, which is a game that cannot be watched', () => {
    // The `GAME` row's rule, applied to autoplay: a variant that declares no
    // personas shows no `AUTOPLAY` row, and there is deliberately nothing to derive
    // a default set *from* — a rank is a table the rules already declare, and how
    // well this game should be played is written down nowhere.
    const variant = loadOne({ id: 'x', name: 'X', packs: ['classic'] });
    expect(variant.personas).toEqual([]);
    expect(variant.defaultPersona).toBeUndefined();
  });

  it('resolves the personas a document declares, in document order', () => {
    const variant = loadOne(withPersonas([persona('a'), persona('b')], 'b'));
    expect(variant.personas.map((one) => one.id)).toEqual(['a', 'b']);
    expect(variant.defaultPersona?.id).toBe('b');
  });

  it('defaults `rescue` to false and requires every number', () => {
    expect(personaSchema.parse(persona('a')).rescue).toBe(false);
    // Every axis is required: a persona whose interesting numbers came from a
    // default would be a persona tuned in a source file rather than a document,
    // which is the failure `src/sim/` avoids by holding no constants.
    const { aimTolerance: _dropped, ...short } = persona('a');
    expect(personaSchema.safeParse(short).success).toBe(false);
  });

  it('rejects a misspelt field rather than ignoring it', () => {
    const errors = refuse(withPersonas([persona('a', { panick: 1 })]));
    expect(errors.some((error) => /unrecognized|unknown/i.test(error.message))).toBe(true);
    expect(errors[0]?.field).toMatch(/^autoplay\.personas\[0\]/);
  });

  it('rejects a probability outside nought to one', () => {
    expect(refuse(withPersonas([persona('a', { panic: 1.5 })]))[0]?.field).toBe(
      'autoplay.personas[0].panic',
    );
  });

  it('rejects two personas with the same id, naming the second one', () => {
    const errors = refuse(withPersonas([persona('a'), persona('a')]));
    expect(errors[0]).toMatchObject({
      pack: 'variants',
      file: 'x.json',
      field: 'autoplay.personas[1].id',
    });
    expect(errors[0]?.message).toContain('duplicate persona id "a"');
  });

  it('rejects a default that names no persona, listing the ones it could have', () => {
    const errors = refuse(withPersonas([persona('a')], 'nobody'));
    expect(errors[0]?.field).toBe('autoplay.defaultPersona');
    expect(errors[0]?.message).toContain('"nobody"');
    expect(errors[0]?.message).toContain('a');
  });

  it('holds a persona to describing a player and never the game', () => {
    // The boundary this shape exists to keep, from the same side
    // `tests/unit/settings.test.ts` guards the settings shape: a rules field, a
    // difficulty row or a score multiplier here would be a difficulty setting with
    // a misleading name.
    expect(Object.keys(personaSchema.parse(persona('a'))).sort()).toEqual([
      'aimTolerance',
      'dodgeMargin',
      'engage',
      'id',
      'label',
      'panic',
      'reactionSteps',
      'rescue',
      'shotDiscipline',
      'threatHorizon',
    ]);
  });

  it('resolves a setting to a persona, and an unknown one to autoplay off', () => {
    const variant = loadOne(withPersonas([persona('a'), persona('b')]));
    expect(personaOf(variant, 'b')?.id).toBe('b');
    expect(personaOf(variant, undefined)).toBeUndefined();
    // Not the first persona: a settings document outlives the build it was written
    // against, and watching the cabinet play itself as somebody else is worse than
    // not watching.
    expect(personaOf(variant, 'gone')).toBeUndefined();
  });
});

describe('the variants this repository ships', () => {
  /**
   * Every pack under `packs/`, then every variant, read off disk through the real
   * readers — **once**. Loaded once rather than per test because several of the
   * assertions below are about *identity*: "the demonstration runs the Classic
   * rules document itself" is only a claim if both sides came from one load.
   */
  const installed = new Map<string, LoadedPack>();
  for (const dir of listPackDirs(resolve(REPO_ROOT, 'packs'))) {
    const { source, errors } = readPackSource(dir);
    expect(errors).toEqual([]);
    if (source === undefined) throw new Error(`could not read ${dir}`);
    const loadedPack = loadPackOrThrow(source);
    installed.set(loadedPack.id, loadedPack);
  }
  const read = readVariantSources(resolve(REPO_ROOT, 'variants'));
  expect(read.errors).toEqual([]);
  const loaded = loadVariants(read.sources, installed);
  if (!loaded.ok) throw new Error(`variants/ does not load: ${JSON.stringify(loaded.errors)}`);
  const shipped = (): readonly ResolvedVariant[] => loaded.variants;
  const everyInstalledPack = (): ReadonlyMap<string, LoadedPack> => installed;

  it('all load, and there is more than one — so the selector is not vacuous', () => {
    expect(shipped().length).toBeGreaterThan(1);
  });

  it('put the Classic game first, as an ordinary entry', () => {
    const first = shipped()[0];
    expect(first?.id).toBe('classic');
    // Not a special case the others work around: it is a document like any other,
    // with a pack list like any other.
    expect(first?.demonstration).toBe(false);
    expect(first?.packs).toEqual(['classic']);
  });

  it('give the Classic variant a preset per arcade rank, all four', () => {
    const classic = shipped().find((variant) => variant.id === 'classic');
    const ranks = Object.keys(classicPack().rules?.difficulty.ranks ?? {});
    expect(classic?.presets.map((preset) => preset.rank)).toEqual(ranks);
    expect(classic?.defaultPreset.rank).toBe(classicPack().rules?.difficulty.defaultRank);
  });

  /**
   * The honest test of the whole feature: the second variant is built **only from
   * data**.
   *
   * `docs/DESIGN.md` section 6 promises a second game is "another pack plus
   * another rules.json and nothing else". A demonstration variant of the *same*
   * game is less than that — an overlay pack — and this is what says so: it copies
   * no rules, it copies no manifest, and the documents that differ from Classic are
   * exactly the ones its pack directory holds.
   */
  describe('the demonstration variant', () => {
    const demo = (): ResolvedVariant => {
      const found = shipped().find((variant) => variant.demonstration);
      if (found === undefined) throw new Error('no demonstration variant is shipped');
      return found;
    };
    const classic = (): ResolvedVariant => {
      const found = shipped().find((variant) => variant.id === 'classic');
      if (found === undefined) throw new Error('no classic variant is shipped');
      return found;
    };

    it('is marked as a demonstration, so it cannot drift into the line-up', () => {
      expect(demo().demonstration).toBe(true);
      expect(demo().id).not.toBe('classic');
    });

    it('copies no rules: it runs the Classic rules document itself', () => {
      // Identity, not equality. A variant that had duplicated 2,200 lines of
      // rules.json to change three numbers would pass a deep comparison and drift
      // the first time an arcade value was corrected.
      expect(demo().rules).toBe(classic().rules);
    });

    it('copies no manifest: roles, formation, sequence and badges are inherited', () => {
      const mine = demo().registry.manifest;
      const theirs = classic().registry.manifest;
      expect(mine.roles).toEqual(theirs.roles);
      expect(mine.formations).toEqual(theirs.formations);
      expect(mine.stageSequence).toEqual(theirs.stageSequence);
      expect(mine.stageBadges).toEqual(theirs.stageBadges);
      expect(mine.sounds).toEqual(theirs.sounds);
    });

    it('differs from Classic in exactly the documents its own pack states', () => {
      const overlayId = demo().packs[demo().packs.length - 1];
      const overlay = everyInstalledPack().get(overlayId ?? '');
      if (overlay === undefined) throw new Error(`the overlay pack ${overlayId ?? '?'} is missing`);

      const kinds = ['aliens', 'paths', 'stages', 'sprites', 'sounds'] as const;
      for (const kind of kinds) {
        const mine = demo().registry[kind];
        const theirs = classic().registry[kind];
        const differing = [...mine.keys()].filter((id) => mine.get(id) !== theirs.get(id)).sort();
        // The overlay's own documents, and nothing besides: no engine change, no
        // second copy of anything, and nothing quietly lost from the base pack.
        expect(differing).toEqual([...overlay[kind].keys()].sort());
        expect([...mine.keys()].sort()).toEqual([...theirs.keys()].sort());
      }
    });

    it('is playable: stage 1 resolves to real content at its own default rank', () => {
      const content = demo().stagesFor(demo().defaultPreset.rank).stageFor(1);
      expect(content?.stage.waves.length).toBeGreaterThan(0);
      expect(content?.formation.slots.length).toBe(
        classicPack().formations.get('classic40')?.slots.length,
      );
    });
  });
});
