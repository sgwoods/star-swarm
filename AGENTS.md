# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## The documentation is four layers, and only one of them may claim anything

Documents here are separated by **how fast they change** and by **whether a
machine can check them**. Every one of the following was written true and became
false: a README claiming "no gameplay yet" two milestones after gameplay existed,
a plan listing three source files nobody wrote, an architecture document falsified
in four statements by the very next merge, a pack README describing shipped
content as deliberately absent. Nobody lied in any of those cases. The code moved
and the prose did not — so the fix is structural.

| Layer     | File                                 | Contract                                                                   |
| --------- | ------------------------------------ | -------------------------------------------------------------------------- |
| Vision    | `docs/DESIGN.md`                     | Why, the pillars, the ground rules, the arcade spec. **Intent tense only** |
| **State** | `docs/ARCHITECTURE.md`               | What exists, as built. **Every factual claim machine-checked**             |
| Roadmap   | `docs/ROADMAP.md`                    | What is next and in what order. Future tense; describes nothing that is    |
| Ideas     | `docs/IDEAS.md`                      | Speculative, fenced, never mistakable for state or commitment              |
| Reference | `docs/reference/arcade-reference.md` | Evidence about the **arcade original**, not about this code                |

A document declares its layer with `<!-- doc:layer state -->` at the top. A
document that declares nothing — every `README.md` in `src/*/`, `packs/` and the
root — is treated as **state**, which is the strict default: all of its claims are
checked. `tests/unit/docs-accuracy.test.ts` requires exactly one vision, one
roadmap and one ideas document, so the split cannot be undone by a rename.

**The editorial rule: only present-tense statements about this repository are
testable.** That is why vision and roadmap documents are exempt by construction
rather than by permission — they make no such statements. It is enforced where it
can be: `check:count` is refused outside a state or reference document, because a
count is a claim about what the code currently is.

Three consequences when you write in any of them:

- **Put a claim in the layer whose contract allows it.** A file listing, a count,
  a "this is not written yet" — all state, all in `docs/ARCHITECTURE.md`. The plan
  names no modules on purpose: a directory tree inside it is exactly how it came
  to list `sim/scoring.ts` and `sim/stages.ts` for two milestones.
- **`docs/DESIGN.md` is the captain's, and Prettier ignores it**
  (`.prettierignore`) so its hand-authored tables and line breaks survive. Keep
  edits small and in the surrounding style; do not reformat it wholesale.
- **The reference and the plan's section 4 are a pair.** Change a number in one
  and the other changes with it, or they drift apart silently. The reference names
  the original game and its enemy types so sources stay checkable; that licence
  does not extend to any other document. Unlike the plan it _is_
  Prettier-formatted, and its claim tables are wide — changing one cell re-pads
  the whole table, so run `npm run format` before `npm run lint`.

### Markers: how a claim becomes checkable

Most checks cost nothing to write. A path-like token in backticks, a Markdown link
or image target, a `#heading` anchor, an `npm run …` command and a quoted
`engines.node` range are harvested from the text as written, in **every** document
whatever its layer — a dangling reference is never right, and the layers exempt
tense, not references.

Anything that needs interpretation carries an HTML comment, invisible in rendered
Markdown:

```
<!-- doc:layer state -->                        the layer this document is
<!-- check:count flow.phases 6 -->              a stated count; name/number pairs
<!-- check:absent src/render/crt.ts -->         not written yet, and must stay so
<!-- check:path packs/classic/rules.json -->    a path named outside backticks
<!-- check:script sprite-sheet -->              a script in package.json
<!-- check:foreign src/mame/namco/galaga.cpp --> a path in somebody else's repo
<!-- check:engines ^22.13.0 || >=24.0.0 -->     the declared Node range
```

Five things worth knowing:

- **A marker goes on its own line at the _end_ of the paragraph it annotates, with
  a blank line after it** — or inline at the end of a line of text. On its own line
  in the _middle_ of a paragraph it splits the paragraph in two when rendered.
- **A count must be derived.** `counters` in `tests/unit/helpers/docs.ts` computes
  each one from the code or the shipped pack. Adding a counter that returns a
  literal moves the hand-maintained number into a file nobody reads.
- **`check:absent` is the self-cleaning one.** It fails on the day the file lands,
  which is what stops a "not here yet" list going stale — the failure mode a
  `packs/classic/README.md` already hit once.
- **A marker inside a fenced code block is inert**, which is why the block above
  documents the vocabulary without asserting it.
- **There is no `check:absent` for a command.** A path may be declared absent;
  an `npm run …` in backticks may not, and is checked against `package.json` in
  every layer. A plan naming a command nobody has written yet puts it in a
  fence, where nothing is harvested at all.

### When your change falsifies somebody else's document

