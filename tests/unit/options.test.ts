import { describe, expect, it } from 'vitest';

import { resolveExtraLifeAward, startingLivesOffered } from '../../src/content/rules.js';
import type { Rules } from '../../src/content/schema.js';
import type { ThemeChoice } from '../../src/content/themes.js';
import { LOGICAL_HEIGHT } from '../../src/render/canvas.js';
import { GLYPH_CHARS } from '../../src/render/text.js';
import { cardHeight, SETTINGS_CARD_TOP } from '../../src/ui/menus.js';
import {
  bonusLine,
  createOptionsCard,
  type OptionsCardOptions,
  type OptionsDraft,
  optionsHeading,
  optionsNotes,
  OPTIONS_TEXT,
} from '../../src/ui/options.js';
import { PACKS_TEXT, type Verdict } from '../../src/ui/packs.js';
import { classicRules } from '../helpers/rules.js';

/**
 * A game's own options card on its own — the rows, what stepping them does, what
 * keeping hands back, and what it says. The card over the real judge and the
 * shipped games is `tests/unit/options-flow.test.ts`.
 */

const fine: Verdict = { ok: true, headline: 'FINE', details: [] };

function cardOver(rules: Rules, overrides: Partial<OptionsCardOptions> = {}) {
  return createOptionsCard({
    name: 'STAR SWARM',
    offered: startingLivesOffered(rules),
    own: rules.lives.default,
    bonusOf: (lives) => resolveExtraLifeAward(rules, lives),
    judge: () => fine,
    ...overrides,
  });
}

describe('the counts a game offers', () => {
  it('are the rules’ default and every option, each once, ascending', () => {
    expect(startingLivesOffered(classicRules())).toEqual([2, 3, 4, 5]);
    const rules = classicRules();
    expect(startingLivesOffered({ ...rules, lives: { default: 4, options: [5, 2, 4] } })).toEqual([
      2, 4, 5,
    ]);
  });

  it('are the default alone when the rules list no options', () => {
    const rules = classicRules();
    expect(startingLivesOffered({ ...rules, lives: { default: 3, options: [] } })).toEqual([3]);
  });
});

describe('the SHIPS row', () => {
  it('opens on the game’s own count, with the cursor on it', () => {
    const card = cardOver(classicRules());
    expect(card.row.id).toBe('ships');
    expect(card.rows.map((row) => `${row.label}=${row.value}`)).toEqual(['SHIPS=3', 'AUDIO=OWN']);
  });

  it('walks only the counts the rules offer, wrapping', () => {
    const card = cardOver(classicRules());
    const seen: number[] = [];
    for (let step = 0; step < 5; step += 1) {
      card.adjust(1);
      seen.push(card.lives);
    }
    expect(seen).toEqual([4, 5, 2, 3, 4]);
    card.adjust(-1);
    expect(card.lives).toBe(3);
  });

  it('says what each count’s bonus ships are, because the count selects them', () => {
    const rules = classicRules();
    const card = cardOver(rules);
    expect(card.row.note).toBe('BONUS 20K 70K EVERY 70K');
    card.adjust(1);
    card.adjust(1);
    expect(card.lives).toBe(5);
    // A five-ship cabinet awards a different set: the arcade's, not the default's.
    expect(card.row.note).toBe(bonusLine(resolveExtraLifeAward(rules, 5)));
    expect(card.row.note).not.toBe('BONUS 20K 70K EVERY 70K');
  });

  it('is not editable when the rules offer one count, and says why', () => {
    const rules = { ...classicRules(), lives: { default: 3, options: [] } };
    const card = cardOver(rules);
    expect(card.row.editable).toBe(false);
    expect(card.row.note).toBe(OPTIONS_TEXT.shipsOnly);
    card.adjust(1);
    expect(card.lives).toBe(3);
  });
});

const THEMES: readonly ThemeChoice[] = [
  { id: 'arcade', name: 'ARCADE', description: 'THE GAME AS IT SHIPPED' },
  { id: 'dusk', name: 'DUSK', description: undefined },
  { id: 'glass', name: 'GLASS', description: 'BRIGHT AND THIN' },
];

describe('the AUDIO row', () => {
  it('steps through the themes the packs declare, wrapping, opening on the game’s own', () => {
    const card = cardOver(classicRules(), { themes: THEMES, theme: 'dusk' });
    card.next();
    expect(card.row).toMatchObject({ id: 'audio', value: 'DUSK', editable: true });
    const seen: string[] = [];
    for (let step = 0; step < 3; step += 1) {
      card.adjust(1);
      seen.push(card.row.value);
    }
    expect(seen).toEqual(['GLASS', 'ARCADE', 'DUSK']);
    card.adjust(-1);
    expect(card.theme).toBe('arcade');
    expect(card.lives).toBe(3);
  });

  it('says each theme’s own line, or where it sits when the pack wrote none', () => {
    const card = cardOver(classicRules(), { themes: THEMES, theme: 'arcade' });
    card.next();
    expect(card.row.note).toBe('THE GAME AS IT SHIPPED');
    card.adjust(1);
    expect(card.row.note).toBe('THEME 2 OF 3');
  });

  it('hands back a theme to store only when it is not the one the game plays', () => {
    const card = cardOver(classicRules(), { themes: THEMES, theme: 'arcade' });
    card.next();
    card.adjust(1);
    expect(card.keep()).toEqual({ kept: true, lives: undefined, theme: 'dusk' });
    card.adjust(-1);
    expect(card.keep()).toEqual({ kept: true, lives: undefined, theme: undefined });
  });

  it('judges the count and the theme together', () => {
    const drafts: OptionsDraft[] = [];
    const card = cardOver(classicRules(), {
      themes: THEMES,
      theme: 'arcade',
      judge: (draft) => {
        drafts.push(draft);
        return draft.theme === 'dusk' && draft.lives === 4
          ? { ok: false, headline: 'NO', details: [] }
          : fine;
      },
    });
    card.adjust(1);
    card.next();
    card.adjust(1);
    expect(card.keep()).toEqual({ kept: false });
    expect(drafts).toContainEqual({ lives: 4, theme: 'dusk' });
  });

  it('names a game’s single declared theme, and offers no choice', () => {
    const card = cardOver(classicRules(), { themes: THEMES.slice(0, 1), theme: 'arcade' });
    card.next();
    expect(card.row).toMatchObject({
      value: 'ARCADE',
      editable: false,
      note: OPTIONS_TEXT.audioOnly,
    });
  });

  it('says plainly that only one theme exists when the packs declare none', () => {
    const card = cardOver(classicRules());
    card.next();
    expect(card.row).toMatchObject({
      id: 'audio',
      label: 'AUDIO',
      value: OPTIONS_TEXT.audioOwn,
      editable: false,
      note: OPTIONS_TEXT.audioOnly,
    });
    card.adjust(1);
    card.adjust(-1);
    expect(card.row.value).toBe(OPTIONS_TEXT.audioOwn);
    expect(card.lives).toBe(3);
  });
});

