/**
 * The alien view: one alien of the game — its sprites, its dives flown from its
 * own formation slots, its abilities, and what the game's rules give it — with no
 * game started.
 *
 * The facts are `./alien-facts.ts`, read off the game's registry and rules. The
 * canvas flies every dive the alien can be launched on, compiled by the
 * simulation's path interpreter from a real slot of its role, mirrored the way the
 * attack director mirrors a dive from that side of the formation; the alien's own
 * sprite flies the highlighted one, animating at its own `frameDuration`.
 */

import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../render/canvas.js';
import { ROLE_COLORS } from '../../render/scene.js';
import { drawSprite } from '../../render/sprites.js';
import { type PathSample, samplePath } from '../../sim/paths.js';
import { couplingLines } from '../compose.js';
import {
  alienFacts,
  type AlienFacts,
  type DiveFlight,
  diveSetting,
  type DiveSetting,
  type Fact,
  flyDive,
} from './alien-facts.js';
import { tracePath } from './path-preview.js';
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

const COLOURS = {
  background: '#000000',
  border: '#232334',
  centreLine: '#2e2e46',
  slot: '#3a3a52',
  dive: '#2a5f6b',
  diveSelected: '#37e0e8',
  capture: '#8c4fd6',
  captureSelected: '#c993ff',
  fighter: '#ff6060',
  chosenSlot: '#7cff7c',
} as const;

/** How many times larger the sprite strip draws each frame. */
const STRIP_SCALE = 3;

interface Flight {
  readonly flight: DiveFlight;
  readonly capture: boolean;
  readonly trace: readonly PathSample[];
}

