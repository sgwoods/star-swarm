import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readPackSource } from '../../src/content/fs.js';
import { type LoadedPack, loadPackOrThrow } from '../../src/content/loader.js';
import { deriveVariant, type VariantDocument } from '../../src/content/variants.js';
import { GLYPH_CHARS } from '../../src/render/text.js';
import { createComposer, VERDICT_TEXT } from '../../src/ui/compose.js';
import type { Verdict } from '../../src/ui/packs.js';
import { installedPacks, shippedVariants, shippedVariantSources } from '../helpers/variants.js';

/**
 * The pack manager's judge, over the packs and variants this repository ships.
 *
 * It is handed documents: a shipped game's own, or a player's variation — made
 * here the way the flow makes one, by `deriveVariant` over the shipped document.
 * Three questions, each answered by somebody else's check and this file holding
 * the judge to asking it: will a document load (the variant loader), will its
 * stages build (the playability pass's structural half), and what is it coupled
 * to (the content guide's section 7). The one thing it deliberately does not ask
 * — whether a persona can finish — is held in place by
 * `tests/sim/pack-manager-cost.test.ts`, because answering it there flies one.
 */

const composer = createComposer({
  sources: shippedVariantSources(),
  packs: installedPacks(),
  variants: shippedVariants(),
});

/** The fixture the playability pass is held to failing, layered where a player could. */
const FIXTURE = resolve(import.meta.dirname, '..', 'fixtures', 'unplayable', 'packs', 'unplayable');

function withFixture(): ReadonlyMap<string, LoadedPack> {
  const { source, errors } = readPackSource(FIXTURE);
  if (source === undefined) throw new Error(JSON.stringify(errors));
  return new Map([...installedPacks(), ['unplayable', loadPackOrThrow(source)]]);
}

const fixtureComposer = createComposer({
  sources: shippedVariantSources(),
  packs: withFixture(),
  variants: shippedVariants(),
});

/** A shipped game's own document, as the composer holds it. */
function shipped(id: string): VariantDocument {
  const document = composer.documentOf(id);
  if (document === undefined) throw new Error(`no shipped document ${id}`);
  return document;
}

/** A variation of Classic, made the way the flow makes one. */
function mine(packs: readonly string[], stages?: readonly string[]): VariantDocument {
  return deriveVariant(shipped('classic'), {
    id: 'classic-2',
    name: 'MINE',
    from: 'classic',
    packs,
    stages,
  });
}

/** Every line a verdict draws, for the font check. */
const linesOf = (verdict: Verdict): string[] => [verdict.headline, ...verdict.details];

describe('a document that will not load is refused, with the loader’s reason', () => {
  it('refuses a pack list with no pack that ships rules', () => {
    const { verdict, variant } = composer.compose(mine(['deep-sea']));
    expect(variant).toBeUndefined();
    expect(verdict.ok).toBe(false);
    expect(verdict.headline).toBe(VERDICT_TEXT.wontLoad);
    expect(verdict.details).toEqual([VERDICT_TEXT.noRules, VERDICT_TEXT.noRules2]);
  });

  it('refuses an empty list, and a pack this build does not install', () => {
    expect(composer.compose(mine([])).verdict.ok).toBe(false);
    expect(composer.compose(mine(['classic', 'gone'])).verdict.details).toEqual([
      'PACK gone',
      VERDICT_TEXT.notInstalled,
    ]);
  });

  it('refuses a stage order naming a stage the packs do not hold, or a challenge stage', () => {
    expect(composer.compose(mine(['classic'], ['reef-2'])).verdict.details).toEqual([
      'STAGE reef-2',
      VERDICT_TEXT.notInPacks,
    ]);
    expect(composer.compose(mine(['classic'], ['challenge-1'])).verdict.details).toEqual([
      'STAGE challenge-1',
      VERDICT_TEXT.isChallenge,
    ]);
    expect(composer.compose(mine(['classic'], [])).verdict.details).toEqual([
      VERDICT_TEXT.noStages,
    ]);
  });

  it('refuses a variation that has a shipped game’s id — the duplicate rule, against them', () => {
    // A copy, not the shipped document itself: only that is recognised as shipped.
    const copy = { ...mine(['classic']), id: 'classic' };
    const { verdict, variant } = composer.compose(copy);
    expect(variant).toBeUndefined();
    expect(verdict.details).toEqual(['ID classic', VERDICT_TEXT.shippedId]);
  });

  it('refuses a field the schema does not know, as a document in variants/ would be', () => {
    const { verdict } = composer.compose({ ...mine(['classic']), speed: 2 });
    expect(verdict.ok).toBe(false);
    expect(verdict.headline).toBe(VERDICT_TEXT.wontLoad);
  });
});

