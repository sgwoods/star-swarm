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
| `registry.ts` | Layers loaded packs into one lookup; a later pack wins                                                      |
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

`npm run validate-packs` runs the same two passes the game does — it calls
`loadPack` rather than reimplementing it. Section 8's playability checks are
Milestone 3 and are not here.
