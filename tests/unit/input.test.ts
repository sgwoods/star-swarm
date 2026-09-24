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
  it('covers the Milestone 0 actions', () => {
    expect([...ACTIONS]).toEqual(['left', 'right', 'fire', 'start']);
  });

  it('assigns each action a distinct single bit', () => {
    const bits = ACTIONS.map((action) => ACTION_BIT[action]);
    expect(new Set(bits).size).toBe(bits.length);
    for (const bit of bits) {
      expect(bit & (bit - 1)).toBe(0);
    }
  });

  it('keeps the bit assignment stable, because replay logs depend on it', () => {
    expect(ACTION_BIT).toEqual({ left: 1, right: 2, fire: 4, start: 8 });
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
