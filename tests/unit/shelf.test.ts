import { describe, expect, it } from 'vitest';

import {
  deriveVariant,
  isVariantDocument,
  SHELF_GROUP,
  type VariantDocument,
  type VariantSource,
} from '../../src/content/variants.js';
import { EMPTY_FRAME, frameOf, type InputFrame } from '../../src/engine/input.js';
import { launchEnemyBullet } from '../../src/sim/shots.js';
import { createComposer } from '../../src/ui/compose.js';
import { exportText } from '../../src/ui/exchange.js';
import { createGameFlow, type GameFlow } from '../../src/ui/flow.js';
import { createHighScoreBook, type HighScoreBook } from '../../src/ui/highscores.js';
import { legendOf, selectRows } from '../../src/ui/menus.js';
import { createSettingsStore } from '../../src/ui/settings.js';
import {
  AUTHOR_LENGTH,
  byLine,
  changeText,
  gameAsked,
  loadShelf,
  playHref,
  type ShelfLoad,
  shelfCard,
} from '../../src/ui/shelf.js';
import { createMemoryStorage } from '../../src/ui/storage.js';
import { installedPacks, shippedVariants, shippedVariantSources } from '../helpers/variants.js';

/**
 * The shelf: variations other players made, kept in `shelf/` as variant documents
 * and published with the game (`src/ui/shelf.ts`).
 *
 * Every entry here is built from `variants/classic.json` the way the `EXPORT`
 * card writes a variation of it, so a rule is tested against the document a
 * submitter actually has — and none of it reads the shipped `shelf/`, whose
 * contents are the curator's and change with every accepted submission.
 */

/** A shipped game's document as the file holds it. */
function shippedDocument(id: string): VariantDocument {
  const source = shippedVariantSources().find((candidate) => candidate.file === `${id}.json`);
  if (source === undefined || !isVariantDocument(source.value)) throw new Error(`no ${id}`);
  return source.value;
}

/** A variation of Classic as a submitter would save it: exported, then given an id and an author. */
function entry(overrides: Record<string, unknown> = {}, file?: string): VariantSource {
  const exported = deriveVariant(shippedDocument('classic'), {
    id: 'classic-2',
    name: 'DUSK PATROL',
    from: 'classic',
    packs: ['classic'],
  });
  const value: Record<string, unknown> = {
    ...exported,
    id: 'dusk-patrol',
    author: 'ALICE',
    lives: 5,
    ...overrides,
  };
  for (const [key, item] of Object.entries(value)) if (item === undefined) delete value[key];
  return { file: file ?? `${String(value.id)}.json`, value };
}

function load(...sources: readonly VariantSource[]): ShelfLoad {
  return loadShelf(sources, installedPacks(), shippedVariants());
}

/** The errors filed against one file, as `field: message`. */
function refusals(result: ShelfLoad, file: string): string[] {
  return result.errors
    .filter((error) => error.file === file)
    .map((error) => `${error.field ?? ''}: ${error.message}`);
}

describe('an entry on the shelf is a variant document, judged by the loader first', () => {
  it('takes a variation exported from the game, with an id and an author added', () => {
    const result = load(entry());
    expect(result.errors).toEqual([]);
    expect(result.entries.map(({ variant }) => variant.id)).toEqual(['dusk-patrol']);
    const [only] = result.entries;
    expect(only?.variant.group).toBe(SHELF_GROUP);
    expect(only?.variant.author).toBe('ALICE');
    expect(only?.from.id).toBe('classic');
  });

  it('files every failure under shelf/, where the submitter has to go', () => {
    const result = load(entry({ id: 'reef-run', packs: ['classic', 'coral'] }));
    expect(result.entries).toEqual([]);
    expect(result.errors).toEqual([
      {
        pack: 'shelf',
        file: 'reef-run.json',
        field: 'packs[1]',
        message: 'no pack with id "coral" is installed',
      },
    ]);
  });

  it('refuses what any variant document is refused for', () => {
    const result = load(
      entry({ id: 'misspelt', livez: 5 }),
      entry({ id: 'too-many', lives: 99 }),
      entry({ id: 'no-such-theme', theme: 'thunder' }),
      entry({ id: 'no-such-stage', stages: ['script-99'] }),
      entry({ id: 'wrong-file' }, 'other-name.json'),
    );
    expect(result.entries).toEqual([]);
    expect(refusals(result, 'misspelt.json').join()).toMatch(/livez/);
    expect(refusals(result, 'too-many.json')).toEqual([
      'lives: 99 fighters is not a starting count the rules offer (2, 3, 4, 5)',
    ]);
    expect(refusals(result, 'no-such-theme.json').join()).toMatch(/^theme: "thunder"/);
    expect(refusals(result, 'no-such-stage.json').join()).toMatch(/^stages\[0\]: no stage/);
    expect(refusals(result, 'other-name.json')).toEqual([
      'id: "id" is "wrong-file" but the document is other-name.json',
    ]);
  });
});

