# `src/sim/` — simulation

Pure game simulation: `world.ts`, `player.ts`, `shots.ts`, `enemies.ts`,
`formation.ts`, `paths.ts` (segment interpreter), `dive.ts`, `capture.ts`,
`abilities/` (one file per ability), `scoring.ts`, `stages.ts`.

Milestone 1 landed the player half: `world.ts`, `player.ts`, `shots.ts`,
`collision.ts`, `lives.ts` and `events.ts`. Milestone 2's first task replaced
the static stand-in with real enemies: `enemies.ts` (entry waves, the four-phase
update, slot homing) and `formation.ts` (the coordinate axes, sway and breathe).
The dive task added `dive.ts` — dive attacks, enemy fire and the difficulty ramp
that drives both — `challenge.ts` followed with challenge stages and their three
awards, and `capture.ts` with the tractor beam, the captured fighter, the rogue,
rescue and the dual fighter.

**The attack is one director, and dives are where capture hooks in.** `dive.ts`
resolves the stage's difficulty row once and reads it: the per-role launch rates,
the diver limit and its later bump, the continuous-bombing threshold. Diving
begins from `formation-settled` and nowhere else, launch decisions are taken once
per round robin, and each enemy's own bombing decision is taken on its own phase.
A captor's dive is an ordinary dive with a beam on it: the director asks
`capture.ts` one question when a captor-role launch comes up — is this one an
attempt? — and launches it through the same credit, the same diver limit and the
same `beginDive` whichever way the answer goes. All that differs is the path.

**Capture is one channel, and the channel is the rule.** There is exactly one
captured fighter in a run, ever, and a captor may only be chosen while the channel
is idle. A successful capture does **not** free it, so no second beam appears
while a fighter is held — including while it is parked as a rogue, and including
while it is flying beside you as a dual. "A dual fighter is never targeted" is
therefore not a special case anywhere; it falls out of the flag. The complete set
of ways the channel is released is the list of `releaseCapture`'s callers, and
each one is an arcade release site the rules-and-scoring report traced.

Two consequences worth knowing before editing `capture.ts`:

- **The captured fighter is an `Enemy`.** It sits in the formation, dives with its
  captor, is shot for 500 or 1,000 by the ordinary doubling rule, and re-enters as
  the last ship of the next stage's wave. Its `home` indexes the formation's
  _captive_ slots rather than its alien slots, which is the whole of what
  `Enemy.inCaptiveSlot` is for.
- **Being captured is a loss condition of its own.** It raises `player-captured`
  rather than `player-hit`, and on the last fighter it ends the game — which
  `docs/DESIGN.md` originally missed and the original's manual is explicit about.
- **The channel is stepped outside the attack director.** `stepAttacks` gates a
  challenge stage in one place; `stepCapture` does not go through it, because a
  beam in flight has to finish whatever the stage is. So the parts of it that
  attack ask `allowsAttacks` themselves, and a held fighter sits a challenge
  stage out rather than joining its wave.

Two fields of a difficulty row are carried as data and **read by nothing yet**:
`bombEnable` (the arcade's "parameter for set bomb drop enable flags") and
`reloadAttackVectors`. The reference records the raw selectors but not what they
select, so modelling them would be invention rather than reproduction; they stay
verified data until the reference covers them.

**A challenge stage's awards are three different rules, and the trap is that two
of them index the same stage counter differently.** The per-impact value cycles
with a period of eight challenge stages; the group-of-eight bonus clamps at its
maximum. So the ninth challenge stage pays the _first_ stage's 100 a hit and the
_last_ stage's 3,000 a group at the same time. Both come from the rules layer, so
neither is a number `challenge.ts` knows. The third award — 100 × hits at the end
of the stage, or a flat perfect bonus that **replaces** it — is the one an
implementation most often turns into an addition, at 4,000 points a stage.

**A challenge stage has no attack at all**, and that is stated rather than
inferred: `allowsAttacks` in `src/content/rules.ts` is what `dive.ts` reads once
per stage to make the whole director inert. Nothing arms it on a challenge stage
anyway — `formation-settled` never comes, because the formation never sways — but
"no dives because no settle" is a coincidence of two unrelated rules, and the
enemies would still have **bombed**: a challenge flyer spends its whole life in
`entering`, which is the one state entry bombing applies to.

**The simulation has no rules of its own.** Every policy number it steps — the
movement cadence, the travel limits, the shot cap, the hit windows, the
extra-life thresholds and their ceiling, the challenge cadence and its three
awards, the formation's sway and breathe, the enemy update cadence, the
playfield — arrives as one resolved `Rules` value from
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
