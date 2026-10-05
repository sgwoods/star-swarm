import { describe, expect, it } from 'vitest';

import { EMPTY_FRAME, frameOf, type InputFrame } from '../../src/engine/input.js';
import { createComposer, VERDICT_TEXT } from '../../src/ui/compose.js';
import { createGameFlow, type FlowVariant, type GameFlow } from '../../src/ui/flow.js';
import { MENU_TEXT } from '../../src/ui/menus.js';
import { PACKS_TEXT } from '../../src/ui/packs.js';
import { createSettingsStore, type SettingsStore } from '../../src/ui/settings.js';
import { createMemoryStorage, type KeyedStorage } from '../../src/ui/storage.js';
import { installedPacks, shippedVariants, shippedVariantSources } from '../helpers/variants.js';

/**
 * The pack manager and the stage-sequence editor inside the game-state machine,
 * over the variants and packs this repository ships and the real judge.
 *
 * What is held here is the milestone's exit check as a machine can see it: a
 * player opens the cards from the settings screen with the keys every card uses,
 * composes a list, keeps it, plays it, finds it kept by a cabinet built afresh over
 * the same storage — and is refused a list that cannot work, on the card, with
 * nothing written. `tests/e2e/packs.spec.ts` plays the same story in a browser.
 */

const START = frameOf('start');
const MENU = frameOf('menu');
const UP = frameOf('up');
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

/** A cabinet over the shipped games, its settings in `storage`, recording variant changes. */
function cabinet(storage: KeyedStorage = createMemoryStorage()): {
  readonly flow: GameFlow;
  readonly settings: SettingsStore;
  readonly changes: FlowVariant[];
} {
  const settings = createSettingsStore({ storage });
  const changes: FlowVariant[] = [];
  const flow = createGameFlow({
    variants: shippedVariants(),
    seed: 'pack-manager',
    settings,
    composer,
    onVariantChange: (variant) => changes.push(variant),
  });
  return { flow, settings, changes };
}

/** From boot to the settings screen over the Classic game. */
function toSettings(flow: GameFlow): void {
  if (flow.phase === 'variant-select') press(flow, START);
  expect(flow.phase).toBe('attract');
  expect(flow.variant.id).toBe('classic');
  press(flow, MENU);
  expect(flow.phase).toBe('settings');
}

/** Move the settings cursor to a row and press right on it. */
function openRow(flow: GameFlow, id: string): void {
  for (let step = 0; step < 12 && flow.settingsMenu?.row.id !== id; step += 1) press(flow, DOWN);
  expect(flow.settingsMenu?.row.id).toBe(id);
  press(flow, RIGHT);
}

/** Move the pack card's cursor to a pack. */
function toPack(flow: GameFlow, id: string): void {
  for (let step = 0; step < 6 && flow.packEditor?.row.id !== id; step += 1) press(flow, DOWN);
  expect(flow.packEditor?.row.id).toBe(id);
}

describe('the PACKS row opens the pack manager', () => {
  it('on right, with the stored list on it, and back to the same settings row on ESC', () => {
    const { flow, settings } = cabinet();
    toSettings(flow);
    openRow(flow, 'packs');
    expect(flow.phase).toBe('packs');
    expect(flow.packEditor?.draft).toEqual(['classic']);
    expect(flow.packEditor?.verdict.headline).toBe(VERDICT_TEXT.own);

    toPack(flow, 'deep-sea');
    press(flow, RIGHT);
    expect(flow.packEditor?.draft).toEqual(['classic', 'deep-sea']);
    press(flow, MENU);
    expect(flow.phase).toBe('settings');
    expect(flow.settingsMenu?.row.id).toBe('packs');
    // Cancelled: nothing reached the document, and nothing changed in the game.
    expect(settings.value.packs).toEqual({});
    expect(flow.variant.packs).toEqual(['classic']);
  });
});

