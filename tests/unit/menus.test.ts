import { describe, expect, it } from 'vitest';

import type { Persona } from '../../src/content/personas.js';

import type { DifficultyPreset } from '../../src/content/variants.js';
import { LOGICAL_HEIGHT } from '../../src/render/canvas.js';
import { GLYPH_CHARS } from '../../src/render/text.js';
import {
  cardHeight,
  createSettingsMenu,
  createVariantMenu,
  fitText,
  MENU_TEXT,
  type MenuVariant,
  SELECT_CARD_TOP,
  SETTINGS_CARD_TOP,
  SETTINGS_ROW_IDS,
  settingsLines,
  settingsNotes,
  type SettingsMenu,
  variantSelectLines,
  variantSelectNotes,
  volumeBar,
} from '../../src/ui/menus.js';
import { DEFAULT_SETTINGS, type Settings, VOLUME_STEPS } from '../../src/ui/settings.js';
import { shippedVariants } from '../helpers/variants.js';

/**
 * The two menus of `src/ui/menus.ts`, as values with a cursor.
 *
 * Both are pure: the flow calls a verb when it sees an input edge and the draw
 * functions render what the value says, which is what lets this run on the Node
 * environment with no DOM. The property worth protecting is that **neither menu
 * applies anything** — a row that changes calls `write` with a patch and stops
 * there, so there is exactly one place in the codebase where a changed setting
 * has consequences.
 */

const preset = (id: string, rank: string): DifficultyPreset => ({
  id,
  label: id.toUpperCase(),
  rank,
});

function variantOf(id: string, overrides: Partial<MenuVariant> = {}): MenuVariant {
  const presets = overrides.presets ?? [preset('arcade', 'A'), preset('expert', 'D')];
  const first = presets[0];
  if (first === undefined) throw new Error('a variant needs a preset');
  return {
    id,
    name: id.toUpperCase(),
    demonstration: false,
    packs: [id],
    presets,
    defaultPreset: first,
    // No personas by default: the AUTOPLAY row is absent unless a variant ships
    // some, which is the shipped rule and the one most rows here are written for.
    personas: [],
    ...overrides,
  };
}

/** A menu over a settings value this test holds, so writes are observable. */
function menuOver(
  variants: readonly MenuVariant[],
  initial: Partial<Settings> = {},
): { menu: SettingsMenu; settings: () => Settings } {
  let settings: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const first = variants[0];
  if (first === undefined) throw new Error('a menu needs a variant');
  const menu = createSettingsMenu({
    read: () => settings,
    write: (patch) => {
      settings = { ...settings, ...patch };
    },
    variants,
    // The variant in force follows the settings, as the flow's does.
    active: () => variants.find((entry) => entry.id === settings.variant) ?? first,
  });
  return { menu, settings: () => settings };
}

describe('the variant selector', () => {
  const variants = [variantOf('classic'), variantOf('remix'), variantOf('other')];

  it('starts on the first variant when nothing is remembered', () => {
    expect(createVariantMenu({ variants }).chosen.id).toBe('classic');
  });

  it('starts on the remembered variant', () => {
    expect(createVariantMenu({ variants, selected: 'other' }).chosen.id).toBe('other');
  });

  it('starts on the first when the remembered one is no longer installed', () => {
    // A settings document outlives the build it was written against.
    expect(createVariantMenu({ variants, selected: 'deleted' }).chosen.id).toBe('classic');
  });

  it('wraps in both directions', () => {
    const menu = createVariantMenu({ variants });
    menu.previous();
    expect(menu.chosen.id).toBe('other');
    menu.next();
    expect(menu.chosen.id).toBe('classic');
    menu.next();
    menu.next();
    menu.next();
    expect(menu.chosen.id).toBe('classic');
  });

  it('hands back the caller’s own variant, not a copy of it', () => {
    // Generic in the variant type so the flow gets a `FlowVariant` back and does
    // not have to look the choice up again by id.
    const menu = createVariantMenu({ variants });
    expect(menu.chosen).toBe(variants[0]);
  });

  it('refuses to exist with nothing to choose from', () => {
    expect(() => createVariantMenu({ variants: [] })).toThrow(/at least one/);
  });
});

