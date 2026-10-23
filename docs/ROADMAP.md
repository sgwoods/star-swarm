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

The ability registry and all six of its new abilities have landed, and so have
the playability checks in the validator and two games that switch all six on
between them — Spore Storm with `splitOnHit`, `shield`, `teleport` and
`spawnMinions`, Mirage with `transform` and `mirrorPlayer` — with the sounds and
effects their events want. All of it has moved to
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md#44-where-a-second-game-plugs-in)
([§4.4](ARCHITECTURE.md#44-where-a-second-game-plugs-in) and
[§4.7](ARCHITECTURE.md#47-the-playability-pass)), which is where a thing that
exists is described.

The second game has landed too, and moved to
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md#44-where-a-second-game-plugs-in): the
Galaxian-lineage game, as a pack, a `rules.json` and a variant document and
nothing else. What it **found** rather than built is the one thing that answer
stops short of — a sortie group, enemies that fly together and are scored as a
group, which the second lineage's escorted flagship needs and the first game's
escorted captor needs as well. The engine has one now, and Classic's bosses fly
with their escorts ([§4.4](ARCHITECTURE.md#44-where-a-second-game-plugs-in)).
Whether the second game's flagship names its own is a question for the captain
rather than a task, so it is not scheduled here.

The pack manager and the stage-sequence editor have landed, and moved to
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md#the-pack-manager-and-the-stage-sequence-editor)
with what they check and what they cost — and so has the answer to what an edit
made with them is: a named variation beside the shipped game rather than a change
to it ([`docs/ARCHITECTURE.md`](ARCHITECTURE.md#a-players-variations)). A
variation now leaves the browser it was made in as the variant document it is, and
comes back in on another machine refused for exactly what any variant is refused
for ([`docs/ARCHITECTURE.md`](ARCHITECTURE.md#carrying-a-variation-to-another-machine)).

- **Later: more of a game's own options, once two decisions are the captain's.**
  The card a game's attract screen opens
  ([`docs/ARCHITECTURE.md`](ARCHITECTURE.md#a-games-own-options)) will offer
  anything beyond starting ships and audio themes only once the captain has decided
  two things, rather than on code: **which values a player may change at all** —
  a scoring value would change what a score means — and
  **whether a game altered that way still carries the reference game's name** on a
  score or on a shared variation, since a score earned on free ships and tripled
  points is not comparable to one earned as shipped. Neither will be decided by
  whoever builds the next row.
- **Later: more of what a game sounds like, each a decision of its own.** Audio
  themes will stay effect-and-jingle substitutions until the captain asks for more
  than that. Four things are deliberately left for later rather than folded into
  them: music tracks that play under a game, as opposed to the short jingles a
  theme can already replace; sampled audio of any kind, which would be a second
  audio pipeline beside the synth; a player customising single sounds, which
  would be a value of their own rather than a choice among declared ones; and
  sharing a theme between players, which waits on the same shared store as
  sharing a game.
- **Later: a place to find other players' games.** Text carried by hand is the
  whole of sharing until there is somewhere to keep games that is not one browser —
  a shared store, which needs a server this project does not have. It will be a
  decision about hosting before it is one about code, and every game it carries
  will still arrive through the import card's judge.

_Exit check:_ a player can change the rules from inside the game, a forged pack
fails validation for being unplayable rather than merely malformed, and a pack
with a new ability plays without an engine change — the first met by the pack
manager and the stage-sequence editor, the second by the validator's playability
pass, and the third by `tests/sim/ability-pack.test.ts`. The second game is in as
well, by a pack, a `rules.json` and a variant and no engine change.

## Now: Milestone 4 — prompt forge

The skill, the guide it reads and the first forged pack have landed, so they have
moved to [`docs/ARCHITECTURE.md`](ARCHITECTURE.md#46-the-forge), which is where a
thing that exists is described; so have `/lab`'s previews of aliens, stages and
sounds ([`docs/ARCHITECTURE.md`](ARCHITECTURE.md#43-lab)). What the milestone
still owes:

- **Ship: the clips of play in `docs/media/`, from committed logs.** Both halves
  of capture have landed and moved to
  [`docs/ARCHITECTURE.md`](ARCHITECTURE.md#recording-a-live-run): `npm run record`
  turns a run somebody plays into a log, and `npm run capture` turns a log into a
  clip. What is left of [Capturing gameplay video](#capturing-gameplay-video) is
  its exit check: each clip of play that was made before the two commands existed
  will be played again on the record page and committed beside its log.
- **Ship, once the captain decides it: a log that names the game it was played
  on.** A log will go on playing on the shipped Classic rules until then, because
  the plan held that a seed and the inputs are all a run needs — which is true of
  one game and not of a list of them. A forged pack's preview clip, which is this
  milestone's own exit check, becomes a command only when a log can say which
  variant it was played on and which difficulty chose its rank. That is state the
  plan deliberately did not capture, so adding it is a decision before it is a
  task.

One thing the forge **found** rather than built: the rules layer couples a pack to
numbers it cannot change — which roles may attack at all, how wide a formation has
to be for the breathe table it will run under, and the absolute enemy count at
which bombing turns continuous. The pack manager says so on its card when a mix
meets one ([`docs/ARCHITECTURE.md`](ARCHITECTURE.md#the-pack-manager-and-the-stage-sequence-editor)).
The game that uses the new abilities found one more that the card does not report:
the aliens Classic's transform attack turns a layered game's own aliens into
([`docs/ARCHITECTURE.md`](ARCHITECTURE.md#5-what-is-not-here-yet)). Nothing in
this roadmap will let a pack change them, because rules stay a whole document, and
whether one ever should is a question for the captain rather than a task.

_Exit check:_ one sentence becomes a validated, playable pack with a preview clip
attached to its own pull request — met for `packs/deep-sea/`; the second item
above is what will make that clip a command rather than a recipe.

### Capturing gameplay video

The captain asked for a plan before anything was built, and this was it: what
recording gameplay would be, what it would cost, and what it would deliberately
not do. Both of its phases have landed and moved to
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md#43-lab), which is where a thing that
exists is described — including what "off by default" came to mean and how each
part of it is held. What stays here is what the plan still owes: its exit check,
the two things nobody has measured, and the reasons the alternatives were turned
down, which are why the built thing has the shape it has.

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

#### The two phases, and what was left out

**Phase 1 — render a replay, offline — and phase 2 — record the inputs of a live
run — have both landed**, and
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md#rendering-a-replay-to-a-clip) describes
them. Two things the plan named were left out on purpose, and stay out until
somebody schedules them:

- **Pixels from the hosted site.** That would mean recording code in the shipped
  bundle, which is the one thing this plan refuses; see the rejected alternatives
  below. If an opt-in recorder ever ships, what the hosted site could yield is a
  _log_, rendered locally afterwards.
- **Sound in a clip.** It is worth stating why it would be close to free:
  `buildSoundPlan` in [`src/audio/synth.ts`](../src/audio/synth.ts) is pure and
  `playPlan` takes a structural subset of Web Audio, so an `OfflineAudioContext`
  may satisfy it directly — which would make the audio track deterministic and
  faster than real time to render. That is plausible and unverified; see below.

#### What is not known, and what would settle it

1. **Whether a log recorded on one machine re-renders to the same frames on
   another.** The run will be the same run —
   [`docs/ARCHITECTURE.md`](ARCHITECTURE.md#3-the-layers) records why the
   simulation replays to the bit on either architecture — but the frames come out
   of a canvas, and whether two machines rasterise the same state to the same
   pixels is a separate question nobody has measured. Settled by: record one log,
   render it on arm64 and on x86-64, hash the frames and compare.
2. **Whether `OfflineAudioContext` satisfies the synth's context subset.**
   Settled by type-checking it against the interface and rendering one sound
   through it — the step that would put sound in a clip.

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
player downloads is unchanged by the whole feature. As written, "any clip" takes
in the clips of the front end — the selector, the menus, the cards and attract
mode — and those are a session rather than a run, which neither command will
render: a log is one world's inputs, and the front end is the flow around it.
Meeting that part needs either a check narrowed to clips of play or a renderer of
a whole session, and which of the two is the captain's call.

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
