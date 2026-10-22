/**
 * The stage view: one stage document of the game, run by the real simulation —
 * the formation it builds and the waves it sends — and steppable a frame at a
 * time in either direction.
 *
 * The run is `./stage-run.ts`: the game's own world, built and stepped with the
 * controls untouched, so the fighter sits at its start column and anything the
 * stage does to an idle player it does here. What is drawn over it is the game's
 * own `drawScene`, plus two things the game does not draw: every formation slot,
 * dim, so the formation can be seen filling, and the flight path of every enemy
 * still flying in, so a wave can be seen before it arrives.
 */

import { STEP_HZ } from '../../engine/loop.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../render/canvas.js';
import { drawScene } from '../../render/scene.js';
import { captivePosition, slotPosition } from '../../sim/formation.js';
import type { CompiledPath, PathSample } from '../../sim/paths.js';
import { findCouplings } from '../../content/couplings.js';
import { couplingLines } from '../compose.js';
import { tracePath } from './path-preview.js';
import { createStageRun, type StageRun, stagePlays, type TimedEvent } from './stage-run.js';
import {
  element,
  factRow,
  fieldset,
  type LabContext,
  type LabPlace,
  type LabView,
  listbox,
  naturally,
} from './view.js';

/** One colour per wave, cycled: the flight paths of a wave still flying in. */
const WAVE_COLOURS = ['#37e0e8', '#ffe95c', '#ff7edb', '#7cff7c', '#ffa040', '#8c8cff'] as const;
const GHOST = '#4a4a66';
const CAPTIVE_GHOST = '#7a4a7a';

/** How many of the events up to the current frame the log keeps on screen. */
const LOG_LINES = 10;

/** An event as one line: its type, then its fields. */
function describe(entry: TimedEvent): string {
  const { type, ...fields } = entry.event as unknown as Record<string, unknown> & {
    type: string;
  };
  const detail = Object.entries(fields)
    .map(([key, value]) => {
      if (typeof value === 'number')
        return `${key} ${Number.isInteger(value) ? value : value.toFixed(1)}`;
      if (typeof value === 'string' || typeof value === 'boolean') return `${key} ${String(value)}`;
      return `${key} ${JSON.stringify(value)}`;
    })
    .join(', ');
  return `${String(entry.frame).padStart(5)}  ${type}${detail === '' ? '' : `  ${detail}`}`;
}

