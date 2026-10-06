<!-- doc:layer state -->

# Content guide — what a forged pack can say

The document the content generator reads. `.claude/skills/forge/SKILL.md` is the
procedure; this is the ground truth it works from, and it is also what anyone
authoring a pack by hand should read first.

It is deliberately **not** a copy of the schema. Field names, defaults and which
keys are required are `src/content/schema.ts`'s, and that is the only place they
are true; a second copy here would be the stale-claim bug this project has already
fixed in a README, a plan, an architecture document and a pack README. What is
here instead is everything a generator cannot read off the schema: which fields
the simulation actually honours, which ones it quietly ignores, what the rules
layer couples a pack to, and when to **refuse**.

## Why this is a state document

Every sentence below is a present-tense claim about what this repository accepts
and what it does with the result, so every sentence is checkable and is checked —
which is the `state` contract in `AGENTS.md`. The other layers were not options.
A vision or roadmap document is exempt from testing precisely because it asserts
nothing about the code, and `tests/unit/docs-accuracy.test.ts` admits exactly one
of each anyway; a count — and the counts below are the load-bearing claims — is
refused outside a `state` or `reference` document for the same reason. A guide
whose claims rotted would send a generator to write packs that do not load, so
this is the one layer it could honestly live in.

## 1. Read these three, in this order

1. `src/content/schema.ts` — every document a pack can hold, as Zod. Objects are
   **strict**: an unknown key is an error, because the commonest failure in
   generated content is a misspelt field that silently does nothing.
2. `packs/classic/` — documents that really load, including the five READMEs that
   record why each number is the number it is.
3. This file, for what the first two cannot tell you.

Units, everywhere: distances are logical pixels on the 224×288 playfield,
durations are **simulation frames** at the fixed 60 Hz step, speeds are pixels per
frame, and headings are degrees **clockwise with 0 pointing down the screen** — so
90° points left. The one exception is a sound envelope, which is in seconds
because the synth is not on the fixed step.

## 2. Two gaps, and you must not paper over either

### 2.1 Only the registry's abilities can be composed

`docs/DESIGN.md` section 7.5 describes abilities as a fixed registry of engine
behaviours that packs switch on and tune. `src/content/schema.ts` lists seven
ability ids, and all seven are implemented by modules in `src/sim/abilities/`.
None is reserved.
<!-- check:count schema.abilityIds 7 sim.abilities.implemented 7 schema.reservedAbilityIds 0 -->

The difference between the two kinds is the whole hazard, so know both even
though only one exists today:

- An **implemented** ability is strict. Its parameters are validated by a schema
  of its own, and the loader checks what it names and refuses one that could never
  act (§5, **Abilities**). A mistake is a load error with a file and a field.
- A **reserved** ability is not. An id in `RESERVED_ABILITY_TYPES` is accepted on
  an alien with any parameters at all, and then nothing reads it. `transform` and
  `mirrorPlayer` were reserved until what each means was decided; if an id is ever
  reserved again, a prompt that needs it is a refusal.

`captureBeam` cannot be declared on an alien at all: it is the capture channel,
switched on by `capture` in a `rules.json`, and a path's `trigger` naming it says
where in the captor's dive the beam opens (`src/sim/abilities/capture-beam.ts`).
That trigger acts only for the enemy the channel has already chosen as captor on
its capture dive; anywhere else it compiles into an event nobody acts on.

So a prompt that needs anything the implemented abilities do not do — as §5
specifies each, and no further — cannot be satisfied by content. That is a
**refusal**, not a near miss to be approximated with a flight path or a
neighbouring ability (§9). Two near misses were declined when the last two
abilities were defined, and are worth recognising on sight: an alien that changes
type **when it is hit** (`transform` fires on a timer or a trigger; a hit is
`splitOnHit` or `shield`), and anything that **touches the fighter's controls**
(`mirrorPlayer` moves the alien, never the fighter).

### 2.2 "Validated" means flown, within a protocol

