# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## The authoritative plan

`docs/DESIGN.md` is the design and build plan, and it is the source of truth for
scope, architecture and milestones. It started as a verbatim copy of the
captain's plan; it is now a living document and is edited when a verified
finding changes the spec. Prettier still ignores it (`.prettierignore`) so its
hand-authored tables and line breaks survive, which means edits keep the diff
small and stay in the surrounding style. Do not reformat it wholesale.

`docs/reference/arcade-reference.md` is the verification record behind section 4:
the source, ROM routine and confidence note for every arcade value the plan
states, plus the items still unresolved. The two are a pair — change a number in
section 4 and the reference changes with it, or they drift apart silently. It
names the original game and its enemy types so sources stay checkable; that
licence does not extend to `docs/DESIGN.md`, which uses the project's own naming
per section 2 of the plan.

## The one rule that shapes the codebase

`src/sim/` never touches the DOM, Canvas or Web Audio, and never imports from
`src/render/`, `src/audio/` or `src/ui/`. The sim emits events; render and audio
subscribe. That is what makes headless tests and replays possible.

This is enforced, not trusted: `eslint.config.js` restricts imports, host globals
and `Math.random` inside `src/sim/`, and `tests/unit/sim-boundary.test.ts` both
scans the tree and runs ESLint against a deliberately illegal probe file so the
rules cannot be quietly deleted. Both run in CI.

## Determinism is a hard requirement

Fixed 60 Hz steps, seeded RNG, replayable input logs (`docs/DESIGN.md` pillar 4).
Practical consequences:

- Never use `Math.random()` in `src/sim/` or `src/engine/` — use
  `createRng(seed)` from `src/engine/rng.ts`.
- Never read the wall clock in `src/sim/`. Time arrives as a fixed step.
- The RNG stream is part of the on-disk contract. Golden replays compare final
  simulation states, so changing the generator invalidates every recorded replay;
  `tests/unit/rng.test.ts` locks a reference sequence to make that deliberate.
- `1/60` is not representable in binary floating point. `src/engine/loop.ts`
  accumulates in _steps_ and carries a tolerance for exactly this reason; naive
  millisecond subtraction silently loses a step per burst.

## The second rule: content is a platform, not this game

`src/content/` holds no knowledge of Star Swarm. The content model is shared
across an arcade lineage expected to host more than one game (`docs/DESIGN.md`
section 6), so enemy roles are ids a pack declares, per-role numbers are records
keyed by those ids, and formations, scoring and every difficulty or sequence
table are data. A Classic-specific name or assumption belongs in
`packs/classic/`, never in a type under `src/content/`.

Two consequences worth knowing before editing either:

- Every ramp is literal rows plus its own plateau period, never a curve, and the
  periods differ between tables on purpose. `src/content/rules.ts` is the only
  place that interprets one.
- `src/content/fs.ts` is the only file there that imports `node:fs`, and
  `index.ts` does not re-export it, so the platform stays browser-safe.

## Layout

`docs/DESIGN.md` section 9 fixes the source layout, and each directory carries a
short README saying what lands there and when. Milestone 1 tasks fill them in.

## Sharp edges

- Vitest runs two projects, `unit` and `sim`, both on the **Node** environment.
  There is no DOM in either — that is deliberate, and it is what stops sim code
  from quietly acquiring a browser dependency.
- `npm run validate-packs` must pass in CI and succeeds on an empty `packs/`
  tree and on a pack whose content directories are empty. It calls the real
  `loadPack`, so the gate and the game cannot disagree; its tests in
  `tests/unit/validate-packs.test.ts` run the script against throwaway pack
  trees. Section 8's playability checks are Milestone 3 and are not in it yet.
- `tests/unit/classic-pack.test.ts` checks `packs/classic/` against
  `docs/reference/arcade-reference.md`. Plan, reference and data are three legs
  of one stool: change a number in any of them and that test is the third voice.
- `tests/unit/sim-boundary.test.ts` briefly writes `src/sim/__boundary_probe__.ts`
  and removes it again. The path is gitignored in case a run dies mid-test.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
