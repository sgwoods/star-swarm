import { describe, expect, it } from 'vitest';

import { LOGICAL_HEIGHT } from '../../src/render/canvas.js';
import { GLYPH_CHARS } from '../../src/render/text.js';
import { KEY, KEY_PAIR_GAP } from '../../src/ui/keys.js';
import { cardHeight, SETTINGS_CARD_TOP } from '../../src/ui/menus.js';
import {
  createPackEditor,
  createStageEditor,
  type InstalledPack,
  MAX_STAGE_ORDER,
  packEditorNotes,
  PACKS_TEXT,
  STAGE_WINDOW,
  stageEditorNotes,
  type Verdict,
  verdictLines,
  windowOf,
} from '../../src/ui/packs.js';

/**
 * The pack manager and the stage-sequence editor, as values with a cursor.
 *
 * Their judge is handed in, so these tests write their own and watch what it is
 * asked; `tests/unit/compose.test.ts` is where the real one is held to the
 * loader and the playability pass. What is held here is the shape of the cards:
 * what a press does to the draft, that a refused draft is never kept, and that
 * every line a card draws fits it and names its keys in the one voice.
 */

const INSTALLED: readonly InstalledPack[] = [
  { id: 'base', name: 'Base', rules: true, stages: 4 },
  { id: 'reef', name: 'Reef', rules: false, stages: 2 },
  { id: 'paint', name: 'Paint', rules: false, stages: 0 },
];

const OK: Verdict = { ok: true, headline: 'LOADS AND BUILDS', details: [] };
const REFUSED: Verdict = { ok: false, headline: 'WILL NOT LOAD', details: ['NO RULES'] };

/** A pack card whose judge refuses any list without `base`, and records what it was asked. */
function packCard(start: readonly string[] = ['base'], own: readonly string[] = ['base']) {
  const asked: string[] = [];
  const editor = createPackEditor({
    installed: INSTALLED,
    start,
    own,
    judge: (draft) => {
      asked.push(draft.join('+'));
      return draft.includes('base') ? OK : REFUSED;
    },
  });
  return { editor, asked };
}

/** Put the cursor on a pack's row. */
function onRow(editor: ReturnType<typeof packCard>['editor'], id: string): void {
  for (let step = 0; step < editor.rows.length && editor.row.id !== id; step += 1) editor.next();
  expect(editor.row.id).toBe(id);
}

describe('the pack card', () => {
  it('lists every installed pack in a fixed order, each reading its layer or OFF', () => {
    const { editor } = packCard(['base', 'paint']);
    expect(editor.rows.map((row) => `${row.label}=${row.value}`)).toEqual([
      'Base=1',
      'Reef=OFF',
      'Paint=2',
    ]);
    expect(editor.row.note).toBe('RULES + 4 STAGES');
  });

  it('switches a pack on at the top of the layers, and off again, with either direction', () => {
    const { editor } = packCard(['base', 'paint']);
    onRow(editor, 'reef');
    editor.toggle();
    expect(editor.draft).toEqual(['base', 'paint', 'reef']);
    editor.toggle();
    expect(editor.draft).toEqual(['base', 'paint']);
  });

  it('reorders by switching a pack off and on again, the rows staying where they are', () => {
    const { editor } = packCard(['base', 'reef', 'paint']);
    onRow(editor, 'reef');
    editor.toggle();
    editor.toggle();
    expect(editor.draft).toEqual(['base', 'paint', 'reef']);
    expect(editor.rows.map((row) => row.id)).toEqual(['base', 'reef', 'paint']);
    expect(editor.row.id).toBe('reef');
  });

  it('keeps a stored pack this build does not install readable, until it is switched off', () => {
    const { editor } = packCard(['base', 'gone']);
    expect(editor.rows.at(-1)).toMatchObject({
      id: 'gone',
      value: PACKS_TEXT.missing,
      note: PACKS_TEXT.missingNote,
    });
    onRow(editor, 'gone');
    editor.toggle();
    expect(editor.draft).toEqual(['base']);
    // Its row went with it, and the cursor did not fall off the end.
    expect(editor.rows.map((row) => row.id)).toEqual(['base', 'reef', 'paint']);
    expect(editor.row.id).toBe('paint');
  });

  it('judges each distinct draft once, however often it is passed through', () => {
    const { editor, asked } = packCard();
    onRow(editor, 'reef');
    for (let step = 0; step < 4; step += 1) {
      editor.toggle();
      void editor.verdict;
      void editor.verdict;
    }
    expect(asked).toEqual(['base+reef', 'base']);
  });

  it('may pass through a list that cannot be kept, on the way to one that can', () => {
    const { editor } = packCard(['base']);
    onRow(editor, 'base');
    editor.toggle();
    expect(editor.verdict.ok).toBe(false);
    editor.toggle();
    expect(editor.verdict.ok).toBe(true);
    expect(editor.draft).toEqual(['base']);
  });

  it('refuses to keep a refused draft, and says so on the card until the draft changes', () => {
    const { editor } = packCard(['base']);
    onRow(editor, 'base');
    editor.toggle();
    expect(editor.keep()).toEqual({ kept: false });
    expect(editor.refused).toBe(true);
    const [headline] = verdictLines(editor.verdict, editor.refused);
    expect(headline).toEqual({ text: `${PACKS_TEXT.notKept} WILL NOT LOAD`, tone: 'refuse' });
    editor.toggle();
    expect(editor.refused).toBe(false);
  });

  it('keeps a different list as an override, and the variant’s own as no override at all', () => {
    const changed = packCard(['base']);
    onRow(changed.editor, 'reef');
    changed.editor.toggle();
    expect(changed.editor.keep()).toEqual({
      kept: true,
      packs: ['base', 'reef'],
      clearsStages: false,
    });

    const back = packCard(['base', 'reef'], ['base']);
    onRow(back.editor, 'reef');
    back.editor.toggle();
    expect(back.editor.keep()).toEqual({ kept: true, packs: undefined, clearsStages: false });
  });

  it('carries a verdict’s word that the stored stage order goes with the list', () => {
    const editor = createPackEditor({
      installed: INSTALLED,
      start: ['base'],
      own: ['base'],
      judge: () => ({ ...OK, clearsStages: true }),
    });
    editor.next();
    editor.toggle();
    expect(editor.keep()).toMatchObject({ kept: true, clearsStages: true });
  });

  it('draws the row’s note, the layering rule, the verdict, then the two key lines', () => {
    const { editor } = packCard();
    expect(packEditorNotes(editor).map((line) => line.tone)).toEqual([
      'note',
      'legend',
      'accept',
      'note',
      'note',
      'help',
      'help',
    ]);
    expect(packEditorNotes(editor)[1]?.text).toBe(PACKS_TEXT.laterWins);
  });
});