`npm run validate-packs` checks schemas and references, and then **flies** every
stage every variant plays: its entry, its dives from every slot, autoplay personas
playing it to the end with lost fighters replaced, and the bullets in flight
(`docs/ARCHITECTURE.md` §4.7). The four ways this project measured a pack passing
the old gate and still being unplayable are each a failure now:

| Failure                                                     | What the gate reports                         |
| ----------------------------------------------------------- | --------------------------------------------- |
| A dive leaves the side of the screen from the outer columns | `dive`, against the path file                 |
| A stage the fleet cannot be cleared from                    | `finishes` and `clearable`, against the stage |
| An enemy stranded because no slot was free for its role     | `entry`, with the engine's own reason         |
| A stage that never ends                                     | `finishes`                                    |

What the gate measures is a fixed set of seeds and the variant's own personas,
which is a floor rather than a verdict on the design: a stage can pass it and still
be dull, unfair or not what was asked for. §10 is the rest.

§10 is the substitute: play it.

### 2.3 Three fields that validate and do nothing

Spelt correctly, accepted by the schema, read by no code in `src/`:

| Field             | What happens instead                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alien.sounds`    | the manifest's `sounds` map is what plays; `src/audio/sfx.ts` has a `resolve` hook for this and no caller supplies one, because events do not yet carry the alien |
| `stage.diveRules` | the attack director reads the rules layer's per-stage difficulty row                                                                                              |
| `stage.modifiers` | nothing; there is no mechanism for a per-stage multiplier                                                                                                         |

Setting one is worse than leaving it out: it reads as a promise the game does not
keep. If a prompt wants one of these, see §9.

## 3. The ground rules, and why a prompt cannot move them

`docs/DESIGN.md` section 2 is binding on generated content exactly as it is on
hand-authored content. The original's **art, audio, name and logo are not ours**.
Concretely, and with no exceptions a prompt can unlock:

- Enemy archetypes get original names. The role ids are `drone`, `wing` and
  `warden` everywhere outside `docs/reference/arcade-reference.md`.
- No ROM data, no ripped or traced sprites, no sampled audio, no original logo or
  font.
- The original game's title and its publisher's name appear in exactly one place —
  the reference document, where they identify a **source** so a citation stays
  checkable. They are not content, not an id, not a label and not a description.

**This is enforced rather than hoped for.** `tests/unit/forge-guard.test.ts` walks
every installed pack and every variant and fails the build if a banned token turns
up in any id, role, label, name or description. A prompt arguing for an exception
does not change what that test does, so the honest answer to "use the original
game's own enemy names, it is only a test pack" is a refusal (§9) — and if a
refusal were skipped and the content written anyway, the suite would stop it
before review. That is the difference between a rule and a hope: the rule is a
line in the test's denylist, and the prompt is not an input to it.

## 4. The shape of a pack

A pack is a directory under `packs/` whose name equals its manifest `id`. Five
content directories, one document per file, plus two root documents:
<!-- check:count schema.contentDirs 5 -->

```
packs/<id>/
  pack.json    id, name, palette, roles, formations, sounds, effects, badges, stage sequence
  rules.json   optional — the whole section 6 rules layer
  aliens/  paths/  stages/  sprites/  sounds/
