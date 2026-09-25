# Arcade reference — the 1981 Namco formation shooter

## What this document is, and how much to trust it

This is Star Swarm's verification record for the arcade original. `docs/DESIGN.md` section 4
specifies the arcade-faithful core, and the values there were originally written from memory. This
document is where each of those values was checked against sources, and it is the citation trail
behind the numbers the design plan now carries. For each claim it records what the evidence supports,
how confident the reader should be, and where to check it.

Keep the two in step: if a number in `docs/DESIGN.md` section 4 changes, the change belongs here too,
with its source.

The subject is **Galaga**, the 1981 Namco formation shooter licensed to Midway in North America. That
name, and the original's own enemy names, appear here only so the sources can be checked; the shipped
product uses original naming, art and audio as `docs/DESIGN.md` section 2 requires.

**How much to trust this.** Most of it is solid. The great majority of the numbers below come from two
kinds of source that leave little room for error: the original Midway operator and service manual, and
a reconstructed assembly source for the original ROM that assembles to a byte-exact image of the
machine code. Where a value is quoted from the ROM, the routine or data table is named, so any figure
can be re-derived. A second pass closed the four items this document originally left unresolved — the formation
sway/breathe amplitude and period, per-hit scoring on challenge stages, whether more than one captured
fighter can be held at once, and the mapping from the starfield speed byte to a visible scroll rate —
and their findings are folded into the sections below. **One** narrower question is _not_ settled: it is
flagged inline and is the single entry in section 11.

Two findings matter more than any single number, because they change the _shape_ of the configuration
data rather than its contents:

- The difficulty ramp is **not** a curve. It is a 26-stage × 4-rank table of ten small integers per
  stage, it is not monotonic, and it plateaus by cycling its last four rows forever. See section 6.
- Entry waves are **not** three patterns. There are thirteen distinct combat wave scripts selected per
  stage through a seventeen-entry per-rank sequence, and eight challenge scripts on their own cycle.
  Waves mix enemy types within a single wave. See section 5.

Both are called out again in section 12, alongside ten further findings that affect the build.

---

## 1. Sources

Referred to below by the bracketed tag.

| Tag          | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Standing                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[MANUAL]** | Midway Mfg. Co., _Galaga Parts and Operating Manual_, Game Nos. 508, 514 & 510, Form No. 0508-00300-0000, October 1981. Scanned at Internet Archive item `arcademanual_Galaga`; OCR text `https://archive.org/download/arcademanual_Galaga/Galaga_djvu.txt`. Retrieved 2026-09-24. Line numbers below refer to that OCR text.                                                                                                                                                                                                         | Primary. Manufacturer documentation.                                                                                                                                                                     |
| **[ASM]**    | G. Neidermeier, reconstructed Galaga assembly source, `https://github.com/neiderm/arcade`, path `galag/galagao_ASxxx/rom0/`. An ASxxx project whose stated purpose is to assemble to an exact image of the original machine code. Files cited: `new_stage.s`, `game_ctrl.s`, `gg1-3.s`, `gg1-4.s`, `gg1-5.s`, `task_man.s`. Retrieved 2026-09-24.                                                                                                                                                                                     | Primary-grade. Disassembly validated by reassembly to the original bytes. Symbol names and comments are the author's interpretation and are occasionally wrong; the instructions and data bytes are not. |
| **[LIST]**   | `https://github.com/moshix/galaga`, `reference/galaga-main.asm` and `reference/galaga-sub.asm` — generated byte-level listings of the rev. B **main** and **sub** CPU ROMs, annotated with the [ASM] names and marking bytes that have no counterpart in that source. Retrieved 2026-09-25. Cited where a routine's bytes sit outside the `galagao` source. The game runs two Z80s over shared RAM and the two listings are different address spaces, so citations below name the CPU: "[LIST] main `$1C07`" or "[LIST] sub `$0808`". | Primary-grade for the byte values; annotations secondary.                                                                                                                                                |
| **[MAME]**   | MAME source `src/mame/namco/galaga.cpp`, mamedev/mame master branch, `https://raw.githubusercontent.com/mamedev/mame/master/src/mame/namco/galaga.cpp`. Retrieved 2026-09-24.                                                                                                                                                                                                                                                                                                                                                         | High-quality secondary. Long-standing hardware reference with in-file PCB notes.                                                                                                                         |
| **[CA]**     | T. Cantrell, "Galaga No-fire Cheat", Computer Archeology, `https://github.com/topherCantrell/computerarcheology/blob/master/content/Arcade/Galaga/README.md` (rendered at computerarcheology.com). A published code-level investigation; an edited version appeared in _Circuit Cellar_ issue 184, November 2005. Retrieved 2026-09-24.                                                                                                                                                                                               | High-quality secondary. Conclusions are drawn from ROM patching and observation.                                                                                                                         |
| **[SW]**     | StrategyWiki, _Galaga/Gameplay_ and _Galaga/Walkthrough_, `https://strategywiki.org/wiki/Galaga/Gameplay`, `https://strategywiki.org/wiki/Galaga/Walkthrough`. Retrieved 2026-09-24.                                                                                                                                                                                                                                                                                                                                                  | Secondary, long-standing and unusually detailed for this title. Used for player-observable behaviour and as a cross-check; not relied on alone for a number where a ROM or manual figure exists.         |
| **[05XX]**   | R. Hildinger, "Starfield generator documentation … based on RE effort Aug. 2019" — the header comment block of MAME's `src/mame/namco/starfield_05xx.cpp`, lines 1–140. A pin-level reverse engineering of a physical Namco 05XX taken from an original 1981 board. Retrieved 2026-09-25.                                                                                                                                                                                                                                             | **Primary-grade for the chip's behaviour**: a direct measurement of the hardware, published in MAME's tree.                                                                                              |
| **[AQM]**    | Arcade Quartermaster, "Galaga — Stages & Bosses", `https://www.arcadequartermaster.com/galaga_bosses.html`. Retrieved 2026-09-24.                                                                                                                                                                                                                                                                                                                                                                                                     | Secondary. Used only as corroboration.                                                                                                                                                                   |

Character encoding used when quoting ROM text tables: `$00`–`$09` are the digits `0`–`9`, `$0A`–`$23`
are `A`–`Z`, `$24` is a space.

---

## 2. Screen and timing

| Claim                  | Design plan says                                  | Verified value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Confidence | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logical playfield      | 224×288 portrait                                  | **224 wide × 288 tall.** Correct.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Confirmed  | [MAME] `galaga.cpp:1508`, `m_screen->set_raw(MASTER_CLOCK/3, 384, 0, 288, 264, 0, 224)` — a 288×224 raster with 288 visible across and 224 down — combined with `ROT90` in the driver's `GAME(...)` line (`galaga.cpp:2697`), which rotates it to 224 across × 288 down.                                                                                                                                                                                                                                       |
| Simulation rate        | 60 fps                                            | **60.6061 Hz.** `MASTER_CLOCK` is 18.432 MHz (`galaga.cpp:706`); the pixel clock is `MASTER_CLOCK/3` = 6.144 MHz; 6 144 000 / (384 × 264) = 60.60606 Hz.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Confirmed  | [MAME] `galaga.cpp:706`, `:1508`, and the in-file PCB note `VSync : 60.606060Hz` at `galaga.cpp:1968`.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Per-frame task cadence | implied uniform per-frame update                  | **Not uniform.** The task that advances enemy object state is a four-frame round robin: it uses the low two bits of the frame counter as a state variable, updates half the objects on one odd frame and half on the next, and updates the active-object count on an even frame — so one full cycle completes at **15 Hz**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Confirmed  | [ASM] `gg1-3.s`, header comment on `f_23DD` (“normally this is a periodic task called 60Hz … 1 cycle of this task is completed over four successive frames, i.e. the cycle is repeated at a rate of 15Hz”) and the implementation `c_23E0` immediately below it.                                                                                                                                                                                                                                               |
| Starfield              | “pauses/changes speed during certain transitions” | The scroll speed is also **a function of stage number**, and the byte converts to a visible rate as **pixels per frame = byte / 64**. At the start of every stage the ROM computes `star_ctrl[2] = $40 + ((min(stage, 16) × 4) AND $70)` — five discrete values `$40, $50, $60, $70, $80` stepping every four stages and plateauing from stage 16. `f_1D76` ([LIST] main `$1D7C`) then ramps a _current_ speed byte toward that target one unit per frame, adds it into a 6-bit phase accumulator, and writes the accumulator's overflow (0–3) to the chip as `7 − overflow`; the 05XX's measured X-scroll table makes code 7 stationary and codes 6/5/4 equal 1/2/3 px per frame forward, so the pixels scrolled per frame _are_ the overflow. Result: **1.00, 1.25, 1.50, 1.75, 2.00 px/frame** for stages 1–3, 4–7, 8–11, 12–15 and 16+, dithered to whole pixels each frame (1,1,1,2 at 1.25). The stars stop entirely when the player's ship is off screen, and reverse at **3 px/frame** while a tractor beam is pulling the ship in. `$A003`/`$A004` are not scroll at all — they select the visible star-bank pair from frame-counter bits 3 and 4, which is the twinkle. | Confirmed  | [ASM] `new_stage.s`, tail of `stg_bombr_setparms` (`l_2C5B`, comment “adjust star speed”) for the per-stage byte; [LIST] main `$1D7C` (`f_1D76`, the ramp/dither) and `$0241`–`$0264` (the IRQ shifting the 3-bit code out to `$A000`–`$A002`); [MAME] `galaga.cpp:253` for the pin mapping, `galaga_v.cpp:255` (“Galaga only scrolls in X direction — the SCROLL_Y pins of the 05XX chip are tied to ground”) and `galaga.cpp:255` for the blink bits; [05XX] for the measured code → pixels-per-frame table. |

The 224×288 figure being exactly right is worth stating plainly, because the whole render pipeline
(integer scaling, sprite sizes, formation coordinates) is built on it.

---

## 3. Player