describe('the settings menu', () => {
  it('shows no GAME row when there is only one variant', () => {
    // The same rule that keeps the selector from being a screen nobody needs: a
    // one-game cabinet grows no row whose only value is the game in front of you.
    const { menu } = menuOver([variantOf('classic')]);
    expect(menu.rows.map((row) => row.id)).not.toContain('game');
    expect(menu.rows.map((row) => row.id)).toEqual([
      'difficulty',
      'volume',
      'sound',
      'controls',
      'crt',
      'packs',
    ]);
  });

  it('shows a GAME row when there is a choice', () => {
    const { menu } = menuOver([variantOf('classic'), variantOf('remix')]);
    expect(menu.rows[0]?.id).toBe('game');
    expect(menu.rows[0]?.value).toBe('CLASSIC');
  });

  it('marks a demonstration variant on the GAME row', () => {
    const { menu, settings } = menuOver(
      [variantOf('classic'), variantOf('remix', { demonstration: true })],
      { variant: 'remix' },
    );
    expect(settings().variant).toBe('remix');
    expect(menu.rows[0]?.note).toBe('DEMONSTRATION');
  });

  it('walks the rows with a wrapping cursor', () => {
    const { menu } = menuOver([variantOf('classic')]);
    expect(menu.row.id).toBe('difficulty');
    menu.previous();
    expect(menu.row.id).toBe('packs');
    menu.next();
    expect(menu.row.id).toBe('difficulty');
  });

  it('changes the variant through the GAME row, and only by writing an id', () => {
    const { menu, settings } = menuOver([variantOf('classic'), variantOf('remix')]);
    expect(menu.row.id).toBe('game');
    menu.adjust(1);
    expect(settings().variant).toBe('remix');
    // A patch and nothing else: the menu applied no consequence of its own.
    expect(settings().difficulty).toBeUndefined();
    menu.adjust(1);
    expect(settings().variant).toBe('classic');
  });

  it('cycles the difficulty preset, writing a preset id and never a number', () => {
    const { menu, settings } = menuOver([variantOf('classic')]);
    expect(menu.row.id).toBe('difficulty');
    expect(menu.row.value).toBe('ARCADE');
    menu.adjust(1);
    expect(settings().difficulty).toBe('expert');
    expect(menu.row.value).toBe('EXPERT');
    menu.adjust(-1);
    expect(settings().difficulty).toBe('arcade');
  });

  it('says on the row what a preset does, which is choose a rank', () => {
    const { menu } = menuOver([
      variantOf('classic', {
        presets: [preset('arcade', 'A')],
        defaultPreset: preset('arcade', 'A'),
      }),
    ]);
    expect(menu.row.note).toBe('RANK A');
  });

  it('prefers the preset’s own description when it has one', () => {
    const described: DifficultyPreset = {
      id: 'arcade',
      label: 'ARCADE',
      rank: 'A',
      description: 'THE FACTORY SETTING',
    };
    const { menu } = menuOver([
      variantOf('classic', { presets: [described], defaultPreset: described }),
    ]);
    expect(menu.row.note).toBe('THE FACTORY SETTING');
  });

  it('offers the presets of whichever variant is in force', () => {
    const { menu, settings } = menuOver([
      variantOf('classic'),
      variantOf('remix', { presets: [preset('only', 'B')], defaultPreset: preset('only', 'B') }),
    ]);
    menu.adjust(1);
    expect(settings().variant).toBe('remix');
    menu.next();
    expect(menu.row.id).toBe('difficulty');
    expect(menu.row.value).toBe('ONLY');
    // The remembered `arcade` is not on offer here, so the row shows this
    // variant's own default rather than an id it cannot honour.
    menu.adjust(1);
    expect(settings().difficulty).toBe('only');
  });

  it('steps the volume one menu step at a time and stops at the ends', () => {
    const { menu, settings } = menuOver([variantOf('classic')], { volume: 0.5 });
    menu.next();
    expect(menu.row.id).toBe('volume');
    menu.adjust(1);
    expect(settings().volume).toBeCloseTo(0.6, 10);
    for (let step = 0; step < VOLUME_STEPS * 2; step += 1) menu.adjust(1);
    expect(settings().volume).toBe(1);
    for (let step = 0; step < VOLUME_STEPS * 2; step += 1) menu.adjust(-1);
    expect(settings().volume).toBe(0);
  });

  it('toggles sound and the CRT option', () => {
    const { menu, settings } = menuOver([variantOf('classic')]);
    menu.next();
    menu.next();
    expect(menu.row.id).toBe('sound');
    menu.adjust(1);
    expect(settings().muted).toBe(true);
    expect(menu.row.value).toBe('OFF');

    menu.next();
    menu.next();
    expect(menu.row.id).toBe('crt');
    menu.adjust(1);
    expect(settings().crt).toBe(true);
    // The row says what the filter does, now that there is one.
    expect(menu.row.note).toBe(MENU_TEXT.crtNote);
  });

  it('cycles the control scheme', () => {
    const { menu, settings } = menuOver([variantOf('classic')]);
    menu.next();
    menu.next();
    menu.next();
    expect(menu.row.id).toBe('controls');
    expect(menu.row.value).toBe('ARROWS + WASD');
    menu.adjust(1);
    expect(settings().controls).toBe('arrows');
    menu.adjust(1);
    expect(settings().controls).toBe('wasd');
    menu.adjust(1);
    expect(settings().controls).toBe('both');
  });

  it('shows the active pack list, read-only, as the seam for the pack manager', () => {
    const { menu, settings } = menuOver([variantOf('classic', { packs: ['classic', 'extra'] })]);
    menu.previous();
    expect(menu.row.id).toBe('packs');
    // A count in the value column and the list underneath: a pack list is a
    // sentence's worth of text and the value column is a word's worth.
    expect(menu.row.value).toBe('2');
    expect(menu.row.note).toBe('classic + extra');
    expect(menu.row.editable).toBe(false);
    const before = settings();
    menu.adjust(1);
    expect(settings()).toEqual(before);
  });

  it('shows a stored per-variant pack override when there is one', () => {
    const { menu } = menuOver([variantOf('classic', { packs: ['classic'] })], {
      packs: { classic: ['classic', 'chosen-by-the-player'] },
    });
    menu.previous();
    expect(menu.row.note).toBe('classic + chosen-by-the-player');
  });

  it('derives its rows on every read, so nothing on screen goes stale', () => {
    const { menu, settings } = menuOver([variantOf('classic')]);
    menu.adjust(1);
    expect(settings().difficulty).toBe('expert');
    // Read again without touching the menu: the row reflects the write.
    expect(menu.rows[0]?.value).toBe('EXPERT');
  });
});

