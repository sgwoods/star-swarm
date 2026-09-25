# `src/render/`

`canvas.ts` (the 224x288 integer-scaled display), `sprites.ts` (data→bitmap
cache), `starfield.ts`, `text.ts`, `crt.ts`.

This layer is a **subscriber**: it reads simulation state and the events
`src/sim/` emits, and draws. It never writes back, and `src/sim/` never imports
it — that rule is what makes the headless tests and replays possible.

Milestone 1 landed `starfield.ts` (stage-dependent scroll speed) and `scene.ts`,
a placeholder that draws the playfield as flat shapes until the sprite-pipeline
task replaces it. See `docs/DESIGN.md` sections 5 and 9.
