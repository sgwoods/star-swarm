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

`npm run validate-packs` schema-checks then reference-checks every pack and must
pass in CI; a pack that fails validation never loads. It succeeds on an empty
tree and on a pack whose content directories are still empty.