| Claim                    | Design plan says                                                                | Verified value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Confidence | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Movement axis            | horizontal only, along the bottom row                                           | Correct.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Confirmed  | [LIST] `f_1F85` at `$1F85`, which only ever writes the ship's X byte.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Movement speed           | “constant speed, no acceleration”                                               | **Alternating 1 and 2 pixels per frame while the stick is held — 1.5 px/frame average.** A flag at `$92A3` is XOR-ed with 1 on every call; `dX` is 1 when the result is non-zero and 2 when it is zero, so it toggles 1, 2, 1, 2 … The flag is cleared to 0 whenever the stick is neutral, so the first frame of any new movement is always a 1-pixel step. At 60.6061 Hz that is ≈ 91 px/s.                                                                                                                                                                                                                                          | Confirmed  | [LIST] `f_1F85` / `c_1F92` at `$1FAB`–`$1FB7`. Note that the source's own prose comment above the routine describes a one-frame 1-pixel step followed by 2-pixel steps thereafter; the instructions toggle every call, and the instructions are what ships.                                                                                                                                                                                                                                                               |
| Movement limits          | not specified                                                                   | Single fighter: X clamped to **`$12` … `$E1`** (`$1FD2` tests the left limit, `$1FCA` the right). Dual fighter: right limit is **`$D1`** instead (`$1FC3`), because the second ship is drawn at **X + `$0F`** (`$1FE1`).                                                                                                                                                                                                                                                                                                                                                                                                              | Confirmed  | [LIST] `c_1F92` at `$1FC2`–`$1FE3`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Shot cap                 | “at most 2 player shots on screen at once — this cap defines the game's rhythm” | **Correct, and it is 2 in total, not 2 per ship.** The fire handler checks rocket slot 0 (`sprite_posn+$64`); if that is occupied it checks slot 1 (`+$66`); if both are occupied it returns without firing. There are exactly two slots.                                                                                                                                                                                                                                                                                                                                                                                             | Confirmed  | [LIST] `f_1F04` / `c_1F0F` at `$1F19`–`$1F27`; the motion manager `f_06F5` likewise services exactly those two slots ([ASM] `gg1-5.s`, `f_06F5`).                                                                                                                                                                                                                                                                                                                                                                         |
| Dual fighter shots       | “double shots”                                                                  | **One logical shot, two bullets.** When the dual fighter is active the rocket's sprite control byte gets the hardware _double-width_ attribute set from the two-ship flag, so a single rocket object is drawn as two bullets. Hit detection matches: for a single fighter the X test is one window, for a dual fighter it is **two windows with a dead gap between them**. Working the 8-bit arithmetic through, the single-fighter window is Δx ∈ [−5, +5]; the dual-fighter windows are Δx ∈ [−6, +4] and Δx ∈ [+9, +19], with Δx ∈ [+5, +8] missing. The 15-unit window separation is exactly the `$0F` offset of the second ship. | Confirmed  | [LIST] `c_1F0F` at `$1F43`–`$1F4C` (`sprite.ctrl[RCKT].b0.dblw = (two_ship << 3)`) and the comment at `$1F4D` (“unless its the 2nd rocket, which is done by sprite doubling”); [ASM] `gg1-5.s`, `hitd_det_rckt`, the branch on `_b_2ship` into `l_07A4`.                                                                                                                                                                                                                                                                  |
| Dual fighter hitbox      | “double hitbox”                                                                 | Correct. Collision detection is run once per ship sprite (`sprite_posn+$60` and `+$62`), each with its own window: Δx ∈ [−6, +6] and Δy ∈ [−3, +3] in the ROM's half-scaled Y units.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Confirmed  | [ASM] `gg1-5.s`, the two `call hitd_fghtr_notif` / `hitd_fghtr_hit` pairs, and `hitd_det_fghtr`'s `sub #7 / add #13` and `sub #4 / add #7` tests.                                                                                                                                                                                                                                                                                                                                                                         |
| Fire is held, not tapped | not specified                                                                   | **Holding the fire button fires continuously.** The handler has no edge detection: it reads the debounced button state and fires whenever a rocket slot is free, so the fire rate is governed purely by the 2-slot cap and how fast shots leave the screen. The manual advertises this as a feature — “a rapid fire (automatic firing) option whereby the player just holds the FIRE button down and his space fighter continues to fire at the GALAGAS in bursts of two missiles each”. It is inherent, not a DIP switch.                                                                                                            | Confirmed  | [LIST] `f_1F04` at `$1F16`–`$1F18` (a single `bit 4,(hl)` / `ret nz` on the input port, then straight into `c_1F0F`) and the routine's header comment describing the 5100 I/O chip's debounce. [MANUAL] line 372. [SW] _Walkthrough_, "Challenging Stage": “it is possible to shoot all of the enemies in this Stage just by holding the fire button down.” MAME has no rapid-fire dipswitch; its `galagamf` set is documented as a patched ROM, “Galaga (Midway set 1 with fast shoot hack)” ([MAME] `galaga.cpp:2701`). |
| Lives                    | 3 by default                                                                    | Correct, and switch-selectable 2, 3, 4 or 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Confirmed  | [MANUAL] self-test display, line 1598, shows `*3 SHIPS` with `*` meaning switch-selectable; [MAME] `galaga.cpp`, `PORT_DIPNAME( 0xc0, 0x80, DEF_STR( Lives ) )` with `0x80` = `"3"` annotated `// factory default = "3"`.                                                                                                                                                                                                                                                                                                 |
| Extra lives              | 20,000 and 70,000, then every 70,000                                            | **Correct as the factory default.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Confirmed  | [MANUAL] self-test display listing, lines 1604–1606: `1ST BONUS *20000 PTS`, `2ND BONUS *70000 PTS`, `*AND EVERY 70000 PTS`. [MAME] independently annotates the `0x10` setting `"20K, 70K, Every 70K"` with `// factory default`.                                                                                                                                                                                                                                                                                         |

### Extra-life detail the rules layer has to carry

The thresholds are one of eight DIP settings, and the set on offer **depends on the starting-ship
count**. [MANUAL] lines 1103–1460 give both columns; [MAME]'s `Bonus_Life` dipsetting block encodes
the same split with `PORT_CONDITION` on the lives switch:

| DIP setting         | Started with 2, 3 or 4 fighters  | Started with 5 fighters        |
| ------------------- | -------------------------------- | ------------------------------ |
| —                   | 20 000, 60 000, every 60 000     | 30 000, 100 000, every 100 000 |
| **factory default** | **20 000, 70 000, every 70 000** | 30 000, 120 000, every 120 000 |
| —                   | 20 000, 80 000, every 80 000     | 30 000, 150 000, every 150 000 |
| —                   | 20 000 and 60 000 only           | 30 000 and 150 000 only        |
| —                   | 30 000 and 80 000 only           | 30 000 only                    |
| —                   | 30 000, 100 000, every 100 000   | 30 000 and 100 000 only        |
| —                   | 30 000, 120 000, every 120 000   | 30 000 and 120 000 only        |
| —                   | none                             | none                           |

So the rules layer wants _two_ threshold tables keyed by starting lives, not one — or, more simply, a
first-threshold / second-threshold / repeat-interval triple plus a `none` option, which covers every
row above.

**Awards stop, and the mechanism is more specific than "1,000,000". Confirmed.** The bonus check
reads exactly two score digits — the 100,000s and the 10,000s — and compares `floor(score / 10000) mod
100` against the pending threshold ([ASM] `game_ctrl.s`, the tail of `gctl_supv_score`,
lines 1170–1211):

```
v = 10 * digit[100000s] + digit[10000s]          ; = floor(score / 10000) mod 100
if (v != pending) return
if (pending < (bonus[1] AND $7F)) pending = bonus[1] AND $7F   ; the second threshold
else                              pending = pending + bonus[1] ; note: the RAW byte, bit 7 included
award_extra_ship()
```

Thresholds are stored in units of 10,000 and accumulate by the repeat interval, so with the factory
default 20,000 / 70,000 / every 70,000 they run 2, 7, 14, 21 … 98 and then 105 — which exceeds 99 and
can never match. **The last extra life is at 980,000 and there are none after**; with the 5-ship
default (30,000 / 120,000 / every 120,000) the last is at 960,000. Bit 7 of the repeat byte is the
"second bonus only" flag: adding the raw byte pushes the next threshold past 128, which can never
match either. `$FF` means no bonus at all.

The score itself does **not** roll over at 1,000,000: `c_scoreman_incr_add` ([ASM] `game_ctrl.s`
line 1242) propagates the carry by walking `inc l` through tile RAM with no digit limit, so the
seventh digit simply appears in the next tile position. ([SW] _Walkthrough_, "Scoring in the millions",
describes the player-1/player-2 display split; the award ceiling above is what the code does.) The
ones digit is never stored — every score is a multiple of 10.

---

## 4. Enemies and formation

| Claim                                       | Design plan says                                              | Verified value                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Confidence                                 | Source                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enemy count and mix                         | 40 per normal stage: 4 bosses, 16 butterfly-role, 20 bee-role | **Exactly right.** The ROM allocates three object classes: 20 objects at IDs `$08`–`$2E` (bee role), 8 at `$30`–`$3E` (boss role plus four "bonus-bee" slots), 16 at `$40`–`$5E` (butterfly role). The attack-wave ID table lists 40 of them: 4 bosses + 16 butterflies + 20 bees.                                                                                                                                                                                                         | Confirmed                                  | [ASM] `gg1-3.s`, `c_2896` (`ld b,#20 ; 20 bees`, `ld b,#8 ; 8 bosses and bonus-bees`, `ld b,#16 ; 16 moths`) and `db_attk_wav_IDs` in the same file.                                                                                                                                                                                                                              |
| Boss takes 2 hits, first hit changes colour | yes                                                           | Correct.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Confirmed                                  | [MANUAL] lines 1870–1873: “The GALAGA COMMAND SHIPS MUST BE SHOT TWICE to destroy them. When shot once, they change color from green to blue. When shot again, they explode.” (restated at lines 377–379.) The ROM agrees structurally: colour 0 is the green boss (dispatched to `l_08CA_hit_green_boss`) and colour 1 is “blue boss hit once” ([ASM] `gg1-5.s`, `hitd_dspchr`). |
| Boss second colour                          | not specified                                                 | **Sources disagree on the word, not the behaviour.** [MANUAL] says green → **blue**; [SW] says green → **purple**. The manual is the primary source and the ROM comment says “blue boss”, so use blue; the on-screen colour is a blue-violet, which is why the second description exists. Nothing about the mechanic is in doubt.                                                                                                                                                          | Confirmed (mechanic) / noted (colour name) | [MANUAL] line 1872; [SW] _Gameplay_, "Boss Galaga"; [ASM] `gg1-5.s` comment at the `cp #0x01` test.                                                                                                                                                                                                                                                                               |
| Formation grid                              | bosses top row, then 2 rows of 8, then 2 rows of 10           | **Correct, and here is the exact layout.** Each object has a fixed home slot as a (row index, column index) pair. Bosses occupy row `$16` at columns 6, 8, 10, 12. Butterflies occupy rows `$18` and `$1A`, 8 per row, at columns 2, 4, 6, 8, 10, 12, 14, 16. Bees occupy rows `$1C` and `$1E`, 10 per row, at columns 0, 2, 4, …, 18. So the butterfly rows are inset by one column position on each side relative to the bee rows, and the four bosses sit over the middle four columns. | Confirmed                                  | [ASM] `task_man.s`, `db_obj_home_posn_rc` — 48 (row, column) pairs indexed by object ID. Read by `case_2422` in `gg1-3.s` and by the formation-homing code in `gg1-5.s`.                                                                                                                                                                                                          |
| Captured-fighter slots                      | not specified                                                 | There are **four** captured-fighter home slots, object IDs `$00`, `$02`, `$04`, `$06`, at row `$14`, columns 6, 8, 10, 12 — one per boss, same column as its boss, one row step beyond the boss row on the side away from the bees (i.e. above it, since row index increases from the boss row `$16` down to the bee rows `$1C`/`$1E`).                                                                                                                                                    | Confirmed (the slots)                      | [ASM] `task_man.s`, `db_obj_home_posn_rc` offsets `$00`–`$07`; [LIST] `$1CEC`, “object/index of captured fighter i.e. 00 04 06 02”, derived from the boss's own object index.                                                                                                                                                                                                     |
| Enemy bullet cap                            | not mentioned                                                 | **8 enemy bullets on screen at once, globally.** The routine that creates an enemy shot searches for a free slot among eight; if all eight are taken no shot is created. Each enemy also has a per-enemy inter-shot delay byte.                                                                                                                                                                                                                                                            | Confirmed                                  | [CA], "Breaking Ground" / `InitiateBeeShot` discussion: “There are only eight possible bee bullets allowed on the screen at once; if all are taken, no other shots are created” and “Byte 0E is used as a delay between shots by the same bee”, tracing the loop at `$0D7D`.                                                                                                      |

