# Star Swarm

A 1981-arcade-style formation shooter that plays like the classic, plus a content
system that lets you prompt new aliens, stages and movement paths into existence.

![Entry waves, formation and the fighter shooting](docs/media/arch-gameplay.gif)

## Getting started

```sh
npm install
npm run dev            # http://localhost:5173
```

Press **Enter** to start, **←/→** to move, **Space** to fire. The game boots into
attract mode, so press start before the arrows do anything.

Node **22.13 or newer on the 22 LTS line, or 24 and newer** — `"node": "^22.13.0 || >=24.0.0"`,
and the floor is Vitest's and ESLint's rather than the game's. CI runs Node 24.

| Command                  | What it does                                |
| ------------------------ | ------------------------------------------- |
| `npm run dev`            | Vite dev server                             |
| `npm run build`          | Typecheck, then build to `dist/`            |
| `npm run lint`           | ESLint and Prettier                         |
| `npm test`               | Vitest: unit and headless simulation suites |
| `npm run test:e2e`       | Playwright smoke test                       |
| `npm run validate-packs` | Validate everything under `packs/`          |

CI runs all of these on every push and pull request.

## The documentation, in four layers

Documents here are separated by how fast they change and by whether a machine can
check them. **Only the state layer makes claims about what the code currently
is**, and those claims are tested — `tests/unit/docs-accuracy.test.ts` runs under
`npm test`, so a change that falsifies one fails its own pull request. That is
deliberate: this project has a recorded history of documents that were true when
written and false a merge later, including a version of this file that claimed
"no gameplay yet" two milestones after there was gameplay.

| Layer     | Document                                       | Contract                                            |
| --------- | ---------------------------------------------- | --------------------------------------------------- |
| Vision    | [`docs/DESIGN.md`](docs/DESIGN.md)             | Why, the pillars, the ground rules, the arcade spec |
| **State** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | What exists, how to run it — every claim checked    |
| Roadmap   | [`docs/ROADMAP.md`](docs/ROADMAP.md)           | What is next, in order, in future tense             |
| Ideas     | [`docs/IDEAS.md`](docs/IDEAS.md)               | Speculative. Not planned, not promised, not built   |

Beside them: [`docs/reference/arcade-reference.md`](docs/reference/arcade-reference.md)
is the verification record for every arcade number the spec states, and
[`AGENTS.md`](AGENTS.md) holds the rules for working here — the sharp edges, and
what an author has to do to make a claim checkable.

**So: what plays today?** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — it is
the only document that answers that, and the only one under test.

## Ground rules

Game mechanics are fair to recreate; the original's art, audio, name and logo are
not. This project uses an original title, original sprite art and original
synthesized audio, and never imports ROM data, ripped sprites, sampled audio, or
the original logo or font. See section 2 of
[`docs/DESIGN.md`](docs/DESIGN.md#2-ground-rules-read-before-building).
