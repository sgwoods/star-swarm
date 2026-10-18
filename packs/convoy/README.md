# `packs/convoy/` — the second lineage

Convoy is a second game in the arcade lineage rather than a variant of the first:
the older, simpler family, in which a fixed convoy of aliens drifts from side to
side and peels off in curving attack runs, and the fighter has one shot in flight
at a time. `variants/convoy.json` names this pack and nothing else, so it plays on
the same console, with the same three controls — left, right and fire — and the
same start, pause and menu keys as every other game here.

Every other shipped game is an overlay on Classic and runs Classic's
`rules.json`. This one layers over nothing. It ships its own roles, its own
formation, its own art and sound and its own [`rules.json`](rules.json), which
makes it the test of the claim `docs/ARCHITECTURE.md` §4.4 makes: a sibling game
is a pack, a rules document and a variant, and nothing under `src/` changes.
Nothing did. `tests/sim/convoy.test.ts` holds the engine to not naming it.

## What is here

- Four aliens, one per role, scoring 30, 40, 50 and 60 in the convoy and twice
  that diving — except the flagship, whose own document raises its multiplier so a
  lone diving flagship is worth 150.
  <!-- check:count convoy.aliens 4 convoy.roles 4 -->
- One forty-six-slot formation: two flagships, six escorts, eight raiders and
  three rows of ten scouts, on ten column coordinates and six row coordinates.
  <!-- check:count convoy.formationSlots 46 convoy.formationColumns 10 convoy.formationRows 6 -->
- One stage document, played at every stage number. The convoy is the same every
  time; what changes is the difficulty row, which lets each convoy launch more
  often and put more divers in the air than the one before, and repeats its last
  row from the sixth stage on.
  <!-- check:count convoy.stages 1 convoy.difficultyRows 6 -->
- Fourteen paths: one entry per column, three dives and the return.
  <!-- check:count convoy.paths 14 -->
- Nine sprites and nine sounds, all original: the four aliens, the fighter, two
  explosions and the two flags the stage count is drawn in.
  <!-- check:count convoy.sprites 9 convoy.sounds 9 -->

## How each behaviour of the lineage is said

None of it is code. Each row is a field a document already had.

| Behaviour                                           | Where it is said                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| One shot in flight at a time                        | `player.maxShots` in `rules.json` <!-- check:count convoy.maxShots 1 -->                                          |
| Divers sweep down in curves and leave by the bottom | `paths/dive-*.json`: two arcs, a run at the fighter, then `exitBottom`                                            |
| Divers come back in at the top                      | `enemies.dive.returnPath` and `reentryY` in `rules.json`, and `dive.returns` on each alien                        |
| No tractor beam, no dual fighter                    | Not declared: `capture`, `rescue` and `dualFighter` default to off, and the formation has no captive slots        |
| No bonus or challenge stages                        | `challengeStages.enabled` is false, and the manifest's challenge sequence is empty                                |
| One extra ship, once                                | `extraLives.award` states a first threshold and nothing after it                                                  |
| Scouts dive most and flagships least                | The difficulty rows' `launchRates`, keyed by this pack's own four role ids                                        |
| The convoy drifts as one block                      | `formation.breathe` with every column moving the same distance and no row moving, centred by the grid's `originX` |

The last row is worth a sentence. The engine's `sway` is the motion of a
formation still being filled, and it ends once the formation is centred; its
`breathe` runs for the rest of the stage. A breathe in which every column is
displaced by the same 48 px and every row by none is a whole-block slide out and
back, so that is how this convoy drifts. <!-- check:count convoy.driftPixels 48 -->

## Where it departs from the lineage

Three places, each recorded as provisional in `rules.json`'s `provenance` or here:

- **The convoy drops in.** An entry is a path, and a path needs somewhere to start,
  so at the start of each stage the convoy drops straight down into place, column
  by column, in about two seconds, rather than being on the screen already.
- **The drift has a fixed width.** In the lineage the convoy turns back when its
  outermost survivor reaches the edge of the screen, so a thinned convoy travels
  further. Which columns are still alive is not something a rules number can
  express, so this drift is the same 48 px whatever is left.
- **A flagship dives alone.** It is the gap below, which the platform can now
  close and this pack does not yet.

## What this pack does not declare yet: a sortie group

In the lineage, a flagship peels off with up to two escorts from beside it, and
the three fly the attack together. What the flagship is worth depends on that
company: more when escorts launched with it, and most when it had two and neither
is still in flight at the moment it is shot.

When this pack shipped, the platform had no way to say any of that. What it lacked
was a **sortie group** — a leader and its members, formed at launch and keeping one
identity for the whole flight. It has one now: an alien's `dive.escorts` names who
flies with it, and `src/sim/groups.ts` keeps the group
([`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#44-where-a-second-game-plugs-in)
§4.4). Scoring in this family reads a group in three ways and only three, and
`scoring.escortBonus` in a `rules.json` can state each:

1. how many members launched with the leader, fixed at launch;
2. which members are still in flight when the leader dies;
3. whether the whole group was destroyed with none escaping.

This is not specific to this game. It is general to both lineages. Classic
declares both halves — an escort table, a diving boss worth 400, 800 or 1,600 for
no, one or two escorts, and a `warden` that names the wings it takes — so in Star
Swarm a boss already dives with its escorts and pays for them.

Nothing is wrong here. Declaring escorts changes how this game plays, so it is a
change of its own and the captain's decision, as it was for Classic, and
`docs/ARCHITECTURE.md` §5 records it as not here yet.

**Everything else in this lineage is expressible, and the game is otherwise
complete.** A flagship here dives like any other alien, on its own curving run,
and is worth 60 in the convoy and 150 diving alone, which is the lineage's own value
for a flagship with no escort. It is never worth anything a sortie group would pay,
and `tests/sim/convoy.test.ts` holds it to that, so the day this pack declares
escorts is the day that test says so.

## What playing it measured

Flown headlessly by the variant's two personas over sixteen seeds each, with the
standard rank and three fighters, on the build this pack landed with:

- **`normal`** cleared stage 1 on 6 of 16 seeds; Classic's `normal`, flown by the
  same harness, clears its stage 1 on 7 of 16. The first version of these rules let
  six bullets into the air and cleared it on 1 of 16, because a single shot keeps
  the fighter under fire for longer: the bullet cap is 4 for that reason.
- **`expert`** cleared 54 stages across the sixteen games, reaching stage 9 on two
  of them and stage 5 or later on five, each stage taking 2,253 to 7,344 steps; the
  best game scored 20,510.
- Over both personas, divers came back in at the top more than 2,500 times; a
  flagship paid 60 or 150 and nothing else; and no step ever had a second shot in
  flight.

`npm run validate-packs` flies the stage under its own protocol and passes it. The
first dives swung their outer columns off the left of the screen, and the gate
said so from the first run; they now turn inwards before they run at the fighter.