Say so in your pull request body: name the document, the statement and why it is
now false. Do **not** quietly fix it during a rebase. Two corrections landed that
way and were reviewable because of it; a silent edit inside an unrelated diff is
how a document acquires a claim nobody checked. If the accuracy suite catches it
for you, that is the system working — fix it and still say what moved.

## The one rule that shapes the codebase

`src/sim/` never touches the DOM, Canvas or Web Audio, and never imports from
`src/render/`, `src/audio/` or `src/ui/`. The sim emits events; render and audio
subscribe. That is what makes headless tests and replays possible.

This is enforced, not trusted: `eslint.config.js` restricts imports, host globals
and `Math.random` inside `src/sim/`, and `tests/unit/sim-boundary.test.ts` both
scans the tree and runs ESLint against a deliberately illegal probe file so the
rules cannot be quietly deleted. Both run in CI.

That scan is textual, so inside `src/sim/` an identifier spelled exactly
`window` fails even as a local variable or parameter. Name it `hitWindow`. It
catches **object keys** too, so a `rules.json` field the sim destructures cannot
be called `window` either — that is why the tractor beam's is `catchWindow`.

## Arcade numbers say how far to trust themselves

Anywhere an arcade value is written down, it is marked **verified** or
**provisional**. Verified means `docs/reference/arcade-reference.md` carries the
ROM routine behind it, and changing it means changing the reference too.
Provisional means it is ours — the reference does not cover it, or lists it
unresolved. Keep new values labelled; the distinction is the difference between
a number that may not be changed and one that may.

Those values live in `packs/classic/rules.json`, so the marking is data: the
`provenance` block maps a field path to its confidence and a note, and the loader
rejects a key naming no field so a rename cannot leave a marking behind. It is
granular where the confidence is — a shot window's Δx bounds are verified and its
Δy bounds are not. In code, the marking is still a comment.

## The simulation has no rules of its own

`src/sim/` is handed one resolved `Rules` value and holds no constants: the
movement cadence, travel limits, shot cap, hit windows, extra-life thresholds,
backdrop speed formula and playfield all come from a pack through
`src/content/`. `createWorld` requires that value, and `src/content/rules.ts` is
the only place that interprets one. A number the sim needs that is not in the
schema is a number no pack can change, which is the failure this arrangement
exists to prevent — so adding one means adding it to `src/content/schema.ts` and
to the pack, not defaulting it in the sim.

The same is true of content: a stage arrives as a resolved `StageContent`
through a `StageSource` (`src/content/stages.ts`), never as a pack or a
registry. The sim may import `src/content/schema.ts`, `src/content/rules.ts` and
`src/content/stages.ts`; it may **not** import `src/content/fs.ts`, which is
Node-only. The sim receives loaded values, it never loads one. `src/main.ts` is
where the loader runs for the browser.

## Determinism is a hard requirement

Fixed 60 Hz steps, seeded RNG, replayable input logs (`docs/DESIGN.md` pillar 4).
Practical consequences:

- Never use `Math.random()` in `src/sim/` or `src/engine/` — use
  `createRng(seed)` from `src/engine/rng.ts`.
- Never read the wall clock in `src/sim/`. Time arrives as a fixed step.
- The RNG stream is part of the on-disk contract. Golden replays compare final
  simulation states, so changing the generator invalidates every recorded replay;
  `tests/unit/rng.test.ts` locks a reference sequence to make that deliberate.
- `1/60` is not representable in binary floating point. `src/engine/loop.ts`
  accumulates in _steps_ and carries a tolerance for exactly this reason; naive
  millisecond subtraction silently loses a step per burst.
- **The simulation is bit-identical across machines, and the fingerprint is
  exact.** `Math.sin`, `Math.cos` and `Math.atan2` are engine-defined and differ
  by one ULP between CPU architectures — a golden re-recorded on an arm64 Mac once
  failed CI on x86-64 Linux over a single bit in one enemy's frozen position — so
  the simulation takes every sine, cosine and heading from the fixed-point tables
  in `src/engine/trig.ts` instead, and `fingerprintWorld` compares every number to
  the last bit. The tables are part of the on-disk contract like the RNG stream:
  `tests/unit/trig.test.ts` locks them, so changing one is as deliberate an act.
  `tests/unit/world.test.ts` pins both edges of exact: a one-ULP difference is
  caught, and the numbers compared carry no engine noise.
- Golden replays live in `tests/sim/golden/`, written by
  `npx tsx scripts/record-replay.ts` and compared byte for byte (so the
  directory is in `.prettierignore`). A PR that changes one either meant to or
  broke something — say which. `--check` fails instead of rewriting. One of them
  (`stage-entry`) records an **empty** input log on purpose: entry choreography
  is scripted, so a golden with no input is a record of the fleet and the
  formation alone. A golden's pilot **may read the world** while recording
  (`capturePilot`), because what lands on disk is still a plain frame log — that
  is the only way to record a run that has to shoot one particular enemy at one
  particular moment. Anything added to `fingerprintWorld` rewrites every golden,
  so it is a deliberate act, not a drive-by.