describe('the shelf’s own rules', () => {
  it('takes no reference game’s id, so it can never stand in for one', () => {
    expect(refusals(load(entry({ id: 'classic', name: 'MINE' })), 'classic.json')).toEqual([
      'id: duplicate variant id "classic"; a shipped game already has it',
    ]);
  });

  it('takes no id shaped like a player’s own variation, whose table it would share', () => {
    expect(refusals(load(entry({ id: 'classic-2' })), 'classic-2.json')).toEqual([
      `id: "classic-2" is the shape the game gives a player's own variation; choose an id of ` +
        'your own, such as "dusk-patrol", and name the file after it',
    ]);
  });

  it('says who made it, in what the game list can draw', () => {
    expect(refusals(load(entry({ author: undefined })), 'dusk-patrol.json')).toEqual([
      'author: a shelf entry says who made it: add "author" with your name',
    ]);
    const long = 'A'.repeat(AUTHOR_LENGTH + 1);
    expect(refusals(load(entry({ author: long })), 'dusk-patrol.json')).toHaveLength(1);
    expect(refusals(load(entry({ author: 'ZOË' })), 'dusk-patrol.json')).toHaveLength(1);
    expect(refusals(load(entry({ author: '   ' })), 'dusk-patrol.json')).toHaveLength(1);
    // Lower case draws upper case, and a handle's own characters draw as they are.
    expect(load(entry({ author: 'alice_92' })).errors).toEqual([]);
    expect(load(entry({ author: 'A'.repeat(AUTHOR_LENGTH) })).errors).toEqual([]);
  });

  it('has a name the naming card could spell, and no other game’s', () => {
    expect(refusals(load(entry({ name: 'Dusk Patrol' })), 'dusk-patrol.json')[0]).toMatch(
      /^name: "Dusk Patrol" is not a name the naming card can spell/,
    );
    expect(refusals(load(entry({ name: 'STAR SWARM' })), 'dusk-patrol.json')).toEqual([
      'name: "STAR SWARM" is the name of a game already on offer; a variation has a name of its own',
    ]);
    // Between two entries the second, in file order, is the one refused.
    const both = load(entry({ id: 'alpha' }), entry({ id: 'beta' }));
    expect(both.entries.map(({ variant }) => variant.id)).toEqual(['alpha']);
    expect(refusals(both, 'beta.json')).toHaveLength(1);
  });

  it('names the game it was made from, which this build offers', () => {
    expect(refusals(load(entry({ derivedFrom: undefined })), 'dusk-patrol.json')).toEqual([
      'derivedFrom: a shelf entry names the game it was made from; the EXPORT card writes it',
    ]);
    expect(refusals(load(entry({ derivedFrom: 'nowhere' })), 'dusk-patrol.json')[0]).toMatch(
      /^derivedFrom: "nowhere" is no game this build offers/,
    );
    expect(refusals(load(entry({ derivedFrom: 'dusk-patrol' })), 'dusk-patrol.json')).toHaveLength(
      1,
    );
  });

  it('changes something, compared as the game plays rather than as it is written', () => {
    // Classic's own count and its packs' default theme, stated: nothing changes.
    expect(refusals(load(entry({ lives: 3, theme: 'arcade' })), 'dusk-patrol.json')).toEqual([
      ': it plays exactly as STAR SWARM does; a variation changes something',
    ]);
  });

  it('names every problem an entry has in one pass, not the first', () => {
    const result = load(entry({ id: 'classic-2', name: 'STAR SWARM', author: undefined }));
    expect(refusals(result, 'classic-2.json').map((line) => line.split(':')[0])).toEqual([
      'id',
      'author',
      'name',
    ]);
  });

  it('lets one entry fail without taking another down', () => {
    const result = load(entry({ id: 'broken', packs: ['coral'] }), entry());
    expect(result.entries.map(({ variant }) => variant.id)).toEqual(['dusk-patrol']);
    expect(result.errors.map((error) => error.file)).toEqual(['broken.json']);
  });

  it('takes an entry made from another entry, while that one stands', () => {
    const base = entry();
    const made = entry({
      id: 'long-dusk',
      name: 'LONG DUSK',
      derivedFrom: 'dusk-patrol',
      lives: 4,
    });
    const result = load(base, made);
    const second = result.entries.find(({ variant }) => variant.id === 'long-dusk');
    expect(second?.from.id).toBe('dusk-patrol');
    expect(second?.changes).toEqual([{ kind: 'lives', lives: 4, was: 5 }]);

    // Its base refused, it cannot say what it changes, and goes too.
    const orphaned = load(entry({ author: undefined }), made);
    expect(orphaned.entries).toEqual([]);
    expect(refusals(orphaned, 'long-dusk.json')).toEqual([
      'derivedFrom: "dusk-patrol" is an entry the shelf refused, so this one cannot say what it changes',
    ]);
  });

  it('orders the shelf by its documents’ own order, then by id', () => {
    const result = load(
      entry({ id: 'zed', name: 'ZED' }),
      entry({ id: 'alpha', name: 'ALPHA', order: 5 }),
      entry({ id: 'mid', name: 'MID' }),
    );
    expect(result.entries.map(({ variant }) => variant.id)).toEqual(['mid', 'zed', 'alpha']);
  });
});

