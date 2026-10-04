# `packs/classic/paths/`

Movement paths for the Classic pack, interpreted by `src/sim/paths.ts`
(`docs/DESIGN.md` section 7.2). The schema is strict and has no comment field,
so the reasoning for each file lives here.

## What is authored, and what is not

`docs/reference/arcade-reference.md` section 5 is the record for entry
choreography, and it draws a sharp line:

- **Confirmed**: entry is five scripted waves of eight flying **curved paths**
  and then settling into formation slots; `mirror` is a per-bug flag, so a wave
  flies one authored path and reflects half of it; `trailing` is a per-pair flag
  that delays the second of a pair into single file.
- **High confidence**: players perceive **three broad shapes**, recurring on a
  four-stage period. One file here per shape.
- **Not derived**: which of the ROM's **thirteen** combat scripts is which shape,
  and the choreography inside any of them. That needs the `db_2A3C` →
  `db_2A6C` flight-vector programs decoded, which the reference says it did not
  open. So there are three entry paths here, not thirteen. The per-stage script table
  of reference section 5 is wired up in full, all thirteen rows at all four ranks;
  `../stages/README.md` says which document plays when, and which shape each one
  reads as.

The coordinates are this pack's rendition of a shape the reference describes in
words; they are not measured from the original, and nothing here should be read
as a ROM value. Every entry path ends in `toSlot`, which is how it stays free of
the formation's pixel grid — `pack.json` states slots as logical `(row, column)`
precisely because their spacing is unconfirmed.

| File                   | Shape (reference section 5, "The three shapes players perceive") |
| ---------------------- | ---------------------------------------------------------------- |
| `entry-side-file.json` | 1 — from both sides at once, single file in short rows           |
| `entry-wide-arc.json`  | 2 — from one side at a time in double-width rows                 |
| `entry-long-row.json`  | 3 — from one side at a time in a single long row                 |

All three are authored as the **left-hand** variant and carry `"mirror": true`;
the right-hand half of a wave is the same data evaluated with the slot's
`mirror` flag set, never a second file. Shape 1 is the one that needs both
halves at once — that is what makes it the only pattern entering from both
sides.

One consequence for anyone authoring a stage: each file is a **single lane**, so
two aliens can only fly abreast by taking opposite halves of it. Shape 2's
"double-width rows" is therefore rendered as files of two that alternate side
rather than as two ships side by side on one lane, which would be one sprite. A
literal double-width row needs a second, inboard path, and its geometry would be
as unsourced as these three — so it is not here. `../stages/README.md` has the
flag patterns the three shapes are actually built from.

## The challenge-stage scripts

`challenge-*.json` are a different kind of path and obey the opposite contract:
they **never** end in `toSlot`, because nothing settles into formation on a
challenge stage. A flyer whose script runs out without having addressed a slot
leaves the field — reported as a departure, not a kill, exactly as a diver that
does not come back is (`src/sim/enemies.ts`) — which is what ends a
challenge stage and what costs a player the perfect bonus.

Each one enters from off screen, curves onto a column, falls down it and exits by
the bottom. The falling stretch is the point: reference section 8 records that
the first two challenge stages are clearable **without moving, from the exact
centre**, and a convoy that merely _crosses_ the fighter's column is not — a
shot fired at the wrong moment sails past and the 2-shot cap means the next one
is ~20 frames away. A convoy that _descends_ the column stays hittable for as
long as it takes, which is what makes the acceptance test pass by construction
rather than by luck. The explicit vertical `line` before `exitBottom` is there
for the same reason: `exitBottom` keeps the heading it is handed when the bottom
is the nearest edge along it, so the segment before it has to be pointing
straight down or the fall drifts out of the column.

| File                              | Column            | Used by                  |
| --------------------------------- | ----------------- | ------------------------ |
| `challenge-fall-centre.json`      | the fighter's own | `challenge-1`, `-2`, …   |
| `challenge-weave-centre.json`     | the fighter's own | a gentle weave inside it |
| `challenge-cross-centre.json`     | the fighter's own | crosses the screen first |
| `challenge-fall-inner-left.json`  | x 64              | `challenge-3` … `-8`     |
| `challenge-fall-outer-left.json`  | x 24              | `challenge-3` … `-8`     |
| `challenge-fall-inner-right.json` | x 143             | `challenge-3` … `-8`     |
| `challenge-fall-outer-right.json` | x 183             | `challenge-3` … `-8`     |

