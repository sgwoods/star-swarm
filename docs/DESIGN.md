<!-- doc:layer vision -->

# Star Swarm — Vision & Design Plan

*Working title. A 1981-arcade-style formation shooter that plays like the classic, plus a content system that lets you prompt new aliens, stages and movements into existence.*

Captain: Steven · Plan version 1 · 2026-09-24

> **What this document is, and what it is not.** This is the captain's plan: why the project exists, the ground rules it is built under, and the arcade behaviour it is aiming at. It is written in **intent tense** and **asserts nothing about what the code currently is** — that is the whole of its contract, and the reason the file listing it used to carry named three modules nobody ever wrote.
>
> - What exists today, and how to run it: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md). Every factual claim there is machine-checked.
> - What is next, and in what order: [`docs/ROADMAP.md`](ROADMAP.md).
> - Directions nobody has committed to: [`docs/IDEAS.md`](IDEAS.md).
> - Why an arcade number is the number it is: [`docs/reference/arcade-reference.md`](reference/arcade-reference.md).
>
> Section 4 is present tense, and that is not a contradiction: its claims are about the **arcade original**, which no test in this repository can reach. The reference is their verification record, and `tests/unit/classic-pack.test.ts` holds the shipped pack to it. `AGENTS.md` states the rule an author meets here.

---

## 0. Where this plan came from

The captain wrote it outside the repository and handed it to firstmate in one message, which asked for a private `star-swarm` project in direct-PR mode, for this document to be copied in as `docs/DESIGN.md`, and for Milestone 0 to start with the scout task and the scaffold task in parallel. After each milestone: review the pull requests, play the build (`npm run dev`), then say "start Milestone N".

It has been a living document since. It is edited when a verified finding changes the spec, and the milestone schedule it originally carried in section 10 now lives in [`docs/ROADMAP.md`](ROADMAP.md).

---

## 1. Vision and pillars

1. **Faithful feel first.** Movement speeds, formation behaviour, dive attacks, capture-and-rescue, challenge stages, scoring and difficulty should feel like the arcade original to someone who played it.
2. **Everything is data.** Aliens, flight paths, stages, sprites, sounds and rules live in content packs (JSON), not hard-coded logic. The classic game is itself just the built-in "Classic" pack.
3. **Prompt → playable.** A single sentence ("a stage where jellyfish aliens split in two when hit and swirl in figure-eights") becomes a validated content pack you can play in minutes.
4. **Deterministic and testable.** Fixed 60 Hz timestep, seeded RNG, replayable input logs — so agents can prove behaviour with automated tests, not just eyeballing.

## 2. Ground rules (read before building)

Game mechanics are fair to recreate; the original's **art, audio, name and logo belong to Bandai Namco**. So:

- Use an **original title** (Star Swarm or similar), original sprite art, and original synthesized sound effects/music that capture the *style* (chunky 16×16 pixel sprites, bright limited palette, chirpy square/noise-channel audio) without copying specific sprites or tunes.
- Never import ROM data, ripped sprites, sampled audio, or the original logo/font.
- Enemy archetypes get original names (e.g. *Drone*, *Wing*, *Warden*), mapped to the classic roles (bee, butterfly, boss).

## 3. Tech stack (defaults — override in section 12)

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript | Types double as content-schema documentation |
| Runtime | Browser, HTML5 Canvas 2D | Zero install, easy to test and share |
| Build | Vite | Fast dev server, simple |
| Rendering | Logical 224×288 portrait canvas, integer-scaled, nearest-neighbour | Arcade-accurate proportions, crisp pixels |
| Audio | Web Audio API with a small parametric synth (sfxr-style) | Sounds definable as data, so prompts can make them |
| Validation | Zod (or JSON Schema) | One source of truth for pack validation |
| Tests | Vitest (unit + headless simulation), Playwright (smoke) | Deterministic sim runs without a browser |

## 4. Arcade-faithful core spec

