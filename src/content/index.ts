/**
 * `src/content/` — the content platform: schemas, loading and the registry.
 *
 * `docs/DESIGN.md` section 7 defines what a pack holds and section 6 the rules
 * layer over it, and `./variants.js` the game a pack list adds up to. Node-only
 * filesystem reading lives in `./fs.js` and is not re-exported here, so importing
 * this module never pulls `node:fs` into the browser bundle; `./bundle.js` is left
 * out for the mirror-image reason.
 */

export * from './schema.js';
export * from './errors.js';
export * from './loader.js';
export * from './registry.js';
export * from './rules.js';
export * from './stages.js';
export * from './variants.js';
