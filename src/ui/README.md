# `src/ui/`

`flow.ts` (the game-state machine), `attract.ts`, `hud.ts`, `results.ts`,
`highscores.ts`, `menus.ts` (the start-up variant selector and the settings menu),
`packs.ts` (the pack manager and the stage-sequence editor the settings menu opens),
`compose.ts` (the judge behind them: what a player's list composes to, and whether
it may be kept),
`pause.ts` (the pause card and the one that asks before a run is thrown away),
`keys.ts` (how every card is worked, and how it says so),
`settings.ts` (what the player has chosen), `storage.ts` (where it is kept),
`panel.ts` (the plate every card sits on), `autoplay.ts` (the pilot that plays the
game as a persona), `build-info.ts` and `build-stamp.ts` (which build is this, and
is a newer one being served), and `lab/` (the `/lab` preview harness).

Like `src/render/`, this layer is a **subscriber** — it reads simulation state
and events and draws; it never writes back, and `src/sim/` never imports it.

`hud.ts` landed with Milestone 1: score, reserve fighters and the stage badges.
The front-end shell around it landed with Milestone 2:

- **`flow.ts` is the one state machine.** Twelve phases — the start-up variant
  selector, attract, the settings menu and the pack and stage cards it opens,
  playing, paused, the exit confirmation, the between-stage challenge card, game
  over, results, high-score entry — and every
  transition is in that file. `challenge-results` is one of the two that go _back_
  to playing: the stage is over and the next is already on the field, so the world
  simply stops being stepped while the card is up. That is why it is a phase and
  not a flag — "playing" must never sometimes mean "not stepping the world" — and
  it is why the two menus are phases too, and why the pause is the third: a
  `paused` boolean beside `phase` is exactly the shape being refused. A phase flag
  anywhere else is a bug: `src/main.ts` owns the display, the input device and the
  starfield, calls `flow.step(frame)` once per simulation step, and draws whatever
  phase says. Time is counted in **simulation steps**, never the wall clock, so a
  screen looks the same at the same step on any machine and a test can run a phase
  out in a loop.
- **The attract demo is the real simulation.** `attract.ts` builds a real
  `createWorld`/`stepWorld` on the same rules, rank and `StageSource` a game gets —
  so it flies the pack's real stage, entry waves and all — and hands it one input
  frame per step. There is no demo animation to keep in step with the game, and
  the player's own input cannot reach the demo world — only the start button,
  which ends it.
- **The variant's personas fly it, in turn.** The `defaultPersona` first, then on
  through the list in menu order, each playing one whole game; the next takes over
  on the step after a game over, with a three-minute ceiling that only Deep Sea's
  astronaut reaches. Every leg starts the same world from the same seed and each
  pilot has a seed the cycle never advances, so the cycle repeats exactly. The
  header of `attract.ts` is the argument for flying it this way rather than with
  the input log.
- **A variant with no personas is flown by the input log**, `DEMO_SCRIPT`,
  through `createReplaySource` (`src/engine/replay.ts`). It is that variant's whole
  demo and never a leg of a persona cycle. No run in the log is longer than ~130
  steps, because the fighter crosses the playfield in 138: longer and it parks
  against a wall.
- **Who is flying is named in the bottom band**, by `drawPersonaTag` in `hud.ts`:
  the demo's persona in attract and the armed one in a watched game, read from the
  flow's `flying`. It sits between the reserve fighters and the badges and is
  fitted to the room they leave, dropping `AUTO` before it cuts the label.
- **The results screen counts from events**, not from bookkeeping added to the
  sim: `shot-fired` against `target-hit`/`target-destroyed` (`results.ts`).
- **The high-score table degrades, never throws.** `highscores.ts` splits
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
- **The build stamp is two modules for one reason**, the same one
  `src/audio/synth.ts` splits on: `build-info.ts` is pure and imports nothing at
  all — the identity type, the parser, the comparison and the step-driven poller
  — and `build-stamp.ts` is the drawing. That is what lets `vite.config.ts`
  import the one constant both sides need (the name of the served file) without
  pulling a canvas into a Node process, and what lets the poller be tested with
  no browser. The identity itself is never written down: it is substituted into
  the bundle by the plugin in `vite.config.ts` from `scripts/build-identity.ts`,
  and a bundle nobody substituted into says `unknown` rather than inventing a
  release.
- **The stamp draws in the top HUD band and the notice never moves anything.**
  The two corner rows fit the gaps `hud.ts` leaves right of `HIGH SCORE` and
  right of the high-score value — nine cells and eleven — so a longer commit
  would run through the score rather than wrap. When a newer build is served the
  commit row and the attract line _alternate_ with the notice rather than being
  replaced by it, which is why nothing on screen shifts and why the notice cannot
  interrupt a game.
- **The badge denominations are pack data.** `pack.json`'s `stageBadges` pairs
  each value with the sprite that draws it, and `badgesForStage` decomposes a
  stage number greedily over whatever it is handed — sorting first, because
  greedy is only correct largest-first and a pack's ordering is not a rule.

Milestone 3's front-end half landed next:

- **`flow.ts` holds the variant in force**, derives every world and the attract
  demo from it, and reports a change through `onVariantChange` so that `main.ts`
  can rebuild the sprite sheet and the effect map. It does not touch either: this
  layer subscribes, and a flow that reached for a canvas would be the same mistake
  as a sim that did. The selector is entered **only when there is more than one
  variant** — a one-game cabinet boots straight into attract, with no screen to
  dismiss — and later games in a session begin from attract, as a cabinet does. The
  way back to the list is the settings screen's `GAME` row.