Caution for anyone reading [ASM] directly: the comments in `c_2896` label the 20 objects at `$08`–`$2E`
"bees" but pass them the parameter commented "moth", and vice versa for the 16 objects at `$40`–`$5E`.
The values are unambiguous — `$08`–`$2E` resolve to score group 3 (50 points, bee role) and `$40`–`$5E`
to score group 2 (80 points, butterfly role) — but the comment pair is swapped. This is the same class
of error as the rank-comment mislabelling in section 6.

### The famous no-fire bug, and why it matters here

[CA] establishes at code level that enemy shots dropped at X = 0 are never moved and therefore never
freed, so they permanently occupy one of the eight bullet slots. Enemies diving out to the screen edge
reach X = 0, so over roughly fifteen minutes of leaving one bee alive all eight slots clog and **no
enemy fires for the rest of the game**. [CA] identifies the freeing instruction at `$2588` and the
removal routine at `$255B`. [SW] _Walkthrough_, "Secret: Disarm the bugs", describes the same trick
from the player's side.

This is a bug, not a feature, and Star Swarm should not reproduce it. It is recorded here for two
reasons. First, it is the clearest available confirmation that the enemy bullet pool is a fixed array
of eight slots with explicit free-list management — which is a genuine feel constraint worth copying.
Second, [CA] notes that ordinary play clogs slots too (“a normal player … might get very lucky and clog
up three or four slots in the first few levels”), which means **recorded arcade high scores and any
video footage used as a feel reference may reflect a partially disarmed game**. Anyone tuning against
footage should know that.

---

## 5. Entry-wave choreography

Entry choreography is the part of the original that is easiest to describe loosely and hardest to
reproduce from a loose description. “Scripted waves along curved paths, pairs and groups, often
mirrored” is right in spirit; the structure underneath it is a script library, and that structure is
what the content schema has to be able to hold.

### What the ROM actually does

**Confidence: Confirmed.** Source: [ASM] `gg1-3.s`, `c_25A2` and the data tables
`d_combat_stg_dat_idx`, `d_combat_stg_dat`, `d_challg_stg_data_idx`, `d_challg_stg_dat`,
`db_attk_wav_IDs`.

Every stage's entry choreography is a **script row** of 17 bytes: a 2-byte header followed by five
3-byte wave records, terminated by `$FF`. There are **13 distinct combat script rows** and **8 distinct
challenge script rows**.

Selection, from `c_25A2`:

```
adj = stage
while (adj >= 23) adj -= 4            ; fold; note the constant is $17 = 23

if ((adj + 1) mod 4) != 0:            ; normal stage
    index  = adj - (adj >> 2) - 1     ; 0 .. 16
    row    = d_combat_stg_dat_idx[rank][index]   ; 17 entries per rank
    script = d_combat_stg_dat + row               ; row is a pre-multiplied offset, 0x12 per row
else:                                  ; challenge stage
    index  = (stage >> 2) AND 7        ; 0 .. 7, uses the UNFOLDED stage number
    row    = d_challg_stg_data_idx[index]
    script = d_challg_stg_dat + row
```

Consequences:

- **Challenge stages are exactly those where `(stage + 1) mod 4 == 0`**, i.e. 3, 7, 11, 15, … This is
  the ROM's own test, and it fixes the challenge-stage cadence independently of the manual. The same
  test appears as the stored flag `_b_not_chllg_stg`, commented “`==(stg_ctr+1)%4 … i.e. 0 if challenge
stage`” ([ASM] `gg1-3.s`, `c_2896` and `f_2916`).
- **Entry scripts plateau at stage 22.** Because the fold constant is 23, normal stages from 24 onward
  cycle over index 14, 15, 16 forever. The ROM comment says so: “if past the highest stage (`$17`) we
  can only keep playing the last 4 levels.”
- **Challenge scripts cycle with period 8**, so challenge stage 9 (stage 35) reuses challenge stage 1's
  script. The challenge-stage sprite/colour set cycles on the same period, from an 8-entry table
  `d_290E` indexed `(stage >> 2) AND 7` ([ASM] `gg1-3.s`, `c_2896` at `l_28B5`). This matches the eight
  distinct bonus-stage illustrations in [SW] _Walkthrough_, "Challenging Stage".
- **The difficulty rank selects the whole script sequence**, not just the aggression numbers. The index
  table has four rows, one per rank, in source order B, C, D, A.

Per-stage script assignment, derived from those tables:

| Stage | Rank A (default)     | Rank B             | Rank C             | Rank D             |
| ----- | -------------------- | ------------------ | ------------------ | ------------------ |
| 1     | 0                    | 0                  | 0                  | 0                  |
| 2     | 1                    | 1                  | 1                  | 1                  |
| 3     | _challenge script 0_ |                    |                    |                    |
| 4     | 4                    | 2                  | 4                  | 7                  |
| 5     | 3                    | 3                  | 6                  | 9                  |
| 6     | 2                    | 0                  | 5                  | 8                  |
| 7     | _challenge script 1_ |                    |                    |                    |
| 8     | 4                    | 4                  | 7                  | 7                  |
| 9     | 6                    | 6                  | 9                  | 12                 |
| 10    | 0                    | 5                  | 0                  | 11                 |
| 11    | _challenge script 2_ |                    |                    |                    |
| 12    | 7                    | 4                  | 7                  | 10                 |
| 13    | 9                    | 6                  | 12                 | 12                 |
| 14    | 8                    | 0                  | 11                 | 11                 |
| 15    | _challenge script 3_ |                    |                    |                    |
| 16    | 10                   | 7                  | 10                 | 10                 |
| 17    | 12                   | 9                  | 12                 | 12                 |
| 18    | 0                    | 8                  | 11                 | 11                 |
| 19    | _challenge script 4_ |                    |                    |                    |
| 20    | 10                   | 10                 | 10                 | 10                 |
| 21    | 12                   | 12                 | 12                 | 12                 |
| 22    | 11                   | 11                 | 11                 | 11                 |
| 23    | _challenge script 5_ |                    |                    |                    |
| 24 …  | repeats 10, 12, 11   | repeats 10, 12, 11 | repeats 10, 12, 11 | repeats 10, 12, 11 |

Challenge scripts continue 6, 7, then wrap to 0 at stage 35.

### Wave composition

`db_attk_wav_IDs` groups the 40 objects into the five waves, eight objects each. Each row is the
object IDs for one wave:

| Wave | Object IDs                | Composition                  |
| ---- | ------------------------- | ---------------------------- |
| 1    | `58 5A 5C 5E 28 2A 2C 2E` | 4 butterflies + 4 bees       |
| 2    | `30 34 36 32 50 52 54 56` | **4 bosses** + 4 butterflies |
| 3    | `42 46 40 44 4A 4E 48 4C` | 8 butterflies                |
| 4    | `1A 1E 20 24 22 26 18 1C` | 8 bees                       |
| 5    | `08 0C 12 16 10 14 0A 0E` | 8 bees                       |

Waves are **mixed-type**, and all four bosses arrive together in wave 2.

### Wave record encoding

Each 3-byte wave record, per the [ASM] comment block above `d_combat_stg_dat`:

- byte 0 — controls loading of "transients" into the attack wave table.
- bytes 1 and 2 — one per bug of the pair:
  - bit 7 (byte 2 only): if **clear**, the second bug of the pair is delayed, producing a trailing
    formation rather than a simultaneous pair.
  - bit 6: selects the second of two 3-byte variants in `db_2A6C[]` — this is the **mirror** bit.
  - bits 0–5: index of a word in the flight-vector lookup at `db_2A3C` (`$18` entries).

So mirroring is a per-bug flag and "pairs versus trailing single file" is a per-wave flag — which is
the mechanism behind what a player reads as "pairs and groups, often mirrored".

The header's second byte carries the entry-bombing control: it is `$00` for the stage-1 script row,
`$01` for most rows and `$03` for rows 11–13. That lines up with [MANUAL] lines 1848–1851: “In the first
STAGE, the enemy ships do not drop bombs on you as they fly onto the screen … However, they will in
later stages.”

### The three shapes players perceive

[SW] _Walkthrough_, "Entrance patterns", describes **three** entrance patterns and their order,
and this is worth keeping alongside the ROM view because it is the level a player experiences:

1. Enemies enter **from both sides at once**, single file in short rows. The only pattern that does so.
2. Enemies enter **from one side at a time in double-width rows**, first group from the left.
3. Enemies enter **from one side at a time in a single long row**, starting from the left.

[SW] also gives the order: “A Challenging Stage comes after each set of three entrance patterns. The
only exception to this is the first set, where the third entrance pattern is skipped. Stage 3 is the
first Challenging Stage. After Stage 3, the set of four different Stages … repeats over and over.”

These two accounts are compatible: the thirteen ROM scripts are variations built over three broad
shapes, and the shapes recur on a period of four stages. **Confidence: high for the three shapes and
their order** (single detailed secondary source, consistent with the ROM's 4-stage period and with the
script table above, in which stages 20/21/22 and every later triple use scripts 10/12/11 in a fixed
rotation). The mapping from each of the thirteen script rows to one of the three shapes was **not**
derived; doing so requires decoding the `db_2A3C` → `db_2A6C` flight-vector programs, which is a
further layer of data not opened here.

### Formation sway and breathe

**Confirmed, with parameters.** Two 15 Hz tasks on opposite phases of the same 4-frame counter,
sharing the state byte `ds_9200_glbls + $0F`, which means "direction" to one and "phase counter" to the
other.

**Sway** — `f_2A90` ([ASM] `gg1-3.s`, header “left/right movement of collective while attack waves
coming in at start of round”). Active only while entry waves are arriving. All ten column coordinates
move together by ±1 px every 4 frames; the direction reverses at ±32 px.

| Parameter                 | Value                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Rate                      | 1 px every 4 frames = 0.25 px/frame ≈ 15 px/s                                                        |
| Amplitude                 | **±32 px** about the home position, rigid — rows do not move                                         |
| Waveform                  | triangle                                                                                             |
| Half period, edge to edge | 64 steps × 4 = 256 frames ≈ 4.3 s at 60 Hz                                                           |
| Full period               | 128 steps × 4 = **512 frames ≈ 8.5 s** at 60 Hz                                                      |
| Starts                    | at stage start, offset 0, moving right (direction seeded from the flip-screen flag, [ASM] `gg1-2.s`) |
| Ends                      | when the last wave has arrived (`_b_nestlr_inh` set) **and** the offset passes back through 0        |

So the formation is always exactly centred when diving begins, and the same moment switches on the
pulsing-formation sound (`b_9AA0[0]`) and enables the breathe. ±32 px is not arbitrary: the ten column
origins `db_fmtn_hpos_orig` ([ASM] `gg1-2.s`) are `$31,$41,…,$C1` — pitch 16 — and land at screen x
32…176 through the sprite transform ([MAME] `galaga.cpp`, `draw_sprites`), a 160 px formation on a
224 px playfield with 32 px of margin each side. The sway runs until it just touches each edge.

