# `src/sim/` — simulation

Pure game simulation: `world.ts`, `player.ts`, `shots.ts`, `enemies.ts`,
`formation.ts`, `paths.ts` (segment interpreter), `dive.ts`, `capture.ts`,
`abilities/` (one file per ability), `scoring.ts`, `stages.ts`.

Milestone 1 landed the player half: `rules.ts` (the typed rules layer),
`world.ts`, `player.ts`, `shots.ts`, `collision.ts`, `lives.ts`, `events.ts` and
`targets.ts` — the last being a static stand-in that Milestone 2's real enemies
replace.

**Key rule:** nothing here may touch the DOM, Canvas or Web Audio. The sim emits
events; `render/` and `audio/` subscribe. That is what makes headless tests and
replays possible.

The rule is enforced mechanically, not by convention:

- ESLint `no-restricted-imports` / `no-restricted-globals` for this directory
  (see `eslint.config.js`).
- `tests/unit/sim-boundary.test.ts`, which scans the tree as a backstop.

Both run in CI, so a violation fails the build.

See `docs/DESIGN.md` section 9.