## The second rule: content is a platform, not this game

`src/content/` holds no knowledge of Star Swarm. The content model is shared
across an arcade lineage expected to host more than one game (`docs/DESIGN.md`
section 6), so enemy roles are ids a pack declares, per-role numbers are records
keyed by those ids, and formations, scoring and every difficulty or sequence
table are data. A Classic-specific name or assumption belongs in
`packs/classic/`, never in a type under `src/content/`.

Two consequences worth knowing before editing either:

- Every ramp is literal rows plus its own plateau period, never a curve, and the
  periods differ between tables on purpose. `src/content/rules.ts` is the only
  place that interprets one.
- A pack is read **two ways, and they must not drift**: `src/content/fs.ts` walks
  the directory with `node:fs` for the validator and the tests, and
  `src/content/bundle.ts` walks the same tree with Vite's `import.meta.glob` for
  the browser. Neither is re-exported from `index.ts` — one would pull `node:fs`
  into the bundle, the other a Vite-only transform into plain Node.
  `tests/unit/bundled-packs.test.ts` holds the two to each other, because
  otherwise a pack can load from disk, pass every unit test and the validation
  gate, and still leave the game a blank page. Bundle the whole tree; never a
  list of the files someone remembered.

## A variant is a game; a pack is content for one

`variants/<id>.json` declares one game the player may start: a display name, the
packs it layers and the difficulty presets it offers. `src/content/variants.ts`
holds the schema and the two-pass load, and is the only place a variant is
interpreted. Adding a game is adding a document — nothing under `src/` names a
variant, a pack or a rank, and the Classic game is `variants/classic.json` rather
than a default anything falls back to.

Four things to know before editing either side of it:

- **A variant selects; it never overrides.** There is no mechanism for patching a
  rules field, deliberately: rules are a whole document from a pack, because a
  variant that could nudge single numbers is a difficulty multiplier with a
  different name. The player-settings difficulty preset is the same rule seen from
  the other end — it chooses a **rank** and does nothing else, and the rank has to
  reach `createStageSource` as well as `createWorld`, because a rank selects the
  entry-wave sequence too.
- **"Later wins" covers the manifest and the rules, not just the content maps.**
  `composeManifest` in `src/content/registry.ts` layers manifest fields one at a
  time — records merge per key, the palette is a union, badges and each half of the
  stage sequence are replaced by the last pack to state one — and rules are the last
  pack that ships any. A one-pack registry is unchanged by all of it, which is what
  keeps this a generalisation rather than a second rule.
- **An overlay pack may replace a document, not reference one.** `loadPack`
  resolves references _within_ a pack, so an overlay can ship a different sprite,
  sound or sound-free path under an existing id — and cannot ship a stage naming
  the base pack's aliens. `packs/swarm-remix/` is the demonstration and stays
  inside that line; `docs/ARCHITECTURE.md` §4.5 records the limit.
- **`variants/` is read two ways, like `packs/`**, and for the same reason:
  `readVariantSources` in `src/content/fs.ts` for the validator and the tests,
  `bundledVariantSources` in `src/content/bundle.ts` for the browser, held to each
  other by `tests/unit/bundled-packs.test.ts`.

Player settings live in `src/ui/settings.ts` and persist through
`src/ui/storage.ts` — the one `KeyedStorage` the high-score table uses too, which
catches on every path so that blocked site data degrades to defaults instead of
throwing. The menu in `src/ui/menus.ts` **applies nothing**: a row writes a patch
and `src/main.ts` is the one place a setting has consequences.

## A pack may be forged, and refusing is half of what the forge does

`/forge` (`.claude/skills/forge/SKILL.md`) turns one sentence into a pack. The
skill is a procedure and names no field; `docs/content-guide.md` is the state
document it reads for what a document may say and — the part no schema shows —
what the engine will actually honour. Neither copies `src/content/schema.ts`.

Four things to know before touching either, because each is a trap the forge was
built around:

- **Four schema fields validate and are read by nothing**: `alien.abilities` for
  the two reserved ids (`transform`, `mirrorPlayer`), `alien.sounds`,
  `stage.diveRules` and `stage.modifiers`. That is why a prompt the
  engine cannot satisfy has to be **refused** rather than approximated — nothing
  downstream can tell the difference. `tests/unit/forge-guard.test.ts` pins each
  one as an identity between a world that states it and a world that does not, so
  the day one starts working, that test is what says so.
