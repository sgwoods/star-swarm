# Star Swarm — Design & Build Plan

*Working title. A 1981-arcade-style formation shooter that plays like the classic, plus a content system that lets you prompt new aliens, stages and movements into existence.*

Captain: Steven · Plan version 1 · 2026-09-24

---

## 0. How to hand this to firstmate

Paste this into your first mate session once `claude` is running in the `firstmate` folder:

> ahoy. Create a new private GitHub project called `star-swarm` in **direct-PR** mode. Its design doc is at `~/Documents/FirstMate - 1/game-plan/star-swarm-design.md`; the first task should copy it into the repo as `docs/DESIGN.md`. Then start **Milestone 0** from section 10: run the scout task and the scaffold task in parallel. Report back when both are done.

After each milestone, review the PRs, play the build (`npm run dev`), then say "start Milestone N".

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

Values marked **(verify)** are from memory; the Milestone 0 scout task confirms or corrects them and writes `docs/reference/arcade-reference.md` with sources.

**Screen and timing**
- 224×288 logical playfield, 60 fps fixed-step simulation, rendering decoupled.
- Scrolling multi-colour starfield background that pauses/changes speed during certain transitions.

**Player**
- Horizontal movement only, along the bottom row; constant speed, no acceleration.
- **At most 2 player shots on screen** at once — this cap defines the game's rhythm.
- 3 lives by default; extra lives at 20,000 and 70,000, then every 70,000 **(verify; configurable)**.

**Enemies and formation**
- 40 enemies per normal stage: 4 bosses (2 hits: first hit changes colour), 16 butterfly-role, 20 bee-role.
- Formation grid: bosses top row, then 2 rows of 8, then 2 rows of 10.
- Enemies **enter in scripted waves** along curved paths (pairs/groups, often mirrored), then settle into slots.
- While filling, the formation **sways side to side**; once full it **"breathes"** (expands and contracts).
- From the formation, enemies peel off in **dive attacks**: bees swoop and loop, butterflies dive in arcs, bosses dive with up to 2 escorts.
- Enemies fire during entry and dives; bullet count/rate scales with stage.
- Divers that leave the bottom re-enter from the top and rejoin the formation.

**Capture and rescue**
- A boss may dive partway and emit a **tractor beam**; if it catches the player, that ship becomes a captured (red) fighter sitting beside the boss in formation.
- Destroying that boss while it is **diving** releases the captured ship, which docks beside the player → **dual fighter** (two ships, double shots, double hitbox).
- Destroying the boss while it's in formation turns the captured ship hostile **(verify exact behaviour)**. Shooting a captured ship destroys it.
- One capture at a time; a hit on either half of a dual fighter leaves a single ship.

**Challenge stages**
- Stage 3, then every 4th stage (7, 11, 15…).
- 40 enemies in 5 groups of 8 fly scripted patterns and **never shoot or attack**.
- 100 points each; per-group bonus for clearing a whole group **(verify values)**; **10,000 for all 40**.
- Results screen shows the number hit.

**Scoring (verify all)**

| Target | In formation | Diving |
|---|---|---|
| Bee-role | 50 | 100 |
| Butterfly-role | 80 | 160 |
| Boss | 150 | 400 alone · 800 with 1 escort · 1,600 with 2 escorts |
| Transformed-enemy trio (later stages) | — | bonus for destroying all 3 (verify) |

**Difficulty ramp and later stages**
- Dive frequency, speed and bullets increase by stage; the last few enemies of a stage get more aggressive.
- From about stage 4, some bees **transform** mid-dive into a trio of a different enemy type **(verify stage and scoring)**.
- Stage-number badges shown bottom-right in denominations 1, 5, 10, 20, 30, 50.

**Game flow**
- Attract mode (demo play and scoring table), a 1-player start, "STAGE N" and "READY" interstitials, and a game-over results screen showing shots fired, hits and hit ratio.
- High-score table with 3-letter initials, stored locally.

## 5. Look and sound

- **Sprites:** original 16×16 designs in a limited palette (about 3 colours plus transparent per sprite), 2-frame wing flap animations, 4-frame explosions. Defined as data (section 7.4) so they're promptable.
- **Palette:** saturated arcade colours on black; a global palette per pack.
- **Fonts:** original 8×8 pixel font in the arcade spirit.
- **Sound:** parametric synth voices (square, triangle, noise, pitch sweeps). Original short jingles for start, stage start, capture, rescue and challenge results. All defined as data.
- **CRT option:** optional scanline/curvature shader, off by default.

## 6. Configuration system

Three layers, applied in order and overridable per stage:

1. **Engine rules** (`rules.json`): lives, extra-life thresholds, shot cap, player speed, difficulty curves, challenge-stage cadence, capture enabled, dual-fighter enabled, score table.
2. **Content packs** (`packs/<name>/`): aliens, paths, stages, sprites, sounds, a stage sequence.
3. **Player settings** (in-game menu): volume, CRT filter, controls, difficulty preset, active packs.

A **"Classic" pack plus classic rules** reproduces the arcade game. Other packs can extend or replace it (e.g. a "Classic + Weird" mix that inserts new stages every 5th level).

## 7. Content model (what prompts generate)

All of these are JSON validated by schemas in `src/content/schema.ts`. Examples are illustrative.

### 7.1 Alien

