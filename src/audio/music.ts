/**
 * Music — the jingles of `docs/DESIGN.md` section 5, on a channel of their own.
 *
 * A jingle is an ordinary `Sound` (`soundSchema`): a `sequence` for the melody
 * and `parts` for the lines under it. What makes it music is not its shape but
 * the **channel** it plays on, and that is the whole of this file:
 *
 * - **One jingle at a time.** Starting one cuts the one before it, with a short
 *   fade (`Playback.stop`). Effects stack; two jingles at once is two tunes in
 *   two keys, which is noise.
 * - **One jingle per step.** A step can raise several events a cue answers — a
 *   game's first step raises `stage-started` for stage 1 — so the cues are an
 *   ordered list and the earliest cue that matches anything in the step wins.
 * - **Which event starts which jingle is data**: the manifest's `music`
 *   (`musicCueSchema`). Nothing here names an event or a tune.
 *
 * It is a subscriber exactly as `sfx.ts` is: `handle` reads a step's events and
 * returns nothing, never mutates one and never reaches the simulation, so a run
 * with music is the same run as one without (pillar 4). Music is in wall time
 * because the synth is — a jingle's length is seconds on the audio clock, and
 * nothing about it is counted in simulation steps.
 */

import type { MusicCue, Sound } from '../content/schema.js';
import type { SfxEvent } from './sfx.js';
import type { Playback } from './synth.js';

/** What `Music` needs of a synth. `createSynth` supplies it. */
export interface MusicPlayer {
  start(sound: Sound): Playback | undefined;
}

export interface MusicOptions {
  readonly player: MusicPlayer;
  /** Sound id → definition. A `ContentRegistry`'s `sounds` map. */
  readonly sounds: ReadonlyMap<string, Sound>;
  /** The manifest's `music`, in its own order. */
  readonly cues: readonly MusicCue[];
  readonly onError?: (error: unknown) => void;
}

export interface Music {
  /**
   * Start the jingle a step's events call for, cutting any still playing. A step
   * no cue answers leaves the current jingle alone.
   */
  handle(events: readonly SfxEvent[]): void;
  /** Cut whatever is playing. Safe with nothing playing. */
  stop(): void;
  /** The cue a step's events would start, or `undefined`. Diagnostics and tests. */
  cueFor(events: readonly SfxEvent[]): MusicCue | undefined;
}

/** Does this event answer this cue — the right type, and every `when` field equal? */
export function cueMatches(cue: MusicCue, event: SfxEvent): boolean {
  if (event.type !== cue.event) return false;
  if (cue.when === undefined) return true;
  // Events are read structurally: audio takes the field names from the pack and
  // the values from the event, and never imports the sim's event union.
  const fields = event as unknown as Readonly<Record<string, unknown>>;
  return Object.entries(cue.when).every(([key, value]) => fields[key] === value);
}

/** Subscribe the music channel to simulation events. */
export function createMusic(options: MusicOptions): Music {
  const { player, sounds, cues, onError } = options;
  let current: Playback | undefined;

  const cueFor = (events: readonly SfxEvent[]): MusicCue | undefined =>
    events.length === 0 ? undefined : cues.find((cue) => events.some((e) => cueMatches(cue, e)));

  const stop = (): void => {
    const playing = current;
    current = undefined;
    try {
      playing?.stop();
    } catch (error) {
      onError?.(error);
    }
  };

  return {
    cueFor,
    stop,

    handle(events: readonly SfxEvent[]): void {
      const cue = cueFor(events);
      if (cue === undefined) return;
      // A cue naming a sound no pack defines. The loader rejects that, so this
      // is only reachable for a registry assembled by hand — stay quiet.
      const sound = sounds.get(cue.sound);
      if (sound === undefined) return;

      stop();
      try {
        current = player.start(sound);
      } catch (error) {
        onError?.(error);
      }
    },
  };
}

/** Cue sound ids that no loaded pack defines. Empty for a validated registry. */
export function unresolvedCues(
  cues: readonly MusicCue[],
  sounds: ReadonlyMap<string, Sound>,
): string[] {
  return cues.map((cue) => cue.sound).filter((id) => !sounds.has(id));
}