describe('keeping the card', () => {
  it('hands back nothing to store for the game’s own count', () => {
    const card = cardOver(classicRules());
    expect(card.keep()).toEqual({ kept: true, lives: undefined, theme: undefined });
    card.adjust(1);
    card.adjust(-1);
    expect(card.keep()).toEqual({ kept: true, lives: undefined, theme: undefined });
  });

  it('hands back the count when it changed', () => {
    const card = cardOver(classicRules());
    card.adjust(1);
    expect(card.keep()).toEqual({ kept: true, lives: 4, theme: undefined });
  });

  it('refuses a count its verdict refuses, says so, and forgets it on the next change', () => {
    const refused: Verdict = { ok: false, headline: 'WILL NOT LOAD', details: ['SHIPS 4'] };
    const card = cardOver(classicRules(), {
      judge: ({ lives }) => (lives === 4 ? refused : fine),
    });
    card.adjust(1);
    expect(card.keep()).toEqual({ kept: false });
    expect(card.refused).toBe(true);
    expect(optionsNotes(card)[2]).toEqual({
      text: `${PACKS_TEXT.notKept} WILL NOT LOAD`,
      tone: 'refuse',
    });
    card.adjust(1);
    expect(card.refused).toBe(false);
  });

  it('judges each count once however often the player passes back through it', () => {
    let asked = 0;
    const card = cardOver(classicRules(), {
      judge: () => {
        asked += 1;
        return fine;
      },
    });
    for (let step = 0; step < 12; step += 1) {
      card.adjust(1);
      void card.verdict;
    }
    expect(asked).toBe(4);
  });
});

describe('what the card says', () => {
  it('says what keeping does, in the pack manager’s words', () => {
    const lines = (makesNew: boolean): string[] =>
      optionsNotes(cardOver(classicRules(), { makesNew })).map((line) => line.text);
    expect(lines(true)).toContain(PACKS_TEXT.keepsNew);
    expect(lines(false)).toContain(PACKS_TEXT.keepsYours);
  });

  it('ends on its two lines of help, never conditional', () => {
    const help = optionsNotes(cardOver(classicRules()))
      .filter((line) => line.tone === 'help')
      .map((line) => line.text);
    expect(help).toEqual([OPTIONS_TEXT.keys, PACKS_TEXT.editorDone]);
  });

  it('heads itself with the game’s name, cut to the card', () => {
    expect(optionsHeading('STAR SWARM')).toBe('STAR SWARM OPTIONS');
    expect(optionsHeading('A VERY LONG NAME INDEED SIR').length).toBe(25);
  });

  it('writes every bonus the way the note reads it', () => {
    expect(bonusLine({ mode: 'none' })).toBe(OPTIONS_TEXT.noBonus);
    expect(bonusLine({ mode: 'thresholds', first: 7000 })).toBe('BONUS AT 7K');
    expect(bonusLine({ mode: 'thresholds', first: 20000, second: 60000 })).toBe(
      'BONUS 20K AND 60K',
    );
    expect(bonusLine({ mode: 'thresholds', first: 1500, second: 4000, repeat: 4000 })).toBe(
      'BONUS 1500 4K EVERY 4K',
    );
  });

  it('fits every Classic count’s bonus in the card’s twenty-five cells', () => {
    const rules = classicRules();
    for (const lives of startingLivesOffered(rules)) {
      expect(bonusLine(resolveExtraLifeAward(rules, lives)).length).toBeLessThanOrEqual(25);
    }
  });

  it('draws only characters the pixel font has', () => {
    const glyphs = new Set([...GLYPH_CHARS, ' ']);
    const texts = [
      ...Object.values(OPTIONS_TEXT),
      ...startingLivesOffered(classicRules()).map((lives) =>
        bonusLine(resolveExtraLifeAward(classicRules(), lives)),
      ),
    ];
    for (const text of texts) {
      for (const char of text) expect(glyphs.has(char), `${char} in ${text}`).toBe(true);
    }
  });

  it('fits the playfield where the settings card sits', () => {
    const card = cardOver(classicRules());
    const height = cardHeight(card.rows.length, optionsNotes(card).length);
    expect(SETTINGS_CARD_TOP - 6 + height).toBeLessThanOrEqual(LOGICAL_HEIGHT);
  });
});
