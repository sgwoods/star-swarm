/**
 * `/lab` — the preview harness of `docs/DESIGN.md` section 8 step 3.
 *
 * One page, four views of one game's content, each in isolation and without
 * starting a game: **paths** (one drawn, scrubbed and mirrored), **aliens** (the
 * sprites, the dives flown from a real slot, the abilities, what the rules give
 * it), **stages** (the formation filling and the waves arriving, stepped a frame
 * at a time) and **sounds** (each audible on its own, and a theme auditioned
 * event by event).
 *
 * **Everything shown is read from the game.** The lab loads the packs and the
 * variants through the loaders `src/main.ts` runs (`./games.ts`), previews one
 * game's composed registry, and draws, flies, steps and plays through the
 * renderer, the path interpreter, the simulation and the synth the game uses. It
 * holds no content of its own and no rule of its own, so it cannot show something
 * the game would not do.
 *
 * **Dev build only.** `vite build` is given `index.html` and `shelf.html` as its
 * only entries, neither of which reaches this directory, so nothing in it reaches
 * a production bundle, and `vite.config.ts`
 * maps the `/lab` URL onto `lab.html` from a plugin that declares
 * `apply: 'serve'`. The game never imports this file, so it costs the game path
 * nothing either.
 *
 * Playback runs on the real `createLoop` at the real fixed step, so one frame of
 * playback is one simulation step.
 */

import { createSynth, unlockOnFirstGesture } from '../../audio/synth.js';
import { rankFor, type ResolvedVariant } from '../../content/variants.js';
import { createLoop } from '../../engine/loop.js';
import { createDisplay } from '../../render/canvas.js';
import { createSpriteSheet } from '../../render/sprites.js';
import { createAlienView } from './alien-view.js';
import { loadLabGames } from './games.js';
import { createPathView } from './path-view.js';
import { createSoundView } from './sound-view.js';
import { createStageView } from './stage-view.js';
import {
  element,
  fieldset,
  LAB_KEYS,
  type LabContext,
  type LabPlace,
  type LabView,
  VIEW_IDS,
  type ViewId,
} from './view.js';

const FACTORIES: Readonly<Record<ViewId, (lab: LabContext) => LabView>> = {
  paths: createPathView,
  aliens: createAlienView,
  stages: createStageView,
  sounds: createSoundView,
};

/** Where the lab is: which game, at which difficulty, showing what. */
interface Location {
  readonly game: string;
  readonly preset: string;
  readonly place: LabPlace;
}

/** What `tests/e2e/lab.spec.ts` reads, as `window.starSwarm` is for the game. */
export interface LabProbe {
  readonly game: string;
  readonly view: ViewId;
  readonly item: string | undefined;
  /** How many steps `ESC` can go back. */
  readonly depth: number;
  readonly steps: number;
}

declare global {
  interface Window {
    starSwarmLab?: LabProbe;
  }
}

function isViewId(value: string | null): value is ViewId {
  return value !== null && (VIEW_IDS as readonly string[]).includes(value);
}

