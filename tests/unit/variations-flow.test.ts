import { describe, expect, it } from 'vitest';

import { isVariantDocument } from '../../src/content/variants.js';
import { EMPTY_FRAME, frameOf, type InputFrame } from '../../src/engine/input.js';
import { createComposer } from '../../src/ui/compose.js';
import { createGameFlow, type FlowVariant, type GameFlow } from '../../src/ui/flow.js';
import { MENU_TEXT } from '../../src/ui/menus.js';
import { PACKS_TEXT } from '../../src/ui/packs.js';
import { createSettingsStore, type LegacyBase, type SettingsStore } from '../../src/ui/settings.js';
import { createMemoryStorage, type KeyedStorage } from '../../src/ui/storage.js';
import { NAME_ALPHABET, NAME_END, VARIATION_TEXT } from '../../src/ui/variations.js';
import { installedPacks, shippedVariants, shippedVariantSources } from '../helpers/variants.js';

/**
 * A player's variations, through the game-state machine over the shipped games
 * and the real judge — the captain's question answered as a machine can see it.
 *
 * An edit to a shipped game is a named variation beside it, and the shipped game
 * still plays as it ships; two variations are kept at once, survive a cabinet
 * built afresh over the same storage, and one is deleted; a variation that cannot
 * work is refused; and a settings document from before variations existed is
 * turned into one. `tests/e2e/variations.spec.ts` plays the same story in a
 * browser.
 */

const START = frameOf('start');
const MENU = frameOf('menu');
const DOWN = frameOf('down');
const LEFT = frameOf('left');
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

/** The shipped games as `src/main.ts` hands them to the store, for a version 1 document. */
const bases: readonly LegacyBase[] = shippedVariants().map((variant) => {
  const document = composer.documentOf(variant.id);
  if (!isVariantDocument(document)) throw new Error(`no document for ${variant.id}`);
  return { id: variant.id, name: variant.name, document };
});

const classic = (): FlowVariant => {
  const found = shippedVariants().find((variant) => variant.id === 'classic');
  if (found === undefined) throw new Error('no Classic');
  return found;
};

function cabinet(storage: KeyedStorage = createMemoryStorage()): {
  readonly flow: GameFlow;
  readonly settings: SettingsStore;
} {
  const settings = createSettingsStore({ storage, upgrade: bases });
  const flow = createGameFlow({
    variants: shippedVariants(),
    seed: 'variations',
    settings,
    composer,
  });
  return { flow, settings };
}

/** From boot to the settings screen over whatever game is chosen. */
function toSettings(flow: GameFlow): void {
  if (flow.phase === 'variant-select') press(flow, START);
  expect(flow.phase).toBe('attract');
  press(flow, MENU);
  expect(flow.phase).toBe('settings');
}

/** Back out of the settings to attract. */
function leaveSettings(flow: GameFlow): void {
  press(flow, START);
  expect(flow.phase).toBe('attract');
}

/** Move the settings cursor to a row. */
function toRow(flow: GameFlow, id: string): void {
  for (let step = 0; step < 14 && flow.settingsMenu?.row.id !== id; step += 1) press(flow, DOWN);
  expect(flow.settingsMenu?.row.id).toBe(id);
}

/** Step the GAME row until the named game is chosen. */
function choose(flow: GameFlow, id: string): void {
  toRow(flow, 'game');
  for (let step = 0; step < 10 && flow.game.id !== id; step += 1) press(flow, RIGHT);
  expect(flow.game.id).toBe(id);
}

/** On the pack card, switch one pack on or off. */
function togglePack(flow: GameFlow, id: string): void {
  for (let step = 0; step < 6 && flow.packEditor?.row.id !== id; step += 1) press(flow, DOWN);
  expect(flow.packEditor?.row.id).toBe(id);
  press(flow, RIGHT);
}

/** On the naming card, step back over every letter taken. */
function clearName(flow: GameFlow): void {
  for (let step = 0; step < 20 && (flow.naming?.entry.taken.length ?? 0) > 0; step += 1) {
    press(flow, MENU);
  }
  expect(flow.naming?.entry.taken).toBe('');
}

