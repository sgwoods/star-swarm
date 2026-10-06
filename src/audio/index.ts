/**
 * `src/audio/` — the parametric synth, the simulation's sound effects and its
 * music.
 *
 * `docs/DESIGN.md` sections 3 and 5. Audio subscribes to simulation events; the
 * sim never calls in here, and nothing in here is read back by it.
 */

export * from './synth.js';
export * from './sfx.js';
export * from './music.js';