The values in this section have been verified against the original's 1981 operator manual and a byte-exact ROM disassembly. `docs/reference/arcade-reference.md` is the verification record: it carries the source, the ROM routine or data table, and a confidence note behind every number here, plus the one item that remains unresolved. Change a number here and the reference changes with it, or the two drift apart silently.

**Screen and timing**
- 224×288 logical playfield, fixed-step simulation, rendering decoupled. The arcade original runs at 60.6061 Hz (6.144 MHz pixel clock / 384 × 264); we run a fixed 60 Hz step and accept the 0.6% difference. Enemy object state in the original advances on a four-frame round robin (15 Hz) with objects split across frames, so the sim exposes a frame counter and a four-phase enemy update rather than updating every enemy every frame.
- Scrolling multi-colour starfield background that pauses during certain transitions, and whose scroll speed rises with stage number: the original sets a speed byte to `0x40 + 0x10 × min(⌊stage / 4⌋, 4)` and scrolls `byte / 64` pixels per frame — 1.00, 1.25, 1.50, 1.75, 2.00 px/frame, plateauing from stage 16 — dithered to whole pixels each frame and ramped one byte-unit per frame on a change, so a stage transition eases into the new speed rather than jumping. The stars stop when the player's ship is off screen and reverse at 3 px/frame while a tractor beam is pulling the ship in. The star field also twinkles by swapping which pair of four star banks is drawn, every 8 frames.

**Player**
- Horizontal movement only, along the bottom row; no acceleration. The original steps alternately 1 and 2 pixels per frame while the stick is held — 1.5 px/frame average, ≈ 91 px/s — and the first frame of any new movement is always a 1-pixel step. X limits are `0x12`…`0xE1` for a single fighter and `0x12`…`0xD1` for a dual fighter, whose second ship is drawn at X + 15.
- **At most 2 player shots on screen** at once — this cap defines the game's rhythm, and it is 2 in total, *not* 2 per ship. A dual fighter still has only 2 shots in flight; each one becomes a two-bullet spread (the original draws one rocket object with the hardware double-width flag). Hit detection follows: a single fighter's shot has one hit window, Δx ∈ [−5, +5]; a dual fighter's shot has two, Δx ∈ [−6, +4] and Δx ∈ [+9, +19], with Δx ∈ [+5, +8] deliberately dead.
- Holding the fire button fires continuously — the original has no edge detection, so the fire rate is set entirely by the 2-shot cap and how fast shots leave the screen. This is inherent behaviour, not an option.
- 3 lives by default (switch-selectable 2/3/4/5); extra lives at 20,000 and 70,000, then every 70,000 — confirmed as the factory default. Configurable: the original offers eight threshold settings, and the available set depends on the starting-ship count (a 5-ship cabinet gets 30,000 / 120,000 / every 120,000 as its default). The rules layer models this as first threshold, second threshold, repeat interval, plus a `none` option, all in units of 10,000. The award test compares `floor(score / 10000) mod 100` against the pending threshold, so awards stop once the running threshold passes 99: with the factory default the **last extra life is at 980,000**. The score itself does not roll over there.