- **The rules layer couples a pack to numbers it cannot change.** A role no
  difficulty row names never attacks; a formation narrower than the breathe table
  breathes lopsidedly; `continuousBombingAt` is an absolute enemy count, so a small
  fleet gets nasty early; and a formation with no `captiveSlots` silently disables
  capture. `docs/content-guide.md` section 7 is the list.
- **"Validated" means flown, within a protocol.** `npm run validate-packs` flies
  every stage every variant plays with autoplay personas (`scripts/playability.ts`),
  the general form of `tests/sim/forged-pack.test.ts`. A forge report still carries
  that test's five measurements for its own pack, because the gate's seeds and
  thresholds are a floor, not a description.
- **Section 2 is enforced on generated content**, by the scan in
  `tests/unit/forge-guard.test.ts` rather than by the generator's good behaviour,
  so a prompt cannot argue its way to the original's names.

`packs/deep-sea/` is the pack it produced, and its README keeps the sentence, the
measurements and what the forge got wrong first.

## Enemies address the formation; the formation is sixteen numbers

A formation is `N` column X coordinates and `M` row Y coordinates —
`formationAxes` derives them from the distinct slot indices — and every enemy
holds an _index_ into them rather than a position. Sway and breathe move only
those `N + M` values, so forty enemies follow for free and a differently shaped
formation inherits both motions without new code. An enemy at home _is_ its
slot. Per-enemy offsets are the mistake this exists to prevent; they cost forty
times as much and drift apart.

Two consequences when editing `src/sim/formation.ts` or `src/sim/enemies.ts`:

- **The sway's exit is two-part.** It does not stop when the last wave arrives;
  it stops the next time the offset passes through zero, which is what makes the
  formation exactly centred before anything dives. `formation-settled` is raised
  on that frame.
- **Enemy state advances on a round robin, positions do not.**
  `rules.enemies.updatePhases` is 4 for Classic: each enemy's state machine runs
  on one frame in four, while every enemy's position moves every frame. A launch
  therefore lands within `updatePhases` frames of when it was due, on purpose.

**A stage document is an entry script, not a stage.** The arcade keeps a library of
13 combat scripts and selects one per stage through a per-rank 17-entry index list,
so several stage numbers play one document: `stageSequence.normal.rows` names
`stage-4` twice because stage 8 is the same script row. Never ship a copy.
`packs/classic/stages/README.md` carries the mapping, the decode of every `home`
back to the ROM's wave table, and what the reference does not settle.

**A simultaneous pair in a wave must differ in `mirror`.** One path plus a reflection
is a single lane, so two same-handed slots launching on the same frame fly as one
sprite. `trailing` on the second of a pair is what makes a wave a file;
`tests/unit/classic-content.test.ts` fails on the collision.

Slot homing is `toSlot` and nothing else. It resolves its target when the path
compiles, so an enemy entering a _swaying_ formation is handed where its slot
**will be** on arrival (`slotPositionAhead`, solved as a fixed point), not where
it is now. Writing a second homing routine is the wrong fix — a diver returning
from the bottom flies the pack's `enemies.dive.returnPath`, which is one
`toSlot` segment and nothing else.

## The attack reads one row of a table and never scales it

`src/sim/dive.ts` resolves the stage's difficulty row once and obeys it: per-role
launch rates, the simultaneous-diver limit and its later bump, the
continuous-bombing threshold. The rows are **non-monotonic on purpose** — three
of the four rank tables contain a stage markedly easier than the one before — so
nothing interpolates between rows and there is no difficulty multiplier anywhere.
`src/content/rules.ts` holds the resolvers (`resolveMaxDivers`,
`resolveLaunchCredit`, `isContinuousBombing`, `resolveBombVectors`,
`allowsTransform`, …) and is still the only place a row is interpreted.

Two consequences when editing either:

- **Diving begins from `formation-settled`**, the frame the sway passes back
  through zero — not from the last wave arriving. `armDives` is called there and
  nowhere else.
- **Two row fields are read by nothing**: `bombEnable` and `reloadAttackVectors`.
  The reference records the selectors but not what they select, so modelling them
  would be invention. Leave them as data until the reference covers them, and do
  not "wire them up" to something plausible.

That segment is also the whole answer to "does this enemy join the formation?":
a path carrying one leaves its flyer `home`, and a path without one — every
challenge script — leaves it `departed`, gone from the field without having been
hit. The **path** decides, never the stage kind, so a challenge stage and its
`kind: "challenge"` document cannot disagree.

## Three ways to lose a fighter, two events

