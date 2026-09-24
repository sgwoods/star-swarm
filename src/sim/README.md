# `src/sim/` — simulation

Pure game simulation: `world.ts`, `player.ts`, `shots.ts`, `enemies.ts`,
`formation.ts`, `paths.ts` (segment interpreter), `dive.ts`, `capture.ts`,
`abilities/` (one file per ability), `scoring.ts`, `stages.ts`.

**Key rule:** nothing here may touch the DOM, Canvas or Web Audio. The sim emits
events; `render/` and `audio/` subscribe. That is what makes headless tests and
replays possible.

The rule is enforced mechanically, not by convention:

- ESLint `no-restricted-imports` / `no-restricted-globals` for this directory
  (see `eslint.config.js`).
- `tests/unit/sim-boundary.test.ts`, which scans the tree as a backstop.

Both run in CI, so a violation fails the build.

See `docs/DESIGN.md` section 9.