describe('the AUTOPLAY row', () => {
  const persona = (id: string, over: Record<string, unknown> = {}): Persona => ({
    id,
    label: id.toUpperCase(),
    reactionSteps: 4,
    aimTolerance: 4,
    threatHorizon: 200,
    dodgeMargin: 16,
    shotDiscipline: 0.5,
    panic: 0.1,
    engage: 0.5,
    rescue: false,
    ...over,
  });

  const watchable = (ids: readonly string[], over: Record<string, unknown> = {}) =>
    variantOf('classic', { personas: ids.map((id) => persona(id, over)) });

  it('is absent on a game that ships no personas', () => {
    // The `GAME` row's rule: a row whose only value could be OFF is a row nobody
    // needs, so a variant with no personas has no autoplay row at all.
    const { menu } = menuOver([variantOf('classic')]);
    expect(menu.rows.map((row) => row.id)).not.toContain('autoplay');
  });

  it('appears once a game ships one, reading OFF', () => {
    const { menu } = menuOver([watchable(['beginner'])]);
    const row = menu.rows.find((entry) => entry.id === 'autoplay');
    expect(row?.value).toBe('OFF');
    expect(row?.editable).toBe(true);
  });

  it('sits with DIFFICULTY rather than with the presentation rows', () => {
    // Both are the same kind of thing — how the run is framed, not how it looks —
    // so they are neighbours, and a reader scanning the card finds them together.
    const { menu } = menuOver([watchable(['beginner'])]);
    const ids = menu.rows.map((row) => row.id);
    expect(ids.indexOf('autoplay')).toBe(ids.indexOf('difficulty') + 1);
  });

  it('shows the chosen persona’s own label and description', () => {
    const { menu } = menuOver([watchable(['astronaut'], { description: 'SUPER EXPERT' })], {
      autoplay: 'astronaut',
    });
    const row = menu.rows.find((entry) => entry.id === 'autoplay');
    expect(row?.value).toBe('ASTRONAUT');
    expect(row?.note).toBe('SUPER EXPERT');
  });

  it('reads OFF for a persona this game does not offer', () => {
    // A settings document outlives the build it was written against.
    const { menu } = menuOver([watchable(['beginner'])], { autoplay: 'astronaut' });
    expect(menu.rows.find((entry) => entry.id === 'autoplay')?.value).toBe('OFF');
  });

  it('cycles off, then every persona, and wraps', () => {
    const { menu, settings } = menuOver([watchable(['a', 'b'])]);
    const at = menu.rows.findIndex((row) => row.id === 'autoplay');
    for (let i = 0; i < at; i += 1) menu.next();
    expect(menu.row.id).toBe('autoplay');

    menu.adjust(1);
    expect(settings().autoplay).toBe('a');
    menu.adjust(1);
    expect(settings().autoplay).toBe('b');
    // Off is a place in the cycle rather than a special case, so right from the last
    // persona lands on it and left from off lands on the last.
    menu.adjust(1);
    expect(settings().autoplay).toBeUndefined();
    menu.adjust(-1);
    expect(settings().autoplay).toBe('b');
  });

  it('follows the GAME row to whichever game is in force', () => {
    // Rows are derived on every read, so switching game switches the personas on
    // offer — and a persona the new game does not have reads as off.
    const { menu, settings } = menuOver([watchable(['a']), variantOf('remix')], {
      autoplay: 'a',
    });
    expect(menu.rows.find((row) => row.id === 'autoplay')?.value).toBe('A');
    const game = menu.rows.findIndex((row) => row.id === 'game');
    for (let i = 0; i < game; i += 1) menu.next();
    menu.adjust(1);
    expect(settings().variant).toBe('remix');
    expect(menu.rows.map((row) => row.id)).not.toContain('autoplay');
  });
});

