# `packs/classic/`

The arcade-faithful pack. The manifest, the palette, the formation, the rules,
the entry, dive and challenge paths, the sprite set, the sound set, the three
roles plus the transform trio, the capture mechanic's content, the normal stages
through 8 and the eight challenge stages are all here.

## Roles

`docs/DESIGN.md` section 2 requires original naming, so the three enemy roles are
this project's own. For anyone checking a number against
`docs/reference/arcade-reference.md`, they map to the arcade roles as:

| Role id  | Arcade role    | Formation                          |
| -------- | -------------- | ---------------------------------- |
| `drone`  | bee role       | two rows of 10, columns 0, 2 … 18  |
| `wing`   | butterfly role | two rows of 8, columns 2, 4 … 16   |
| `warden` | boss role      | top row of 4, columns 6, 8, 10, 12 |

One further role, `captive`, is not an alien the pack invented: it is the
player's own fighter after a capture, which sits in the formation, attacks and
can be shot down for points (`src/sim/capture.ts`). It is a role so that the rest
of the pack — the formation's captive slots, the dive lottery, the score — can
address it the same way it addresses everything else, and its art is `player-captured`
rather than a sprite of its own name, because that is what it is.

## What is already populated

- **`pack.json`** — the 40-slot `classic40` formation and its four captive slots
  (one per `warden`, one row above it). Slots are logical `(row, column)` and
  `grid` turns each index into a pixel; see _The formation's pixel grid_ below.
- **`aliens/`** — `drone`, `wing` and `warden`, plus the three transform types
  (`scourge`, `manta`, `ensign`), each naming its sprite and its **base** score
  only (50, 80, 150). The diving value is the base times the rules
  layer's `scoring.movingMultiplier`, applied on the alien's motion _state_, so
  50/100 is never stored as two numbers — `docs/DESIGN.md` section 4 explains why
  a flat pair gets a captor's latched escort bonus wrong. The `warden` is the
  two-hit role: `hp: 2` and `hitSprites: ["warden-hit"]`, which is how its first
  hit changes its colour instead of destroying it. Each also carries its `fire`
  pattern and its `dive`, from the dive task. Plus the three transform types and
  `captive`, the player's own captured fighter — base 500, so it is 500 parked
  and 1,000 attacking through the same doubling rule as everything else.
- **`stages/`** — five documents covering the normal stages through 8. Each is
  five waves of eight, as reference section 5's `db_attk_wav_IDs` composes them:
  4 `wing` + 4 `drone`, then all four `warden`s with 4 `wing`, then 8 `wing`,
  then 8 `drone` twice over. Every slot names its own `home`, so the waves are
  identity-addressed rather than "next free slot", and the 40 homes cover the
  formation exactly once. That composition is the **same on every stage** —
  `c_25A2` resets the wave-ID pointer at each one — so a document is really an
  **entry script**, and stage 8 plays `stage-4` because both are script row 4
  rather than shipping a second copy of it. The **choreography** — which path
  each wave flies, the `mirror` and `trailing` flags and the wave timings — is
  ours: the reference derives the composition but explicitly does not derive
  which of the thirteen ROM scripts is which shape. `stages/README.md` carries
  the decode of every `home` back to the ROM table, the script-row mapping and
  what is still missing; `paths/README.md` covers the three shapes.
- **`stages/challenge-1.json` … `challenge-8.json`** — the eight challenge
  scripts, cycling every eight challenge stages exactly as reference section 8
  says the original's do. Each is five waves of eight single-hit aliens flying a
  path that never addresses a formation slot, so its flyers leave rather than
  settle. Which columns they converge on is the one thing about them that is
  load-bearing rather than decorative; see _Where a challenge convoy falls_
  below.
- **`stageBadges`** in `pack.json` — the six denominations of `docs/DESIGN.md`
  section 4 (1, 5, 10, 20, 30, 50), each with the sprite that draws it. Data
  rather than a table in the HUD because a sibling game counts stages
  differently, or not at all.
