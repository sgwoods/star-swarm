import { describe, expect, it } from 'vitest';

import { type Action, EMPTY_FRAME, frameOf } from '../../src/engine/input.js';
import { GLYPH_CHARS } from '../../src/render/text.js';
import {
  ATTRACT_BACK,
  ATTRACT_OPTIONS,
  ATTRACT_PROMPT,
  attractKeys,
} from '../../src/ui/attract.js';
import { createInitialsEntry, initialsEntryKeys } from '../../src/ui/highscores.js';
import { cardPress, fireKeyFor, KEY, KEY_PAIR_GAP, keyLine } from '../../src/ui/keys.js';
import { MENU_TEXT, settingsNotes, variantSelectNotes } from '../../src/ui/menus.js';
import {
  createPackEditor,
  createStageEditor,
  type PackEditor,
  packEditorNotes,
  type StageEditor,
  stageEditorNotes,
} from '../../src/ui/packs.js';
import { createOptionsCard, optionsNotes } from '../../src/ui/options.js';
import { exitConfirmUnderLines, PAUSE_TEXT } from '../../src/ui/pause.js';
import { CONTROL_SCHEMES } from '../../src/ui/settings.js';
import { createNameEntry, deleteConfirmNotes, nameEntryNotes } from '../../src/ui/variations.js';

describe('one press, read the same way on every card', () => {
  const press = (...actions: readonly Action[]) => cardPress(EMPTY_FRAME, frameOf(...actions));

  it('takes what is highlighted on start and on fire alike', () => {
    expect(press('start').accept).toBe(true);
    expect(press('fire').accept).toBe(true);
  });

  it('never takes anything on the exit key, which opens the exit card', () => {
    // The double-tap rule (`src/ui/flow.ts`): the key that opens the exit card
    // cannot be a key that commits a card, so it is not folded in anywhere here.
    const exit = press('exit');
    expect(exit.accept).toBe(false);
    expect(exit.back).toBe(false);
    expect(Object.values(exit).some(Boolean)).toBe(false);
  });

  it('goes back on the menu button', () => {
    expect(press('menu').back).toBe(true);
    expect(press('menu').accept).toBe(false);
  });

  it('reads up as left and down as right on a card with one line of choices', () => {
    expect(press('up').backward).toBe(true);
    expect(press('left').backward).toBe(true);
    expect(press('down').forward).toBe(true);
    expect(press('right').forward).toBe(true);
    expect(press('up').forward).toBe(false);
    expect(press('right').backward).toBe(false);
  });

  it('reads edges, not holds, so a held key is one press', () => {
    const held = frameOf('down', 'start');
    const again = cardPress(held, held);
    expect(again.down).toBe(false);
    expect(again.accept).toBe(false);
  });
});

/**
 * Every line of help on every card that waits on a keypress, with the number of
 * font cells the card has to draw it in.
 *
 * Read from the lists the draw functions iterate, so this is a test over the
 * cards rather than over a copy of them.
 */
function everyHelpLine(): {
  readonly card: string;
  readonly text: string;
  readonly cells: number;
}[] {
  const help = (lines: readonly { text: string; tone: string }[]): string[] =>
    lines.filter((line) => line.tone === 'help').map((line) => line.text);
  return [
    ...help(variantSelectNotes('', { demonstrations: true, variations: true })).map((text) => ({
      card: 'selector',
      text,
      cells: 24,
    })),
    ...help(settingsNotes('', true)).map((text) => ({ card: 'settings', text, cells: 25 })),
    { card: 'pause', text: PAUSE_TEXT.pausedKeys, cells: 24 },
    ...help(exitConfirmUnderLines(0, 1)).map((text) => ({ card: 'exit', text, cells: 24 })),
    ...initialsEntryKeys().map((text) => ({ card: 'entry', text, cells: 23 })),
    ...help(packEditorNotes(packCard())).map((text) => ({ card: 'packs', text, cells: 25 })),
    ...help(stageEditorNotes(stageCard())).map((text) => ({ card: 'stages', text, cells: 25 })),
    // The naming card's verbs change with where its cursor is, so every state is read.
    ...nameCards().flatMap((entry) =>
      help(nameEntryNotes(entry, 'create', 'BASE', '')).map((text) => ({
        card: 'name',
        text,
        cells: 25,
      })),
    ),
    ...help(deleteConfirmNotes('MINE')).map((text) => ({ card: 'delete', text, cells: 25 })),
    ...help(optionsNotes(optionsCard())).map((text) => ({ card: 'options', text, cells: 25 })),
  ];
}

/** A game's options card over two counts, judged fine. */
function optionsCard(): ReturnType<typeof createOptionsCard> {
  return createOptionsCard({
    name: 'BASE',
    offered: [3, 5],
    own: 3,
    bonusOf: () => ({ mode: 'none' }),
    judge: () => fine,
  });
}

/** The naming card on `END` with letters taken, on a letter, and with none taken. */
function nameCards(): ReturnType<typeof createNameEntry>[] {
  const atEnd = createNameEntry({ start: 'MINE', check: () => undefined });
  const onLetter = createNameEntry({ start: 'MINE', check: () => undefined });
  onLetter.next();
  const empty = createNameEntry({ start: '', check: () => undefined });
  return [atEnd, onLetter, empty];
}

/** The two cards the settings screen opens, over one pack and one stage, judged fine. */
const fine = { ok: true, headline: 'FINE', details: [] };
function packCard(): PackEditor {
  return createPackEditor({
    installed: [{ id: 'base', name: 'BASE', rules: true, stages: 1 }],
    start: ['base'],
    own: ['base'],
    judge: () => fine,
  });
}
function stageCard(): StageEditor {
  return createStageEditor({
    options: [{ id: 'one', pack: 'BASE' }],
    own: ['one'],
    stored: undefined,
    numberOf: (position) => position + 1,
    judge: () => fine,
  });
}

