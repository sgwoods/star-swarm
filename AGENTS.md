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
per section 2 of the plan. Unlike the plan it _is_ Prettier-formatted, and
its claim tables are wide: changing one cell re-pads that whole table, so expect
a diff larger than the edit and run `npm run format` before `npm run lint`.

`docs/ARCHITECTURE.md` is the reader-facing counterpart, and the one document
here that describes the code **as built** rather than as planned: what the thing
is, how to run it, the layers and their one-way arrows, and where a new pack or a
sibling game plugs in. Its diagrams are Mermaid so GitHub renders them with no
build step. It is where the plan and the tree are reconciled in public, so when a
layer moves, a milestone lands or a divergence from the plan is closed, say so
there — and never document an intention there as if it were the implementation.

## The one rule that shapes the codebase

`src/sim/` never touches the DOM, Canvas or Web Audio, and never imports from
`src/render/`, `src/audio/` or `src/ui/`. The sim emits events; render and audio
subscribe. That is what makes headless tests and replays possible.

This is enforced, not trusted: `eslint.config.js` restricts imports, host globals
and `Math.random` inside `src/sim/`, and `tests/unit/sim-boundary.test.ts` both
scans the tree and runs ESLint against a deliberately illegal probe file so the
rules cannot be quietly deleted. Both run in CI.

That scan is textual, so inside `src/sim/` an identifier spelled exactly
`window` fails even as a local variable or parameter. Name it `hitWindow`.

## Arcade numbers say how far to trust themselves

Anywhere an arcade value is written down, it is marked **verified** or
**provisional**. Verified means `docs/reference/arcade-reference.md` carries the
ROM routine behind it, and changing it means changing the reference too.
Provisional means it is ours — the reference does not cover it, or lists it
unresolved. Keep new values labelled; the distinction is the difference between
a number that may not be changed and one that may.

Those values live in `packs/classic/rules.json`, so the marking is data: the
`provenance` block maps a field path to its confidence and a note, and the loader
rejects a key naming no field so a rename cannot leave a marking behind. It is
granular where the confidence is — a shot window's Δx bounds are verified and its
Δy bounds are not. In code, the marking is still a comment.

## The simulation has no rules of its own

`src/sim/` is handed one resolved `Rules` value and holds no constants: the
movement cadence, travel limits, shot cap, hit windows, extra-life thresholds,
backdrop speed formula and playfield all come from a pack through
`src/content/`. `createWorld` requires that value, and `src/content/rules.ts` is
the only place that interprets one. A number the sim needs that is not in the
schema is a number no pack can change, which is the failure this arrangement
exists to prevent — so adding one means adding it to `src/content/schema.ts` and
to the pack, not defaulting it in the sim.

The same is true of content: a stage arrives as a resolved `StageContent`
through a `StageSource` (`src/content/stages.ts`), never as a pack or a
registry. The sim may import `src/content/schema.ts`, `src/content/rules.ts` and
`src/content/stages.ts`; it may **not** import `src/content/fs.ts`, which is
Node-only. The sim receives loaded values, it never loads one. `src/main.ts` is
where the loader runs for the browser.

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
- **The simulation is not bit-identical across machines, and the fingerprint is
  rounded so that this does not reach the test suite.** `src/sim/paths.ts` notes
  that `Math.sin`, `Math.cos` and `Math.atan2` are engine-defined; they can also
  differ by one ULP between CPU architectures, and a golden re-recorded on an
  arm64 Mac did fail CI on x86-64 Linux over a single bit in one enemy's frozen
  position. `fingerprintWorld` therefore quantises every number it serialises to
  six decimal places — 1.8e7 times the measured noise, and 5e5 times finer than
  the half pixel that is the finest difference anyone could see. Entry paths were
  never exposed (a bezier is multiplies and adds); dive paths are.
  **What that does not do:** make the simulation portable, or remove the problem.
  Rounding is discontinuous, so two values straddling a grid line still differ —
  roughly 1e-5 odds across a whole fingerprint rather than the near-certainty it
  replaced. Cross-platform bit-identical simulation is still open; this only makes
  it irrelevant to the goldens. `tests/unit/world.test.ts` pins both edges of the
  mesh, so loosening it further cannot pass unnoticed.
