/**
 * `src/content/` — the content platform: schemas, loading and the registry.
 *
 * `docs/DESIGN.md` section 7 defines what a pack holds and section 6 the rules
 * layer over it. Node-only filesystem reading lives in `./fs.js` and is not
 * re-exported here, so importing this module never pulls `node:fs` into the
 * browser bundle.
 */

export * from './schema.js';
export * from './errors.js';
export * from './loader.js';
export * from './registry.js';
export * from './rules.js';
