import { describe, expect, it } from 'vitest';

import { LOGICAL_HEIGHT } from '../../src/render/canvas.js';
import { GLYPH_CHARS } from '../../src/render/text.js';
import { cardHeight, SETTINGS_CARD_TOP } from '../../src/ui/menus.js';
import { VARIATION_NAME_LENGTH } from '../../src/ui/settings.js';
import {
  createDeleteConfirm,
  createNameEntry,
  deleteConfirmNotes,
  NAME_ALPHABET,
  NAME_END,
  nameEntryNotes,
  nameRefusal,
  spellable,
  VARIATION_TEXT,
} from '../../src/ui/variations.js';

/**
 * The naming card and the delete card, as values with a cursor.
 *
 * Naming is initials entry at a different length (`src/ui/highscores.ts`), so the
 * property held here is that it is worked the same way: every direction spins the
 * letter under the cursor, `ENTER` takes it, `ESC` steps back to the one before —
 * and past the last letter is `END`, which keeps the name. The delete card is the
 * exit card's shape, opening on the safe answer.
 */

const free = (): undefined => undefined;

describe('naming a game', () => {
  it('opens on the name it was handed, with the cursor on END past its last letter', () => {
    const entry = createNameEntry({ start: 'STAR SWARM 2', check: free });
    expect(entry.taken).toBe('STAR SWARM 2');
    expect(entry.under).toBe(NAME_END);
    expect(entry.commit()).toBe('kept');
    expect(entry.name).toBe('STAR SWARM 2');
  });

  it('spins the letter under the cursor through the alphabet and END, both ways', () => {
    const entry = createNameEntry({ start: '', check: free });
    entry.next();
    expect(entry.under).toBe('A');
    entry.previous();
    entry.previous();
    expect(entry.under).toBe(NAME_ALPHABET.at(-1));
  });

  it('takes a letter on ENTER and starts the next one on END', () => {
    const entry = createNameEntry({ start: '', check: free });
    entry.next();
    entry.next();
    expect(entry.commit()).toBe('next');
    expect(entry.taken).toBe('B');
    expect(entry.under).toBe(NAME_END);
  });

  it('steps back a letter on ESC, which the cursor is then on, and says when there is none', () => {
    const entry = createNameEntry({ start: 'AB', check: free });
    expect(entry.back()).toBe(true);
    expect(entry.taken).toBe('A');
    expect(entry.under).toBe('B');
    entry.next();
    expect(entry.commit()).toBe('next');
    expect(entry.taken).toBe('AC');
    expect(entry.back()).toBe(true);
    expect(entry.back()).toBe(true);
    expect(entry.taken).toBe('');
    // Nothing left to step back to: the flow's cue to leave the card.
    expect(entry.back()).toBe(false);
  });

  it('holds a full name at its length, with END the one choice left', () => {
    const entry = createNameEntry({ start: 'X'.repeat(30), check: free });
    expect(entry.taken).toHaveLength(VARIATION_NAME_LENGTH);
    entry.next();
    expect(entry.under).toBe(NAME_END);
  });

  it('refuses on END what the check refuses, says why, and forgets it on the next change', () => {
    const entry = createNameEntry({
      start: 'STAR SWARM',
      check: (name) => nameRefusal(name, ['STAR SWARM']),
    });
    expect(entry.commit()).toBe('refused');
    expect(entry.refusal).toBe(VARIATION_TEXT.takenName);
    entry.back();
    expect(entry.refusal).toBeUndefined();
  });

  it('trims the name it keeps', () => {
    const entry = createNameEntry({ start: '', check: free });
    // A space, then A.
    entry.previous();
    entry.previous();
    entry.previous();
    expect(entry.under).toBe(' ');
    entry.commit();
    entry.next();
    entry.commit();
    expect(entry.name).toBe('A');
  });

  it('spells a stored name it was not made from in its own letters', () => {
    expect(spellable('Reef run!')).toBe('REEF RUN');
    expect(spellable('a'.repeat(40))).toHaveLength(VARIATION_NAME_LENGTH);
  });
});

describe('which names may be kept', () => {
  it('refuses an empty name, and one another game has, whatever its case or spacing', () => {
    expect(nameRefusal('   ', [])).toBe(VARIATION_TEXT.emptyName);
    expect(nameRefusal('star swarm ', ['STAR SWARM'])).toBe(VARIATION_TEXT.takenName);
    expect(nameRefusal('REEFS', ['STAR SWARM', 'DEEP SEA'])).toBeUndefined();
  });
});

describe('what the naming card says', () => {
  it('says where the game comes from, and that the game it comes from is untouched', () => {
    const entry = createNameEntry({ start: 'MINE', check: free });
    const lines = nameEntryNotes(entry, 'create', 'STAR SWARM', '');
    expect(lines.map((line) => line.text).slice(0, 2)).toEqual([
      'FROM STAR SWARM',
      VARIATION_TEXT.stays,
    ]);
  });

  it('names what each key does now: ENTER keeps on END, takes a letter elsewhere', () => {
    const entry = createNameEntry({ start: 'MINE', check: free });
    const help = (): string[] =>
      nameEntryNotes(entry, 'rename', 'STAR SWARM', 'MINE')
        .filter((line) => line.tone === 'help')
        .map((line) => line.text);
    expect(help()).toEqual(['L/R CHANGE   ENTER KEEP', 'ESC BACK']);
    entry.next();
    expect(help()[0]).toBe('L/R CHANGE   ENTER NEXT');
    while (entry.back());
    expect(help()[1]).toBe('ESC CANCEL');
  });

  it('keeps its line count whatever the state, so the plate never jumps', () => {
    const entry = createNameEntry({ start: 'A', check: () => VARIATION_TEXT.emptyName });
    const before = nameEntryNotes(entry, 'create', 'X', '').length;
    entry.commit();
    expect(nameEntryNotes(entry, 'create', 'X', '').length).toBe(before);
  });
});

describe('deleting a game', () => {
  it('opens on KEEP, and walks to DELETE and back', () => {
    const confirm = createDeleteConfirm();
    expect(confirm.choice).toBe('keep');
    confirm.next();
    expect(confirm.choice).toBe('delete');
    confirm.next();
    expect(confirm.choice).toBe('keep');
    confirm.previous();
    expect(confirm.choice).toBe('delete');
  });

  it('says the name, that it cannot be undone, and how to answer', () => {
    expect(deleteConfirmNotes('REEFS').map((line) => line.text)).toEqual([
      'REEFS',
      VARIATION_TEXT.cannotUndo,
      VARIATION_TEXT.deleteKeys,
      VARIATION_TEXT.deleteBack,
    ]);
  });
});

describe('both cards fit the playfield, in the pixel font', () => {
  const drawable = new Set(GLYPH_CHARS);
  const missing = (text: string): string[] =>
    [...text.toUpperCase()].filter((char) => !drawable.has(char));

  it('draws every fixed string, and every letter a name can hold', () => {
    for (const text of Object.values(VARIATION_TEXT)) expect(missing(text)).toEqual([]);
    expect(missing(NAME_ALPHABET)).toEqual([]);
    expect(missing(NAME_END)).toEqual([]);
  });

  it('sits where the settings card does without running off the screen', () => {
    const entry = createNameEntry({ start: '', check: free });
    for (const lines of [nameEntryNotes(entry, 'create', 'X', '').length, 4]) {
      const height = cardHeight(1, lines);
      expect(SETTINGS_CARD_TOP - 6 + height).toBeLessThanOrEqual(LOGICAL_HEIGHT);
    }
  });
});