- Golden replays live in `tests/sim/golden/`, written by
  `npx tsx scripts/record-replay.ts` and compared byte for byte (so the
  directory is in `.prettierignore`). A PR that changes one either meant to or
  broke something — say which. `--check` fails instead of rewriting. One of them
  (`stage-entry`) records an **empty** input log on purpose: entry choreography
  is scripted, so a golden with no input is a record of the fleet and the
  formation alone.

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
- A pack is read **two ways, and they must not drift**: `src/content/fs.ts` walks
  the directory with `node:fs` for the validator and the tests, and
  `src/content/bundle.ts` walks the same tree with Vite's `import.meta.glob` for
  the browser. Neither is re-exported from `index.ts` — one would pull `node:fs`
  into the bundle, the other a Vite-only transform into plain Node.
  `tests/unit/bundled-packs.test.ts` holds the two to each other, because
  otherwise a pack can load from disk, pass every unit test and the validation
  gate, and still leave the game a blank page. Bundle the whole tree; never a
  list of the files someone remembered.

## Enemies address the formation; the formation is sixteen numbers

A formation is `N` column X coordinates and `M` row Y coordinates —
`formationAxes` derives them from the distinct slot indices — and every enemy
holds an _index_ into them rather than a position. Sway and breathe move only
those `N + M` values, so forty enemies follow for free and a differently shaped
formation inherits both motions without new code. An enemy at home _is_ its
slot. Per-enemy offsets are the mistake this exists to prevent; they cost forty
times as much and drift apart.

Two consequences when editing `src/sim/formation.ts` or `src/sim/enemies.ts`:

- **The sway's exit is two-part.** It does not stop when the last wave arrives;
  it stops the next time the offset passes through zero, which is what makes the
  formation exactly centred before anything dives. `formation-settled` is raised
  on that frame.
- **Enemy state advances on a round robin, positions do not.**
  `rules.enemies.updatePhases` is 4 for Classic: each enemy's state machine runs
  on one frame in four, while every enemy's position moves every frame. A launch
  therefore lands within `updatePhases` frames of when it was due, on purpose.

**A stage document is an entry script, not a stage.** The arcade keeps a library of
13 combat scripts and selects one per stage through a per-rank 17-entry index list,
so several stage numbers play one document: `stageSequence.normal.rows` names
`stage-4` twice because stage 8 is the same script row. Never ship a copy.
`packs/classic/stages/README.md` carries the mapping, the decode of every `home`
back to the ROM's wave table, and what the reference does not settle.

**A simultaneous pair in a wave must differ in `mirror`.** One path plus a reflection
is a single lane, so two same-handed slots launching on the same frame fly as one
sprite. `trailing` on the second of a pair is what makes a wave a file;
`tests/unit/classic-content.test.ts` fails on the collision.

Slot homing is `toSlot` and nothing else. It resolves its target when the path
compiles, so an enemy entering a _swaying_ formation is handed where its slot
**will be** on arrival (`slotPositionAhead`, solved as a fixed point), not where
it is now. Writing a second homing routine is the wrong fix — a diver returning
from the bottom flies the pack's `enemies.dive.returnPath`, which is one
`toSlot` segment and nothing else.

## The attack reads one row of a table and never scales it

`src/sim/dive.ts` resolves the stage's difficulty row once and obeys it: per-role
launch rates, the simultaneous-diver limit and its later bump, the
continuous-bombing threshold. The rows are **non-monotonic on purpose** — three
of the four rank tables contain a stage markedly easier than the one before — so
nothing interpolates between rows and there is no difficulty multiplier anywhere.
`src/content/rules.ts` holds the resolvers (`resolveMaxDivers`,
`resolveLaunchCredit`, `isContinuousBombing`, `resolveBombVectors`,
`allowsTransform`, …) and is still the only place a row is interpreted.

Two consequences when editing either:

- **Diving begins from `formation-settled`**, the frame the sway passes back
  through zero — not from the last wave arriving. `armDives` is called there and
  nowhere else.
- **Two row fields are read by nothing**: `bombEnable` and `reloadAttackVectors`.
  The reference records the selectors but not what they select, so modelling them
  would be invention. Leave them as data until the reference covers them, and do
  not "wire them up" to something plausible.

## Audio is the other side of that boundary

`src/audio/synth.ts` is in two halves on purpose: `buildSoundPlan` is pure and
turns a `Sound` into the voices and scheduled parameters to build, and `playPlan`
realises one against `SynthContext` — a structural subset of Web Audio that a
real `AudioContext` satisfies and `tests/unit/helpers/fake-audio-context.ts`
implements. That is the only reason the graph is testable on the Node-only test
environment, so keep the split when editing.

Two more things hold: no `AudioContext` exists until `Synth.unlock()` runs from a
user gesture, and every call into Web Audio is wrapped — the game must run
silently and correctly when audio is blocked. And **which event plays which sound
is data**: `sounds` in a pack manifest maps simulation event names to sound ids,
the loader checks every id, and `src/audio/sfx.ts` names no effect of its own.