- **`rules.json`** — all four difficulty ranks as 26 literal rows each, from
  `docs/reference/arcade-reference.md` section 6, plus the shot caps, extra-life
  settings, challenge cadence, capture rules and scoring rules from sections 3,
  7, 8 and 9. It also carries everything the simulation steps: the movement
  cadence and travel limits, the fighter and shot geometry, both hit-window
  sets, the enemy bullet, the starfield speed formula and the playfield — and,
  from the formation task, `enemies.updatePhases` (the four-frame round robin the
  enemy state machine runs on) and the whole `formation` block: the sway's ±32 px
  triangle at 1 px per 4 frames, the breathe's 32-step accordion with its
  per-coordinate displacements, and the stage kinds on which neither runs. The
  simulation reads this file through the loader and holds no copy of any of it.
- **`palette`** in `pack.json` — the pack-wide palette of `docs/DESIGN.md`
  section 5. Every colour a sprite uses has to be one of these; the renderer
  holds none of its own and refuses to build a sheet from a colour that is not
  here.
- **`sprites/`** — the original 16×16 cast (`player`, `player-captured`, the
  three roles, `warden-hit` for the boss's second colour, both explosions) and
  the 8×8 HUD art (`shot-player`, `shot-alien`, the six stage badges). Drawn for
  this project: `docs/DESIGN.md` section 2 rules out the original's art, so these
  take the style and none of the pixels. Wings flap over two frames and
  explosions run over four, per section 5. `npm run sprite-sheet` renders the
  whole set as a contact sheet.
- **`sounds/`** and the `sounds` map in `pack.json` — the Classic SFX set, and
  which simulation event plays each one.

`tests/unit/classic-pack.test.ts` checks these against the reference, so the
plan, the reference and the data are three legs of the same stool: change one
and the test says so.

## The formation's pixel grid

`classic40` states `grid`, and the two axes are not equally well sourced.

**Columns are verified.** Reference section 5 traces the ten column origins to
screen x 32…176 at a pitch of 16 px — a 160 px formation on the 224 px playfield
with 32 px of margin each side. Slot columns are the arcade's own indices
`0, 2 … 18`, so `columnSpacing` is 8 and `originX` is 32. The margin is not a
coincidence: both the sway's ±32 px and the breathe's outermost ±32 px take the
edge columns to exactly x 0 and x 208, which is a 16 px sprite touching each
edge. Change the grid and both motions stop landing there.

**Rows are ours, from a derivation rather than a routine.** The reference gives
the breathe's per-row displacements but not the rows' resting positions; the
rules-and-scoring investigation reports the resting row gaps as 16, 16, 12, 12,
12 px, which is why slot rows step by 4, 3, 3, 3 in a 4 px `rowSpacing` rather
than sitting one apart. `originY` (56, putting the `warden` row there and the
captive row at 40) is a choice, not a measurement. The formation therefore spans
y 40…108, and the breathe pushes the bottom row to 140 at full expansion.

The grid is the reason nothing else needs to know any of this: the formation is
ten column coordinates and six row coordinates, every enemy addresses them by
index, and `rules.json`'s `formation.breathe` tables are indexed the same way —
left to right and top to bottom. A pack that reshapes the formation gets both
motions for free as long as the two tables keep its axis lengths.

## How far each value may be trusted

`provenance` maps a field path in this file to `verified` or `provisional` with
a note. **Verified** means `docs/reference/arcade-reference.md` carries the ROM
routine behind it, and changing it means changing the reference too;
**provisional** means it is ours, because the reference does not cover it or
lists it unresolved. A value with no entry has simply not been assessed.

The marking is data rather than a comment because these numbers live in JSON,
and it is granular where the confidence is: a shot window's Δx bounds are
verified and its Δy bounds are not, so each is marked on its own. The loader
rejects a key that names no field, so a rename cannot quietly leave a verified
value unmarked.

## Where a challenge convoy falls

A challenge stage is the one place where the _geometry_ of a path decides whether
the game is playable as the reference describes it. Reference section 8 records,
at high confidence, that the first two challenge stages can be cleared **without
moving, from the exact centre of the screen**, and that later ones need up to
five firing positions — one per group. So:

- `challenge-1` and `challenge-2` send all five groups down the fighter's home
  column. Both are perfect from a standstill, which
  `tests/sim/golden/challenge-one-perfect.replay.json` and its pair prove with
  input logs that never set a direction bit.
- `challenge-3` … `challenge-8` put each group on a different column, so a player
  who does not move clears one group and watches the rest go by.

That home column is **x 103**, the centre of the fighter's travel, and it is not
the centre of the playfield: the travel limits are the ROM's and are not
symmetric (`player.minX` 0, `player.maxX` 207). Mirroring reflects about the
playfield's centre line, x 112, so the mirrored twin of a path over the fighter
misses it by 9 px against a shot window only ±5 px wide. That is why these paths
declare no mirror and are authored per column instead — the one place in this
pack where a hand-authored pair is right rather than a mistake. `paths/README.md`
has the detail.

## What is deliberately empty

- The per-rank stage sequences of reference section 5. They cannot land until
  more script rows exist, and `stages/README.md` says why in detail: through
  stage 8 alone the four ranks need ten of the thirteen documents, and per-stage
  ids collide between them.

  Both halves of the pack-wide sequence itself are now filled, and they plateau
  on _different_ periods, which is easy to lose: the challenge half states
  `repeatLast: 8` because all eight scripts cycle, and the normal half lists the
  six normal stages through 8 — the first six of the reference's seventeen — and
  still states `repeatLast: 1`, because cycling the last three is a property of
  the whole table and claiming it three rows early would assert a plateau that is
  not there.

- The `abilities` block of every alien, and the capture beam's own path. Both
  belong to sibling tasks. `paths/README.md` says which entry choreography is
  authored and why there are three entry paths rather than thirteen.

The dive paths, the aliens' `dive` and `fire` blocks and `transform.types` — the
three ids `scourge`, `manta` and `ensign`, cycling on a four-stage period for the
bonus in `scoring.transformGroupBonus` — were on this list and have since landed
with the dive task. `stageSequence.challenge.rows` and the challenge scripts it
names were on it too, and land with this one.

## Two values that were left open, and are now settled

Both were unresolved when this pack was first written; a second pass through the
ROM closed them, and both changed a shape rather than a number:

- `scoring.challenge.impactAward` is a table indexed by challenge-stage ordinal:
  **100 on the first challenge stage, 160 on the second through eighth**, with
  `repeatLast: 8` so the whole table cycles rather than plateauing. That cycle is
  deliberate and is _not_ shared with `challenge.groupBonus`, whose index clamps
  at 3,000 from stage 32 — the ninth challenge stage pays 100 a hit and a 3,000
  group bonus at the same time. `docs/reference/arcade-reference.md` section 8.
- `capture.maxHeldTotal` is **1**. The original holds at most one captured fighter
  at a time, globally, and while one is held no capture attempt happens at all —
  which is why this is a rule and not just a cap. `slotsPerCaptor` stays 1: the
  four home slots are one per possible captor, not four simultaneous captives.
  `docs/reference/arcade-reference.md` section 7.
- The difficulty rows' sixth parameter is `beamStepFrames`, **not a capture rate**.
  It is the tractor beam's animation step period in frames, falling from 12 to 3
  across rank A, and the same countdown paces the beam's extension, its retraction
  and the pull-in — so a late beam extends and pulls four times faster rather than
  appearing more often. Reference section 6, parameter 6.

One narrower question is still open, and it is the one that decides what a
challenge stage's second wave contains: whether four of the forty are the two-hit
boss class (`docs/reference/arcade-reference.md` section 11, and
`stages/README.md`).

**The challenge stages here are authored on one reading of it and the stage
documents are written on the other, and that is a live disagreement, not a
settled question.** This pack's `challenge-*.json` make all forty slots single-hit
aliens of one score group, which is what the rules-and-scoring report recommends
and what makes a perfect first challenge stage pay **19,000** — the figure
`docs/DESIGN.md` section 11 states as an acceptance criterion. Reading the arcade
wave table literally instead gives four boss-class objects and **20,200**. Nothing
in this pack resolves it; it is with the captain. Whichever way it lands, the
engine rule is what has to be right, and which aliens a challenge stage holds is
one line of data here.
