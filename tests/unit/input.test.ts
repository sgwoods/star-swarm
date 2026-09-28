import { describe, expect, it } from 'vitest';

import {
  ACTION_BIT,
  ACTIONS,
  actionsOf,
  constantInput,
  createKeyboardInput,
  DEFAULT_BINDINGS,
  EMPTY_FRAME,
  frameOf,
  isDown,
  wasPressed,
  wasReleased,
} from '../../src/engine/input.js';

/**
 * A minimal EventTarget stand-in. These tests run on the Node project with no
 * DOM, which is itself the point: input is abstract, so it is testable headless.
 */
class FakeTarget implements EventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener !== 'function') return;
    const set = this.listeners.get(type) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener !== 'function') return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }

  key(type: 'keydown' | 'keyup', code: string, repeat = false): boolean {
    let prevented = false;
    return this.dispatchEvent({
      type,
      code,
      repeat,
      preventDefault: () => {
        prevented = true;
      },
      get defaultPrevented(): boolean {
        return prevented;
      },
    } as unknown as Event);
  }

  blur(): void {
    this.dispatchEvent({ type: 'blur' } as Event);
  }
}

describe('action set', () => {
  it('covers the four cabinet actions, then the front end\u2019s own', () => {
    // The first four are the cabinet's and are the whole of what `src/sim/` reads.
    // The rest are the front end's and no simulation code looks at any of them:
    // the service button that opens the settings screen, the pause, and the exit
    // that asks before a run is thrown away.
    expect([...ACTIONS]).toEqual(['left', 'right', 'fire', 'start', 'menu', 'pause', 'exit']);
  });

  it('assigns each action a distinct single bit', () => {
    const bits = ACTIONS.map((action) => ACTION_BIT[action]);
    expect(new Set(bits).size).toBe(bits.length);
    for (const bit of bits) {
      expect(bit & (bit - 1)).toBe(0);
    }
  });

  it('keeps the bit assignment stable, because replay logs depend on it', () => {
    // The four original bits are pinned to the values every recorded log in
    // `tests/sim/golden/` was written against. The list is **append-only** for
    // exactly this reason: a sixth action takes the next free bit and changes
    // nothing, where inserting or reordering would reinterpret every log on disk.
    expect(ACTION_BIT.left).toBe(1);
    expect(ACTION_BIT.right).toBe(2);
    expect(ACTION_BIT.fire).toBe(4);
    expect(ACTION_BIT.start).toBe(8);
    expect(ACTION_BIT.menu).toBe(16);
    expect(ACTION_BIT).toEqual({
      left: 1,
      right: 2,
      fire: 4,
      start: 8,
      menu: 16,
      pause: 32,
      exit: 64,
    });
  });

  it('reads a log written before pause and exit existed as holding neither', () => {
    // This is the whole of what append-only buys, stated as the thing that would
    // break: every mask in `tests/sim/golden/` was written when the set stopped
    // at `menu`, so every one of them has bits 32 and 64 clear. A log recorded
    // then must still mean what it meant, and must never read as a paused frame.
    for (const recorded of [0, 1, 2, 4, 8, 16, 5, 31]) {
      expect(isDown(recorded, 'pause')).toBe(false);
      expect(isDown(recorded, 'exit')).toBe(false);
      // And the actions it *does* name are unchanged.
      expect(actionsOf(recorded)).toEqual(
        (['left', 'right', 'fire', 'start', 'menu'] as const).filter(
          (action) => (recorded & ACTION_BIT[action]) !== 0,
        ),
      );
    }
  });
});

describe('frame helpers', () => {
  it('builds and reads frames', () => {
    const frame = frameOf('left', 'fire');
    expect(isDown(frame, 'left')).toBe(true);
    expect(isDown(frame, 'fire')).toBe(true);
    expect(isDown(frame, 'right')).toBe(false);
    expect(actionsOf(frame)).toEqual(['left', 'fire']);
  });

  it('reports an empty frame as nothing held', () => {
    expect(actionsOf(EMPTY_FRAME)).toEqual([]);
  });

  it('detects edges between two frames', () => {
    const before = frameOf('left');
    const after = frameOf('left', 'fire');
    expect(wasPressed(before, after, 'fire')).toBe(true);
    expect(wasPressed(before, after, 'left')).toBe(false);
    expect(wasReleased(after, before, 'fire')).toBe(true);
    expect(wasReleased(before, after, 'fire')).toBe(false);
  });
});

