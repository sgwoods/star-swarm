# `src/audio/`

`synth.ts` (parametric voices over Web Audio), `sfx.ts` (simulation events →
sounds). Subscribes to simulation events; the sim never calls into here.

Two things worth knowing before editing:

- **Sounds are data**, validated by `soundSchema` in `src/content/schema.ts` and
  authored under `packs/<pack>/sounds/`. `synth.ts` interprets that data and
  knows nothing about any particular effect.
- **`buildSoundPlan` is pure and `playPlan` is not.** The first turns a `Sound`
  into the voices and scheduled parameters to build; the second realises them
  against a `SynthContext`, a structural subset of Web Audio that a test double
  satisfies. That split is why the graph is testable on the Node test
  environment.

No audio context exists until `Synth.unlock()` runs, which belongs in a user
gesture (`unlockOnFirstGesture`). Everything is silent and harmless without one.

`music.ts`, the jingles of section 5, is not written yet.
<!-- check:absent src/audio/music.ts -->

See `docs/DESIGN.md` sections 3, 5 and 9.