describe('what an entry changes is derived from the entry', () => {
  const kinds = (overrides: Record<string, unknown>): string[] =>
    (load(entry({ lives: undefined, ...overrides })).entries[0]?.changes ?? []).map(
      (change) => change.kind,
    );

  it('finds each field a variation selects', () => {
    expect(kinds({ lives: 5 })).toEqual(['lives']);
    expect(kinds({ theme: 'dusk' })).toEqual(['theme']);
    expect(kinds({ packs: ['classic', 'deep-sea'] })).toEqual(['packs']);
    expect(kinds({ stages: ['script-0', 'script-1'] })).toEqual(['stages']);
    const classic = shippedDocument('classic') as { difficulty: { presets: unknown[] } };
    expect(
      kinds({
        difficulty: { presets: classic.difficulty.presets.slice(0, 2), defaultPreset: 'arcade' },
      }),
    ).toEqual(['difficulty']);
    const autoplay = (shippedDocument('classic') as { autoplay: Record<string, unknown> }).autoplay;
    expect(kinds({ autoplay: { ...autoplay, defaultPersona: 'expert' } })).toEqual(['autoplay']);
  });

  it('says each one in a sentence, naming packs and themes as they name themselves', () => {
    const result = load(
      entry({ lives: 5, theme: 'dusk', packs: ['classic', 'deep-sea'], stages: ['reef-1'] }),
    );
    const [found] = result.entries;
    if (found === undefined) throw new Error(JSON.stringify(result.errors));
    expect(found.changes.map((change) => changeText(change, found.variant, found.from))).toEqual([
      'Layers Classic + Deep Sea — STAR SWARM layers Classic',
      'Plays its own order of 1 combat stage',
      'Starts with 5 ships — STAR SWARM starts with 3',
      'Plays the DUSK sound — STAR SWARM plays ARCADE',
    ]);
  });

  it('is what the shelf page shows, as text', () => {
    const [found] = load(entry({ theme: 'dusk', description: 'Long and <quiet>' })).entries;
    if (found === undefined) throw new Error('no entry');
    expect(shelfCard(found)).toEqual({
      id: 'dusk-patrol',
      name: 'DUSK PATROL',
      author: 'ALICE',
      description: 'Long and <quiet>',
      from: 'STAR SWARM',
      changes: [
        'Starts with 5 ships — STAR SWARM starts with 3',
        'Plays the DUSK sound — STAR SWARM plays ARCADE',
      ],
      href: './?game=dusk-patrol',
    });
  });

  it('credits the maker of an entry another was made from', () => {
    const result = load(
      entry(),
      entry({ id: 'long-dusk', name: 'LONG DUSK', derivedFrom: 'dusk-patrol', lives: 4 }),
    );
    const second = result.entries.find(({ variant }) => variant.id === 'long-dusk');
    if (second === undefined) throw new Error('no entry');
    expect(shelfCard(second).from).toBe('DUSK PATROL, by ALICE');
  });
});

