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
  of reference section 5 is now wired up as far as stage 8; `../stages/README.md`
  says which document plays when, and which shape each one reads as.

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

## Dive paths

Dive attacks are the Milestone 2 dive task. One per role, plus one for the
transform group and one shared return leg.

| File                  | Shape (reference sections 5 and 6)                          |
| --------------------- | ----------------------------------------------------------- |
| `dive-drone.json`     | the bees' wide sweeping arc, a loop, and out of the bottom  |
| `dive-wing.json`      | the butterflies' faster arc dive, swinging away at the end  |
| `dive-warden.json`    | the captor's slow, weaving descent — the one you shoot at   |
| `dive-transform.json` | the trio: arc, two scripted shots, one final loop, and gone |
| `dive-return.json`    | re-entry at the top, then `toSlot` and nothing else         |

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

`dive-transform.json` is the only file here with `fire` segments, and
deliberately so: the trio "fires on the way down" is a scripted moment in its
dive, where the roles' bombing is a timer the difficulty row governs. Entry
bombing likewise belongs to the row and not to a path, so no `fire` segment
appears in an entry path.

The geometry is this pack's rendition of shapes the reference describes in words.
None of the thirteen ROM scripts' actual flight-vector programs are derivable
from the reference as it stands, so nothing here should be read as a ROM value.

Preview any of these with `npm run dev` and `/lab` (`src/ui/lab/`).
