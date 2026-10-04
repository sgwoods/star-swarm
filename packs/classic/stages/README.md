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
adj -= 4`. So a stage number picks a script, several stage numbers pick the same
one, and which one they pick depends on the difficulty rank.

**`script-N.json` is combat script row N**, numbered from 0 as the reference numbers
them, whatever stage and whatever rank plays it. All thirteen are here, `script-0`
to `script-12`.

That is a rule chosen when the ranks landed, and it replaced the one these
documents were first written under — "named for the first stage that plays its
script row" — because that rule does not say _whose_ stage numbering wins, and every
answer to it is wrong somewhere. Rank A plays row 4 at stage 4 and rank D plays row 7
there, so both rows would want to be `stage-4`; row 2 is stage 6 under rank A and
stage 4 under rank B; and rank A never plays row 5 at all, so it has no stage to be
named for. A name taken from one rank's numbering reads, under the other three, as
the wrong stage playing. A row number is the one name all four ranks agree on, and
it reads straight across to the reference's table. The five documents written
before the ranks were renamed in the same pass, content untouched: `stage-1` is
`script-0`, `stage-2` is `script-1`, `stage-6` is `script-2`, `stage-5` is
`script-3` and `stage-4` is `script-4`.

The challenge documents keep their names. `challenge-1` … `challenge-8` are named
for the challenge stage that plays them, which is unambiguous because all four
ranks share one challenge cycle — and it is why they count from 1 while the script
rows count from 0: one is a stage ordinal, the other the reference's row number.

**Still never ship a copy.** Rank A plays row 4 at stages 4 and 8, so
`stageSequence.normal.rows` in `pack.json` names `script-4` twice. A second file
would be a copy of data the original shares, and two files that have to stay in
step — the same argument `../paths/README.md` makes for not shipping a
hand-mirrored twin of a path.

### What each rank plays

`pack.json`'s `stageSequence.normal` is **rank A's** seventeen entries: it is the
factory default, so its list is the pack-wide one and it states no override. Ranks
B, C and D each state their own seventeen in `../rules.json`, as
`difficulty.ranks.<id>.stageSequence.normal`, marked verified in its `provenance`.
A rank selects one whole list and never scales another; none of them overrides the
challenge half, which every rank shares. Reference section 5's per-stage table,
which these lists are:

| Stage | Rank A      | Rank B      | Rank C      | Rank D      |
| ----- | ----------- | ----------- | ----------- | ----------- |
| 1     | `script-0`  | `script-0`  | `script-0`  | `script-0`  |
| 2     | `script-1`  | `script-1`  | `script-1`  | `script-1`  |
| 4     | `script-4`  | `script-2`  | `script-4`  | `script-7`  |
| 5     | `script-3`  | `script-3`  | `script-6`  | `script-9`  |
| 6     | `script-2`  | `script-0`  | `script-5`  | `script-8`  |
| 8     | `script-4`  | `script-4`  | `script-7`  | `script-7`  |
| 9     | `script-6`  | `script-6`  | `script-9`  | `script-12` |
| 10    | `script-0`  | `script-5`  | `script-0`  | `script-11` |
| 12    | `script-7`  | `script-4`  | `script-7`  | `script-10` |
| 13    | `script-9`  | `script-6`  | `script-12` | `script-12` |
| 14    | `script-8`  | `script-0`  | `script-11` | `script-11` |
| 16    | `script-10` | `script-7`  | `script-10` | `script-10` |
| 17    | `script-12` | `script-9`  | `script-12` | `script-12` |
| 18    | `script-0`  | `script-8`  | `script-11` | `script-11` |
| 20    | `script-10` | `script-10` | `script-10` | `script-10` |
| 21    | `script-12` | `script-12` | `script-12` | `script-12` |
| 22    | `script-11` | `script-11` | `script-11` | `script-11` |

Stages 3, 7, 11 … are challenge stages and play `challenge-1` … `challenge-8` at
every rank. All four lists state `repeatLast: 3`, and that is the ROM's fold rather
than a choice: stages 24 onward cycle entries 14, 15 and 16, which is `script-10`,
`script-12`, `script-11` for ever at every rank.

`src/content/rules.ts`'s `normalStageOrdinal` is the index into those lists, and it
agrees with the ROM's own arithmetic: for a non-challenge stage it is
`stage − (stage >> 2) − 1`. `tests/unit/classic-content.test.ts` holds every entry
of the table above to `resolveStageId` at its rank, and walks every rank to stage
255 against the ROM's fold, because the rows line up only if both hold.

**A pack layered over this one does not inherit the ranks' lists.** They name these
documents, so a pack that states a normal half of its own supersedes them at every
rank (`composeRules` in `src/content/registry.ts`); without that, the Deep Sea game
would play its own stages on its default rank and Classic's on the other three.

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
at a time in one long row. Patterns 1 and 2 play on stages 1 and 2, the third
skipped, and then 1, 2, 3 on every set of three after the challenge stage — so a
normal stage _n_ from 4 on is pattern 1, 2 or 3 as `n mod 4` is 0, 1 or 2.

### Which pattern each row reads as

Put that order against the four ranks' lists above and it says more than it did
when five documents existed: **every row from 3 to 12 lands only on stages of one
pattern, under every rank that plays it.** Row 7 is played at stages 4, 8, 12 and
16 across the four ranks — pattern-1 stages, all of them. So for those rows the
reading is not a free choice; it follows from the table and [SW] together. It is
still an inference, not a ROM value, and it would be overturned by the flight-vector
programs if anyone decoded them.

| Row | Played at (rank: stages, through 22)                 | Pattern | Document    |
| --- | ---------------------------------------------------- | ------- | ----------- |
| 0   | all: 1 · A: 10, 18 · B: 6, 14 · C: 10                | 1 and 3 | `script-0`  |
| 1   | all: 2                                               | 2       | `script-1`  |
| 2   | A: 6 · B: 4                                          | 3 and 1 | `script-2`  |
| 3   | A, B: 5                                              | 2       | `script-3`  |
| 4   | A: 4, 8 · B: 8, 12 · C: 4                            | 1       | `script-4`  |
| 5   | B: 10 · C: 6                                         | 3       | `script-5`  |
| 6   | A: 9 · B: 9, 13 · C: 5                               | 2       | `script-6`  |
| 7   | A: 12 · B: 16 · C: 8, 12 · D: 4, 8                   | 1       | `script-7`  |
| 8   | A: 14 · B: 18 · D: 6                                 | 3       | `script-8`  |
| 9   | A: 13 · B: 17 · C: 9 · D: 5                          | 2       | `script-9`  |
| 10  | A, C: 16, 20 · B: 20 · D: 12, 16, 20                 | 1       | `script-10` |
| 11  | A, B: 22 · C: 14, 18, 22 · D: 10, 14, 18, 22         | 3       | `script-11` |
| 12  | A: 17, 21 · B: 21 · C: 13, 17, 21 · D: 9, 13, 17, 21 | 2       | `script-12` |

**Two rows disagree with the order, and the documents do not hide it.** Row 0 is
stage 1 at every rank — pattern 1, which [SW] states outright — and a pattern-3
stage everywhere else it plays. Row 2 is a pattern-3 stage under rank A and a
pattern-1 stage under rank B. One script cannot be two shapes, so either [SW]'s
order is a simplification or these two are among the "variations built over three
broad shapes" the reference describes; it cannot say which, and neither can this
pack. Both documents follow the stage that first plays them under **rank A**, the
factory setting [SW] describes: `script-0` reads as pattern 1, `script-2` as
pattern 3. So a player on rank A sees pattern 1 at stages 10 and 18 where the order
predicts pattern 3, and a player on rank B sees pattern 3 at stage 4.
`tests/unit/classic-content.test.ts` asserts that rows 0 and 2 are the only two,
so the claim cannot outlive a change to the table.

The rule for every document, then, is the pattern at the first stage that plays its
row under rank A, or — for row 5, which rank A never plays — under the first of B,
C and D, the ROM's own order, that does. For rows 3–12 every rank gives the same
answer, so the rule only decides rows 0 and 2.

### How a document reads as its pattern

| Document    | Reads as  | Waves 1 → 5, path and flags                                                              |
| ----------- | --------- | ---------------------------------------------------------------------------------------- |
| `script-0`  | pattern 1 | side-file both · wide-arc both · long-row file-L · long-row file-R · side-file both      |
| `script-1`  | pattern 2 | wide-arc twos-L · wide-arc twos-R · long-row file-L · long-row file-R · side-file both   |
| `script-2`  | pattern 3 | long-row file-L · long-row file-R · wide-arc twos-L · long-row file-L · side-file both   |
| `script-3`  | pattern 2 | wide-arc file-L · wide-arc file-R · long-row twos-L · wide-arc twos-L · side-file zip-L  |
| `script-4`  | pattern 1 | side-file both · wide-arc twos-L · long-row file-L · side-file both · wide-arc twos-R    |
| `script-5`  | pattern 3 | long-row file-L · long-row file-R · long-row twos-L · wide-arc file-L · side-file both-R |
| `script-6`  | pattern 2 | wide-arc twos-L · wide-arc file-R · long-row file-L · side-file both · wide-arc twos-R   |
| `script-7`  | pattern 1 | side-file both · side-file both-R · wide-arc twos-L · long-row file-R · side-file zip-L  |
| `script-8`  | pattern 3 | long-row file-L · long-row file-R · long-row file-L · wide-arc twos-R · side-file both-R |
| `script-9`  | pattern 2 | wide-arc file-L · wide-arc twos-R · side-file both · long-row file-R · wide-arc twos-L   |
| `script-10` | pattern 1 | side-file both · wide-arc both · side-file both-R · long-row twos-L · side-file zip-R    |
| `script-11` | pattern 3 | long-row file-L · long-row file-R · long-row zip-R · wide-arc twos-R · side-file zip-L   |
| `script-12` | pattern 2 | wide-arc twos-L · wide-arc twos-R · wide-arc file-L · side-file zip-L · long-row file-R  |

The paths are the three in `../paths/` and nothing else — the reference describes
three shapes, so there are three entry paths, not thirteen. The pattern is carried
by the **opening**: pattern 1 opens with both sides at once on the side-file path,
pattern 2 one side at a time on the wide arc, pattern 3 one side at a time on the
long row, and patterns 2 and 3 open from the left. `tests/unit/classic-content.test.ts`
holds every document to its row's opening. The flags carry the rest, and they are
what make two documents flying the same paths in the same order still read
differently — `script-5`, `script-8` and `script-11` share a path list and no wave of
flags:

- **both** is `mirror` alternating within each pair with `trailing` clear, so the
  pair launches on one frame, one half-path each side; **both-R** puts the first of
  each pair on the right.
- **file-L** and **file-R** are `trailing` on the second of every pair, so the wave
  is one long file, with `mirror` all clear (from the left) or all set (from the
  right).
- **twos-L** and **twos-R** are the same file with `mirror` running `false false
true true` (or the reverse), so it arrives as files of two that alternate side.
- **zip-L** and **zip-R** trail the second of each pair _and_ flip its side, so the
  file alternates side one ship at a time.

One hard constraint, and `tests/unit/classic-content.test.ts` enforces it: **a
simultaneous pair must differ in `mirror`.** One path plus a reflection cannot put
two aliens abreast in the same lane, so two same-handed slots launching on the same
frame would fly as a single sprite.

### What the eight later documents hold to

`script-5` … `script-12` were written after the first five and take them as the
model, in three ways that are easy to drift from:

- **Timings stay inside the first five's envelope** — waves 140 to 195 frames
  apart, launches 9 to 14 frames apart, the fifth wave out by frame 700 — and
  nothing grows harder with the row number. The reference gives no timing for any
  script, so a later row that entered faster or denser would be a difficulty claim
  with nothing behind it; difficulty lives in the rank tables.
- **Every one settles on frame 1,023**, as the first five do, so the dives begin on
  the same beat whatever script played. `script-6` first settled a whole sway cycle
  later, at 1,279, and its last wave was brought forward until it did not.
- **An idle fighter loses no more than the first five cost it.** The left-hand
  long-row lane crosses the fighter's home column, so a fighter that never moves is
  rammed during the entry — once or twice on the first five. `script-11`'s first
  draft sent three left-handed long rows and rammed it three times, which is game
  over before the fifth wave launched, and it was re-choreographed to two.
  `tests/sim/stage-entry.test.ts` flies every document with the controls untouched,
  which is how that surfaced.

## Difficulty is not here

Per-stage difficulty is resolved from `rules.json`'s rank tables by stage number —
`launchRates`, `maxDivers` and its bump, `captureRate`, the capture-beam period,
`continuousBombingAt` — and none of it is copied into a stage document. The two
tables also fold at different stages (23 for the entry scripts, 27 for the
difficulty rows), which is precisely why neither may be derived from the other.
No document here sets `modifiers` or `diveRules`.

The ranks' script lists sit in the same rank objects, and they say which document
plays — never how hard it plays. A row is the same forty enemies on the same paths
at every rank and every stage it is played at; what changes between rank A's stage
4 and rank D's is the difficulty row in force while it flies.

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

- **The script row's entry-bombing byte.** Reference section 5 puts it in the 17-byte
  script row's header: `$00` for script row 0, `$01` for most rows, `$03` for rows
  11–13. That last range is the reference's own wording; with thirteen rows numbered
  from 0 there is no row 13, so it is presumably counted from 1 — `script-10` to
  `script-12` here, which are also the three the ROM's fold cycles — but the
  reference does not say. The dive task models entry bombing per _stage_ instead, as
  `rules.enemies.bombing.entryFromStage` — 2, so nothing bombs on the way in on
  stage 1 and everything may from stage 2. The two do not say the same thing: script
  row 0 is the one with a `$00` header, and it also plays as stages 10 and 18 under
  rank A and as 6 and 14 under rank B, where the per-stage rule allows entry
  bombing. Reproducing the original exactly would need the byte to travel with the
  script, which is this document. `stageSchema` has no field for it, and inventing
  one would widen the platform contract for a value only the enemy-fire task can
  consume, so it is recorded here rather than added. (The difficulty row's
  `bombEnable` is a third, separate selector; `AGENTS.md` notes that nothing reads
  it, because the reference records the selector but not what it selects.)

## One hazard a stage author should know about

Changing a stage document re-records every golden that reaches it. A golden that
flies **curved** geometry used to carry a second hazard: `Math.sin`, `Math.cos` and
`Math.atan2` are engine-defined and land one ULP apart between CPU architectures,
and re-recording `stage-dives` here once produced a final state one ULP from the one
CI computed — a single dead enemy's frozen x, every other value in a 43-enemy
fingerprint identical. The simulation now takes its trigonometry from the tables in
`src/engine/trig.ts` and is bit-identical across machines, so `fingerprintWorld`
compares every number exactly and a golden recorded on one machine replays to the
byte on another. The practical advice is short: **re-record deliberately, let CI
check it, and never bend stage data to preserve an old recording.**

**Renaming a document redraws its playability sample.** `scripts/playability.ts`
seeds every flight from the variant and the document id, so a rename with no change
to the content is still sixteen fresh seeds of every persona's luck. That is not a
reason to keep a misleading name, but it is a reason to read a verdict that changed
across a rename as a change of sample rather than of stage.

## Previewing

`/lab` (`src/ui/lab/`) previews the **paths** a stage names, not the stage itself;
a stage previewer is Milestone 4 (`src/ui/lab/README.md`). To watch a stage as
authored, `tests/sim/stage-entry.test.ts` flies each one headless.
