import { describe, expect, it } from 'vitest';

import type { Effect, Sprite } from '../../src/content/schema.js';
import { EMPTY_FRAME, frameOf } from '../../src/engine/input.js';
import { createEffects, DEFAULT_FRAME_DURATION, MAX_LIVE } from '../../src/render/effects.js';
import { createSpriteSheet } from '../../src/render/sprites.js';
import { createWorld, fingerprintWorld, stepWorld } from '../../src/sim/world.js';
import { classicPack, classicRules, classicStages } from '../helpers/rules.js';

/**
 * The renderer's one-shot animations: `src/render/effects.ts`.
 *
 * Three things are worth a test and nothing else is. The event has to reach the
 * animation (that is the whole mechanism), the animation has to *end* (an
 * explosion that outlives its own last frame is a bug nothing else would catch),
 * and a run with these running has to be the same run as one without — which is
 * the boundary `src/sim/` exists to keep, seen from the presentation side.
 *
 * Nothing here asserts what a death looks like. That is art, and a test that
 * pinned pixels would only make it harder to redraw.
 */

/** A two-frame sprite held four steps a frame: eight steps long. */
const probeSprite = (id: string, frames = 2, frameDuration = 4): Sprite => ({
  id,
  size: 2,
  palette: ['#0000', '#ffffff'],
  frameDuration,
  frames: Array.from({ length: frames }, () => ['11', '11']),
});

const effectOf = (sprite: string, offsetX = 0, offsetY = 0): Effect => ({
  sprite,
  offsetX,
  offsetY,
});

function probeEffects(options: { readonly frames?: number; readonly frameDuration?: number } = {}) {
  const sprite = probeSprite('boom', options.frames, options.frameDuration);
  return createEffects({
    bindings: { 'player-hit': effectOf('boom', -8, -8) },
    sprites: new Map([['boom', sprite]]),
  });
}

describe('an event starts an animation', () => {
  it('plays the effect the bindings name, at the event’s position plus the offset', () => {
    const effects = probeEffects();
    effects.handle([{ type: 'player-hit', x: 100, y: 240 }]);

    expect(effects.live).toHaveLength(1);
    expect(effects.live[0]).toMatchObject({ sprite: 'boom', x: 92, y: 232, age: 0, frame: 0 });
  });

  it('ignores an event nothing is bound to, and one with no position', () => {
    const effects = probeEffects();
    effects.handle([{ type: 'shot-fired', x: 10, y: 20 }, { type: 'player-hit' }]);
    expect(effects.live).toEqual([]);
  });

  it('advances a frame every `frameDuration` simulation steps', () => {
    const effects = probeEffects({ frames: 3, frameDuration: 4 });
    effects.handle([{ type: 'player-hit', x: 0, y: 0 }]);

    const seen: number[] = [];
    for (let step = 0; step < 12; step += 1) {
      seen.push(effects.live[0]?.frame ?? -1);
      effects.advance();
    }
    expect(seen).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
  });

  it('holds a sprite that states no frameDuration for the default', () => {
    const sprite = { ...probeSprite('boom'), frameDuration: undefined };
    const effects = createEffects({
      bindings: { 'player-hit': effectOf('boom') },
      sprites: new Map([['boom', sprite]]),
    });
    expect(effects.durationOf('player-hit')).toBe(2 * DEFAULT_FRAME_DURATION);
  });

  it('stays quiet for a binding naming a sprite the registry has not got', () => {
    const effects = createEffects({
      bindings: { 'player-hit': effectOf('missing') },
      sprites: new Map(),
    });
    effects.handle([{ type: 'player-hit', x: 0, y: 0 }]);
    expect(effects.live).toEqual([]);
    expect(effects.durationOf('player-hit')).toBeUndefined();
  });
});

describe('an animation is bounded', () => {
  it('ends on the step after its last frame runs out, and never loops', () => {
    const effects = probeEffects({ frames: 2, frameDuration: 4 });
    effects.handle([{ type: 'player-hit', x: 0, y: 0 }]);
    expect(effects.durationOf('player-hit')).toBe(8);

    // Seven advances is still inside it; the eighth takes it past the end.
    for (let step = 0; step < 7; step += 1) effects.advance();
    expect(effects.live).toHaveLength(1);
    expect(effects.live[0]?.frame).toBe(1);

    effects.advance();
    expect(effects.live).toEqual([]);
  });

  it('is still empty a long time later — nothing restarts it', () => {
    const effects = probeEffects();
    effects.handle([{ type: 'player-hit', x: 0, y: 0 }]);
    for (let step = 0; step < 10_000; step += 1) effects.advance();
    expect(effects.live).toEqual([]);
  });

  it('never holds more than MAX_LIVE at once', () => {
    const effects = probeEffects({ frames: 4, frameDuration: 60 });
    for (let index = 0; index < MAX_LIVE * 3; index += 1) {
      effects.handle([{ type: 'player-hit', x: index, y: 0 }]);
    }
    expect(effects.live).toHaveLength(MAX_LIVE);
    // The oldest went first, so the last one raised is still there.
    expect(effects.live.at(-1)?.x).toBe(MAX_LIVE * 3 - 1 - 8);
  });

  it('clears on demand, which is what a variant change does', () => {
    const effects = probeEffects();
    effects.handle([{ type: 'player-hit', x: 0, y: 0 }]);
    effects.clear();
    expect(effects.live).toEqual([]);
  });
});