A bomb and an enemy **body** are the same loss — the arcade has one routine for
every hit on the fighter — so both end in `killPlayer` and raise `player-hit`.
Being **captured** is the loss that gets its own event. `resolveBodyCollisions`
in `src/sim/world.ts` is the body half, and it adds no geometry: it is the
fighter's own `player.hitWindow` with the enemy's `hitPadding` on top, the same
primitive from the other side. A body is an _attack_, so it sits behind
`allowsAttacks` and nothing rams you on a challenge stage.

Two things the reference does **not** settle, recorded as its section 11 item 2:
whether the collision destroys the enemy, and whether it scores. The engine takes
the negative reading of both — every kill and every point traced anywhere in the
reference arrives through the _rocket_ hit dispatcher — so a ram costs a fighter
and changes nothing else. Do not "improve" that into a free kill without the
observation the reference asks for; it would let a collision clear a stage.

## Capture is one channel, and the flag is the rule

`src/sim/abilities/capture-beam.ts` holds the tractor beam, the captured fighter, the rogue, the
rescue and the dual fighter. There is **exactly one captured fighter in a run,
ever**, and a captor may only be chosen while the channel is idle. A successful
capture does not free it, so while a fighter is held — including parked as a
rogue, including flying beside you as a dual — no second beam appears. "A dual
fighter is never targeted" is therefore not a special case anywhere; deleting one
would be adding a bug. The complete set of releases is the list of
`releaseCapture`'s callers, each an arcade site the rules-and-scoring report
traced, and it is written out there.

Three things that are easy to undo by accident:

- **A captor's dive is an ordinary dive.** `src/sim/dive.ts` asks the channel one
  question on a captor-role launch and changes only the path. A second launcher,
  or a second kind of motion, is the mistake this arrangement prevents.
- **`Enemy.home` names a slot in one of two tables.** `inCaptiveSlot` says which:
  the alien slots, or the captive slots a stolen fighter parks in. `homePosition`
  and `isRightOfCentre` in `src/sim/formation.ts` take the flag; a call that
  forgets it parks the captured fighter in a Warden's seat.
- **A kill is reported to the channel with the state the enemy _had_.** The world
  marks an enemy dead before telling `captureNoteDestroyed`, so a rescue's recall
  cannot drag the captor home — and the rescue condition ("both attacking") reads
  the prior state. Reading `enemy.state` there turns every rescue into a rogue,
  silently.

Being captured is a **loss condition of its own**: it raises `player-captured`,
not `player-hit`, and on the last fighter it ends the game.

**The channel is stepped outside the attack director, so the director's gates do
not cover it.** `stepAttacks` refuses everything on a challenge stage in one
place; `stepCapture` runs whatever the stage is, because a beam mid-flight has to
finish and a freed fighter has to dock. Anything in it that _attacks_ — the
captive escorting its captor, a rogue's swoop — therefore asks `allowsAttacks`
itself, and `enterStageCapture` refuses to put a held fighter on the field at
all where nothing may attack. A held fighter sits a challenge stage out and
returns on the next stage that has a formation to return to.

One more thing the two-stage life of a captive makes easy to get wrong: **enemy
ids are per stage**. `CaptureState.captiveId` is cleared on every stage entry and
set again only if a captive is actually placed, because a stale id is some other
enemy's number next stage — and shooting _that_ would release the channel.

**An attempt outlives the fighter it was aimed at, and the three capture goldens
cannot see that.** A capture dive is a committed swoop — the captor takes its aim
once, where `aimAtPlayer` begins — so killing the fighter in between leaves a beam
open over the column it died in, and the channel rightly stays busy (the ROM's
flag is not cleared by the player dying; the reference enumerates every write that
does clear it). The replacement therefore waits: `resolveRespawn` serves the timer
and then holds the fighter off the field while `beamIsOut`, or it arrives at its
one fixed column underneath a full-extension beam and is taken on the frame it
appears. **`capture-beam`, `capture-rescue` and `dual-fighter` all run on
`unbombedCabinet` — `maxBullets` 0, `collision` off — so the beam is the only
thing in them that can cost a fighter, and any capture bug needing a death
mid-attempt is unreachable in all three.** `tests/e2e/capture.spec.ts` plays the
real browser for exactly that reason; when you touch this channel, ask what the
bombs-off cabinet is hiding.

## Audio is the other side of that boundary

`src/audio/synth.ts` is in two halves on purpose: `buildSoundPlan` is pure and
turns a `Sound` into the voices and scheduled parameters to build, and `playPlan`
realises one against `SynthContext` — a structural subset of Web Audio that a
real `AudioContext` satisfies and `tests/unit/helpers/fake-audio-context.ts`
implements. That is the only reason the graph is testable on the Node-only test
environment, so keep the split when editing.