**Enemies and formation**
- 40 enemies per normal stage: 4 bosses (2 hits: first hit changes colour), 16 butterfly-role, 20 bee-role.
- Formation grid, confirmed against the original's home-slot table: 4 bosses in the top row at column positions 6, 8, 10, 12; two rows of 8 butterfly-role aliens at columns 2, 4, 6, 8, 10, 12, 14, 16; two rows of 10 bee-role aliens at columns 0, 2, 4 … 18. The butterfly rows are inset one column position on each side relative to the bee rows. Four further slots, one per boss, sit one row above the boss row in the bosses' own columns and hold captured fighters.
- Enemies **enter in five scripted waves of eight** along curved paths, then settle into slots. Waves are mixed-type and identity-addressed — wave 1 is 4 butterfly-role + 4 bee-role, wave 2 is all 4 bosses + 4 butterfly-role, wave 3 is 8 butterfly-role, waves 4 and 5 are 8 bee-role each. Each wave launches aliens in pairs; per-alien flags select a mirrored path and whether the second of a pair is delayed into a trailing single file. The original holds 13 distinct combat wave scripts and 8 challenge scripts, selects a combat script per stage through a 17-entry sequence that depends on the difficulty rank, and plateaus from stage 24 by cycling its last three. Players perceive three broad shapes: entry from both sides at once in short single-file rows; entry from one side at a time in double-width rows; entry from one side at a time in a single long row. The shapes recur on a four-stage period. See `docs/reference/arcade-reference.md` section 5 for the selection rule and the per-stage script table.
- While filling, the formation **sways side to side** as a rigid body: ±32 px, 1 px every 4 frames, a triangle wave of period 512 frames. The sway stops only when the last wave has arrived *and* the formation passes back through centre, so diving always starts from a centred formation. Once full it **"breathes"**: a 256-frame cycle (128 frames out, 128 back) that moves each of the 10 column and 6 row coordinates by a different amount — 32/25/18/11/4 px outward per column pair and 0/4/11/18/25/32 px downward per row — so every gap widens by a uniform 7 px and the formation reaches the screen edges at full expansion. The formation is 10 column X values and 6 row Y values; enemies address them by index, and only those 16 values move. Neither motion runs on a challenge stage.
- From the formation, enemies peel off in **dive attacks**: bees swoop and loop, butterflies dive in arcs, bosses dive with up to 2 escorts.
- Enemies fire during dives, and during entry from stage 2 onward — there is no entry bombing on stage 1. **At most 8 enemy bullets exist on screen at once, globally**, and each enemy carries its own inter-shot delay. Bullet enable flags and per-type launch rates come from the per-stage difficulty table.
- Divers that leave the bottom re-enter from the top and rejoin the formation.
- **An enemy's body kills the fighter.** The original's manual advertises it — "if they can't bomb you, they'll ram you in the rear" — and it is the same hit detection a bomb goes through: one routine, the fighter's own window (Δx ∈ [−6, +6], Δy ∈ [−6, +6] in playfield pixels), run once per ship so a dual fighter is tested twice and loses only the half that was hit. It costs a fighter, and it is the same loss as being shot rather than a new one; on the readings `docs/reference/arcade-reference.md` section 3 takes it **scores nothing and the enemy flies on**, and there is **no distinction between a diver and an enemy at home** — the collision path carries no state test, unlike the scoring path. Nothing collides on a challenge stage, because a body is an attack.

**Capture and rescue**
- A boss may dive partway and emit a **tractor beam**; if it catches the player, that ship becomes a captured (red) fighter sitting beside the boss in formation.
- Destroying that boss while both it and the captured ship are attacking releases the captured ship, which docks beside the player → **dual fighter** (two ships, a two-bullet spread per shot, and two separate hitboxes). Killing the boss *before* it has finished pulling the ship in does not trigger a rescue. On rescue, enemies already in mid-dive return to formation, and the freed ship is invulnerable to the player's own shots while it spins into place. A green boss needs two hits; a blue one needs one.
- Destroying the boss while it is in formation turns the captured ship into a hostile *rogue fighter*: it dives at the player once, exits the bottom of the screen, and does not return during that stage. It re-enters as the last ship of the next stage's entry wave and takes its place at the top of the formation — which players use deliberately to park a captured fighter until a boss can claim it again. Shooting a captured ship destroys it, scoring 500 while it sits in formation and 1,000 while it is attacking.
- A hit on either half of a dual fighter leaves a single ship. **Being captured while playing your last fighter ends the game.** A captured fighter stays with the boss that took it for the rest of the game — it is not released at stage end. The original holds **at most one captured fighter at a time**, enforced by a single global flag that is set when a capture boss launches and cleared only when the captured fighter is destroyed, when the capture attempt fails, or when a rescued dual fighter loses a half. So while a fighter is captured — including while it is parked as a rogue — no further capture attempt occurs, and a dual fighter is never targeted. That enforcement is a rule worth reproducing, because it decides when capture attempts happen at all. The four home slots are one per possible captor, not four simultaneous captives. The rules layer models capture as one channel with an explicit state machine; see `docs/reference/arcade-reference.md` section 7.
- While a boss has connected with the player's ship, the player's fire is disabled.

