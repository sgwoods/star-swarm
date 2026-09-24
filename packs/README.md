# `packs/`

Content packs. `classic/` is the built-in pack that reproduces the arcade game;
it is authored as data like any other pack (`docs/DESIGN.md` pillar 2).

Each pack holds `aliens/`, `paths/`, `stages/`, `sprites/`, `sounds/` and a
`pack.json`. `npm run validate-packs` walks this tree and must pass in CI; a
pack that fails validation never loads.

Schemas land with Milestone 1.