Two more things hold: no `AudioContext` exists until `Synth.unlock()` runs from a
user gesture, and every call into Web Audio is wrapped — the game must run
silently and correctly when audio is blocked. And **which event plays which sound
is data**: `sounds` in a pack manifest maps simulation event names to sound ids,
the loader checks every id, and `src/audio/sfx.ts` names no effect of its own.

## Layout

`docs/DESIGN.md` section 9 fixes the source layout, and each directory carries a
short README saying what lands there and when, updated as each milestone fills
it in.

**A card that waits on a keypress names its keys, from a list the draw function
iterates** — `exitConfirmUnderLines` in `src/ui/pause.ts`, `settingsNotes` in
`src/ui/menus.ts`. Neither Vitest project has a DOM, so that list is the only way
to test what a card tells the player, and the card's height is counted from it so
a line added cannot be drawn off the plate. Help is the dim ink and goes last,
under the question. The two shapes this exists to prevent are both shipped bugs:
a control line that is conditional (the settings card dropped both of its when
storage was blocked) and one that names a key without saying what it does **on
this card** (`X` opens the exit from the pause and cancels on the card that
follows, and a line reading only "goes back" left that loop unreadable).

`/lab` (`src/ui/lab/`, entry document `lab.html`) is a **dev-only** route, kept
that way three ways at once: Vite's only build input is `index.html`, nothing on
that graph imports the lab, and the URL is wired up by a plugin declaring
`apply: 'serve'`. `tests/unit/lab-dev-only.test.ts` checks all three.

## Rendering: rasterise once, and no colours in the renderer

`src/render/` is a subscriber and holds no art of its own. Three contracts that
are easy to break and cheap to keep — `src/render/README.md` has the detail:

- Anything derived from pack data is built when the pack loads, not per frame.
  `createSpriteSheet` rasterises every frame up front and `SpriteSheet.bitmap`
  returns the _same_ object each call; the font caches one tinted strip per ink
  colour. Treat what comes back as read-only.
- The palette is pack data. A sprite colour the pack's `palette` does not declare
  is a load-time throw from `createSpriteSheet`, never a silent black pixel.
- **A one-shot animation is bound to an event by the pack, exactly as a sound
  is.** The manifest's `effects` map names a sprite and an offset per event name;
  `src/render/effects.ts` subscribes and plays it, knows no event name of its own,
  and takes the animation's length from the sprite's `frames` × `frameDuration` in
  **simulation steps** — so it plays once, ends by construction, and freezes with
  a paused game. Presentation is fitted to the rules window it sits in and never
  the other way round: the death explosion is shorter than `player.respawnFrames`
  because `tests/unit/effects.test.ts` requires it, and an animation that wanted
  longer is a redraw, not a rules edit.
- **The sheet and the world must be the same variant's, and only `src/main.ts`
  can get that wrong.** The flow boots on the **remembered** variant, not
  `variants[0]`, and `onVariantChange` reports a _change_ — which starting on one
  is not. So `applyVariant(flow.variant)` runs once at boot and `applyVariant` is
  the only builder; seeding the sheet from the first variant drew the whole Deep
  Sea fleet as squares after a refresh. `scene.ts` no longer hides that: no sheet
  at all is the art-free fallback, a sheet _without_ the enemy's sprite throws
  `SceneSheetMismatchError`. And a state assertion cannot see this class of bug —
  the page knew which variant it was running the whole time — so
  `tests/e2e/variants.spec.ts` reads the canvas for `scene.ts`'s placeholder
  colours instead. Reach for a pixel assertion when the fault is what is _drawn_.

Rasterising is split from drawing so both are testable on Node: pixels are pure,
and turning a bitmap into something `drawImage` takes is an injectable
`SurfaceFactory`. Keep that split. `npm run sprite-sheet` renders a pack's art
and font through the real pipeline into `docs/media/`, which is the contact sheet
`docs/DESIGN.md` section 11 asks a visual PR to attach.

## The build says what it is, and nothing about it is hand-written

`scripts/build-identity.ts` derives the short commit, the dirty flag, the build
date and `dev`/`release` from git and the clock; the plugin in `vite.config.ts`
puts that **one serialisation** into the bundle (`define`) and into the
`build.json` it serves in development and emits into `dist/`. The two must stay
one serialisation — a page compares itself against that file, so a second
serialiser is a phantom "new build" notice. Never add a hand-maintained version
number; this project's recorded failure mode is exactly that.

That serialisation is published, not just served: `.github/workflows/ci.yml`
packages the `dist/` the `check` job built and a `deploy` job puts it on GitHub
Pages, so a push to `main` that passes the checks is a release and one that fails
is not. `docs/ARCHITECTURE.md` §2 is the account of it; there is no second build
path and nothing to run by hand.

Three consequences when working here:

