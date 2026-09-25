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
  open. So there are three paths here, not thirteen, and the per-stage script
  table of reference section 5 lands with the stages in Milestone 2.

The coordinates are this pack's rendition of a shape the reference describes in
words; they are not measured from the original, and nothing here should be read
as a ROM value. Every file ends in `toSlot`, which is how a path stays free of
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

## Not here yet

- **Dive paths.** The bees' "wide, sweeping, diving arcs", the round swoop back
  up from behind and the bottom exit with re-entry at the top are all confirmed
  in reference section 5, but dives are Milestone 2 and none of the thirteen
  scripts' geometry is derivable from the reference as it stands.
- **Entry bombing.** Reference section 5 puts it in the script row's header byte
  and the per-stage difficulty table, not in the flight path, so no `fire`
  segment belongs in an entry path.

Preview any of these with `npm run dev` and `/lab` (`src/ui/lab/`).