**Breathe** — `f_1DE6` ([LIST] main `$1DEC`–`$1E69`, header “Provides pulsating movement of the
collective. Enabled by `f_2A90` once the initial formation waves have completed”). A phase counter at
`$920F` runs 0 → 31 expanding then back down, one step per 4 frames: **128 frames out, 128 back, a
256-frame cycle ≈ 4.3 s** at 60 Hz. Each step, one row of a 16-byte bitmap table selects which of the
ten column and six row coordinates move by 1 px; the first five columns move `+B` and the remaining
eleven coordinates `−B` ([LIST] main `$1E37`/`$1E3C`), so the two halves part and the rows move down.

The four bitmap rows at `d_1E64_bitmap_tables` ([LIST] main `$1E6A`) each rotate through all 8 bits
over their 8-step group, so a coordinate's total displacement over one 32-step expansion is the
population count of its four bytes:

| Column, left → right         | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  |
| ---------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Displacement outward, px** | 32  | 25  | 18  | 11  | 4   | 4   | 11  | 18  | 25  | 32  |

| Row, top → bottom             | captured | boss | butterfly 1 | butterfly 2 | bee 1 | bee 2 |
| ----------------------------- | -------- | ---- | ----------- | ----------- | ----- | ----- |
| **Displacement downward, px** | 0        | 4    | 11          | 18          | 25    | 32    |

The differences are a uniform 7 px (8 across the centre), so this is an accordion rather than a
wobble: every inter-column gap grows by 7 px, column pitch goes 16 → 23 px, and at full expansion the
outermost sprites sit at exactly screen x 0 and x 208 — the same edge-touching design as the sway. The
captured-fighter row does not move. The direction sign is published to the sound CPU as
`formatn_mv_signage` ([LIST] main `$1E13`; consumed at [ASM] `gg1-7.s` `l_00D3` onward, with the
explicit comments `; expanding formation` and `; contracting formation`), which is what selects the
rising versus falling pitch sweep.

**Neither runs on a challenge stage.** `f_1DE6` is disabled at every stage start ([LIST] main `$01E4`)
and is only re-enabled by `f_2A90`'s completed-formation exit; on a challenge stage nothing settles
into formation, so `f_2A90` leaves through its other exit and the breathe never starts.

### Divers leaving the bottom and re-entering at the top

**Confirmed.** [CA] describes diving bees sweeping “out to the sides in wide, sweeping, diving arcs”
with “the bees on the right ‘wrap around’ to 0”, and [SW] _Walkthrough_ describes the lone bee
“passed through the top of the screen four times”. [SW] _Gameplay_ adds a behaviour worth keeping: “After their initial dive, they may make a round swoop back upwards, attempting to hit the
fighter from behind.” [MANUAL] line 1962 puts it more colourfully: “If they can’t bomb you, they’ll
ram you in the rear. That’s one of their favorite tricks, to fly in a circle and come up behind you.”

---

## 6. Dive attacks and difficulty ramp

Dive frequency, bullet rates and simultaneous-diver limits do rise with the stage, and the last few
enemies of a stage do get more aggressive. Both are true, and neither is a curve. This is the section
where an intuitive reading of the original is furthest from what it actually does.

### The per-stage bomber configuration table

**Confidence: Confirmed.** Source: [ASM] `new_stage.s`, routine `stg_bombr_setparms` and data
`bmbr_stg_cfg_lut` / `bmbr_stg_cfg_dat`.

```
adj = stage
while (adj >= 27) adj -= 4            ; fold; note the constant is $1B = 27
E   = 5 * (adj - 1)
tbl = bmbr_stg_cfg_lut[rank]          ; 4 sub-tables, 26 stages each, 5 bytes per stage
copy 5 bytes from tbl + E, splitting each into its two nibbles
     -> new_stage_parms[0..9]
```

Ten parameters per stage, one per nibble, high nibble first. The [ASM] comment block names them:

| #   | Parameter                                                             |
| --- | --------------------------------------------------------------------- |
| 0   | parameter for set bomb drop enable flags                              |
| 1   | launch counter, bomber-type 0 (bee role)                              |
| 2   | launch counter, bomber-type 1 (butterfly role)                        |
| 3   | launch counter, bomber-type 2 (boss role)                             |
| 4   | allowable max simultaneous bombers (divers)                           |
| 5   | increases allowable max bombers after a time                          |
| 6   | tractor-beam step period, in frames (12 → 3 across the stage table)   |
| 7   | **number of aliens left when continuous bombing can start**           |
| 8   | flag for reload attack-wave flight vector table pointer after stage 8 |
| 9   | flag for reload bombing flight vector table pointer after stage 8     |

Parameter 6's [ASM] name is “capture flag”, which is misleading. It is loaded into `_b_captr_flag`
when a capture boss reaches beam position ([ASM] `gg1-3.s`, `f_21CB`), and `f_2222` counts it down
every frame, advancing the beam one animation step each time it reaches zero ([ASM] `gg1-3.s`,
`l_226A`). Rank A runs 12, 9, 6, 3 across the stage table, so **the beam extends and pulls four times
faster by stage 20 than at stage 1** — that is what makes late captures hard to escape, not a higher
capture probability. It is a speed, not a flag and not a rate. (The byte is reused as a mode value
later in the sequence — 3 when the boss is shot during capture, `$0A` when the beam grabs the ship — so
the table value is the _initial_ period.)

Parameter 7 is a threshold on the live enemy count, not a timer; see below.

An eleventh value, `new_stage_parms[$0A]`, is computed rather than tabled — see the transform section
below.

Three structural facts follow, and each of them costs more to get wrong than any single number:

1. **The ramp plateaus at stage 26, by cycling.** The fold is `while (adj >= 27) adj -= 4`, so stage 27
   reuses stage 23's row, stage 28 reuses 24's, and so on forever. Difficulty does not keep climbing.
2. **The plateau point differs from the entry-script plateau.** Bomber parameters fold at 27; entry
   scripts fold at 23 (section 5). Two different periods, two different tables.
3. **The ramp is not monotonic.** Three of the four rank tables contain a stage that is markedly easier
   than the one before it — rank A at stages 10 and 18, rank B at 6 and 14, rank C at 10. Rank D is the
   only monotone table. These are deliberate breathers in the data, not a smooth curve with noise, and a
   schema that interpolates or extrapolates a curve cannot express them.

Also loaded at every stage start, unconditionally: the three bomber ready-timers are initialised to
`$16`, `$02`, `$02` for the bee, butterfly and boss types respectively ([ASM] `new_stage.s`, “`16 02 02`
i.e. start of round defaults for yellow, red, boss bomber timers”).

### Rank mapping

**Confidence: Confirmed.** The rank value is read from two DIP bits and indexes both this table and the
entry-script index table:

| Rank value | Manual's rank letter | [MAME] difficulty name     | Bomber sub-table    |
| ---------- | -------------------- | -------------------------- | ------------------- |
| 0          | B                    | Medium                     | 2nd in source order |
| 1          | C                    | Hard                       | 3rd                 |
| 2          | D                    | Hardest                    | 4th                 |
| **3**      | **A**                | **Easy — factory default** | **1st**             |