- **A dev server's stamp is the moment `npm run dev` started**, because the
  identity is derived when Vite reads its config. Everything else about editing
  needs no action at all — the dev server reloads the page itself for `src/`,
  for `packs/` and for `index.html`. `docs/ARCHITECTURE.md` §2 has the measured
  table, including the one case that needs a restart (a new dependency).
- **`src/ui/build-info.ts` imports nothing**, on purpose: `vite.config.ts`
  imports the served file's name from it, and an import chain reaching a canvas
  would drag browser code into the Node config. Drawing lives in
  `src/ui/build-stamp.ts`.
- **`base: './'` in `vite.config.ts` is what makes the bundle work under a
  project Pages subpath**, and it looks like tidying. Changing it to `/` breaks
  every asset on the hosted site, and the failure does not show up locally.
- **The poll is fresh on GitHub Pages, but not for the reason the page thinks.**
  `cache: 'no-store'` and the `?t=` stamp in `buildIdentityUrl` do it on an
  ordinary host, and are why the dev server sees every change at once; Pages'
  CDN keys on the path alone and ignores both. What makes the hosted notice
  prompt is that **publishing purges the edge** — measured across a real deploy,
  with the numbers, in `docs/ARCHITECTURE.md` §2. So do not restore the claim
  that the cache-buster is what keeps the hosted poll fresh, and do not read the
  600-second edge lifetime as a bound on the notice: it is what the edge does
  between deployments, and a deployment ends it.

## Sharp edges

- Vitest runs two projects, `unit` and `sim`, both on the **Node** environment.
  There is no DOM in either — that is deliberate, and it is what stops sim code
  from quietly acquiring a browser dependency.
- `npm run validate-packs` must pass in CI and succeeds on an empty `packs/`
  tree and on a pack whose content directories are empty. It calls the real
  `loadPack`, so the gate and the game cannot disagree; its tests in
  `tests/unit/validate-packs.test.ts` run the script against throwaway pack
  trees. Its fifth pass flies every stage (`docs/ARCHITECTURE.md` §4.7);
  `tests/sim/validate-packs-playability.test.ts` holds it to passing the shipped
  tree and failing `tests/fixtures/unplayable/`.
- `tests/unit/classic-pack.test.ts` checks `packs/classic/` against
  `docs/reference/arcade-reference.md`. Plan, reference and data are three legs
  of one stool: change a number in any of them and that test is the third voice.
- `tests/helpers/rules.ts` holds the content fixtures, not only the rules ones:
  `classicPack`, `classicRules`, `classicStages` and `classicFormation` read the
  shipped pack through the real loader, `stageSourceOf` wraps a hand-written
  stage for a shape the pack does not ship, `minimalRules` is the smallest
  document the schema accepts, and `quickRunRules` bends the shipped rules so a
  whole run fits in a test. Tests use them rather than writing content inline,
  so a new required field is one edit.
- Art is original by rule, not by preference: `docs/DESIGN.md` section 2 bars
  ripped sprites, traced art, ROM data and the original's names. Enemy roles are
  `drone`, `wing` and `warden` everywhere outside
  `docs/reference/arcade-reference.md`.
- `tests/unit/sim-boundary.test.ts` briefly writes a `__boundary_probe__.ts` into `src/sim/`
  and removes it again. The path is gitignored in case a run dies mid-test.
- **Killing the last enemy on the field rolls the stage over on the same step**, and
  the next stage's fleet replaces the one under test — so a test that watches
  `world.fleet.enemies[0]` is watching some other enemy a frame later. Hold the
  enemy by reference. The same applies to the attack director: parking an enemy in
  front of the fighter and holding fire will also shoot whatever the launcher sends
  down the same column, so set `world.dive.armed = false` when the measurement is
  about one specific kill.
- A value in `packs/classic/rules.json` with **no `provenance` entry is unmarked,
  and nothing fails**: `unknownProvenancePaths` catches a marking that names no
  field, but not a field that carries no marking. The lists in
  `tests/unit/classic-pack.test.ts` are the only thing holding the arcade values to
  `AGENTS.md`'s verified/provisional rule, so a new value goes in one of them. An
  arcade value that is **presentation** cannot be in a pack at all — the starfield's
  byte-to-pixels conversion is in `src/render/starfield.ts` — so `provenance` cannot
  reach it and a `check:count` counter reading the module is what holds the state
  document to it instead.
- The game boots into the **start-up selector** when more than one variant ships
  and into **attract mode** otherwise, never into play: `src/ui/flow.ts` is the
  one state machine — variant-select, attract, settings, playing, paused, the exit
  confirmation, the between-stage challenge card, game over, results and
  high-score entry <!-- check:count flow.phases 10 --> — and `src/main.ts` only
  calls `flow.step(frame)` and draws the phase. Anything driving the browser has
  to get past the selector and push start — that is what `startGame()` in
  `tests/e2e/smoke.spec.ts` is for — and every phase timer counts **simulation
  steps**, never the wall clock. The attract demo is the real simulation played
  through `src/engine/replay.ts`, so it cannot drift from the game.
