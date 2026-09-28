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

## What a variant may not do

**Override a rules field.** There is no mechanism for it, deliberately: rules are a
whole document from a pack, because a variant that could nudge single numbers is a
difficulty multiplier with a different name. A variant that wants different numbers
names a pack with a `rules.json` that has them — which is exactly what
`docs/ARCHITECTURE.md` §4.4 says a sibling game does.

## Adding one

Write the document and that is all; nothing under `src/` names a variant, a pack or
a rank. `npm run validate-packs` checks it, and a failure names the document and the
field — every pack it lists must be installed, those packs must supply rules
between them, and every preset's rank must be one those rules declare. Errors or
variants come back, never both, so a half-formed variant cannot load.