/** On the naming card, spell `name` from wherever the cursor is, then take END. */
function spell(flow: GameFlow, name: string): void {
  const choices = [...NAME_ALPHABET, NAME_END];
  for (const letter of name) {
    const from = choices.indexOf(flow.naming?.entry.under ?? NAME_END);
    const to = choices.indexOf(letter);
    for (let step = (to - from + choices.length) % choices.length; step > 0; step -= 1) {
      press(flow, RIGHT);
    }
    expect(flow.naming?.entry.under).toBe(letter);
    press(flow, START);
  }
  expect(flow.naming?.entry.under).toBe(NAME_END);
  press(flow, START);
}

/** Edit Classic's pack list on its card, and keep the edit under `name`. */
function makeFromClassic(flow: GameFlow, pack: string, name: string): void {
  choose(flow, 'classic');
  toRow(flow, 'packs');
  press(flow, RIGHT);
  expect(flow.phase).toBe('packs');
  expect(flow.packEditor?.makesNew).toBe(true);
  togglePack(flow, pack);
  press(flow, START);
  expect(flow.phase).toBe('name');
  clearName(flow);
  spell(flow, name);
  expect(flow.phase).toBe('settings');
}

describe('an edit to a shipped game makes a named game beside it', () => {
  it('names it, chooses it, and leaves the game it came from playing as it ships', () => {
    const { flow, settings } = cabinet();
    toSettings(flow);
    makeFromClassic(flow, 'deep-sea', 'REEFS');

    expect(flow.game).toMatchObject({ id: 'classic-2', name: 'REEFS', variation: true });
    expect(flow.variant.packs).toEqual(['classic', 'deep-sea']);
    expect(settings.value.variations).toHaveLength(1);
    expect(settings.value.variations[0]).toMatchObject({
      id: 'classic-2',
      name: 'REEFS',
      derivedFrom: 'classic',
      packs: ['classic', 'deep-sea'],
    });
    // CLASSIC is still on the list, and choosing it is the shipped game itself —
    // the very object the build loaded, not a copy someone composed.
    expect(flow.games.map((game) => game.id)).toEqual([
      'classic',
      'spore-storm',
      'deep-sea',
      'swarm-remix',
      'classic-2',
    ]);
    choose(flow, 'classic');
    expect(flow.variant).toBe(classic());
    expect(flow.setAside).toBeUndefined();
    leaveSettings(flow);
    press(flow, START);
    expect(flow.phase).toBe('playing');
    expect(flow.world.content?.stage.id).toBe('script-0');
  });

  it('says on the card that keeping makes a new game, and over a variation that it changes it', () => {
    const { flow } = cabinet();
    toSettings(flow);
    toRow(flow, 'packs');
    press(flow, RIGHT);
    expect(flow.packEditor?.makesNew).toBe(true);
    press(flow, MENU);
    makeFromClassic(flow, 'deep-sea', 'REEFS');
    toRow(flow, 'packs');
    press(flow, RIGHT);
    expect(flow.packEditor?.makesNew).toBe(false);
  });

  it('goes back to the card, its draft intact, when the naming card is cancelled', () => {
    const { flow, settings } = cabinet();
    toSettings(flow);
    toRow(flow, 'packs');
    press(flow, RIGHT);
    togglePack(flow, 'deep-sea');
    press(flow, START);
    expect(flow.phase).toBe('name');
    clearName(flow);
    press(flow, MENU);
    expect(flow.phase).toBe('packs');
    expect(flow.packEditor?.draft).toEqual(['classic', 'deep-sea']);
    expect(settings.value.variations).toEqual([]);
    expect(flow.game.id).toBe('classic');
  });

  it('refuses a name another game has, on the card, and keeps nothing', () => {
    const { flow, settings } = cabinet();
    toSettings(flow);
    toRow(flow, 'packs');
    press(flow, RIGHT);
    togglePack(flow, 'deep-sea');
    press(flow, START);
    clearName(flow);
    spell(flow, 'DEEP SEA');
    expect(flow.phase).toBe('name');
    expect(flow.naming?.entry.refusal).toBe(VARIATION_TEXT.takenName);
    expect(settings.value.variations).toEqual([]);
  });
});