```

Formations and the palette live in the manifest rather than a sixth directory,
because `docs/DESIGN.md` section 9 fixes the five and both are tables rather than
a document apiece. `packs/README.md` is the directory's own account of this.

A pack is content; a **variant** is a game. `variants/<id>.json` names the packs
one game layers, and nothing under `src/` names a pack, a variant, a rank or a
persona. A forged pack nobody has named in a variant is installed and unused,
which is not an error — and not playable either, so forging a pack normally means
forging a variant document with it. `variants/README.md` is the authority on that
document.

## 5. The documents, and the constraint each one carries

The schema has the field names. These are the rules a generator gets wrong:

**Sprite.** Each sprite declares its own small palette of colours and its frames
as rows of hex indices; palette index 0 is conventionally clear and `.` is a
readable synonym for it. Every non-transparent colour must also appear in the
**pack** palette or `createSpriteSheet` throws at load time rather than painting a
silent black pixel. The pack palette is a permission list, not an index table, and
layered packs **union** theirs — so an overlay states only the colours it adds.

**Sound.** A sound is a waveform plus a pitch or a pitch sweep, or a `sequence` of
steps for a jingle. Which event plays which sound is the manifest's `sounds` map,
keyed by simulation event name; `src/audio/sfx.ts` names no effect of its own.
Replacing one binding in an overlay replaces that key and nothing else.

**Path.** Twelve segment types, and the contract splits in two.
<!-- check:count schema.pathSegments 12 -->

- An **entry** path states a `start` off screen and ends in `toSlot`. `toSlot` is
  the only homing routine there is, and it resolves its target when the path
  compiles — handed where the slot _will be_ on arrival, not where it is now.
- A **dive** path states **no** `start` and may use no `line` and no `bezier`: it
  is flown from wherever the enemy already sits, so every segment has to be
  relative to the flyer's pose (`arc`, `loop`, `sine`, `lissajous`, `wait`,
  `aimAtPlayer`, `exitBottom`, `fire`, `trigger`). A dive authored from absolute
  targets drags the whole fleet through one piece of screen, and no test of one
  starting position notices.
- A **challenge** script ends without ever addressing a slot, which is what makes
  its flyer leave the field rather than park in a formation a challenge stage does
  not fill. The **path** decides this, never the stage's `kind`.
- `mirror` is a reflection applied to the **evaluation**, never a second copy of
  the data: world-space targets reflect in, sampled positions reflect out, and
  arcs reverse their handedness. A hand-mirrored twin of a path is working against
  `src/sim/paths.ts`.

Two hazards measured while forging `packs/deep-sea/`, both invisible to the gate:

- **`cw` turns toward the left of the screen** (headings are clockwise from
  straight down), so whether a turn fans _outwards_ depends on the mirror flag the
  formation picks from which side of centre the enemy sits on. An arc chosen by eye
  from one column leaves the screen from the opposite one.
- **`aimAtPlayer` taken late leaves a nearly horizontal heading**, and
  `exitBottom` then flies that heading — so a diver already level with the fighter
  crawls sideways across the playfield instead of leaving. Aim while there is still
  altitude to spend.

**Alien.** `role` must be a role the manifest declares, and — see §7.1 — a role
the rules layer's difficulty rows key `launchRates` by, or the alien will never
attack. `score` carries the **base** value only; the diving value is the rules
layer's multiplier applied to it. `hp` above 1 wants `hitSprites`, one entry per
hit already taken.

**Abilities.** An alien switches an ability on by listing it in `abilities`, at
most once each, with the parameters that ability's schema names; the engine owns
everything else. What each one does, and what it will not do whatever the pack
says:

- `splitOnHit` — destroyed by a shot, the enemy breaks into `count` of the `into`
  alien, diving. Only a shot splits; nothing splits on a stage where nothing may
  attack; and the loader refuses a chain of splits that leads back to an alien
  already in it.
- `shield` — `hits` shots are spent on the shield before any reach `hp`. A shield
  hit scores nothing and does not change the sprite. With `rechargeFrames`, a
  shield left unhit that long is whole again (§7.6).
- `teleport` — a **diving** enemy blinks to another column and carries on the same
  flight from there; the column is a seeded draw at least `margin` inside the
  playfield. It fires every `everyFrames` of a dive, at a path `trigger` naming
  `teleport`, or both.
- `spawnMinions` — the enemy launches `count` of the `alien` it names, diving,
  never more than `maxAlive` of its own at once. It fires every `everyFrames`, at
  a path `trigger`, or both — and only once the formation has settled, on a stage
  where anything may attack.
- `transform` — a **diving** enemy becomes the `into` alien and carries on. It
  fires `afterFrames` into a dive flown as this alien, at a path `trigger` naming
  `transform`, or both. Its position, its speed and its place on the path carry
  over; its sprite, `hp` (whole again), score, hit box, dive paths, whether it
  returns, how it fires and its abilities are the new alien's, and whatever the old
  alien's abilities held — shield charges, timers — is lost. The change scores
  nothing and raises `enemy-morphed`; a kill afterwards is worth the new alien's
  value. The loader refuses an `into` the pack lacks or that names the alien
  itself. `into` need not dive, because it finishes the dive it inherits; a chain
  of transforms may lead back round. It is not the arcade's transform attack,
  which is `transform` in a `rules.json`.
- `mirrorPlayer` — a **diving** enemy copies the fighter's horizontal movement.
  Each frame it closes `strength` (above 0, at most 1) of the sideways gap to the
  fighter's column (`"mode": "track"`) or to that column mirrored about the
  playfield's centre line (`"opposite"`), as the fighter stood `delayFrames`
  frames ago. Its own path still decides its row and where the dive ends. All
  three parameters are required; it takes no `trigger`, acts for the whole of
  every dive, and does nothing in the formation or while no fighter is on the
  field.

Two rules hold for all of them. An alien that an ability puts on the field — a
fragment or a minion — flies one of its **own** dive paths and leaves at the end
of it, because it owns no slot; so the loader refuses one with no dive paths. And
a timed ability with neither a timer nor a `trigger` on one of the alien's own
dive paths would never fire, so the loader refuses that too. A `trigger` may not
carry `params` for an implemented ability: every one of them is tuned on the
alien.

**Stage.** A wave is an ordered list of slots, and the two flags are the ones a
generator skips:

- **Slots pair up two at a time, and a pair launches on one frame.** So each
  even/odd pair must differ in `mirror`, or the two fly the same lane as one
  sprite. `trailing` on the odd slot delays it into single file instead.
- **`home` may be omitted**, and then the slot claims the next free formation slot
  matching its alien's `role`. That is what a hand-written pack wants; Classic
  states `home` because its waves are identity-addressed from the ROM's wave table.
- **The waves must fill the formation exactly.** One slot too many for a role and
  the stage throws when the fleet is built — at run time, not at load time.

**Formation.** `N` column coordinates and `M` row coordinates, derived from the
distinct slot indices, with every slot addressing them by index. Sway and breathe
move those `N + M` numbers and nothing else, which is why a differently shaped
formation inherits both motions with no new code — and why §7.2 matters.

## 6. What a layered pack may and may not do

`variants/<id>.json` layers packs in order and later wins. The registry composes
the manifests field by field: `roles`, `formations`, `sounds` and `effects` merge
per key, the palette is a union, and `stageBadges` and **each half of
`stageSequence` on its own** are replaced by the last pack to state a non-empty
one. Rules are the whole document from the last pack that ships one, less any
rank's own sequence for a half a later pack states.

Two limits bound what a forged addition can be, and a generator that does not know
them will produce packs that fail:

- **An overlay may replace a self-contained document; it may not add one that
  references the base pack's content.** `loadPack` resolves references _within_ a
  pack, so a stage naming Classic's aliens, or a stage sequence naming Classic's
  stages, fails its own load. A forged pack that ships stages must therefore ship
  the aliens, paths, sprites and formation those stages name — which is what makes
  it self-contained rather than a patch.
- **A variant selects; it never overrides.** There is no mechanism for patching a
  rules field, deliberately. A forged pack that needs different numbers ships a
  whole `rules.json` of its own, and then it is a sibling game rather than an
  addition — a much larger thing to forge, and one that has to carry its own
  `provenance` markings (`AGENTS.md`: every arcade value is marked verified or
  provisional).

Replacing only one half of the stage sequence is the useful middle: a pack can
state `stageSequence.normal` and inherit the challenge half from the pack it is
layered over, because the two halves are composed independently. Stating it also
retires the base rules' per-rank lists for that half — Classic's ranks B, C and D
each name their own sequence of Classic's scripts — so a forged pack's own stages
play at every difficulty preset, not only the default one.

## 7. Six couplings the schema does not show

The schema validates a pack on its own. The rules layer it will run under is a
different document, and these are the places the two meet. Every one of them was
found by playing a pack — the first five a forged one — rather than by reading the
code. The first four can be found in the documents alone, and the in-game pack
manager does: `src/content/couplings.ts` finds them in a player's mix and the card
says them under its verdict, so a player meets them before the game does
([`docs/ARCHITECTURE.md`](ARCHITECTURE.md#the-pack-manager-and-the-stage-sequence-editor)).

### 7.1 Only roles the difficulty rows name can attack

`resolveLaunchCredit` returns zero for a role the row says nothing about — which
is how a pack keeps a role out of the lottery without touching the engine, and
also how a forged role ends up a decoration. Classic's rank tables key
`launchRates` by three role ids. <!-- check:count rules.launchRoles 3 -->

So a pack layered over Classic's rules must give its aliens those three role ids
if they are to dive. Inventing a fourth role is legal, loads cleanly, and produces
enemies that sit in formation for ever.

### 7.2 The breathe table is indexed by position in the axis

`rules.formation.breathe` carries one displacement per column coordinate and one
per row coordinate, and they are applied by **index**, not by coordinate value.
Classic's tables carry ten columns and six rows.
<!-- check:count rules.breatheColumns 10 rules.breatheRows 6 -->

A formation with six columns therefore gets the first six displacements — which
run from −32 to +4 — and breathes lopsidedly to the left. A forged formation that
will run under Classic's rules should use ten column coordinates and no more than
six row coordinates (its captive row counts as one), or accept a visibly wrong
accordion it cannot fix from inside the pack.

### 7.3 `continuousBombingAt` is a count, not a fraction

The threshold at which bombing turns continuous is an absolute number of enemies
left alive, not a fraction of the fleet. Classic's stage-1 row sets it at six: a
third of an eighteen-slot formation, and under a quarter of a twenty-six-slot one,
so the smaller fleet spends a third of the stage under continuous bombing and the
larger one a quarter. A forged formation much smaller than the one the rules were
authored for is therefore nastier than its enemy count suggests, and the pack
cannot move the threshold — `packs/deep-sea/README.md` records what that cost the
first version of it.

### 7.4 No captive slots means no capture, silently

The capture channel asks the formation which captive slot a captor owns, and a
formation that declares none makes every captor ineligible. Capture then never
happens — no error, no warning, and the mechanic simply absent. A forged formation
that wants the tractor beam declares one captive slot per captor and names the
captor's own slot index.

### 7.5 A stage number is not a sequence index

Normal and challenge stages advance on separate sequences and the rules layer
decides which kind stage _n_ is, so `stageSequence.normal` row 2 is not stage 3.
`src/content/stages.ts` is the only place that walk happens; read it rather than
guessing, and check the mapping by printing it (§10).

### 7.6 A recharging shield can strand a weak pilot

`rechargeFrames` is measured against how often the player connects, and that is a
property of the player rather than of the pack. Flown under Classic's rules, the
mid-tier autoplay persona went thousands of frames without hitting a lone diver,
so a last enemy whose shield recharged faster than that could not be broken and
the stage never ended. `tests/sim/ability-pack.test.ts` found it, and ships its
shield without a recharge for that reason. A recharging shield wants either a
recharge far longer than the stage's last minute or company: it is dangerous on
the last enemy and harmless on the first.

Fragments and minions are the opposite risk: they are attackers like any other,
counted against the difficulty row's simultaneous-diver limit, and they keep a
stage open until they are gone.

## 8. Determinism survives, and not by being careful

`docs/DESIGN.md` pillar 4 is a fixed 60 Hz step, a seeded RNG and replayable input
logs. Forged content cannot break any of it, and that is a property of the schema
rather than of care taken by an author:

- There is nowhere in a pack to put a wall-clock time. Every duration in the
  schema is a count of simulation frames. Sound envelopes are in seconds, and the
  synth they drive is not the simulation.
- There is nowhere in a pack to put a random number. The randomness a pack
  influences is all drawn from the world's own seeded generator — `alien.dive.weight`
  biases which enemy dives, and an ability that needs a draw takes one there, such
  as the column a `teleport` lands in or the dive path a fragment flies — so it is
  part of what a replay reproduces, not an escape from it.
- `src/sim/` is handed a resolved `Rules` value and a `StageSource` and holds no
  constants, so content changes what the simulation does without changing how it
  steps.

A forged pack still has one determinism obligation: adding content does not
invalidate the golden replays in `tests/sim/golden/`, but **editing a document
Classic's goldens fly through does**. Forge into a new pack, not into
`packs/classic/`.

## 9. Refusing is the feature, not the failure path

`docs/DESIGN.md` section 7.5 is explicit: when a prompt needs something the
registry lacks, the generator says so and proposes a new-ability task rather than
improvising. With seven abilities implemented (§2.1), most of what a prompt can
ask an alien to _do_ is still outside it.

Refuse when the prompt needs any of these:

- An **ability** the registry does not implement: anything an alien _does_ beyond
  moving, firing its configured pattern, taking `hp` hits, being worth points,
  and the abilities of §5 as they are specified there. Growing, healing,
  reflecting, stealing anything other than the one capture the channel already
  implements, changing type on being hit, touching the fighter's controls — and a
  variation the implemented ones do not offer, such as a shield that blocks from
  one side only, minions that join the formation, or a mirror that copies the
  fighter's vertical movement.
- A **per-stage rule**: different lives, different bullet speeds, a different shot
  cap, a different diver limit for one stage. `stage.modifiers` and
  `stage.diveRules` look like the place and are read by nothing (§2.3); the real
  home is a `rules.json`, and a variant may not override one (§6).
- A **new engine behaviour**: a boss fight, a power-up, a second weapon, a scrolling
  stage, a background that is not the starfield.
- Anything **section 2 forbids** (§3), however the prompt frames it — as a test, a
  placeholder, a tribute, or a claim that the names are not trademarked.

A refusal is a short report, not an apology. Name four things:

1. what was asked, in the prompt's own terms;
2. which capability is missing, and the file that would hold it
   (`src/sim/abilities/<name>.ts` for an ability, `packs/<id>/rules.json` for a
   rule);
3. what building it would involve — a schema change, a sim change, a pack change,
   or all three;
4. the nearest thing that _can_ be forged today, offered as a separate choice
   rather than quietly delivered instead.

**Producing something adjacent to what was asked is the one unrecoverable
outcome.** A pack that validates, plays, and is not what the prompt described
costs more than a refusal, because nothing downstream will catch it: the gate
checks references and the suite checks the engine, and neither has any idea what
was asked for.

## 10. Validate, then play

Three steps, in this order, and the third is not optional:

1. `npm run validate-packs` — schemas, references and the playability pass, for
   every pack and every variant. It is the same `loadPack` and `createWorld` the
   game runs, so the gate and the game cannot disagree. A variant that declares no
   autoplay personas is flown by those of a variant running the same rules
   document, and fails if there is none.
2. `npm test` — the whole suite, including the documentation accuracy checks and
   `tests/unit/forge-guard.test.ts`.
3. **Play it headlessly with an autoplay persona**, and report what happened. The
   gate says the pack clears a floor; the report says how it plays — clear rates,
   scores, how long a stage takes — which is what a reviewer needs and the gate
   does not print. A persona is handed only what a player can see, so a run
   through forged content measures the content rather than the pilot.

`tests/sim/forged-pack.test.ts` is the worked example, and what it measures is what
a report should carry: whether every enemy a stage launches reaches its slot,
whether every dive stays on screen from every slot its alien can occupy, whether
the stage is clearable, whether a run ever fails to end, and whether the same seed
twice gives the same world.

## 11. The pack that proved this

`packs/deep-sea/` was forged from one sentence and is the end-to-end proof that
the loop closes: generate, validate, play, report. Its own README records the
sentence, the measurements and the one thing the forge got wrong the first time.
<!-- check:count deepSea.aliens 3 deepSea.paths 4 deepSea.stages 3 deepSea.sprites 4 deepSea.sounds 2 -->