describe('a link that names one game', () => {
  it('chooses a game on offer, and nothing for any other address', () => {
    expect(playHref('dusk-patrol')).toBe('./?game=dusk-patrol');
    expect(gameAsked('?game=dusk-patrol', ['classic', 'dusk-patrol'])).toBe('dusk-patrol');
    expect(gameAsked('?game=gone', ['classic'])).toBeUndefined();
    expect(gameAsked('', ['classic'])).toBeUndefined();
    expect(gameAsked('?other=classic', ['classic'])).toBeUndefined();
  });
});

describe('a copy of a shelf entry is the player’s', () => {
  it('does not inherit its author', () => {
    const copy = deriveVariant(entry().value as VariantDocument, {
      id: 'dusk-patrol-2',
      name: 'MY DUSK',
      from: 'dusk-patrol',
      packs: ['classic'],
    });
    expect(copy).not.toHaveProperty('author');
    expect(copy.derivedFrom).toBe('dusk-patrol');
  });
});

/* -------------------------------------------------------------------------- */
/* In the game                                                                 */
/* -------------------------------------------------------------------------- */

const START = frameOf('start');
const MENU = frameOf('menu');
const UP = frameOf('up');
const DOWN = frameOf('down');
const RIGHT = frameOf('right');
const FIRE = frameOf('fire');

function press(flow: GameFlow, frame: InputFrame): void {
  flow.step(frame);
  flow.step(EMPTY_FRAME);
}

/** A cabinet built as `src/main.ts` builds one: the reference games, then the shelf. */
function cabinet(sources: readonly VariantSource[], highScores?: HighScoreBook): GameFlow {
  const shelf = loadShelf(sources, installedPacks(), shippedVariants());
  expect(shelf.errors).toEqual([]);
  const variants = [...shippedVariants(), ...shelf.entries.map(({ variant }) => variant)];
  const composer = createComposer({
    sources: [...shippedVariantSources(), ...sources],
    packs: installedPacks(),
    variants,
  });
  return createGameFlow({
    variants,
    seed: 'shelf',
    settings: createSettingsStore({ storage: createMemoryStorage() }),
    composer,
    ...(highScores === undefined ? {} : { highScores }),
  });
}

/** Walk the game list's cursor to a game and take it, landing on its attract screen. */
function choose(flow: GameFlow, id: string): void {
  expect(flow.phase).toBe('variant-select');
  for (let step = 0; step < 20 && flow.variantMenu?.chosen?.id !== id; step += 1) press(flow, DOWN);
  expect(flow.variantMenu?.chosen?.id).toBe(id);
  press(flow, START);
  expect(flow.phase).toBe('attract');
}