describe('two variations at once, kept across a fresh cabinet', () => {
  it('keeps both, lists both after a reload, and remembers the one chosen', () => {
    const storage = createMemoryStorage();
    {
      const { flow } = cabinet(storage);
      toSettings(flow);
      makeFromClassic(flow, 'deep-sea', 'REEFS');
      makeFromClassic(flow, 'swarm-remix', 'REMIXED');
      expect(flow.game.id).toBe('classic-3');
    }
    const { flow } = cabinet(storage);
    expect(flow.phase).toBe('variant-select');
    expect(flow.games.filter((game) => game.variation).map((game) => game.name)).toEqual([
      'REEFS',
      'REMIXED',
    ]);
    expect(flow.game.id).toBe('classic-3');
    expect(flow.variant.packs).toEqual(['classic', 'swarm-remix']);
    // The selector opens on it, and says whose it is.
    expect(flow.variantMenu?.chosen.id).toBe('classic-3');
    expect(flow.variantMenu?.note).toBe('YOURS, FROM STAR SWARM');
  });
});

describe('a variation is the player’s to rename and delete', () => {
  function withTwo(): ReturnType<typeof cabinet> {
    const made = cabinet();
    toSettings(made.flow);
    makeFromClassic(made.flow, 'deep-sea', 'REEFS');
    makeFromClassic(made.flow, 'swarm-remix', 'REMIXED');
    return made;
  }

  it('renames one on the NAME row, changing nothing else', () => {
    const { flow, settings } = withTwo();
    toRow(flow, 'name');
    press(flow, RIGHT);
    expect(flow.phase).toBe('name');
    expect(flow.naming).toMatchObject({ purpose: 'rename', was: 'REMIXED' });
    clearName(flow);
    spell(flow, 'NEW GUN');
    expect(flow.phase).toBe('settings');
    expect(flow.game).toMatchObject({ id: 'classic-3', name: 'NEW GUN' });
    expect(settings.value.variations.map((variation) => variation.name)).toEqual([
      'REEFS',
      'NEW GUN',
    ]);
    expect(settings.value.variations[1]?.packs).toEqual(['classic', 'swarm-remix']);
  });

  it('deletes one only when DELETE is chosen, leaving the other and the shipped games', () => {
    const { flow, settings } = withTwo();
    toRow(flow, 'delete');
    press(flow, RIGHT);
    expect(flow.phase).toBe('delete');
    // Opens on KEEP: the press that opened it cannot be the one that answers it.
    expect(flow.deleteConfirm?.choice).toBe('keep');
    press(flow, START);
    expect(flow.phase).toBe('settings');
    expect(settings.value.variations).toHaveLength(2);

    toRow(flow, 'delete');
    press(flow, RIGHT);
    press(flow, LEFT);
    expect(flow.deleteConfirm?.choice).toBe('delete');
    press(flow, START);
    expect(flow.phase).toBe('settings');
    expect(settings.value.variations.map((variation) => variation.name)).toEqual(['REEFS']);
    // The game it was made from is chosen in its place, and the cursor is on GAME.
    expect(flow.game.id).toBe('classic');
    expect(flow.variant).toBe(classic());
    expect(flow.settingsMenu?.row.id).toBe('game');
    expect(flow.settingsMenu?.rows.map((row) => row.id)).not.toContain('delete');
  });

  it('backs out of the delete card on ESC, deleting nothing', () => {
    const { flow, settings } = withTwo();
    toRow(flow, 'delete');
    press(flow, RIGHT);
    press(flow, RIGHT);
    press(flow, MENU);
    expect(flow.phase).toBe('settings');
    expect(settings.value.variations).toHaveLength(2);
  });

  it('offers neither row on a shipped game', () => {
    const { flow } = cabinet();
    toSettings(flow);
    const ids = flow.settingsMenu?.rows.map((row) => row.id) ?? [];
    expect(ids).not.toContain('name');
    expect(ids).not.toContain('delete');
  });
});

