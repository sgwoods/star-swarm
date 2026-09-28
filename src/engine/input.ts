/**
 * Abstract input (docs/DESIGN.md pillar 4, section 9).
 *
 * The simulation never sees a key code. It sees an {@link InputFrame}: a bitmask
 * over the fixed action set, sampled exactly once per simulation step. That
 * indirection is what lets the same run be driven by a keyboard, a gamepad, an
 * attract-mode demo or a recorded log (`src/engine/replay.ts`) without the sim
 * knowing the difference.
 */

/**
 * Every action the game understands.
 *
 * The first four are the cabinet's and are the whole of what `src/sim/` reads.
 * `menu` is the fifth and is the front end's alone — a cabinet has a service
 * button behind the coin door, and this is ours: it is what opens the settings
 * screen (`src/ui/menus.ts`) from attract mode. No simulation code looks at it.
 *
 * **The list is append-only.** {@link ACTION_BIT} assigns `1 << index`, and a
 * recorded replay log on disk is a list of those masks, so appending leaves every
 * existing bit — and therefore every golden replay — exactly where it was.
 * Inserting or reordering would silently reinterpret every log in
 * `tests/sim/golden/`.
 */
export const ACTIONS = ['left', 'right', 'fire', 'start', 'menu'] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * One step's worth of input, as a bitmask. A number rather than an object
 * because replay logs are long: a 60 Hz run is 3,600 of these per minute, and a
 * bitmask compares with `===` and serialises to a few characters.
 */
export type InputFrame = number;

/** No action held. */
export const EMPTY_FRAME: InputFrame = 0;

/** Bit assigned to each action. Stable: replay logs on disk depend on it. */
export const ACTION_BIT: Readonly<Record<Action, number>> = Object.freeze(
  Object.fromEntries(ACTIONS.map((action, index) => [action, 1 << index])) as Record<
    Action,
    number
  >,
);

/**
 * Default keyboard map, keyed by `KeyboardEvent.code` so it is layout-stable.
 *
 * This is the `both` control scheme; `bindingsFor` in `src/ui/settings.ts`
 * narrows it to arrows-only or WASD-only by filtering this table rather than
 * restating it.
 */
export const DEFAULT_BINDINGS: Readonly<Record<string, Action>> = Object.freeze({
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'fire',
  KeyZ: 'fire',
  Enter: 'start',
  NumpadEnter: 'start',
  Digit1: 'start',
  Escape: 'menu',
  KeyM: 'menu',
});

/** Build a frame from action names. */
export function frameOf(...actions: readonly Action[]): InputFrame {
  return actions.reduce<InputFrame>((frame, action) => frame | ACTION_BIT[action], EMPTY_FRAME);
}

/** Is `action` held in `frame`? */
export function isDown(frame: InputFrame, action: Action): boolean {
  return (frame & ACTION_BIT[action]) !== 0;
}

/** Did `action` go down between `previous` and `current`? */
export function wasPressed(previous: InputFrame, current: InputFrame, action: Action): boolean {
  return isDown(current, action) && !isDown(previous, action);
}

/** Did `action` come up between `previous` and `current`? */
export function wasReleased(previous: InputFrame, current: InputFrame, action: Action): boolean {
  return isDown(previous, action) && !isDown(current, action);
}

/** The actions held in a frame, in {@link ACTIONS} order. Mainly for debugging. */
export function actionsOf(frame: InputFrame): Action[] {
  return ACTIONS.filter((action) => isDown(frame, action));
}

/**
 * Anything the loop can sample once per step. `src/sim/` depends on this shape
 * and nothing more, so a keyboard and a replay are interchangeable.
 */
export interface InputSource {
  /** Read the frame for the step about to run. Called exactly once per step. */
  sample: () => InputFrame;
}

export interface KeyboardInput extends InputSource {
  /** Start listening. Returns the matching detach function. */
  attach: (target?: EventTarget) => () => void;
  /** Stop listening and forget everything held. */
  detach: () => void;
  /** Forget everything held — e.g. when the window loses focus. */
  reset: () => void;
}

export interface KeyboardInputOptions {
  /** `KeyboardEvent.code` to action. Defaults to {@link DEFAULT_BINDINGS}. */
  bindings?: Readonly<Record<string, Action>>;
  /** Call `preventDefault` on bound keys, so Space does not scroll. Default true. */
  preventDefault?: boolean;
}

/**
 * Keyboard-driven input source.
 *
 * Key events arrive whenever the host feels like it, which is not on step
 * boundaries. So a press is *latched*: an action that went down since the last
 * sample is reported held for one step even if it was already released. Without
 * that, a tap shorter than 16.7 ms would vanish — the difference between a shot
 * fired and a shot swallowed.
 */
export function createKeyboardInput(options: KeyboardInputOptions = {}): KeyboardInput {
  const { bindings = DEFAULT_BINDINGS, preventDefault = true } = options;

  let held: InputFrame = EMPTY_FRAME;
  let latched: InputFrame = EMPTY_FRAME;
  let detachCurrent: (() => void) | null = null;

  function onKeyDown(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.repeat) return;
    const action = bindings[key.code];
    if (action === undefined) return;
    if (preventDefault) key.preventDefault();
    held |= ACTION_BIT[action];
    latched |= ACTION_BIT[action];
  }

  function onKeyUp(event: Event): void {
    const key = event as KeyboardEvent;
    const action = bindings[key.code];
    if (action === undefined) return;
    if (preventDefault) key.preventDefault();
    held &= ~ACTION_BIT[action];
  }

  function reset(): void {
    held = EMPTY_FRAME;
    latched = EMPTY_FRAME;
  }

  return {
    sample(): InputFrame {
      const frame = held | latched;
      latched = EMPTY_FRAME;
      return frame;
    },

    attach(target?: EventTarget): () => void {
      detachCurrent?.();
      const node = target ?? window;
      node.addEventListener('keydown', onKeyDown);
      node.addEventListener('keyup', onKeyUp);
      node.addEventListener('blur', reset);
      const detach = (): void => {
        node.removeEventListener('keydown', onKeyDown);
        node.removeEventListener('keyup', onKeyUp);
        node.removeEventListener('blur', reset);
        reset();
        detachCurrent = null;
      };
      detachCurrent = detach;
      return detach;
    },

    detach(): void {
      detachCurrent?.();
    },

    reset,
  };
}

/** An input source that always reports the same frame. Useful in tests. */
export function constantInput(frame: InputFrame = EMPTY_FRAME): InputSource {
  return { sample: () => frame };
}