describe('the volume bar', () => {
  it('fills one cell per menu step', () => {
    expect(volumeBar(0)).toBe(`[${'.'.repeat(VOLUME_STEPS)}]`);
    expect(volumeBar(1)).toBe(`[${'#'.repeat(VOLUME_STEPS)}]`);
    expect(volumeBar(0.5)).toBe('[#####.....]');
  });

  it('is the same width whatever it is handed', () => {
    for (const value of [-1, 0, 0.33, 0.67, 1, 2, Number.NaN]) {
      expect(volumeBar(value)).toHaveLength(VOLUME_STEPS + 2);
    }
  });
});

describe('fitting text to a card', () => {
  it('leaves anything that already fits alone', () => {
    expect(fitText('ARCADE', 10)).toBe('ARCADE');
    expect(fitText('ARCADE', 6)).toBe('ARCADE');
  });

  it('cuts anything longer', () => {
    expect(fitText('THE HARDEST ROM SETTING', 10)).toBe('THE HARDES');
    expect(fitText('anything', 0)).toBe('');
  });

  it('is what keeps an authored description on the plate', () => {
    // The playfield is 224 pixels and the font advances a fixed 8 per character,
    // so a card holds a fixed number of them — and a variant's description comes
    // from a document this code has never seen. `drawText` clips nothing, so the
    // alternative to cutting is a sentence drawn across the formation and off the
    // screen, which is what the first recorded clip of the selector showed.
    const description = 'THE 1981 ARCADE GAME, AS FAITHFULLY AS THE REFERENCE ALLOWS.';
    expect(fitText(description, 24)).toHaveLength(24);
  });
});