export function createStageView(lab: LabContext): LabView {
  const { game, sheet, rank } = lab;
  const { registry, rules } = game;
  const plays = stagePlays(game, rank).numbers;
  // In the order the game plays them, and the ones it never plays last.
  const ids = [...registry.stages.keys()].sort(
    (a, b) =>
      (plays.get(a)?.[0] ?? Number.POSITIVE_INFINITY) -
        (plays.get(b)?.[0] ?? Number.POSITIVE_INFINITY) || naturally(a, b),
  );
  const couplings = findCouplings(registry, rules);

  const picker = listbox(
    'stage',
    ids.map((id) => {
      const stage = registry.stages.get(id);
      const numbers = plays.get(id) ?? [];
      const when =
        numbers.length === 0
          ? 'not played'
          : `stage ${numbers.slice(0, 4).join(', ')}${numbers.length > 4 ? ', …' : ''}`;
      return { value: id, label: `${id} · ${stage?.kind ?? '?'} · ${when}` };
    }),
  );
  const sourceLine = element('p', { className: 'hint' });
  const playsTable = element('table');
  const scrubber = element('input', {
    type: 'range',
    id: 'stage-scrub',
    min: '0',
    max: '1',
    step: '1',
    value: '0',
  });
  const button = (text: string, title: string, onclick: () => void): HTMLButtonElement =>
    element('button', { textContent: text, title, onclick });
  const playButton = button('Play', 'play or pause', () => {
    setPlaying(!playing);
  });
  const transport = element('div', { className: 'buttons' }, [
    button('|◀', 'back to frame 0', () => {
      seek(0);
    }),
    button('◀ 1', 'one frame back', () => {
      seek(frame() - 1);
    }),
    playButton,
    button('1 ▶', 'one frame on', () => {
      seek(frame() + 1);
    }),
    button('launch ▶▶', 'on to the next frame an enemy launches', () => {
      const next = run?.launches
        .map((launch) => launch.launched)
        .filter((at): at is number => at !== undefined && at > frame())
        .sort((a, b) => a - b)[0];
      if (next !== undefined) seek(next);
    }),
    button('settle ▶|', 'on to the frame the formation settles', () => {
      if (run?.settledAt !== undefined) seek(run.settledAt);
    }),
  ]);
  const readout = element('table');
  const wavesTable = element('table');
  const aliensTable = element('table');
  const log = element('pre', { className: 'log' });
  const couplingBox = element('div');
  const problem = element('p', { className: 'problem' });

  const root = element('div', { className: 'view' }, [
    fieldset('Stage', [picker, sourceLine]),
    fieldset('Plays as', [playsTable]),
    fieldset('Timeline', [scrubber, transport, readout]),
    fieldset('Waves', [wavesTable]),
    fieldset('Aliens it sends', [aliensTable]),
    fieldset('Events up to this frame', [log]),
    couplingBox,
    problem,
  ]);

  let run: StageRun | undefined;
  let playing = false;
  const traces = new WeakMap<CompiledPath, readonly PathSample[]>();

  const frame = (): number => run?.frame ?? 0;

  function setPlaying(next: boolean): void {
    playing = next && run !== undefined && frame() < run.length;
    playButton.textContent = playing ? 'Pause' : 'Play';
  }

  function seek(target: number): void {
    if (run === undefined) return;
    setPlaying(false);
    run.seek(target);
    scrubber.value = String(run.frame);
    refresh();
  }

  function refresh(): void {
    readout.replaceChildren();
    if (run === undefined) return;
    const { world } = run;
    const states = new Map<string, number>();
    for (const enemy of world.fleet.enemies) {
      states.set(enemy.state, (states.get(enemy.state) ?? 0) + 1);
    }
    const counted = ['standby', 'entering', 'home', 'diving', 'returning', 'dead']
      .filter((state) => (states.get(state) ?? 0) > 0)
      .map((state) => `${String(states.get(state))} ${state}`)
      .join(', ');
    readout.append(
      factRow('frame', `${String(run.frame)} / ${String(run.length)}`),
      factRow('seconds', (run.frame / STEP_HZ).toFixed(2)),
      factRow('enemies', counted === '' ? 'none' : counted),
      factRow('formation', world.formation === undefined ? 'none' : world.formation.motion),
      factRow(
        'settles',
        run.settledAt === undefined ? 'never, in this run' : `frame ${String(run.settledAt)}`,
      ),
      factRow('ends', endText(run)),
    );
    const now = run.frame;
    const upTo = run.events.filter((entry) => entry.frame <= now);
    log.textContent = upTo.slice(-LOG_LINES).map(describe).join('\n');
    // A wave is highlighted while any of its flyers is still flying in.
    const flying = new Set(
      world.fleet.enemies.filter((enemy) => enemy.state === 'entering').map((enemy) => enemy.wave),
    );
    for (const rowElement of wavesTable.querySelectorAll('tr')) {
      rowElement.classList.toggle('current', flying.has(Number(rowElement.dataset.wave)));
    }
  }

  function endText(current: StageRun): string {
    switch (current.end) {
      case 'cleared':
        return `the stage clears on frame ${String(current.length + 1)}`;
      case 'game-over':
        return `the idle fighter's last life goes on frame ${String(current.length)}`;
      case 'settled':
        return `${String(current.length - (current.settledAt ?? 0))} frames after it settles`;
      case 'limit':
        return `at the lab's limit, frame ${String(current.length)}`;
    }
  }

  function select(id: string): void {
    picker.value = id;
    const source = registry.sourceOf('stages', id);
    sourceLine.textContent = source === undefined ? '' : `${source.packId}/${source.file}`;
    problem.textContent = '';
    try {
      run = createStageRun(game, { stageId: id, rank });
    } catch (error) {
      run = undefined;
      problem.textContent = `the game cannot build this stage: ${String(error)}`;
    }
    const stage = registry.stages.get(id);
    const formation = stage === undefined ? undefined : registry.formations.get(stage.formation);
    playsTable.replaceChildren(
      factRow(
        'as',
        run === undefined
          ? '—'
          : run.inSequence
            ? `stage ${String(run.number)} of ${game.name}, rank ${rank}`
            : `not in ${game.name}'s sequence at rank ${rank}: run on its own as stage ${String(run.number)}`,
      ),
      factRow('kind', stage?.kind ?? '—'),
      factRow(
        'formation',
        formation === undefined
          ? '—'
          : `${formation.id}: ${String(formation.slots.length)} slots, ${String(formation.captiveSlots.length)} captive`,
      ),
    );
    wavesTable.replaceChildren();
    for (const wave of run?.waves ?? []) {
      const aliens = [...wave.aliens].map(([alien, count]) => `${alien} ×${String(count)}`);
      const launched =
        wave.firstLaunch === undefined
          ? 'never launched'
          : `launched ${String(wave.firstLaunch)}–${String(wave.lastLaunch)}`;
      const rowElement = factRow(
        `wave ${String(wave.index)} · at ${String(wave.at)}`,
        `${aliens.join(', ')} · ${launched}`,
        wave.firstLaunch === undefined
          ? undefined
          : () => {
              seek(wave.firstLaunch ?? 0);
            },
      );
      rowElement.dataset.wave = String(wave.index);
      wavesTable.append(rowElement);
    }
    const sent = new Map<string, number>();
    for (const wave of run?.waves ?? []) {
      for (const [alien, count] of wave.aliens) sent.set(alien, (sent.get(alien) ?? 0) + count);
    }
    aliensTable.replaceChildren(
      ...[...sent].map(([alien, count]) =>
        factRow(alien, `×${String(count)}`, () => {
          lab.open({ view: 'aliens', id: alien });
        }),
      ),
    );
    const mine = couplings.filter((coupling) => coupling.stages.includes(id));
    couplingBox.replaceChildren(
      ...(mine.length === 0
        ? []
        : [
            fieldset(
              'Coupled to the rules',
              mine.flatMap((coupling) =>
                couplingLines(coupling).map((line) => element('p', { textContent: line })),
              ),
            ),
          ]),
    );
    scrubber.max = String(Math.max(1, run?.length ?? 1));
    scrubber.value = '0';
    setPlaying(false);
    refresh();
  }

  picker.addEventListener('change', () => {
    select(picker.value);
    lab.changed();
  });
  scrubber.addEventListener('input', () => {
    seek(Number(scrubber.value));
  });

  const view: LabView = {
    id: 'stages',
    root,
    get item() {
      return picker.value === '' ? undefined : picker.value;
    },
    show(place: LabPlace) {
      if (registry.stages.has(place.id)) select(place.id);
    },
    take() {
      seek(0);
      setPlaying(true);
    },
    update() {
      if (!playing || run === undefined) return;
      if (run.frame >= run.length) {
        setPlaying(false);
        return;
      }
      run.seek(run.frame + 1);
      scrubber.value = String(run.frame);
      refresh();
    },
    render(ctx) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      if (run === undefined) return;
      const { world } = run;
      const formation = world.formation;
      if (formation !== undefined && world.content !== undefined) {
        // Where each slot is this frame, as a dot at the middle of its sprite.
        ctx.fillStyle = GHOST;
        world.content.formation.slots.forEach((_slot, index) => {
          const at = slotPosition(formation, world.rules, index);
          ctx.fillRect(Math.round(at.x) + 7, Math.round(at.y) + 7, 3, 3);
        });
        ctx.fillStyle = CAPTIVE_GHOST;
        world.content.formation.captiveSlots.forEach((_slot, index) => {
          const at = captivePosition(formation, world.rules, index);
          ctx.fillRect(Math.round(at.x) + 7, Math.round(at.y) + 7, 3, 3);
        });
      }
      for (const enemy of world.fleet.enemies) {
        if (enemy.state !== 'entering') continue;
        const flight = world.fleet.flights.get(enemy.id);
        if (flight === undefined) continue;
        let trace = traces.get(flight);
        if (trace === undefined) {
          trace = tracePath(flight);
          traces.set(flight, trace);
        }
        ctx.beginPath();
        trace.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x + 8.5, point.y + 8.5);
          else ctx.lineTo(point.x + 8.5, point.y + 8.5);
        });
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = WAVE_COLOURS[enemy.wave % WAVE_COLOURS.length] ?? '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      drawScene(ctx, world, { sheet });
    },
    destroy() {
      playing = false;
    },
  };

  const first = ids.find((id) => (plays.get(id)?.[0] ?? 0) === 1) ?? ids[0];
  if (first !== undefined) select(first);
  return view;
}
