/**
 * Sound effects — the join between the simulation and the synth
 * (`docs/DESIGN.md` section 9).
 *
 * The sim has no audio and cannot call one: it emits events, and this subscribes
 * to them exactly as rendering does. The traffic is one way. `handle` returns
 * nothing, reads nothing back, and never mutates an event, so a run with sound
 * and a run without sound are the same run (pillar 4).
 *
 * **Which sound an event plays is data.** The map from event type to sound id
 * lives in the pack manifest's `sounds`, so a pack decides what the game sounds
 * like and the loader checks every id it names. Nothing here knows what `fire`
 * or `player-hit` is, which is what lets a sibling game in the same lineage
 * (section 6) reuse the file unchanged.
 *
 * The event type is deliberately structural — `{ type: string }` — rather than
 * `SimEvent`. Audio needs the name and nothing else, and not importing the sim's
 * union keeps the two halves independently buildable.
 */

import type { Sound } from '../content/schema.js';

/** As much of a simulation event as the audio layer looks at. */
export interface SfxEvent {
  readonly type: string;
}

/** Event type → sound id. From the pack manifest; see `packManifestSchema`. */
export type SfxBindings = Readonly<Record<string, string>>;

/** What `Sfx` needs of a synth. `createSynth` supplies it. */
export interface SoundPlayer {
  play(sound: Sound): void;
}

export interface SfxOptions {
  readonly player: SoundPlayer;
  /** Sound id → definition. A `ContentRegistry`'s `sounds` map. */
  readonly sounds: ReadonlyMap<string, Sound>;
  readonly bindings: SfxBindings;
  /**
   * Last word on which sound an event plays, consulted before `bindings`.
   *
   * The hook is here for the per-alien `sounds` of section 7.1: once events
   * carry the alien that raised them, a resolver can pick that alien's own death
   * or dive sound and fall through to the pack-wide binding otherwise.
   */
  readonly resolve?: (event: SfxEvent) => string | undefined;
  readonly onError?: (error: unknown, event: SfxEvent) => void;
}

export interface Sfx {
  /**
   * Play the sounds a step's events call for. Safe to call with an empty list,
   * with events nothing is bound to, and with a synth that is locked, muted or
   * broken.
   */
  handle(events: readonly SfxEvent[]): void;
  /** The sound an event would play, or `undefined`. Diagnostics and tests. */
  soundFor(event: SfxEvent): Sound | undefined;
  /** The sound id an event resolves to, bound or not. */
  soundIdFor(event: SfxEvent): string | undefined;
}

/**
 * Subscribe audio to simulation events.
 *
 * A step can raise the same event many times over — eight enemies destroyed by
 * one shot through a group, two shots fired on the same frame — and stacking
 * identical voices is both loud and wrong. So each distinct sound plays **once
 * per batch**, which is also how a hardware sound channel behaves.
 */
export function createSfx(options: SfxOptions): Sfx {
  const { player, sounds, bindings, resolve, onError } = options;

  const soundIdFor = (event: SfxEvent): string | undefined =>
    resolve?.(event) ?? bindings[event.type];

  const soundFor = (event: SfxEvent): Sound | undefined => {
    const id = soundIdFor(event);
    return id === undefined ? undefined : sounds.get(id);
  };

  return {
    soundIdFor,
    soundFor,

    handle(events: readonly SfxEvent[]): void {
      if (events.length === 0) return;
      const played = new Set<string>();

      for (const event of events) {
        let id: string | undefined;
        try {
          id = soundIdFor(event);
        } catch (error) {
          // A resolver is caller code; a throw from it must not reach the loop.
          onError?.(error, event);
          continue;
        }
        if (id === undefined || played.has(id)) continue;

        const sound = sounds.get(id);
        // A binding the pack never defined. The loader rejects that, so this is
        // only reachable for a registry assembled by hand — stay quiet.
        if (sound === undefined) continue;

        played.add(id);
        try {
          player.play(sound);
        } catch (error) {
          onError?.(error, event);
        }
      }
    },
  };
}

/** Bound sound ids that no loaded pack defines. Empty for a validated registry. */
export function unresolvedBindings(
  bindings: SfxBindings,
  sounds: ReadonlyMap<string, Sound>,
): string[] {
  return Object.values(bindings).filter((id) => !sounds.has(id));
}