**Challenge stages**
- Stage 3, then every 4th stage (7, 11, 15…).
- 40 enemies in 5 groups of 8 fly scripted patterns and **never shoot or attack**.
- The original holds 8 distinct challenge-stage scripts, cycling every 8 challenge stages, with the enemy sprite set cycling on the same index. The first two are clearable from a stationary centre position; later ones need up to five firing positions, one per group — a useful acceptance test for the paths.
- Each enemy destroyed also scores at the moment of impact, at the challenge stage's own value: **100 on the first challenge stage and 160 on the second through eighth**, cycling with a period of eight challenge stages. No floating score is shown for these hits, but the counter moves.
- A group bonus for clearing a whole group of 8: 1,000 on the first two challenge stages, 1,500 on the third and fourth, 2,000 on the fifth and sixth, 3,000 on the seventh and all later ones — and this index is clamped at 3,000 from stage 32 on, while the per-hit value keeps cycling. At the end of the stage, a bonus of 100 × number of hits — **or**, if all 40 were destroyed, a flat **10,000 that replaces it** rather than adding to it. So a perfect first challenge stage pays 40 × 100 + 5 × 1,000 + 10,000 = **19,000**.
- Results screen shows the number hit.

**Scoring**

| Target | In formation | Diving |
|---|---|---|
| Bee-role | 50 | 100 |
| Butterfly-role | 80 | 160 |
| Boss | 150 | 400 alone · 800 with 1 escort · 1,600 with 2 escorts |
| Transformed-enemy, individually | — | 160 |
| Transformed-enemy trio, all 3 (later stages) | — | 1,000, then 2,000, then 3,000, cycling on a four-stage period |
| Your own captured fighter | 500 | 1,000 |
| Challenge-stage enemy, per impact | — | 100 on the 1st challenge stage · 160 on the 2nd–8th, cycling |
| Challenge-stage group of 8 | — | 1,000 · 1,500 · 2,000 · 3,000 by challenge-stage index |
| Challenge stage, at stage end | — | 100 × hits, or a flat 10,000 for all 40 (replacing it) |

The table is the output of a rule, and the **rule** is what to build: a base value, **doubled when the target is moving**, plus a bonus. Base values are bee-role 50, butterfly-role 80, transform 80, boss 150 (on the hit that destroys it) and captured fighter 500. A diving boss then adds 100, 500 or 1,300 for 0, 1 or 2 escorts, giving 400 / 800 / 1,600. That escort bonus is **latched when the boss launches** and reset at every stage start, so destroying its escorts first does not reduce the boss's value — a flat lookup table would get that case wrong. The doubling test is on the alien's state, not its velocity: it applies to everything except an alien at home in the formation or rotating back into its slot after a dive — so an alien shot during the entry wave scores the diving value, and one shot while returning to its slot scores the formation value. Every bonus in the game — escort, transform trio, challenge group, challenge stage end — is the same channel at 100 points per unit, which is why they are all multiples of 100 and why they can arrive interleaved.

