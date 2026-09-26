# `packs/classic/stages/`

One stage document per **entry script**, interpreted by `src/sim/enemies.ts` through
`src/content/stages.ts` (`docs/DESIGN.md` section 7.3). The schema is strict and has
no comment field, so — as in `../paths/README.md` — the reasoning and the citation
for each file live here.

`docs/reference/arcade-reference.md` section 5 is the record for all of it.

## A document is a script row, not a stage

The original stores entry choreography as a **script library** plus a per-rank index
list: 13 combat script rows, 8 challenge rows, selected by
`d_combat_stg_dat_idx[rank][adj − (adj >> 2) − 1]` after folding `while (adj >= 23)
adj -= 4`. So a stage number picks a script, and several stage numbers pick the same
one. Reference section 5's per-stage table, rank A, as far as this pack authors it:

| Stage | Script row  | Document               |
| ----- | ----------- | ---------------------- |
| 1     | 0           | `stage-1`              |
| 2     | 1           | `stage-2`              |
| 3     | challenge 0 | — (see _Not here yet_) |
| 4     | 4           | `stage-4`              |
| 5     | 3           | `stage-5`              |
| 6     | 2           | `stage-6`              |
| 7     | challenge 1 | —                      |
| 8     | 4           | `stage-4`              |

Each document is named for the **first stage that plays its script row**, which is
why there is no `stage-8.json`: stage 8 is script row 4, the same row as stage 4, so
it plays `stage-4`. `stageSequence.normal.rows` in `pack.json` names it twice. A
`stage-8.json` would be a copy of data the original shares, and two files that have
to stay in step — the same argument `../paths/README.md` makes for not shipping a
hand-mirrored twin of a path.

`src/content/rules.ts`'s `normalStageOrdinal` is the index into those rows, and it
agrees with the ROM's own arithmetic: for a non-challenge stage it is
`stage − (stage >> 2) − 1`. `tests/unit/classic-content.test.ts` asserts that for
every stage in the table above, because the rows line up only if it holds.

## Composition is verified, and it is the same on every stage

`c_25A2` resets the wave-ID pointer to the top of `db_attk_wav_IDs` at **every**
stage, so the forty objects and the order they are grouped into five waves of eight
are identical on all of them — normal and challenge alike. Only the choreography is
per-stage. Every document here therefore carries the same forty `(alien, home)`
pairs in the same order, and `tests/unit/classic-content.test.ts` checks that across
all of them rather than in stage 1 alone.

The object ids decode to formation slot indices by class, from the three allocations
in `c_2896`:

| Arcade class     | Object ids  | Role     | Slot index            |
| ---------------- | ----------- | -------- | --------------------- |
| boss             | `$30`–`$36` | `warden` | `(id − $30) / 2`      |
| butterfly (moth) | `$40`–`$5E` | `wing`   | `4 + (id − $40) / 2`  |
| bee              | `$08`–`$2E` | `drone`  | `20 + (id − $08) / 2` |

which gives the five waves, decoded. This table is the thing to check a document
against:

| Wave | `db_attk_wav_IDs` row     | Roles             | `home` indices, in order |
| ---- | ------------------------- | ----------------- | ------------------------ |
| 1    | `58 5A 5C 5E 28 2A 2C 2E` | 4 wing + 4 drone  | 16 17 18 19 36 37 38 39  |
| 2    | `30 34 36 32 50 52 54 56` | 4 warden + 4 wing | 0 2 3 1 12 13 14 15      |
| 3    | `42 46 40 44 4A 4E 48 4C` | 8 wing            | 5 7 4 6 9 11 8 10        |
| 4    | `1A 1E 20 24 22 26 18 1C` | 8 drone           | 29 31 32 34 33 35 28 30  |
| 5    | `08 0C 12 16 10 14 0A 0E` | 8 drone           | 20 22 25 27 24 26 21 23  |

All four wardens arrive together in wave 2, and the ROM's own order pairs them
`(0, 2)` then `(3, 1)` — the left half of the top row, then the right half.

## Choreography is ours

Which path each wave flies, the `mirror` and `trailing` flags and the wave timings
are **not** derived. Reference section 5 says so explicitly: the mapping from each
of the thirteen script rows to one of the three shapes a player perceives needs the
`db_2A3C` → `db_2A6C` flight-vector programs decoded, and it did not open them.
Nothing below should be read as a ROM value.

What the reference does give is the three shapes and their order ([SW]
_Walkthrough_, "Entrance patterns", high confidence): both sides at once in short
files; one side at a time in double-width rows, first group from the left; one side
at a time in one long row. Each stage here is built so the shape a player would name
for it is the one that order puts there — patterns 1 and 2 for stages 1 and 2 with
the third skipped, then 1, 2, 3 from stage 4:

| Document  | Reads as  | Wave paths, 1 → 5                                  |
| --------- | --------- | -------------------------------------------------- |
| `stage-1` | pattern 1 | side-file, wide-arc, long-row, long-row, side-file |
| `stage-2` | pattern 2 | wide-arc, wide-arc, long-row, long-row, side-file  |
| `stage-4` | pattern 1 | side-file, wide-arc, long-row, side-file, wide-arc |
| `stage-5` | pattern 2 | wide-arc, wide-arc, long-row, wide-arc, side-file  |
| `stage-6` | pattern 3 | long-row, long-row, wide-arc, long-row, side-file  |