export function createAlienView(lab: LabContext): LabView {
  const { game, sheet } = lab;
  const { registry } = game;
  const ids = [...registry.aliens.keys()].sort(naturally);

  const picker = listbox(
    'alien',
    ids.map((id) => ({
      value: id,
      label: labelWithPack(id, registry.sourceOf('aliens', id)?.packId),
    })),
  );
  const sourceLine = element('p', { className: 'hint' });
  const strip = element('div', { className: 'strip' });
  const documentTable = element('table');
  const slotPicker = element('select', { id: 'dive-slot' });
  const divesTable = element('table');
  const rulesTable = element('table');
  const rulesLegend = element('legend');
  const stagesTable = element('table');
  const couplingBox = element('div');
  const problem = element('p', { className: 'problem' });

  const rulesBox = element('fieldset', {}, [rulesLegend, rulesTable]);
  const root = element('div', { className: 'view' }, [
    fieldset('Alien', [picker, sourceLine]),
    fieldset('Sprites', [strip]),
    fieldset('Document', [documentTable]),
    fieldset('Dives', [
      element('label', {}, ['from ', slotPicker]),
      divesTable,
      element('p', {
        className: 'hint',
        textContent:
          'Flown by the path interpreter from a slot of its role, mirrored as the attack director mirrors it. ' +
          'Click a slot on the playfield to fly from it.',
      }),
    ]),
    rulesBox,
    fieldset('Stages that send it', [stagesTable]),
    couplingBox,
    problem,
  ]);

  let facts: AlienFacts | undefined;
  let setting: DiveSetting | undefined;
  let flights: Flight[] = [];
  let chosen = 0;
  let frame = 0;

  const linkOf = (fact: Fact): (() => void) | undefined => {
    const link = fact.link;
    return link === undefined ? undefined : () => lab.open(link);
  };

  function fillStrip(current: AlienFacts): void {
    strip.replaceChildren();
    for (const id of current.sprites) {
      const sprite = registry.sprite(id);
      if (sprite === undefined || !sheet.has(id)) continue;
      const count = sheet.frameCount(id);
      const canvas = element('canvas', {
        width: (sprite.size * count + 4 * (count - 1)) * STRIP_SCALE,
        height: sprite.size * STRIP_SCALE,
      });
      const ctx = canvas.getContext('2d');
      if (ctx !== null) {
        ctx.imageSmoothingEnabled = false;
        for (let index = 0; index < count; index += 1) {
          ctx.drawImage(
            sheet.surface(id, index),
            index * (sprite.size + 4) * STRIP_SCALE,
            0,
            sprite.size * STRIP_SCALE,
            sprite.size * STRIP_SCALE,
          );
        }
      }
      const held =
        sprite.frameDuration === undefined
          ? 'no frameDuration'
          : `${String(sprite.frameDuration)} steps a frame`;
      strip.append(
        element('div', { className: 'sprite' }, [
          canvas,
          element('p', {
            className: 'hint',
            textContent: `${id} · ${String(sprite.size)} px · ${String(count)} frame${count === 1 ? '' : 's'} · ${held}`,
          }),
        ]),
      );
    }
  }

  function fly(): void {
    flights = [];
    problem.textContent = '';
    if (facts === undefined || setting === undefined) return;
    const slot = setting.slots[Number(slotPicker.value)] ?? {
      x: LOGICAL_WIDTH / 2 - 8,
      y: 72,
      mirror: false,
    };
    const errors: string[] = [];
    for (const dive of facts.dives) {
      const flight = flyDive(game, dive.path, slot, setting.fighter);
      if (!flight.ok)
        errors.push(`${dive.path}: ${flight.errors.map((e) => e.message).join('; ')}`);
      flights.push({
        flight,
        capture: dive.capture,
        trace: flight.ok ? tracePath(flight.compiled) : [],
      });
    }
    problem.textContent = errors.join('\n');
    if (chosen >= flights.length) chosen = 0;
    frame = 0;
    fillDives();
  }

  function fillDives(): void {
    divesTable.replaceChildren();
    if (facts?.dives.length === 0) {
      divesTable.append(factRow('dives', 'none: it never leaves its slot'));
      return;
    }
    flights.forEach((entry, index) => {
      const { flight } = entry;
      const length = flight.ok
        ? `${flight.compiled.totalFrames.toFixed(0)} frames`
        : 'does not compile';
      const pick = element('button', {
        className: index === chosen ? 'link chosen' : 'link',
        textContent: `${index === chosen ? '▶ ' : ''}${flight.path}`,
        title: 'fly this one on the playfield',
        onclick: () => {
          chosen = index;
          frame = 0;
          fillDives();
        },
      });
      const open = element('button', {
        className: 'link',
        textContent: 'open path',
        onclick: () => {
          const slot = setting?.slots[Number(slotPicker.value)];
          lab.open({
            view: 'paths',
            id: flight.path,
            ...(slot === undefined ? {} : { slot: [slot.x, slot.y], mirror: slot.mirror }),
          });
        },
      });
      divesTable.append(
        element('tr', {}, [
          element('td', {}, [pick]),
          element('td', {}, [`${entry.capture ? 'capture dive · ' : ''}${length} `, open]),
        ]),
      );
    });
  }

  function select(id: string): void {
    facts = alienFacts(game, id, lab.rank);
    if (facts === undefined) return;
    picker.value = id;
    const current = facts;
    sourceLine.textContent =
      current.source === undefined ? '' : `${current.source.packId}/${current.source.file}`;
    fillStrip(current);

    documentTable.replaceChildren(
      ...current.document.map((fact) => factRow(fact.label, fact.value, linkOf(fact))),
    );
    rulesLegend.textContent = `What ${game.name}'s rules give it`;
    rulesTable.replaceChildren(
      ...(current.rules.length === 0
        ? [factRow('rules', 'name nothing about this alien or its role')]
        : current.rules.map((fact) => factRow(fact.label, fact.value, linkOf(fact)))),
    );
    stagesTable.replaceChildren(
      ...(current.stages.length === 0
        ? [factRow('stages', 'no stage document sends it')]
        : current.stages.map((entry) =>
            factRow(
              entry.stage.id,
              `×${String(entry.count)} · ${
                entry.numbers.length === 0
                  ? `not played at rank ${lab.rank}`
                  : `stage ${entry.numbers.slice(0, 6).join(', ')}${entry.numbers.length > 6 ? ', …' : ''}`
              }`,
              () => lab.open({ view: 'stages', id: entry.stage.id }),
            ),
          )),
    );
    couplingBox.replaceChildren(
      ...(current.couplings.length === 0
        ? []
        : [
            fieldset(
              'Coupled to the rules',
              current.couplings.flatMap((coupling) =>
                couplingLines(coupling).map((line) => element('p', { textContent: line })),
              ),
            ),
          ]),
    );

    setting = diveSetting(game, current);
    slotPicker.replaceChildren(
      ...setting.slots.map((slot, index) =>
        element('option', {
          value: String(index),
          textContent: `slot ${String(slot.index)} of ${setting?.formation?.id ?? '—'} (${String(slot.x)}, ${String(slot.y)})${slot.mirror ? ' mirrored' : ''}`,
        }),
      ),
    );
    if (setting.slots.length === 0) {
      slotPicker.append(
        element('option', { value: '0', textContent: 'no formation slot of its role' }),
      );
    }
    slotPicker.value = '0';
    chosen = 0;
    fly();
  }

  picker.addEventListener('change', () => {
    select(picker.value);
    lab.changed();
  });
  slotPicker.addEventListener('change', fly);

  /** Half the alien's sprite: paths are anchors, and a line through the middle reads better. */
  const half = (): number => (registry.sprite(facts?.alien.sprite ?? '')?.size ?? 16) / 2;

  const view: LabView = {
    id: 'aliens',
    root,
    get item() {
      return facts?.alien.id;
    },
    show(place: LabPlace) {
      if (registry.aliens.has(place.id)) select(place.id);
    },
    take() {
      frame = 0;
    },
    update() {
      const current = flights[chosen];
      if (current === undefined || !current.flight.ok) return;
      frame += 1;
      // A beat at the end of the dive before it flies again.
      if (frame > current.flight.compiled.totalFrames + 30) frame = 0;
    },
    render(ctx) {
      ctx.fillStyle = COLOURS.background;
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.fillStyle = COLOURS.centreLine;
      for (let y = 0; y < LOGICAL_HEIGHT; y += 4) ctx.fillRect(LOGICAL_WIDTH / 2, y, 1, 2);
      ctx.strokeStyle = COLOURS.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, LOGICAL_WIDTH - 1, LOGICAL_HEIGHT - 1);
      if (facts === undefined || setting === undefined) return;
      const offset = half();

      // The formation: every other slot dim, its role's in the role's own colour.
      ctx.fillStyle = COLOURS.slot;
      for (const [x, y] of setting.others) {
        ctx.fillRect(Math.round(x + offset) - 1, Math.round(y + offset) - 1, 3, 3);
      }
      ctx.fillStyle = ROLE_COLORS[facts.alien.role] ?? COLOURS.diveSelected;
      for (const slot of setting.slots) {
        ctx.fillRect(Math.round(slot.x + offset) - 1, Math.round(slot.y + offset) - 1, 3, 3);
      }
      const chosenSlot = setting.slots[Number(slotPicker.value)];
      if (chosenSlot !== undefined) {
        cross(ctx, chosenSlot.x + offset, chosenSlot.y + offset, COLOURS.chosenSlot);
      }

      flights.forEach((entry, index) => {
        if (index === chosen || entry.trace.length === 0) return;
        stroke(ctx, entry.trace, offset, entry.capture ? COLOURS.capture : COLOURS.dive);
      });
      const current = flights[chosen];
      if (current !== undefined && current.trace.length > 0) {
        stroke(
          ctx,
          current.trace,
          offset,
          current.capture ? COLOURS.captureSelected : COLOURS.diveSelected,
        );
      }

      const [fx, fy] = setting.fighter;
      cross(ctx, fx + offset, fy + offset, COLOURS.fighter);

      // The alien itself, flying the highlighted dive at its own animation speed.
      const sprite = facts.alien.sprite;
      if (current?.flight.ok === true && sheet.has(sprite)) {
        const at = samplePath(
          current.flight.compiled,
          Math.min(frame, current.flight.compiled.totalFrames),
        );
        drawSprite(ctx, sheet, sprite, at.x, at.y, sheet.frameAt(sprite, frame));
      }
    },
    pointer(point) {
      if (setting === undefined) return;
      const offset = half();
      let best = -1;
      let distance = Number.POSITIVE_INFINITY;
      setting.slots.forEach((slot, index) => {
        const d = Math.hypot(slot.x + offset - point[0], slot.y + offset - point[1]);
        if (d < distance) {
          distance = d;
          best = index;
        }
      });
      if (best < 0 || distance > 12) return;
      slotPicker.value = String(best);
      fly();
    },
    destroy() {},
  };

  const first = ids[0];
  if (first !== undefined) select(first);
  return view;
}

function cross(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
  const cx = Math.round(x);
  const cy = Math.round(y);
  ctx.fillStyle = colour;
  ctx.fillRect(cx - 3, cy, 7, 1);
  ctx.fillRect(cx, cy - 3, 1, 7);
}

function stroke(
  ctx: CanvasRenderingContext2D,
  points: readonly PathSample[],
  offset: number,
  colour: string,
): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = point.x + offset + 0.5;
    const y = point.y + offset + 0.5;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.stroke();
}
