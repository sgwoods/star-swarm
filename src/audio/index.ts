/**
 * `src/audio/` — the parametric synth and the simulation's sound effects.
 *
 * `docs/DESIGN.md` sections 3 and 5. Audio subscribes to simulation events; the
 * sim never calls in here, and nothing in here is read back by it.
 *
 * `music.ts` is not written yet — the jingles Milestone 1 needs are ordinary
 * sequenced sounds and go through `sfx.ts` like everything else.
 */

export * from './synth.js';
export * from './sfx.js';
