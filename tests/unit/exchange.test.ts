import { describe, expect, it } from 'vitest';

import { LOGICAL_HEIGHT } from '../../src/render/canvas.js';
import { GLYPH_CHARS } from '../../src/render/text.js';
import { EMPTY_FRAME, frameOf, type InputFrame } from '../../src/engine/input.js';
import { createComposer, VERDICT_TEXT } from '../../src/ui/compose.js';
import {
  createExportCard,
  createImportCard,
  EXCHANGE_TEXT,
  exportNotes,
  exportText,
  IMPORT_TEXT_LIMIT,
  importNotes,
  readImport,
} from '../../src/ui/exchange.js';
import { createGameFlow, type GameFlow } from '../../src/ui/flow.js';
import { cardHeight, SETTINGS_CARD_TOP } from '../../src/ui/menus.js';
import { createSettingsStore, type SettingsStore } from '../../src/ui/settings.js';
import { createMemoryStorage } from '../../src/ui/storage.js';
import { NAME_ALPHABET, NAME_END, VARIATION_TEXT } from '../../src/ui/variations.js';
import { installedPacks, shippedVariants, shippedVariantSources } from '../helpers/variants.js';

/**
 * A variation carried from one cabinet to another as text — the way out, the way
 * in, and every way in that is refused. `tests/e2e/exchange.spec.ts` plays the
 * same journey in a browser, through the real text box.
 */

const START = frameOf('start');
const MENU = frameOf('menu');
const DOWN = frameOf('down');
const RIGHT = frameOf('right');

function press(flow: GameFlow, frame: InputFrame): void {
  flow.step(frame);
  flow.step(EMPTY_FRAME);
}

const composer = createComposer({
  sources: shippedVariantSources(),
  packs: installedPacks(),
  variants: shippedVariants(),
});

function cabinet(): { readonly flow: GameFlow; readonly settings: SettingsStore } {
  const settings = createSettingsStore({ storage: createMemoryStorage() });
  const flow = createGameFlow({
    variants: shippedVariants(),
    seed: 'exchange',
    settings,
    composer,
  });
  if (flow.phase === 'variant-select') press(flow, START);
  press(flow, MENU);
  expect(flow.phase).toBe('settings');
  return { flow, settings };
}

function toRow(flow: GameFlow, id: string): void {
  for (let step = 0; step < 16 && flow.settingsMenu?.row.id !== id; step += 1) press(flow, DOWN);
  expect(flow.settingsMenu?.row.id).toBe(id);
}

function spell(flow: GameFlow, name: string): void {
  while ((flow.naming?.entry.taken.length ?? 0) > 0) press(flow, MENU);
  const choices = [...NAME_ALPHABET, NAME_END];
  for (const letter of name) {
    const from = choices.indexOf(flow.naming?.entry.under ?? NAME_END);
    const to = choices.indexOf(letter);
    for (let step = (to - from + choices.length) % choices.length; step > 0; step -= 1) {
      press(flow, RIGHT);
    }
    press(flow, START);
  }
  press(flow, START);
}

/** Make a variation of the first shipped game with Deep Sea switched on, named `name`. */
function makeVariation(flow: GameFlow, name: string): string {
  toRow(flow, 'packs');
  press(flow, RIGHT);
  for (let step = 0; step < 6 && flow.packEditor?.row.id !== 'deep-sea'; step += 1) {
    press(flow, DOWN);
  }
  press(flow, RIGHT);
  press(flow, START);
  expect(flow.phase).toBe('name');
  spell(flow, name);
  expect(flow.phase).toBe('settings');
  expect(flow.game.variation).toBe(true);
  return flow.game.id;
}

function exportChosen(flow: GameFlow): string {
  toRow(flow, 'export');
  press(flow, RIGHT);
  expect(flow.phase).toBe('export');
  const text = flow.exportCard?.text ?? '';
  press(flow, MENU);
  expect(flow.phase).toBe('settings');
  return text;
}

function openImport(flow: GameFlow): void {
  toRow(flow, 'import');
  press(flow, RIGHT);
  expect(flow.phase).toBe('import');
}

