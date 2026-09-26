# Star Swarm

A 1981-arcade-style formation shooter that plays like the classic, plus a content
system that lets you prompt new aliens, stages and movement paths into existence.

How it all fits together, and how to run it:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Design and build plan:
[`docs/DESIGN.md`](docs/DESIGN.md).

## Status

**Milestone 2 — the classic game, complete.** Five scripted entry waves fly in
and take formation, the formation sways into centre and then breathes, enemies
dive and bomb in the arcade's difficulty ramp, and the fighter shoots back,
through the Classic normal stages up to 8 and eight challenge stages. A captor's
tractor beam can take the fighter, and shooting the captor while both are
attacking rescues it to fly beside you as a dual. Around all of that is a real
front end — attract mode running the game as a replay, the between-stage
challenge card, game over, the hit-ratio results card and a high-score table.

What is left is Milestone 3 and beyond: `docs/ARCHITECTURE.md` §5 has the list.

![Entry waves, formation and the fighter shooting](docs/media/arch-gameplay.gif)

## Getting started

```sh
npm install
npm run dev            # http://localhost:5173
```

Press **Enter** to start, **←/→** to move, **Space** to fire. The game boots into
attract mode, so press start before the arrows do anything.

Node **22.13 or newer on the 22 LTS line, or 24 and newer** — the floor is
Vitest's and ESLint's, not the game's. CI runs Node 24, and the suite below is
verified on Node 25.9.0. (Vitest 5 declares no support for Node 25, so `npm
install` there prints one `EBADENGINE` warning from Vitest itself; everything
installs and passes regardless.)

| Command                  | What it does                                |
| ------------------------ | ------------------------------------------- |
| `npm run dev`            | Vite dev server                             |
| `npm run build`          | Typecheck, then build to `dist/`            |
| `npm run lint`           | ESLint and Prettier                         |
| `npm test`               | Vitest: unit and headless simulation suites |
| `npm run test:e2e`       | Playwright smoke test                       |
| `npm run validate-packs` | Validate everything under `packs/`          |

CI runs all of these on every push and pull request.

## Ground rules

Game mechanics are fair to recreate; the original's art, audio, name and logo are
not. This project uses an original title, original sprite art and original
synthesized audio, and never imports ROM data, ripped sprites, sampled audio, or
the original logo or font. See section 2 of the design doc.