- **`settings.ts` holds no number the simulation steps.** The difficulty value is a
  _preset id_; `rankFor` in `src/content/variants.ts` turns it into a rank and the
  rules layer resolves that rank into whole tables. There is nowhere in the shape
  to put a multiplier, which is the point — `docs/DESIGN.md` section 6 is explicit
  that rank selects data sets rather than scaling one.
- **`storage.ts` is the one place persistence is written.** The high-score table
  and the settings share it, so the "a browser can revoke it between calls" case is
  handled once. Every path catches, the construction-time probe included, and the
  fallback is an in-memory store that behaves identically for one session.
- **`menus.ts` applies nothing.** Both menus are values with a cursor: a row that
  changes calls `write` with a patch, and `main.ts` is the one place a setting has
  consequences. Their rows are derived on every read, so a value changed elsewhere
  cannot leave a stale row on screen.

And then the pause, which is two more phases and no simulation change at all:

- **`pause.ts` draws two cards and decides nothing.** The pause card, and the one
  that asks before a run in progress is thrown away. The confirmation is a value
  with a cursor like both menus, and it opens on `RESUME` by construction rather
  than by the caller's choice: confirming is destructive, so the safe default is a
  property of the type.
- **Pausing is a flow concern and `src/sim/` never hears about it.** `paused` is a
  phase the world is not stepped in. The frame carrying the press is stepped
  before the phase changes and the resume frame is the flow's, so the simulation
  sees exactly the frames it would have seen unpaused and a resumed run continues
  bit for bit — asserted against an unpaused run of the same frames, not against a
  remembered fingerprint.
- **`exit` pauses first and then asks**, so the question is never answered under
  fire; cancelling lands in `paused`, which is where an ordinary pause lands.
  Confirming discards the run — the score does not reach the high-score table —
  and the card says the score, and the place it would have taken, so nothing is
  discarded silently. Home is attract in both cabinets, because the selector is a
  boot-time screen that a one-variant build never enters.

And the autoplay pilot, which is a subscriber like everything else here:

- **`autoplay.ts` takes a view, never a world.** `createAutopilot` is handed a
  `PilotView` — a freshly built plain value holding what is on the screen — and
  returns one `InputFrame` carrying the same three bits a keyboard carries. It
  cannot read the difficulty row, a bomb timer or the generator, and it cannot
  write anything at all, because `viewOfWorld` copies numbers out and leaves no
  reference to reach back through. That is the whole of "a persona plays; it does
  not cheat", and it is a property of the seam rather than of a comment:
  `tests/unit/autoplay.test.ts` fingerprints a world either side of 1,200 samples.
- **A persona is eight numbers in a variant document**, and nothing here names one.
  Every field is read by name and applied identically, so a fifth persona is a
  fifth entry in a document. `src/content/personas.ts` is the schema.
- **Its only clock is the step count on the view, and its only chance is a seeded
  `Rng` of its own** — never the world's, so how much a persona dithers cannot
  change what the simulation computes. `eslint.config.js` bans `Math.random`,
  `Date` and `performance` in this one file for that reason.
- **The flow decides _when_ it flies, and the pilot never presses a screen's
  buttons.** A persona drives `playing`; the `start` that begins a game out of
  attract is the flow's own, as is the one that gets past high-score entry. A
  human's `left`, `right` or `fire` in a live game clears the setting on that
  frame — and `menu`, `pause` and `exit` deliberately do not, so a watched run can
  be paused and looked at without ending the demonstration.

And the two cards that let a player change the game from inside it — the pack
manager and the stage-sequence editor, Milestone 3's exit check:

- **`packs.ts` holds two drafts with a cursor and applies nothing.** The pack card
  lists every installed pack and reads each one's layer, `1` the base and the
  highest winning; switching a pack on puts it on top. The stage card orders the
  combat stages, `OWN` the packs' order and `MINE` the player's, each row saying
  the stage number it plays as. `ENTER` keeps a draft only when its verdict
  allows, `ESC` throws it away, and the flow is the one place a kept list has
  consequences.
- **`compose.ts` judges, and every judgement is somebody else's check.** Will it
  load is `resolveVariant` in `src/content/variants.ts`; will its stages build is
  `checkStructure` from `scripts/playability.ts`; what is it coupled to is
  `findCouplings` in `src/content/couplings.ts`, said on the card rather than
  refused. It does not fly a persona — seconds per list, where a card wants
  milliseconds — and `tests/sim/pack-manager-cost.test.ts` holds that cost in
  place.
- **`Settings.packs` and `Settings.stages` are per-variant lists of ids**, and the
  flow composes the chosen variant from them. One that no longer composes — a pack
  this build does not install — is set aside whole, not repaired: the variant
  plays as shipped, the rows say so, and the document keeps the list.

And one scheme for working all of those cards:

- **`keys.ts` is how every card is worked**: up and down move between rows, left
  and right change the row under the cursor, Enter (or fire) takes and Esc goes
  back; a card with one line of choices answers every direction. `cardPress` is
  what `flow.ts` reads on every card and `keyLine` is the one way a card writes
  its help, so neither the behaviour nor the voice can drift card by card. The
  exit key is left out of both on purpose — it opens the exit card and cancels it,
  and must never be a key that takes.

Seams left for the tasks that follow, so they attach without editing a screen:

- **`FlowOptions.resultRowsFor`** replaces the rows the end-of-game results
  screen draws, and `RunStats` is where new counters go. The card grows with the
  rows it is given.
- **A pack-supplied default high-score table** — `DEFAULT_HIGH_SCORES` is ours
  and provisional; `createHighScoreBoard({ defaults })` already takes one.

See `docs/DESIGN.md` sections 4, 6 and 9, `docs/ARCHITECTURE.md` §4.5 and §6 for
what exists, and `docs/ROADMAP.md` for what is next.
