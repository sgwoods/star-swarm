# `variants/`

One document per **game this build offers**. A variant is a display name, the
packs it layers and the difficulty presets a player may pick from; the start-up
selector in `src/ui/flow.ts` lists them and starts the chosen one.

`packs/` and `variants/` answer different questions. A pack is _content_; a
variant is a _game_. The registry layers packs within one game, which is not the
same as offering several — so this directory sits beside `packs/` rather than
inside it, and `npm run validate-packs` checks both.

```
variants/
  classic.json       the arcade game — the first entry, not a special case
  deep-sea.json      the forged game: one sentence, through /forge
  swarm-remix.json   a demonstration that a variant is only data
```

`src/content/variants.ts` is the schema and the only place a variant is
interpreted. The file name is the id: `classic.json` must declare `"id":
"classic"`, exactly as a pack's `id` must equal its directory.

## What a document says

```json
{
  "id": "swarm-remix",
  "name": "SWARM REMIX",
  "description": "A DEMONSTRATION - CLASSIC WITH A NEW DRONE DIVE",
  "packs": ["classic", "swarm-remix"],
  "order": 90,
  "demonstration": true
}
```

| Field           | What it is                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------- |
| `id`            | Matches the file name                                                                         |
| `name`          | What the selector shows — the game's name, not the pack's                                     |
| `description`   | A line under the name. Drawn in the pixel font, so upper case reads best                      |
| `packs`         | Layered in order, later winning. At least one, and between them they must ship a `rules.json` |
| `order`         | Sort key on the selector; equal orders fall back to the id                                    |
| `demonstration` | Marks a variant nobody has committed to. The selector says so                                 |
| `difficulty`    | The presets on offer. Omitted means one per rank the rules declare                            |
| `autoplay`      | The personas the cabinet may play itself as. Omitted means no autoplay                        |

## Difficulty presets choose a rank, and nothing else

`docs/DESIGN.md` section 6: the player-settings difficulty preset selects the
**rank**, and the rules layer resolves that rank into whole data tables — the
per-stage difficulty rows and the entry-wave script sequence, which plateau at
different stages. A preset is therefore a label and a rank id, with nowhere to put
a scalar:

```json
"difficulty": {
  "presets": [{ "id": "arcade", "label": "ARCADE", "rank": "A", "description": "THE FACTORY SETTING" }],
  "defaultPreset": "arcade"
}
```

Leaving the block out derives one preset per declared rank, labelled with the rank
id and described with the rank's own `label` — which is why `swarm-remix.json`
needs no difficulty block at all. `variants/classic.json` declares its own so that
the four arcade ranks read as player-facing names.

Omitting `defaultPreset` picks the preset whose rank is the rules' own
`defaultRank`.

## Autoplay personas describe a player, and never the game

A **persona** is how well the cabinet plays this game by itself — `beginner`,
`normal`, `expert`, `astronaut` — and it lives here rather than in a pack for the
same reason a difficulty preset does: both are properties of the _framing_ of a run
rather than content in the game world. An alien, a path or a sprite is content and
belongs to a pack; how well somebody plays is not.

```json
"autoplay": {
  "personas": [
    {
      "id": "astronaut",
      "label": "ASTRONAUT",
      "description": "SHOOTS DIVERS, RESCUES",
      "reactionSteps": 1,
      "aimTolerance": 2,
      "threatHorizon": 288,
      "dodgeMargin": 24,
      "shotDiscipline": 1,
      "panic": 0,
      "engage": 1,
      "rescue": true
    }
  ],
  "defaultPersona": "normal"
}
```

Eight axes, every one of them required, and all in the game's own units — pixels of
the playfield and **simulation steps**, never seconds and never a 0…1 "skill":

| Field            | What it bounds                                                        |
| ---------------- | --------------------------------------------------------------------- |
| `reactionSteps`  | How stale the view it decides from is; 20 is a third of a second late |
| `aimTolerance`   | Pixels off the intercept it will still fire at; the shot window is ±5 |
| `threatHorizon`  | Pixels of altitude within which it notices something coming           |
| `dodgeMargin`    | Clearance it keeps, on top of the fighter's own vulnerable band       |
| `shotDiscipline` | 0…1: how reliably it keeps one of its **two** rockets back            |
| `panic`          | 0…1: how often a pressing threat provokes a wasted reversal           |
| `engage`         | 0…1: how often it goes under a diver to shoot it rather than sidestep |
| `rescue`         | Whether it will walk into a tractor beam to go for the dual fighter   |

`description` is optional and is what the settings row says underneath; `label` is
what the row itself reads, so keep it short — the row is a fixed-advance font and
the value column is fourteen cells.

Three rules the loader enforces, each naming the document and the field:

- Every numeric field is **required**. A persona whose interesting numbers came from
  a default would be a persona tuned in a source file rather than in a document,
  which is the failure `src/sim/` avoids by holding no constants.
- Two personas may not share an `id`, and `defaultPersona` must name one that is
  declared.
- A probability is 0…1 and `reactionSteps` is a whole number; anything else is a
  schema failure rather than a value that silently does nothing.

**Leaving the block out means this game cannot be watched**, and there is
deliberately nothing to derive a fallback from: a rank is a table the rules already
declare, but how well a game should be played is written down nowhere. The
`AUTOPLAY` settings row is simply absent, exactly as the `GAME` row is absent on a
one-variant cabinet. `swarm-remix.json` declares no personas, which is why the
demonstration cannot be watched playing itself.

**The names are a claim, and it is tested.** `tests/sim/autoplay-personas.test.ts`
plays each persona over a block of seeds and requires mean score, median score and
survival to climb at every step of the ladder — so a persona edited into the wrong
order fails the build rather than quietly offering a ladder that does not climb.
What each axis _does_ is [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#7-autoplay)
§7.

## What a variant may not do

**Override a rules field.** There is no mechanism for it, deliberately: rules are a
whole document from a pack, because a variant that could nudge single numbers is a
difficulty multiplier with a different name. A variant that wants different numbers
names a pack with a `rules.json` that has them — which is exactly what
`docs/ARCHITECTURE.md` §4.4 says a sibling game does.

## Adding one

Write the document and that is all; nothing under `src/` names a variant, a pack, a
rank or a persona. `npm run validate-packs` checks it, and a failure names the document and the
field — every pack it lists must be installed, those packs must supply rules
between them, and every preset's rank must be one those rules declare. Errors or
variants come back, never both, so a half-formed variant cannot load.
