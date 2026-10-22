/**
 * What every `/lab` view is, and the few DOM pieces they share.
 *
 * The lab is one page with four views — paths, aliens, stages and sounds — over
 * one game at a time. `./main.ts` owns the page: the game, the difficulty, the
 * canvas, the loop, the keys and the way back. A view owns its half of the panel
 * and what it draws, and asks the page to open another view rather than reaching
 * into one, so a link from an alien to its dive path is a navigation the page can
 * undo with `ESC`.
 */

import type { ResolvedVariant } from '../../content/variants.js';
import type { Synth } from '../../audio/synth.js';
import type { SpriteSheet } from '../../render/sprites.js';
import type { Vec2 } from '../../sim/paths.js';
import type { LabLink } from './alien-facts.js';

export const VIEW_IDS = ['paths', 'aliens', 'stages', 'sounds'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

/** A place in the lab: a view, the item it shows, and what a path is flown from. */
export interface LabPlace extends LabLink {
  /** For a path: the formation slot it is flown from and aims `toSlot` at. */
  readonly slot?: Vec2;
  /** For a path: whether to fly its mirrored variant. */
  readonly mirror?: boolean;
}

/** What the page hands a view. Rebuilt, and the view with it, when the game changes. */
export interface LabContext {
  readonly game: ResolvedVariant;
  /** The difficulty rank the page's preset resolves to. Reaches aliens and stages. */
  readonly rank: string;
  /** The game's sprites, rasterised once, as `src/main.ts` builds them. */
  readonly sheet: SpriteSheet;
  readonly synth: Synth;
  /** Go somewhere else in the lab. `ESC` comes back here. */
  open(place: LabPlace): void;
  /** The view's item changed; the page records it in the address bar. */
  changed(): void;
}

export interface LabView {
  readonly id: ViewId;
  /** The panel half this view owns. The page mounts and drops it. */
  readonly root: HTMLElement;
  /** The item shown, or `undefined` when there is nothing to show. */
  readonly item: string | undefined;
  /** Show `place`'s item; anything else in it is the view's to honour or ignore. */
  show(place: LabPlace): void;
  /** `ENTER` on the view's list: play the highlighted item from its start. */
  take(): void;
  /** One fixed step of the page's loop. */
  update(): void;
  /** Draw onto the 224x288 backbuffer. */
  render(ctx: CanvasRenderingContext2D): void;
  /** A click on the playfield, in logical coordinates; shift held or not. */
  pointer?(point: Vec2, shift: boolean): void;
  /** Stop anything still running — a sound, a timer. */
  destroy(): void;
}

/**
 * The keys the page answers, as the one list its help box iterates, so a key
 * the page answers is named by being added here. The scheme is the game's own
 * (`src/ui/keys.ts`): `ENTER` takes, `ESC` goes back, and there is no exception.
 */
export const LAB_KEYS: readonly (readonly [key: string, does: string])[] = Object.freeze([
  ['U/D', 'move through a list'],
  ['ENTER', 'take: play the highlighted item from its start, or press the focused button'],
  ['ESC', 'back to the view a link opened this from; at the top, nothing'],
  ['L/R', 'on a scrubber: one frame'],
]);

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

export function fieldset(legend: string, children: readonly (Node | string)[]): HTMLElement {
  return element('fieldset', {}, [element('legend', { textContent: legend }), ...children]);
}

/** A two-column row; the value may be a link that opens another view. */
export function factRow(
  label: string,
  value: string,
  open?: () => void,
  title?: string,
): HTMLTableRowElement {
  const cell =
    open === undefined
      ? element('td', { textContent: value, title: title ?? value })
      : element('td', {}, [
          element('button', {
            className: 'link',
            textContent: value,
            title: title ?? value,
            onclick: open,
          }),
        ]);
  return element('tr', {}, [element('td', { textContent: label }), cell]);
}

/**
 * A list a view picks its item from: a listbox, so `U/D` moves through it and the
 * highlighted entry is the one shown. Labels carry the pack each id came from.
 */
export function listbox(
  id: string,
  entries: readonly { readonly value: string; readonly label: string }[],
): HTMLSelectElement {
  const list = element('select', { id, size: Math.min(10, Math.max(4, entries.length)) });
  list.className = 'list';
  for (const entry of entries) {
    list.append(element('option', { value: entry.value, textContent: entry.label }));
  }
  return list;
}

/** Ids compared as a person would sort them: `script-2` before `script-10`. */
export const naturally = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/** `fire  (classic)`: an id, and the pack it resolved to. */
export function labelWithPack(id: string, packId: string | undefined): string {
  return packId === undefined ? id : `${id}  (${packId})`;
}