describe('the Classic pack’s death effect', () => {
  const pack = classicPack();

  it('binds losing a fighter to a sprite the pack ships, and rasterises it', () => {
    const bound = pack.manifest.effects['player-hit'];
    expect(bound?.sprite).toBe('explosion-player');

    const sheet = createSpriteSheet({
      sprites: pack.sprites.values(),
      palette: pack.manifest.palette,
    });
    const id = bound?.sprite ?? '';
    expect(sheet.has(id)).toBe(true);
    // Four frames, as `docs/DESIGN.md` section 5 asks, each one actually drawn.
    expect(sheet.frameCount(id)).toBe(4);
    for (let frame = 0; frame < sheet.frameCount(id); frame += 1) {
      const bitmap = sheet.bitmap(id, frame);
      const lit = bitmap.data.filter((byte, index) => index % 4 === 3 && byte > 0).length;
      expect(lit, `frame ${String(frame)} is blank`).toBeGreaterThan(0);
    }
  });

  it('centres the explosion on the fighter it replaces', () => {
    const bound = pack.manifest.effects['player-hit'];
    const fighter = pack.sprites.get('player');
    const boom = pack.sprites.get(bound?.sprite ?? '');
    if (bound === undefined || fighter === undefined || boom === undefined) {
      throw new Error('the Classic pack no longer ships a fighter and a death effect');
    }
    // The event reports the fighter's own anchor, so the offset has to pull a
    // wider explosion back by half the difference for the two to share a centre.
    expect(bound.offsetX).toBe(-(boom.size - fighter.size) / 2);
    expect(bound.offsetY).toBe(-(boom.size - fighter.size) / 2);
  });

  it('is visibly bigger and slower than an alien’s, which is what makes it read', () => {
    const boom = pack.sprites.get('explosion-player');
    const alien = pack.sprites.get('explosion-alien');
    if (boom === undefined || alien === undefined) throw new Error('missing an explosion');

    expect(boom.size).toBeGreaterThan(alien.size);
    expect(boom.frameDuration ?? 0).toBeGreaterThan(alien.frameDuration ?? 0);
  });

  /**
   * The presentation has to fit the gameplay it is presenting, and this is the
   * check that says so rather than an eye. `respawnFrames` is a rules value and
   * a verified-or-provisional arcade number; an animation that outran it would be
   * a reason to redraw the animation, never to move the number.
   */
  it('finishes well before the fighter comes back, without touching respawnFrames', () => {
    const effects = createEffects({
      bindings: pack.manifest.effects,
      sprites: pack.sprites,
    });
    const duration = effects.durationOf('player-hit');
    const respawn = classicRules().player.respawnFrames;

    expect(duration).toBeDefined();
    expect(duration ?? 0).toBeLessThan(respawn);
    // And with room to spare: the empty sky after the bang is what says it cost
    // you, so the explosion must not run right up to the fighter's return.
    expect(duration ?? 0).toBeLessThanOrEqual(respawn * 0.75);
  });
});

/**
 * The one property the whole file exists for: this is presentation, so a run
 * with it is the same run as a run without it.
 *
 * Fingerprinted rather than reasoned about, because "the renderer does not write
 * to the world" is exactly the kind of claim a future refactor breaks quietly.
 */
describe('a headless run is unchanged by the animation', () => {
  const run = (subscribe: boolean): string => {
    const world = createWorld({
      rules: classicRules(),
      stages: classicStages(),
      seed: 'effects-determinism',
    });
    const effects = createEffects({
      bindings: classicPack().manifest.effects,
      sprites: classicPack().sprites,
    });
    const fire = frameOf('fire', 'left');

    for (let step = 0; step < 1800; step += 1) {
      const events = stepWorld(world, step % 4 === 0 ? fire : EMPTY_FRAME);
      if (subscribe) {
        effects.advance();
        effects.handle(events);
      }
    }
    return fingerprintWorld(world);
  };

  it('fingerprints identically with the effects layer attached and detached', () => {
    expect(run(true)).toBe(run(false));
  });
});