**Difficulty ramp and later stages**
- Dive frequency, bullet enables and simultaneous-diver limits come from a per-stage table, not a curve: 26 stages × 4 difficulty ranks, ten small integers per stage (bomb-drop enables, per-type launch rates for bee/butterfly/boss roles, max simultaneous divers and a later bump to it, the tractor beam's step period in frames (12 at stage 1 down to 3 from stage 20, so the beam pulls four times faster late), the remaining-enemy threshold at which continuous bombing starts, and two flight-vector reload flags). The table is **not monotonic** — several stages are deliberately easier than the one before — and it plateaus from stage 27 by cycling rows 23–26 forever. “The last few enemies get more aggressive” is that continuous-bombing threshold, which rises from 6 remaining enemies at stage 1 to 12 by stage 22. The full table is reproduced in `docs/reference/arcade-reference.md` section 6.
- From stage 4, **once per stage**, and only once **fewer than 10 enemies remain**, one bee-role alien — or a butterfly-role one if no bees remain — **transforms** mid-dive into a trio of a different enemy type. The trio dives, fires on the way down, loops once and exits; unlike bees it does not re-enter from the top. The trio type cycles on a four-stage period through three distinct types, and so does the all-three bonus: 1,000, then 2,000, then 3,000. Each transform destroyed individually is worth 160. (Star Swarm names its three types itself; the original's are recorded in `docs/reference/arcade-reference.md` section 6.)
- Stage-number badges shown bottom-right in denominations 1, 5, 10, 20, 30, 50.

**Game flow**
- Attract mode (demo play and scoring table), the demo played by the game's own autoplay personas in turn, each named out of the way of play; a 1-player start, "STAGE N" and "READY" interstitials, and a game-over results screen showing shots fired, hits and hit ratio.
- High-score table with 3-letter initials, stored locally.

## 5. Look and sound

- **Sprites:** original 16×16 designs in a limited palette (about 3 colours plus transparent per sprite), 2-frame wing flap animations, 4-frame explosions. Defined as data (section 7.4) so they're promptable.
- **Palette:** saturated arcade colours on black; a global palette per pack.
- **Fonts:** original 8×8 pixel font in the arcade spirit.
- **Sound:** parametric synth voices (square, triangle, noise, pitch sweeps). Original short jingles for start, stage start, capture, rescue and challenge results. All defined as data.
- **CRT option:** optional scanline/curvature shader, off by default.

## 6. Configuration system

Three layers, applied in order and overridable per stage:

1. **Engine rules** (`rules.json`): lives, extra-life thresholds, shot cap, the player's movement cadence and travel limits, the fighter and shot geometry and their hit windows, the enemy bullet, the enemy update cadence, the formation's sway and breathe, the playfield, the backdrop speed formula, the **difficulty rank** and the per-rank difficulty tables it selects, challenge-stage cadence, capture enabled, dual-fighter enabled, score table. This is the whole of what the simulation steps: `src/sim/` is handed a resolved rules value and holds no constants of its own, so a number that is not here is a number no pack can change. Each value may also carry a `provenance` entry marking it **verified** (a source carries the routine behind it) or **provisional** (it is ours), because the two are not equally free to change.
2. **Content packs** (`packs/<name>/`): aliens, paths, stages, sprites, sounds, a stage sequence.
3. **Player settings** (in-game menu): volume, CRT filter, controls, difficulty preset, active packs.

**Difficulty rank is a rules-layer selector, not a player-settings scalar.** The original's rank (A/B/C/D, factory default A) does not scale anything: it chooses *which* per-stage difficulty table is in force **and** which entry-wave script sequence is used, and the two even plateau at different stages. Modelling it as a multiplier applied on top of one data set cannot reproduce that, so rank lives in layer 1 as a name that selects whole data sets. The player-settings difficulty preset stays in layer 3, but all it does is choose the rank the rules layer then resolves.

The Classic rules therefore ship **all four rank tables**, not one table plus three multipliers.

A **"Classic" pack plus classic rules** reproduces the arcade game. Other packs can extend or replace it (e.g. a "Classic + Weird" mix that inserts new stages every 5th level).

**The content and rules model is a shared platform, not Star Swarm's private format.** Star Swarm is the first game in an arcade lineage and is expected to be joined by siblings — other formation shooters of the same era and category, built as another pack plus another `rules.json` and nothing else. So the engine-side types in `src/content/` carry no knowledge of this game: enemy roles are ids a pack declares rather than a fixed set, per-role numbers in the rules are keyed by those ids, formations and scoring rules are data, and every difficulty or sequence table is literal rows with its own plateau. Where a shape could fit the arcade original exactly or also admit a sibling game, the platform takes the second. The second mode itself is tracked separately and is not designed here.

## 7. Content model (what prompts generate)

All of these are JSON validated by schemas in `src/content/schema.ts`.

**The examples below are illustrative, and deliberately not a copy of the schema.** They state the *shape* a document has to be able to express — why a wave is an ordered list of slots rather than a type plus a count, why a score carries a base value only — which is the part that is a design decision. Field names, defaults and which keys are required are the schema's, and the schema is the only place they are true; an example here that drifted from it would be a plan asserting something about the code, which this document does not do. For a document that really loads, read the shipped ones under `packs/classic/`.

### 7.1 Alien

```json
{
  "id": "jellyfish",
  "role": "butterfly",
  "hp": 1,
  "sprite": "jellyfish",
  "score": { "base": 80 },
  "fire": { "pattern": "aimed", "shotsPerDive": 2 },
  "dive": { "paths": ["swirl8"], "weight": 1.0 },
  "abilities": [{ "type": "splitOnHit", "into": "jellyling", "count": 2 }],
  "sounds": { "dive": "wobble", "death": "pop" }
}
```

`score` carries the **base** value only: the diving value is the base times the rules layer's moving multiplier, plus any bonus. Section 4 explains why — a flat formation/diving pair cannot express a boss's escort bonus, which is latched at launch.

### 7.2 Movement path

Paths are **segment lists** interpreted by the engine. They're easy for a model to write and easy to preview.

```json
{
  "id": "swirl8",
  "mirror": true,
  "segments": [
    { "type": "bezier", "to": [112, 160], "c1": [20, 40], "c2": [200, 80], "speed": 1.6 },
    { "type": "loop", "radius": 24, "turns": 1, "dir": "cw" },
    { "type": "lissajous", "ax": 30, "ay": 20, "fx": 2, "fy": 1, "duration": 120 },
    { "type": "aimAtPlayer", "speed": 2.2 },
    { "type": "exitBottom" }
  ]
}
```

Segment types: `line`, `bezier`, `arc`, `loop`, `lissajous`, `sine`, `wait`, `aimAtPlayer`, `toSlot` (return to formation), `exitBottom`, `fire`, and `trigger` (fires an ability).

### 7.3 Stage

```json
{
  "id": "jelly-bloom",
  "kind": "normal",
  "formation": "classic40",
  "waves": [
    { "at": 0, "entryPath": "swirl8", "spacing": 10, "slots": [
      { "alien": "jellyfish", "mirror": false, "trailing": false },
      { "alien": "jellyfish", "mirror": true,  "trailing": false },
      { "alien": "drone",     "mirror": false, "trailing": true  }
    ] },
    { "at": 150, "entryPath": "classicLeftHook", "spacing": 8, "slots": [ "…8 slots…" ] }
  ],
  "diveRules": { "maxConcurrent": 3, "intervalFrames": [60, 180] },
  "modifiers": { "enemyBulletSpeed": 1.1 }
}
```

`kind` is `normal`, `challenge`, or `boss` (later).

**A wave is an ordered list of slots, not a type plus a count.** The original's waves are mixed — wave 1 is 4 butterfly-role + 4 bee-role, wave 2 is all 4 bosses + 4 butterfly-role — and each alien in an entry pair carries its own **mirror** flag (does it fly the mirrored variant of the path) and its own **trailing** flag (does it follow the first of the pair rather than launching alongside it). A `{ "aliens": [...], "count": 8 }` shape cannot express either, so a wave carries a per-slot array of `{ alien, path, mirror, trailing }`, with `entryPath` and `spacing` as wave-level defaults each slot may override. Milestone 1 settles the exact field names and which defaults are required; the shape above is the constraint it has to satisfy.

**Per-stage difficulty is a rank-keyed table, not a curve.** The Classic rules carry four tables — one per rank — of 26 stage rows each, every row holding the same handful of small integers (bomb-drop enables, per-type launch rates for the bee, butterfly and boss roles, max simultaneous divers and a later bump to it, the tractor beam's animation step period in frames — 12 falling to 3, which is what makes a late capture hard to escape rather than merely more likely — the continuous-bombing threshold, and the flight-vector reload flags). The tables are **not monotonic**: individual rows are deliberately easier than the row before, so a schema that interpolates or extrapolates a curve cannot hold them, and they must be stored as literal rows. **Plateau behaviour is part of the data, not a fallback:** past the last row the original does not freeze at maximum difficulty and does not keep climbing — it cycles the last four rows forever (stage 27 replays row 23, stage 28 row 24, and so on). The entry-wave script sequence plateaus the same way but on a different period, cycling its last three from stage 24, so the schema states each table's plateau independently rather than assuming one global end-of-ramp rule. See `docs/reference/arcade-reference.md` sections 5 and 6 for the tables themselves.

### 7.4 Sprite and sound

```json
{ "id": "jellyfish", "size": 16, "palette": ["#0000", "#7df", "#f6c", "#fff"],
  "frames": [["................", "......1111......", "..."], ["..."]] }
```

```json
{ "id": "wobble", "wave": "square", "freq": [440, 220], "vibrato": { "rate": 8, "depth": 0.3 }, "envelope": [0.01, 0.1, 0.2] }
```

### 7.5 Abilities: data vs code

Abilities are a **fixed registry of engine behaviours** (`captureBeam`, `splitOnHit`, `transform`, `shield`, `teleport`, `spawnMinions`, `mirrorPlayer`…) that packs switch on and tune with parameters. Prompts compose from this registry. When a prompt needs something the registry lacks, the generator says so and proposes a **new-ability ship task** for firstmate. That keeps generated content safe and valid while letting the engine grow.

## 8. Prompt → content pipeline

1. **Forge skill in the game repo** (`.claude/skills/forge/`): `/forge "a stage where…"` makes Claude Code write a new pack or additions (aliens, paths, stages, sprites, sounds) under `packs/`, following the schemas and the ability registry.
2. **Validator** (`npm run validate-packs`): schema check, reference check (every sprite/path/sound exists), and **playability checks** via headless sim (paths stay on screen, stage is clearable, no unavoidable bullet walls, stage finishes within a time limit).
3. **Preview harness** (`/lab` route in the dev build): pick any path, alien, sprite, sound or stage and see or hear it in isolation, with a scrubber and a mirror toggle.
4. **Pack loader**: the game menu lists installed packs and a stage-sequence editor, so new content can be mixed in or played directly.
5. **Firstmate loop:** "forge 3 new stages themed around deep-sea creatures" becomes a firstmate ship task that runs `/forge`, validates, attaches preview GIFs, and opens a PR for you to approve.
6. **Later (optional):** an in-game "Forge" box that calls the Claude API directly, with the same validator gate. It's deferred because it needs API-key handling.

## 9. Architecture (split so crewmates don't collide)

Six directories under `src/`, each with one job. This section fixes the **split** and the rule that holds it; it deliberately names no modules, because which files exist is a fact about the tree rather than a decision in a plan — and a file listing here is exactly how this document came to name three modules nobody ever wrote. [`docs/ARCHITECTURE.md`](ARCHITECTURE.md#3-the-layers) is the as-built listing, checked against the tree; [`docs/ROADMAP.md`](ROADMAP.md) carries the modules this plan calls for that are still unwritten.

| Directory | What belongs there |
|---|---|
| `src/engine/` | The fixed step, the seeded RNG, abstract input, input recording and replay. Knows nothing about this game, or any game |
| `src/sim/` | The world and one step of it: the player, shots, collisions, lives, enemies, the formation, the path interpreter, dives, challenge stages, capture, and one file per engine ability under `abilities/` |
| `src/content/` | The content platform: the schemas, the loader, the registry, and the reader of the rules layer |
| `src/render/` | The 224×288 canvas, sprite rasterisation, the pixel font, the starfield, and the optional CRT filter |
| `src/audio/` | The parametric synth, the event-to-sound map, and music |
| `src/ui/` | The game-flow state machine, attract mode, menus, the HUD, results, high scores, and the `/lab` harness |

Outside `src/`: `packs/` holds one directory per content pack, each a `pack.json` manifest plus the **five content directories** — `aliens/`, `paths/`, `stages/`, `sprites/`, `sounds/` — and an optional `rules.json`. `tests/` splits into `unit/`, `sim/` (headless golden replays) and `e2e/`. `docs/` holds this plan, the state and roadmap documents beside it, the arcade reference, and the content guide Milestone 4 writes.

**Key rule:** `sim/` never touches the DOM, Canvas or Audio. Sim emits events; render and audio subscribe. That's what makes headless tests and replays possible.

## 10. Milestones and crew tasks

**The milestone schedule lives in [`docs/ROADMAP.md`](ROADMAP.md).** It was written here, and it moved: a milestone list is the one part of a plan that has a *status*, and a status is a claim about what exists — which is the mix that let this document rot. The roadmap keeps every milestone and every task this plan set out, states what is next in future tense, and hands the question "what is actually done" to [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), where it is checked.

The shape of the schedule is unchanged and is worth stating once here, because the rest of this plan is written against it: **Milestone 0** foundations (the arcade reference scout, and the scaffold); **Milestone 1** a playable core; **Milestone 2** the classic game; **Milestone 3** configurable — the rules layer's player-facing half, the pack manager, the ability registry and playability checks; **Milestone 4** the prompt forge; **Milestone 5+** keep expanding. Tasks within a milestone run in parallel. **Ship** tasks change code; **scout** tasks produce reports.

## 11. Quality bar

- Every sim feature ships with a headless test; key flows (capture → rescue → dual, challenge perfect bonus, extra life award) get **golden replay tests** from recorded inputs and seeds.
- `npm run validate-packs` must pass in CI; a pack that fails validation never loads.
- Each PR touching visuals or audio includes a short GIF or clip from `/lab`.
- Performance: steady 60 fps with 40 enemies, 20 bullets and effects on a mid-range laptop.

**Arcade-behaviour bars.** These are the acceptance criteria Milestone 2 must satisfy. Each is stated as a scenario with an exact expected result, because each one is a case a plausible-looking implementation gets wrong; they become golden replay tests as the code that can run them lands. The fuller list of scenarios they were drawn from is in the rules-and-scoring scout report.

- A perfect run of the first two challenge stages must be achievable **without moving**, from the exact centre of the screen.
- A boss that launched with two escorts must still score 1,600 when the escorts are destroyed before it.
- Once a fighter is captured, no further capture beam may appear until that fighter is destroyed or a rescued dual fighter loses a half.
- A perfect first challenge stage must pay 19,000: 40 × 100 on impact, 5 × 1,000 in group bonuses, and a 10,000 perfect bonus that replaces the 100 × hits bonus.
- An alien shot **during the entry wave** must score the diving value (a bee-role alien is 100, not 50), and one shot **while rotating back into its slot** after a dive must score the formation value (50, not 100). The doubling is a test on the alien's state, not on whether it is visibly moving.
- On the ninth challenge stage (stage 35) the per-hit value must revert to 100 while the group bonus stays at 3,000. The two indices have different periods and only one of them clamps.
- With the factory-default extra-life setting, the award at 980,000 must be the **last**; no further extra lives are granted after it.
- The entry-wave sway must end with the formation **exactly centred**, on the same frame the pulsing-formation sound starts and the breathe begins.
- Flying into an enemy must cost a fighter, and losing the last one that way must reach game over. It must score nothing, leave the enemy flying, and happen on no challenge stage.

## 12. Open decisions for the captain

| Decision | Default in this plan | Alternatives |
|---|---|---|
| Title | Star Swarm | Your call |
| Delivery mode | direct-PR, private GitHub repo | local-only (no GitHub; you approve local merges) |
| Merge autonomy | You approve every merge | `+yolo`: first mate merges green, in-scope PRs itself |
| Platform | Browser | Desktop wrapper (Tauri/Electron) later |
| In-game prompting | Deferred to after M4 | Earlier, with your own API key |
