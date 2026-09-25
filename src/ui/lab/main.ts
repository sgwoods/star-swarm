/**
 * `/lab` — the preview harness of `docs/DESIGN.md` section 8 step 3.
 *
 * Milestone 1 fills in the path previewer: every path in the loaded packs,
 * listed; one drawn, with a scrubber and a mirror toggle. Aliens, sprites,
 * sounds and stages join it in Milestone 4.
 *
 * **Dev build only.** `vite build` is given `index.html` as its only entry, so
 * nothing in this directory reaches a production bundle, and `vite.config.ts`
 * maps the `/lab` URL onto `lab.html` from a plugin that declares
 * `apply: 'serve'`. The game never imports this file, so it costs the game path
 * nothing either.
 *
 * Playback runs on the real `createLoop` at the real fixed step, so the scrubber
 * and the animation agree with each other and with the simulation: one frame of
 * playback is one simulation step.
 */

import { createLoop, STEP_HZ } from '../../engine/loop.js';
import type { ContentRegistry, MovementPath } from '../../content/index.js';
import { createDisplay, LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../render/canvas.js';
import type { CompiledPath, PathSample, Vec2 } from '../../sim/paths.js';
import { tryCompilePath } from '../../sim/paths.js';
import { drawPathPreview, tracePath } from './path-preview.js';
import { loadLabPacks } from './packs.js';

/** Where `toSlot` aims until the canvas is clicked. Roughly a formation row. */
const DEFAULT_SLOT: Vec2 = [LOGICAL_WIDTH / 2, 72];
/** Where `aimAtPlayer` aims until shift-click moves it. The player's row. */
const DEFAULT_PLAYER: Vec2 = [LOGICAL_WIDTH / 2, 264];

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

function row(label: string, value: string): HTMLTableRowElement {
  return element('tr', {}, [
    element('td', { textContent: label }),
    element('td', { textContent: value }),
  ]);
}

function main(): void {
  const screenPane = document.getElementById('screen-pane');
  const panel = document.getElementById('panel');
  if (screenPane === null || panel === null) throw new Error('lab.html is missing its containers');

  panel.append(element('h1', { textContent: 'Star Swarm — path lab' }));

  const packs = loadLabPacks();
  if (!packs.ok) {
    panel.append(
      element('p', {
        className: 'problem',
        textContent: packs.errors
          .map(
            (e) => `${e.pack}/${e.file}${e.field === undefined ? '' : ` ${e.field}`}: ${e.message}`,
          )
          .join('\n'),
      }),
    );
    return;
  }
  const registry: ContentRegistry = packs.registry;

  const ids = [...registry.paths.keys()].sort((a, b) => a.localeCompare(b));
  if (ids.length === 0) {
    panel.append(element('p', { className: 'hint', textContent: 'No paths in the loaded packs.' }));
    return;
  }

  const display = createDisplay({ container: screenPane });

  /* -- controls ---------------------------------------------------------- */

  const picker = element('select', { id: 'path' });
  for (const id of ids) {
    const source = registry.sourceOf('paths', id);
    picker.append(
      element('option', {
        value: id,
        textContent: source === undefined ? id : `${id}  (${source.packId})`,
      }),
    );
  }

  const mirrorToggle = element('input', { type: 'checkbox', id: 'mirror' });
  const playButton = element('button', { textContent: 'Pause' });
  const scrubber = element('input', {
    type: 'range',
    id: 'scrub',
    min: '0',
    max: '1',
    step: '1',
    value: '0',
  });
  const readout = element('table');
  const problem = element('p', { className: 'problem' });

  const picked = element('fieldset', {}, [
    element('legend', { textContent: 'Path' }),
    picker,
    element('label', {}, [mirrorToggle, ' mirror (reflect about the centre line)']),
  ]);

  const transport = element('fieldset', {}, [
    element('legend', { textContent: 'Scrubber' }),
    scrubber,
    playButton,
  ]);
  const facts = element('fieldset', {}, [
    element('legend', { textContent: 'At this frame' }),
    readout,
  ]);
  const help = element('fieldset', {}, [
    element('legend', { textContent: 'Markers' }),
    element('p', {
      className: 'hint',
      textContent:
        'Click the playfield to move the formation slot (green); shift-click to move the player (red). ' +
        'Segment joins are grey dots, fire/trigger events orange.',
    }),
  ]);

  panel.append(picked, transport, facts, help, problem);

  /* -- state -------------------------------------------------------------- */

  let slot: Vec2 = DEFAULT_SLOT;
  let player: Vec2 = DEFAULT_PLAYER;
  let compiled: CompiledPath | undefined;
  let trace: readonly PathSample[] = [];
  let frame = 0;
  let playing = true;

  function currentPath(): MovementPath | undefined {
    return registry.path(picker.value);
  }

  function rebuild(): void {
    const path = currentPath();
    if (path === undefined) return;
    const result = tryCompilePath(path, {
      mirror: mirrorToggle.checked,
      playfield: { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT },
      slot,
      player,
    });
    if (!result.ok) {
      compiled = undefined;
      trace = [];
      problem.textContent = result.errors
        .map((e) =>
          e.segment === undefined ? e.message : `segments[${String(e.segment)}]: ${e.message}`,
        )
        .join('\n');
      return;
    }
    problem.textContent = '';
    compiled = result.path;
    trace = tracePath(result.path);
    scrubber.max = String(Math.max(1, Math.ceil(result.path.totalFrames)));
    if (frame > result.path.totalFrames) frame = 0;
  }

  function refreshReadout(sample: PathSample | undefined): void {
    readout.replaceChildren();
    if (compiled === undefined || sample === undefined) return;
    const segment = compiled.segments[sample.segment];
    readout.append(
      row('frame', `${frame.toFixed(0)} / ${compiled.totalFrames.toFixed(1)}`),
      row('seconds', (frame / STEP_HZ).toFixed(2)),
      row('segment', `${String(sample.segment)} · ${segment?.type ?? '—'}`),
      row('x, y', `${sample.x.toFixed(2)}, ${sample.y.toFixed(2)}`),
      row('heading', `${sample.heading.toFixed(2)}°`),
      row('speed', sample.speed.toFixed(3)),
      row('events', String(compiled.events.length)),
      row('mirrored', compiled.mirrored ? 'yes' : 'no'),
    );
  }

  /* -- wiring -------------------------------------------------------------- */

  picker.addEventListener('change', () => {
    frame = 0;
    rebuild();
  });
  mirrorToggle.addEventListener('change', () => {
    rebuild();
  });
  scrubber.addEventListener('input', () => {
    playing = false;
    playButton.textContent = 'Play';
    frame = Number(scrubber.value);
  });
  playButton.addEventListener('click', () => {
    playing = !playing;
    playButton.textContent = playing ? 'Pause' : 'Play';
  });
  display.canvas.addEventListener('pointerdown', (event: PointerEvent) => {
    const point = display.toLogical(event.clientX, event.clientY);
    const target: Vec2 = [Math.round(point.x), Math.round(point.y)];
    if (event.shiftKey) player = target;
    else slot = target;
    rebuild();
  });

  rebuild();

  createLoop({
    update() {
      if (!playing || compiled === undefined) return;
      frame += 1;
      if (frame > compiled.totalFrames) frame = 0;
      scrubber.value = String(Math.round(frame));
    },
    render() {
      if (compiled === undefined) {
        display.ctx.fillStyle = '#000';
        display.ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        display.present();
        refreshReadout(undefined);
        return;
      }
      drawPathPreview(display.ctx, compiled, trace, frame, { slot, player });
      display.present();
      refreshReadout(trace[Math.min(trace.length - 1, Math.round(frame))]);
    },
  }).start();
}

main();
