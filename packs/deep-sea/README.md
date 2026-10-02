# `packs/deep-sea/`

**The first forged pack, and the proof that the loop closes.** It was written by
the `/forge` skill from one sentence, validated by the gate, and then played
headlessly by an autoplay persona — because the validator's playability checks do
not exist yet, which is the gap `docs/content-guide.md` section 2.2 is about.

The sentence:

> a stage where lanternfish rise out of the trench from below, anglers hang in a
> middle band with a lure, and a pair of gulpers hold the top and will try to take
> your fighter

## What it is

An **overlay on Classic**, named by `variants/deep-sea.json`, and self-contained in
the way `packs/README.md` requires: its stages name only its own aliens, paths and
formation, because `loadPack` resolves references within one pack.

| It ships     | Count |
| ------------ | ----- |
| aliens       | 3     |
| flight paths | 4     |
| stages       | 3     |
| sprites      | 4     |
| sounds       | 2     |
| formations   | 1     |

<!-- check:count deepSea.aliens 3 deepSea.paths 4 deepSea.stages 3 deepSea.sprites 4 deepSea.sounds 2 -->

Everything else it inherits: the whole of Classic's `rules.json`, the three enemy
roles, the stage badges, the thirteen other colours of the palette, and — the part
worth noticing — **the challenge half of the stage sequence**. It states
`stageSequence.normal` and leaves the challenge half empty, so the registry
composes its three combat stages over Classic's eight challenge scripts and
stage 3 of a Deep Sea run is `challenge-1`.
<!-- check:count deepSea.sequenceNormal 3 deepSea.sequenceChallenge 0 -->

| Document                    | What it is                                                             |
| --------------------------- | ---------------------------------------------------------------------- |
| `aliens/lanternfish.json`   | role `drone`: 60 points, one aimed shot a dive, flies `dive-drift`     |
| `aliens/angler.json`        | role `wing`: 90 points, a two-bullet spread, flies `dive-lure`         |
| `aliens/gulper.json`        | role `warden`: 170 points, two hits to kill, and the captor            |
| `paths/entry-trench.json`   | an entry from off the top corner, down the middle and back out         |
| `paths/entry-undertow.json` | an entry from **below** the playfield, rising on a sine                |
| `paths/dive-drift.json`     | the lanternfish dive: out, back, a lunge at the fighter, a waver       |
| `paths/dive-lure.json`      | the angler and gulper dive: a turn, a full loop, then a lunge          |
| `stages/reef-1.json`        | four waves, one band of the trench each: anglers, shelf, floor, pair   |
| `stages/reef-2.json`        | three waves, the pair arriving mixed in with the anglers               |
| `stages/reef-3.json`        | three waves, tighter spacing — the pair and the anglers together first |
| `sounds/lure.json`          | replaces Classic's binding for `enemy-dived`                           |
| `sounds/gulp.json`          | replaces Classic's binding for `target-destroyed`                      |

The art and the sounds are original, as `docs/DESIGN.md` section 2 requires, and
the pack adds exactly **one** colour to the palette — the palette is a permission
list and layered packs union theirs, so an overlay states only what it adds.
<!-- check:count deepSea.palette 1 -->

## The formation is twenty-six slots and ten columns

A trench: two gulpers at the top, six anglers across the middle, then a shelf of
eight lanternfish and a floor of ten.
<!-- check:count deepSea.formationSlots 26 deepSea.formationColumns 10 deepSea.formationRows 5 deepSea.formationCaptiveSlots 2 -->

Both of those numbers are constrained from outside the pack, and finding out why
is most of what this pack taught:

- **Ten column coordinates, because Classic's breathe table has ten column
  displacements and applies them by position in the axis.** A narrower formation
  gets the first few of a table authored for ten and breathes lopsidedly; an
  overlay cannot change the rules, so it has to match them.
  <!-- check:count rules.breatheColumns 10 -->
- **Twenty-six slots rather than eighteen, because `continuousBombingAt` is an
  absolute count.** Classic's stage-1 row turns bombing continuous with six enemies
  left, which is a third of an eighteen-slot fleet and under a quarter of a
  twenty-six-slot one. Measured with everything else held equal — the same paths,
  aliens, persona and twenty-four seeds, stage 1 replayed — the eighteen-slot
  formation gave the `normal` persona a mean of 2,008 and 1,637 steps of survival
  against 3,732 and 2,167. A pack cannot move the threshold, so this one moved the
  fleet.
- **Two captive slots, one per gulper**, because the capture channel asks the
  formation which slot a captor owns and a formation declaring none makes every
  captor ineligible. Without them the sentence's "will try to take your fighter"
  would have validated and silently never happened.

Every alien uses one of Classic's three role ids for the same kind of reason: the
difficulty rows key their launch rates by role, and a role those rows do not name
never attacks at all. <!-- check:count rules.launchRoles 3 -->

## What playing it measured

`tests/sim/forged-pack.test.ts` is the harness and holds the assertions; these are
the numbers it was tuned against. Twenty-four seeds per persona, a three-minute
limit per run, on the pack's own `variants/deep-sea.json` at its default rank.

| Persona     | Mean score | Median | Cleared stage 1 | Ran out of time | Furthest stage |
| ----------- | ---------- | ------ | --------------- | --------------- | -------------- |
| `normal`    | 2,820      | 2,680  | 5 of 24         | 0               | 2              |
| `astronaut` | 11,115     | 5,090  | 22 of 24        | 0               | 5              |

Read against Classic on the same seeds — 3,769 and 5,656 — Deep Sea is easier to
clear and worth less per stage, which is what twenty-six gentler enemies instead of
thirty-eight should do. The astronaut's mean is double its median because a run that
survives to the inherited challenge stage banks a bonus worth more than the three
combat stages before it, and about half of them do.

Four other things were measured rather than assumed: every one of the twenty-six
enemies reaches its slot on all three stages with no input and claims it exactly
once; each dive leaves the bottom of the screen without leaving the sides, flown
from every slot its own alien can occupy — twenty-six flights, in the mirror sense
the formation would pick for each — no run of either persona ever reached the step
limit still playing; and the same seed twice gives one fingerprint.

## What the forge got wrong first

Two things, both of which the gate passed and only playing caught:

1. **`dive-drift` left the side of the screen.** The first version turned outwards
   through an arc and then held a sine on that heading, which walks a diver 36 px
   off the left edge from column 0. Flying it from every slot is what found it; one
   starting position would not have.
2. **`aimAtPlayer` was taken too late.** Combined with the above, a diver that was
   already level with the fighter took a nearly horizontal heading and then
   `exitBottom` flew that heading — crawling across the playfield instead of
   leaving it. Both hazards are now written down in `docs/content-guide.md`
   section 5.
