# Putting your variation on the shelf

Star Swarm keeps a **shelf**: variations of its games that other players made,
published beside the game and playable from the game list. This page is how you
put one there. You need a browser, a keyboard and a GitHub account — nothing to
install.

**What the shelf takes is a variation, and only a variation.** A variation is one
of the games with choices changed **inside the game**: the ships it starts with,
its sound, which packs it layers and the order of its stages. It leaves the game
as one file of text, and that one file is the whole submission.

**Whole games are not accepted yet.** New art, new aliens, new stages, new
sounds, new rules or any change to the code is a new pack or a new game, not a
variation — and a pull request from outside the project that adds a shelf entry
and changes anything else is refused automatically. If your idea needs any of
that, it cannot go on the shelf yet.

## 1. Make it

1. Open the game: <https://sgwoods.github.io/star-swarm/>. It starts on a list of
   games, **SELECT GAME**. Click the page once so it has the keyboard.
2. Use **↑** and **↓** to choose the game you want to change, and press
   **Enter**. You are on that game's title screen, with a demo playing behind it.
3. Press **↓** (or **↑**). The game's own options open: **STAR SWARM OPTIONS**,
   for example, with two rows, `SHIPS` and `AUDIO`.
4. **↑** and **↓** move between the rows; **←** and **→** change the one you are
   on. The card says `KEEPING MAKES A NEW GAME` — the game you started from is
   never changed — and `LOADS AND BUILDS` in green while what you have chosen
   works.
5. Press **Enter** to keep it. A card opens: **NAME YOUR GAME**, with a name
   already in it, such as `STAR SWARM 2`, and the cursor on `END`.
   - **Esc** rubs out the last letter — and with none left, goes back to the
     options with your choices still on them.
   - **←** and **→** (or **↑** and **↓**) turn the letter under the cursor, and
     **Enter** takes it and moves on.
   - With the cursor on `END`, **Enter** keeps the name.

   A name is up to 14 letters, digits, spaces, `-` and `.`, and may not be the
   name of another game on the list.

6. You are back on the title screen, now of **your** game. Press **Enter** to
   play it, as often as you like, until it is the one you want to share.

Optional, for more than ships and sound: from the title screen press **Esc** for
the game list, go down to its last row, **SETTINGS**, and press **Enter**. With
your game chosen, the `PACKS` and `STAGES` rows change which packs it layers and
the order of its stages: press **→** on either row to open it. Changes there are
kept in your game, the same one.

## 2. Export it

7. From your game's title screen press **Esc**. You are on the game list, with
   your game marked `+` at the bottom. Press **↓** until the last row,
   **SETTINGS**, is lit, and press **Enter**.
8. The **SETTINGS** card's first row, `GAME`, names your game. Press **↓** until
   the row `EXPORT` is lit, then press **→**. (Not Enter: on this card Enter
   closes the settings.)
9. The **EXPORT GAME** card opens, and your game's text appears, selected, in a
   box at the bottom of the screen. Press **Enter**: the card says
   `COPIED TO THE CLIPBOARD`. If it says `SELECT IT AND COPY IT` instead, click in
   the box, select everything (**Ctrl+A**, or **Cmd+A** on a Mac) and copy it
   (**Ctrl+C**, or **Cmd+C**).

The text starts like this — yours will have your own name and numbers:

```json
{
  "id": "classic-2",
  "name": "DUSK PATROL",
  "packs": [
    "classic"
  ],
```

## 3. Give it an id and your name

10. Choose an **id** for it: lower-case letters, digits and hyphens, starting with
    a letter or digit — `dusk-patrol`, say. It is also the file's name, so it has
    to be one no file on the shelf already has. It may not end in a hyphen and a
    number (`classic-2`), because that is the shape the game gives everybody's own
    games.
11. In the text, make two changes and nothing else:
    - change the `"id"` line to your id;
    - add a line under `"name"` saying who you are, as the shelf will credit you:
      up to 21 letters, digits, spaces and plain punctuation.

    You may also add a `"description"` line: one sentence about your variation,
    shown on the shelf page.

```json
{
  "id": "dusk-patrol",
  "name": "DUSK PATROL",
  "author": "ALICE",
  "description": "Five ships and the dusk sound, for a long quiet game",
  "packs": [
    "classic"
  ],
```

Every line ends in a comma except the last one before a `}` or `]` — the new lines
above do, because more lines follow them.

## 4. Submit it

12. Signed in to GitHub, open
    <https://github.com/sgwoods/star-swarm/new/main/shelf>. GitHub says you are
    making a change in a project you cannot write to, and that it will put the
    change in a fork of your own: that is expected. Press its button to fork the
    repository if it asks.
13. In **Name your file…**, type your id and `.json` — `dusk-patrol.json`. Check
    the path above it reads `star-swarm / shelf / dusk-patrol.json`.
14. Paste your edited text into the editor below it.
15. Press **Commit changes…**, then **Propose changes**, and on the page that
    follows, **Create pull request** — twice, the second time to confirm. That is
    the whole submission: one pull request adding one file.

## What happens next

**The pull request is checked before anybody reads it.** The checks start on their
own — the first time you contribute, a maintainer has to press GitHub's
**Approve and run** first — and take a few minutes. They refuse, with the reason,
a variation that:

| Is refused when                     | For example                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| it does not load                    | the JSON is broken, or it has a field no game document has                   |
| it names something that isn't there | a pack, stage or sound theme this game does not have, or a game it came from |
| it does not play                    | the game's own autoplay pilots cannot fly and finish every stage it plays    |
| it takes a name or id already used  | another game's name, a shipped game's id, or an id like `classic-2`          |
| it does not say who made it         | no `"author"`, or one longer than 21 characters                              |
| it changes nothing                  | it plays exactly as the game it was made from                                |
| it changes more than the shelf      | the pull request touches anything outside the `shelf` folder                 |

A refusal is a red cross on the check called **Lint, tests, packs and smoke**.
Open it, and the step that failed says what to fix: **Shelf: a submission changes
only shelf/** lists what your pull request changed besides the shelf, and
**Validate content packs and the shelf** names your file and the problem with it:

```
shelf/dusk-patrol.json:
  author: a shelf entry says who made it: add "author" with your name
```

Fix the file in your pull request (**Files changed**, then the **⋯** menu on your
file, then **Edit file**), commit, and the checks run again.

**When the checks pass, the only question left is whether it suits the shelf.**
That is a matter of taste, and the maintainer's to decide: a working variation
can still be declined. If it is accepted and merged, it is published on the shelf
page, <https://sgwoods.github.io/star-swarm/shelf.html>, and on the game list,
marked `=` with your name under it. It has a high-score table of its own, and it
never changes the game it was made from.

## Checking it on your own machine first

Optional, if you have [Node](https://nodejs.org/) and a copy of the repository:
put your file in the `shelf` folder and run

```sh
npm install
npm run validate-packs
```

which runs the same checks as the pull request: it ends `OK` when your variation
would pass, and lists what to fix when it would not. It flies every stage, so it
takes a minute or two. `npm run dev` then serves the game at
<http://localhost:5173> with your variation on its game list.

[`shelf/README.md`](shelf/README.md) has the rules an entry is held to, and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) how the game treats one.
