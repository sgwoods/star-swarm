import { describe, expect, it } from 'vitest';

import { resolveExtraLifeAward } from '../../src/content/rules.js';
import { EMPTY_FRAME, frameOf, type InputFrame } from '../../src/engine/input.js';
import { createComposer } from '../../src/ui/compose.js';
import { createGameFlow, type FlowVariant, type GameFlow } from '../../src/ui/flow.js';
import { bonusLine, optionsHeading } from '../../src/ui/options.js';
import { createSettingsStore, type SettingsStore } from '../../src/ui/settings.js';
import { createMemoryStorage, type KeyedStorage } from '../../src/ui/storage.js';
import { NAME_ALPHABET, NAME_END, VARIATION_TEXT } from '../../src/ui/variations.js';
import { quickRunRules } from '../helpers/rules.js';
import { installedPacks, shippedVariants, shippedVariantSources } from '../helpers/variants.js';

/**
 * A game's own options, through the game-state machine over the shipped games and
 * the real judge — the captain's two asks as a machine can see them: a settings
 * control per game, reached from the game, and a reference game that cannot be
 * broken by using it. `tests/e2e/options.spec.ts` plays the same story in a
 * browser.
 */

const START = frameOf('start');
const MENU = frameOf('menu');
const UP = frameOf('up');
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

