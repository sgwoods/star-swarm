/**
 * The sound view: every sound document in the game, each audible on its own and
 * drawn as the plan the synth builds for it — and the game's audio themes,
 * auditioned event by event.
 *
 * Sound goes through the game's own synth (`src/audio/synth.ts`): a document is
 * handed to `Synth.start` exactly as the music channel hands one, so what is
 * heard is the graph the game builds. A theme's audition is `./sound-facts.ts`,
 * which asks `themedSounds` — the game's own answer — which document each bound
 * event plays.
 *
 * Audio needs a gesture before a browser will make any; every control that plays
 * is one, and the page unlocks the synth on the first click or key as well.
 */

import { buildSoundPlan, type Playback, type SoundPlan } from '../../audio/synth.js';
import type { Sound } from '../../content/schema.js';
import { createFont } from '../../render/text.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../render/canvas.js';
import { type AuditionRow, auditionOf, soundUses } from './sound-facts.js';
import { drawSoundPlan } from './sound-preview.js';
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

/** Silence between sounds when a theme is auditioned in turn. Seconds. */
const AUDITION_GAP = 0.35;

/** The lab's starting volume: the game's own default is the player's setting. */
const LAB_VOLUME = 0.5;

export function createSoundView(lab: LabContext): LabView {
  const { game, synth } = lab;
  const { registry } = game;
  const { manifest } = registry;
  const ids = [...registry.sounds.keys()].sort(naturally);
  const font = createFont();

  const picker = listbox(
    'sound',
    ids.map((id) => ({
      value: id,
      label: labelWithPack(id, registry.sourceOf('sounds', id)?.packId),
    })),
  );
  const sourceLine = element('p', { className: 'hint' });
  const status = element('p', { className: 'hint' });
  const volume = element('input', {
    type: 'range',
    id: 'volume',
    min: '0',
    max: '100',
    step: '5',
    value: String(LAB_VOLUME * 100),
  });
  const playButton = element('button', { textContent: 'Play', onclick: () => play(picker.value) });
  const stopButton = element('button', { textContent: 'Stop', onclick: () => stop() });
  const documentText = element('pre', { className: 'log' });
  const usesTable = element('table');
  const themePicker = element('select', { id: 'theme' });
  const themeNote = element('p', { className: 'hint' });
  const auditionTable = element('table', { className: 'audition' });
  const auditionButton = element('button', {
    textContent: 'Play each in turn',
    onclick: () => auditionAll(),
  });

  const root = element('div', { className: 'view' }, [
    fieldset('Sound', [
      picker,
      sourceLine,
      element('div', { className: 'buttons' }, [playButton, stopButton]),
      element('label', {}, ['volume ', volume]),
      status,
    ]),
    fieldset('Document', [documentText]),
    fieldset('Where the game plays it', [usesTable]),
    fieldset('Audio theme', [themePicker, themeNote, auditionButton, auditionTable]),
  ]);

  synth.setVolume(LAB_VOLUME);

  /** The document on the canvas, and its plan. */
  let shown: { readonly sound: Sound; readonly plan: SoundPlan } | undefined;
  let playback: Playback | undefined;
  /** The document sounding now, and when on the audio clock it started. */
  let playing: { readonly sound: Sound; readonly plan: SoundPlan; readonly at: number } | undefined;
  /** A theme audition in progress: what is left to play, and when the next may start. */
  let queue: AuditionRow[] = [];
  let nextAt: number | undefined;

  const now = (): number | undefined => synth.context?.currentTime;

  function stop(): void {
    queue = [];
    nextAt = undefined;
    playback?.stop();
    playback = undefined;
    playing = undefined;
    markRow(undefined);
  }

  /** Start one document on the synth. Returns its plan, or `undefined` when nothing could play. */
  function start(sound: Sound): SoundPlan | undefined {
    playback?.stop();
    synth.unlock();
    playback = synth.start(sound);
    if (playback === undefined) {
      status.textContent = synth.available
        ? 'the synth is muted'
        : 'no audio: this browser would not make an AudioContext';
      return undefined;
    }
    status.textContent = '';
    const plan = shown?.sound === sound ? shown.plan : buildSoundPlan(sound);
    playing = { sound, plan, at: now() ?? 0 };
    return plan;
  }

  function play(id: string): void {
    const sound = registry.sound(id);
    if (sound === undefined) return;
    queue = [];
    nextAt = undefined;
    markRow(undefined);
    select(id);
    start(sound);
  }

  function markRow(row: AuditionRow | undefined): void {
    for (const line of auditionTable.querySelectorAll('tr')) {
      line.classList.toggle('current', row !== undefined && line.dataset.key === keyOf(row));
    }
  }

  const keyOf = (row: AuditionRow): string => `${row.channel}:${row.event}:${row.when}`;

  function playRow(row: AuditionRow): void {
    if (row.sound === undefined) return;
    if (registry.sounds.has(row.plays)) select(row.plays);
    const plan = start(row.sound);
    markRow(row);
    if (plan !== undefined && playing !== undefined) {
      nextAt = playing.at + plan.duration + AUDITION_GAP;
    }
  }

  function auditionAll(): void {
    stop();
    queue = [...auditionOf(game, themePicker.value === '' ? undefined : themePicker.value)];
    const first = queue.shift();
    if (first !== undefined) playRow(first);
  }

  function fillAudition(): void {
    const theme = themePicker.value === '' ? undefined : themePicker.value;
    const declared = theme === undefined ? undefined : manifest.themes[theme];
    themeNote.textContent =
      theme === undefined
        ? `${game.name} declares no audio themes: it has one sound, the packs' own.`
        : `${declared?.description ?? ''}${theme === manifest.defaultTheme ? ' · the default' : ''}${theme === game.theme ? ` · what ${game.name} plays` : ''}`;
    auditionTable.replaceChildren();
    for (const row of auditionOf(game, theme)) {
      const swapped = row.plays === row.bound ? row.plays : `${row.plays} (for ${row.bound})`;
      const trigger = `${row.channel === 'music' ? '♪ ' : ''}${row.event}${row.when === '' ? '' : ` · ${row.when}`}`;
      const line = element('tr', {}, [
        element('td', {}, [
          element('button', {
            className: 'link',
            textContent: `▶ ${trigger}`,
            title: `play what ${trigger} plays in this theme`,
            onclick: () => {
              queue = [];
              playRow(row);
            },
          }),
        ]),
        element('td', { textContent: swapped, title: swapped }),
      ]);
      line.dataset.key = keyOf(row);
      auditionTable.append(line);
    }
  }

  function select(id: string): void {
    const sound = registry.sound(id);
    if (sound === undefined) return;
    picker.value = id;
    const source = registry.sourceOf('sounds', id);
    sourceLine.textContent = source === undefined ? '' : `${source.packId}/${source.file}`;
    documentText.textContent = JSON.stringify(sound, null, 1);
    shown = { sound, plan: buildSoundPlan(sound) };
    const uses = soundUses(game, id);
    usesTable.replaceChildren(
      ...(uses.length === 0
        ? [factRow('nothing', "no binding, cue or theme names it: it is only another document's")]
        : uses.map((use) =>
            factRow(
              use.label,
              use.value,
              use.link === undefined
                ? undefined
                : () => {
                    const link = use.link;
                    if (link !== undefined) lab.open(link);
                  },
            ),
          )),
    );
    lab.changed();
  }

  const themes = Object.entries(manifest.themes);
  if (themes.length === 0) {
    themePicker.append(element('option', { value: '', textContent: 'the packs’ own sound' }));
    themePicker.disabled = true;
  } else {
    for (const [id, theme] of themes) {
      themePicker.append(
        element('option', {
          value: id,
          textContent: `${theme.name}${id === manifest.defaultTheme ? ' (default)' : ''}`,
        }),
      );
    }
    themePicker.value = game.theme ?? manifest.defaultTheme ?? themes[0]?.[0] ?? '';
  }
  themePicker.addEventListener('change', () => {
    stop();
    fillAudition();
  });
  picker.addEventListener('change', () => {
    select(picker.value);
  });
  volume.addEventListener('input', () => {
    synth.setVolume(Number(volume.value) / 100);
  });

  const view: LabView = {
    id: 'sounds',
    root,
    get item() {
      return picker.value === '' ? undefined : picker.value;
    },
    show(place: LabPlace) {
      if (registry.sounds.has(place.id)) select(place.id);
    },
    take() {
      play(picker.value);
    },
    update() {
      const time = now();
      if (time === undefined) return;
      if (playing !== undefined && time > playing.at + playing.plan.duration) {
        playing = undefined;
        if (queue.length === 0) markRow(undefined);
      }
      if (nextAt !== undefined && time >= nextAt) {
        nextAt = undefined;
        const next = queue.shift();
        if (next !== undefined) playRow(next);
      }
    },
    render(ctx) {
      if (shown === undefined) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        return;
      }
      const time = now();
      const playhead =
        playing?.sound === shown.sound && time !== undefined ? time - playing.at : undefined;
      drawSoundPlan(ctx, font, shown.plan, playhead);
    },
    destroy() {
      stop();
    },
  };

  fillAudition();
  const first = ids[0];
  if (first !== undefined) select(first);
  return view;
}
