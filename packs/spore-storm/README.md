# `packs/spore-storm/`

**The game that uses four of the new abilities.** Every alien in its formation
carries exactly one of `splitOnHit`, `shield`, `teleport` and `spawnMinions`, and
each one is drawn, heard and animated, so that somebody watching can say what each
alien does without being told. `variants/spore-storm.json` names it, and the
start-up selector offers it as `SPORE STORM`. It was written before `transform` and
`mirrorPlayer` were implemented, and uses neither.

![Spore Storm in live play: a cyst splitting, a husk's shield lighting up, a flicker teleporting and a brood spawning, all in the first twenty seconds](../../docs/media/m3-spore-storm.gif)

The abilities are engine behaviour (`src/sim/abilities/`); nothing here is code.
The pack switches them on and tunes them in its alien documents, says _when_ two of
them fire with `trigger` segments in its dive paths, and binds the events they
raise to sounds and effects in `pack.json`, exactly as every other sound and effect
is bound.

## What it is

An **overlay on Classic**, written the way `packs/deep-sea/` is: self-contained,
because `loadPack` resolves references within one pack, so its stages name only
its own aliens, paths and formation.

| It ships     | Count |
| ------------ | ----- |
| aliens       | 6     |
| flight paths | 9     |
| stages       | 3     |
| sprites      | 12    |
| sounds       | 5     |
| formations   | 1     |

<!-- check:count sporeStorm.aliens 6 sporeStorm.paths 9 sporeStorm.stages 3 sporeStorm.sprites 12 sporeStorm.sounds 5 -->

Everything else it inherits: the whole of Classic's `rules.json`, the three enemy
roles, the stage badges, the jingles (it states no `music`, so the cue list is
Classic's), the palette (every colour its sprites use is already one of Classic's,
so it states none) and the challenge half of the stage sequence. It
states `stageSequence.normal` and leaves the challenge half empty, so stage 3 of a
Spore Storm run is Classic's `challenge-1`.
<!-- check:count sporeStorm.palette 0 sporeStorm.sequenceNormal 3 sporeStorm.sequenceChallenge 0 -->

## One alien, one trick

Four aliens fill the formation, one per ability, and two more are what an ability
puts on the field. Four aliens carry an ability and two carry none.
<!-- check:count sporeStorm.abilityAliens 4 -->

| Alien     | Role   | Ability                   | What you see                                                                                                                             | Sound                        |
| --------- | ------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `cyst`    | wing   | `splitOnHit` into two     | A cell with two lobes and a furrow down the middle. Shot, the furrow tears open (`fx-split`) and each lobe flies on alone as a `cystlet` | `split-pop`                  |
| `husk`    | warden | `shield`                  | A violet core inside a dotted cyan field. A shot the field takes lights it as a ring (`fx-shield`); left alone it closes up again        | `shield-ping`, `shield-mend` |
| `flicker` | drone  | `teleport`, by trigger    | A four-pointed cell, half there every other frame. Mid-dive it stops, vanishes and folds back in elsewhere under a ring (`fx-blink`)     | `blink-zip`                  |
| `brood`   | warden | `spawnMinions` of `spore` | A heavy cell with yellow buds underneath. A bud bursts free (`fx-spawn`) and flies at the fighter as a `spore`. Two hits, grey after one | `spore-plop`                 |
| `cystlet` | wing   | none                      | One lobe of a cyst: the same membrane and nucleus, half the cell. Dives, and leaves                                                      | —                            |
| `spore`   | drone  | none                      | One of the brood's buds, loose. Dives straight at the fighter, and leaves                                                                | —                            |

Each of the five events the four abilities raise — `enemy-split`, `shield-hit`,
`shield-restored`, `enemy-teleported` and `minions-spawned` — is bound to one sound
and one effect, and Classic binds none of them, so the arcade game is unchanged by
any of this.
<!-- check:count sporeStorm.boundSounds 5 sporeStorm.boundEffects 5 -->

Five decisions in it are about readability rather than difficulty:

- **One ability per alien, and none on the offspring.** A cystlet that split again,
  or a spore that spawned, would be a second behaviour arriving unannounced.
- **The husk's shield takes two hits and regrows after fifteen seconds unhit.**
  The ring on each absorbed shot is what says "shield", and the field closing up
  again (`fx-shield-up`, with the rising `shield-mend`) is what says it was one. A
  recharge risks the stall `docs/content-guide.md` section 7.6 records, so it is
  long: the validator's strong persona stalls on none of its seeds.
  <!-- check:count sporeStorm.shieldHits 2 sporeStorm.shieldRechargeFrames 900 -->
- **The flicker blinks where its path says, not on a clock.** Its dive,
  `dive-blink`, hovers for a moment, blinks, holds where it landed, then lunges —
  and blinks once more on the way down. A timed blink lands anywhere in a dive and
  reads as a glitch; a scripted pause before and after reads as the alien doing it.
- **The brood spawns every three seconds, one spore alive at a time, and on its
  dive.** Spores count against the difficulty row's diver limit, so a faster
  spawner starves the formation's dives — and with them the flicker's blinks.
  <!-- check:count sporeStorm.spawnEveryFrames 180 -->
- **Every effect is centred on the alien and over within a third of a second**,
  because an effect is drawn where the event happened and the alien keeps flying.

## The formation is twenty-four slots and ten columns

Two broods on top, four husks, eight cysts, then ten flickers.
<!-- check:count sporeStorm.formationSlots 24 sporeStorm.formationColumns 10 sporeStorm.formationRows 4 sporeStorm.formationCaptiveSlots 0 -->

The rules layer couples it to numbers it cannot change, and it composes within
them (`docs/content-guide.md` section 7):

- **Ten columns, for the breathe table.** Classic's has ten column displacements
  and applies them by position. <!-- check:count rules.breatheColumns 10 -->
- **Classic's three role ids, for the launch rates.** A role the difficulty rows do
  not name never attacks. <!-- check:count rules.launchRoles 3 -->
- **A smaller fleet than the rules were written for.** Twenty-four slots under a
  continuous-bombing threshold set for forty — though each cyst puts two more
  enemies on the field, so the stage holds forty kills before its spores.
- **No captive slots, so no tractor beam, on purpose.** A formation that declares
  none makes every captor ineligible (section 7.4); this game is about the four
  abilities, and a shielded captor would turn a rescue into a different puzzle.

The pack manager reports both of the last two when this game's packs are mixed, and
`tests/sim/spore-storm.test.ts` holds the list to exactly those two.

**One coupling the content guide does not list.** Classic's rules switch on the
arcade's transform attack — `rules.transform`, which turns one enemy into a group,
not the `transform` ability — and its `types` name Classic's own aliens — so from
stage 4, once per stage, a flicker or a cyst pulses and becomes three of Classic's
scourges. Measured: 62 transforms in twenty-four astronaut games, and in eight of
them every one became scourges and the first came on stage 4. Deep Sea does the
same. A pack under these rules
cannot change that; a `rules.json` of its own could, and would make this a sibling
game rather than an overlay.

**Why the challenge stages are Classic's.** A challenge stage allows no attack, so
on one the engine switches off three of the four: a cyst would not split, a brood
would not spawn and a flicker never dives to blink. A challenge stage of this
game's own aliens would teach a watcher that a cyst sometimes does not split.

## What playing it measured

Headless, through the real simulation, flown by the variant's own personas at its
default rank. **On stage 1 alone, under `normal`** — the persona the attract demo
flies first — over twenty-four seeds:

| Ability        | Seen on stage 1 | Median first step |
| -------------- | --------------- | ----------------- |
| `splitOnHit`   | 24 of 24        | 269               |
| `shield`       | 24 of 24        | 577               |
| `teleport`     | 24 of 24        | 855               |
| `spawnMinions` | 24 of 24        | 947               |

So all four are on screen within the first sixteen seconds of every stage 1. A
shield growing back is the one that depends on the pilot, and happened on stage 1
of 8 of 24. `tests/sim/spore-storm.test.ts` holds the four to every seed of eight.

Whole games, twenty-four seeds, a three-minute limit:

| Persona     | Mean score | Median | Cleared stage 1 | Furthest stage |
| ----------- | ---------- | ------ | --------------- | -------------- |
| `normal`    | 3,937      | 3,320  | 5 of 24         | 4              |
| `astronaut` | 31,597     | 31,650 | 24 of 24        | 7              |

The same harness gives Classic 4,017 and 32,559 and Deep Sea 2,983 and 36,249, so
for `normal` this game sits between the two, and for `astronaut` a little under
both.

## What getting it right took

Three things, two of which only playing it found:

1. **`dive-lumber` left the side of the screen.** Its opening arc turned outward
   from the husk's outer slots and took the husk to x −6. The validator's `dive`
   check caught it; the arc now turns inward.
2. **The brood hardly spawned.** It spawned about once a stage, because the
   strongest persona shot both broods before their first timer ran out after the
   formation settled. Classic's own two-hit idiom fixed it — `hp` 2 and a grey
   `brood-hit` sprite — with a shorter cadence: spawns per twenty-four astronaut
   games went from 149 to 345.
3. **A wave in `colony-2` flew a cyst and a flicker as one sprite.** Each pair of a
   wave launches on one frame, and that pair agreed on `mirror`. The validator does
   not look at lanes; `tests/sim/spore-storm.test.ts` now does.