const shipped = (id: string): FlowVariant => {
  const found = shippedVariants().find((variant) => variant.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
};

/** Every shipped document as the files on disk hold it, for byte comparison. */
const onDisk = (): ReadonlyMap<string, string> =>
  new Map(shippedVariantSources().map((source) => [source.file, JSON.stringify(source.value)]));

function cabinet(storage: KeyedStorage = createMemoryStorage()): {
  readonly flow: GameFlow;
  readonly settings: SettingsStore;
} {
  const settings = createSettingsStore({ storage });
  const flow = createGameFlow({
    variants: shippedVariants(),
    seed: 'options',
    settings,
    composer,
  });
  return { flow, settings };
}

/** From boot to the chosen game's attract screen: the list's first game is Classic. */
function toAttract(flow: GameFlow): void {
  if (flow.phase === 'variant-select') press(flow, START);
  expect(flow.phase).toBe('attract');
}

/** On the naming card, step back over every letter, spell `name`, and keep it. */
function rename(flow: GameFlow, name: string): void {
  for (let step = 0; step < 20 && (flow.naming?.entry.taken.length ?? 0) > 0; step += 1) {
    press(flow, MENU);
  }
  const choices = [...NAME_ALPHABET, NAME_END];
  for (const letter of name) {
    const from = choices.indexOf(flow.naming?.entry.under ?? NAME_END);
    const to = choices.indexOf(letter);
    for (let step = (to - from + choices.length) % choices.length; step > 0; step -= 1) {
      press(flow, RIGHT);
    }
    press(flow, START);
  }
  expect(flow.naming?.entry.under).toBe(NAME_END);
  press(flow, START);
}

/** Open Classic's options, step SHIPS to `lives`, and keep it as a new game called `name`. */
function shipsFromClassic(flow: GameFlow, lives: number, name: string): void {
  toAttract(flow);
  expect(flow.game.id).toBe('classic');
  press(flow, DOWN);
  expect(flow.phase).toBe('options');
  for (let step = 0; step < 4 && flow.optionsCard?.lives !== lives; step += 1) press(flow, RIGHT);
  expect(flow.optionsCard?.lives).toBe(lives);
  press(flow, START);
  expect(flow.phase).toBe('name');
  rename(flow, name);
}

describe('a game’s options are reached from the game', () => {
  it('opens on down — or up — from the game’s attract screen, headed by its name', () => {
    for (const key of [DOWN, UP]) {
      const { flow } = cabinet();
      toAttract(flow);
      press(flow, key);
      expect(flow.phase).toBe('options');
      const card = flow.optionsCard;
      expect(card).toBeDefined();
      expect(optionsHeading(card?.name ?? '')).toBe('STAR SWARM OPTIONS');
      expect(card?.rows.map((row) => `${row.label}=${row.value}`)).toEqual([
        'SHIPS=3',
        'AUDIO=ARCADE',
      ]);
      expect(card?.makesNew).toBe(true);
      // The shipped game's own count is the shipped game: its own verdict, unjudged.
      expect(card?.verdict.headline).toBe("THE GAME'S OWN");
    }
  });

  it('opens over whichever game is chosen, with that game’s own counts', () => {
    const { flow } = cabinet();
    // CONVOY is the list's second game.
    press(flow, DOWN);
    press(flow, START);
    expect(flow.game.id).toBe('convoy');
    press(flow, DOWN);
    expect(optionsHeading(flow.optionsCard?.name ?? '')).toBe('CONVOY OPTIONS');
    const seen: number[] = [];
    for (let step = 0; step < 3; step += 1) {
      press(flow, RIGHT);
      seen.push(flow.optionsCard?.lives ?? 0);
    }
    expect(seen).toEqual([5, 2, 3]);
  });

  it('runs the demo behind the card, as every card over attract does', () => {
    const { flow } = cabinet();
    toAttract(flow);
    press(flow, DOWN);
    const before = flow.demo.world.step;
    press(flow, EMPTY_FRAME);
    expect(flow.demo.world.step).toBeGreaterThan(before);
    expect(flow.world).toBe(flow.demo.world);
  });

  it('goes back to attract on ESC, and writes nothing', () => {
    const { flow, settings } = cabinet();
    toAttract(flow);
    press(flow, DOWN);
    press(flow, RIGHT);
    press(flow, MENU);
    expect(flow.phase).toBe('attract');
    expect(settings.value.variations).toEqual([]);
    expect(flow.variant).toBe(shipped('classic'));
  });

  it('closes on ENTER over the game’s own count, making nothing', () => {
    const { flow, settings } = cabinet();
    toAttract(flow);
    press(flow, DOWN);
    press(flow, RIGHT);
    press(flow, LEFT);
    press(flow, START);
    expect(flow.phase).toBe('attract');
    expect(settings.value.variations).toEqual([]);
  });

  it('never opens a card on the game’s own keys', () => {
    const { flow } = cabinet();
    toAttract(flow);
    for (const key of [LEFT, RIGHT, frameOf('fire'), frameOf('pause'), frameOf('exit')]) {
      press(flow, key);
      expect(flow.phase).toBe('attract');
    }
  });
});

describe('changing a shipped game’s ships makes a game of the player’s own', () => {
  it('names it, chooses it and starts it on that count', () => {
    const { flow, settings } = cabinet();
    shipsFromClassic(flow, 5, 'FIVE SHIPS');

    // Back on the attract screen it was opened from — the new game's.
    expect(flow.phase).toBe('attract');
    expect(flow.game).toMatchObject({ id: 'classic-2', name: 'FIVE SHIPS', variation: true });
    expect(flow.variant.lives).toBe(5);
    expect(settings.value.variations).toHaveLength(1);
    expect(settings.value.variations[0]).toMatchObject({
      id: 'classic-2',
      name: 'FIVE SHIPS',
      derivedFrom: 'classic',
      packs: ['classic'],
      lives: 5,
    });
    // Its demo is this game too: five ships.
    expect(flow.demo.world.startingLives).toBe(5);

    press(flow, START);
    expect(flow.phase).toBe('playing');
    expect(flow.world.startingLives).toBe(5);
    expect(flow.world.lives.reserve).toBe(4);
  });

  it('leaves every shipped document byte-identical, and CLASSIC the very variant the build loaded', () => {
    const before = onDisk();
    const classicDocument = JSON.stringify(composer.documentOf('classic'));
    const { flow, settings } = cabinet();
    shipsFromClassic(flow, 5, 'FIVE SHIPS');

    expect(onDisk()).toEqual(before);
    expect(JSON.stringify(composer.documentOf('classic'))).toBe(classicDocument);
    // Nothing stored names a shipped game's id but the choice of which to play.
    expect(settings.value.variations.map((variation) => variation.id)).toEqual(['classic-2']);

    // Choosing CLASSIC again plays the object the build loaded, on three ships.
    toClassic(flow);
    expect(flow.variant).toBe(shipped('classic'));
    expect(flow.variant.lives).toBe(3);
    press(flow, START);
    expect(flow.world.startingLives).toBe(3);
  });

  it('says the count changes the bonus ships too, before the press', () => {
    const { flow } = cabinet();
    toAttract(flow);
    press(flow, DOWN);
    const rules = shipped('classic').rules;
    expect(flow.optionsCard?.row.note).toBe(bonusLine(resolveExtraLifeAward(rules, 3)));
    press(flow, RIGHT);
    press(flow, RIGHT);
    expect(flow.optionsCard?.row.note).toBe(bonusLine(resolveExtraLifeAward(rules, 5)));
    expect(flow.optionsCard?.verdict.ok).toBe(true);
  });

  it('goes back to the card, its draft intact, when the naming card is cancelled', () => {
    const { flow, settings } = cabinet();
    toAttract(flow);
    press(flow, DOWN);
    press(flow, RIGHT);
    press(flow, START);
    expect(flow.phase).toBe('name');
    expect(flow.naming?.purpose).toBe('create');
    expect(flow.naming?.from).toBe('STAR SWARM');
    for (let step = 0; step < 20 && flow.phase === 'name'; step += 1) press(flow, MENU);
    expect(flow.phase).toBe('options');
    expect(flow.optionsCard?.lives).toBe(4);
    expect(settings.value.variations).toEqual([]);
    expect(flow.game.id).toBe('classic');
  });

  it('refuses the reference game’s name for the copy, so the two cannot be confused', () => {
    const { flow, settings } = cabinet();
    toAttract(flow);
    press(flow, DOWN);
    press(flow, RIGHT);
    press(flow, START);
    rename(flow, 'STAR SWARM');
    expect(flow.phase).toBe('name');
    expect(flow.naming?.entry.refusal).toBe(VARIATION_TEXT.takenName);
    expect(settings.value.variations).toEqual([]);
  });
});

describe('over the player’s own game, the card changes it', () => {
  it('says so, and keeps a new count in place without naming anything', () => {
    const { flow, settings } = cabinet();
    shipsFromClassic(flow, 5, 'FIVE SHIPS');
    press(flow, DOWN);
    expect(flow.optionsCard?.makesNew).toBe(false);
    expect(flow.optionsCard?.lives).toBe(5);
    press(flow, LEFT);
    expect(flow.optionsCard?.lives).toBe(4);
    press(flow, START);
    expect(flow.phase).toBe('attract');
    expect(flow.game.id).toBe('classic-2');
    expect(settings.value.variations).toHaveLength(1);
    expect(settings.value.variations[0]?.lives).toBe(4);
    expect(flow.variant.lives).toBe(4);
  });

  it('states no count once it is back on the rules’ own default', () => {
    const { flow, settings } = cabinet();
    shipsFromClassic(flow, 4, 'FOUR SHIPS');
    press(flow, DOWN);
    press(flow, LEFT);
    expect(flow.optionsCard?.lives).toBe(3);
    press(flow, START);
    expect(settings.value.variations[0]).not.toHaveProperty('lives');
    expect(flow.variant.lives).toBe(3);
  });

  it('survives a cabinet built afresh over the same storage', () => {
    const storage = createMemoryStorage();
    shipsFromClassic(cabinet(storage).flow, 2, 'TWO SHIPS');
    const { flow } = cabinet(storage);
    expect(flow.game.id).toBe('classic-2');
    expect(flow.variant.lives).toBe(2);
  });
});

describe('choosing an audio theme is choosing among what the pack declares', () => {
  /** Open Classic's options, step down to `AUDIO` and onto the next theme. */
  function toDusk(flow: GameFlow): void {
    toAttract(flow);
    press(flow, DOWN);
    press(flow, DOWN);
    expect(flow.optionsCard?.row.id).toBe('audio');
    expect(flow.optionsCard?.row.editable).toBe(true);
    press(flow, RIGHT);
    expect(flow.optionsCard?.theme).toBe('dusk');
  }

  it('offers Classic’s themes by name, opening on its default', () => {
    const { flow } = cabinet();
    toAttract(flow);
    press(flow, DOWN);
    expect(flow.optionsCard?.theme).toBe('arcade');
    press(flow, DOWN);
    const seen: string[] = [];
    for (let step = 0; step < 2; step += 1) {
      press(flow, RIGHT);
      seen.push(flow.optionsCard?.row.value ?? '');
    }
    expect(seen).toEqual(['DUSK', 'ARCADE']);
  });

  it('makes a game of the player’s own carrying the theme, and leaves CLASSIC as shipped', () => {
    const before = onDisk();
    const { flow, settings } = cabinet();
    toDusk(flow);
    expect(flow.optionsCard?.verdict.ok).toBe(true);
    press(flow, START);
    expect(flow.phase).toBe('name');
    rename(flow, 'DUSK');

    expect(flow.game).toMatchObject({ id: 'classic-2', variation: true });
    expect(settings.value.variations[0]).toMatchObject({ derivedFrom: 'classic', theme: 'dusk' });
    expect(settings.value.variations[0]).not.toHaveProperty('lives');
    expect(flow.variant.theme).toBe('dusk');
    expect(onDisk()).toEqual(before);

    toClassic(flow);
    expect(flow.variant).toBe(shipped('classic'));
    expect(flow.variant.theme).toBe('arcade');
  });

  it('states no theme once a variation is back on the default', () => {
    const { flow, settings } = cabinet();
    toDusk(flow);
    press(flow, START);
    rename(flow, 'DUSK');
    press(flow, DOWN);
    expect(flow.optionsCard?.theme).toBe('dusk');
    press(flow, DOWN);
    press(flow, LEFT);
    press(flow, START);
    expect(settings.value.variations[0]).not.toHaveProperty('theme');
    expect(flow.variant.theme).toBe('arcade');
  });

  it('offers each game its own packs’ themes', () => {
    const { flow } = cabinet();
    press(flow, DOWN);
    press(flow, START);
    expect(flow.game.id).toBe('convoy');
    press(flow, DOWN);
    expect(flow.optionsCard?.theme).toBe('convoy');
    press(flow, DOWN);
    expect(flow.optionsCard?.row).toMatchObject({ id: 'audio', value: 'CONVOY', editable: true });
    press(flow, RIGHT);
    expect(flow.optionsCard?.row.value).toBe('GRIT');
  });
});

describe('a flow with nothing to compose with', () => {
  it('opens no options card, as it opens no pack card', () => {
    const flow = createGameFlow({ rules: quickRunRules() });
    expect(flow.phase).toBe('attract');
    press(flow, DOWN);
    expect(flow.phase).toBe('attract');
    expect(flow.optionsCard).toBeUndefined();
  });
});

/** Back to CLASSIC from wherever the flow is, through the list. */
function toClassic(flow: GameFlow): void {
  press(flow, MENU);
  expect(flow.phase).toBe('variant-select');
  for (let step = 0; step < 10 && flow.variantMenu?.chosen?.id !== 'classic'; step += 1) {
    press(flow, UP);
  }
  press(flow, START);
  expect(flow.phase).toBe('attract');
  expect(flow.game.id).toBe('classic');
}