describe('a document that loads is composed, and plays what the player chose', () => {
  it('hands back the variant itself for a shipped document, as the gate already flew it', () => {
    const classic = shippedVariants().find((variant) => variant.id === 'classic');
    const { verdict, variant } = composer.compose(shipped('classic'));
    expect(variant).toBe(classic);
    expect(verdict).toMatchObject({ ok: true, headline: VERDICT_TEXT.own });
  });

  it('judges a copy of a shipped document, which is a variation and not the game', () => {
    const { verdict, variant } = composer.compose(mine(['classic']));
    expect(verdict).toMatchObject({ ok: true, headline: VERDICT_TEXT.builds });
    expect(variant?.id).toBe('classic-2');
    expect(variant?.name).toBe('MINE');
    expect(variant?.derivedFrom).toBe('classic');
    expect(variant).not.toBe(shippedVariants().find((entry) => entry.id === 'classic'));
  });

  it('composes Classic with Deep Sea layered on top: its stages, Classic’s rules', () => {
    const { verdict, variant } = composer.compose(mine(['classic', 'deep-sea']));
    expect(verdict.ok).toBe(true);
    expect(verdict.headline).toBe(VERDICT_TEXT.builds);
    expect(variant?.packs).toEqual(['classic', 'deep-sea']);
    // The Classic game's own presets and personas, over the mixed content.
    expect(variant?.personas.map((persona) => persona.id)).toEqual(
      shippedVariants()
        .find((entry) => entry.id === 'classic')
        ?.personas.map((persona) => persona.id),
    );
    expect(variant?.stagesFor('A').stageFor(1)?.stage.id).toBe('reef-1');
  });

  it('plays a stated stage order as the combat stages, at every rank, cycling whole', () => {
    const { variant } = composer.compose(mine(['classic', 'deep-sea'], ['reef-2', 'script-0']));
    expect(variant?.stages).toEqual(['reef-2', 'script-0']);
    for (const rank of ['A', 'D']) {
      const stages = variant?.stagesFor(rank);
      // Stage 3 is a challenge stage under Classic's rules, so the order's second
      // row plays as stage 2 and its first comes round again as stage 4.
      expect(stages?.stageFor(1)?.stage.id).toBe('reef-2');
      expect(stages?.stageFor(2)?.stage.id).toBe('script-0');
      expect(stages?.stageFor(3)?.stage.kind).toBe('challenge');
      expect(stages?.stageFor(4)?.stage.id).toBe('reef-2');
    }
  });

  it('says what a mix is coupled to when it accepts one', () => {
    // A twenty-six-enemy fleet under bombing thresholds written for forty.
    const { verdict } = composer.compose(mine(['classic', 'deep-sea']));
    expect(verdict.details).toEqual(['BOMBS GO NONSTOP AT 6-14', 'LEFT OF 26, NOT OF 40']);
  });

  it('says what it checked when there is nothing coupled', () => {
    const { verdict } = composer.compose(mine(['classic', 'swarm-remix']));
    expect(verdict.details).toEqual([VERDICT_TEXT.buildsNote, VERDICT_TEXT.buildsNote2]);
  });

  it('judges a document once, however often the player passes back through it', () => {
    const first = composer.compose(mine(['swarm-remix', 'classic']));
    expect(composer.compose(mine(['swarm-remix', 'classic']))).toBe(first);
  });
});

describe('a pack list that would strand the stage order the document states', () => {
  const ordered = mine(['classic', 'deep-sea'], ['reef-2']);

  it('may still be kept, and says first that the order goes with it', () => {
    const verdict = composer.judgePacks(ordered, ['classic']);
    expect(verdict.ok).toBe(true);
    expect(verdict.clearsStages).toBe(true);
    expect(verdict.details[0]).toBe(VERDICT_TEXT.clearsStages);
  });

  it('is refused for its own reason when it would not load anyway', () => {
    const verdict = composer.judgePacks(ordered, ['deep-sea']);
    expect(verdict.ok).toBe(false);
    expect(verdict.details[0]).toBe(VERDICT_TEXT.noRules);
  });

  it('leaves an order the new list still holds alone', () => {
    const verdict = composer.judgePacks(ordered, ['swarm-remix', 'classic', 'deep-sea']);
    expect(verdict.ok).toBe(true);
    expect(verdict.clearsStages).toBeUndefined();
  });

  it('judges the document itself for its own list', () => {
    expect(composer.judgePacks(ordered, ['classic', 'deep-sea'])).toBe(
      composer.compose(ordered).verdict,
    );
    expect(composer.judgePacks(shipped('classic'), ['classic']).headline).toBe(VERDICT_TEXT.own);
  });
});

describe('a draft taken straight from a shipped game’s own document', () => {
  it('is judged as that game edited, not refused for carrying its id', () => {
    const verdict = composer.judgePacks(shipped('classic'), ['classic', 'deep-sea']);
    expect(verdict).toMatchObject({ ok: true, headline: VERDICT_TEXT.builds });
    expect(composer.judgeStages(shipped('classic'), ['script-5'])).toMatchObject({ ok: true });
  });
});

