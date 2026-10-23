# `shelf/`

Variations of this build's games that **other players made**, curated into the
repository and published with the game: on the shelf page beside it
(`shelf.html`) and on the game list, marked `=`, after the games in
[`variants/`](../variants/).

A shelf entry is a variant document like any other: the text a player's `EXPORT`
card writes, saved here as one file, with two things said by hand. There is no
other store, no upload and no account. [`CONTRIBUTING.md`](../CONTRIBUTING.md) is
how a stranger makes one and submits it, step by step.

```json
{
  "id": "dusk-patrol",
  "name": "DUSK PATROL",
  "author": "ALICE",
  "description": "Five ships and the dusk sound",
  "derivedFrom": "classic",
  "packs": ["classic"],
  "lives": 5,
  "theme": "dusk",
  "difficulty": { "presets": ["…as exported…"], "defaultPreset": "arcade" },
  "autoplay": { "personas": ["…as exported…"], "defaultPersona": "normal" }
}
```

## What an entry has to be

Everything a document in `variants/` has to be — the same schema and the same
reference passes, in `src/content/variants.ts` — and the shelf's own rules on top,
in `src/ui/shelf.ts`:

| Field         | The shelf's rule                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`          | The file's name. No reference game's, and not the shape the game gives a player's own (`classic-2`)        |
| `name`        | What the naming card can spell: up to 14 of `A`–`Z`, `0`–`9`, space, `-` and `.` — and no other game's     |
| `author`      | Required. Up to 21 characters the pixel font draws, because the game list says `BY` and the name           |
| `derivedFrom` | Required — the `EXPORT` card writes it — and names a game this build offers: a reference, or another entry |
| `description` | Optional: the maker's own line, shown on the shelf page                                                    |

And it has to **change something** from the game it was made from: an entry that
plays exactly as that game does is refused.

**What it changes is derived, never written down.** The shelf page and the gate's
report compare an entry with the game it names in `derivedFrom` — its packs, its
stage order, its starting ships, its audio theme, its difficulty presets and its
autoplay personas, compared as each plays — so the list a visitor reads cannot
disagree with the game it describes.

## The gate

`npm run validate-packs` judges every entry here as its fifth pass, and then
**flies** it as its sixth: every stage the entry plays goes through
`scripts/playability.ts`, the same pass every shipped game is flown through. CI
runs it on every pull request, so an entry that does not load, names something
this build does not have, or does not play is refused on its own pull request with
the file, the field and the reason — before anybody reads it.

A pull request from outside the project that adds or changes an entry may change
nothing else: `scripts/shelf-submission.ts` refuses one that also touches a pack,
the code or anything outside this directory. Whole games are not accepted from
outside the project yet.

## How an entry plays

Exactly as its document says, and nothing it says reaches a reference game:

- **Read-only, like a reference game.** Editing one in the game makes a new
  variation of the player's own, derived from the entry, and leaves the entry as
  it is published. The copy does not inherit `author`.
- **Its own high-score table**, keyed by its `id` — which is why the id may be no
  reference game's and not the shape of a player's own variation.
- **One entry never takes the others down.** In the browser an entry that does
  not load is left off the list and said in the console; the reference games and
  every other entry play as before. On `main` that cannot happen, because the gate
  has flown every entry first.

Files here are the export as the game wrote it, so Prettier leaves them alone
(`.prettierignore`).
