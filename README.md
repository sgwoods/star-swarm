# Star Swarm

A 1981-arcade-style formation shooter that plays like the classic, plus a content
system that lets you prompt new aliens, stages and movement paths into existence.

**Play it in a browser: <https://sgwoods.github.io/star-swarm/>** — the build
published from `main`. Beside it is **the shelf**,
<https://sgwoods.github.io/star-swarm/shelf.html>: variations of the games that
other players made, each playable from there. Made one of your own?
[`CONTRIBUTING.md`](CONTRIBUTING.md) is how to put it on the shelf, step by step.

![Entry waves, formation and the fighter shooting](docs/media/arch-gameplay.gif)

## Getting started

```sh
npm install
npm run dev            # star-swarm running at http://127.0.0.1:8795/
```

Press **Enter** to start, **←/→** to move, **Space** to fire. **P** pauses, and
**X** leaves the game after asking. The game boots into the game list, so it
takes two presses of **Enter** to play: one picks a game and opens its attract
screen, and the second starts it. The arrows do not fly the fighter until then.

Every menu is worked the same way: **↑/↓** move between rows, **←/→** change the
row you are on, **Enter** takes it and **Esc** goes back — on every screen. From
a game's attract screen **Esc** climbs to the game list, which is the top, so
**Esc** there does nothing; the list's last row, **SETTINGS**, is where the
difficulty, autoplay, sound, controls and CRT filter live. A game that ends leaves
you on that game's attract screen, not on the list. A build with one game has no
list, so there **Esc** from attract opens the settings directly. **↑** or **↓**
on a game's attract screen opens that game's own options — the ships it starts
with, and its sound — where a change to a shipped game is kept as a game of your
own beside it, never as a change to the game itself.

The top-right corner of the screen says which build you are looking at — the
commit, whether the tree was modified, and the date — and a page that is open
when a newer build is published blinks **NEW BUILD** at you rather than
interrupting. Editing game code or pack data needs no refresh at all; the dev
server reloads the page itself. The two cases where that is not enough, and what
a hosted deployment has to serve, are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#refresh-or-restart).

Node **22.13 or newer on the 22 LTS line, or 24 and newer** — `"node": "^22.13.0 || >=24.0.0"`,
and the floor is Vitest's and ESLint's rather than the game's. CI runs Node 24.

| Command                  | What it does                                      |
| ------------------------ | ------------------------------------------------- |
| `npm run dev`            | Vite dev server — see [Local ports](#local-ports) |
| `npm run build`          | Typecheck, then build to `dist/`                  |
| `npm run lint`           | ESLint and Prettier                               |
| `npm test`               | Vitest: unit and headless simulation suites       |
| `npm run test:e2e`       | Playwright: the game in a real browser            |
| `npm run validate-packs` | Validate `packs/`, `variants/` and `shelf/`       |

`npm run test:e2e` needs a browser that `npm install` does not fetch. On a new
machine, run `npx playwright install chromium` once first, or every test fails
to launch.

CI runs all of these on every push and pull request, and a push to `main` that
passes them publishes the built game to GitHub Pages — so the hosted build is
always one that went green. How that works, and what the page does when a newer
build goes out under it, is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#refresh-or-restart).

## Local ports

Several of the captain's projects run local web servers on the same Macs, and
they share them by one agreement: each project owns a block of ten ports and a
default inside it.

| Ports     | Project           | Default |
| --------- | ----------------- | ------- |
| 8760-8769 | virtual-bookshelf | 8765    |
| 8770-8779 | news pipeline     | 8775    |
| 8780-8789 | aurora            | 8785    |
| 8790-8799 | **Star Swarm**    | 8795    |

<!-- check:count localhost.first 8790 localhost.last 8799 localhost.default 8795 -->

This project's name in the agreement is **`star-swarm`**, and it is the same
name everywhere: the first field of its line in `~/.config/local-ports.tsv`, the
`project` its servers answer `/whoami` with, and the directory its record lives
in, `~/.config/star-swarm/`.

`npm run dev` keeps these rules:

- **Its own block, on `127.0.0.1` only.** It takes 8795 when it is free, and
  otherwise the next free port of 8790-8799 — never a port outside the block. If
  every port of the block is busy it starts nothing, and names the process
  holding each one.
- **One copy at a time.** It reads `~/.config/star-swarm/server.json` (`pid`,
  `port`, `started`) first. If that process is still running and its `/whoami`
  names `star-swarm` and that same pid, it is asked to stop, killed if it has not
  gone 3 seconds later, and its port is taken once it is free. The new copy then
  records its own pid, port and start time there, and removes the file when it
  exits cleanly — Ctrl-C, `q`, or being asked to stop. A process that answers
  `/whoami` as another project, or does not answer it at all, is never stopped:
  that is what makes a stale record whose pid now belongs to something else
  harmless.
- **It says which project it is.** `GET /whoami` answers
  `{"project":"star-swarm","port":8795,"pid":…,"version":"<short commit>"}`.
  While developing, every page's tab reads `Star Swarm - 8795`, wears a flying
  saucer favicon, and carries a small label in its top-left corner with the name,
  port and commit — the game, the shelf, `/lab` and the capture and record pages
  alike. **The published game carries none of it**: its title is `Star Swarm` and
  nothing else, and a test builds the bundle to prove so.
- **It prints one line at startup:** `star-swarm running at http://127.0.0.1:8795/`.
- **It keeps the shared registry.** It makes sure `~/.config/local-ports.tsv`
  has its line — name, block, default and repository, tab-separated — creating
  the file with a header if it is missing and never editing another project's
  line, and warns at startup if another line's block overlaps its own.

<!-- check:count localhost.graceSeconds 3 -->

**`npm run dev -- --status`** reads the registry, asks every port of every
project's block who it is, and prints which projects are running, on which port
and at which version — and anything in somebody's block that does not answer as
that somebody. It writes nothing and stops nothing, so any project's `--status`
gives the whole picture.

**To restart the dev server, run `npm run dev` again** — from any terminal. The
new copy stops the old one and takes its port.

The other servers this project runs — `npm run preview`, `npm run record`,
`npm run capture` and Playwright's — bind `127.0.0.1` inside the same block and
answer `/whoami` too, but each takes a free port and never stops anything: a test
run must not be able to take down somebody's dev server. How it is built is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#local-ports-one-block-one-copy).

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

## Licence

MIT — see [`LICENSE`](LICENSE).

## Ground rules

Game mechanics are fair to recreate; the original's art, audio, name and logo are
not. This project uses an original title, original sprite art and original
synthesized audio, and never imports ROM data, ripped sprites, sampled audio, or
the original logo or font. See section 2 of
[`docs/DESIGN.md`](docs/DESIGN.md#2-ground-rules-read-before-building).