Sources: [ASM] `gg1-4.s`, the rank read (`rra` / `and #0x01` on DSWA#1, OR-ed with bit 1 of DSWA#2)
followed by `ld hl,#str_3A68 ; base_address of rank-characters (B/C/D/A)` and `rst 0x10`, which indexes
that four-character string by the rank value — so 0→`B`, 1→`C`, 2→`D`, 3→`A`.

The rank _ordering_ is stated outright by the manual, at lines 839–847: “DIFFICULTY LEVEL SETTINGS —
‘A’ IS THE EASIEST AND ‘D’ IS THE MOST DIFFICULT / RANK ‘A’ - EASIEST LEVEL OF PLAY / RANK ‘B’ - 2ND
LEVEL OF DIFFICULTY / RANK ‘C’ - 3RD LEVEL OF DIFFICULTY / RANK ‘D’ - MOST DIFFICULT LEVEL OF PLAY.”
[MANUAL] line 1600 shows the self-test default as `RANK *A (B,C,D)`, and [MAME]
`PORT_DIPNAME( 0x03, 0x03, DEF_STR( Difficulty ) )` defaults to `0x03` = `Easy`. All three agree: rank
value 3 = rank A = easiest = factory default.

This is a useful cross-check on the sub-table assignment above. Ranks A and B both plateau at
`62 99 57 3C` while C and D both plateau at `72 99 68 3E`, so the four sub-tables do sort into two
easier and two harder, in the order the manual states.

Caution for anyone reading [ASM] directly: the comment block above that read mislabels rank 0 as
“A (MEDIUM)”, listing `A` twice. The instructions and the `B/C/D/A` string are correct; the comment is
not.

### Rank A (factory default) per-stage parameters

| Stage       | p0 bomb-enable | p1 launch bee | p2 launch btfly | p3 launch boss | p4 max divers | p5 max-diver bump | p6 capture flag | p7 aliens left for continuous bombing | p8 reload atk vec | p9 reload bomb vec | raw              |
| ----------- | -------------- | ------------- | --------------- | -------------- | ------------- | ----------------- | --------------- | ------------------------------------- | ----------------- | ------------------ | ---------------- |
| 1           | 0              | 0             | 0               | 0              | 2             | 2                 | 12              | 6                                     | 0                 | 0                  | `00 00 22 C6 00` |
| 2           | 0              | 0             | 1               | 1              | 2             | 3                 | 12              | 7                                     | 0                 | 0                  | `00 11 23 C7 00` |
| 3 _(chal)_  | 0              | 0             | 0               | 0              | 0             | 0                 | 12              | 0                                     | 0                 | 0                  | `00 00 00 C0 00` |
| 4           | 1              | 1             | 1               | 2              | 2             | 3                 | 9               | 7                                     | 0                 | 0                  | `11 12 23 97 00` |
| 5           | 1              | 1             | 2               | 3              | 2             | 3                 | 9               | 8                                     | 0                 | 0                  | `11 23 23 98 00` |
| 6           | 2              | 1             | 2               | 4              | 3             | 3                 | 9               | 8                                     | 0                 | 0                  | `21 24 33 98 00` |
| 7 _(chal)_  | 0              | 0             | 0               | 0              | 0             | 0                 | 9               | 0                                     | 0                 | 0                  | `00 00 00 90 00` |
| 8           | 2              | 2             | 2               | 5              | 3             | 3                 | 9               | 9                                     | 1                 | 0                  | `22 25 33 99 10` |
| 9           | 2              | 2             | 3               | 6              | 3             | 4                 | 6               | 9                                     | 1                 | 0                  | `22 36 34 69 10` |
| 10          | 1              | 0             | 1               | 1              | 2             | 3                 | 9               | 7                                     | 0                 | 0                  | `10 11 23 97 00` |
| 11 _(chal)_ | 0              | 0             | 0               | 0              | 0             | 0                 | 6               | 0                                     | 0                 | 0                  | `00 00 00 60 00` |
| 12          | 3              | 2             | 4               | 6              | 3             | 4                 | 6               | 7                                     | 1                 | 1                  | `32 46 34 67 11` |
| 13          | 3              | 2             | 6               | 7              | 4             | 4                 | 6               | 8                                     | 1                 | 1                  | `32 67 44 68 11` |
| 14          | 3              | 2             | 6               | 7              | 4             | 5                 | 6               | 8                                     | 1                 | 1                  | `32 67 45 68 11` |
| 15 _(chal)_ | 0              | 0             | 0               | 0              | 0             | 0                 | 6               | 0                                     | 0                 | 0                  | `00 00 00 60 00` |
| 16          | 4              | 2             | 7               | 8              | 4             | 5                 | 6               | 9                                     | 1                 | 1                  | `42 78 45 69 11` |
| 17          | 4              | 2             | 7               | 8              | 4             | 5                 | 6               | 9                                     | 1                 | 1                  | `42 78 45 69 11` |
| 18          | 1              | 1             | 2               | 2              | 2             | 3                 | 9               | 7                                     | 1                 | 1                  | `11 22 23 97 11` |
| 19 _(chal)_ | 0              | 0             | 0               | 0              | 0             | 0                 | 6               | 0                                     | 0                 | 0                  | `00 00 00 60 00` |
| 20          | 5              | 2             | 8               | 8              | 4             | 6                 | 3               | 10                                    | 1                 | 1                  | `52 88 46 3A 11` |
| 21          | 5              | 2             | 8               | 8              | 5             | 6                 | 3               | 10                                    | 1                 | 1                  | `52 88 56 3A 11` |
| 22          | 5              | 2             | 8               | 8              | 5             | 6                 | 3               | 12                                    | 1                 | 1                  | `52 88 56 3C 11` |
| 23 _(chal)_ | 0              | 0             | 0               | 0              | 0             | 0                 | 3               | 0                                     | 0                 | 0                  | `00 00 00 30 00` |
| 24          | 6              | 2             | 8               | 9              | 5             | 7                 | 3               | 12                                    | 1                 | 1                  | `62 89 57 3C 11` |
| 25          | 6              | 2             | 9               | 9              | 5             | 7                 | 3               | 12                                    | 1                 | 1                  | `62 99 57 3C 11` |
| 26          | 6              | 2             | 9               | 9              | 5             | 7                 | 3               | 12                                    | 1                 | 1                  | `62 99 57 3C 11` |

Reading it: max simultaneous divers rises 2 → 5 (and the "bump after a time" value 2 → 7); the boss
launch counter rises 0 → 9; the bee launch counter tops out at 2 and stays there, so most of the
escalation is in the butterfly and boss launch rates; the capture flag steps _down_ 12 → 9 → 6 → 3;
and the continuous-bombing threshold rises 6 → 12.

### The other three rank tables, as raw bytes

Each line is one stage, five bytes, stages 1 to 26 in order. Split each byte high nibble then low
nibble to recover p0…p9.

**Rank B (Medium, rank value 0):**

```
00 00 12 C6 00   00 11 22 C6 00   00 00 00 C0 00   11 12 23 97 00
11 12 23 97 00   00 11 23 C7 00   00 00 00 90 00   21 23 33 98 10
21 24 33 98 10   21 25 34 98 10   00 00 00 60 00   22 25 34 68 11
32 36 44 68 11   11 11 23 67 01   00 00 00 60 00   32 36 45 68 11
32 46 45 69 11   32 67 45 69 11   00 00 00 60 00   42 67 46 3A 11
42 78 56 3A 11   52 78 56 3A 11   00 00 00 30 00   52 88 56 3C 11
62 99 57 3C 11   62 99 57 3C 11
```

**Rank C (Hard, rank value 1):**

```
00 00 23 C6 00   10 11 23 97 00   00 00 00 C0 00   11 12 33 98 00
21 23 34 68 00   21 24 34 68 00   00 00 00 90 00   32 36 34 67 10
32 46 44 68 10   11 11 23 97 10   00 00 00 60 00   42 67 45 68 11
42 67 45 69 11   42 78 46 69 11   00 00 00 60 00   52 78 46 3A 11
52 88 56 3A 11   52 88 56 3A 11   00 00 00 60 00   62 88 56 3C 11
62 89 57 3C 11   62 89 57 3E 11   00 00 00 30 00   72 99 57 3E 11
72 99 68 3E 11   72 99 68 3E 11
```

**Rank D (Hardest, rank value 2):**

```
00 00 23 C6 00   10 11 23 97 00   00 00 00 C0 00   11 12 34 98 00
21 23 34 68 00   21 24 34 68 00   00 00 00 90 00   32 36 45 67 11
32 46 46 68 11   32 56 46 69 11   00 00 00 60 00   42 67 56 6A 11
42 67 56 6A 11   42 78 57 6A 11   00 00 00 60 00   52 78 57 3A 11
52 88 57 3A 11   52 88 68 3C 11   00 00 00 60 00   62 88 68 3C 11
62 89 68 3C 11   62 89 68 3E 11   00 00 00 30 00   72 99 68 3E 11
72 99 68 3E 11   72 99 68 3E 11
```

### The last few enemies getting more aggressive

**Confirmed, and it is parameter 7.** Its [ASM] name is “number of aliens left when continuous bombing
can start”, and in rank A it rises 6, 7, 7, 8, 8, 9, 9, 7, 7, 8, 8, 9, 9, 7, 10, 10, 12, 12, 12 across
the normal stages — so continuous bombing kicks in with progressively _more_ enemies still alive as the
game advances. This is a threshold on the remaining-enemy count, not a timer — that is the rule to
encode, rather than a single number.

### Boss escorts

**Confirmed.** A boss launches with 0, 1 or 2 escorts, selected at launch time and passed as `ixl`
(0 → 2 escorts, 1 → 1 escort, 2 → solo, which is also the tractor-beam case). A tractor-beam boss never
brings escorts. Escorts are drawn from the top butterfly row. Sources: [LIST] `$1CB4`–`$1CE9`, the
comment “`ixl: 2==solo/capture boss is valid and will skip escort selection … in addition to 0 -> 2
escorts, 1 -> 1 escort`”, and the two conditional `call c_1D03` wingman setups; [ASM] `gg1-2.s`
comment “Called once for each of boss + 1 or 2 wingmen”; [SW] _Gameplay_, “the very top row of
Butterflies will also accompany a Boss Galaga as an escort when the Boss Galaga is not attempting to
use a tractor beam”.

### Transforming enemies

| Claim               | Design plan says                      | Verified value                                                                                                                                                                                                                                                               | Confidence | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First stage         | “from about stage 4”                  | **Exactly stage 4.** The enabling value `new_stage_parms[$0A]` is computed as: 0 if stage < 3; 0 if the stage is a challenge stage; otherwise `$0A` (10). Stage 3 is a challenge stage, so stage 4 is the first stage with a non-zero value.                                 | Confirmed  | [ASM] `new_stage.s`, `l_2C3F`–`l_2C46`, with the comment “set `ds_new_stage_parms[0x0A]` … number of remaining aliens for enable clone-attack”.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Frequency           | “some bees transform”                 | **Once per stage**, and it is a Bee, or a Butterfly if no Bees remain.                                                                                                                                                                                                       | High       | [SW] _Gameplay_, "Transforms": “Once per stage (beginning with Stage 4), a Bee (or a Butterfly if no Bees exist) will transform into a set of three enemies.” Consistent with the ROM's single “parent bonus-bee” object (`_b_bbee_obj`, [ASM] `gg1-5.s` `l_0852`) and the four spare boss-class slots `$38`–`$3E`.                                                                                                                                                                                                                                                                                                                                                                       |
| Gating threshold    | not specified                         | The ROM stores **10** as the remaining-alien threshold, and the transform fires when **fewer than** 10 enemies remain. The transform target is the first bee-role object in `STAND_BY`, or the first butterfly-role one if no bees remain, which confirms [SW] at ROM level. | Confirmed  | [ASM] `new_stage.s` as above for the value. `f_1A80` ([LIST] main `$1A86`) is `ld a,($99CA) / ld c,a / ld a,($92A7) / cp c / ret nc` — it returns while the live enemy count is greater than or equal to the threshold, so the body runs only below it. Selection at [LIST] main `$1A95`–`$1AAE`; the task disables itself after launching ([LIST] main `$1B5B`), which is the once-per-stage rule. The tell is a `$C0` countdown during which the enemy alternates colour every 16 ticks ([LIST] main `$1AF1`, `bit 4,a`).                                                                                                                                                               |
| Trio type and bonus | “bonus for destroying all 3 (verify)” | **Three types cycling on a 4-stage period**, with bonus 1000, 2000, 3000: Scorpions on stages 4–6, Stingrays on 8–10, Galaxian Flagships on 12–14, then the cycle repeats. Individually, a transform is worth 160.                                                           | Confirmed  | [MANUAL] lines 1892–1898: “special attack squadrons made up of three ships each which will appear from STAGE 4 on. If they are completely destroyed, bonus points will be awarded as follows: STAGES 4-6 1000 BONUS POINTS / STAGES 8-10 2000 BONUS POINTS / STAGES 12-14 3000 BONUS POINTS”. [SW] _Walkthrough_, "Transforms", names the three types in that order and states “After that, the three different transforms repeat in the same order”; [SW] _Gameplay_ scoring table gives “Any transform individually 160”, “All scorpions 1000”, “All stingrays 2000”, “All Galaxian Flagships 3000”. Two independent sources, one of them the manual, agreeing on the same three bands. |
| Behaviour           | “transform mid-dive”                  | The trio dives, fires on the way down, makes one final loop and **exits the screen — unlike bees, it does not re-enter from the top**. The third set transforms noticeably faster than the first two.                                                                        | High       | [SW] _Gameplay_ and _Walkthrough_, "Transforms". Single detailed secondary source; not contradicted anywhere.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

As a rule for the configuration data, for a normal stage _N_ ≥ 4, let _g_ = ⌊(_N_ − 4) / 4⌋. Then the
trio type is _g_ mod 3 (0 = Scorpion, 1 = Stingray, 2 = Galaxian Flagship) and the all-three bonus is
1000, 2000 or 3000 respectively. Check: _N_ = 4 → _g_ = 0 → 1000; _N_ = 6 → _g_ = 0 → 1000;
_N_ = 8 → _g_ = 1 → 2000; _N_ = 14 → _g_ = 2 → 3000; _N_ = 16 → _g_ = 3 → 1000, the cycle restarting as
[SW] describes.

---

## 7. Capture and rescue

| Claim                                         | Design plan says                                                                      | Verified value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Confidence                                      | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tractor beam                                  | “a boss may dive partway and emit a tractor beam”                                     | Correct, with detail: a tractor-beam boss brings **no escorts**, loops just once at the top of the formation, slides down to roughly mid-screen (a second account says to “two inches above the bottom”), then emits the beam. If the player is not in range the beam retracts and the boss drops straight down to return to formation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Confirmed (mechanic) / High (the descent depth) | [MANUAL] lines 1862–1866; [SW] _Gameplay_ "Boss Galaga" (“slides down to about mid-way along the screen”) and _Walkthrough_ "Getting captured" (“stops two inches above the bottom of the screen”). The two [SW] passages disagree with each other on how far it descends; neither is a ROM figure, so treat the descent depth as approximate and tune it by eye.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Captured fighter appearance                   | “becomes a captured (red) fighter sitting beside the boss in formation”               | Colour is right — the captured fighter is colour map 7, “red captured ship”. Position: it parks in its **own home slot**, one row beyond the boss row, in the same column as its boss (section 4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Confirmed                                       | [ASM] `gg1-5.s`, `l_0849` (`cp #7 ; color map 7 … red captured ship`) and `l_0894` (`ld (hl),#9 ; color map 9 for white ship` on rescue); [ASM] `task_man.s` `db_obj_home_posn_rc`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Capture persists                              | not stated                                                                            | The captured fighter “stays with that particular enemy COMMAND SHIP **for the rest of the game**” — it is not released at stage end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Confirmed                                       | [MANUAL] line 1866: the captured fighter “stays with that particular enemy COMMAND SHIP for the rest of the game.”                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Capture of the last fighter ends the game** | **not mentioned**                                                                     | **If you are captured while playing your last fighter, the game is over.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Confirmed                                       | [MANUAL] line 1972: “When the enemy destroys **or captures** your last fighter, the words ‘GAME OVER’ are displayed”. [SW] _Walkthrough_: “If you have another Fighter, you begin playing with it. If you don't, the game is over. Note: Never get captured when you're playing with your last Fighter.”                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Rescue by killing the diving boss             | “destroying that boss while it is diving releases the captured ship … → dual fighter” | Correct. The manual's wording is the precise condition: you must destroy the boss “while they are **both attacking** your current fighter”.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Confirmed                                       | [MANUAL] line 1869 (“while they are both attacking your current fighter”); [ASM] `gg1-5.s` at `cp #9 ; is this a valid capture ship status …i.e. diving?` — the rescue branch is taken only when the captured ship's status is the diving state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Rescue edge case                              | not mentioned                                                                         | If you kill the boss **before it has pulled the ship all the way in**, the capture-ship status is still `$80` and the rescue does not fire — the [ASM] comment says so explicitly: “status may still be `$80` meaning I have killed the boss before he pulls the ship all in!”                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Confirmed                                       | [ASM] `gg1-5.s`, the `jr nz,l_0899` immediately after that `cp #9`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Boss must be shot twice, even for the rescue  | not mentioned                                                                         | A green boss needs two hits, a blue/purple one needs one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Confirmed                                       | [MANUAL] lines 1870–1873; [SW] _Walkthrough_, "To the rescue".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Boss destroyed while in formation**         | “turns the captured ship hostile **(verify exact behaviour)**”                        | **Verified, and considerably more specific than "hostile".** The captured fighter becomes what the ROM calls a **rogue fighter**. It eventually swoops down on the player once. It then leaves the bottom of the screen and does **not** return during that stage. It reappears as the **last ship to enter on the next stage's entrance wave**, and takes its place at the top of the formation. Players use this deliberately to park a captured fighter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | High                                            | [SW] _Walkthrough_, "Don't destroy yourself": “If you shoot the Boss Galaga that captured your Fighter while it is in formation, eventually the captured Fighter will swoop down on you. Don't destroy it. It will disappear off the bottom of the screen and go away. But all is not lost; it will reappear as the last ship to enter on the next entrance screen … then take its place at the top of the formation. Some players use this as a expert's technique to store a captured Fighter.” Corroborated at ROM level by the object's own name and dive handling: [ASM] `gg1-2.s` header, “Diving movement of red alien, yellow alien, clone-attacker, **and rogue fighter**”, and [LIST] `$1CE9`, “if rogue fighter for this boss !STAND_BY then return”, which checks the rogue fighter's state before a boss launch. One detailed secondary source plus consistent ROM structure; the re-entry-as-last-ship detail is not independently ROM-verified. |
| Shooting your own captured fighter            | “Shooting a captured ship destroys it.”                                               | Correct, and it scores: **500 points if the captured fighter is in formation (stand-by), 1,000 if it is attacking.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Confirmed                                       | [MANUAL] lines 1876–1879: “if the captured fighter is in a stand-by position in the convoy formation — 500 points will be added to your score; if the captured fighter is attacking — 1000 points will be added to your score.” Matches the ROM score table exactly: colour 7 has base factor `$50` = 500, doubled to 1,000 when moving (section 9). Note [SW]'s scoring table lists only the 1,000 figure; the manual and the ROM both give both values, so the manual is right and [SW] is incomplete.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| One capture at a time                         | “One capture at a time”                                                               | **Confirmed — exactly one, globally.** `_b_bmbr_boss_cflag` (`$982B`) is set to 1 the instant a capture boss is selected and the selector refuses to run while it is non-zero. A successful capture does **not** clear it: the capture-completion tail invalidates `_b_bmbr_boss_cobj` but leaves the flag set. It returns to 0 only on: a new game; the capture boss dying or aborting before reaching beam position; the boss being shot while the beam is out; the beam retracting without connecting; the boss mid-capture being destroyed; **shooting the red captured fighter**; or **losing one half of a dual fighter**. Three player-visible consequences: parking a rogue fighter does **not** re-enable capture (that boss is no longer `cobj`, which was invalidated to 1); **a dual fighter is never targeted**; and the **first boss launch of a game is never a capture boss**, since `_b_bmbr_boss_wingm` starts at 0, is pre-incremented and only even values select capture mode. The four home slots are one per possible captor (`bossObject AND 7` → `$00,$02,$04,$06`), not four simultaneous captives. | Confirmed                                       | [LIST] main `$1C07`–`$1C33` (the gate: `ld a,($982B) / and a / jr nz` to the non-capture launch, then `ld ($982B),a` with `a = 1`), `$1A70`–`$1A85` (the completion tail: `$9828` invalidated, `$982B` untouched), `$1853` (new-game init), `$2681` (re-insertion while held); [LIST] sub `$0803` (shooting the captured fighter) and `$0610`/`$0628` (dual fighter losing a half); [ASM] `gg1-3.s` `f_21CB` `l_221A`, `f_2222` `l_22AB` and `l_22E3` (the three failure exits), `l_2681_end_of_table` (`cflag != 0 && !two_ship`), `gg1-5.s` the rescue mask `a = l AND $07`. Every access to `$982B` in both listings was enumerated: eight writes, and the capture-completion tail is not one of them.                                                                                                                                                                                                                                                      |
| Dual fighter                                  | “two ships, double shots, double hitbox”; “a hit on either half leaves a single ship” | Hitbox: correct (section 3). Shots: needs restating — see section 3, the cap stays at 2 logical shots and each becomes a 2-bullet spread.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Confirmed                                       | Section 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Rescue moment                                 | not mentioned                                                                         | When a captured fighter is freed, **enemies already in mid-dive return to formation**, and the freed fighter is **invulnerable to your own shots while it spins** into place.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | High                                            | [SW] _Walkthrough_, "Now stay alive": “when you free a captured Fighter, any enemies in mid-dive will return to formation … Your captured Fighter will be suspended in mid-space spinning. It is invulnerable to your shots at this point and can not be destroyed until it joins you.” Corroborated by the ROM: the rescue path sets a dedicated task flag commented “capturing boss destroyed, rescued ship spinning”, and the rocket manager checks that same flag to change hit-detection behaviour ([ASM] `gg1-5.s`, `ds_cpu0_task_actv + 0x1D`).                                                                                                                                                                                                                                                                                                                                                                                                         |
| Firepower disabled during capture             | not mentioned                                                                         | Once the boss has connected with your ship, your fire is disabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Confirmed                                       | [ASM] `gg1-3.s`, `l_214C_disable_firepower` with the comment “disables your rockets when the boss has finally connected”.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

The rogue-fighter re-entry above is **now ROM-confirmed** rather than resting on [SW]: while a captured
fighter is held or parked, `l_2681_end_of_table` appends it as the last entry of the next stage's wave
table with sprite code `$80 + $07` (score group 7, the red captured ship), under exactly the condition
`cflag != 0 && !two_ship` ([ASM] `gg1-3.s`). That is the mechanism behind [MANUAL] 1866's “stays with
that particular enemy COMMAND SHIP for the rest of the game”.

One rescue corner is **not** resolved and does not affect the answer: `f_2000`'s landing code branches
on the main ship's sprite glyph — 6 (upright) forms the dual fighter, 7 (“wings closed”, the captured
look) instead clears `cflag` and docks at a different slot ([ASM] `gg1-3.s`). No game state reaching
that second branch was constructed. It is a rescue-timing corner, not a second capture channel.

---

## 8. Challenge stages

| Claim                | Design plan says                                             | Verified value                                                                                                                                                                                                                                                | Confidence | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cadence              | stage 3, then every 4th (7, 11, 15…)                         | **Correct.** The ROM test is `(stage + 1) mod 4 == 0`.                                                                                                                                                                                                        | Confirmed  | [ASM] `gg1-3.s`, `_b_not_chllg_stg` (“`==(stg_ctr+1)%4 …i.e. 0 if challenge stage`”) used in both `c_2896` and `f_2916`; `new_stage.s` reaches the same conclusion by `or #~0x03 / inc a / jr z`. [MANUAL] lines 1909–1915 says it in convoy terms: “The first CHALLENGING STAGE comes at the end of the 2nd STAGE. After this, they come at the end of every third STAGE. When you destroy the last ship of the 2nd, 6th, 10th, 14th, 18th, etc. convoys …”. **Note the manual is internally confusing here**: “every third STAGE” counts the three _combat_ convoys between challenge stages, while the convoy numbers it lists (2nd, 6th, 10th, 14th) are four apart in stage numbers. The ROM settles it: challenge stages are 3, 7, 11, 15, …                                                                                        |
| Structure            | 40 enemies in 5 groups of 8                                  | **Correct.**                                                                                                                                                                                                                                                  | Confirmed  | [MANUAL] lines 1918–1922: “A CHALLENGING STAGE is made up of 40 enemy ships that fly by your fighter in 5 groups of 8 ships each while describing varying patterns.” ROM: the per-group counter `w_bug_flying_hit_cnt` is reset to 8 at each wave ([ASM] `gg1-3.s`, `f_2916`), and the challenge script rows have five wave records like the combat ones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| They never shoot     | yes                                                          | Correct.                                                                                                                                                                                                                                                      | Confirmed  | [MANUAL] line 1922: “They do not drop any bombs”.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Per-group bonus      | “per-group bonus for clearing a whole group (verify values)” | **1,000 / 1,500 / 2,000 / 3,000**, stepping with the challenge-stage index: challenge stages 1–2 award 1,000, 3–4 award 1,500, 5–6 award 2,000, and the 7th and all later ones award 3,000.                                                                   | Confirmed  | [ASM] `gg1-3.s`, `d_stage_chllg_rnd_attrib` = `{10, 15, 20, 30}` paired with score-tile codes, described as “setup challenge stage bonus attributes … (base-score multiples are * 10 thanks to `d_scoreman_inc_lut[0]`)”. Since `d_scoreman_inc_lut[0]` = `$10`, which the score adder applies as +1 to the hundreds digit, each unit is 100 points: 10→1000, 15→1500, 20→2000, 30→3000. The index is computed in `c_2896` as `(stage >> 3) AND 3`, clamped to 3 for stage ≥ 32 — which for challenge stages 3, 7, 11, 15, 19, 23, 27, 31 yields 0, 0, 1, 1, 2, 2, 3, 3. [MANUAL] line 1924 independently says “bonus points (between 1000 and 3000 depending on the STAGE)”, and [SW]'s scoring table gives exactly 1000 / 1500 / 2000 / 3000 for challenge stages 1–2 / 3–4 / 5–6 / 7+. Three sources, one of them the ROM data itself. |
| Perfect bonus        | “10,000 for all 40”                                          | **Correct — but it replaces the per-hit bonus, it is not added to it.**                                                                                                                                                                                       | Confirmed  | [ASM] `game_ctrl.s`, `gctl_chllng_stg_end`: `cp #40 / jr z,l_0699_special_bonus`. The perfect branch loads `a = 100` (×100 points = 10,000) and joins the common adder at `l_06BA`; the non-perfect branch loads `a = hits` and joins the _same_ adder. The two are mutually exclusive. See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| End-of-stage award   | “100 points each”                                            | **100 × number of hits, awarded once at the end of the stage**, not per enemy at the moment of impact. Replaced by a flat 10,000 on a perfect stage.                                                                                                          | Confirmed  | [MANUAL] lines 1939–1948: “after each CHALLENGING STAGE is over, the game gives this display … NUMBER OF HITS / BONUS (The BONUS is 100 times the NUMBER OF HITS.)”, and lines 1925–1936 for the perfect case: “If you can destroy all 40 GALAGAS, you will be awarded a SPECIAL BONUS OF 10000 POINTS … ‘PERFECT !’ flashes / ‘NUMBER OF HITS 40’ / ‘SPECIAL BONUS 10000 PTS’”. [ASM] `game_ctrl.s` `gctl_chllng_stg_end` as above.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Results screen       | “shows the number hit”                                       | Correct: “NUMBER OF HITS” then either “BONUS _n_” or the flashing “PERFECT !” with “SPECIAL BONUS 10000 PTS”. The perfect case also triggers a distinct melody (`b_9AA0 + $14`, “‘perfect!’ melody”) rather than the default challenge-stage melody (`+$0E`). | Confirmed  | [MANUAL] lines 1930–1948; [ASM] `game_ctrl.s`, `gctl_chllng_stg_end`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Script variety       | not mentioned                                                | **8 distinct challenge-stage scripts**, cycling every 8 challenge stages (32 stages), selected by `(stage >> 2) AND 7`. The sprite/colour set cycles on the same index from `d_290E` (8 entries).                                                             | Confirmed  | [ASM] `gg1-3.s`, `d_challg_stg_data_idx` (8 entries), `c_25A2`'s challenge branch, and `c_2896`'s `d_290E` index. Corroborated by the eight distinct bonus-stage illustrations in [SW] _Walkthrough_.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Enemy types seen     | not mentioned                                                | Challenge stages use Bees, Butterflies and Transforms, plus three enemies seen **only** there: Tonbo (dragonfly), Momiji (satellite) and the Enterprise.                                                                                                      | High       | [SW] _Gameplay_, "Bonuses". Single secondary source; harmless if wrong, since the built game uses original designs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Difficulty of aiming | —                                                            | The first two challenge stages can be cleared without moving, from the exact centre of the screen; later ones require up to five firing positions, one per group.                                                                                             | High       | [SW] _Walkthrough_, "Challenging Stage". Useful as an acceptance test: if the Star Swarm build cannot be perfected from a stationary centre position on its first two challenge stages, the paths are wrong.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Per-hit scoring during challenge stages

**Confirmed (code trace).** Challenge-stage enemies **do** award points at the moment of impact, in
addition to the group-of-8 bonus and the end-of-stage bonus, and the value **differs between challenge
stages**.

The collision path has no challenge-stage test anywhere along it. Every hit on a flying bug reaches
`l_0808` ([LIST] sub `$0808`), which increments `ds_bug_collsn_hit_mult[colour]` once and again for a
moving target; `gctl_supv_score` drains all sixteen slots from the background super-loop
`gctl_game_runner` ([ASM] `game_ctrl.s`), which is literally `call gctl_supv_score / call
gctl_supv_stage / jr` and runs on every stage type. `c_2896` ([ASM] `gg1-3.s`) overwrites **both** the
20-object and the 16-object class with one byte from `d_290E`, indexed `(stage >> 2) AND 7`, and at
launch that byte splits into `code = packed AND $78` and `colour = packed AND $07` — and the colour
_is_ the score-group index the accumulator is keyed by.

```
d_290E:  .db 0x36,0x24,0xD4,0xBA,0xE4,0xCC,0xA8,0xF4
```

| Challenge # | Stage | `d_290E`                      | score group   | base | **per hit** |
| ----------- | ----- | ----------------------------- | ------------- | ---- | ----------- |
| 1           | 3     | `$36`                         | 3             | 50   | **100**     |
| 2–8         | 7…31  | `$24,$D4,$BA,$E4,$CC,$A8,$F4` | 2,2,5,2,6,4,2 | 80   | **160**     |
| 9           | 35    | `$36` (wraps)                 | 3             | 50   | **100**     |

Challenge-stage enemies are always flying, so the value is always the doubled one. Note the two
indices have **different periods and different clamps**, which is easy to get wrong: the sprite/score
set is `(stage >> 2) AND 7` with **no clamp** (period 8 challenge stages = 32 stages), while the group
bonus is `(stage >> 3) AND 3` **clamped to 3** from stage 32. Challenge stage 9 is therefore the
50-point sprite set at 100/hit but the maximum 3,000 group bonus.

No floating score sprite is shown for these hits — the flying path skips the `$81` notification write
at `l_07DB` — so the counter moves but nothing rises off the enemy. That is why [MANUAL] and [SW],
which describe what a player sees, mention only the end-of-stage and group bonuses.

**Consequence for the worked total:** a perfect first challenge stage pays 40 × 100 on impact +
5 × 1,000 group + 10,000 perfect = **19,000**, not the 15,000 an impact-free model gives. See
section 11 for the one residual that could move it to 20,200, and `docs/DESIGN.md` section 4.

Source: [ASM] `gg1-5.s` `hitd_dspchr` → `l_081E_hdl_flyng_bug` → `l_07DF` → `l_0808`, [LIST] sub
`$07B4` onward and `$0808`; [ASM] `game_ctrl.s` `gctl_supv_score` and `gctl_game_runner`; [ASM]
`gg1-3.s` `c_2896`, `d_290E` and the launch-time `and #0x78` / `and #0x07` split.

---

## 9. Scoring

Every score value the design plan carries is correct. The mechanism behind them is not what a flat
table implies, and the mechanism is what should be built.

### The ROM's base score table

**Confirmed.** Source: [ASM] `game_ctrl.s`, `d_scoreman_inc_lut` and `gctl_supv_score` /
`c_scoreman_incr_add`.

```
d_scoreman_inc_lut:
       .db 0x10,0x00,0x00,0x00,0x00,0x00,0x00,0x00
       .db 0x50,0x08,0x08,0x08,0x05,0x08,0x15,0x00
```

The [ASM] comment: “Base-factors of points awarded for enemy hits, applied to multiples reported via
`_bug_collsn[]`. Values are BCD-encoded, and ordered by object color group … Indexing is reversed,
probably to take advantage of `djnz`. Index `$00` is a base factor of 10 for challenge-stage bonuses to
which a variable bonus-multiplier is applied (`_bug_collsn[$0F]`).”

Two things to understand about the encoding:

1. **Each byte is added as two digits, at the tens and hundreds places.** `c_scoreman_incr_add` is
   called twice per entry: once with the low nibble applied to the tens digit, once with the high
   nibble applied to the hundreds digit. So `$05` = 50 points, `$08` = 80, `$15` = 150, `$50` = 500,
   `$10` = 100.
2. **The lookup is reverse-indexed.** `gctl_supv_score` walks `B` from `$10` down to 1 while the
   accumulator index walks 0 up to 15, reading `lut[B - 1]`. So accumulator slot _i_ pairs with
   `lut[15 - i]`.

Resolving that gives the base value per colour group:

| Colour group | Base points  | Role                                                                                 |
| ------------ | ------------ | ------------------------------------------------------------------------------------ |
| 0            | —            | green boss (dispatched separately to `l_08CA_hit_green_boss`; a first hit, no score) |
| 1            | 150          | blue boss (second hit)                                                               |
| 2            | 80           | butterfly role                                                                       |
| 3            | 50           | bee role                                                                             |
| 4, 5, 6      | 80 each      | the three transform types                                                            |
| 7            | 500          | red captured fighter                                                                 |
| 15           | 100 per unit | variable bonus accumulator (challenge bonuses, boss escort bonus, trio bonus)        |

### The doubling rule

**Confirmed, and the test is narrower than "moving".** A target scores **exactly twice** its formation
value, and the implementation is literal: the collision dispatcher stashes a flag, and the scoring code
increments that colour's accumulator once, then checks the flag and increments it **again**.

The flag is not a velocity test. The dispatcher stashes `(objectState − 1) AND $FE` ([LIST] sub
`$078D`–`$0792`), so the value is doubled unless the object's state is **1 (at home in the formation)
or 2 (rotating back into its slot after a dive)**:

| State | Meaning                                  | Doubled?                        |
| ----- | ---------------------------------------- | ------------------------------- |
| 1     | at home in the formation                 | **no**                          |
| 2     | rotating back into its slot after a dive | **no**                          |
| 3     | active flight — entering, or mid-dive    | yes                             |
| 7     | spawning                                 | yes                             |
| 9     | diving attack                            | yes                             |
| 4, 5  | exploding / showing its score            | n/a — hit detection skips these |
| `$80` | inactive                                 | n/a                             |

Two consequences a naive "is it moving?" test gets wrong, and both are testable:

- **An enemy shot during the entry waves scores the diving value** (state 3 or 7). A bee-role alien shot
  on its way in is 100, not 50.
- **An enemy that has finished its dive and is rotating back into its slot scores the formation value**
  (state 2), even though it is visibly moving.

Source: [LIST] sub `$078D`–`$0792` for the state test; [ASM] `gg1-5.s`, `hitd_dspchr`
(`ex af,af' ; un-stash parameter … 1 if moving bug`) and `l_0808`; the state codes at [ASM]
`gg1-3.s` (`:907`, `:1768`), `gg1-5.s` (`:1078`, `:2481`) and `gg1-2.s` (`:260`):

```
l_0808:
       ld   hl,#ds_bug_collsn_hit_mult + 0x00
       rst  0x10                                  ; HL += colour
       inc  (hl)
       ex   af,af'
       jr   z,l_0811
       inc  (hl)                                  ; second increment: moving target
l_0811:
```

So: bee 50 → 100, butterfly 80 → 160, transform 80 → 160, captured fighter 500 → 1,000, blue boss
150 → 300.

### Where 400, 800 and 1,600 come from

**Confirmed, and this is the one place where a flat scoring table hides a real mechanic.** A diving boss
does not score from a three-entry table. It scores its base 150 doubled to 300, **plus** an escort
bonus from a three-entry table selected at launch:

```
d_1CFD (at $1D03):
1D03: 0D BA   ; 13 -> 1300, score tile $BA     ; launched with 2 escorts
1D05: 05 B7   ;  5 ->  500, score tile $B7     ; launched with 1 escort
1D07: 01 B5   ;  1 ->  100, score tile $B5     ; launched solo (default)
```

Each first byte is added to the variable bonus accumulator, which pays 100 points per unit. So:

| Boss                  | Base ×2 | Escort bonus    | **Total** |
| --------------------- | ------- | --------------- | --------- |
| diving solo           | 300     | 1 × 100 = 100   | **400**   |
| diving with 1 escort  | 300     | 5 × 100 = 500   | **800**   |
| diving with 2 escorts | 300     | 13 × 100 = 1300 | **1,600** |

Source: [LIST] `$1CC3`–`$1CD6` writes `d_1CFD[ixl]` into the per-boss `bmbr_boss_scode` record at
launch, indexed by the escort count; [ASM] `gg1-5.s` `l_0899`–`l_08AA` reads that record when the boss
dies and adds `.b0` to the accumulator, using `.b1` as the floating score sprite.

**The bonus is fixed at launch, not at death — and it resets every stage.** The per-boss score record
is written in exactly two places: reset to `{$01, $B5}` (solo, 100) for all four bosses **at the start
of every stage** — the write at [LIST] main `$0218` (“set 8 bytes `01B501B501B501B5`”) sits in the
new-stage init routine, immediately after `c_2C00` new-stage setup and `c_25A2` mob setup, not in a
game-start routine — and overwritten at launch from `d_1CFD` ([LIST] main `$1CC6`). Nothing updates it
when an escort dies.

So **killing the escorts first does not reduce the boss's bonus** — a boss that launched with two
escorts is worth 1,600 even if you shoot both escorts before you shoot it — and a boss that reaches a
dive **without having been launched by the bomber launcher is worth 400**, never 800 or 1,600, because
the per-stage reset is the value it carries. Confidence **confirmed**: both write sites are in the byte
listing and the earlier "game start" reading of `$0218` was wrong about which routine it sits in.

### The verified scoring table

| Target                       | In formation | Diving                                                     | Confidence | Source                                                                                                                                 |
| ---------------------------- | ------------ | ---------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Bee role                     | **50**       | **100**                                                    | Confirmed  | ROM base table + doubling rule above; corroborated by [SW] _Gameplay_ scoring table and [AQM].                                         |
| Butterfly role               | **80**       | **160**                                                    | Confirmed  | as above                                                                                                                               |
| Boss, no escorts             | **150**      | **400**                                                    | Confirmed  | as above, plus `d_1CFD`                                                                                                                |
| Boss, 1 escort               | —            | **800**                                                    | Confirmed  | `d_1CFD[1]`                                                                                                                            |
| Boss, 2 escorts              | —            | **1,600**                                                  | Confirmed  | `d_1CFD[0]`                                                                                                                            |
| Transform (individually)     | —            | **160**                                                    | Confirmed  | ROM base table (colour groups 4–6 at 80, doubled since transforms are always flying); matches [SW]'s “Any transform individually 160”. |
| Transform trio, all three    | —            | **1,000 / 2,000 / 3,000** by 4-stage group                 | Confirmed  | [MANUAL] lines 1892–1898; [SW]; section 6.                                                                                             |
| Your own captured fighter    | **500**      | **1,000**                                                  | Confirmed  | [MANUAL] lines 1875–1879; ROM colour group 7 base 500 + doubling.                                                                      |
| Challenge enemy, per hit     | —            | **100** on challenge stage 1, **160** on 2–8, cycling      | Confirmed  | `d_290E` + the doubling rule; section 8. No floating score is shown, but the counter moves.                                            |
| Challenge group of 8         | —            | **1,000 / 1,500 / 2,000 / 3,000** by challenge-stage index | Confirmed  | `d_stage_chllg_rnd_attrib`; section 8. Its index is clamped from stage 32; the per-hit index is not.                                   |
| Challenge stage, all 40      | —            | **10,000**, replacing the 100 × hits bonus                 | Confirmed  | `gctl_chllng_stg_end`; section 8.                                                                                                      |
| Challenge stage, not perfect | —            | **100 × hits**, at stage end                               | Confirmed  | [MANUAL] line 1948; `gctl_chllng_stg_end`.                                                                                             |

Worked example for a perfect first challenge stage (stage 3): 40 hits × 100 on impact = 4,000, plus
five groups × 1,000 = 5,000, plus the 10,000 perfect bonus that _replaces_ the 100 × hits end-of-stage
award = **19,000**. (The one residual in section 11 could move this to 20,200; 19,000 is what
`docs/DESIGN.md` and the Classic pack build to.)

---

## 10. Stage badges, and what happens at the end

| Claim               | Design plan says                   | Verified value                                                                                                                                                                                                                                                                                                                             | Confidence | Source                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Badge denominations | 1, 5, 10, 20, 30, 50, bottom-right | **Correct.** A combination of badges sums to the current stage number.                                                                                                                                                                                                                                                                     | Confirmed  | [SW] _Gameplay_, "Stage Indicators", which tabulates exactly 1, 5, 10, 20, 30, 50 and works an example (“stage 99 will be shown by 50+30+10+5+4 level 1 indicators. Then for stage 100, 2x50 stage indicators”); [AQM] independently lists “1, 5, 10, 20, 30, and 50”. Two independent secondary sources in exact agreement; no source disagrees.                                     |
| Upper limit         | not mentioned                      | Badges are shown up to stage 255. Around stage 200 the badge row starts overlapping the reserve-ship icons if you are holding 8 — a cosmetic glitch in the original.                                                                                                                                                                       | Medium     | [SW] _Gameplay_, "Stage Indicators". Single secondary source; cosmetic, and Star Swarm need not reproduce it.                                                                                                                                                                                                                                                                         |
| Stage 256           | not mentioned                      | The stage counter wraps to 0 and the game misbehaves, differently per rank: on Easy it resets; on Medium stage 0 plays as a cross between the second challenge stage and a normal level where enemies shoot; on Hard “Stage 0” stays on screen forever with no enemies; on Hardest stage 0 plays like stage 1 but at stage-255 difficulty. | Medium     | [SW] _Walkthrough_, "Stage 256". Single secondary source, but consistent with the ROM's arithmetic: both the bomber-config fold and the wave-script fold assume an 8-bit stage counter, and the challenge test `(stage + 1) mod 4` makes stage 0 a non-challenge stage with an index of −1. Star Swarm should simply not have this bug; recorded so nobody reproduces it by accident. |

---

## 11. Unresolved items

All four items originally listed here were closed by a second pass, and their findings are folded into
the sections above: the formation sway and breathe parameters (section 5), per-hit scoring on challenge
stages (section 8), whether more than one captured fighter can be held (section 7), and the starfield
speed byte → visible scroll rate (section 2). **One narrower question remains.**

1. **Do the four boss-class objects of challenge-stage wave 2 keep the boss sprite and score group 0?**
   Every stage's 40 objects come from `db_attk_wav_IDs` ([ASM] `gg1-3.s`), whose wave 2 is
   `30 34 36 32 | 50 52 54 56` — four boss-class objects. `c_2896` gives the boss class a fixed
   code/colour (`ld ixh,#(0x08+0x0)*2`) on **every** stage including challenge stages, and `c_25A2`
   resets the wave-ID pointer to the top of the table at every stage, so wave 2 of a challenge stage
   appears to contain four **two-hit, 400-point bosses**: the first hit scores nothing and turns them
   group 1, the second scores 150 × 2 plus the 100-point solo escort record that every stage start
   installs. The eight [SW] challenge-stage screenshots are consistent with it — `Galaga_bonus2.png`
   shows four of one type and four of a visibly different type, which under this model can only be
   wave 2 — but no source describes two-hit enemies on a challenging stage, and the left group could
   not be identified as the boss sprite by eye. _Test:_ on stage 3, fire one shot at each enemy of the
   second group of eight and note whether any survives; if one does, the group is the boss class.
   Thirty seconds in an emulator, and also answerable from a clear video of a challenging stage.

   **It moves a perfect challenge stage 3 between 18,600 and 20,200 points**, against the 19,000 that
   `docs/DESIGN.md` and the Classic pack build to:

   | Model                                       | per-hit | 5 × group | perfect | total      |
   | ------------------------------------------- | ------- | --------- | ------- | ---------- |
   | all 40 at 100 (**what Star Swarm authors**) | 4,000   | 5,000     | 10,000  | **19,000** |
   | 36 at 100 + 4 bosses at 400                 | 5,200   | 5,000     | 10,000  | 20,200     |
   | 36 at 100, 4 boss-class objects worth 0     | 3,600   | 5,000     | 10,000  | 18,600     |

   This does not block Milestone 2. Star Swarm's challenge stages are authored content — five waves of
   eight slots — so whichever way the observation lands, the engine rule (per-hit = group base × 2 for
   anything not at home or returning) is the part that must be right, and which aliens a challenge
   stage contains is one line of pack data.

Two smaller things were looked at and deliberately not chased, because nothing depends on them: the
`f_2000` "wings closed" rescue branch (section 7), and the mapping from each of the thirteen entry
scripts to one of the three shapes a player perceives, which needs the `db_2A3C` → `db_2A6C`
flight-vector programs decoded (section 5).

---

## 12. Things that affect the build beyond the listed claims

Ordered by how much they cost to get wrong.

1. **The difficulty ramp is a table, not a curve, and it plateaus by cycling.** Ten integers per stage
   × 26 stages × 4 ranks, non-monotonic, with stages 27+ reusing rows 23–26 forever. A schema that
   models difficulty as a formula or a monotonic curve cannot express this. See section 6.
2. **Entry waves are a script library with a per-rank selection sequence.** Thirteen combat scripts,
   eight challenge scripts, selected by a 17-entry per-rank index list and a separate fold constant
   (23, not the 27 used by the difficulty table). Two different plateau points in the same game. See
   section 5.
3. **The difficulty rank is not a multiplier — it selects whole tables.** It picks both the bomber
   parameter sub-table and the entry-script sequence. Rank therefore belongs in the rules layer as a
   selector over whole data sets rather than in the player-settings layer as a scalar, and the Classic
   pack has to ship all four tables.
4. **Waves are mixed-type and identity-addressed.** A wave is eight specific object slots, and wave 2
   is 4 bosses + 4 butterflies. A stage schema that describes a wave as an alien type plus a count
   cannot express that; a wave record needs an ordered per-slot list.
5. **There is a global enemy bullet cap of 8.** Easy to overlook, and a first-order contributor to how
   the game feels. Each enemy also carries its own inter-shot delay.
   See section 4.
6. **The dual fighter does not double the shot cap.** Two logical shots remain the limit; each becomes a
   two-bullet spread with two hit windows 15 px apart and a 4 px dead gap between them. Building it as
   “four shots on screen” would make the dual fighter markedly stronger than the original. See
   section 3.
7. **Capture of your last fighter ends the game.** A distinct loss condition, easily missed, and one
   that changes the capture state machine. See section 7.
8. **The simulation is not uniformly per-frame.** Enemy _object state_ advances on a four-frame round
   robin at 15 Hz with objects split across frames, while player movement and shot motion run every
   frame and enemy sprite motion is driven separately from a motion queue. (The 15 Hz figure is for the
   state supervisor `f_23DD` specifically — it is not a claim that enemies visibly move at 15 Hz.) A strictly uniform 60 Hz update of everything will not reproduce the original's dive
   cadence exactly. This does not threaten the “deterministic, fixed-step, replayable” property — a
   fixed 60 Hz step with a frame counter driving a 4-phase enemy update is still fully deterministic —
   but the phase structure has to be in the design from the start rather than retrofitted. See
   section 2.
9. **Scoring is base × moving-multiplier plus a bonus accumulator, not a flat lookup.** Reproducing the
   arcade numbers is easy either way; reproducing them _for the right reasons_ matters because the boss
   escort bonus is latched at launch, so killing escorts first does not reduce the boss's value. A flat
   table would get that case wrong. See section 9.
10. **A perfect challenge stage awards 10,000 instead of 4,000, not in addition.** An easy 4,000-point
    error per perfect challenge stage. See section 8.
11. **Extra-life thresholds depend on the starting-ship count.** Two threshold tables, not one, or a
    triple plus a `none` option. See section 3.
12. **Recorded arcade footage may be from a partially disarmed game.** [CA] notes that ordinary play
    clogs enemy bullet slots. If anyone tunes Star Swarm's aggression by comparing against video, this
    can make the original look easier than it is. See section 4.