describe('the text a variation travels as', () => {
  it('is the stored document itself, as the shipped documents are formatted', () => {
    const { flow, settings } = cabinet();
    makeVariation(flow, 'MY SWARM');
    const stored = settings.value.variations[0];
    const text = exportChosen(flow);
    expect(text).toBe(`${JSON.stringify(stored, null, 2)}\n`);
    expect(text).toBe(exportText(stored ?? {}));
    // No envelope: what comes back is a variant document, `derivedFrom` and all.
    expect(JSON.parse(text)).toEqual(stored);
  });

  it('refuses what is not a document, before any judge sees it', () => {
    const refusal = (text: string): readonly string[] => {
      const read = readImport(text);
      return read.ok ? [] : read.verdict.details;
    };
    expect(refusal('not json at all')).toEqual([EXCHANGE_TEXT.notJson]);
    expect(refusal('[1, 2, 3]')).toEqual([EXCHANGE_TEXT.notDocument]);
    expect(refusal('42')).toEqual([EXCHANGE_TEXT.notDocument]);
    expect(refusal(' '.repeat(IMPORT_TEXT_LIMIT + 1))).toEqual([EXCHANGE_TEXT.tooLong]);
    expect(readImport('{"id": "x"}').ok).toBe(true);
  });

  it('says nothing has been pasted until something is', () => {
    const card = createImportCard(() => {
      throw new Error('nothing to judge yet');
    });
    expect(importNotes(card)[0]?.text).toBe(EXCHANGE_TEXT.waiting);
    card.offer('   ');
    expect(card.judgement).toBeUndefined();
  });

  it('reports a copy only once the clipboard has answered', () => {
    const card = createExportCard('MINE', { id: 'mine' });
    expect(card.take()).toBe(false);
    card.ask();
    expect(card.take()).toBe(true);
    expect(card.take()).toBe(false);
    card.settle(false);
    expect(exportNotes(card)[2]?.text).toBe(EXCHANGE_TEXT.notCopied);
    card.settle(true);
    expect(exportNotes(card)[2]?.text).toBe(EXCHANGE_TEXT.copied);
  });
});

describe('a variation, out of one cabinet and into another', () => {
  it('arrives, is named, is chosen, and plays as it was made', () => {
    const one = cabinet();
    const id = makeVariation(one.flow, 'MY SWARM');
    const packs = one.flow.variant.packs;
    const text = exportChosen(one.flow);

    // Another machine: nothing stored at all.
    const two = cabinet();
    expect(two.settings.value.variations).toEqual([]);
    openImport(two.flow);
    two.flow.importCard?.offer(text);
    expect(two.flow.importCard?.judgement?.verdict.ok).toBe(true);
    expect(two.flow.importCard?.judgement?.verdict.headline).toBe(VERDICT_TEXT.builds);
    expect(two.flow.importCard?.judgement?.name).toBe('MY SWARM');

    // Kept the way every new game is: through the naming card.
    press(two.flow, START);
    expect(two.flow.phase).toBe('name');
    expect(two.flow.naming?.purpose).toBe('import');
    expect(two.flow.naming?.entry.name).toBe('MY SWARM');
    press(two.flow, START);
    expect(two.flow.phase).toBe('settings');
    expect(two.flow.settingsMenu?.row.id).toBe('game');

    expect(two.flow.game.id).toBe(id);
    expect(two.flow.game.name).toBe('MY SWARM');
    expect(two.flow.setAside).toBeUndefined();
    expect(two.flow.variant.packs).toEqual(packs);
    expect(two.settings.value.variations).toEqual(one.settings.value.variations);

    press(two.flow, START);
    expect(two.flow.phase).toBe('attract');
    press(two.flow, START);
    expect(two.flow.phase).toBe('playing');
    expect(two.flow.variant.packs).toEqual(packs);
  });

  it('never writes over a stored variation, and never takes its name silently', () => {
    const { flow, settings } = cabinet();
    const id = makeVariation(flow, 'MY SWARM');
    const before = settings.value.variations[0];
    const text = exportChosen(flow);

    openImport(flow);
    flow.importCard?.offer(text);
    // Same id as the stored one: it is given its own.
    expect(flow.importCard?.judgement?.verdict.ok).toBe(true);
    press(flow, START);
    expect(flow.phase).toBe('name');
    // Same name as the stored one: refused until it is changed.
    press(flow, START);
    expect(flow.phase).toBe('name');
    expect(flow.naming?.entry.refusal).toBe(VARIATION_TEXT.takenName);
    spell(flow, 'HIS SWARM');
    expect(flow.phase).toBe('settings');

    const stored = settings.value.variations;
    expect(stored).toHaveLength(2);
    expect(stored[0]).toEqual(before);
    expect(stored[1]?.id).not.toBe(id);
    expect(stored[1]?.name).toBe('HIS SWARM');
    expect(flow.game.id).toBe(stored[1]?.id);
  });

  it('goes back to the text, intact, when the name is cancelled', () => {
    const one = cabinet();
    makeVariation(one.flow, 'MY SWARM');
    const text = exportChosen(one.flow);
    const two = cabinet();
    openImport(two.flow);
    two.flow.importCard?.offer(text);
    press(two.flow, START);
    while ((two.flow.naming?.entry.taken.length ?? 0) > 0) press(two.flow, MENU);
    press(two.flow, MENU);
    expect(two.flow.phase).toBe('import');
    expect(two.flow.importCard?.text).toBe(text);
    press(two.flow, MENU);
    expect(two.flow.phase).toBe('settings');
    expect(two.settings.value.variations).toEqual([]);
  });
});

