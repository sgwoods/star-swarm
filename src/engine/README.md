# `src/engine/`

The game-agnostic machinery underneath the simulation. It knows nothing about
Star Swarm, or about any game: no aliens, no formation, no rules, no pack. What
is here is the five things determinism needs (`docs/DESIGN.md` pillar 4 and
section 9).

| File        | What it is                                                                       |
| ----------- | -------------------------------------------------------------------------------- |
| `loop.ts`   | The fixed 60 Hz step, and the accumulator that drives it from a frame callback   |
| `rng.ts`    | The seeded generator. `Math.random` is banned in `src/sim/` and here alike       |
| `trig.ts`   | Sine, cosine and arctangent from fixed-point tables, the same on every machine   |
| `input.ts`  | Abstract input: one `InputFrame` per step, and the keyboard device that fills it |
| `replay.ts` | Recording an input log, and playing one back as an input source                  |

Four things worth knowing before editing any of them.

**`1/60` is not representable in binary floating point.** `loop.ts` accumulates
in whole _steps_ and carries a tolerance for exactly that reason. Naive
millisecond subtraction silently loses a step per burst, which is a drift a test
will not see and a player will.

**The RNG stream is an on-disk contract.** The golden replays in
`tests/sim/golden/` compare final simulation states, so changing the generator
invalidates every recorded one. `tests/unit/rng.test.ts` pins a reference
sequence so that change has to be deliberate.

**So are the trigonometry tables, and for the same reason.** `Math.sin`,
`Math.cos` and `Math.atan2` are engine-defined and land a unit in the last place
apart on arm64 and x86-64, so the simulation takes its angles from `trig.ts`
instead, and lint bans the engine-defined functions in `src/sim/` and here. Every
golden is recorded through the tables, and `tests/unit/trig.test.ts` locks their
contents.

**An input source is the seam the attract script uses.** `createReplaySource`
turns a recorded log into the same thing the keyboard produces, so the demo of a
game with no autoplay personas is the real simulation replaying a real log rather
than an animation kept in step with the game (`src/ui/attract.ts`). Anything that produces `InputFrame`s can drive a
world; nothing here may read one.

`loop.ts` is the one file here that reaches for a host API — its default
`requestFrame` is `requestAnimationFrame` — and it is an injectable option for
exactly that reason, so the tests step the loop by hand. What `src/sim/` imports
from this directory is only `input.ts`, `rng.ts` and `trig.ts`: a step arrives as
an argument, never read from a clock.