function main(): void {
  const screenPane = document.getElementById('screen-pane');
  const panel = document.getElementById('panel');
  if (screenPane === null || panel === null) throw new Error('lab.html is missing its containers');

  panel.append(element('h1', { textContent: 'Star Swarm — lab' }));

  const loaded = loadLabGames();
  if (!loaded.ok) {
    panel.append(
      element('p', {
        className: 'problem',
        textContent: loaded.errors
          .map(
            (e) => `${e.pack}/${e.file}${e.field === undefined ? '' : ` ${e.field}`}: ${e.message}`,
          )
          .join('\n'),
      }),
    );
    return;
  }
  const games = loaded.games;
  const display = createDisplay({ container: screenPane });
  const synth = createSynth({ volume: 0.5 });
  unlockOnFirstGesture(synth, window);

  /* -- the page's own controls --------------------------------------------- */

  const gamePicker = element('select', { id: 'game' });
  for (const game of games) {
    gamePicker.append(
      element('option', {
        value: game.id,
        textContent: `${game.name} · ${game.packs.join(' + ')}`,
      }),
    );
  }
  const presetPicker = element('select', { id: 'preset' });
  const tabs = new Map<ViewId, HTMLButtonElement>();
  const nav = element('nav', { className: 'tabs' });
  for (const id of VIEW_IDS) {
    const tab = element('button', {
      textContent: id,
      onclick: () => {
        if (current.view.id !== id) go({ ...location(), place: { view: id, id: '' } });
      },
    });
    tabs.set(id, tab);
    nav.append(tab);
  }
  const viewSlot = element('div');
  const keys = element(
    'table',
    {},
    LAB_KEYS.map(([key, does]) =>
      element('tr', {}, [
        element('td', { textContent: key }),
        element('td', { textContent: does }),
      ]),
    ),
  );
  for (const cell of keys.querySelectorAll('td:last-child')) cell.classList.add('wrap');

  panel.append(
    fieldset('Game', [gamePicker, element('label', {}, ['difficulty ', presetPicker])]),
    nav,
    viewSlot,
    fieldset('Keys', [keys]),
  );

  /* -- state ----------------------------------------------------------------- */

  const history: Location[] = [];
  let steps = 0;
  // A view may report a change while it is being built, before there is a
  // current location to record; the first `mount` records it instead.
  let mounted = false;
  let current: { game: ResolvedVariant; preset: string; view: LabView } = build(initialLocation());

  function gameOf(id: string): ResolvedVariant {
    return games.find((game) => game.id === id) ?? (games[0] as ResolvedVariant);
  }

  function initialLocation(): Location {
    const query = new URLSearchParams(window.location.search);
    const game = gameOf(query.get('game') ?? '');
    const view = query.get('view');
    return {
      game: game.id,
      preset: query.get('preset') ?? game.defaultPreset.id,
      place: { view: isViewId(view) ? view : 'paths', id: query.get('item') ?? '' },
    };
  }

  function location(): Location {
    return {
      game: current.game.id,
      preset: current.preset,
      place: { view: current.view.id, id: current.view.item ?? '' },
    };
  }

  /** Build the view a location names, over its game, and show its item. */
  function build(where: Location): { game: ResolvedVariant; preset: string; view: LabView } {
    const game = gameOf(where.game);
    const preset = game.presets.some((entry) => entry.id === where.preset)
      ? where.preset
      : game.defaultPreset.id;
    const lab: LabContext = {
      game,
      rank: rankFor(game, preset),
      // What `applyVariant` in `src/main.ts` builds, once per game.
      sheet: createSpriteSheet({
        sprites: game.registry.sprites.values(),
        palette: game.registry.manifest.palette,
      }),
      synth,
      open: (place) => {
        go({ ...location(), place });
      },
      changed: () => {
        if (mounted) record();
      },
    };
    const view = FACTORIES[where.place.view](lab);
    if (where.place.id !== '') view.show(where.place);
    return { game, preset, view };
  }

  /** Move to `where`, keeping where the lab was so `ESC` can come back to it. */
  function go(where: Location, remember = true): void {
    if (remember) history.push(location());
    const sameGame = where.game === current.game.id && where.preset === current.preset;
    if (sameGame && where.place.view === current.view.id) {
      current.view.show(where.place);
    } else {
      current.view.destroy();
      current = build(where);
    }
    mount();
  }

  function mount(): void {
    if (viewSlot.firstChild !== current.view.root) viewSlot.replaceChildren(current.view.root);
    gamePicker.value = current.game.id;
    presetPicker.replaceChildren(
      ...current.game.presets.map((preset) =>
        element('option', {
          value: preset.id,
          textContent: `${preset.label} · rank ${preset.rank}`,
        }),
      ),
    );
    presetPicker.value = current.preset;
    for (const [id, tab] of tabs) tab.setAttribute('aria-pressed', String(id === current.view.id));
    record();
  }

  /** Keep the address bar on the current location, so a reload or a link lands here. */
  function record(): void {
    const query = new URLSearchParams({
      game: current.game.id,
      preset: current.preset,
      view: current.view.id,
      ...(current.view.item === undefined ? {} : { item: current.view.item }),
    });
    window.history.replaceState(null, '', `${window.location.pathname}?${query.toString()}`);
  }

  gamePicker.addEventListener('change', () => {
    const game = gameOf(gamePicker.value);
    go({ game: game.id, preset: game.defaultPreset.id, place: { view: current.view.id, id: '' } });
  });
  presetPicker.addEventListener('change', () => {
    go({ ...location(), preset: presetPicker.value });
  });

  /* -- keys: ENTER takes, ESC goes back --------------------------------------- */

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const previous = history.pop();
      if (previous !== undefined) go(previous, false);
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && event.target instanceof HTMLSelectElement) {
      if (event.target.classList.contains('list')) {
        current.view.take();
        event.preventDefault();
      }
    }
  });

  display.canvas.addEventListener('pointerdown', (event: PointerEvent) => {
    const point = display.toLogical(event.clientX, event.clientY);
    current.view.pointer?.([Math.round(point.x), Math.round(point.y)], event.shiftKey);
  });

  mount();
  mounted = true;

  window.starSwarmLab = {
    get game() {
      return current.game.id;
    },
    get view() {
      return current.view.id;
    },
    get item() {
      return current.view.item;
    },
    get depth() {
      return history.length;
    },
    get steps() {
      return steps;
    },
  };

  createLoop({
    update() {
      steps += 1;
      current.view.update();
    },
    render() {
      current.view.render(display.ctx);
      display.present();
    },
  }).start();
}

main();