describe('the variants and presets this repository ships', () => {
  /** Characters that fit across the widest card, inside its padding. */
  const CARD_CELLS = 24;

  it('fit the cards they are drawn on without being cut', () => {
    // Cutting is the safety net, not the plan: the shipped copy is short enough
    // that nothing is lost, and this is what says so when someone edits it.
    for (const variant of shippedVariants()) {
      expect(fitText(variant.name, CARD_CELLS)).toBe(variant.name);
      if (variant.description !== undefined) {
        expect(fitText(variant.description, CARD_CELLS)).toBe(variant.description);
      }
      for (const preset of variant.presets) {
        expect(fitText(preset.label, CARD_CELLS)).toBe(preset.label);
        if (preset.description !== undefined) {
          expect(fitText(preset.description, CARD_CELLS)).toBe(preset.description);
        }
      }
    }
  });
});

describe('the cards fit the playfield', () => {
  /**
   * A card drawn taller than 288 rows runs off the bottom of the screen and
   * nothing reports it — no exception, no failing assertion, just a menu whose
   * last rows are not there. The first draft of the settings card did exactly
   * that: seven rows each carrying their own note came to 196 rows of plate on a
   * 288-row playfield. So the arithmetic is the test.
   */
  const fits = (top: number, height: number): boolean =>
    top - 6 >= 0 && top - 6 + height <= LOGICAL_HEIGHT;

  it('holds the selector, however many variants are on it', () => {
    for (const count of [1, 2, 3, 5, 8]) {
      for (const demonstrations of [false, true]) {
        const height = cardHeight(count, variantSelectLines(demonstrations));
        expect(fits(SELECT_CARD_TOP, height)).toBe(true);
      }
    }
  });

  it('holds the settings menu at its full row count', () => {
    for (const persistent of [true, false]) {
      const height = cardHeight(SETTINGS_ROW_IDS.length, settingsLines(persistent));
      expect(fits(SETTINGS_CARD_TOP, height)).toBe(true);
    }
  });

  it('holds the settings menu the shipped build actually draws', () => {
    const { menu } = menuOver([variantOf('classic'), variantOf('remix')]);
    expect(fits(SETTINGS_CARD_TOP, cardHeight(menu.rows.length, settingsLines(true)))).toBe(true);
  });
});

describe('everything these cards draw is in the pixel font', () => {
  /**
   * `drawText` draws an unknown character as **nothing** and still advances the
   * cursor (`src/render/text.ts`), so a string with a character the font lacks is
   * a gap on screen that no test, no type and no lint rule notices. The first
   * recorded clip of the settings menu showed a volume bar whose filled half was
   * invisible, because the obvious `|` is not one of the glyphs.
   *
   * The font has no lower case either — `drawText` upper-cases, so lower case is
   * fine — and this checks the upper-cased form for that reason.
   */
  const drawable = new Set(GLYPH_CHARS);
  const missing = (text: string): string[] =>
    [...text.toUpperCase()].filter((char) => !drawable.has(char));

  it('covers every fixed string on both cards', () => {
    for (const text of Object.values(MENU_TEXT)) expect(missing(text)).toEqual([]);
  });

  it('covers every volume level the menu can show', () => {
    for (let step = 0; step <= VOLUME_STEPS; step += 1) {
      expect(missing(volumeBar(step / VOLUME_STEPS))).toEqual([]);
    }
  });

  it('covers every row of a menu with every kind of value on it', () => {
    const { menu } = menuOver([variantOf('classic'), variantOf('remix', { demonstration: true })]);
    for (const row of menu.rows) {
      expect(missing(row.label)).toEqual([]);
      expect(missing(row.value)).toEqual([]);
      expect(missing(row.note ?? '')).toEqual([]);
    }
  });

  it('covers the copy the shipped variants carry', () => {
    for (const variant of shippedVariants()) {
      expect(missing(variant.name)).toEqual([]);
      expect(missing(variant.description ?? '')).toEqual([]);
      for (const preset of variant.presets) {
        expect(missing(preset.label)).toEqual([]);
        expect(missing(preset.description ?? '')).toEqual([]);
      }
    }
  });
});

