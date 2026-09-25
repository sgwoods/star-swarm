# `packs/classic/`

The arcade-faithful pack. At Milestone 1 it is a skeleton: the manifest, the
formation and the rules are here; aliens, paths, stages, sprites and sounds land
with the sibling Milestone 1 and 2 tasks.

## Roles

`docs/DESIGN.md` section 2 requires original naming, so the three enemy roles are
this project's own. For anyone checking a number against
`docs/reference/arcade-reference.md`, they map to the arcade roles as:

| Role id  | Arcade role    | Formation                          |
| -------- | -------------- | ---------------------------------- |
| `drone`  | bee role       | two rows of 10, columns 0, 2 … 18  |
| `wing`   | butterfly role | two rows of 8, columns 2, 4 … 16   |
| `warden` | boss role      | top row of 4, columns 6, 8, 10, 12 |

## What is already populated

- **`pack.json`** — the 40-slot `classic40` formation and its four captive slots
  (one per `warden`, one row above it). Slots are logical `(row, column)`; the
  pixel grid is deliberately absent, because the column positions are confirmed
  and their spacing is not.
- **`rules.json`** — all four difficulty ranks as 26 literal rows each, from
  `docs/reference/arcade-reference.md` section 6, plus the shot caps, extra-life
  settings, challenge cadence, capture rules and scoring rules from sections 3,
  7, 8 and 9.

`tests/unit/classic-pack.test.ts` checks these against the reference, so the
plan, the reference and the data are three legs of the same stool: change one
and the test says so.

## What is deliberately empty

- The five content directories. Siblings fill them.
- `stageSequence.normal.rows` and `.challenge.rows`. Their `repeatLast` values —
  3 and 8 — are already stated, because the two sequences plateau on _different_
  periods and that is easy to lose. The per-rank sequences of reference section 5
  land with the stages in Milestone 2, as each rank's `stageSequence.normal`.
- `transform.types`. Three alien ids, cycling on a four-stage period; the bonus
  they earn (1,000 / 2,000 / 3,000) is already in `scoring.transformGroupBonus`.

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

One narrower question is still open and does not touch this pack's data: see
`docs/reference/arcade-reference.md` section 11.
