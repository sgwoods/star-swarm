# `src/sim/abilities/`

The ability registry of `docs/DESIGN.md` section 7.5: one file per engine
ability, and `registry.ts`, which is the one place the world asks them anything.
An ability is engine behaviour that a pack **switches on and tunes**, never one a
pack defines. A pack names an ability by id in an alien's `abilities`, or in a
path's `trigger` segment to say where in a flight it fires, and every parameter
it may state is validated by that ability's own schema in
`src/content/schema.ts`.
<!-- check:count sim.abilities.modules 6 sim.abilities.implemented 5 -->

| Module             | Ability        | What a pack writes                                                   |
| ------------------ | -------------- | -------------------------------------------------------------------- |
| `capture-beam.ts`  | `captureBeam`  | `capture` in `rules.json`, and a `trigger` on the captor's dive path |
| `split-on-hit.ts`  | `splitOnHit`   | `into`, `count`, `spacing` on the alien                              |
| `shield.ts`        | `shield`       | `hits`, `rechargeFrames` on the alien                                |
| `teleport.ts`      | `teleport`     | `everyFrames`, `margin` on the alien; or a `trigger` on its dive     |
| `spawn-minions.ts` | `spawnMinions` | `alien`, `count`, `everyFrames`, `maxAlive`, `spacing`; or a trigger |

Two of the seven ids the schema lists are **reserved and implemented nowhere**:
`transform` and `mirrorPlayer`. Their entries validate with any parameters and
nothing reads them, which `tests/unit/forge-guard.test.ts` pins as an identity —
so `/forge` refuses a prompt that needs one. (`transform` here is an alien
ability; the arcade's transform attack is `rules.transform`, run by
`src/sim/dive.ts`, and is not it.)
<!-- check:count schema.abilityIds 7 schema.reservedAbilityIds 2 -->

Three things to know before adding or editing one:

- **The registry is typed over the implemented ids.** `ABILITY_REGISTRY` is a
  mapped type over the schema's ids minus `RESERVED_ABILITY_TYPES`, so an id
  added to the schema without a module, or a module for an id that is still
  reserved, is a build error. Moving an id out of the reserved list is how an
  ability is born: a module here, a strict parameter schema there, and the
  loader's reference checks in `src/content/loader.ts`.
- **`captureBeam` is a channel; the rest belong to an enemy.** The capture beam is
  one per run, switched on by `rules.capture` and stepped by `src/sim/world.ts`
  directly, because a captured fighter outlives the stage it was taken in — so its
  registry entry has no hooks, and an alien that declares it is refused. The other
  four are hooks the world calls for each enemy that carries them: after the
  fleet has flown (`step`), when a shot connects (`absorbShot`), and when the enemy
  is destroyed (`destroyed`).
- **Nothing here may change a run that uses no ability.** Per-enemy state is made
  the first time an ability acts, random numbers are drawn from the world's seeded
  generator only when one acts, and `abilityFingerprint` reports nothing at all
  while the state is empty — which is why every golden in `tests/sim/golden/`
  still reproduces. An ability that puts an attacker on the field asks
  `allowsAttacks` itself, because the registry is stepped outside the attack
  director whose gate would otherwise cover it.

`tests/unit/abilities.test.ts` pins each module frame by frame, and
`tests/sim/ability-pack.test.ts` is the roadmap's exit check made concrete: a pack
of nothing but documents, layered over Classic, switches on all four new
abilities and an autoplay persona plays it to the end of the stage.