describe('a shelf entry in the game', () => {
  it('is listed after the reference games, marked, with its maker under it', () => {
    const flow = cabinet([entry()]);
    const menu = flow.variantMenu;
    if (menu === undefined) throw new Error('no list');
    const rows = selectRows(menu);
    const shipped = shippedVariants().length;
    expect(rows[shipped]).toBe('DUSK PATROL =');
    expect(rows.slice(0, shipped).every((row) => !row.endsWith(' ='))).toBe(true);
    for (let step = 0; step < 20 && menu.chosen?.id !== 'dusk-patrol'; step += 1) press(flow, DOWN);
    expect(flow.variantMenu?.note).toBe(byLine('ALICE'));
    expect(legendOf({ demonstrations: true, variations: false, shelf: true })).toBe(
      '* DEMONSTRATION  = SHELF',
    );
  });

  it('plays its own document, and the reference game it came from as it ships', () => {
    const flow = cabinet([entry({ theme: 'dusk' })]);
    const classic = shippedVariants().find((variant) => variant.id === 'classic');
    choose(flow, 'dusk-patrol');
    expect(flow.variant.id).toBe('dusk-patrol');
    expect(flow.variant.lives).toBe(5);
    expect(flow.variant.theme).toBe('dusk');
    press(flow, MENU);
    for (let step = 0; step < 20 && flow.variantMenu?.chosen?.id !== 'classic'; step += 1) {
      press(flow, UP);
    }
    press(flow, START);
    expect(flow.variant).toBe(classic);
  });

  it('files its scores in a table of its own, never the reference game’s', () => {
    const book = createHighScoreBook({
      storage: createMemoryStorage(),
      carryTo: 'classic',
      defaults: [],
    });
    const flow = cabinet([entry()], book);
    choose(flow, 'dusk-patrol');
    expect(flow.highScores).toBe(book.boardFor('dusk-patrol'));
    press(flow, START);
    expect(flow.phase).toBe('playing');
    for (let step = 0; step < 60_000 && flow.phase !== 'game-over'; step += 1) {
      if (flow.stats.score > 0 && flow.phase === 'playing' && step % 60 === 0) {
        const world = flow.world;
        launchEnemyBullet(world.enemyBullets, world.player.x, world.player.y - 2, 0, 2);
      }
      flow.step(step % 2 === 0 ? FIRE : EMPTY_FRAME);
    }
    expect(flow.phase).toBe('game-over');
    const score = flow.stats.score;
    expect(score).toBeGreaterThan(0);
    for (let step = 0; step < 5_000 && flow.phase !== 'high-score-entry'; step += 1) {
      flow.step(EMPTY_FRAME);
    }
    press(flow, START);
    press(flow, START);
    press(flow, START);
    expect(book.boardFor('dusk-patrol').best()).toBe(score);
    expect(book.boardFor('classic').entries()).toEqual([]);
  });

  it('is read-only: an edit to it is a new variation of the player’s, and it stays as published', () => {
    const source = entry();
    const before = JSON.stringify(source.value);
    const flow = cabinet([source]);
    choose(flow, 'dusk-patrol');
    press(flow, DOWN);
    expect(flow.phase).toBe('options');
    expect(flow.optionsCard?.makesNew).toBe(true);
    press(flow, RIGHT);
    press(flow, START);
    expect(flow.phase).toBe('name');
    press(flow, START);
    expect(flow.phase).toBe('attract');
    expect(flow.game.variation).toBe(true);
    const made = flow.game.document;
    expect(made?.derivedFrom).toBe('dusk-patrol');
    expect(made).not.toHaveProperty('author');
    expect(JSON.stringify(source.value)).toBe(before);
    expect(flow.games.map((game) => game.id)).toContain('dusk-patrol');
  });

  it('cannot be imported over itself: its id is taken, as a reference game’s is', () => {
    const source = entry();
    const flow = cabinet([source]);
    press(flow, MENU);
    // Straight to the list's SETTINGS row, then the IMPORT row at the bottom.
    for (let step = 0; step < 20 && flow.variantMenu?.onSettings !== true; step += 1)
      press(flow, UP);
    press(flow, START);
    expect(flow.phase).toBe('settings');
    for (let step = 0; step < 20 && flow.settingsMenu?.row.id !== 'import'; step += 1) {
      press(flow, DOWN);
    }
    press(flow, RIGHT);
    expect(flow.phase).toBe('import');
    flow.importCard?.offer(exportText(source.value as VariantDocument));
    expect(flow.importCard?.judgement?.verdict.ok).toBe(false);
    expect(flow.importCard?.judgement?.verdict.details).toEqual([
      'ID dusk-patrol',
      'A SHIPPED GAME HAS ITS ID',
    ]);
  });
});