## Layout

`docs/DESIGN.md` section 9 fixes the source layout, and each directory carries a
short README saying what lands there and when, updated as each milestone fills
it in.

`/lab` (`src/ui/lab/`, entry document `lab.html`) is a **dev-only** route, kept
that way three ways at once: Vite's only build input is `index.html`, nothing on
that graph imports the lab, and the URL is wired up by a plugin declaring
`apply: 'serve'`. `tests/unit/lab-dev-only.test.ts` checks all three.

## Rendering: rasterise once, and no colours in the renderer

`src/render/` is a subscriber and holds no art of its own. Two contracts that
are easy to break and cheap to keep — `src/render/README.md` has the detail:

- Anything derived from pack data is built when the pack loads, not per frame.
  `createSpriteSheet` rasterises every frame up front and `SpriteSheet.bitmap`
  returns the _same_ object each call; the font caches one tinted strip per ink
  colour. Treat what comes back as read-only.
- The palette is pack data. A sprite colour the pack's `palette` does not declare
  is a load-time throw from `createSpriteSheet`, never a silent black pixel.

Rasterising is split from drawing so both are testable on Node: pixels are pure,
and turning a bitmap into something `drawImage` takes is an injectable
`SurfaceFactory`. Keep that split. `npm run sprite-sheet` renders a pack's art
and font through the real pipeline into `docs/media/`, which is the contact sheet
`docs/DESIGN.md` section 11 asks a visual PR to attach.

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
- `tests/helpers/rules.ts` holds the content fixtures, not only the rules ones:
  `classicPack`, `classicRules`, `classicStages` and `classicFormation` read the
  shipped pack through the real loader, `stageSourceOf` wraps a hand-written
  stage for a shape the pack does not ship, `minimalRules` is the smallest
  document the schema accepts, and `quickRunRules` bends the shipped rules so a
  whole run fits in a test. Tests use them rather than writing content inline,
  so a new required field is one edit.
- Art is original by rule, not by preference: `docs/DESIGN.md` section 2 bars
  ripped sprites, traced art, ROM data and the original's names. Enemy roles are
  `drone`, `wing` and `warden` everywhere outside
  `docs/reference/arcade-reference.md`.
- `tests/unit/sim-boundary.test.ts` briefly writes `src/sim/__boundary_probe__.ts`
  and removes it again. The path is gitignored in case a run dies mid-test.
- The game boots into **attract mode**, not into play: `src/ui/flow.ts` is the
  one state machine (attract, playing, game over, results, high-score entry) and
  `src/main.ts` only calls `flow.step(frame)` and draws the phase. Anything
  driving the browser has to push start first — that is what `startGame()` in
  `tests/e2e/smoke.spec.ts` is for — and every phase timer counts **simulation
  steps**, never the wall clock. The attract demo is the real simulation played
  through `src/engine/replay.ts`, so it cannot drift from the game.
- Headings are degrees, **clockwise positive, with 0 pointing down the screen**
  (`src/content/schema.ts`), so on a y-down playfield a heading θ is the vector
  `(−sin θ, cos θ)` and 90° points _left_. `src/sim/paths.ts` restates it as a
  table; reading it the other way round is the quietest bug in movement code.
- Mirroring a path is a reflection applied to the **evaluation**, never a second
  copy of the data: world-space targets reflect in, sampled positions reflect
  out, and arcs reverse their handedness because the reflection says so. A pack
  that ships a hand-mirrored twin of a path is working against
  `src/sim/paths.ts`. A dive uses the same mechanism to fan outwards: the enemy's
  side of the formation picks the flag (`isRightOfCentre`).
- **A dive path states no `start` and may use no `line` or `bezier`.** It is
  flown from wherever the enemy already sits, so every segment has to be relative
  to the flyer's pose — `arc`, `loop`, `sine`, `aimAtPlayer`, `exitBottom`. A dive
  authored with absolute targets drags all forty enemies through the same piece
  of screen and no single-position test notices;
  `tests/unit/classic-paths.test.ts` flies each one from six slots for that
  reason. `/lab` starts such a path at its slot marker, so a dive previews there.
- Vite's port is shared between checkouts, and `playwright.config.ts` reuses an
  existing dev server outside CI — so a second worktree's Playwright run
  silently tests the _first_ one's build: green, and meaningless. Set
  `STAR_SWARM_PORT` to give a worktree its own.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
