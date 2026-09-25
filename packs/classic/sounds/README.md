# Classic sounds

One file per sound, each validated by `soundSchema` in `src/content/schema.ts`.
`src/audio/synth.ts` interprets them; nothing about any of these effects is in
code, and a prompt can generate more of them (`docs/DESIGN.md` section 8).

Which event plays which sound is `sounds` in `../pack.json` — event name on the
left, one of these ids on the right.

All of it is original work in the arcade style of `docs/DESIGN.md` section 2:
chirpy square and noise voices, short sweeps, small jingles built from plain
frequencies. No tune here is transcribed from anything.

| Sound               | Voice                           | Used for                               |
| ------------------- | ------------------------------- | -------------------------------------- |
| `fire`              | square, duty 0.2, up-sweep      | the fighter's rocket                   |
| `enemy-fire`        | triangle, down-sweep            | an enemy bomb                          |
| `enemy-hit`         | noise, band sweeping down       | an enemy destroyed                     |
| `player-death`      | square + vibrato, then noise    | the fighter lost                       |
| `dive`              | square + vibrato, down-sweep    | an enemy leaving formation to attack   |
| `capture-beam`      | triangle + fast vibrato, rising | the tractor beam                       |
| `rescue`            | square jingle, rising           | the captured fighter recovered         |
| `extra-life`        | square jingle, three notes      | a bonus fighter awarded                |
| `stage-start`       | square jingle, six notes        | a stage beginning                      |
| `challenge-bonus`   | triangle jingle                 | a challenge stage ending with a bonus  |
| `challenge-perfect` | square jingle, climbing         | a challenge stage with every enemy hit |
| `game-over`         | square jingle, falling          | the last fighter lost                  |

Sequenced sounds spell their notes out as frequencies rather than note names,
because the schema takes hertz. The scale used is ordinary equal temperament
from A4 = 440 Hz, which keeps the jingles in tune with each other.

`dive`, `capture-beam`, `rescue` and the two challenge jingles are for events
Milestone 2 raises; their bindings in `pack.json` name events that do not exist
yet, which is harmless — an unmatched binding never fires.