describe('every card says how to work it in one voice', () => {
  const keys: readonly string[] = Object.values(KEY);

  it('writes each pair as a key, a space and what it does here', () => {
    expect(keyLine([KEY.rows, 'MOVE'], [KEY.values, 'CHANGE'])).toBe('U/D MOVE   L/R CHANGE');
    expect(keyLine([KEY.back, 'BACK'])).toBe('ESC BACK');
  });

  it('builds every line of help on every card from that vocabulary', () => {
    const lines = everyHelpLine();
    // Ten cards, two lines each but the pause card's one.
    expect(new Set(lines.map((line) => line.card)).size).toBe(10);
    for (const { card, text } of lines) {
      for (const pair of text.split(KEY_PAIR_GAP)) {
        const key = pair.slice(0, pair.indexOf(' '));
        expect(keys, `${card}: "${text}"`).toContain(key);
        expect(pair.length, `${card}: "${text}"`).toBeGreaterThan(key.length + 1);
      }
    }
  });

  it('never names an action instead of a key, or a key one scheme lacks', () => {
    // `FIRE` names nothing on the keyboard, and Space is fire in two of the three
    // control schemes; `START` is a cabinet button, and Return is the key.
    for (const { card, text } of everyHelpLine()) {
      expect(text, card).not.toMatch(/\b(FIRE|SPACE|START|ARROWS|WASD)\b/);
    }
  });

  it('fits every line on its card, in characters the font has', () => {
    for (const { card, text, cells } of everyHelpLine()) {
      expect(text.length, `${card}: "${text}"`).toBeLessThanOrEqual(cells);
      for (const char of text) expect(GLYPH_CHARS, `${card}: "${text}"`).toContain(char);
    }
  });

  it('names a direction the same way on every card it is named on', () => {
    // `L/R` on the exit card and `U/D` on the list are the *same* tokens the
    // settings card uses, so "how do I go up" has one answer.
    const all = everyHelpLine().map((line) => line.text);
    expect(all.filter((text) => text.includes('U/D')).length).toBeGreaterThanOrEqual(2);
    expect(all.filter((text) => text.includes('L/R')).length).toBeGreaterThanOrEqual(3);
    expect(MENU_TEXT.selectKeys.startsWith(KEY.rows)).toBe(true);
  });
});

describe('the attract screen speaks the same voice', () => {
  /**
   * The screen three changes wrote to — the exit fix's settings line, the persona
   * tag, and this scheme — held to being one layout: every line a `keyLine`, the
   * start prompt said once, and the fire key the player's own scheme binds.
   */
  const keys: readonly string[] = Object.values(KEY);

  it('writes every line as key-and-verb pairs, naming fire only as the scheme binds it', () => {
    for (const scheme of CONTROL_SCHEMES) {
      const allowed = [...keys, fireKeyFor(scheme)];
      const lines = [...attractKeys(scheme, true), ...attractKeys(scheme, false)];
      for (const text of [...lines, ATTRACT_PROMPT]) {
        for (const pair of text.split(KEY_PAIR_GAP)) {
          expect(allowed, `${scheme}: "${text}"`).toContain(pair.slice(0, pair.indexOf(' ')));
        }
        // Width 200 holds 23 cells inside the padding.
        expect(text.length).toBeLessThanOrEqual(23);
        for (const char of text) expect(GLYPH_CHARS).toContain(char);
      }
    }
  });

  it('names the fire key the scheme in force binds', () => {
    expect(attractKeys('both', true).join(' ')).toContain('SPACE FIRE');
    expect(attractKeys('arrows', true).join(' ')).toContain('SPACE FIRE');
    expect(attractKeys('wasd', true).join(' ')).toContain('Z FIRE');
    expect(attractKeys('wasd', true).join(' ')).not.toContain('SPACE');
  });

  it('says how to start once, in the prompt, and where back goes on the card', () => {
    expect(ATTRACT_PROMPT).toBe('ENTER START');
    // Up to the list, where the settings are a row — or, with one game and so no
    // list, to the settings themselves. Never the old borrowed "ESC opens settings"
    // on a screen where it no longer does.
    expect(ATTRACT_BACK.list).toBe('ESC GAMES, SETTINGS');
    expect(ATTRACT_BACK.settings).toBe('ESC SETTINGS');
    for (const scheme of CONTROL_SCHEMES) {
      for (const gameList of [true, false]) {
        const card = attractKeys(scheme, gameList);
        expect(card.some((line) => line.includes(KEY.ok))).toBe(false);
        expect(card.at(-1)).toBe(gameList ? ATTRACT_BACK.list : ATTRACT_BACK.settings);
      }
    }
  });

  it('names the way to this game’s own options, on every card whatever the build', () => {
    // Up and down, the two keys the fighter never reads, open them from attract.
    expect(ATTRACT_OPTIONS).toBe('U/D OPTIONS');
    for (const scheme of CONTROL_SCHEMES) {
      for (const gameList of [true, false]) {
        expect(attractKeys(scheme, gameList)).toContain(ATTRACT_OPTIONS);
      }
    }
  });
});

describe('initials entry can step back', () => {
  it('returns to the letter before, keeping what it reads', () => {
    const entry = createInitialsEntry();
    entry.next();
    entry.commit();
    expect(entry.index).toBe(1);
    entry.back();
    expect(entry.index).toBe(0);
    expect(entry.letters[0]).toBe('B');
  });

  it('does nothing on the first letter', () => {
    const entry = createInitialsEntry();
    entry.back();
    expect(entry.index).toBe(0);
  });
});
