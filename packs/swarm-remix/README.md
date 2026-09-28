# `packs/swarm-remix/`

**A demonstration, not a game anyone has committed to.** It exists to prove one
claim: that adding a variant is adding data. `variants/swarm-remix.json` names this
pack on top of `classic`, and the result is a playable game that needed no change
under `src/`.

It states three documents and nothing else:

| Document                   | What it changes                                                 |
| -------------------------- | --------------------------------------------------------------- |
| `paths/dive-drone.json`    | A different drone dive — a loop out, an arc, then a weave       |
| `sounds/fire.json`         | A different shot: a falling triangle instead of a rising square |
| `sprites/shot-player.json` | A green shot, in colours the base palette already declares      |

Everything else it inherits: the three enemy roles, the forty-slot formation, the
stage sequence, the stage badges, the palette, every other sprite, path, sound,
alien and stage, and all 2,200 lines of `rules.json`. Its own `pack.json` states an
id, a name and a description — see `docs/ARCHITECTURE.md` §4.5 for how the registry
composes the rest, and `packs/README.md` for what an overlay pack may and may not
do.

**It copies nothing**, which is the part worth protecting.
`tests/unit/variants.test.ts` asserts that this variant runs the _same_ `Rules`
object as Classic rather than a duplicate of it, and that the documents differing
between the two variants are exactly the three above. A remix that had duplicated
`rules.json` to change a number would pass a deep comparison and drift the first
time an arcade value was corrected.

Three documents is deliberately the smallest thing that is visibly a different
game. The drones fly a dive nobody authored for Classic, the gun sounds different,
and the shot is a different colour — enough to see at a glance that the selector
changed something, and little enough that nothing here reads as content the project
is maintaining.