describe('a variation that cannot work', () => {
  it('is refused on the card before it exists, with the reason, and nothing is named', () => {
    const { flow, settings } = cabinet();
    toSettings(flow);
    toRow(flow, 'packs');
    press(flow, RIGHT);
    togglePack(flow, 'classic');
    togglePack(flow, 'deep-sea');
    press(flow, START);
    expect(flow.phase).toBe('packs');
    expect(flow.packEditor?.refused).toBe(true);
    expect(flow.packEditor?.verdict.ok).toBe(false);
    expect(settings.value.variations).toEqual([]);
  });

  it('is listed, set aside and still deletable when a stored one stops loading', () => {
    const storage = createMemoryStorage(
      JSON.stringify({
        version: 2,
        settings: {
          variant: 'classic-2',
          variations: [
            { id: 'classic-2', name: 'MOON', derivedFrom: 'classic', packs: ['classic', 'moon'] },
          ],
        },
      }),
    );
    const { flow, settings } = cabinet(storage);
    expect(flow.game.id).toBe('classic-2');
    expect(flow.variant).toBe(classic());
    expect(flow.setAside?.ok).toBe(false);
    expect(flow.variantMenu?.note).toBe(MENU_TEXT.setAside);

    toSettings(flow);
    toRow(flow, 'packs');
    press(flow, RIGHT);
    expect(flow.packEditor?.rows.at(-1)).toMatchObject({ id: 'moon', value: PACKS_TEXT.missing });
    press(flow, MENU);

    toRow(flow, 'delete');
    press(flow, RIGHT);
    press(flow, RIGHT);
    press(flow, START);
    expect(settings.value.variations).toEqual([]);
    expect(flow.game.id).toBe('classic');
  });
});

describe('a variation a later build has shipped a game under the id of', () => {
  it('is listed apart from that game, refused with the reason, and still deletable', () => {
    // Stored as `deep-sea`: as if a build after it had shipped a game with that id.
    const storage = createMemoryStorage(
      JSON.stringify({
        version: 2,
        settings: {
          variant: '+deep-sea',
          variations: [
            { id: 'deep-sea', name: 'MY SEA', derivedFrom: 'classic', packs: ['classic'] },
          ],
        },
      }),
    );
    const { flow, settings } = cabinet(storage);
    expect(flow.games.map((game) => game.id)).toEqual([
      'classic',
      'spore-storm',
      'deep-sea',
      'swarm-remix',
      '+deep-sea',
    ]);
    expect(flow.game).toMatchObject({ id: '+deep-sea', name: 'MY SEA' });
    expect(flow.setAside?.details).toEqual(['ID deep-sea', 'A SHIPPED GAME HAS ITS ID']);
    // The shipped game of that id is untouched by it.
    toSettings(flow);
    choose(flow, 'deep-sea');
    expect(flow.variant).toBe(shippedVariants().find((variant) => variant.id === 'deep-sea'));

    choose(flow, '+deep-sea');
    toRow(flow, 'delete');
    press(flow, RIGHT);
    press(flow, RIGHT);
    press(flow, START);
    expect(settings.value.variations).toEqual([]);
    expect(flow.game.id).toBe('classic');
  });
});

describe('a settings document from before variations existed', () => {
  it('turns the override into a variation that plays, and leaves CLASSIC as shipped', () => {
    const storage = createMemoryStorage(
      JSON.stringify({
        version: 1,
        settings: {
          variant: 'classic',
          packs: { classic: ['classic', 'deep-sea'] },
          stages: { classic: ['reef-2'] },
        },
      }),
    );
    const { flow, settings } = cabinet(storage);
    // What the player was playing yesterday is what plays — under a name now.
    expect(flow.game).toMatchObject({ id: 'classic-2', name: 'STAR SWARM 2', variation: true });
    expect(flow.variant.packs).toEqual(['classic', 'deep-sea']);
    expect(flow.variant.stages).toEqual(['reef-2']);
    expect(settings.value.variations).toHaveLength(1);
    // And the reference is one step away, untouched.
    toSettings(flow);
    choose(flow, 'classic');
    expect(flow.variant).toBe(classic());
  });
});