describe('keyboard input', () => {
  it('maps codes to actions, not raw keys', () => {
    const target = new FakeTarget();
    const input = createKeyboardInput();
    input.attach(target);

    target.key('keydown', 'ArrowLeft');
    expect(actionsOf(input.sample())).toEqual(['left']);

    target.key('keyup', 'ArrowLeft');
    target.key('keydown', 'KeyD');
    expect(actionsOf(input.sample())).toEqual(['right']);
  });

  it('ignores unbound keys', () => {
    const target = new FakeTarget();
    const input = createKeyboardInput();
    input.attach(target);
    target.key('keydown', 'KeyQ');
    expect(input.sample()).toBe(EMPTY_FRAME);
  });

  it('accepts custom bindings', () => {
    const target = new FakeTarget();
    const input = createKeyboardInput({ bindings: { KeyJ: 'fire' } });
    input.attach(target);
    target.key('keydown', 'ArrowLeft');
    expect(input.sample()).toBe(EMPTY_FRAME);
    target.key('keydown', 'KeyJ');
    expect(actionsOf(input.sample())).toEqual(['fire']);
  });

  it('reports a held key on every sample', () => {
    const target = new FakeTarget();
    const input = createKeyboardInput();
    input.attach(target);
    target.key('keydown', 'Space');
    expect(isDown(input.sample(), 'fire')).toBe(true);
    expect(isDown(input.sample(), 'fire')).toBe(true);
  });

  it('latches a tap shorter than one step so the shot is not swallowed', () => {
    const target = new FakeTarget();
    const input = createKeyboardInput();
    input.attach(target);

    // Press and release between two samples — the browser does not wait for
    // step boundaries.
    target.key('keydown', 'Space');
    target.key('keyup', 'Space');

    expect(isDown(input.sample(), 'fire')).toBe(true);
    // ...but only for the one step. A tap is not a hold.
    expect(isDown(input.sample(), 'fire')).toBe(false);
  });

  it('ignores auto-repeat, so held keys do not re-latch', () => {
    const target = new FakeTarget();
    const input = createKeyboardInput();
    input.attach(target);

    target.key('keydown', 'ArrowRight');
    input.sample();
    target.key('keydown', 'ArrowRight', true);
    target.key('keyup', 'ArrowRight');
    expect(isDown(input.sample(), 'right')).toBe(false);
  });

  it('calls preventDefault for bound keys only', () => {
    const target = new FakeTarget();
    const input = createKeyboardInput();
    input.attach(target);

    let boundPrevented = false;
    target.dispatchEvent({
      type: 'keydown',
      code: 'Space',
      repeat: false,
      preventDefault: () => {
        boundPrevented = true;
      },
    } as unknown as Event);
    expect(boundPrevented).toBe(true);

    let unboundPrevented = false;
    target.dispatchEvent({
      type: 'keydown',
      code: 'KeyQ',
      repeat: false,
      preventDefault: () => {
        unboundPrevented = true;
      },
    } as unknown as Event);
    expect(unboundPrevented).toBe(false);
  });

  it('can leave the host keys alone', () => {
    const target = new FakeTarget();
    const input = createKeyboardInput({ preventDefault: false });
    input.attach(target);
    let prevented = false;
    target.dispatchEvent({
      type: 'keydown',
      code: 'Space',
      repeat: false,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as Event);
    expect(prevented).toBe(false);
    expect(isDown(input.sample(), 'fire')).toBe(true);
  });

  it('drops everything held when focus is lost', () => {
    const target = new FakeTarget();
    const input = createKeyboardInput();
    input.attach(target);
    target.key('keydown', 'ArrowLeft');
    target.blur();
    expect(input.sample()).toBe(EMPTY_FRAME);
  });

  it('detaches its listeners, and re-attaching does not double up', () => {
    const target = new FakeTarget();
    const input = createKeyboardInput();
    const detach = input.attach(target);
    const attached = target.listenerCount;
    expect(attached).toBeGreaterThan(0);

    input.attach(target);
    expect(target.listenerCount).toBe(attached);

    detach();
    input.detach();
    expect(target.listenerCount).toBe(0);

    target.key('keydown', 'ArrowLeft');
    expect(input.sample()).toBe(EMPTY_FRAME);
  });

  it('binds both arrows and WASD', () => {
    expect(DEFAULT_BINDINGS.ArrowLeft).toBe('left');
    expect(DEFAULT_BINDINGS.KeyA).toBe('left');
    expect(DEFAULT_BINDINGS.Space).toBe('fire');
    expect(DEFAULT_BINDINGS.Enter).toBe('start');
  });

  it('binds only real KeyboardEvent.code values', () => {
    // A typo like `KeyReturn` is not a code any browser emits, so the binding
    // would silently never fire.
    const CODE =
      /^(?:Key[A-Z]|Digit[0-9]|Numpad[A-Za-z0-9]+|Arrow(?:Left|Right|Up|Down)|Space|Enter|Escape|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Tab|Backspace)$/;
    for (const code of Object.keys(DEFAULT_BINDINGS)) {
      expect(code).toMatch(CODE);
    }
  });
});

describe('constantInput', () => {
  it('always reports the same frame', () => {
    const source = constantInput(frameOf('right'));
    expect(actionsOf(source.sample())).toEqual(['right']);
    expect(actionsOf(source.sample())).toEqual(['right']);
  });

  it('defaults to nothing held', () => {
    expect(constantInput().sample()).toBe(EMPTY_FRAME);
  });
});
