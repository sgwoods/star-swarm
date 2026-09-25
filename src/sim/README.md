# `src/sim/` — simulation

Pure game simulation: `world.ts`, `player.ts`, `shots.ts`, `enemies.ts`,
`formation.ts`, `paths.ts` (segment interpreter), `dive.ts`, `capture.ts`,
`abilities/` (one file per ability), `scoring.ts`, `stages.ts`.

Milestone 1 landed the player half: `world.ts`, `player.ts`, `shots.ts`,
`collision.ts`, `lives.ts` and `events.ts`. Milestone 2's first task replaced
the static stand-in with real enemies: `enemies.ts` (entry waves, the four-phase
update, slot homing) and `formation.ts` (the coordinate axes, sway and breathe).
Dive attacks, enemy fire, the capture beam and challenge stages are the sibling
tasks that build on those two.

**The simulation has no rules of its own.** Every policy number it steps — the
movement cadence, the travel limits, the shot cap, the hit windows, the
extra-life thresholds, the formation's sway and breathe, the enemy update
cadence, the playfield — arrives as one resolved `Rules` value from
`src/content/`, which `createWorld` requires. The same is true of content: a
stage arrives as a resolved `StageContent` through a `StageSource`
(`src/content/stages.ts`), never as a pack. Nothing here loads anything:
`src/content/fs.ts` is Node-only and off limits, so a caller hands the
simulation values that have already been validated. `src/content/rules.ts` is
the only place that interprets a rules value.

**Enemies address the formation; they do not carry positions of their own.** An
enemy at home _is_ its slot, and only the formation's `N` column and `M` row
coordinates animate. That is what makes sway and breathe cost sixteen numbers
instead of forty, and it is why a differently shaped formation inherits both
motions for free.

**Key rule:** nothing here may touch the DOM, Canvas or Web Audio. The sim emits
events; `render/` and `audio/` subscribe. That is what makes headless tests and
replays possible.

The rule is enforced mechanically, not by convention:

- ESLint `no-restricted-imports` / `no-restricted-globals` for this directory
  (see `eslint.config.js`).
- `tests/unit/sim-boundary.test.ts`, which scans the tree as a backstop.

Both run in CI, so a violation fails the build.

See `docs/DESIGN.md` section 9.
