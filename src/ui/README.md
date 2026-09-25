# `src/ui/`

`flow.ts` (the game-state machine), `attract.ts`, `hud.ts`, `results.ts`,
`highscores.ts`, `panel.ts` (the plate every card sits on), `menus.ts` and
`lab/` (the `/lab` preview harness).

Like `src/render/`, this layer is a **subscriber** — it reads simulation state
and events and draws; it never writes back, and `src/sim/` never imports it.

`hud.ts` landed with Milestone 1: score, reserve fighters and the stage badges.
The front-end shell around it landed with Milestone 2:

- **`flow.ts` is the one state machine.** Five phases — attract, playing, game
  over, results, high-score entry — and every transition is in that file. A
  phase flag anywhere else is a bug: `src/main.ts` owns the display, the input
  device and the starfield, calls `flow.step(frame)` once per simulation step,
  and draws whatever phase says. Time is counted in **simulation steps**, never
  the wall clock, so a screen looks the same at the same step on any machine and
  a test can run a phase out in a loop.
- **The attract demo is the real simulation.** `attract.ts` holds an input log
  and plays it through `createReplaySource` (`src/engine/replay.ts`) into a real
  `createWorld`/`stepWorld`, on the same rules and the same `StageSource` a game
  gets — so it flies the pack's real stage, entry waves and all. There is no demo
  animation to keep in step with the game, and the player's own input cannot
  reach the demo world — only the start button, which ends it. No run in the log
  is longer than ~130 steps, because the fighter crosses the playfield in 138:
  longer and it parks against a wall.
- **The results screen counts from events**, not from bookkeeping added to the
  sim: `shot-fired` against `target-hit`/`target-destroyed` (`results.ts`).
- **The high-score table degrades, never throws.** `highScores.ts` splits
  ordering and insertion from persistence; `createWebStorage` catches on every
  path, including the property access itself, and falls back to a session-only
  table that behaves identically. A blocked storage API must never take the game
  down.

Seams left for the tasks that follow, so they attach without editing a screen:

- **Challenge-stage results** — `FlowOptions.resultRowsFor` replaces the rows
  `results.ts` draws, and `RunStats` is where new counters go. The card grows
  with the rows it is given.
- **Stage badges** — `hud.ts` already draws them from the stage number, which
  the flow passes through from whichever world is on screen.
- **Extra lives** — the sim raises `extra-life`; `RunStats.extraLives` counts
  them, so the rule can change without touching a screen.
- **A pack-supplied default high-score table** — `DEFAULT_HIGH_SCORES` is ours
  and provisional; `createHighScoreBoard({ defaults })` already takes one.

`menus.ts` (player settings) arrives with Milestone 3. See `docs/DESIGN.md`
sections 4, 6 and 9.
