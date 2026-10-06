# Classic sounds

One file per sound, each validated by `soundSchema` in `src/content/schema.ts`.
`src/audio/synth.ts` interprets them; nothing about any of these effects is in
code, and a prompt can generate more of them (`docs/DESIGN.md` section 8).

Which event plays which sound is `sounds` in `../pack.json` — event name on the
left, one of these ids on the right. The jingles are bound in `music` instead,
the ordered cue list `src/audio/music.ts` plays one at a time.

All of it is original work in the arcade style of `docs/DESIGN.md` section 2:
chirpy square and noise voices, short sweeps, small jingles built from plain
frequencies. No tune here is transcribed from anything.

**Effects** — bound in `sounds`, and free to overlap one another:

| Sound          | Voice                           | Used for                             |
| -------------- | ------------------------------- | ------------------------------------ |
| `fire`         | square, duty 0.2, up-sweep      | the fighter's rocket                 |
| `enemy-fire`   | triangle, down-sweep            | an enemy bomb                        |
| `enemy-hit`    | noise, band sweeping down       | an enemy destroyed                   |
| `player-death` | square + vibrato, then noise    | the fighter lost                     |
| `dive`         | square + vibrato, down-sweep    | an enemy leaving formation to attack |
| `capture-beam` | triangle + fast vibrato, rising | the tractor beam                     |
| `extra-life`   | square jingle, three notes      | a bonus fighter awarded              |

**Jingles** — bound in `music`, in this priority order, one at a time:

| Sound               | Cue                                | What it is                                                 |
| ------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `game-over`         | `game-over`                        | square, falling — wins over a capture on the last fighter  |
| `challenge-perfect` | `challenge-ended`, `perfect: true` | the results tune in F, with a climbing tag to a high F     |
| `challenge-results` | `challenge-ended`                  | a bouncy tune in F over a walking triangle bass            |
| `game-start`        | `stage-started`, `stage: 1`        | a two-bar fanfare in C, the second bar a step up the first |
| `stage-start`       | `stage-started`                    | one bar in G, a bugle call answered by a cadence           |
| `captured`          | `player-captured`                  | A minor, slower, chromatic sighs, falling away an octave   |
| `rescue`            | `fighter-rescued`                  | D major, an octave whoop up and a fanfare                  |
| `challenge-bonus`   | `challenge-group-cleared`          | triangle, five notes — a group of eight cleared            |

The order matters because one step can raise several of those events: a
challenge stage's last kill can clear a group, end the stage and start the next
one together, and the results tune has to win. `game-start` is told from
`stage-start` by the `stage` field, because a new game's first step raises
`stage-started` for stage 1 and no later step can.

Each jingle written as music has three lines: a square-wave melody, a quieter
narrow-pulse harmony and a triangle bass, with volumes chosen so the three
together sit at the loudness of the effects rather than over them.

Sequenced sounds spell their notes out as frequencies rather than note names,
because the schema takes hertz. The scale used is ordinary equal temperament
from A4 = 440 Hz, which keeps the jingles in tune with each other.

Not every simulation event is bound, and none has to be: `src/sim/events.ts`
raises more events than the two maps name, and an event with no binding is
simply silent — the maps are the pack's choice of what makes a noise, not a table
it has to fill.
