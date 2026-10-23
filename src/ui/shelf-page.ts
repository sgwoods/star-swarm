/**
 * The shelf page (`shelf.html`): the variations other players made, each with
 * who made it, what it changes and a way to play it.
 *
 * **Everything on it is read from the build, the way the game reads it.** The
 * packs, the reference games and the shelf come through the same bundler-side
 * readers and loaders `src/main.ts` runs (`src/content/bundle.ts`, `loadPack`,
 * `loadVariants`, `loadShelf`), so the page cannot list an entry the game would
 * not offer, and what it says an entry changes is derived from the entry
 * (`shelfCard` in `./shelf.ts`) rather than written beside it.
 *
 * `PLAY` is a link to the game with that entry chosen (`./?game=<id>`), so the
 * page needs no game code of its own and an entry is one address anybody can
 * share.
 *
 * The text is somebody else's: every string is set as text, never as markup.
 */

import {
  bundledPackSources,
  bundledShelfSources,
  bundledVariantSources,
} from '../content/bundle.js';
import { formatContentErrors } from '../content/errors.js';
import type { LoadedPack } from '../content/loader.js';
import { loadPack } from '../content/loader.js';
import { loadVariants } from '../content/variants.js';
import { loadShelf, type ShelfCard, shelfCard } from './shelf.js';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { readonly className?: string; readonly text?: string } = {},
  ...children: readonly Node[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  node.append(...children);
  return node;
}

/** One entry's card. */
function cardOf(card: ShelfCard): HTMLElement {
  const play = element('a', { className: 'play', text: `Play ${card.name}` });
  play.href = card.href;
  const article = element(
    'article',
    { className: 'entry' },
    element('h2', { text: card.name }),
    element('p', { className: 'credit', text: `by ${card.author} · made from ${card.from}` }),
  );
  article.id = card.id;
  if (card.description !== undefined) {
    article.append(element('p', { className: 'description', text: card.description }));
  }
  article.append(
    element('h3', { text: 'What it changes' }),
    element('ul', {}, ...card.changes.map((change) => element('li', { text: change }))),
    play,
  );
  return article;
}

/** The shelf's cards, or why there is nothing to show. */
function render(list: HTMLElement): void {
  const packs = new Map<string, LoadedPack>();
  for (const [name, source] of bundledPackSources()) {
    const result = loadPack(source);
    if (result.ok) packs.set(name, result.pack);
  }
  const references = loadVariants(bundledVariantSources(), packs);
  if (!references.ok) {
    list.replaceChildren(
      element('p', { className: 'empty', text: 'The games this build ships did not load.' }),
    );
    console.error(formatContentErrors(references.errors).join('\n'));
    return;
  }
  const shelf = loadShelf(bundledShelfSources(), packs, references.variants);
  // Unreachable on a build the gate passed; said in the console, never on the page.
  if (shelf.errors.length > 0) console.error(formatContentErrors(shelf.errors).join('\n'));

  if (shelf.entries.length === 0) {
    list.replaceChildren(
      element('p', {
        className: 'empty',
        text: 'Nothing is on the shelf yet. The first variation on it could be yours.',
      }),
    );
    return;
  }
  list.replaceChildren(...shelf.entries.map((entry) => cardOf(shelfCard(entry))));
  list.dataset.entries = String(shelf.entries.length);
}

const list = document.getElementById('shelf');
if (list === null) throw new Error('Missing #shelf container');
render(list);
list.setAttribute('aria-busy', 'false');

// The one voice every screen of the game speaks (`./keys.ts`): Enter takes — here
// a focused link does that by itself — and Esc goes back, which from the shelf is
// the game it sits beside.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault();
  window.location.href = './';
});
