# `src/content/`

The content platform: what a pack may contain, how one is loaded, and how the
rules layer over it is read. `docs/DESIGN.md` section 7 defines the content
model and section 6 the rules layer.

| File          | What it is                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `schema.ts`   | Zod schemas and inferred types for every content kind, the manifest and the rules                           |
| `loader.ts`   | Pure: documents in, a validated pack or a list of errors out                                                |
| `fs.ts`       | **Node only.** Reads a pack directory into the shape `loader.ts` takes                                      |
| `registry.ts` | Layers loaded packs into one lookup; a later pack wins                                                      |
| `rules.ts`    | Reads the rules layer: rank tables, stage sequences, cadence, plateaus, and everything the simulation steps |
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

**`fs.ts` is the only file that imports `node:fs`**, and `index.ts` does not
re-export it, so importing the platform never drags the filesystem into the
browser bundle. The browser builds a `PackSource` with `packSourceFromRecord`
over bundled JSON imports — see `src/main.ts`.

`npm run validate-packs` runs the same two passes the game does — it calls
`loadPack` rather than reimplementing it. Section 8's playability checks are
Milestone 3 and are not here.
