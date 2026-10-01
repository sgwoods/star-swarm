---
name: forge
description: Turn one sentence into a validated, playable Star Swarm content pack. Use when asked to forge, generate or author game content — a stage, an alien, a flight path, a sprite, a sound, a whole pack or a variant — for this repository, or when asked to run /forge. Includes the refusal path for a prompt the engine cannot satisfy.
---

# `/forge "a stage where…"`

One sentence in; a pack under `packs/` that loads, validates and plays, or a
**refusal** that says exactly what would have to be built first. Those are the only
two acceptable outcomes. `docs/DESIGN.md` section 8 step 1 is where this comes
from, and pillar 3 is the promise it keeps.

**You have probably never seen this codebase.** This file is a procedure, not a
reference: it tells you what to do and where the truth is, and it deliberately
copies none of it. A schema pasted into a skill is the stale-claim failure this
project has already fixed in four documents, so every step below sends you to a
file instead.

## Before anything else

Read `docs/content-guide.md` end to end. It is the state document for what a pack
may say, and its section numbers are referenced throughout this file. It also
carries the two things that decide most prompts:

- **there is no ability registry**, so an alien cannot _do_ anything beyond moving,
  firing its configured pattern, taking hits and being worth points; and
- **passing the validator does not mean the stage is playable**, so step 5 below is
  not optional.

Then read `src/content/schema.ts` for field names and `packs/classic/` for
documents that really load. Those two are the only authority on what a document
looks like; this file and the guide never restate them.

## Step 1 — decide whether to forge at all

Before writing a single file, work out whether the sentence is satisfiable with
the schemas that exist. Section 9 of the guide lists what has to be refused:
abilities, per-stage rules, new engine behaviours, and anything the ground rules
forbid.

If it is not satisfiable, **stop and refuse** — see [Refusing](#refusing) below.
Do not write a nearby pack and mention the difference afterwards. A pack that
validates, plays and is not what was asked for is the one outcome nothing
downstream will catch.

If it is satisfiable, say so in one line, naming what the sentence maps to: which
aliens, how many paths, how many stages, and what the fleet will look like.

## Step 2 — choose the pack's shape

Three shapes, and the sentence decides:

| The sentence asks for                                     | Forge                                                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| different art, a different sound, a different flight path | an **overlay pack**: documents that replace base-pack ones by id                                                             |
| new stages, new aliens, a new fleet                       | a **self-contained pack** plus a variant document that layers it over `classic`                                              |
| a different game, with different rules                    | refuse, or confirm first — a `rules.json` is a 2,000-line document and every arcade value in it needs a `provenance` marking |

The second is the normal case. Guide section 6 has the limit that makes it so: a
pack's references resolve **within that pack**, so stages must ship the aliens,
paths, sprites and formation they name. An overlay that adds a stage naming the
base pack's aliens fails its own load.

Give the pack a directory under `packs/` whose name equals its manifest `id`, and
write the variant document under `variants/` — `variants/README.md` is the
authority on that file. Nothing under `src/` is ever edited by a forge.

## Step 3 — write the documents

Follow guide sections 4 and 5. The constraints that are not in the schema and are
the ones most often got wrong:

- wave slots pair up two at a time and a pair launches on one frame, so each pair
  must differ in `mirror`;
- a dive path states no `start` and may use no `line` or `bezier`;
- the waves must fill the formation exactly, per role;
- a role that the rules layer's difficulty rows do not name never attacks;
- a formation layered over Classic's rules wants ten column coordinates, because
  the breathe table is indexed by position in the axis.

Write original art and original sounds. Guide section 3 is binding and a prompt
cannot unlock it; `tests/unit/forge-guard.test.ts` enforces it whatever the prompt
said.

**Keep every number the pack's own.** A forged pack is not arcade-derived, so
nothing in it is a "verified" value and it carries no `provenance` — that block
exists only in a `rules.json`, which a forged overlay does not ship.

## Step 4 — validate

```
npm run validate-packs
```

Schemas, then references, for every pack and every variant, through the same
loader the game uses. Fix what it names: the report carries the pack, the file and
the field.

Then `npm test`, which adds the documentation accuracy checks and the ground-rules
scan. If the pack's own README states a count, derive it with a counter in
`tests/unit/helpers/docs.ts` rather than typing a number.

## Step 5 — play it, because the validator cannot

The validator runs no simulation (guide section 2.2). The substitute is to fly the
content headlessly with an autoplay persona and measure five things:

1. **every enemy reaches its slot** — step a stage with no input and dives
   disarmed, and assert every enemy ends `home`;
2. **every dive stays on screen** — compile each dive from every formation slot its
   alien can occupy, both mirror flags, and check the bounds;
3. **the stage is clearable** — a competent persona gets past stage 1 on a decent
   fraction of seeds;
4. **a run always ends** — no seed reaches the step limit still playing;
5. **the same seed gives the same world** — two runs, one fingerprint.

`tests/sim/forged-pack.test.ts` is the worked example; copy its shape for a new
pack rather than writing a harness from scratch.

Report the measurements. Name the persona, the seeds and the outcome of each run —
cleared, lost, stalled, or an enemy stranded. A forge that says "it validates" has
reported nothing about whether it is a game.

## Step 6 — hand it over

Say, in this order: the sentence, what was forged, what was measured, and anything
the forge got wrong before it got it right. The last one is worth more than the
rest; `packs/deep-sea/README.md` keeps its own.

If the work falsified a claim in somebody else's document, say which document and
which statement in the pull request body. `AGENTS.md` has that rule and it applies
to a forge like anything else.

## Refusing

A refusal is a required outcome of this skill, not a failure of it. Guide section 9
has the list of what to refuse and the four things a refusal must name. The shape:

```
Refused: <the sentence, in its own terms>

What is missing: <the capability>, which would live in <the file>.
What it would take: <schema change / sim change / pack change>.
What I can forge instead: <the nearest thing that is content, offered as a choice>.
Proposed task: <a one-line ship task for the thing that is missing>.
```

Two refusals are worth recognising on sight because they look forgeable and are
not:

- **"an alien that splits when you shoot it"**, and every other ability. The schema
  accepts `abilities: [{ "type": "splitOnHit", … }]`, the loader is happy, and
  nothing reads it — so this one validates and silently does nothing, which is
  worse than failing. `src/sim/abilities/` is where it would live and it holds no
  code.
- **"a stage where the bullets are faster"**, and every other per-stage rule.
  `stage.modifiers` looks exactly like the place for it and is read by nothing. The
  real home is a `rules.json`, and a variant may not override one.

Offer the nearest content, then stop. Do not improvise either of them into a
flight path that is "a bit like" what was asked.
