# `src/content/`

The content platform: what a pack may contain, how one is loaded, and how the
rules layer over it is read. `docs/DESIGN.md` section 7 defines the content
model and section 6 the rules layer.

| File          | What it is                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `schema.ts`   | Zod schemas and inferred types for every content kind, the manifest and the rules                           |
| `loader.ts`   | Pure: documents in, a validated pack or a list of errors out                                                |
| `fs.ts`       | **Node only.** Reads a pack directory into the shape `loader.ts` takes                                      |
| `bundle.ts`   | **Vite only.** The same walk over the same tree, through `import.meta.glob`                                 |
| `registry.ts` | Layers loaded packs into one lookup; a later pack wins, manifest and rules included                         |
| `variants.ts` | A **variant**: one game, as a `variants/<id>.json` document — its packs and its difficulty presets          |
| `rules.ts`    | Reads the rules layer: rank tables, stage sequences, cadence, plateaus, and everything the simulation steps |
| `stages.ts`   | A stage _number_ to the resolved `StageContent` the simulation is handed                                    |
| `errors.ts`   | `ContentError`, and the per-file report both the loader and the validator print                             |

Three things worth knowing before changing anything here.

**Nothing in this directory knows about Star Swarm.** The content model is a
shared platform expected to host more than one game in this arcade lineage
(`docs/DESIGN.md` section 6). Enemy roles are ids a pack declares; per-role
numbers are records keyed by those ids; formations, scoring and every ramp are
data. If a change would put a Classic-specific name or assumption into a type
here, it belongs in `packs/classic/` instead.

**The simulation reads this layer and holds no copy of it.** `src/sim/` imports
`schema.ts` for the types and `rules.ts` for the interpreters, is handed one
resolved `Rules` value, and never loads a pack itself. So a number that belongs
to a game belongs in `packs/<name>/rules.json`, not in a default here: a default
is a rule the simulation obeys without any pack having stated it. The one place
a shape carries confidence rather than a value is `provenance`, which marks a
field path `verified` or `provisional` — the loader rejects a key that names
nothing, so a rename cannot leave a marking behind.

**A pack is read two ways, and neither reader is re-exported.** `fs.ts` is the
only file that imports `node:fs`, for the validator and the tests; `bundle.ts`
walks the same tree with Vite's `import.meta.glob` for the browser, globbing the
whole directory rather than a list of remembered files. `index.ts` re-exports
neither — one would drag the filesystem into the browser bundle, the other a
Vite-only transform into plain Node — so `src/main.ts` imports `bundle.ts`
directly, and `tests/unit/bundled-packs.test.ts` holds the two sides to each
other.

**A variant is a game; a pack is content for one.** `variants.ts` is the layer
above the registry: `packs/` says what content exists, a variant says which _game_
a player can start. It validates in the same two passes with the same
`ContentError` shape — schema, then references against the packs that loaded — and
it **selects rather than overrides**: rules are a whole document from a pack,
because a variant that could patch single numbers would be the difficulty
multiplier section 6 rules out. `docs/ARCHITECTURE.md` §4.5 has the whole of it,
including the one limit on an overlay pack: `loadPack` resolves references within a
pack, so an overlay may replace a self-contained document and may not add one that
names the base pack's content.

`npm run validate-packs` runs the same passes the game does — it calls `loadPack`
and `loadVariants` rather than reimplementing either — and then flies what they
resolved: section 8's playability checks are `scripts/playability.ts`, outside this
directory because they run the simulation.
