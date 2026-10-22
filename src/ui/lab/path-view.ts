/**
 * The path view: every movement path in the game, one drawn at a time, with a
 * scrubber, a live readout and a mirror toggle.
 *
 * Playback advances one frame per step of the page's real `createLoop`, so the
 * scrubber and the animation agree with each other and with the simulation: one
 * frame of playback is one simulation step.
 */

import { STEP_HZ } from '../../engine/loop.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../render/canvas.js';
import type { CompiledPath, PathSample, Vec2 } from '../../sim/paths.js';
import { tryCompilePath } from '../../sim/paths.js';
import { drawPathPreview, tracePath } from './path-preview.js';
import {
  element,
  factRow,
  fieldset,
  type LabContext,
  type LabPlace,
  type LabView,
  labelWithPack,
  listbox,
  naturally,
} from './view.js';

/**
 * Where `toSlot` aims until the canvas is clicked. Roughly a formation row.
 *
 * It doubles as the **starting point for a path that states none**, which is what
 * every dive path does: a dive is flown from wherever the enemy already sits, so
 * the slot marker is both where it would have come from and where it would go
 * back to. Without that, a dive path is a compile error here — there is nowhere
 * to begin — and the previewer could show only the entry paths.
 */
const DEFAULT_SLOT: Vec2 = [LOGICAL_WIDTH / 2, 72];
/** Where `aimAtPlayer` aims until shift-click moves it. The player's row. */
const DEFAULT_PLAYER: Vec2 = [LOGICAL_WIDTH / 2, 264];

export function createPathView(lab: LabContext): LabView {
  const { registry } = lab.game;
  const ids = [...registry.paths.keys()].sort(naturally);

  const picker = listbox(
    'path',
    ids.map((id) => ({
      value: id,
      label: labelWithPack(id, registry.sourceOf('paths', id)?.packId),
    })),
  );
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

  const root = element('div', { className: 'view' }, [
    fieldset('Path', [
      picker,
      element('label', {}, [mirrorToggle, ' mirror (reflect about the centre line)']),
    ]),
    fieldset('Scrubber', [scrubber, playButton]),
    fieldset('At this frame', [readout]),
    fieldset('Markers', [
      element('p', {
        className: 'hint',
        textContent:
          'Click the playfield to move the formation slot (green); shift-click to move the player (red). ' +
          'Segment joins are grey dots, fire/trigger events orange.',
      }),
    ]),
    problem,
  ]);

  let slot: Vec2 = DEFAULT_SLOT;
  let player: Vec2 = DEFAULT_PLAYER;
  let compiled: CompiledPath | undefined;
  let trace: readonly PathSample[] = [];
  let frame = 0;
  let playing = true;

  function rebuild(): void {
    const path = registry.path(picker.value);
    if (path === undefined) {
      compiled = undefined;
      trace = [];
      return;
    }
    const result = tryCompilePath(path, {
      mirror: mirrorToggle.checked,
      playfield: { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT },
      slot,
      player,
      // A path with no `start` of its own is a dive: it begins at the slot.
      ...(path.start === undefined && { start: slot }),
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

  function setPlaying(next: boolean): void {
    playing = next;
    playButton.textContent = playing ? 'Pause' : 'Play';
  }

  function refreshReadout(sample: PathSample | undefined): void {
    readout.replaceChildren();
    if (compiled === undefined || sample === undefined) return;
    const segment = compiled.segments[sample.segment];
    readout.append(
      factRow('frame', `${frame.toFixed(0)} / ${compiled.totalFrames.toFixed(1)}`),
      factRow('seconds', (frame / STEP_HZ).toFixed(2)),
      factRow('segment', `${String(sample.segment)} · ${segment?.type ?? '—'}`),
      factRow('x, y', `${sample.x.toFixed(2)}, ${sample.y.toFixed(2)}`),
      factRow('heading', `${sample.heading.toFixed(2)}°`),
      factRow('speed', sample.speed.toFixed(3)),
      factRow('events', String(compiled.events.length)),
      factRow('mirrored', compiled.mirrored ? 'yes' : 'no'),
    );
  }

  picker.addEventListener('change', () => {
    frame = 0;
    rebuild();
    lab.changed();
  });
  mirrorToggle.addEventListener('change', rebuild);
  scrubber.addEventListener('input', () => {
    setPlaying(false);
    frame = Number(scrubber.value);
  });
  playButton.addEventListener('click', () => {
    setPlaying(!playing);
  });
  const view: LabView = {
    id: 'paths',
    root,
    get item() {
      return picker.value === '' ? undefined : picker.value;
    },
    show(place: LabPlace) {
      if (registry.paths.has(place.id)) picker.value = place.id;
      if (place.slot !== undefined) slot = place.slot;
      if (place.mirror !== undefined) mirrorToggle.checked = place.mirror;
      frame = 0;
      setPlaying(true);
      rebuild();
    },
    take() {
      frame = 0;
      setPlaying(true);
    },
    update() {
      if (!playing || compiled === undefined) return;
      frame += 1;
      if (frame > compiled.totalFrames) frame = 0;
      scrubber.value = String(Math.round(frame));
    },
    render(ctx) {
      if (compiled === undefined) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        refreshReadout(undefined);
        return;
      }
      drawPathPreview(ctx, compiled, trace, frame, { slot, player });
      refreshReadout(trace[Math.min(trace.length - 1, Math.round(frame))]);
    },
    pointer(point: Vec2, shift: boolean) {
      if (shift) player = point;
      else slot = point;
      rebuild();
    },
    destroy() {},
  };

  if (ids[0] !== undefined) picker.value = ids[0];
  rebuild();
  return view;
}
