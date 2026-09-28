<!-- doc:layer roadmap -->

# Star Swarm — roadmap

What is next, and in what order. **Nothing here describes anything that exists.**
Every statement below is future tense on purpose: a roadmap that starts saying
what the code is becomes a second state document, and then two documents have to
be kept true instead of one.

- What the project is _for_, and the arcade behaviour it targets:
  [`docs/DESIGN.md`](DESIGN.md).
- What actually exists today, and how to run it:
  [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
- Things nobody has committed to: [`docs/IDEAS.md`](IDEAS.md).

The milestone list is the captain's, from the plan. Tasks inside one milestone may
run in parallel. **Ship** tasks change code; **scout** tasks produce reports.

---

## First: a hosted build

Asked for ahead of the rest of this list. It will be the publishing and nothing
else: what a deployment has to carry is described in
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md#refresh-or-restart), and this task will
not have to add to it.

- **Ship: publish `dist/` somewhere anyone can open from a link**, including from
  a subpath.
- The deployment will serve **`build.json` beside `index.html`**, and serve it
  **uncached**. That file is how an open page learns a newer build exists; a host
  that caches it will make the detector permanently blind, and a host that omits
  it will make the detector permanently silent. Neither will break the game.
- Re-publishing will be the whole update path: a rebuild writes a new
  `build.json`, and a tab already open will notice within a minute of play and say
  so. Nothing will have to be pushed to a running page.
- The question it will have to answer, which is not a deployment question:
  whether a public build changes what "original art and audio by rule"
  ([`docs/DESIGN.md`](DESIGN.md#2-ground-rules-read-before-building) section 2)
  has to be able to prove.

_Exit check:_ a link opens the game for someone who has never cloned it, and
re-publishing makes an already-open tab say so.

## Next: Milestone 3 — configurable

- **Ship: rules layer + settings menu + difficulty presets.** The rules layer
  itself landed early — the simulation already takes every number from a pack — so
  what is left is the player-facing half: `src/ui/menus.ts`, volume, controls, the
  CRT toggle, and the difficulty preset that selects a rank.
  <!-- check:absent src/ui/menus.ts -->
- **Ship: pack manager + stage-sequence editor.** The game menu will list
  installed packs and let a sequence be edited or played directly.
- **Ship: ability registry + the first four new abilities** (`splitOnHit`,
  `shield`, `teleport`, `spawnMinions`). `src/sim/abilities/` will hold one file
  per ability, and the capture beam will move into it from `src/sim/capture.ts`
  without changing what a pack writes — a path already names the ability by an id
  the schema reserves.
- **Ship: playability checks in the validator.** `npm run validate-packs` will run
  a headless simulation per stage: paths stay on screen, the stage is clearable,
  no unavoidable bullet walls, and it finishes inside a time limit.

Also in this milestone, because they are the same kind of work:

- **Ship: the remaining Classic normal stage scripts**, and with them the three
  difficulty ranks' own stage sequences. Reference section 5 gives all four ranks'
  seventeen-entry index lists; they need ten of the thirteen combat scripts
  through stage 8 alone, so the ranks cannot be authored before the scripts are.
- **Ship: `render/crt.ts`**, the optional scanline and curvature filter, off by
  default. <!-- check:absent src/render/crt.ts -->

_Exit check:_ a player can change the rules from inside the game, a forged pack
fails validation for being unplayable rather than merely malformed, and a pack
with a new ability plays without an engine change.

## Then: Milestone 4 — prompt forge

- **Ship: the `/forge` skill + `docs/content-guide.md`** — the guide Claude reads
  when generating content. `.claude/skills/forge/` will hold the skill.
  <!-- check:absent docs/content-guide.md .claude/skills/forge -->
- **Ship: `/lab` for aliens, stages and sounds**, plus GIF capture for pull
  requests. `/lab` previews movement paths today and nothing else.
- **Ship: the first forged pack** as the end-to-end proof — the plan's example is
  "Deep Sea": three aliens, four paths, three stages on a theme, generated and
  validated rather than hand-authored.
- **Ship: `audio/music.ts`** — the jingles the plan's section 5 asks for, as pack
  data like every other sound. <!-- check:absent src/audio/music.ts -->

_Exit check:_ one sentence becomes a validated, playable pack with a preview clip
attached to its own pull request.

## After that: Milestone 5+ — keep expanding

Recurring firstmate requests rather than a fixed list: "forge a new pack themed
X", "add ability Y", "tune stage Z to be harder". The candidates the plan names —
boss stages, two-player alternating play, gamepad and touch controls — are in
[`docs/IDEAS.md`](IDEAS.md), because naming a thing in a roadmap implies an order
and none of them has one yet. A published build was one of them until the captain
asked for it, which is why it is at the top of this page instead.

---

## Open questions this roadmap does not answer

Three questions are open and none is settled here — two arcade observations
nobody has made, and one decision that is the captain's. A document may record
that they are open; none may pick a side.

1. **Does a challenge stage's second wave keep four boss-class objects?** It
   changes what a perfect first challenge stage pays — the two readings differ by
   1,200 points. Both are written out in
   [`docs/reference/arcade-reference.md`](reference/arcade-reference.md) section 11
   and [`packs/classic/stages/README.md`](../packs/classic/stages/README.md), and
   the pack is built to one of them. Nothing under `src/` turns on the answer.
2. **What does flying into an enemy do, beyond killing the fighter?** Whether the
   collision destroys the enemy as well, and whether it scores. That it costs a
   fighter is confirmed; the rest is not, and
   [`docs/reference/arcade-reference.md`](reference/arcade-reference.md) section 11
   carries the evidence and the one observation that closes it. The engine is
   built to the negative reading of both, so a ram cannot clear a stage. Changing
   it is `resolveBodyCollisions` in `src/sim/world.ts` and the golden replays it
   moves.
3. **Cross-platform bit-identical simulation.** `Math.sin`, `Math.cos` and
   `Math.atan2` are engine-defined and can differ by one unit in the last place
   between CPU architectures. The golden replays quantise around it rather than
   solve it, which is stated as a limit in
   [`docs/ARCHITECTURE.md`](ARCHITECTURE.md#3-the-layers) and in `AGENTS.md`.
   Whether to make the simulation portable — a fixed-point or table-driven
   trigonometry — is unscheduled.

---

## Milestones already run

Recorded here because this is where the milestone list lives, and because a plan
that silently drops the tasks it has finished loses the thread of why the code
looks the way it does. **This section is a record of what each milestone committed
to, not a description of the tree** — for that,
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) is the only authority, and it is the
document the accuracy suite checks.

### Milestone 0 — foundations

- **Scout: arcade reference.** Verify every unverified value in the plan's
  section 4 — scoring, extra lives, capture rules, transform stages, challenge
  bonuses, speeds, entry-wave choreography — from reputable sources. Output:
  `docs/reference/arcade-reference.md` with sources and a list of corrections to
  the plan.
- **Ship: scaffold.** Vite, TypeScript, Vitest and Playwright; a 224×288
  integer-scaled canvas; the fixed-step loop; seeded RNG; input; CI running lint,
  tests and pack validation.

### Milestone 1 — playable core

- **Ship: content schemas, loader and validator**, with the Classic pack
  skeleton.
- **Ship: the path interpreter** (every segment type) and the `/lab` path
  previewer.
- **Ship: player, shots with the two-shot cap, collisions, lives, HUD,
  starfield.**
- **Ship: the sprite pipeline** — data to cached bitmaps — plus the original
  Classic sprite set and font.
- **Ship: the synth and the Classic sound-effect set.**

_Exit check:_ the player can move and shoot at a static formation, with sound and
scoring.

### Milestone 2 — the classic game

- **Ship: entry waves, formation sway and breathe, slot homing.**
- **Ship: dive attacks, enemy fire, the difficulty ramp.**
- **Ship: the capture beam, the captured fighter, rescue and the dual fighter.**
- **Ship: challenge stages, results, stage badges, extra lives.**
- **Ship: attract mode, game over, the hit-ratio screen, the high-score table.**
- **Ship: Classic stages 1–8 authored as data**, from the scout report.

_Exit check:_ someone who knows the arcade game plays ten minutes and says "yep,
that's it", with golden replay tests for the key behaviours.
