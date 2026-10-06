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

## First: what publishing the game left open

The hosted build itself is done and has moved to
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md#refresh-or-restart), which is where a
thing that exists is described. What it did **not** settle stays here, because it
was never a deployment question:

- **Scout: what a public build has to be able to prove about its art and audio.**
  "Original by rule" ([`docs/DESIGN.md`](DESIGN.md#2-ground-rules-read-before-building)
  section 2) is a rule the repository has kept; a build anyone can open is the
  first time anyone outside it can ask. The report will say what evidence the
  rule needs to have ready — provenance for the sprite and font pixels and for
  every synthesised sound — and whether anything shipped falls short of it.

## Next: Milestone 3 — configurable

- **Ship: the two reserved abilities, and a game that uses the new four.** The
  ability registry and its first four new abilities have landed, and so have the
  playability checks in the validator; both moved to
  [`docs/ARCHITECTURE.md`](ARCHITECTURE.md#44-where-a-second-game-plugs-in)
  ([§4.4](ARCHITECTURE.md#44-where-a-second-game-plugs-in) and
  [§4.7](ARCHITECTURE.md#47-the-playability-pass)), which is where a thing that
  exists is described. `transform` and `mirrorPlayer` will each need a
  specification before a module — what an alien turning into another one
  mid-flight keeps, and what mirroring the player means for its controls — and no
  installed pack will switch the four on until a variant does, along with the
  sounds and effects their events want.

Also in this milestone, because they are the same kind of work:

- **Ship: a second game**, rather than a variant of this one — the Galaxian-lineage
  mode the captain's standing direction asks for. It will be another pack plus
  another `rules.json` and a variant document naming them, and the question it will
  answer is whether that is really all it takes.

The pack manager and the stage-sequence editor have landed, and moved to
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md#the-pack-manager-and-the-stage-sequence-editor)
with what they check and what they cost — and so has the answer to what an edit
made with them is: a named variation beside the shipped game rather than a change
to it ([`docs/ARCHITECTURE.md`](ARCHITECTURE.md#a-players-variations)).

- **Ship: a variation as text.** A variation will be exportable as the variant
  document it already is, and importable from one, so a game a player made can
  leave the browser it was made in — and be refused on the way in for exactly the
  reasons any variant is.

_Exit check:_ a player can change the rules from inside the game, a forged pack
fails validation for being unplayable rather than merely malformed, and a pack
with a new ability plays without an engine change — the first met by the pack
manager and the stage-sequence editor, the second by the validator's playability
pass, and the third by `tests/sim/ability-pack.test.ts`. What the milestone still
owes is the second game and the two reserved abilities above.

## Now: Milestone 4 — prompt forge

The skill, the guide it reads and the first forged pack have landed, so they have
moved to [`docs/ARCHITECTURE.md`](ARCHITECTURE.md#46-the-forge), which is where a
thing that exists is described. What the milestone still owes:

- **Ship: `/lab` for aliens, stages and sounds**, plus GIF capture for pull
  requests. `/lab` previews movement paths today and nothing else; what the
  capture half would be is set out in
  [Capturing gameplay video](#capturing-gameplay-video) below.
- **Ship: `audio/music.ts`** — the jingles the plan's section 5 asks for, as pack
  data like every other sound. <!-- check:absent src/audio/music.ts -->

One thing the forge **found** rather than built: the rules layer couples a pack to
numbers it cannot change — which roles may attack at all, how wide a formation has
to be for the breathe table it will run under, and the absolute enemy count at
which bombing turns continuous. The pack manager says so on its card when a mix
meets one ([`docs/ARCHITECTURE.md`](ARCHITECTURE.md#the-pack-manager-and-the-stage-sequence-editor));
nothing in this roadmap will let a pack change them, because rules stay a whole
document, and whether one ever should is a question for the captain rather than a
task.

_Exit check:_ one sentence becomes a validated, playable pack with a preview clip
attached to its own pull request — met for `packs/deep-sea/`, and the remaining
work above is what makes the clip a command rather than a recipe.

### Capturing gameplay video

The captain asked for a plan before anything is built, and this is it: what
recording gameplay would be, what it would cost, and what it would deliberately
not do. It is scheduled here rather than in
[`docs/IDEAS.md`](IDEAS.md) because it has an order and an exit check — the
milestone above already commits to "GIF capture for pull requests", and
[`docs/media/README.md`](media/README.md) already names this milestone as the
owner. The layer contract settles the rest: a plan is future tense, and
`tests/unit/docs-accuracy.test.ts` admits exactly one roadmap document, so there
is no second file this could live in without becoming a state document and being
held to describing something that exists.

**The default is off.** Everything below is opt-in, and the sections say
concretely what that will mean.

#### What already exists

Recording is not new here, and the census of what has been recorded belongs in
[`docs/media/README.md`](media/README.md) rather than on this page — that is a
state document, where such a claim is checked. What it records is a recipe: drive
the dev server with Playwright's `recordVideo` at 448x576 — two
whole-number scales of the playfield, so the canvas fills the frame — then reduce
the `.webm` with one `ffmpeg` filter chain whose `flags=neighbor` and
`dither=none` are what keep pixel art from being resampled into mush. Playwright
is already a dev dependency and `ffmpeg` is an external tool rather than a
package, so that recipe costs the project nothing and will not be replaced.

What it does badly is worth being exact about, because each of these is the thing
a new command would have to earn its place by fixing:

- **It is prose, not a command.** Clips have deviated from it — other frame
  rates, other palette sizes, the page rather than the playfield — and every
  deviation had to be written into that README by hand, because nothing else
  would have recorded it. `npm run sprite-sheet` is the counter-example already
  in the tree: a picture nobody retypes a command to regenerate.
- **The interesting clips cannot be regenerated.** Reaching a challenge stage
  took a temporary `?stage=` override nobody committed; others were
  fast-forwarded in an editor, or driven from throwaway pages that no longer
  exist. The recipe reproduces the _encoding_, never the run.
- **It records the wall clock.** `recordVideo` captures the page as the browser
  presents it, so a recording that slows the machine down records a slower game —
  and past `MAX_STEPS_PER_FRAME` in `src/engine/loop.ts` the loop drops the
  excess time rather than catching up, so a heavy enough recorder does not merely
  film the run, it changes it.
- **Reaching minute three costs three minutes.** Every clip is bought at the rate
  the game is played.
- **It carries weight, and no sound.** A GIF of a playfield is a megabyte or
  more, added to the repository for every visual change. Audio is not in the
  recipe at all.

#### What would be built, in two phases

**Phase 1 — render a replay, offline.** A committed command will take a replay —
one of the goldens in `tests/sim/golden/`, or a log from phase 2 — and render it
to frames through the real simulation and the real renderer, in a headless
browser page driven by Playwright. The page will be a dev-only entry document on
the `/lab` pattern, and the command will step the loop by exactly one simulation
step per emitted frame rather than by elapsed time, grab the logical 224x288
backbuffer, and hand the numbered frames to `ffmpeg` with the recipe above
expressed as flags instead of prose. <!-- check:absent scripts/capture.ts -->

Roughly, to render the capture from the committed golden that already contains
one, starting where the beam opens:

```
npm run capture -- --replay dual-fighter --from 2600 --to 5400 --fps 10
```

Three things fall out of stepping rather than waiting. Fast-forward becomes
stepping without drawing, so a clip may start at the settle, or at stage 3, for
the cost of the CPU rather than the cost of playing there. The output's frame
rate becomes a choice of which steps to emit, not a measurement of the machine.
And the clip becomes regenerable from a file of a few kilobytes, which is what
makes "recapture this now that enemy fire has landed" a command rather than an
afternoon.

**Phase 2 — record the inputs of a live run.** `recordInput` in
[`src/engine/replay.ts`](../src/engine/replay.ts) already wraps an input source
so that every frame the simulation sees is also logged, run-length encoded; it is
what the goldens are recorded with, and its run-length log is the format attract
mode plays back for a game that declares no autoplay personas. Wiring an
opt-in version of it into a browser session would make a human's run into a
`(seed, input log)` pair that phase 1 can then render at leisure. The seed is
already derived rather than ambient — each game seeds from the session root and
its index — so nothing else has to be captured for the run to come back.

**Not scheduled: pixels from the hosted site.** That would mean recording code in
the shipped bundle, which is the one thing this plan refuses; see the rejected
alternatives below.

#### What "off by default" will mean, concretely

- **Nothing records unless something asks.** Phase 1 is a command; there is no
  trigger inside the game at all. Phase 2's recorder will not be constructed
  unless asked for, so an ordinary session will sample the same unwrapped input
  source it samples today.
- **No idle cost, because there is no idle path.** Phase 1 puts no code on the
  game's hot path — none in the game at all. Phase 2 adds one wrapper around the
  input source when it is on, which is the per-step cost the golden recorder
  already pays headlessly, and zero when it is off.
- **No files unless a command wrote one.** Frames will land in `/.scratch/`,
  which is git-, Prettier- and ESLint-ignored precisely for video frames. Only a
  finished clip is ever committed, and only when a document links it.
- **Nothing in the shipped bundle.** The capture page will be kept out of the
  build the three ways `/lab` already is — `vite build`'s only input stays
  `index.html`, nothing on that graph imports it, and the route plugin declares
  `apply: 'serve'` — and `tests/unit/lab-dev-only.test.ts` is the test that keeps
  it that way, extended rather than re-invented. A player who never records will
  download not one byte of this.

#### The questions a reader will have

- **What is captured?** The logical 224x288 backbuffer: the renderer's own
  pixels, before any scaling, so the sprites are the sprites. Not the whole page
  — the `/lab` clips are the case that wants a page, and the existing recipe
  already carves that exception out. Separately and more
  importantly, phase 2 captures the _simulation's_ state, as the input log that
  reproduces it.
- **Where does it go?** Frames to `/.scratch/`, finished clip to `docs/media/`
  when a document links it and to the pull request when nothing does. A log worth
  keeping is small enough to commit beside the goldens.
- **How long can a recording be?** For a log, effectively unbounded. Input
  barely changes between steps and the log is run-length encoded, so a
  three-minute run is a few kilobytes and a ten-minute one is not a different
  problem — the goldens in `tests/sim/golden/` are the demonstration, and the
  ratio against a clip of the same run is three orders of magnitude. For video
  the limit is the format rather than the pipeline: a playfield GIF of half a
  minute runs to a megabyte or more, so past roughly a minute a GIF stops being
  something to attach to a pull request. Anything longer wants `webm` or `mp4`,
  which the same `ffmpeg` step already emits.
- **Does it work on the hosted site?** No, and on purpose. The recorder is a dev
  route, and the hosted build will contain no capture code. If phase 2's opt-in
  ever ships to the bundle, what the hosted site could yield is a _log_, rendered
  locally afterwards.
- **Is audio included?** Not in phase 1. It is worth stating why it is close to
  free later: `buildSoundPlan` in [`src/audio/synth.ts`](../src/audio/synth.ts)
  is pure and `playPlan` takes a structural subset of Web Audio, so an
  `OfflineAudioContext` may satisfy it directly — which would make the audio
  track deterministic and faster than real time to render. That is plausible and
  unverified; see below.
- **What does it cost in frame rate while recording?** Phase 1: nothing, because
  nothing is real time. The render may run slower or faster than the game and the
  run is the same run either way. Phase 2: one input-source wrapper per step,
  which must be measured before it ships to a bundle a player downloads.

#### What is not known, and what would settle it

1. **Whether a log recorded on one machine re-renders to the same frames on
   another.** The run will be the same run —
   [`docs/ARCHITECTURE.md`](ARCHITECTURE.md#3-the-layers) records why the
   simulation replays to the bit on either architecture — but the frames come out
   of a canvas, and whether two machines rasterise the same state to the same
   pixels is a separate question nobody has measured. Settled by: record one log,
   render it on arm64 and on x86-64, hash the frames and compare.
2. **What a frame costs.** Settled by timing several hundred backbuffer grabs
   through the devtools protocol against the same count taken in the page as
   image data, which also decides which of the two the command should use.
3. **Whether `OfflineAudioContext` satisfies the synth's context subset.**
   Settled by type-checking it against the interface and rendering one sound
   through it.
4. **Whether the dev-only test generalises.** Settled by extending it to a second
   route and seeing whether it wants a parameter or a rewrite.

#### Why this and not the alternatives

- **An in-page recorder** — `MediaRecorder` over `canvas.captureStream()`, with a
  key to start and stop it. Rejected as the primary answer: it ships in the
  bundle, it costs frame rate on the machine that is playing, and because
  `src/engine/loop.ts` drops time past five steps per host frame, a recorder
  heavy enough to matter changes the run it is recording. It is the only approach
  that could film the hosted site, which is why it is written down here rather
  than dismissed — but filming the game being slow is not filming the game.
- **A canvas implementation in Node**, dropping the browser entirely. Rejected:
  a new dependency and a second rasteriser whose pixels would have to match the
  browser's or the clip stops being the game. The split in `src/render/` makes
  rasterising pure, but drawing is still the host's.
- **Screen-recording a real session.** Rejected: not reproducible, not headless,
  and nothing CI could run. The clips whose runs cannot be reproduced are the
  evidence.
- **Keeping the recipe and documenting it harder.** Rejected: it is already
  documented, carefully, and clips still deviated from it and had to have the
  deviation written down. Prose is not what is missing.

The deterministic simulation is what makes this choice available at all. In a
project where a run were not reproducible from a seed and an input log, "record
pixels while playing" would be the only option and every cost above would be
unavoidable. Here the run is already a small file — which is also what
[`docs/IDEAS.md`](IDEAS.md#engine-directions-nobody-has-needed-yet) notices from
the other end, where trading replays is listed as something the format already
allows.

_Exit check:_ a clean checkout regenerates any clip in `docs/media/` from a
committed log with one command and no hand-typed filter chain, and the bundle a
player downloads is unchanged by the whole feature.

## After that: Milestone 5+ — keep expanding

Recurring firstmate requests rather than a fixed list: "forge a new pack themed
X", "add ability Y", "tune stage Z to be harder". The candidates the plan names —
boss stages, two-player alternating play, gamepad and touch controls — are in
[`docs/IDEAS.md`](IDEAS.md), because naming a thing in a roadmap implies an order
and none of them has one yet. A published build was one of them until the captain
asked for it, which is why it is at the top of this page instead.

---

## Open questions this roadmap does not answer

Two questions are open and neither is settled here — both arcade observations
nobody has made. A document may record that they are open; none may pick a side.

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
