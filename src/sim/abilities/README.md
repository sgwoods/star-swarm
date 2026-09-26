# `src/sim/abilities/`

One file per engine ability from the fixed registry (`captureBeam`,
`splitOnHit`, `transform`, `shield`, `teleport`, `spawnMinions`,
`mirrorPlayer`, …). Packs switch these on and tune them with parameters; they
are never defined by content.

Arrives with Milestone 3: this directory holds no code yet, and the one ability
the game needs lives in `src/sim/capture.ts`. See `docs/DESIGN.md` section 7.5 and
`docs/ROADMAP.md`.
<!-- check:count sim.abilities.modules 0 schema.abilityIds 7 -->
