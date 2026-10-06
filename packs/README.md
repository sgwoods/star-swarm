# `packs/`

Content packs. `classic/` is the built-in pack that reproduces the arcade game;
it is authored as data like any other pack (`docs/DESIGN.md` pillar 2), and the
content model is a shared platform rather than Classic's private format, so a
sibling game in the same arcade lineage is another directory here.

A pack holds:

```
<name>/
  pack.json    manifest: id, name, palette, roles, formations, stage sequence
  rules.json   optional: the section 6 rules layer for this pack
  aliens/  paths/  stages/  sprites/  sounds/     one JSON document per file
```

`pack.json`'s `id` must equal the directory name. Formations and the palette
live in the manifest rather than a sixth directory, because section 9 fixes the
five content directories and both are tables rather than a document apiece.

**Which packs a player actually plays is a variant's business, not this
directory's.** `variants/<id>.json` names the packs one game layers; see
[`variants/README.md`](../variants/README.md). A pack here that no variant names is
installed and unused, which is not an error.

**An overlay pack states only what it changes.** Every manifest field has a
default and the registry composes the layered manifests field by field, so a
`pack.json` may be as little as an id and a name — `packs/swarm-remix/` is one, and
inherits the roles, formation, stage sequence, badges, palette and `rules.json` of
the pack it is layered over. The limit is that `loadPack` resolves references
_within_ a pack: an overlay may replace a self-contained document (a sprite, a
sound, a path naming no sound) and may **not** add one that references the base
pack's content, such as a stage naming another pack's aliens.

**A pack need not be written by hand.** `.claude/skills/forge/SKILL.md` turns one
sentence into a pack, reading [`docs/content-guide.md`](../docs/content-guide.md)
for what a document may say and what the engine will actually honour;
[`deep-sea/`](deep-sea/) is the one it produced. A forged pack is an ordinary pack
and gets no exemption from anything on this page.

**An ability is switched on, never written.** [`spore-storm/`](spore-storm/) is the
game that uses four of the new abilities: each alien in its formation names one of
them in its own document, two of its dive paths say where in a flight one fires,
and its `pack.json` binds every event they raise to a sound and an effect. The
behaviour itself is the engine's (`src/sim/abilities/`), so the whole game is
documents like every other pack here.

`npm run validate-packs` schema-checks then reference-checks every pack, then every
variant, and must pass in CI; a pack that fails validation never loads. It succeeds
on an empty tree and on a pack whose content directories are still empty.
