/**
 * One-shot sprite animations played where something happened — the death of a
 * fighter above all (`docs/DESIGN.md` section 5, "4-frame explosions ... defined
 * as data").
 *
 * Presentation, and a **subscriber**, on exactly the terms `src/audio/sfx.ts`
 * already is: the simulation raises an event, this looks the event's name up in
 * the pack manifest's `effects` map and starts the animation the pack named
 * there. The traffic is one way — `handle` returns nothing, reads nothing back
 * and mutates no event — so a run with explosions and a run without are the same
 * run (`docs/DESIGN.md` pillar 4). Nothing in here decides what a death looks
 * like; `packs/classic/pack.json` does.
 *
 * **Timing is pack data, and it is counted in simulation steps.** An effect's
 * length is its sprite's `frames` × `frameDuration`, the same two numbers that
 * already drive a wing flap, and {@link Effects.advance} is called once per
 * simulation step. Two consequences worth having: a paused game freezes a
 * mid-flight explosion with the rest of the screen, because a phase that does
 * not step the world does not advance these either; and the animation runs at
 * the simulation's rate rather than the display's, so it is the same length on
 * any monitor.
 *
 * **Every animation is bounded by construction.** It plays once, holds nothing,
 * and is dropped the step its last frame runs out — there is no looping path
 * through this file, which is what stops a missed clear leaving an explosion on
 * screen for the rest of the game. {@link MAX_LIVE} bounds the *number* of them
 * for the same reason.
 *
 * **It knows no event names.** Unlike `./starfield.ts`, which reads specific
 * events because the arcade's backdrop really does respond to specific moments,
 * every name here arrives from the pack — so this file has nothing to clear on a
 * stage boundary and no list to keep in step with the simulation's vocabulary.
 * Self-expiry is what takes its place: the longest effect a pack can ship is over
 * in well under a second.
 */

import type { Effect, Sprite } from '../content/schema.js';
import { drawSprite, type SpriteSheet } from './sprites.js';

/** As much of a simulation event as this layer looks at. */
export interface EffectEvent {
  readonly type: string;
  /** The sprite anchor of whatever the event happened to. Both or neither. */
  readonly x?: number;
  readonly y?: number;
}

/** Event type → effect. From the pack manifest; see `packManifestSchema`. */
export type EffectBindings = Readonly<Record<string, Effect>>;

/**
 * Simulation steps an animation frame is held when its sprite leaves the choice
 * to the caller.
 *
 * A sprite that means to be an explosion states its own `frameDuration`, so this
 * is only reached by a pack that bound an effect to a sprite drawn for something
 * else. Ten steps — a sixth of a second a frame — is slow enough to be visibly an
 * animation rather than a flicker.
 */
export const DEFAULT_FRAME_DURATION = 10;

/**
 * Most animations on screen at once.
 *
 * The game cannot reach it — one fighter dies at a time — so this is a bound
 * rather than a budget: a pack that binds an effect to an event raised in bulk
 * (every alien of a cleared group, say) gets a busy frame, not an unbounded list.
 * The oldest goes first, because the newest is the one the player is looking at.
 */
export const MAX_LIVE = 8;

/** An animation in flight. */
export interface LiveEffect {
  readonly sprite: string;
  /** Top-left corner to draw at: the event's position plus the effect's offset. */
  readonly x: number;
  readonly y: number;
  /** Simulation steps since it started. `0` on the step it was raised. */
  readonly age: number;
  /** The animation frame {@link age} selects, clamped to the last one. */
  readonly frame: number;
}

interface Playing {
  readonly sprite: string;
  readonly x: number;
  readonly y: number;
  readonly frames: number;
  readonly frameDuration: number;
  age: number;
}

