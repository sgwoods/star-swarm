# `src/ui/`

`flow.ts` (the game-state machine), `attract.ts`, `hud.ts`, `results.ts`,
`highscores.ts`, `panel.ts` (the plate every card sits on), `menus.ts` and
`lab/` (the `/lab` preview harness).

Like `src/render/`, this layer is a **subscriber** — it reads simulation state
and events and draws; it never writes back, and `src/sim/` never imports it.

`hud.ts` landed with Milestone 1: score, reserve fighters and the stage badges.
The front-end shell around it landed with Milestone 2:

- **`flow.ts` is the one state machine.** Six phases — attract, playing, the
  between-stage challenge card, game over, results, high-score entry — and every
  transition is in that file. `challenge-results` is the one that goes _back_ to
  playing: the stage is over and the next is already on the field, so the world
  simply stops being stepped while the card is up. That is why it is a phase and
  not a flag — "playing" must never sometimes mean "not stepping the world". A
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
- **The between-stage challenge card reuses the results screen.** `drawResults`
  takes the rows, the heading and the footer it is given, so `drawChallengeResults`
  is those three plus the blinking "PERFECT !" banner rather than a second
  layout. The rows it shows are the original's: the hit count, and the
  end-of-stage award under a label that changes with the branch — "SPECIAL BONUS"
  when the perfect bonus _replaced_ the per-hit one, "BONUS" when it did not.
- **The badge denominations are pack data.** `pack.json`'s `stageBadges` pairs
  each value with the sprite that draws it, and `badgesForStage` decomposes a
  stage number greedily over whatever it is handed — sorting first, because
  greedy is only correct largest-first and a pack's ordering is not a rule.

Seams left for the tasks that follow, so they attach without editing a screen:

- **`FlowOptions.resultRowsFor`** replaces the rows the end-of-game results
  screen draws, and `RunStats` is where new counters go. The card grows with the
  rows it is given.
- **A pack-supplied default high-score table** — `DEFAULT_HIGH_SCORES` is ours
  and provisional; `createHighScoreBoard({ defaults })` already takes one.

`menus.ts` (player settings) arrives with Milestone 3. See `docs/DESIGN.md`
sections 4, 6 and 9.
