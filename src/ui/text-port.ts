/**
 * The text box the export and import cards (`./exchange.ts`) put on the page:
 * the one way a variation leaves this browser and enters another.
 *
 * The game is drawn on a canvas, and a canvas cannot hold text a player can
 * select, copy or paste into. So while either card is open there is a real
 * `<textarea>` over the bottom of the screen: **read-only and selected** on the
 * export card, so `CTRL+C` copies it at once, and **empty and focused** on the
 * import card, so `CTRL+V` pastes into it. Nothing else about the box is the
 * game's: no keys of its own, no buttons, no styling beyond legibility. The cards
 * are the screen; this is the slot the text goes through.
 *
 * Why a box, and not the clipboard alone or a file: reading the clipboard asks
 * the browser for a permission some never grant to a page, and a file wants a
 * picker the keyboard-driven cards cannot drive. A text box works in every
 * browser, needs no permission, and the text in it can travel by anything that
 * carries text. `ENTER` on the export card writes the clipboard too, where the
 * browser allows it ({@link TextPort.copy}); where it does not, the card says so
 * and the selected text is still there.
 *
 * Keys typed into the box still reach the game: the keyboard listens on the
 * window and keeps its bindings (`src/engine/input.ts`), so `ENTER` and `ESC`
 * work the card as they do everywhere, and a bound key is not typed into the box.
 * Pasting is a modifier chord no binding claims, so it reaches the box.
 *
 * Browser-only, and `src/main.ts` is the only caller: nothing on the Node test
 * projects can construct one.
 */

export type TextPortMode = 'export' | 'import';

export interface TextPort {
  /** Show the box for a card: `text` is the export's document, or ignored on import. */
  show: (mode: TextPortMode, text: string) => void;
  /** Take the box off the page. Idempotent. */
  hide: () => void;
  /** What is in the box now. */
  readonly value: string;
  /** Write the clipboard. Resolves false where the browser refuses. Never rejects. */
  copy: (text: string) => Promise<boolean>;
}

export interface TextPortOptions {
  /** Where the box is put. */
  readonly parent: HTMLElement;
  /** Called with the box's whole text whenever it changes on the import card. */
  readonly onInput: (text: string) => void;
}

/** The box's id, so a test or a stylesheet can find it. */
export const TEXT_PORT_ID = 'variation-text';

export function createTextPort(options: TextPortOptions): TextPort {
  const { parent, onInput } = options;
  const box = document.createElement('textarea');
  box.id = TEXT_PORT_ID;
  box.spellcheck = false;
  box.setAttribute('autocomplete', 'off');
  box.setAttribute('aria-label', 'Game text');
  Object.assign(box.style, {
    position: 'fixed',
    left: '50%',
    bottom: '8px',
    transform: 'translateX(-50%)',
    width: 'min(92vw, 560px)',
    height: '7.5em',
    boxSizing: 'border-box',
    padding: '6px 8px',
    background: '#05070f',
    color: '#ffd400',
    border: '1px solid #7d8aa8',
    font: '12px/1.3 ui-monospace, Menlo, Consolas, monospace',
    resize: 'none',
    zIndex: '10',
  });
  let mode: TextPortMode | undefined;
  box.addEventListener('input', () => {
    if (mode === 'import') onInput(box.value);
  });

  return {
    show: (next, text) => {
      if (mode === next) return;
      mode = next;
      box.readOnly = next === 'export';
      box.value = next === 'export' ? text : '';
      box.placeholder = next === 'import' ? 'Paste a game here' : '';
      if (box.parentElement !== parent) parent.append(box);
      box.focus();
      if (next === 'export') {
        box.select();
        // Selecting scrolls to the end; the document reads from its id down.
        box.scrollTop = 0;
      }
    },
    hide: () => {
      if (mode === undefined) return;
      mode = undefined;
      box.blur();
      box.remove();
    },
    get value(): string {
      return box.value;
    },
    copy: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // No clipboard API, or a browser that refuses it here: leave the text
        // selected, which is what the card then tells the player to copy.
        box.focus();
        box.select();
        return false;
      }
    },
  };
}
