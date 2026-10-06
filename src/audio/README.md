# `src/audio/`

`synth.ts` (parametric voices over Web Audio), `sfx.ts` (simulation events →
sounds) and `music.ts` (simulation events → jingles, one at a time). Subscribes
to simulation events; the sim never calls into here.

Four things worth knowing before editing:

- **Sounds are data**, validated by `soundSchema` in `src/content/schema.ts` and
  authored under `packs/<pack>/sounds/`. `synth.ts` interprets that data and
  knows nothing about any particular effect.
- **`buildSoundPlan` is pure and `playPlan` is not.** The first turns a `Sound`
  into the voices and scheduled parameters to build; the second realises them
  against a `SynthContext`, a structural subset of Web Audio that a test double
  satisfies. That split is why the graph is testable on the Node test
  environment.
- **A jingle is a sound, and music is a channel.** A jingle is an ordinary
  `Sound` whose `sequence` is the melody, with `rest` steps where it breathes and
  `parts` for the lines sounding beside it. What makes it music is where it
  plays: the manifest's `music` cues, which `music.ts` reads in order — the
  earliest cue anything in a step matches wins, and starting a jingle cuts the
  one before it through `Synth.start`'s `Playback`. Effects stack; two tunes at
  once is noise.
- **Music is in wall time and hears a player's game only.** A jingle's length is
  seconds on the audio clock, never simulation steps, and nothing it does reaches
  the simulation. `src/main.ts` keeps it off the attract demo and cuts it on a
  pause. It plays through the same master gain as every effect, so the volume and
  mute settings reach it with no control of its own.

No audio context exists until `Synth.unlock()` runs, which belongs in a user
gesture (`unlockOnFirstGesture`). Everything is silent and harmless without one.

See `docs/DESIGN.md` sections 3, 5 and 9.
