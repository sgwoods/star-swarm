# `src/ui/`

`attract.ts`, `menus.ts`, `hud.ts`, `results.ts`, `highscores.ts`, and `lab/`
(the `/lab` preview harness).

`hud.ts` landed with Milestone 1: score, reserve fighters and the stage badges.
Like `src/render/`, this layer is a **subscriber** — it reads simulation state
and events and draws; it never writes back, and `src/sim/` never imports it.

The rest arrives with later milestones. See `docs/DESIGN.md` sections 8 and 9.