describe('composing a list, keeping it, and playing it', () => {
  it('keeps a list that builds, puts it in force, and plays its stages', () => {
    const storage = createMemoryStorage();
    const { flow, settings, changes } = cabinet(storage);
    toSettings(flow);
    openRow(flow, 'packs');
    toPack(flow, 'deep-sea');
    press(flow, RIGHT);
    expect(flow.packEditor?.verdict.ok).toBe(true);
    press(flow, START);

    expect(flow.phase).toBe('settings');
    expect(settings.value.packs).toEqual({ classic: ['classic', 'deep-sea'] });
    expect(flow.variant.id).toBe('classic');
    expect(flow.variant.packs).toEqual(['classic', 'deep-sea']);
    // Whoever owns the presentation was told: a pack list changes the sprites.
    expect(changes.at(-1)).toBe(flow.variant);
    expect(flow.settingsMenu?.row).toMatchObject({ id: 'packs', value: '2' });

    // The attract demo behind the card is already the mix.
    expect(flow.world.content?.stage.id).toBe('reef-1');

    press(flow, START);
    expect(flow.phase).toBe('attract');
    press(flow, START);
    expect(flow.phase).toBe('playing');
    expect(flow.world.content?.stage.id).toBe('reef-1');
  });

  it('finds the list kept by a cabinet built afresh over the same storage', () => {
    const storage = createMemoryStorage();
    {
      const { flow } = cabinet(storage);
      toSettings(flow);
      openRow(flow, 'packs');
      toPack(flow, 'deep-sea');
      press(flow, RIGHT);
      press(flow, START);
    }
    const { flow } = cabinet(storage);
    expect(flow.variant.packs).toEqual(['classic', 'deep-sea']);
    expect(flow.setAside).toBeUndefined();
    toSettings(flow);
    openRow(flow, 'packs');
    expect(flow.packEditor?.draft).toEqual(['classic', 'deep-sea']);
  });
});

describe('a list that cannot work is refused on the card', () => {
  it('refuses a list with no rules, writes nothing, and says why', () => {
    const { flow, settings } = cabinet();
    toSettings(flow);
    openRow(flow, 'packs');
    toPack(flow, 'classic');
    press(flow, RIGHT);
    toPack(flow, 'deep-sea');
    press(flow, RIGHT);
    expect(flow.packEditor?.draft).toEqual(['deep-sea']);
    expect(flow.packEditor?.verdict).toMatchObject({
      ok: false,
      headline: VERDICT_TEXT.wontLoad,
      details: [VERDICT_TEXT.noRules, VERDICT_TEXT.noRules2],
    });

    press(flow, START);
    expect(flow.phase).toBe('packs');
    expect(flow.packEditor?.refused).toBe(true);
    expect(settings.value.packs).toEqual({});
    expect(flow.variant.packs).toEqual(['classic']);
  });
});

describe('a stored list this build cannot compose is set aside, not lost', () => {
  const stale = (): KeyedStorage =>
    createMemoryStorage(
      JSON.stringify({
        version: 1,
        settings: { packs: { classic: ['classic', 'a-pack-from-another-build'] } },
      }),
    );

  it('plays the game as shipped, and says so on the settings rows', () => {
    const { flow, settings } = cabinet(stale());
    expect(flow.variant.packs).toEqual(['classic']);
    expect(flow.setAside?.details).toEqual([
      'PACK a-pack-from-another-build',
      VERDICT_TEXT.notInstalled,
    ]);
    // Kept in the document for the day the pack is installed again.
    expect(settings.value.packs.classic).toEqual(['classic', 'a-pack-from-another-build']);
    toSettings(flow);
    for (let step = 0; step < 12 && flow.settingsMenu?.row.id !== 'packs'; step += 1) {
      press(flow, DOWN);
    }
    expect(flow.settingsMenu?.row.note).toBe(MENU_TEXT.setAside);
  });

  it('shows the missing pack on the card, where switching it off mends the list', () => {
    const { flow, settings } = cabinet(stale());
    toSettings(flow);
    openRow(flow, 'packs');
    expect(flow.packEditor?.rows.at(-1)).toMatchObject({
      id: 'a-pack-from-another-build',
      value: PACKS_TEXT.missing,
    });
    toPack(flow, 'a-pack-from-another-build');
    press(flow, RIGHT);
    press(flow, START);
    expect(flow.phase).toBe('settings');
    // Back to the variant's own list, which is stored as no override at all.
    expect(settings.value.packs).toEqual({});
    expect(flow.setAside).toBeUndefined();
  });
});