describe('a stage order judged over a document', () => {
  it('judges the document itself for the order it states, and a replaced one afresh', () => {
    const plain = mine(['classic', 'deep-sea']);
    expect(composer.judgeStages(plain, undefined)).toBe(composer.compose(plain).verdict);
    expect(composer.judgeStages(plain, ['reef-3'])).toMatchObject({ ok: true });
    expect(composer.judgeStages(plain, ['nowhere']).details).toEqual([
      'STAGE nowhere',
      VERDICT_TEXT.notInPacks,
    ]);
  });
});

describe('a document whose stages will not build is refused before anyone plays it', () => {
  /**
   * `tests/fixtures/unplayable/` loads cleanly — every schema and reference pass
   * accepts it — and two of its three stages fail the playability pass's
   * structural half: `crowded` cannot build its fleet, and `overboard`'s divers
   * fly a dive that leaves the screen.
   */
  it('refuses the fixture layered over Classic, naming what will not build', () => {
    const { verdict, variant } = fixtureComposer.compose(mine(['classic', 'unplayable']));
    expect(variant).toBeUndefined();
    expect(verdict.ok).toBe(false);
    expect(verdict.headline).toBe(VERDICT_TEXT.unplayable);
  });

  it('names a fleet that will not build', () => {
    const { verdict } = fixtureComposer.compose(mine(['classic', 'unplayable'], ['crowded']));
    expect(verdict.details).toEqual(['STAGE crowded', VERDICT_TEXT.fleet]);
  });

  it('names a dive that leaves the screen', () => {
    const { verdict } = fixtureComposer.compose(mine(['classic', 'unplayable'], ['overboard']));
    expect(verdict.details).toEqual(['DIVE dive-overboard', VERDICT_TEXT.dive]);
  });
});

describe('the pack manager lists what is installed, and offers what it holds', () => {
  it('lists every installed pack once, saying which carry rules', () => {
    expect(composer.installed).toEqual([
      { id: 'classic', name: 'Classic', rules: true, stages: 21 },
      { id: 'deep-sea', name: 'Deep Sea', rules: false, stages: 3 },
      { id: 'swarm-remix', name: 'Swarm Remix', rules: false, stages: 0 },
    ]);
  });

  it('hands out each shipped game’s own document, and nothing for a game it lacks', () => {
    const source = shippedVariantSources().find((entry) => entry.file === 'classic.json');
    expect(composer.documentOf('classic')).toEqual(source?.value);
    expect(composer.documentOf('no-such-game')).toBeUndefined();
  });

  it('offers the combat stages of a list, base pack first and numbered as people count', () => {
    const options = composer.stageOptions(shipped('classic'), ['classic', 'deep-sea']);
    expect(options.map((option) => option.id)).toEqual([
      ...Array.from({ length: 13 }, (_unused, index) => `script-${String(index)}`),
      'reef-1',
      'reef-2',
      'reef-3',
    ]);
    expect(options.at(-1)?.pack).toBe('Deep Sea');
    expect(options.some((option) => option.id.startsWith('challenge'))).toBe(false);
  });

  it('still offers what can be played over a document that will not load', () => {
    const broken = mine(['classic', 'gone']);
    expect(composer.stageOptions(broken, ['classic', 'gone']).length).toBeGreaterThan(0);
  });

  it('starts the order from the packs’ own sequence at the rank in force', () => {
    const classic = shippedVariants().find((variant) => variant.id === 'classic');
    const atD = classic?.registry.rules?.difficulty.ranks.D?.stageSequence?.normal?.rows;
    expect(composer.ownStages(shipped('classic'), ['classic'], 'D')).toEqual(atD);
    expect(composer.ownStages(shipped('classic'), ['classic', 'deep-sea'], 'D')).toEqual([
      'reef-1',
      'reef-2',
      'reef-3',
    ]);
  });
});

describe('everything a verdict says is in the pixel font', () => {
  const drawable = new Set(GLYPH_CHARS);
  const missing = (text: string): string[] =>
    [...text.toUpperCase()].filter((char) => !drawable.has(char));

  it('covers the fixed copy, and every verdict the shipped packs and the fixture produce', () => {
    for (const text of Object.values(VERDICT_TEXT)) expect(missing(text)).toEqual([]);
    const verdicts = [
      composer.compose(mine(['deep-sea'])).verdict,
      composer.compose(mine(['classic', 'deep-sea'])).verdict,
      composer.compose(shipped('deep-sea')).verdict,
      composer.compose({ ...mine(['classic']), id: 'classic' }).verdict,
      composer.judgePacks(mine(['classic', 'deep-sea'], ['reef-2']), ['classic']),
      fixtureComposer.compose(mine(['classic', 'unplayable'])).verdict,
      fixtureComposer.compose(mine(['classic', 'unplayable'], ['ledge'])).verdict,
    ];
    for (const verdict of verdicts) {
      for (const line of linesOf(verdict)) expect(missing(line), line).toEqual([]);
    }
  });
});
