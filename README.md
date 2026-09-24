# Star Swarm

A 1981-arcade-style formation shooter that plays like the classic, plus a content
system that lets you prompt new aliens, stages and movement paths into existence.

Design and build plan: [`docs/DESIGN.md`](docs/DESIGN.md).

## Status

Milestone 0 — foundations. The engine skeleton is in place: a 224×288
integer-scaled canvas, a fixed 60 Hz simulation loop, a seeded RNG, abstract
input and input replay. No gameplay yet; that is Milestone 1.

## Getting started

```sh
npm install
npm run dev            # http://localhost:5173
```

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