- **An autoplay persona is data, and the pilot may only see what is drawn.**
  `variants/<id>.json` declares the personas; `src/content/personas.ts` is the only
  place one is interpreted and nothing under `src/` names one. The pilot in
  `src/ui/autoplay.ts` is handed a `PilotView` built by `viewOfWorld` and **never a
  `World`** — that is what makes "it does not cheat" checkable, and
  `tests/unit/autoplay.test.ts` checks it by fingerprinting a world either side of
  a thousand samples and by holding the view's field list to what a player can see.
  Adding a field to that view is adding something a persona knows, so it belongs in
  the same review as the axis that wanted it. The pilot is also under the
  `Math.random`, `Date` and `performance` bans in `eslint.config.js` even though it
  is not in `src/sim/`: same seed, same persona, same run is what
  `tests/sim/autoplay-personas.test.ts` rests on, and that test also holds the four
  names to being an _ordering_ — edit a persona's numbers and it is the thing that
  fails.
- **A takeover is the fighter's controls in a live game, and nothing else.**
  `humanTookOver` in `src/ui/flow.ts` is deliberately narrow: `left`, `right` or
  `fire` while `playing`, plus `start` in attract. Widening it looks harmless and
  is not — every other phase belongs to a cursor, so a wider rule disarmed autoplay
  when somebody chose a persona with `fire`, answered the exit card, or skipped the
  results screen. `menu`, `pause` and `exit` are never takeovers.
- **Pausing is a phase, not a flag, and the simulation never hears about it.**
  `paused` is a phase the world is simply not stepped in, and the frame that
  carried the press was stepped before the phase changed — so the sim sees exactly
  the frames it would have seen unpaused and a resumed run continues bit for bit
  (`tests/unit/flow.test.ts` asserts it against an unpaused run of the same
  frames). Nothing in `src/sim/` may gain a notion of being paused; a `paused`
  boolean beside `phase` is "playing, but not stepping the world", which is the
  shape `src/ui/flow.ts` exists to refuse. Leaving a game goes through the pause
  first and discards the run — the score never reaches the high-score table, and
  the card says so.
- Headings are degrees, **clockwise positive, with 0 pointing down the screen**
  (`src/content/schema.ts`), so on a y-down playfield a heading θ is the vector
  `(−sin θ, cos θ)` and 90° points _left_. `src/sim/paths.ts` restates it as a
  table; reading it the other way round is the quietest bug in movement code.
- Mirroring a path is a reflection applied to the **evaluation**, never a second
  copy of the data: world-space targets reflect in, sampled positions reflect
  out, and arcs reverse their handedness because the reflection says so. A pack
  that ships a hand-mirrored twin of a path is working against
  `src/sim/paths.ts`. A dive uses the same mechanism to fan outwards: the enemy's
  side of the formation picks the flag (`isRightOfCentre`). The one exception is
  a path whose point is to pass over the **fighter**: the mirror axis is the
  playfield centre, anchor x 112, and the fighter's home column is x 103 because
  the ROM's travel limits are not symmetric — 9 px apart against a shot window
  ±5 px wide. The challenge scripts are authored per column for that reason
  (`packs/classic/paths/README.md`).
- **A dive path states no `start` and may use no `line` or `bezier`.** It is
  flown from wherever the enemy already sits, so every segment has to be relative
  to the flyer's pose — `arc`, `loop`, `sine`, `aimAtPlayer`, `exitBottom`. A dive
  authored with absolute targets drags all forty enemies through the same piece
  of screen and no single-position test notices;
  `tests/unit/classic-paths.test.ts` flies each one from six slots for that
  reason. `/lab` starts such a path at its slot marker, so a dive previews there.
- `ACTIONS` in `src/engine/input.ts` is **append-only**: `ACTION_BIT` is
  `1 << index` and a golden replay on disk is a list of those masks, so a new
  action takes the next free bit and changes nothing, while inserting or reordering
  silently reinterprets every log in `tests/sim/golden/`. `menu` is the fifth and is
  the front end's alone — no simulation code reads it.
- `/.scratch/` is git-, Prettier- and ESLint-ignored: put probe scripts, one-off
  harnesses and video frames there rather than in `/tmp`, which sibling worktrees
  share.
- Vite's port is shared between checkouts, and `playwright.config.ts` reuses an
  existing dev server outside CI — so a second worktree's Playwright run
  silently tests the _first_ one's build: green, and meaningless. Set
  `STAR_SWARM_PORT` to give a worktree its own.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