**None of them declares `mirror`, and that is deliberate.** Mirroring reflects
about the playfield's vertical centre line — x 112 for a sprite anchor — but the
fighter's home column is **x 103**, because the ROM's travel limits (0…207) are
not symmetric. The mirror of a path that passes over the fighter therefore misses
it by 9 px, against a shot window only ±5 px wide. So a challenge script cannot
be a mirrored pair with its own opposite, and the left- and right-hand ones are
authored as genuinely different shapes rather than as hand-mirrored twins. The
entry paths above are unaffected: they end in `toSlot`, and a slot mirrors to
another slot.

The geometry is ours. Reference section 8 confirms the structure — eight scripts,
cycling every eight challenge stages, forty enemies in five groups of eight that
never drop bombs — and explicitly does not give the flight vectors.

## Dive paths

Dive attacks are the Milestone 2 dive task. One per role, plus one for the
transform group and one shared return leg.

| File                  | Shape (reference sections 5 and 6)                                              |
| --------------------- | ------------------------------------------------------------------------------- |
| `dive-drone.json`     | the bees' wide sweeping arc, a loop, and out of the bottom                      |
| `dive-wing.json`      | the butterflies' faster arc dive, swinging away at the end                      |
| `dive-warden.json`    | the captor's slow, weaving descent — the one you shoot at                       |
| `dive-transform.json` | the trio: arc, two scripted shots, one final loop, and gone                     |
| `dive-capture.json`   | the captor's capture run: one loop, a slide to beam position, the beam, and out |
| `dive-captive.json`   | the captured fighter's swoop, beside its captor or as a rogue                   |
| `dive-return.json`    | re-entry at the top, then `toSlot` and nothing else                             |

Three things about their shape are not free choices:

- **A dive path states no `start` and uses no `line` or `bezier`.** It is flown
  from wherever the enemy already sits, so every segment has to be relative to
  the flyer's pose: `arc`, `loop`, `sine`, `aimAtPlayer`, `exitBottom`. A dive
  authored with absolute targets would drag all forty enemies through the same
  piece of screen whatever slot they left.
- **The outward sweep is `mirror`, not a second file**, exactly as the entry
  paths are: `src/sim/dive.ts` mirrors the dive of any enemy in the right-hand
  half of the formation, so one authored path fans both ways. The radii were
  chosen so that the widest case — the outermost column sweeping outwards —
  stays on screen; `tests/unit/classic-paths.test.ts` is what holds that.
- **Every dive ends in `exitBottom`.** Confirmed behaviour: divers leave the
  bottom and re-enter at the top (reference section 5). Whether an alien comes
  back is its own `dive.returns` flag — the transform trio's is `false`, which is
  the one confirmed exception.

`dive-capture.json` is the only file here with a `trigger` segment, and it is
what opens the tractor beam (`src/sim/abilities/capture-beam.ts`). That is deliberate: **where
in the dive the beam comes out is authored here**, not a depth threshold in the
engine. The original's captor "loops just once at the top of the formation,
slides down to roughly mid-screen, then emits the beam"
(`docs/reference/arcade-reference.md` section 7) — and the reference is explicit
that its two accounts of the descent depth disagree, so the `aimAtPlayer`
duration is tuned by eye to land the captor below the formation with the beam
still able to reach the fighter's row. Change that duration and
`capture.beam.catchWindow`'s reach in `rules.json` has to move with it, or a beam
opens too high to catch anything.

`dive-transform.json` is the only file here with `fire` segments, and
deliberately so: the trio "fires on the way down" is a scripted moment in its
dive, where the roles' bombing is a timer the difficulty row governs. Entry
bombing likewise belongs to the row and not to a path, so no `fire` segment
appears in an entry path.

The geometry is this pack's rendition of shapes the reference describes in words.
None of the thirteen ROM scripts' actual flight-vector programs are derivable
from the reference as it stands, so nothing here should be read as a ROM value.

Preview any of these with `npm run dev` and `/lab` (`src/ui/lab/`).