/** A stage card over four options, with a judge that refuses an empty order. */
function stageCard(stored?: readonly string[]) {
  const asked: (string | undefined)[] = [];
  const editor = createStageEditor({
    options: [
      { id: 'one', pack: 'Base' },
      { id: 'two', pack: 'Base' },
      { id: 'three', pack: 'Base' },
      { id: 'reef', pack: 'Reef' },
    ],
    own: ['one', 'two', 'one'],
    stored,
    // A challenge stage on 3, as Classic has.
    numberOf: (position) => (position >= 2 ? position + 2 : position + 1),
    judge: (draft) => {
      asked.push(draft?.join('+'));
      return draft !== undefined && draft.length === 0 ? REFUSED : OK;
    },
  });
  return { editor, asked };
}

describe('the stage card', () => {
  it('opens on the packs’ own order, dim, when nothing is stored', () => {
    const { editor } = stageCard();
    expect(editor.mine).toBe(false);
    expect(editor.rows.map((row) => `${row.label}=${row.value}`)).toEqual([
      'ORDER=OWN',
      '1=one',
      '2=two',
      '3=one',
      '+=--',
    ]);
    expect(editor.rows.filter((row) => row.kind === 'stage').every((row) => !row.editable)).toBe(
      true,
    );
    expect(editor.draft).toBeUndefined();
  });

  it('opens on the stored order when there is one', () => {
    const { editor } = stageCard(['reef']);
    expect(editor.mine).toBe(true);
    expect(editor.rows.map((row) => row.value)).toEqual(['MINE', 'reef', '--']);
  });

  it('says which stage number each row plays as, and where it comes from', () => {
    const { editor } = stageCard();
    editor.next();
    expect(editor.row.note).toBe('STAGE 1, FROM Base');
    editor.next();
    editor.next();
    // The third row is not stage 3: a challenge stage took that number.
    expect(editor.row.note).toBe('STAGE 4, FROM Base');
  });

  it('starts the player’s order from the packs’ when a row is changed under OWN', () => {
    const { editor } = stageCard();
    editor.next();
    editor.next();
    editor.adjust(1);
    expect(editor.mine).toBe(true);
    expect(editor.draft).toEqual(['one', 'three', 'one']);
  });

  it('cycles a row through every option and then empty, both ways', () => {
    const { editor } = stageCard(['one']);
    editor.next();
    const seen: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      editor.adjust(1);
      seen.push(editor.row.value);
    }
    expect(seen).toEqual(['two', 'three', 'reef', '--', 'one']);
    editor.adjust(-1);
    expect(editor.row.value).toBe('--');
    expect(editor.row.note).toBe(PACKS_TEXT.emptyNote);
  });

  it('leaves an emptied row on screen and drops it from what would be kept', () => {
    const { editor } = stageCard(['one', 'two', 'three']);
    editor.next();
    editor.next();
    editor.adjust(-1);
    editor.adjust(-1);
    expect(editor.row.value).toBe('--');
    expect(editor.rows).toHaveLength(5);
    expect(editor.draft).toEqual(['one', 'three']);
    expect(editor.keep()).toEqual({ kept: true, stages: ['one', 'three'] });
  });

  it('appends from the + row, which stays last', () => {
    const { editor } = stageCard(['one']);
    editor.previous();
    expect(editor.row.kind).toBe('add');
    editor.adjust(-1);
    expect(editor.draft).toEqual(['one', 'reef']);
    expect(editor.rows.at(-1)?.kind).toBe('add');
  });

  it('stops appending at the longest order it builds, and says so', () => {
    const { editor } = stageCard(Array.from({ length: MAX_STAGE_ORDER }, () => 'one'));
    editor.previous();
    editor.adjust(1);
    expect(editor.draft).toHaveLength(MAX_STAGE_ORDER);
    expect(editor.row.note).toBe(PACKS_TEXT.fullNote);
  });

  it('marks a stored stage the packs no longer hold, and refuses an order emptied out', () => {
    const stale = stageCard(['gone']);
    stale.editor.next();
    expect(stale.editor.row.note).toBe(PACKS_TEXT.staleNote);

    const { editor } = stageCard(['one']);
    editor.next();
    editor.adjust(-1);
    expect(editor.draft).toEqual([]);
    expect(editor.keep()).toEqual({ kept: false });
    expect(editor.refused).toBe(true);
  });

  it('drops a stored order by going back to OWN, and keeps the edits while switching', () => {
    const { editor, asked } = stageCard(['reef']);
    editor.adjust(1);
    expect(editor.mine).toBe(false);
    expect(editor.keep()).toEqual({ kept: true, stages: undefined });
    editor.adjust(1);
    expect(editor.draft).toEqual(['reef']);
    // The judge is told which: `undefined` for the packs' own order.
    expect(asked).toContain(undefined);
  });

  it('draws the row’s note, the verdict, then the two key lines', () => {
    const { editor } = stageCard();
    expect(stageEditorNotes(editor).map((line) => line.tone)).toEqual([
      'note',
      'accept',
      'note',
      'note',
      'help',
      'help',
    ]);
  });
});