The flags carry the rest of the reading, and they are what makes two stages flying
the same paths still look different:

- **Both sides at once** is `mirror` alternating within each pair with `trailing`
  clear, so the pair launches on one frame, one half-path each side.
- **One side at a time** is `trailing` on the second of every pair, so the wave is a
  file; `mirror` then says which side each pair of the file comes from — all clear
  for a long row from the left, all set for one from the right, `false false true
true` repeating for files of two that alternate.

One hard constraint, and `tests/unit/classic-content.test.ts` enforces it: **a
simultaneous pair must differ in `mirror`.** One path plus a reflection cannot put
two aliens abreast in the same lane, so two same-handed slots launching on the same
frame would fly as a single sprite.

## Difficulty is not here

Per-stage difficulty is resolved from `rules.json`'s rank tables by stage number —
`launchRates`, `maxDivers` and its bump, `captureRate`, the capture-beam period,
`continuousBombingAt` — and none of it is copied into a stage document. The two
tables also fold at different stages (23 for the entry scripts, 27 for the
difficulty rows), which is precisely why neither may be derived from the other.
No document here sets `modifiers` or `diveRules`.

## The challenge stages, and the number still in dispute

`challenge-1.json` … `challenge-8.json` sit beside these, and the second reason
they were not here has gone: their waves fly `../paths/challenge-*.json`, which
fly through and leave rather than ending in `toSlot`, so `stageSequence.challenge`
is filled and `createStageSource`'s bridge is removed. What plays at each stage
number is asserted end to end in `tests/unit/classic-content.test.ts`.

**The first reason is still open, and it is a live disagreement about a number.**
Reference section 11 asks whether challenge-stage wave 2 keeps the four
boss-class objects. `db_attk_wav_IDs` read literally says it does, which makes a
perfect first challenge stage worth **20,200**. The rules-and-scoring report
recommends authoring all forty slots as single-hit aliens of one score group
instead, which makes it **19,000** — and 19,000 is what `docs/DESIGN.md`
section 11 states as an acceptance criterion and what `rules.json`'s `scoring`
and the challenge documents here are built to. Both readings are written down;
neither is settled here. It is with the captain, and whichever way it lands the
engine rule is unaffected — only which aliens wave 2 names, which is one line per
document.

## Not here yet, and why

- **Stages 9 and up**, which need script rows 6 to 12 — seven more documents whose
  choreography is entirely ours.
- **The per-rank sequences.** Reference section 5 gives all four ranks' index lists,
  and they cannot land yet for a reason worth recording: through stage 8 alone, rank
  C plays script rows 5, 6 and 7 and rank D plays 7, 8 and 9, so four ranks need ten
  of the thirteen documents. Worse, naming a document for the first stage that plays
  it stops working across ranks — rank A plays script 4 at stage 4 and rank D plays
  script 7 there, so both would want to be `stage-4`, and script 5 never appears
  under rank A at all. Whoever lands the remaining scripts should rename these
  documents for their script rows in the same pass; the ids are pack data and
  nothing in `src/` reads one.
- **The script row's entry-bombing byte.** Reference section 5 puts it in the 17-byte
  script row's header: `$00` for script row 0, `$01` for most rows, `$03` for rows
  11–13. The dive task models entry bombing per _stage_ instead, as
  `rules.enemies.bombing.entryFromStage` — 2, so nothing bombs on the way in on
  stage 1 and everything may from stage 2. The two do not say the same thing: script
  row 0 is the one with a `$00` header, and it also plays as stages 10 and 18, where
  the per-stage rule allows entry bombing. Reproducing the original exactly would
  need the byte to travel with the script, which is this document. `stageSchema` has
  no field for it, and inventing one would widen the platform contract for a value
  only the enemy-fire task can consume, so it is recorded here rather than added.
  (The difficulty row's `bombEnable` is a third, separate selector; `AGENTS.md`
  notes that nothing reads it, because the reference records the selector but not
  what it selects.)

## One hazard a stage author should know about

Changing a stage document re-records every golden that reaches it, and a golden
that flies **curved** geometry used not to reproduce on another machine.
`src/sim/paths.ts` records that `Math.sin`, `Math.cos` and `Math.atan2` are
engine-defined; they also land one ULP apart between CPU architectures. Re-recording
`stage-dives` here once produced a final state one ULP from the one CI computed — a
single dead enemy's frozen x, every other value in a 43-enemy fingerprint identical.
Entry paths were never exposed, because a bezier is only multiplies and adds; dive
paths are, because they are sampled with trig.

`fingerprintWorld` now rounds every number it compares to six decimal places, which
puts that noise well inside the mesh while staying far below anything drawable. So
the practical advice is short: **re-record deliberately, let CI check it, and never
bend stage data to preserve an old recording.** The deeper question — whether the
simulation itself is bit-identical across machines — is still open; the rounding
makes it irrelevant to the test suite rather than answering it. `AGENTS.md` has the
numbers.

## Previewing

`/lab` (`src/ui/lab/`) previews the **paths** a stage names, not the stage itself;
a stage previewer is Milestone 4 (`src/ui/lab/README.md`). To watch a stage as
authored, `tests/sim/stage-entry.test.ts` flies each one headless.