describe('the STAGES row opens the stage-sequence editor', () => {
  /** Open the stage card over a list with Deep Sea in it. */
  function stageCabinet(): ReturnType<typeof cabinet> {
    const made = cabinet(
      createMemoryStorage(
        JSON.stringify({ version: 1, settings: { packs: { classic: ['classic', 'deep-sea'] } } }),
      ),
    );
    toSettings(made.flow);
    openRow(made.flow, 'stages');
    expect(made.flow.phase).toBe('stages');
    return made;
  }

  it('opens on the packs’ own order, and keeps an order the player chose', () => {
    const { flow, settings } = stageCabinet();
    expect(flow.stageEditor?.mine).toBe(false);
    expect(flow.stageEditor?.rows.map((row) => row.value)).toEqual([
      'OWN',
      'reef-1',
      'reef-2',
      'reef-3',
      '--',
    ]);
    // Row 1: right steps it from reef-1 to the next option, which is reef-2.
    press(flow, DOWN);
    press(flow, RIGHT);
    expect(flow.stageEditor?.row.value).toBe('reef-2');
    expect(flow.stageEditor?.draft).toEqual(['reef-2', 'reef-2', 'reef-3']);
    press(flow, START);

    expect(flow.phase).toBe('settings');
    expect(settings.value.stages).toEqual({ classic: ['reef-2', 'reef-2', 'reef-3'] });
    expect(flow.variant.stages).toEqual(['reef-2', 'reef-2', 'reef-3']);
    expect(flow.settingsMenu?.row).toMatchObject({ id: 'stages', value: 'MINE: 3' });

    press(flow, START);
    press(flow, START);
    expect(flow.phase).toBe('playing');
    expect(flow.world.content?.stage.id).toBe('reef-2');
  });

  it('clears a stored order when the pack it needs is switched off — and says so first', () => {
    const storage = createMemoryStorage(
      JSON.stringify({
        version: 1,
        settings: {
          packs: { classic: ['classic', 'deep-sea'] },
          stages: { classic: ['reef-3'] },
        },
      }),
    );
    const { flow, settings } = cabinet(storage);
    expect(flow.variant.stages).toEqual(['reef-3']);
    toSettings(flow);
    openRow(flow, 'packs');
    toPack(flow, 'deep-sea');
    press(flow, RIGHT);
    expect(flow.packEditor?.verdict).toMatchObject({ ok: true, clearsStages: true });
    expect(flow.packEditor?.verdict.details[0]).toBe(VERDICT_TEXT.clearsStages);
    press(flow, START);
    expect(settings.value.packs).toEqual({});
    expect(settings.value.stages).toEqual({});
    expect(flow.variant.stages).toBeUndefined();
  });

  it('cancels on ESC, writing nothing', () => {
    const { flow, settings } = stageCabinet();
    press(flow, DOWN);
    press(flow, RIGHT);
    press(flow, MENU);
    expect(flow.phase).toBe('settings');
    expect(settings.value.stages).toEqual({});
  });

  it('moves up from the ORDER row to the + row, as every list wraps', () => {
    const { flow } = stageCabinet();
    press(flow, UP);
    expect(flow.stageEditor?.row.kind).toBe('add');
  });
});