describe('a long order scrolls under a fixed window', () => {
  const rows = Array.from({ length: 20 }, (_unused, index) => index);

  it('shows everything when it fits', () => {
    expect(windowOf(rows.slice(0, 5), 3, 8)).toEqual({
      rows: [0, 1, 2, 3, 4],
      index: 3,
      above: false,
      below: false,
    });
  });

  it('keeps the cursor in view, and says what is hidden either side', () => {
    for (const cursor of [0, 7, 12, 19]) {
      const view = windowOf(rows, cursor, 8);
      expect(view.rows).toHaveLength(8);
      expect(view.rows[view.index]).toBe(cursor);
      expect(view.above).toBe((view.rows[0] ?? 0) > 0);
      expect(view.below).toBe((view.rows.at(-1) ?? 0) < 19);
    }
  });
});

describe('both cards fit the playfield, in characters the font has', () => {
  const fits = (height: number): boolean =>
    SETTINGS_CARD_TOP - 6 >= 0 && SETTINGS_CARD_TOP - 6 + height <= LOGICAL_HEIGHT;
  const drawable = new Set(GLYPH_CHARS);
  const missing = (text: string): string[] =>
    [...text.toUpperCase()].filter((char) => !drawable.has(char));

  it('holds the pack card for as many packs as a build is likely to install', () => {
    const { editor } = packCard();
    const lines = packEditorNotes(editor).length;
    for (const packs of [1, 3, 6]) expect(fits(cardHeight(packs, lines))).toBe(true);
  });

  it('holds the stage card at its window, however long the order', () => {
    const { editor } = stageCard();
    expect(fits(cardHeight(STAGE_WINDOW, stageEditorNotes(editor).length))).toBe(true);
  });

  it('draws only glyphs the font has', () => {
    for (const text of Object.values(PACKS_TEXT)) expect(missing(text)).toEqual([]);
  });

  it('writes its key lines from the one vocabulary, each pair a key and what it does here', () => {
    const keys: readonly string[] = Object.values(KEY);
    for (const text of [PACKS_TEXT.packsKeys, PACKS_TEXT.stagesKeys, PACKS_TEXT.editorDone]) {
      expect(text.length).toBeLessThanOrEqual(25);
      for (const pair of text.split(KEY_PAIR_GAP)) {
        expect(keys).toContain(pair.slice(0, pair.indexOf(' ')));
      }
    }
  });
});