describe('the settings card says how to work it, whatever the browser allows', () => {
  /**
   * The same fault as the exit card's, found looking for it: when `KeyedStorage`
   * is blocked the card used to swap **both** control lines for `THIS SESSION
   * ONLY`, so a player in a browser that refuses site data got a menu with no
   * statement of which key changes a row or which one leaves. Degrading to
   * defaults is right (`src/ui/storage.ts`); degrading to an unanswerable screen
   * is not.
   */
  const help = (persistent: boolean): string[] =>
    settingsNotes('A NOTE', persistent)
      .filter((line) => line.tone === 'help')
      .map((line) => line.text);

  it('names its keys whether or not the settings are being kept', () => {
    for (const persistent of [true, false]) {
      expect(help(persistent)).toContain(MENU_TEXT.settingsKeys);
      expect(help(persistent)).toContain(MENU_TEXT.settingsDone);
    }
  });

  it('still says when the settings are going nowhere', () => {
    expect(help(false)).toContain(MENU_TEXT.sessionOnly);
    expect(help(true)).not.toContain(MENU_TEXT.sessionOnly);
  });

  it('leads with the live row’s note, so the card reads top down', () => {
    const [first] = settingsNotes('A NOTE', false);
    expect(first).toEqual({ text: 'A NOTE', tone: 'note' });
  });

  it('counts the lines from the lines, so the plate cannot be too short', () => {
    for (const persistent of [true, false]) {
      expect(settingsLines(persistent)).toBe(settingsNotes('', persistent).length);
    }
  });
});

describe('the selector says how to work it too', () => {
  const help = (demonstrations: boolean): string[] =>
    variantSelectNotes('A GAME', demonstrations)
      .filter((line) => line.tone === 'help')
      .map((line) => line.text);

  it('names the keys that walk the list, take a game and open the settings', () => {
    for (const demonstrations of [true, false]) {
      expect(help(demonstrations)).toEqual([MENU_TEXT.selectKeys, MENU_TEXT.selectBack]);
    }
    expect(MENU_TEXT.selectKeys).toBe('U/D MOVE   ENTER CHOOSES');
    expect(MENU_TEXT.selectBack).toBe('ESC SETTINGS');
  });

  it('leads with the chosen game’s description, then the legend, then the keys', () => {
    expect(variantSelectNotes('A GAME', true).map((line) => line.tone)).toEqual([
      'note',
      'legend',
      'help',
      'help',
    ]);
    expect(variantSelectNotes('A GAME', false).map((line) => line.tone)).toEqual([
      'note',
      'help',
      'help',
    ]);
  });

  it('counts the lines from the lines, so the plate cannot be too short', () => {
    for (const demonstrations of [true, false]) {
      expect(variantSelectLines(demonstrations)).toBe(
        variantSelectNotes('', demonstrations).length,
      );
    }
  });
});

describe('the settings card names its keys in the scheme every card shares', () => {
  it('moves with up and down, changes with left and right, and leaves on enter or esc', () => {
    expect(MENU_TEXT.settingsKeys).toBe('U/D MOVE   L/R CHANGE');
    expect(MENU_TEXT.settingsDone).toBe('ENTER DONE   ESC BACK');
  });
});