export interface EffectsOptions {
  readonly bindings: EffectBindings;
  /**
   * Sprite id → definition, for the frame count and hold the animation's length
   * comes from. A `ContentRegistry`'s `sprites` map.
   *
   * The *data*, not the rasterised sheet: an effect's duration is a fact about
   * the pack and is settled when it starts, so the length of a death is the same
   * whether or not there is a sheet to draw it with — which is what lets a
   * headless test assert the bound.
   */
  readonly sprites: ReadonlyMap<string, Sprite>;
}

export interface Effects {
  /** The animations in flight, oldest first. Read-only. */
  readonly live: readonly LiveEffect[];
  /**
   * Start the animations a step's events call for. Safe to call with an empty
   * list, with events nothing is bound to, and with events that carry no
   * position — an effect has to be drawn somewhere, so an event without one
   * plays nothing rather than appearing in the corner.
   */
  handle(events: readonly EffectEvent[]): void;
  /** Advance every animation by one simulation step, dropping those that finish. */
  advance(): void;
  /** Draw the animations in flight. Draws nothing without a sheet. */
  draw(ctx: CanvasRenderingContext2D, sheet?: SpriteSheet): void;
  /** Drop everything in flight. For a variant change, which rebuilds the art. */
  clear(): void;
  /** How long the effect bound to an event would run, in simulation steps. */
  durationOf(type: string): number | undefined;
}

/** Subscribe the renderer's one-shot animations to simulation events. */
export function createEffects(options: EffectsOptions): Effects {
  const { bindings, sprites } = options;
  const playing: Playing[] = [];

  /** The frames and hold of a bound effect, or `undefined` if nothing is bound. */
  const shapeOf = (
    type: string,
  ):
    | { readonly effect: Effect; readonly frames: number; readonly frameDuration: number }
    | undefined => {
    const effect = bindings[type];
    if (effect === undefined) return undefined;
    const sprite = sprites.get(effect.sprite);
    // A binding naming no sprite. The loader rejects that, so this is only
    // reachable for a registry assembled by hand — stay quiet.
    if (sprite === undefined) return undefined;
    return {
      effect,
      frames: sprite.frames.length,
      frameDuration: sprite.frameDuration ?? DEFAULT_FRAME_DURATION,
    };
  };

  const frameOf = (item: Playing): number =>
    Math.min(Math.floor(item.age / item.frameDuration), item.frames - 1);

  return {
    get live(): readonly LiveEffect[] {
      return playing.map((item) => ({
        sprite: item.sprite,
        x: item.x,
        y: item.y,
        age: item.age,
        frame: frameOf(item),
      }));
    },

    durationOf(type: string): number | undefined {
      const shape = shapeOf(type);
      return shape === undefined ? undefined : shape.frames * shape.frameDuration;
    },

    handle(events: readonly EffectEvent[]): void {
      for (const event of events) {
        const { x, y } = event;
        if (x === undefined || y === undefined) continue;
        const shape = shapeOf(event.type);
        if (shape === undefined) continue;
        playing.push({
          sprite: shape.effect.sprite,
          x: x + shape.effect.offsetX,
          y: y + shape.effect.offsetY,
          frames: shape.frames,
          frameDuration: shape.frameDuration,
          age: 0,
        });
        // Oldest first: the newest animation is the one the player is watching.
        while (playing.length > MAX_LIVE) playing.shift();
      }
    },

    advance(): void {
      for (const item of playing) item.age += 1;
      // Splice in place rather than reassigning, so `live` and the list agree.
      for (let index = playing.length - 1; index >= 0; index -= 1) {
        const item = playing[index];
        if (item !== undefined && item.age >= item.frames * item.frameDuration) {
          playing.splice(index, 1);
        }
      }
    },

    draw(ctx: CanvasRenderingContext2D, sheet?: SpriteSheet): void {
      if (sheet === undefined) return;
      for (const item of playing) {
        if (!sheet.has(item.sprite)) continue;
        drawSprite(ctx, sheet, item.sprite, item.x, item.y, frameOf(item));
      }
    },

    clear(): void {
      playing.length = 0;
    },
  };
}
