# `src/sim/abilities/`

The ability registry of `docs/DESIGN.md` section 7.5: one file per engine
ability, and `registry.ts`, which is the one place the world asks them anything.
An ability is engine behaviour that a pack **switches on and tunes**, never one a
pack defines. A pack names an ability by id in an alien's `abilities`, or in a
path's `trigger` segment to say where in a flight it fires, and every parameter
it may state is validated by that ability's own schema in
`src/content/schema.ts`.
<!-- check:count sim.abilities.modules 8 sim.abilities.implemented 7 -->

| Module             | Ability        | What a pack writes                                                   |
| ------------------ | -------------- | -------------------------------------------------------------------- |
| `capture-beam.ts`  | `captureBeam`  | `capture` in `rules.json`, and a `trigger` on the captor's dive path |
| `split-on-hit.ts`  | `splitOnHit`   | `into`, `count`, `spacing` on the alien                              |
| `transform.ts`     | `transform`    | `into`, `afterFrames` on the alien; or a `trigger` on its dive       |
| `shield.ts`        | `shield`       | `hits`, `rechargeFrames` on the alien                                |
| `teleport.ts`      | `teleport`     | `everyFrames`, `margin` on the alien; or a `trigger` on its dive     |
| `spawn-minions.ts` | `spawnMinions` | `alien`, `count`, `everyFrames`, `maxAlive`, `spacing`; or a trigger |
| `mirror-player.ts` | `mirrorPlayer` | `mode`, `delayFrames`, `strength` on the alien                       |

Every id the schema lists has a module, so none is **reserved** today:
`RESERVED_ABILITY_TYPES` is empty, and `tests/unit/forge-guard.test.ts` pins it
empty. `transform` and `mirrorPlayer` were the last two to leave it, once what
each means had been decided. (`transform` here is an alien ability; the arcade's
transform attack is `rules.transform`, run by `src/sim/dive.ts`, and is not it.)
<!-- check:count schema.abilityIds 7 schema.reservedAbilityIds 0 -->

**A `transform` is a change of type, and what carries over is its definition.**
One diving enemy becomes one `into` alien — `afterFrames` into a dive flown as the
old alien, at a `trigger` naming it, or both — and is the same enemy afterwards:

| Carries over                                    | Is the new alien's, from the frame it changes               |
| ----------------------------------------------- | ----------------------------------------------------------- |
| its position and heading                        | sprite and hit sprites                                      |
| its flight: the path, the speed, how far along  | `hp`, whole: hits taken against the old alien are forgotten |
| the events still ahead on that path             | score base, moving multiplier and its role's escort record  |
| its id, its slot and its wave                   | hit box, dive paths, and whether it returns from a dive     |
| the bomb clock, and the run's bombs up to a cap | how it fires, and which abilities it carries                |

What the old alien's abilities held is lost with it — shield charges, timers, a
spawner's count of its minions, a mirror's memory — and the registry is what drops
it, because the registry owns that state. The score follows the new alien through
the one scoring rule, base doubled while it moves, which is the rule that makes the
arcade transform's own enemy worth 160 on the dive (`docs/DESIGN.md` section 4);
the change itself is not a kill, scores nothing and raises `enemy-morphed`, and no
group bonus attaches to one enemy. The capture channel's captor keeps its type
while its attempt is in progress.

**A `mirrorPlayer` diver moves because the fighter moved.** Each frame it closes
`strength` of the sideways gap to the fighter's column (`track`) or to that column
mirrored about the playfield's centre line (`opposite`), as the fighter stood
`delayFrames` frames ago. The pull displaces its own flight, so its row and its
speed down the screen stay the path's, and its dive ends where the path ends it,
moved sideways. It acts only while
diving, never in the formation, and copies nothing while no fighter is on the
field. Delay and strength are the pack's: neither has a default.

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
  six are hooks the world calls for each enemy that carries them: after the
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
of nothing but documents, layered over Classic, switches on `shield`,
`splitOnHit`, `teleport` and `spawnMinions`, and an autoplay persona plays it to
the end of the stage. `tests/sim/morph-mirror-pack.test.ts` does the same for
`transform` and `mirrorPlayer`, and checks in the played game that a changed
enemy scores as what it became and that a mirror's column is the fighter's,
reflected.
