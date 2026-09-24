# `src/sim/abilities/`

One file per engine ability from the fixed registry (`captureBeam`,
`splitOnHit`, `transform`, `shield`, `teleport`, `spawnMinions`,
`mirrorPlayer`, …). Packs switch these on and tune them with parameters; they
are never defined by content.

Arrives with Milestone 3. See `docs/DESIGN.md` section 7.5.