describe('an import that is refused', () => {
  /** Paste `text` on a fresh cabinet's import card; ENTER; return the card's lines. */
  function refusedLines(text: string): readonly string[] {
    const { flow, settings } = cabinet();
    openImport(flow);
    flow.importCard?.offer(text);
    const verdict = flow.importCard?.judgement?.verdict;
    expect(verdict?.ok).toBe(false);
    press(flow, START);
    // ENTER does nothing to a refused game: the card stays, and nothing is written.
    expect(flow.phase).toBe('import');
    expect(settings.value.variations).toEqual([]);
    return verdict === undefined ? [] : [verdict.headline, ...verdict.details];
  }

  const exported = (): Record<string, unknown> => {
    const { flow } = cabinet();
    makeVariation(flow, 'MY SWARM');
    return JSON.parse(exportChosen(flow)) as Record<string, unknown>;
  };

  it('names a pack this build does not install', () => {
    const document = exported();
    const packs = document.packs as string[];
    const text = JSON.stringify({ ...document, packs: [...packs, 'moon-base'] });
    expect(refusedLines(text)).toEqual([
      VERDICT_TEXT.wontLoad,
      'PACK moon-base',
      VERDICT_TEXT.notInstalled,
    ]);
  });

  it('claims a shipped game’s id, so it cannot stand in for the reference', () => {
    const document = exported();
    const shipped = String(document.derivedFrom);
    const text = JSON.stringify({ ...document, id: shipped });
    expect(refusedLines(text)).toEqual([
      VERDICT_TEXT.wontLoad,
      `ID ${shipped}`,
      VERDICT_TEXT.shippedId,
    ]);
  });

  it('carries a field no variant document has, as the loader refuses one in variants/', () => {
    const text = JSON.stringify({ ...exported(), lives: 99 });
    const lines = refusedLines(text);
    expect(lines[0]).toBe(VERDICT_TEXT.wontLoad);
  });

  it('is not JSON at all', () => {
    expect(refusedLines('{ "id": ')).toEqual([EXCHANGE_TEXT.wontImport, EXCHANGE_TEXT.notJson]);
  });
});

describe('the two cards', () => {
  it('draw only characters the pixel font has', () => {
    const glyphs = new Set([...GLYPH_CHARS, ' ']);
    for (const text of Object.values(EXCHANGE_TEXT)) {
      for (const char of text) expect(glyphs.has(char), `${char} in ${text}`).toBe(true);
    }
    for (const char of VARIATION_TEXT.imported) expect(glyphs.has(char)).toBe(true);
  });

  it('fit the playfield where the settings card sits', () => {
    const card = createImportCard(() => ({
      verdict: { ok: true, headline: '', details: [] },
      document: undefined,
      name: '',
    }));
    const tallest = Math.max(
      exportNotes(createExportCard('', {})).length,
      importNotes(card).length,
    );
    expect(SETTINGS_CARD_TOP - 6 + cardHeight(1, tallest)).toBeLessThanOrEqual(LOGICAL_HEIGHT);
  });
});