```json
{
  "id": "jellyfish",
  "role": "butterfly",
  "hp": 1,
  "sprite": "jellyfish",
  "score": { "formation": 80, "diving": 160 },
  "fire": { "pattern": "aimed", "shotsPerDive": 2 },
  "dive": { "paths": ["swirl8"], "weight": 1.0 },
  "abilities": [{ "type": "splitOnHit", "into": "jellyling", "count": 2 }],
  "sounds": { "dive": "wobble", "death": "pop" }
}
```

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
    { "at": 0,   "aliens": ["jellyfish", "jellyfish"], "count": 8, "entryPath": "swirl8", "spacing": 10 },
    { "at": 150, "aliens": ["drone"], "count": 8, "entryPath": "classicLeftHook", "spacing": 8 }
  ],
  "diveRules": { "maxConcurrent": 3, "intervalFrames": [60, 180] },
  "modifiers": { "enemyBulletSpeed": 1.1 }
}
```

`kind` is `normal`, `challenge`, or `boss` (later).

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

```
src/
  engine/      loop.ts (fixed step), rng.ts (seeded), input.ts, replay.ts
  sim/         world.ts, player.ts, shots.ts, enemies.ts, formation.ts,
               paths.ts (segment interpreter), dive.ts, capture.ts,
               abilities/ (one file per ability), scoring.ts, stages.ts
  render/      canvas.ts, sprites.ts (data→bitmap cache), starfield.ts, text.ts, crt.ts
  audio/       synth.ts, sfx.ts, music.ts
  content/     schema.ts, loader.ts, registry.ts
  ui/          attract.ts, menus.ts, hud.ts, results.ts, highscores.ts, lab/
packs/
  classic/     aliens/, paths/, stages/, sprites/, sounds/, pack.json
tests/         unit/, sim/ (headless golden replays), e2e/
docs/          DESIGN.md, reference/, content-guide.md
```

**Key rule:** `sim/` never touches the DOM, Canvas or Audio. Sim emits events; render and audio subscribe. That's what makes headless tests and replays possible.

## 10. Milestones and crew tasks

Tasks in the same milestone can run in parallel. **Ship** tasks change code; **scout** tasks produce reports.

### Milestone 0 — Foundations
- **Scout: arcade reference.** Verify every "(verify)" value in section 4 (scoring, extra lives, capture rules, transform stages, challenge bonuses, speeds, entry-wave choreography) from reputable sources. Output: `docs/reference/arcade-reference.md` with sources and a list of corrections to this doc.
- **Ship: scaffold.** Vite + TS + Vitest + Playwright, 224×288 integer-scaled canvas, fixed-step loop, seeded RNG, input, CI running lint, tests and pack validation. Copy this plan to `docs/DESIGN.md`.

### Milestone 1 — Playable core
- **Ship: content schemas + loader + validator** (section 7; the empty Classic pack skeleton).
- **Ship: path interpreter** (all segment types) + `/lab` path previewer.
- **Ship: player, shots (2-shot cap), collisions, lives, HUD, starfield.**
- **Ship: sprite pipeline** (data → cached bitmaps) + original Classic sprite set + font.
- **Ship: synth + Classic SFX set.**

*Exit check:* the player can move and shoot at a static formation with sound and scoring.

### Milestone 2 — The classic game
- **Ship: entry waves + formation sway/breathe + slot homing.**
- **Ship: dive attacks + enemy fire + difficulty ramp.**
- **Ship: capture beam + captured fighter + rescue + dual fighter.**
- **Ship: challenge stages + results + stage badges + extra lives.**
- **Ship: attract mode, game over, hit-ratio screen, high-score table.**
- **Ship: Classic stages 1–8 authored as data** (uses the scout report).

*Exit check:* someone who knows the arcade game plays 10 minutes and says "yep, that's it." Add golden replay tests for key behaviours.

### Milestone 3 — Configurable
- **Ship: rules layer + settings menu + difficulty presets.**
- **Ship: pack manager + stage-sequence editor.**
- **Ship: ability registry + first 4 new abilities** (splitOnHit, shield, teleport, spawnMinions).
- **Ship: playability checks in the validator** (headless sim).

### Milestone 4 — Prompt forge
- **Ship: `/forge` skill + `docs/content-guide.md`** (the guide Claude reads when generating content).
- **Ship: `/lab` for aliens, stages and sounds** + GIF capture for PRs.
- **Ship: first forged pack** as the end-to-end proof (e.g. "Deep Sea": 3 aliens, 4 paths, 3 stages).

### Milestone 5+ — Keep expanding
- Recurring firstmate requests: "forge a new pack themed X", "add ability Y", "tune stage Z to be harder".
- Candidates: boss stages, 2-player alternating, gamepad support, mobile touch controls, publishing a playable build (GitHub Pages).

## 11. Quality bar

- Every sim feature ships with a headless test; key flows (capture → rescue → dual, challenge perfect bonus, extra life award) get **golden replay tests** from recorded inputs and seeds.
- `npm run validate-packs` must pass in CI; a pack that fails validation never loads.
- Each PR touching visuals or audio includes a short GIF or clip from `/lab`.
- Performance: steady 60 fps with 40 enemies, 20 bullets and effects on a mid-range laptop.

## 12. Open decisions for the captain

| Decision | Default in this plan | Alternatives |
|---|---|---|
| Title | Star Swarm | Your call |
| Delivery mode | direct-PR, private GitHub repo | local-only (no GitHub; you approve local merges) |
| Merge autonomy | You approve every merge | `+yolo`: first mate merges green, in-scope PRs itself |
| Platform | Browser | Desktop wrapper (Tauri/Electron) later |
| In-game prompting | Deferred to after M4 | Earlier, with your own API key |
